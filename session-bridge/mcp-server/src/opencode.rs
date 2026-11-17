//! Discovery and addressing of OpenCode sessions, read through the background service API.
//! A session is live when it is top-level, not a bridge fork, and either recently touched or
//! currently active. Child sessions are never listed or targetable.
use crate::opencode_api::{data_dir, ensure_service, locate_opencode, CliApi, OcApi};
use anyhow::{anyhow, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenCodeEndpoint {
    pub data_dir: PathBuf,
    pub session_id: String,
    pub title: Option<String>,
    pub directory: Option<PathBuf>,
    pub running: bool,
    pub last_active_ms: i64,
}

impl OpenCodeEndpoint {
    /// Canonical address: the full data dir keeps two OpenCode installs apart.
    pub fn key(&self) -> String {
        format!("opencode:{}:{}", self.data_dir.display(), self.session_id)
    }
    /// Filesystem-safe store identity; SHA-256 of the canonical data dir.
    pub fn storage_profile(&self) -> String {
        format!(
            "opencode-{:x}-{}",
            Sha256::digest(self.data_dir.as_os_str().as_encoded_bytes()),
            self.session_id
        )
    }
    /// 0 = exact key, id or title; 1 = id prefix of at least four characters.
    pub fn match_rank(&self, target: &str) -> Option<u8> {
        if target == self.key() {
            return Some(0);
        }
        let mut query = target;
        if let Some(rest) = target.strip_prefix("opencode:") {
            let (dir, id) = rest.rsplit_once(':')?;
            if Path::new(dir) != self.data_dir {
                return None;
            }
            query = id;
        }
        if query == self.session_id || self.title.as_deref() == Some(query) {
            Some(0)
        } else if query.chars().count() >= 4 && self.session_id.starts_with(query) {
            Some(1)
        } else {
            None
        }
    }
}

/// `ses_` followed by one or more ASCII alphanumerics.
pub fn is_session_id(s: &str) -> bool {
    s.strip_prefix("ses_")
        .is_some_and(|r| !r.is_empty() && r.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// A bridge fork carries a `fork` object and a title ending ` (fork #N)`.
fn is_fork(row: &Value) -> bool {
    if row.get("fork").is_some_and(|f| !f.is_null()) {
        return true;
    }
    row.get("title")
        .and_then(Value::as_str)
        .and_then(|t| t.strip_suffix(')'))
        .and_then(|t| t.rsplit_once(" (fork #"))
        .is_some_and(|(_, n)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// Exactly two API calls: `GET /api/session` and `GET /api/session/active`.
pub async fn discover_opencode(
    api: &impl OcApi,
    data_dir: &Path,
    now_ms: i64,
    recent_hours: u64,
) -> Result<Vec<OpenCodeEndpoint>> {
    let list = api.call("GET", "/api/session", None).await?;
    let rows = list
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("OpenCode session list has no data array"))?;
    let active = api.call("GET", "/api/session/active", None).await?;
    let active: HashSet<&str> = active
        .get("data")
        .and_then(Value::as_object)
        .map(|o| o.keys().map(String::as_str).collect())
        .unwrap_or_default();
    let window = i64::try_from(recent_hours)
        .unwrap_or(i64::MAX)
        .saturating_mul(3_600_000);
    let mut out = Vec::new();
    for row in rows {
        let Some(id) = row
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| is_session_id(s))
        else {
            continue;
        };
        if row.get("parentID").is_some_and(|p| !p.is_null()) || is_fork(row) {
            continue;
        }
        let time = |k: &str| {
            row.pointer(&format!("/time/{k}"))
                .and_then(Value::as_i64)
                .unwrap_or(0)
        };
        let last = time("updated").max(time("viewed"));
        let running = active.contains(id);
        if !running && now_ms.saturating_sub(last) > window {
            continue;
        }
        out.push(OpenCodeEndpoint {
            data_dir: data_dir.to_path_buf(),
            session_id: id.to_owned(),
            title: row.get("title").and_then(Value::as_str).map(str::to_owned),
            directory: row
                .pointer("/location/directory")
                .and_then(Value::as_str)
                .map(PathBuf::from),
            running,
            last_active_ms: last,
        });
    }
    Ok(out)
}

/// Locate the CLI, make sure the service answers, then discover. Any failure is the caller's note.
pub async fn discover_opencode_system(
    env: &(dyn Fn(&str) -> Option<String> + Sync),
) -> Result<Vec<OpenCodeEndpoint>> {
    let bin = locate_opencode(env)?;
    let dir = data_dir(env).ok_or_else(|| anyhow!("OpenCode data directory not found"))?;
    let api = CliApi {
        bin: bin.clone(),
        timeout: Duration::from_secs(10),
    };
    ensure_service(&api, &bin).await?;
    let hours = env("SESSION_BRIDGE_OPENCODE_RECENT_HOURS")
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(24);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0);
    discover_opencode(&api, &dir, now_ms, hours).await
}
