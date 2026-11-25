//! Wake of an idle session by an addressed notice: opt-in marker and loop guard.

use crate::endpoints::{pid_alive, process_start_ms, Roots};
use crate::state::update;
use std::path::{Path, PathBuf};

/// How often the watcher polls, in milliseconds.
pub const POLL_MS: u64 = 2_000;
/// How long a watcher lives before it gives up, in milliseconds.
pub const DEADLINE_MS: i64 = 7_000_000;
/// Minimum time between two wakes.
pub const GUARD_MIN_INTERVAL_MS: i64 = 60_000;
/// Most wakes allowed within one hour.
pub const GUARD_MAX_PER_HOUR: usize = 10;

const HOUR_MS: i64 = 3_600_000;
const MARKER: &str = "session-bridge-wake";

/// True when the profile opted in: `<config-dir>/session-bridge-wake` is a file.
/// `<config-dir>` is `CLAUDE_CONFIG_DIR`, else `$HOME/.claude`.
pub fn wake_enabled(env: &dyn Fn(&str) -> Option<String>) -> bool {
    let dir = match env("CLAUDE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => match env("HOME").filter(|v| !v.is_empty()) {
            Some(h) => PathBuf::from(h).join(".claude"),
            None => return false,
        },
    };
    dir.join(MARKER).is_file()
}

/// Loop guard: false when the last wake is under a minute old, or when
/// `GUARD_MAX_PER_HOUR` wakes fall within the last hour.
pub fn guard_allows(wake_ms: &[i64], now_ms: i64) -> bool {
    if wake_ms.iter().any(|&w| now_ms - w < GUARD_MIN_INTERVAL_MS) {
        return false;
    }
    wake_ms.iter().filter(|&&w| now_ms - w <= HOUR_MS).count() < GUARD_MAX_PER_HOUR
}

/// Claim the single watcher slot of the endpoint at `path` for `own_pid`. True when no live
/// claim exists: the claim then records the pid, its start time (0 when unreadable) and
/// `watch_until_ms = now_ms + DEADLINE_MS`. False when another live watcher holds it, or on error.
pub fn claim_watcher(path: &Path, roots: &Roots, own_pid: u32, now_ms: i64) -> bool {
    let mut won = false;
    let res = update(path, |s| {
        let live = match s.watcher_pid {
            Some(p) => {
                pid_alive(roots, p)
                    && (s.watcher_started_ms == 0
                        || process_start_ms(roots, p) == Some(s.watcher_started_ms))
            }
            None => false,
        };
        if !live {
            s.watcher_pid = Some(own_pid);
            s.watcher_started_ms = process_start_ms(roots, own_pid).unwrap_or(0);
            s.watch_until_ms = now_ms + DEADLINE_MS;
            won = true;
        }
    });
    res.is_ok() && won
}

/// Give up the watcher slot, only when `own_pid` holds it.
pub fn release_watcher(path: &Path, own_pid: u32) {
    let _ = update(path, |s| {
        if s.watcher_pid == Some(own_pid) {
            s.watcher_pid = None;
            s.watcher_started_ms = 0;
            s.watch_until_ms = 0;
        }
    });
}
