//! Per-endpoint state: one JSON file per (profile, Claude pid), updated under a lock.
//!
//! Hooks and the filter worker of one endpoint run as separate processes, so every
//! change is read-modify-write under an exclusive `fs2` lock on a separate lock file,
//! and lands by writing a temp file and renaming it over the state file.

use crate::endpoints::registered_session;
use crate::error::Result;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The filter's verdict on one notice for this endpoint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Verdict {
    pub seq: i64,
    pub relevant: bool,
    pub evidence: String,
    pub why: String,
    pub unfiltered_reason: Option<String>,
}

/// What one endpoint remembers between hook calls. Unknown or missing fields in an
/// existing file are tolerated, so an older or newer writer never breaks a reader.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EndpointState {
    pub schema: u32,
    pub session_id: String,
    pub transcript_path: Option<String>,
    pub cwd: Option<String>,
    pub last_look_ms: i64,
    pub pending: Vec<i64>,
    pub verdicts: Vec<Verdict>,
    pub delivered: Vec<i64>,
    /// Worktree path to the last commit sha seen there.
    pub heads: BTreeMap<String, String>,
    pub last_post_ms: i64,
    pub worker_pid: Option<u32>,
    /// When a hook last started a filter worker for this endpoint.
    #[serde(default)]
    pub last_spawn_ms: i64,
    /// When the first SessionStart of this endpoint (profile, pid) ran; 0 when none was seen.
    /// The backup scan counts commits from this time on at first sight of a worktree.
    #[serde(default)]
    pub started_ms: i64,
    /// Pid of the wake watcher of this endpoint; None when none runs.
    #[serde(default)]
    pub watcher_pid: Option<u32>,
    /// `process_start_ms` of the watcher (guards against pid reuse); 0 when none.
    #[serde(default)]
    pub watcher_started_ms: i64,
    /// When the watcher gives up; 0 when none.
    #[serde(default)]
    pub watch_until_ms: i64,
    /// Times of recent wakes (loop guard).
    #[serde(default)]
    pub wake_ms: Vec<i64>,
}

impl Default for EndpointState {
    fn default() -> Self {
        EndpointState {
            schema: 1,
            session_id: String::new(),
            transcript_path: None,
            cwd: None,
            last_look_ms: 0,
            pending: vec![],
            verdicts: vec![],
            delivered: vec![],
            heads: BTreeMap::new(),
            last_post_ms: 0,
            worker_pid: None,
            last_spawn_ms: 0,
            started_ms: 0,
            watcher_pid: None,
            watcher_started_ms: 0,
            watch_until_ms: 0,
            wake_ms: vec![],
        }
    }
}

/// `<state>/endpoints/<full profile>__<pid>.json`.
pub fn endpoint_path(state: &Path, profile: &str, pid: u32) -> PathBuf {
    state
        .join("endpoints")
        .join(format!("{profile}__{pid}.json"))
}

/// The state at `path`; a missing, unreadable or corrupt file is the default state.
pub fn load_or_default(path: &Path) -> EndpointState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// The state at `path`, read under a SHARED lock on `<path>.lock`, so a read never sees the
/// state from before an `update` that is running. Creates no file: when the lock file (or
/// its directory) does not exist, no update ever ran and the state is the default. If the
/// lock itself fails, the read goes ahead without it.
pub fn read_locked(path: &Path) -> EndpointState {
    let Ok(lock) = std::fs::File::open(sibling(path, ".lock")) else {
        return EndpointState::default();
    };
    let locked = lock.lock_shared().is_ok();
    let state = load_or_default(path);
    if locked {
        let _ = lock.unlock();
    }
    state
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

/// Read-modify-write `path` under an exclusive lock on `<path>.lock`, then rename a temp
/// file over it. Creates the parent directory. The lock is released on every path,
/// including a panic in `f` (the file handle drops) and a failed write; when `f`
/// panics or the write fails the state file is unchanged.
pub fn update<F: FnOnce(&mut EndpointState)>(path: &Path, f: F) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(sibling(path, ".lock"))?;
    lock.lock_exclusive()?;
    let result = write_locked(path, f);
    let _ = lock.unlock();
    result
}

fn write_locked<F: FnOnce(&mut EndpointState)>(path: &Path, f: F) -> Result<()> {
    let mut state = load_or_default(path);
    f(&mut state);
    let tmp = sibling(path, ".tmp");
    let written = (|| -> Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(&serde_json::to_vec(&state)?)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

/// The session id of endpoint (`profile`, `pid`): the endpoint state's `session_id` when
/// set, else the one Claude Code registered in `<config_dir>/sessions/<pid>.json`.
pub fn current_session(state: &Path, config_dir: &Path, profile: &str, pid: u32) -> Option<String> {
    let s = load_or_default(&endpoint_path(state, profile, pid));
    if !s.session_id.is_empty() {
        return Some(s.session_id);
    }
    registered_session(config_dir, pid)
}
