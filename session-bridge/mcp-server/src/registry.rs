//! Registry — load/save/prune/resolve_ref/set_alias.
//!
//! On-disk layout (mirrors session-bridge/hooks/lib.sh):
//!   ~/.claude/sessions/active.json — {"version":1,"sessions":{<id>:{...}}}
//!   ~/.claude/sessions/.lock       — flock target.

use crate::error::{BridgeError, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEntry {
    pub session_id: String,
    pub transcript_path: String,
    pub cwd: String,
    pub branch: String,
    pub pid: i32,
    pub started_at: i64,
    #[serde(default)]
    pub alias: Option<String>,
    pub instance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registry {
    pub version: u32,
    pub sessions: BTreeMap<String, SessionEntry>,
}

impl Default for Registry {
    fn default() -> Self {
        Self { version: 1, sessions: BTreeMap::new() }
    }
}

pub fn default_registry_path() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join(".claude/sessions/active.json")
}

pub fn default_lock_path() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join(".claude/sessions/.lock")
}

/// Load the registry under a shared flock. Returns an empty registry if the file does not exist.
pub fn load(path: &Path, lock: &Path) -> Result<Registry> {
    if !path.exists() {
        return Ok(Registry::default());
    }
    if let Some(parent) = lock.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let lock_file = OpenOptions::new().read(true).write(true).create(true).open(lock)?;
    lock_file.lock_shared()?;
    let mut buf = String::new();
    File::open(path)?.read_to_string(&mut buf)?;
    let reg: Registry = serde_json::from_str(&buf)
        .map_err(|e| BridgeError::RegistryCorrupt(e.to_string()))?;
    lock_file.unlock()?;
    Ok(reg)
}

/// Save the registry under an exclusive flock via atomic rename.
pub fn save(path: &Path, lock: &Path, reg: &Registry) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if let Some(parent) = lock.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let lock_file = OpenOptions::new().read(true).write(true).create(true).open(lock)?;
    lock_file.lock_exclusive()?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = File::create(&tmp)?;
        f.write_all(serde_json::to_string_pretty(reg)?.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    lock_file.unlock()?;
    Ok(())
}

/// Drop sessions whose pid fails the liveness predicate. Returns the removed ids.
pub fn prune_with<F>(reg: &mut Registry, mut alive: F) -> Vec<String>
where
    F: FnMut(i32) -> bool,
{
    let dead: Vec<String> = reg
        .sessions
        .iter()
        .filter(|(_, e)| !alive(e.pid))
        .map(|(k, _)| k.clone())
        .collect();
    for id in &dead {
        reg.sessions.remove(id);
    }
    dead
}

/// Real liveness check: kill(pid, 0) via nix.
pub fn pid_alive(pid: i32) -> bool {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid), None).is_ok()
}

/// Resolve a user-supplied reference to a single session entry.
/// Resolution order:
///   1. Exact session_id match
///   2. Exact alias match
///   3. Substring match across {session_id prefix, alias, cwd}
pub fn resolve_ref<'a>(reg: &'a Registry, query: &str) -> Result<&'a SessionEntry> {
    if let Some(e) = reg.sessions.get(query) {
        return Ok(e);
    }
    for e in reg.sessions.values() {
        if e.alias.as_deref() == Some(query) {
            return Ok(e);
        }
    }
    let matches: Vec<&SessionEntry> = reg
        .sessions
        .values()
        .filter(|e| {
            e.session_id.starts_with(query)
                || e.alias.as_deref().map(|a| a.contains(query)).unwrap_or(false)
                || e.cwd.contains(query)
        })
        .collect();
    match matches.len() {
        0 => Err(BridgeError::SessionNotFound(
            query.to_string(),
            reg.sessions.keys().cloned().collect(),
        )),
        1 => Ok(matches[0]),
        _ => Err(BridgeError::AmbiguousRef(
            query.to_string(),
            matches.iter().map(|e| e.session_id.clone()).collect(),
        )),
    }
}
