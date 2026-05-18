//! MCP tool handlers — list_sessions, ask_session, set_alias.

use crate::claude_cli::{locate_claude_binary, run_with_binary, AskMode, AskSpec};
use crate::error::{BridgeError, Result};
use crate::registry::{
    default_lock_path, default_registry_path, load, pid_alive, prune_with,
    resolve_ref, save, set_alias_in, SessionEntry,
};
use fs2::FileExt;
use serde::Serialize;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
pub struct SessionListItem {
    pub session_id: String,
    pub cwd: String,
    pub branch: String,
    pub alias: Option<String>,
    pub instance: String,
    pub started_at: i64,
    pub age_seconds: i64,
}

#[derive(Debug, Serialize)]
pub struct AskResult {
    pub answer: String,
    pub session_id: String,
    pub mode: &'static str,
    pub duration_ms: u128,
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn list_sessions() -> Result<Vec<SessionListItem>> {
    let path = default_registry_path();
    let lock = default_lock_path();
    let mut reg = match load(&path, &lock) {
        Ok(r) => r,
        Err(BridgeError::RegistryCorrupt(_)) => return Ok(vec![]),
        Err(e) => return Err(e),
    };
    let removed = prune_with(&mut reg, pid_alive);
    if !removed.is_empty() {
        save(&path, &lock, &reg)?;
    }
    let now = now_secs();
    let mut items: Vec<SessionListItem> = reg.sessions.values().map(|e| SessionListItem {
        session_id: e.session_id.clone(),
        cwd: e.cwd.clone(),
        branch: e.branch.clone(),
        alias: e.alias.clone(),
        instance: e.instance.clone(),
        started_at: e.started_at,
        age_seconds: now - e.started_at,
    }).collect();
    items.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(items)
}

pub async fn ask_session(reference: &str, prompt: &str, mode: &str, timeout_s: u64) -> Result<AskResult> {
    let path = default_registry_path();
    let lock = default_lock_path();
    let mut reg = load(&path, &lock)?;
    if reg.sessions.is_empty() {
        return Err(BridgeError::NoSessionsRegistered);
    }
    let removed = prune_with(&mut reg, pid_alive);
    if !removed.is_empty() {
        save(&path, &lock, &reg)?;
    }
    let entry: SessionEntry = resolve_ref(&reg, reference)?.clone();
    if !pid_alive(entry.pid) {
        return Err(BridgeError::SessionDied(entry.session_id, entry.pid));
    }
    let bin = locate_claude_binary()?;

    let started = std::time::Instant::now();
    let result = match mode {
        "ephemeral" => run_ephemeral(&bin, &entry, prompt, timeout_s).await,
        "bidirectional" => run_bidirectional(&bin, &entry, prompt, timeout_s).await,
        other => Err(BridgeError::RegistryCorrupt(format!("unknown mode {other}"))),
    };
    let duration_ms = started.elapsed().as_millis();
    let answer = result?;
    Ok(AskResult {
        answer,
        session_id: entry.session_id,
        mode: if mode == "ephemeral" { "ephemeral" } else { "bidirectional" },
        duration_ms,
    })
}

async fn run_ephemeral(bin: &str, entry: &SessionEntry, prompt: &str, timeout_s: u64) -> Result<String> {
    // No transcript copy needed: --fork-session creates a new session id for us.
    let spec = AskSpec {
        mode: AskMode::Ephemeral,
        session_id: entry.session_id.clone(),
        cwd: PathBuf::from(&entry.cwd),
        prompt: prompt.to_string(),
        timeout_s,
    };
    run_with_binary(bin, &spec).await
}

async fn run_bidirectional(bin: &str, entry: &SessionEntry, prompt: &str, timeout_s: u64) -> Result<String> {
    // Serialize concurrent bidirectional asks on the same transcript via flock.
    let lock_file = OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(&entry.transcript_path)?;
    if lock_file.try_lock_exclusive().is_err() {
        let lf = lock_file.try_clone()?;
        let got = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_s),
            tokio::task::spawn_blocking(move || lf.lock_exclusive()),
        ).await;
        match got {
            Ok(Ok(Ok(()))) => {}
            _ => return Err(BridgeError::SessionBusy(entry.session_id.clone())),
        }
    }
    let spec = AskSpec {
        mode: AskMode::Bidirectional,
        session_id: entry.session_id.clone(),
        cwd: PathBuf::from(&entry.cwd),
        prompt: prompt.to_string(),
        timeout_s,
    };
    let out = run_with_binary(bin, &spec).await;
    let _ = lock_file.unlock();
    out
}

pub fn set_alias(session_id: &str, alias: Option<String>) -> Result<()> {
    let path = default_registry_path();
    let lock = default_lock_path();
    let mut reg = load(&path, &lock)?;
    set_alias_in(&mut reg, session_id, alias)?;
    save(&path, &lock, &reg)?;
    Ok(())
}
