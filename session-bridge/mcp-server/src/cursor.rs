//! Delivery cursors: how far into the notice log one session has been told.
//!
//! One JSON file per (profile, session id) in `<state>/cursors/`, naming the pid that last
//! used it. A same-profile twin (two live processes on one session id, e.g. two `--resume`
//! of the same id) gets its own file `<profile>__<session>__<pid>.json`, so neither steals
//! the other's position. `dir` is always the state root, never the `cursors/` directory.
//!
//! Addressed notices have their own cursor, `<profile>__<session>.direct`, with no pid and no
//! twins: see `get_direct` and `set_direct`.

use crate::error::Result;
use crate::paths::is_safe_component;
use crate::state::{endpoint_path, load_or_default};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Which of the four SessionStart rules chose the cursor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartRule {
    /// Rule 1: the cursor of this (profile, session id), nobody else alive holds it.
    TakeOver,
    /// Rule 2: a live same-profile pid holds it; this pid gets its own copy.
    CopyFromTwin,
    /// Rule 3: `/clear`, same pid and a new id; the old id's cursor moved to the new id.
    MoveAfterClear,
    /// Rule 4: nothing to continue from; the cursor starts at the head.
    Fresh,
}

#[derive(Serialize, Deserialize)]
struct CursorFile {
    schema: u32,
    /// The pid that last used this cursor.
    pid: u32,
    cursor: i64,
}

fn unsafe_component(what: &str, value: &str) -> crate::error::BridgeError {
    std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        format!("unsafe {what}: {value:?}"),
    )
    .into()
}

fn checked(profile: &str, session_id: &str) -> Result<()> {
    if !is_safe_component(profile) {
        return Err(unsafe_component("profile", profile));
    }
    if !is_safe_component(session_id) {
        return Err(unsafe_component("session id", session_id));
    }
    Ok(())
}

fn plain_path(dir: &Path, profile: &str, session_id: &str) -> PathBuf {
    dir.join("cursors")
        .join(format!("{profile}__{session_id}.json"))
}

fn twin_path(dir: &Path, profile: &str, session_id: &str, pid: u32) -> PathBuf {
    dir.join("cursors")
        .join(format!("{profile}__{session_id}__{pid}.json"))
}

fn read(path: &Path) -> Option<CursorFile> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write(path: &Path, pid: u32, cursor: i64) -> Result<()> {
    write_atomic(
        path,
        &serde_json::to_vec(&CursorFile {
            schema: 1,
            pid,
            cursor,
        })?,
    )
}

/// Writes `bytes` to `path` through a temporary file in the same directory: the file is
/// synced, then renamed over `path`, so a reader never sees a half-written cursor.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut tmp_name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    tmp_name.push(format!(".{}.tmp", std::process::id()));
    let tmp = path.with_file_name(tmp_name);
    let written = (|| -> Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

/// The cursor of (`profile`, `session_id`) as seen by `pid`: its twin file first, else the
/// plain file. `None` when neither exists or a component is unsafe.
pub fn get(dir: &Path, profile: &str, session_id: &str, pid: u32) -> Option<i64> {
    checked(profile, session_id).ok()?;
    read(&twin_path(dir, profile, session_id, pid))
        .or_else(|| read(&plain_path(dir, profile, session_id)))
        .map(|c| c.cursor)
}

/// Set the cursor of (`profile`, `session_id`) for `pid`: into its twin file when it has
/// one, else into the plain file (which then records `pid` as its last user).
pub fn set(dir: &Path, profile: &str, session_id: &str, pid: u32, cursor: i64) -> Result<()> {
    checked(profile, session_id)?;
    let twin = twin_path(dir, profile, session_id, pid);
    if twin.exists() {
        write(&twin, pid, cursor)
    } else {
        write(&plain_path(dir, profile, session_id), pid, cursor)
    }
}
/// `<state>/cursors/<profile>__<session id>.direct`: how far into the addressed notices of one
/// session id its sessions have been told. It holds one decimal integer and has no pid: every
/// process on that id shares it, and the start rules of `on_session_start` never touch it.
fn direct_path(dir: &Path, profile: &str, session_id: &str) -> PathBuf {
    dir.join("cursors")
        .join(format!("{profile}__{session_id}.direct"))
}

/// The direct cursor of (`profile`, `session_id`): 0 when it is missing, unreadable or the
/// components are unsafe.
pub fn get_direct(dir: &Path, profile: &str, session_id: &str) -> i64 {
    if checked(profile, session_id).is_err() {
        return 0;
    }
    std::fs::read_to_string(direct_path(dir, profile, session_id))
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// Moves the direct cursor to `value`, never backward: it stores the larger of the old value and
/// `value`. Refuses unsafe components before it builds a path.
pub fn set_direct(dir: &Path, profile: &str, session_id: &str, value: i64) -> Result<()> {
    checked(profile, session_id)?;
    let value = value.max(get_direct(dir, profile, session_id));
    write_atomic(
        &direct_path(dir, profile, session_id),
        value.to_string().as_bytes(),
    )
}

/// Pick and record the cursor for a session that starts in endpoint (`profile`, `pid`),
/// by the four rules in the spec (section 5), in order. `dir` is the state root;
/// `alive` says whether a pid is a live process; `head` is the store's head.
/// Returns the rule that applied and the cursor value.
pub fn on_session_start(
    dir: &Path,
    profile: &str,
    pid: u32,
    session_id: &str,
    alive: &dyn Fn(u32) -> bool,
    head: i64,
) -> Result<(StartRule, i64)> {
    checked(profile, session_id)?;
    let plain = plain_path(dir, profile, session_id);
    let twin = twin_path(dir, profile, session_id, pid);
    if let Some(held) = read(&plain) {
        if held.pid == pid || !alive(held.pid) {
            // Rule 1. This pid's own twin file (it was a twin of a holder that has since
            // died) is newer than the plain file: its value wins, and it folds back.
            let value = read(&twin).map_or(held.cursor, |t| t.cursor);
            write(&plain, pid, value)?;
            let _ = std::fs::remove_file(&twin);
            return Ok((StartRule::TakeOver, value));
        }
        // Rule 2. A twin file of this very pid (a compact in the same process) is newer
        // than the original, so it wins over a fresh copy.
        let value = read(&twin).map_or(held.cursor, |t| t.cursor);
        write(&twin, pid, value)?;
        return Ok((StartRule::CopyFromTwin, value));
    }
    // Rule 3: this pid's endpoint state remembers an earlier id that this pid still holds.
    let prev = load_or_default(&endpoint_path(dir, profile, pid)).session_id;
    if prev != session_id && is_safe_component(&prev) {
        let prev_twin = twin_path(dir, profile, &prev, pid);
        let prev_plain = plain_path(dir, profile, &prev);
        let held = read(&prev_twin).map(|c| (c, prev_twin)).or_else(|| {
            read(&prev_plain)
                .filter(|c| c.pid == pid)
                .map(|c| (c, prev_plain))
        });
        if let Some((c, old_path)) = held {
            write(&plain, pid, c.cursor)?;
            let _ = std::fs::remove_file(old_path);
            return Ok((StartRule::MoveAfterClear, c.cursor));
        }
    }
    // Rule 4.
    write(&plain, pid, head)?;
    Ok((StartRule::Fresh, head))
}
