//! Discovery and addressing of OpenCode sessions, read through the background service API.
//! A session is live when it is top-level, not a bridge fork, and either recently touched or
//! currently active. Child sessions are never listed or targetable.
use crate::opencode_api::{data_dir, ensure_service, locate_opencode, CliApi, OcApi};
use crate::sessions::Session;
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

/// The calling OpenCode session for `session-bridge call`. `ses_id` is the plugin's
/// `tctx.sessionID`, which may be a subagent child: its parent chain is followed through
/// `GET /api/session/{id}` (at most 8 hops) to the top-level session, which must then be a
/// live discovered `Session::OpenCode`. Nothing else ever names an OpenCode caller.
pub async fn opencode_caller<'a>(
    sessions: &'a [Session],
    api: &impl OcApi,
    ses_id: &str,
) -> Result<&'a Session> {
    const REFUSED: &str = "OpenCode caller is not a live top-level session";
    anyhow::ensure!(
        is_session_id(ses_id),
        "invalid OpenCode caller session id {ses_id:?}"
    );
    let mut id = ses_id.to_owned();
    let mut top = None;
    // A top-level id needs one lookup; each parent hop one more, up to 8 hops.
    for _ in 0..=8 {
        let row = api
            .call("GET", &format!("/api/session/{id}"), None)
            .await
            .map_err(|e| e.context(REFUSED))?;
        let row = row.get("data").unwrap_or(&row);
        match row.get("parentID").filter(|p| !p.is_null()) {
            None => {
                top = Some(id);
                break;
            }
            Some(parent) => {
                let parent = parent
                    .as_str()
                    .filter(|p| is_session_id(p))
                    .ok_or_else(|| anyhow!("{REFUSED}: malformed parentID"))?;
                id = parent.to_owned();
            }
        }
    }
    let top = top.ok_or_else(|| anyhow!("{REFUSED}: parent chain deeper than 8"))?;
    sessions
        .iter()
        .find(|s| matches!(s, Session::OpenCode(e) if e.session_id == top))
        .ok_or_else(|| anyhow!(REFUSED))
}

/// A bridge fork carries a `fork` object and a title ending ` (fork #N)`.
pub fn is_fork(row: &Value) -> bool {
    if row.get("fork").is_some_and(|f| !f.is_null()) {
        return true;
    }
    row.get("title")
        .and_then(Value::as_str)
        .and_then(|t| t.strip_suffix(')'))
        .and_then(|t| t.rsplit_once(" (fork #"))
        .is_some_and(|(_, n)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// Rows per `GET /api/session` page. The service default is 50 (newest-updated first).
pub const LIST_PAGE: usize = 100;
/// Hard cap on listed rows: at most `LIST_CAP / LIST_PAGE` = 20 list calls.
pub const LIST_CAP: usize = 2000;
/// Hard cap on active ids looked up one by one because no listed page held them.
pub const ACTIVE_LOOKUP_CAP: usize = 50;

/// Bounded API calls: `GET /api/session?limit=100` pages (following `cursor.next`) until a
/// page ends with a row older than the recency window by `time.updated` (the list order), the
/// cursor ends, or 2000 rows were read (at most 20 calls); then `GET /api/session/active`; then
/// `GET /api/session/{id}` for each active id no page held (at most 50). Every row, listed or
/// looked up, passes the same top-level, fork and recency filters.
pub async fn discover_opencode(
    api: &impl OcApi,
    data_dir: &Path,
    now_ms: i64,
    recent_hours: u64,
) -> Result<Vec<OpenCodeEndpoint>> {
    let window = i64::try_from(recent_hours)
        .unwrap_or(i64::MAX)
        .saturating_mul(3_600_000);
    let updated = |row: &Value| {
        row.pointer("/time/updated")
            .and_then(Value::as_i64)
            .unwrap_or(0)
    };
    let mut rows: Vec<Value> = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let path = match &cursor {
            None => format!("/api/session?limit={LIST_PAGE}"),
            Some(c) => format!("/api/session?limit={LIST_PAGE}&cursor={c}"),
        };
        let mut list = api.call("GET", &path, None).await?;
        let page = match list.get_mut("data").map(Value::take) {
            Some(Value::Array(a)) => a,
            _ => return Err(anyhow!("OpenCode session list has no data array")),
        };
        let past_window = page
            .last()
            .is_none_or(|r| now_ms.saturating_sub(updated(r)) > window);
        let full = page.len() >= LIST_PAGE;
        rows.extend(page);
        cursor = list
            .pointer("/cursor/next")
            .and_then(Value::as_str)
            // A cursor is base64url; anything else is not passed into a path.
            .filter(|c| {
                !c.is_empty()
                    && c.chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || "-_=".contains(ch))
            })
            .map(str::to_owned);
        if past_window || !full || cursor.is_none() || rows.len() >= LIST_CAP {
            break;
        }
    }
    let active = api.call("GET", "/api/session/active", None).await?;
    let active: HashSet<String> = active
        .get("data")
        .and_then(Value::as_object)
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    let seen: HashSet<String> = rows
        .iter()
        .filter_map(|r| r.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let mut missing: Vec<&String> = active
        .iter()
        .filter(|id| is_session_id(id) && !seen.contains(*id))
        .collect();
    missing.sort();
    for id in missing.into_iter().take(ACTIVE_LOOKUP_CAP) {
        // A vanished or unreadable active session is skipped, not a discovery failure.
        if let Ok(row) = api.call("GET", &format!("/api/session/{id}"), None).await {
            let row = row.get("data").cloned().unwrap_or(row);
            if row.get("id").and_then(Value::as_str) == Some(id.as_str()) {
                rows.push(row);
            }
        }
    }
    let mut out = Vec::new();
    let mut pushed = HashSet::new();
    for row in &rows {
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
        if !pushed.insert(id.to_owned()) {
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
