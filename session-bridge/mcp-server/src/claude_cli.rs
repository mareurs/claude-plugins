//! Spawn `claude -p --resume …` with a timeout. Pure argv builder + thin async runner.
//!
//! Flags pinned by session-bridge/docs/claude-cli-probe.md. Update that doc AND
//! this file together if the CLI surface changes.

use crate::error::{BridgeError, Result};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Clone)]
pub enum AskMode {
    /// Read-only fork via --fork-session; original session untouched.
    Ephemeral,
    /// In-place --resume; Q+A appended to producer history. Caller must hold the lock.
    Bidirectional,
}

#[derive(Debug, Clone)]
pub struct AskSpec {
    pub mode: AskMode,
    pub session_id: String,
    pub cwd: PathBuf,
    pub prompt: String,
    pub timeout_s: u64,
}

/// Build the argv for `claude` (binary excluded). Pure — no I/O.
pub fn build_argv(spec: &AskSpec) -> Vec<String> {
    let mut argv = vec!["-p".to_string(), "--resume".into(), spec.session_id.clone()];
    if matches!(spec.mode, AskMode::Ephemeral) {
        argv.push("--fork-session".into());
        argv.push("--no-session-persistence".into());
        argv.push("--allowed-tools".into());
        argv.push("Read,Grep,Glob,WebFetch".into());
    }
    argv.push("--".into());
    argv.push(spec.prompt.clone());
    argv
}

/// Spawn the given binary with argv from `build_argv`, capture stdout, enforce timeout.
pub async fn run_with_binary(bin: &str, spec: &AskSpec) -> Result<String> {
    let argv = build_argv(spec);
    let mut cmd = Command::new(bin);
    cmd.args(&argv)
        .current_dir(&spec.cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => BridgeError::ClaudeCliMissing,
        _ => BridgeError::Io(e),
    })?;
    let mut stdout = child.stdout.take().unwrap();
    let dur = Duration::from_secs(spec.timeout_s);
    let result = timeout(dur, async {
        let mut buf = String::new();
        stdout.read_to_string(&mut buf).await?;
        let _ = child.wait().await?;
        Ok::<String, std::io::Error>(buf)
    })
    .await;
    match result {
        Ok(Ok(s)) => Ok(s),
        Ok(Err(e)) => Err(BridgeError::Io(e)),
        Err(_) => {
            let _ = child.start_kill();
            Err(BridgeError::Timeout(spec.timeout_s))
        }
    }
}

/// Resolve the system `claude` binary path. Override via SESSION_BRIDGE_CLAUDE_BIN.
pub fn locate_claude_binary() -> Result<String> {
    if let Ok(v) = std::env::var("SESSION_BRIDGE_CLAUDE_BIN") {
        return Ok(v);
    }
    which::which("claude")
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|_| BridgeError::ClaudeCliMissing)
}
