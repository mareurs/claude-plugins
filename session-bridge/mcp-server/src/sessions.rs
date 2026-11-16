//! Unified routing while retaining legacy Claude addresses and storage.
use crate::{
    codex::{discover_codex, is_thread_id, CodexEndpoint},
    endpoints::{claude_pid_of, discover, repo_of, Endpoint, Roots},
    paths::profile_matches,
};
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum Session {
    Claude(Endpoint),
    Codex(CodexEndpoint),
}
impl Session {
    pub fn key(&self) -> String {
        match self {
            Self::Claude(e) => e.key(),
            Self::Codex(e) => e.key(),
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
        }
    }
    /// Codex uses logical PID zero, since the hashed profile already identifies a complete
    /// home/thread. This keeps self-exclusion/cursors stable when a daemon restarts.
    pub fn storage_id(&self) -> (String, u32) {
        match self {
            Self::Claude(e) => (e.profile.clone(), e.pid),
            Self::Codex(e) => (e.storage_profile(), 0),
        }
    }
    pub fn session_id(&self) -> &str {
        match self {
            Self::Claude(e) => &e.session_id,
            Self::Codex(e) => &e.session_id,
        }
    }
    pub fn cwd(&self) -> Option<&Path> {
        match self {
            Self::Claude(e) => Some(&e.launch_cwd),
            Self::Codex(e) => e.cwd.as_deref(),
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
                e.cwd.as_ref().and_then(|p|repo_of(p)).map(|p|clean(&p.to_string_lossy())).unwrap_or_else(||"-".into()))
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
pub fn resolve_session<'a>(
    sessions: &'a [Session],
    target: &str,
    me: Option<&str>,
) -> Result<&'a Session> {
    let legacy_prefix = target.split_once(':').filter(|(p, _)| {
        sessions
            .iter()
            .any(|s| matches!(s,Session::Claude(e) if profile_matches(&e.profile,p)))
    });
    let mut found = Vec::new();
    for session in sessions {
        let rank = match session {
            Session::Codex(e) => e.match_rank(target),
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
    let hits: Vec<_> = found
        .iter()
        .filter(|p| Some(p.0) == tier)
        .map(|p| p.1)
        .collect();
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
        [one] => Ok(one),
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
