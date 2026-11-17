//! Unified routing while retaining legacy Claude addresses and storage.
use crate::{
    codex::{discover_codex, is_thread_id, CodexEndpoint},
    endpoints::{claude_pid_of, discover, repo_of, Endpoint, Roots},
    opencode::{discover_opencode_system, OpenCodeEndpoint},
    paths::profile_matches,
};
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum Session {
    Claude(Endpoint),
    Codex(CodexEndpoint),
    OpenCode(OpenCodeEndpoint),
}
impl Session {
    pub fn key(&self) -> String {
        match self {
            Self::Claude(e) => e.key(),
            Self::Codex(e) => e.key(),
            Self::OpenCode(e) => e.key(),
        }
    }
    pub fn identity(&self) -> String {
        match self {
            Self::Claude(e) => format!(
                "claude:{}:{}:{}",
                e.config_dir.display(),
                e.pid,
                e.session_id
            ),
            Self::Codex(e) => e.key(),
            Self::OpenCode(e) => e.key(),
        }
    }
    /// Codex uses logical PID zero, since the hashed profile already identifies a complete
    /// home/thread. This keeps self-exclusion/cursors stable when a daemon restarts.
    pub fn storage_id(&self) -> (String, u32) {
        match self {
            Self::Claude(e) => (e.profile.clone(), e.pid),
            Self::Codex(e) => (e.storage_profile(), 0),
            Self::OpenCode(e) => (e.storage_profile(), 0),
        }
    }
    pub fn session_id(&self) -> &str {
        match self {
            Self::Claude(e) => &e.session_id,
            Self::Codex(e) => &e.session_id,
            Self::OpenCode(e) => &e.session_id,
        }
    }
    pub fn cwd(&self) -> Option<&Path> {
        match self {
            Self::Claude(e) => Some(&e.launch_cwd),
            Self::Codex(e) => e.cwd.as_deref(),
            Self::OpenCode(e) => e.directory.as_deref(),
        }
    }
    pub fn render(&self, you: bool) -> String {
        match self {
            Self::Claude(e)=>format!("{}{} harness=claude session={} name={} kind={} status={} cwd={} repo={}",e.key(),if you{" (you)"}else{""},e.session_id,
                clean(e.name.as_deref().unwrap_or("-")),clean(e.kind.as_deref().unwrap_or("-")),clean(e.status.as_deref().unwrap_or("-")),
                clean(&e.launch_cwd.to_string_lossy()),repo_of(&e.launch_cwd).map(|p|clean(&p.to_string_lossy())).unwrap_or_else(||"-".into())),
            Self::Codex(e)=>format!("{}{} harness=codex session={} pid={} profile={} name={} status=loaded cwd={} repo={}",clean(&e.key()),if you{" (you)"}else{""},
                e.session_id,e.pid,clean(&e.config_dir.to_string_lossy()),clean(e.name.as_deref().unwrap_or("-")),
                e.cwd.as_ref().map(|p|clean(&p.to_string_lossy())).unwrap_or_else(||"-".into()),
                e.cwd.as_ref().and_then(|p|repo_of(p)).map(|p|clean(&p.to_string_lossy())).unwrap_or_else(||"-".into())),
            Self::OpenCode(e)=>format!("{}{} harness=opencode session={} name={} status={} cwd={} repo={}",clean(&e.key()),if you{" (you)"}else{""},
                e.session_id,clean(e.title.as_deref().unwrap_or("-")),if e.running{"running"}else{"idle"},
                e.directory.as_ref().map(|p|clean(&p.to_string_lossy())).unwrap_or_else(||"-".into()),
                e.directory.as_ref().and_then(|p|repo_of(p)).map(|p|clean(&p.to_string_lossy())).unwrap_or_else(||"-".into())),
        }
    }
}
fn clean(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_control() || c == '\u{2028}' || c == '\u{2029}' {
                ' '
            } else {
                c
            }
        })
        .collect()
}
pub fn discover_sessions(roots: &Roots) -> Vec<Session> {
    discover(roots)
        .into_iter()
        .map(Session::Claude)
        .chain(discover_codex(roots).into_iter().map(Session::Codex))
        .collect()
}
/// Claude and Codex (synchronous) plus OpenCode (service API, which may be started). An
/// OpenCode failure is a discovery note, never an error: the other harnesses are still listed.
pub async fn discover_sessions_all(
    roots: &Roots,
    env: &(dyn Fn(&str) -> Option<String> + Sync),
) -> (Vec<Session>, Vec<String>) {
    let mut sessions = discover_sessions(roots);
    let mut notes = Vec::new();
    add_opencode(&mut sessions, &mut notes, env, true).await;
    (sessions, notes)
}

/// Overall deadline for one OpenCode discovery (probe, optional start, listing, lookups).
pub const OPENCODE_DISCOVERY_DEADLINE: std::time::Duration = std::time::Duration::from_secs(15);

async fn add_opencode(
    sessions: &mut Vec<Session>,
    notes: &mut Vec<String>,
    env: &(dyn Fn(&str) -> Option<String> + Sync),
    start_service: bool,
) {
    let found = tokio::time::timeout(
        OPENCODE_DISCOVERY_DEADLINE,
        discover_opencode_system(env, start_service),
    )
    .await
    .unwrap_or_else(|_| {
        Err(anyhow!(
            "OpenCode discovery did not finish within {}s",
            OPENCODE_DISCOVERY_DEADLINE.as_secs()
        ))
    });
    match found {
        Ok(eps) => sessions.extend(eps.into_iter().map(Session::OpenCode)),
        Err(e) => notes.push(format!("OpenCode sessions not listed: {e:#}")),
    }
}

/// Whether `target` names an OpenCode session by its form: an `opencode:` address or a `ses_`
/// id (or id prefix).
pub fn looks_like_opencode(target: &str) -> bool {
    target.starts_with("opencode:") || target.starts_with("ses_")
}

/// The sessions an `ask_session` / `send_message` from a Claude or Codex caller resolves
/// `target` among. Claude and Codex come first; OpenCode is discovered only when the target
/// looks like an OpenCode address or id (then the service may be started), or when nothing
/// among `base` matches it (then the service is only probed, never started). A Claude or
/// Codex target therefore never depends on OpenCode.
pub async fn with_opencode_for_target(
    mut base: Vec<Session>,
    env: &(dyn Fn(&str) -> Option<String> + Sync),
    target: &str,
) -> (Vec<Session>, Vec<String>) {
    let mut notes = Vec::new();
    let opencode = looks_like_opencode(target);
    if opencode || matching(&base, target).is_empty() {
        add_opencode(&mut base, &mut notes, env, opencode).await;
    }
    (base, notes)
}

/// `with_opencode_for_target` over the discovered Claude and Codex sessions.
pub async fn sessions_for_target(
    roots: &Roots,
    env: &(dyn Fn(&str) -> Option<String> + Sync),
    target: &str,
) -> (Vec<Session>, Vec<String>) {
    with_opencode_for_target(discover_sessions(roots), env, target).await
}

/// `resolve_session`, with the discovery notes appended to a resolution error (a failed
/// OpenCode discovery otherwise reads as a plain "no match").
pub fn resolve_noted<'a>(
    sessions: &'a [Session],
    target: &str,
    me: Option<&str>,
    notes: &[String],
) -> Result<&'a Session> {
    resolve_session(sessions, target, me).map_err(|e| {
        if notes.is_empty() {
            e
        } else {
            anyhow!("{e:#}; discovery notes: {}", notes.join("; "))
        }
    })
}

/// The best-ranked sessions `target` names (empty when none matches).
fn matching<'a>(sessions: &'a [Session], target: &str) -> Vec<&'a Session> {
    let legacy_prefix = target.split_once(':').filter(|(p, _)| {
        sessions
            .iter()
            .any(|s| matches!(s,Session::Claude(e) if profile_matches(&e.profile,p)))
    });
    let mut found = Vec::new();
    for session in sessions {
        let rank = match session {
            Session::Codex(e) => e.match_rank(target),
            Session::OpenCode(e) => e.match_rank(target),
            Session::Claude(e) => {
                let rest = match legacy_prefix {
                    Some((p, r)) if profile_matches(&e.profile, p) => r,
                    Some(_) => continue,
                    None => target,
                };
                if e.session_id == rest
                    || e.name.as_deref() == Some(rest)
                    || (legacy_prefix.is_some() && rest.parse::<u32>().ok() == Some(e.pid))
                {
                    Some(0)
                } else if rest.chars().count() >= 4 && e.session_id.starts_with(rest) {
                    Some(1)
                } else {
                    None
                }
            }
        };
        if let Some(rank) = rank {
            found.push((rank, session));
        }
    }
    let tier = found.iter().map(|p| p.0).min();
    found
        .iter()
        .filter(|p| Some(p.0) == tier)
        .map(|p| p.1)
        .collect()
}

pub fn resolve_session<'a>(
    sessions: &'a [Session],
    target: &str,
    me: Option<&str>,
) -> Result<&'a Session> {
    let hits = matching(sessions, target);
    match hits.as_slice() {
        [] => Err(anyhow!(
            "no live session matches {target:?}; live sessions: {}",
            sessions
                .iter()
                .map(Session::key)
                .collect::<Vec<_>>()
                .join("; ")
        )),
        [one] if me == Some(one.identity().as_str()) => {
            Err(anyhow!("the target is the calling session itself"))
        }
        [one] => Ok(*one),
        many => Err(anyhow!(
            "{target:?} matches more than one session: {}",
            many.iter().map(|s| s.key()).collect::<Vec<_>>().join("; ")
        )),
    }
}
/// Explicit request metadata wins. Without it, a nearer validated Claude host wins
/// over inherited Codex variables; an intervening Codex host prevents selecting an outer Claude.
pub fn caller_session<'a>(
    sessions: &'a [Session],
    roots: &Roots,
    start_pid: u32,
    meta: &Value,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Option<&'a Session>> {
    if meta.get("threadId").is_none() {
        if let Some(claude_pid) = claude_pid_of(roots, start_pid) {
            let mut pid = start_pid;
            let mut seen = std::collections::HashSet::new();
            while pid > 1 && seen.insert(pid) {
                if pid == claude_pid {
                    let hits: Vec<_> = sessions
                        .iter()
                        .filter(|s| matches!(s, Session::Claude(e) if e.pid == pid))
                        .collect();
                    return match hits.as_slice() {
                        [one] => Ok(Some(one)),
                        _ => Err(anyhow!(
                            "Claude caller registration is unavailable or ambiguous"
                        )),
                    };
                }
                if sessions
                    .iter()
                    .any(|s| matches!(s, Session::Codex(e) if e.pid == pid))
                {
                    break;
                }
                let Some(parent) = crate::endpoints::ppid_of(roots, pid) else {
                    break;
                };
                pid = parent;
            }
        }
    }
    let sid = meta
        .get("threadId")
        .map(|v| v.as_str().unwrap_or(""))
        .map(str::to_owned)
        .or_else(|| env("CODEX_THREAD_ID"));
    if let Some(sid) = sid {
        anyhow::ensure!(is_thread_id(&sid), "invalid Codex caller thread metadata");
        let home = env("CODEX_HOME")
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .or_else(|| env("HOME").map(|h| Path::new(&h).join(".codex")));
        let home = home.map(|p| std::fs::canonicalize(&p).unwrap_or(p));
        let hits: Vec<_> = sessions.iter().filter(|s| matches!(s, Session::Codex(e) if e.session_id == sid && home.as_ref().is_none_or(|h| h == &e.config_dir))).collect();
        return match hits.as_slice() {
            [one] => Ok(Some(one)),
            [] => Err(anyhow!(
                "Codex caller is not a loaded thread in its CODEX_HOME"
            )),
            _ => Err(anyhow!(
                "Codex caller identity is ambiguous across processes/homes"
            )),
        };
    }
    Ok(None)
}
