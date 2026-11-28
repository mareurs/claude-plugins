//! Live Claude Code endpoints, read from Claude Code's own registry.
//!
//! An endpoint is one running Claude Code process. A legacy IPC socket or a native
//! Claude command identifies the host, and its live proc entry plus current per-PID
//! registration identifies the session. Its profile comes from
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

/// Clock ticks per second of the times in `/proc/<pid>/stat` (USER_HZ). 100 is the Linux
/// default and a fixed kernel ABI value on the mainstream architectures. `sysconf(_SC_CLK_TCK)`
/// is not called: it reports this same constant, and a fixed value keeps `process_start_ms` a
/// pure function of the files under `Roots`, which the tests fake.
#[cfg(unix)]
const CLK_TCK: i64 = 100;

/// Where to look. Injectable so tests use a tempdir.
#[derive(Debug, Clone)]
pub struct Roots {
    pub proc_root: PathBuf,
    pub socks: PathBuf,
    /// Windows has no `/proc` and no socket directory: its endpoints come from the
    /// `sessions/<pid>.json` registry of each of these profile directories.
    #[cfg(windows)]
    pub profiles: Vec<PathBuf>,
}

impl Roots {
    /// `/proc` and `/run/user/<uid>/cc-socks`.
    #[cfg(unix)]
    pub fn system() -> Self {
        use std::os::unix::fs::MetadataExt;
        let uid = std::fs::metadata("/proc/self")
            .map(|m| m.uid())
            .unwrap_or(0);
        Roots {
            proc_root: PathBuf::from("/proc"),
            socks: PathBuf::from(format!("/run/user/{uid}/cc-socks")),
        }
    }

    /// The profile directories to scan: `CLAUDE_CONFIG_DIR` when set, then every `.claude` and
    /// `.claude-*` directory of the user profile that has a `sessions` registry.
    #[cfg(windows)]
    pub fn system() -> Self {
        let mut profiles: Vec<PathBuf> = Vec::new();
        let mut add = |p: PathBuf| {
            let key = |p: &Path| p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
            if !profiles.iter().any(|q| key(q) == key(&p)) {
                profiles.push(p);
            }
        };
        if let Some(c) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|s| !s.is_empty()) {
            add(PathBuf::from(c));
        }
        if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            if let Ok(rd) = std::fs::read_dir(&home) {
                for e in rd.flatten() {
                    let name = e.file_name();
                    let name = name.to_string_lossy();
                    if (name == ".claude" || name.starts_with(".claude-"))
                        && e.path().join("sessions").is_dir()
                    {
                        add(e.path());
                    }
                }
            }
        }
        Roots {
            proc_root: PathBuf::new(),
            socks: PathBuf::new(),
            profiles,
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
    /// Windows process creation time (FILETIME ticks, as a string): tells a reused pid from the
    /// process that registered.
    #[cfg_attr(unix, allow(dead_code))]
    proc_start: Option<String>,
}

#[cfg(unix)]
fn read_environ(roots: &Roots, pid: u32) -> Option<Vec<(String, String)>> {
    let raw = std::fs::read(roots.proc_root.join(pid.to_string()).join("environ")).ok()?;
    Some(
        raw.split(|b| *b == 0)
            .filter_map(|kv| {
                let s = String::from_utf8_lossy(kv);
                s.split_once('=')
                    .map(|(k, v)| (k.to_string(), v.to_string()))
            })
            .collect(),
    )
}

#[cfg(unix)]
fn env_get<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
    env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

/// The one parser of `<config>/sessions/<pid>.json`. `None` when the file is absent,
/// unreadable, malformed, lacks `sessionId`, or names a different pid.
fn read_registration(config_dir: &Path, pid: u32) -> Option<Registration> {
    let json =
        std::fs::read_to_string(config_dir.join("sessions").join(format!("{pid}.json"))).ok()?;
    let reg: Registration = serde_json::from_str(&json).ok()?;
    if reg.pid.is_some_and(|p| p != pid) {
        return None;
    }
    Some(reg)
}

/// The session id Claude Code registered for `pid` in `<config_dir>/sessions/<pid>.json`.
/// `None` when the file is absent, unreadable or malformed, has no `sessionId`, or its
/// `pid` field disagrees with `pid` (a stale or misplaced file).
pub fn registered_session(config_dir: &Path, pid: u32) -> Option<String> {
    read_registration(config_dir, pid).map(|r| r.session_id)
}

/// Whether process `pid` exists: `<proc_root>/<pid>` is a directory. This is the only
/// liveness rule; the socket file is checked separately by `discover`.
#[cfg(unix)]
pub fn pid_alive(roots: &Roots, pid: u32) -> bool {
    roots.proc_root.join(pid.to_string()).is_dir()
}
/// When process `pid` started, in milliseconds since the epoch: `starttime` (field 22 of
/// `<proc_root>/<pid>/stat`, in clock ticks since boot) plus `btime` (`<proc_root>/stat`,
/// seconds since the epoch). The fields are counted after the LAST `)`, because the comm
/// field (2) may hold spaces and parentheses. `None` when a file is unreadable or a field
/// does not parse.
#[cfg(unix)]
pub fn process_start_ms(roots: &Roots, pid: u32) -> Option<i64> {
    let stat = std::fs::read_to_string(roots.proc_root.join(pid.to_string()).join("stat")).ok()?;
    let rest = stat.get(stat.rfind(')')? + 1..)?;
    // `rest` starts at field 3 (state), so field 22 is the 20th token.
    let ticks: i64 = rest.split_whitespace().nth(22 - 3)?.parse().ok()?;
    let sys = std::fs::read_to_string(roots.proc_root.join("stat")).ok()?;
    let btime: i64 = sys
        .lines()
        .find_map(|l| l.strip_prefix("btime "))?
        .trim()
        .parse()
        .ok()?;
    btime
        .checked_mul(1000)?
        .checked_add(ticks.checked_mul(1000)? / CLK_TCK)
}

#[cfg(unix)]
fn endpoint_for(roots: &Roots, pid: u32) -> Option<Endpoint> {
    if !pid_alive(roots, pid) {
        return None;
    }
    let env = read_environ(roots, pid)?;
    if env_get(&env, "SESSION_BRIDGE_CHILD") == Some("1") {
        return None;
    }
    let config_dir = match env_get(&env, "CLAUDE_CONFIG_DIR").filter(|s| !s.is_empty()) {
        Some(c) => PathBuf::from(c),
        None => Path::new(env_get(&env, "HOME").filter(|s| !s.is_empty())?).join(".claude"),
    };
    let reg = read_registration(&config_dir, pid)?;
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

/// Official native Claude registers its current session even without the optional IPC socket.
#[cfg(unix)]
fn native_claude_endpoint(roots: &Roots, pid: u32) -> Option<Endpoint> {
    use std::io::Read;
    let file = std::fs::File::open(roots.proc_root.join(pid.to_string()).join("cmdline")).ok()?;
    let mut bytes = Vec::new();
    file.take(4096).read_to_end(&mut bytes).ok()?;
    let first = std::str::from_utf8(bytes.split(|b| *b == 0).next()?).ok()?;
    if Path::new(first).file_name()? != "claude" {
        return None;
    }
    endpoint_for(roots, pid)
}

/// Live endpoints, sorted by profile then pid. Anything unreadable is skipped.
#[cfg(unix)]
pub fn discover(roots: &Roots) -> Vec<Endpoint> {
    let mut pids = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(&roots.socks) {
        for entry in entries.flatten() {
            if let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|s| s.strip_suffix(".sock"))
                .and_then(|s| s.parse::<u32>().ok())
            {
                pids.insert(pid);
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir(&roots.proc_root) {
        for entry in entries.flatten() {
            if let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|s| s.parse::<u32>().ok())
            {
                pids.insert(pid);
            }
        }
    }
    let mut out: Vec<_> = pids
        .into_iter()
        .filter_map(|pid| {
            if roots.socks.join(format!("{pid}.sock")).exists() {
                endpoint_for(roots, pid)
            } else {
                native_claude_endpoint(roots, pid)
            }
        })
        .collect();
    out.sort_by(|a, b| (&a.profile, a.pid).cmp(&(&b.profile, b.pid)));
    out
}

#[cfg(unix)]
pub(crate) fn ppid_of(roots: &Roots, pid: u32) -> Option<u32> {
    let status =
        std::fs::read_to_string(roots.proc_root.join(pid.to_string()).join("status")).ok()?;
    status
        .lines()
        .find_map(|l| l.strip_prefix("PPid:"))?
        .trim()
        .parse()
        .ok()
}

/// Walk PPid to the nearest legacy socket holder or registered native Claude host.
#[cfg(unix)]
pub fn claude_pid_of(roots: &Roots, start_pid: u32) -> Option<u32> {
    let mut seen = HashSet::new();
    let mut pid = start_pid;
    while pid > 1 && seen.insert(pid) {
        if roots.socks.join(format!("{pid}.sock")).exists()
            || native_claude_endpoint(roots, pid).is_some()
        {
            return Some(pid);
        }
        pid = ppid_of(roots, pid)?;
    }
    None
}

/// Whether process `pid` is running.
#[cfg(windows)]
pub fn pid_alive(_roots: &Roots, pid: u32) -> bool {
    crate::sys::process_alive(pid)
}

/// When process `pid` started, in milliseconds since the Unix epoch. `None` when it cannot be
/// read (no such process, no access).
#[cfg(windows)]
pub fn process_start_ms(_roots: &Roots, pid: u32) -> Option<i64> {
    let ft = crate::sys::process_creation_filetime(pid)?;
    Some((ft / 10_000) as i64 - crate::sys::FILETIME_UNIX_EPOCH_MS)
}

/// The endpoint registered for `pid` in `config_dir`, when that process is running and started
/// when the registration says (a reused pid fails the start check).
#[cfg(windows)]
fn endpoint_in(config_dir: &Path, pid: u32) -> Option<Endpoint> {
    let reg = read_registration(config_dir, pid)?;
    let start = crate::sys::process_creation_filetime(pid)?;
    if let Some(recorded) = &reg.proc_start {
        if recorded.parse::<u64>().ok() != Some(start) {
            return None;
        }
    }
    Some(Endpoint {
        profile: profile_of(config_dir.to_str()),
        config_dir: config_dir.to_path_buf(),
        pid,
        session_id: reg.session_id,
        name: reg.name,
        kind: reg.kind,
        status: reg.status,
        launch_cwd: PathBuf::from(reg.cwd?),
        repo: None,
    })
}

/// Live endpoints, sorted by profile then pid: every registration whose process still runs.
#[cfg(windows)]
pub fn discover(roots: &Roots) -> Vec<Endpoint> {
    let mut out = Vec::new();
    for dir in &roots.profiles {
        let Ok(entries) = std::fs::read_dir(dir.join("sessions")) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(pid) = name
                .to_str()
                .and_then(|s| s.strip_suffix(".json"))
                .and_then(|s| s.parse::<u32>().ok())
            else {
                continue;
            };
            if let Some(ep) = endpoint_in(dir, pid) {
                out.push(ep);
            }
        }
    }
    out.sort_by(|a, b| (&a.profile, a.pid).cmp(&(&b.profile, b.pid)));
    out
}

#[cfg(windows)]
pub(crate) fn ppid_of(_roots: &Roots, pid: u32) -> Option<u32> {
    crate::sys::parent_pid(pid)
}

/// Walk the parent chain to the nearest registered Claude Code process.
#[cfg(windows)]
pub fn claude_pid_of(roots: &Roots, start_pid: u32) -> Option<u32> {
    let mut seen = HashSet::new();
    let mut pid = start_pid;
    while pid > 4 && seen.insert(pid) {
        if roots.profiles.iter().any(|d| endpoint_in(d, pid).is_some()) {
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
pub fn resolve_target<'a>(
    eps: &'a [Endpoint],
    target: &str,
    me: (&str, u32),
) -> Result<&'a Endpoint> {
    let (profile, rest) = match target.split_once(':') {
        Some((p, r)) if eps.iter().any(|e| profile_matches(&e.profile, p)) => (Some(p), r),
        _ => (None, target),
    };
    let pool = || {
        eps.iter()
            .filter(|e| profile.is_none_or(|p| profile_matches(&e.profile, p)))
    };
    let pid_query: Option<u32> = if profile.is_some() {
        rest.parse().ok()
    } else {
        None
    };
    let mut found: Vec<&Endpoint> = pool()
        .filter(|e| {
            e.session_id == rest || e.name.as_deref() == Some(rest) || Some(e.pid) == pid_query
        })
        .collect();
    if found.is_empty() && rest.chars().count() >= 4 {
        found = pool().filter(|e| e.session_id.starts_with(rest)).collect();
    }
    let all = || eps.iter().map(Endpoint::describe).collect::<Vec<_>>();
    if found.is_empty() {
        return Err(BridgeError::TargetNotFound {
            target: target.to_string(),
            candidates: all(),
        });
    }
    // Decide on the FULL match set, caller included: one match is self or the answer,
    // two or more are ambiguous even when the caller is one of them. A tier-1 hit (exact
    // id, name or pid) stops the search before the prefix tier, even when it is the caller.
    match found.as_slice() {
        [one] if one.profile == me.0 && one.pid == me.1 => Err(BridgeError::TargetIsSelf),
        [one] => Ok(one),
        many => Err(BridgeError::AmbiguousTarget {
            target: target.to_string(),
            candidates: many.iter().map(|e| e.describe()).collect(),
        }),
    }
}
