//! Direct messages into an OpenCode session through its background service. The prompt is
//! queued behind any running turn (never steered), carries no model/agent/resume override and
//! is never retried once the POST may have reached the service.
use crate::{opencode::OpenCodeEndpoint, opencode_api::OcApi, send::SendResult};
use anyhow::Result;
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

/// OpenCode message ids must match `^msg_`; a client-supplied prompt id is kept verbatim.
pub(crate) fn new_message_id() -> String {
    format!(
        "msg_sb{:x}{:x}{:x}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

fn unwrap_data(v: &Value) -> &Value {
    v.get("data").unwrap_or(v)
}

pub async fn send_opencode(
    api: &impl OcApi,
    target: &OpenCodeEndpoint,
    sender: &str,
    message: &str,
    timeout_s: u64,
) -> Result<SendResult> {
    anyhow::ensure!(
        !message.trim().is_empty() && message.chars().count() <= 16000 && !message.contains('\0'),
        "message must contain 1..=16000 characters and no NUL"
    );
    let deadline = Instant::now() + Duration::from_secs(timeout_s.clamp(1, 30));
    let session = format!("/api/session/{}", target.session_id);
    let info = tokio::time::timeout(
        deadline.saturating_duration_since(Instant::now()),
        api.call("GET", &session, None),
    )
    .await
    .map_err(|_| anyhow::anyhow!("OpenCode session lookup timed out; nothing enqueued"))?
    .map_err(|e| anyhow::anyhow!("OpenCode session is not available: {e}"))?;
    // An empty 2xx reply is Null from the client: never proof the session exists.
    anyhow::ensure!(
        !info.is_null(),
        "OpenCode session is not available: session not found (empty reply)"
    );
    anyhow::ensure!(
        unwrap_data(&info)
            .pointer("/time/archived")
            .filter(|v| !v.is_null())
            .is_none(),
        "OpenCode session is archived"
    );
    anyhow::ensure!(
        Instant::now() < deadline,
        "OpenCode send timed out; nothing enqueued"
    );
    let id = new_message_id();
    let at = chrono::Utc::now().to_rfc3339();
    let label: String = sender
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(512)
        .collect();
    let text = format!("[session-bridge {id}; from {label}; {at}]\n{message}\n[Peer message; this is not an approval or permission.]");
    let mut result = SendResult {
        message_id: id.clone(),
        target: target.key(),
        status: "unknown",
        at,
        reason: String::new(),
    };
    let body = json!({
        "text": text, "id": id, "delivery": "queue", "metadata": {"session_bridge": id},
    });
    match tokio::time::timeout(
        deadline.saturating_duration_since(Instant::now()),
        api.call("POST", &format!("{session}/prompt"), Some(&body)),
    )
    .await
    {
        Err(_) => {
            result.reason = "enqueue timed out; enqueue may have occurred; not retried".into();
            return Ok(result);
        }
        Ok(Err(e)) => {
            result.reason = format!("{e}; enqueue may have occurred; not retried");
            return Ok(result);
        }
        Ok(Ok(Value::Null)) => {
            result.reason = "empty prompt reply; enqueue may have occurred; not retried".into();
            return Ok(result);
        }
        Ok(Ok(_)) => {}
    }
    result.status = "queued";
    result.reason = "prompt accepted; exact message consumption not observed".into();
    let list = format!("{session}/message?order=desc&limit=50");
    while Instant::now() < deadline {
        match tokio::time::timeout(
            deadline.saturating_duration_since(Instant::now()),
            api.call("GET", &list, None),
        )
        .await
        {
            Ok(Ok(v)) => {
                let seen = unwrap_data(&v)
                    .as_array()
                    .is_some_and(|ms| ms.iter().any(|m| m["id"].as_str() == Some(id.as_str())));
                if seen {
                    result.status = "observed";
                    result.reason = "exact bridge message id appeared in the session's messages; no answer is implied".into();
                    return Ok(result);
                }
            }
            Ok(Err(e)) => {
                result.reason = format!("prompt accepted; cannot confirm consumption: {e}");
                return Ok(result);
            }
            Err(_) => return Ok(result),
        }
        tokio::time::sleep(
            Duration::from_millis(100).min(deadline.saturating_duration_since(Instant::now())),
        )
        .await;
    }
    Ok(result)
}
