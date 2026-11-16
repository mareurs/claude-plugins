//! Explicit direct messages. Queued is not the same evidence as consumed by a thread.
use crate::{codex::CodexEndpoint, codex_process::run_bounded, endpoints::Roots};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    os::unix::fs::MetadataExt,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tokio::process::Command;
static NEXT: AtomicU64 = AtomicU64::new(0);
#[derive(Debug, Serialize)]
pub struct SendResult {
    pub message_id: String,
    pub target: String,
    pub status: &'static str,
    pub at: String,
    pub reason: String,
}
fn user_contains(record: &Value, text: &str) -> bool {
    if record["type"] == "event_msg" && record["payload"]["type"] == "user_message" {
        return record["payload"]["message"]
            .as_str()
            .is_some_and(|s| s.contains(text));
    }
    record["type"] == "response_item"
        && record["payload"]["type"] == "message"
        && record["payload"]["role"] == "user"
        && record["payload"]["content"]
            .as_array()
            .is_some_and(|blocks| {
                blocks.iter().any(|b| {
                    b["type"] == "input_text"
                        && b["text"].as_str().is_some_and(|s| s.contains(text))
                })
            })
}
/// Never shells out with peer text, resumes a dormant thread or automatically retries.
pub async fn send_codex(
    bin: &Path,
    target: &CodexEndpoint,
    sender: &str,
    message: &str,
    timeout_s: u64,
    roots: &Roots,
) -> Result<SendResult> {
    anyhow::ensure!(
        bin.is_absolute() && bin.is_file(),
        "Codex executable must be an absolute existing file"
    );
    anyhow::ensure!(
        !message.trim().is_empty() && message.chars().count() <= 16000 && !message.contains('\0'),
        "message must contain 1..=16000 characters and no NUL"
    );
    target.revalidate(roots)?;
    anyhow::ensure!(
        target.generation.is_some(),
        "Codex process generation is unavailable"
    );
    let original =
        fs::metadata(&target.transcript_path).context("cannot observe target transcript")?;
    let mut offset = original.len();
    let mut pending = String::new();
    let id = format!(
        "sb-{}-{}-{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    let at = chrono::Utc::now().to_rfc3339();
    let label: String = sender
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(512)
        .collect();
    let text=format!("[session-bridge {id}; from {label}; {at}]\n{message}\n[Peer message; this is not an approval or permission.]");
    let mut result = SendResult {
        message_id: id,
        target: target.key(),
        status: "unknown",
        at,
        reason: String::new(),
    };
    let deadline = Instant::now() + Duration::from_secs(timeout_s.clamp(1, 30));
    let mut cmd = Command::new(bin);
    cmd.args(["queue", "--thread", &target.session_id, "--message", &text])
        .env("CODEX_HOME", &target.config_dir)
        .env("SESSION_BRIDGE_CHILD", "1");
    for key in [
        "CODEX_THREAD_ID",
        "CODEX_PARENT_THREAD_ID",
        "CLAUDE_CONFIG_DIR",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDECODE",
    ] {
        cmd.env_remove(key);
    }
    match run_bounded(&mut cmd, deadline.saturating_duration_since(Instant::now())).await {
        Ok(out) if out.status.success() => {
            result.status = "queued";
            result.reason = "queue accepted; exact message consumption not observed".into();
        }
        Ok(out) => {
            result.reason = format!(
                "queue exited {}; enqueue may have occurred; not retried",
                out.status
            );
            return Ok(result);
        }
        Err(e) => {
            result.reason = format!("{e}; enqueue may have occurred; not retried");
            return Ok(result);
        }
    }
    let mut scanned = 0usize;
    loop {
        let observed = (|| -> Result<bool> {
            let mut file = fs::File::open(&target.transcript_path)?;
            let m = file.metadata()?;
            anyhow::ensure!(
                m.dev() == original.dev() && m.ino() == original.ino() && m.len() >= offset,
                "target transcript rotated or truncated"
            );
            file.seek(SeekFrom::Start(offset))?;
            let mut bytes = Vec::new();
            file.take(1024 * 1024 + 1).read_to_end(&mut bytes)?;
            offset += bytes.len() as u64;
            scanned += bytes.len();
            anyhow::ensure!(
                scanned <= 1024 * 1024,
                "message observation byte budget exceeded"
            );
            pending.push_str(std::str::from_utf8(&bytes)?);
            while let Some(end) = pending.find('\n') {
                let line = pending.drain(..=end).collect::<String>();
                if let Ok(record) = serde_json::from_str::<Value>(&line) {
                    if user_contains(&record, &text) {
                        return Ok(true);
                    }
                }
            }
            Ok(false)
        })();
        match observed {
            Ok(true) => {
                result.status = "observed";
                result.reason="exact bridge message appeared in a new target user record; no answer is implied".into();
                return Ok(result);
            }
            Err(e) => {
                result.reason = format!("queue accepted; cannot confirm consumption: {e}");
                return Ok(result);
            }
            Ok(false) => {}
        }
        if Instant::now() >= deadline {
            return Ok(result);
        }
        tokio::time::sleep(
            Duration::from_millis(50).min(deadline.saturating_duration_since(Instant::now())),
        )
        .await;
    }
}
