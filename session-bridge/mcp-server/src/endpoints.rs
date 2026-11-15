//! Live Claude Code endpoints, read from Claude Code's own registry.
//!
//! An endpoint is one running Claude Code process. It is live when
//! `<socks>/<pid>.sock` exists and `<proc>/<pid>` exists. Its profile comes from
//! the process's `CLAUDE_CONFIG_DIR`; its session id comes ONLY from
//! `<config>/sessions/<pid>.json` (the environ copy is the launch-time id and
//! goes stale after /clear or resume).

use crate::error::{BridgeError, Result};
use crate::paths::{profile_matches, profile_of, short_profile};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Where to look. Injectable so tests use a tempdir.
#[derive(Debug, Clone)]
pub struct Roots {
    pub proc_root: PathBuf,
    pub socks: PathBuf,
}

impl Roots {
    /// `/proc` and `/run/user/<uid>/cc-socks`.
    pub fn system() -> Self {
        use std::os::unix::fs::MetadataExt;
        let uid = std::fs::metadata("/proc/self").map(|m| m.uid()).unwrap_or(0);
        Roots {
            proc_root: PathBuf::from("/proc"),
            socks: PathBuf::from(format!("/run/user/{uid}/cc-socks")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    /// Full profile, e.g. `.claude-stef`.
    pub profile: String,
    pub config_dir: PathBuf,
    pub pid: u32,
    pub session_id: String,
    pub name: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub launch_cwd: PathBuf,
    /// Not filled by `discover` (it spawns git); callers use `repo_of(launch_cwd)`.
    pub repo: Option<PathBuf>,
}

impl Endpoint {
    /// `<short profile>:<pid>`.
    pub fn key(&self) -> String {
        format!("{}:{}", short_profile(&self.profile), self.pid)
    }

    fn describe(&self) -> String {
        format!(
            "{} kind={} status={} name={}",
            self.key(),
            self.kind.as_deref().unwrap_or("-"),
            self.status.as_deref().unwrap_or("-"),
            self.name.as_deref().unwrap_or("-"),
        )
    }
}

/// The fields of `<config>/sessions/<pid>.json` that we use; the rest is ignored.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registration {
    pid: Option<u32>,
    session_id: String,
    cwd: Option<String>,
    kind: Option<String>,
    status: Option<String>,
    name: Option<String>,
}

fn read_environ(roots: &Roots, pid: u32) -> Option<Vec<(String, String)>> {
    let raw = std::fs::read(roots.proc_root.join(pid.to_string()).join("environ")).ok()?;
    Some(
        raw.split(|b| *b == 0)
            .filter_map(|kv| {
                let s = String::from_utf8_lossy(kv);
                s.split_once('=').map(|(k, v)| (k.to_string(), v.to_string()))
            })
            .collect(),
    )
}

fn env_get<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
    env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

fn endpoint_for(roots: &Roots, pid: u32) -> Option<Endpoint> {
    if !roots.proc_root.join(pid.to_string()).is_dir() {
        return None;
    }
    let env = read_environ(roots, pid)?;
    let config_dir = match env_get(&env, "CLAUDE_CONFIG_DIR").filter(|s| !s.is_empty()) {
        Some(c) => PathBuf::from(c),
        None => Path::new(env_get(&env, "HOME").filter(|s| !s.is_empty())?).join(".claude"),
    };
    let json = std::fs::read_to_string(config_dir.join("sessions").join(format!("{pid}.json"))).ok()?;
    let reg: Registration = serde_json::from_str(&json).ok()?;
    if reg.pid.is_some_and(|p| p != pid) {
        return None;
    }
    let launch_cwd = std::fs::read_link(roots.proc_root.join(pid.to_string()).join("cwd"))
        .ok()
        .or_else(|| reg.cwd.map(PathBuf::from))?;
    Some(Endpoint {
        profile: profile_of(config_dir.to_str()),
        config_dir,
        pid,
        session_id: reg.session_id,
        name: reg.name,
        kind: reg.kind,
        status: reg.status,
        launch_cwd,
        repo: None,
    })
}

/// Live endpoints, sorted by profile then pid. Anything unreadable is skipped.
pub fn discover(roots: &Roots) -> Vec<Endpoint> {
    let Ok(rd) = std::fs::read_dir(&roots.socks) else {
        return vec![];
    };
    let mut out: Vec<Endpoint> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let pid: u32 = name.strip_suffix(".sock")?.parse().ok()?;
            endpoint_for(roots, pid)
        })
        .collect();
    out.sort_by(|a, b| (&a.profile, a.pid).cmp(&(&b.profile, b.pid)));
    out
}

fn ppid_of(roots: &Roots, pid: u32) -> Option<u32> {
    let status = std::fs::read_to_string(roots.proc_root.join(pid.to_string()).join("status")).ok()?;
    status.lines().find_map(|l| l.strip_prefix("PPid:"))?.trim().parse().ok()
}

/// Walk `PPid` from `start_pid` to the first process that holds a socket.
pub fn claude_pid_of(roots: &Roots, start_pid: u32) -> Option<u32> {
    let mut seen = HashSet::new();
    let mut pid = start_pid;
    while pid > 1 && seen.insert(pid) {
        if roots.socks.join(format!("{pid}.sock")).exists() {
            return Some(pid);
        }
        pid = ppid_of(roots, pid)?;
    }
    None
}

/// The repository's main work tree for `cwd` (shared by its linked worktrees), or
/// `None` when `cwd` is not in a git repository, git is missing, or it takes over 2 s.
pub fn repo_of(cwd: &Path) -> Option<PathBuf> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    let status = loop {
        match child.try_wait().ok()? {
            Some(s) => break s,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(10)),
        }
    };
    if !status.success() {
        return None;
    }
    let mut out = String::new();
    std::io::Read::read_to_string(&mut child.stdout.take()?, &mut out).ok()?;
    let common = PathBuf::from(out.trim());
    if !common.is_absolute() {
        return None;
    }
    if common.file_name().is_some_and(|n| n == ".git") {
        common.parent().map(Path::to_path_buf)
    } else {
        Some(common)
    }
}

/// Resolve `target` (full id, id prefix of at least 4 characters, registry name or
/// `<profile>:<pid>`, each optionally prefixed `<profile>:`) to one endpoint other
/// than `me` (full profile, pid).
pub fn resolve_target<'a>(eps: &'a [Endpoint], target: &str, me: (&str, u32)) -> Result<&'a Endpoint> {
    let (profile, rest) = match target.split_once(':') {
        Some((p, r)) if eps.iter().any(|e| profile_matches(&e.profile, p)) => (Some(p), r),
        _ => (None, target),
    };
    let pool = || eps.iter().filter(|e| profile.is_none_or(|p| profile_matches(&e.profile, p)));
    let pid_query: Option<u32> = if profile.is_some() { rest.parse().ok() } else { None };
    let mut found: Vec<&Endpoint> = pool()
        .filter(|e| e.session_id == rest || e.name.as_deref() == Some(rest) || Some(e.pid) == pid_query)
        .collect();
    if found.is_empty() && rest.chars().count() >= 4 {
        found = pool().filter(|e| e.session_id.starts_with(rest)).collect();
    }
    let all = || eps.iter().map(Endpoint::describe).collect::<Vec<_>>();
    if found.is_empty() {
        return Err(BridgeError::TargetNotFound { target: target.to_string(), candidates: all() });
    }
    found.retain(|e| !(e.profile == me.0 && e.pid == me.1));
    match found.as_slice() {
        [] => Err(BridgeError::TargetIsSelf),
        [one] => Ok(one),
        many => Err(BridgeError::AmbiguousTarget {
            target: target.to_string(),
            candidates: many.iter().map(|e| e.describe()).collect(),
        }),
    }
}
