//! Wake of an idle session by an addressed notice: opt-in marker and loop guard.

use crate::cursor::get_direct;
use crate::diag;
use crate::direct::take;
use crate::endpoints::{pid_alive, Roots};
use crate::hook::HookInput;
use crate::paths::is_safe_component;
use crate::state::{endpoint_path, load_or_default, update};
use crate::store::Store;
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
        None => match env(crate::paths::HOME_VAR).filter(|v| !v.is_empty()) {
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

/// Take the single watcher slot of the endpoint at `path` for `own_pid`: the newest arm wins.
/// The claim records the pid and `watch_until_ms = now_ms + DEADLINE_MS`, replacing any older
/// claim; the older watcher sees a foreign `watcher_pid` on its next pass and exits `Done`
/// without touching the newer claim. False only when the state file cannot be written.
pub fn claim_watcher(path: &Path, own_pid: u32, now_ms: i64) -> bool {
    update(path, |s| {
        s.watcher_pid = Some(own_pid);
        s.watch_until_ms = now_ms + DEADLINE_MS;
    })
    .is_ok()
}

/// Give up the watcher slot, only when `own_pid` holds it.
pub fn release_watcher(path: &Path, own_pid: u32) {
    let _ = update(path, |s| {
        if s.watcher_pid == Some(own_pid) {
            s.watcher_pid = None;
            s.watch_until_ms = 0;
        }
    });
}

/// What one armed watcher ends with.
#[derive(Debug, PartialEq, Eq)]
pub enum WatchOutcome {
    /// The text of the notices to hand to the idle session.
    Wake(String),
    /// Nothing to deliver: the deadline passed, the host is gone, the marker is gone or a newer
    /// watcher took the slot.
    Done,
}

/// Time source of the watch loop, so tests run without real sleeps.
pub struct Clock<'a> {
    pub now_ms: &'a dyn Fn() -> i64,
    pub sleep_ms: &'a dyn Fn(u64),
}

/// Watch for a notice addressed to this session and take it when one arrives.
///
/// `me.1` is the Claude pid of the host. The watcher takes the endpoint's watcher slot with its
/// own pid (the newest arm wins), then polls every `POLL_MS` through `clock.sleep_ms`. Every
/// pass checks, in order: the host is alive, `enabled()` still holds (the marker file exists),
/// this watcher still owns the claim, the claim deadline has not passed, then whether a notice
/// is pending for the input session id or the id the endpoint state still names (after
/// `/clear`). The pending check only peeks. While the loop guard holds, the notice is not taken
/// and the watcher keeps polling, so `on_trigger` can still deliver it at the next prompt or
/// tool call; `direct::take` moves the cursor once the guard allows, and that take is the wake.
/// The claim is released on every return path. A subagent or an unsafe id ends at once with
/// `Done`.
pub fn watch(
    input: &HookInput,
    me: (&str, u32),
    roots: &Roots,
    state: &Path,
    store: &Store,
    clock: &Clock,
    enabled: &dyn Fn() -> bool,
) -> WatchOutcome {
    if input.agent_id.is_some() || !is_safe_component(&input.session_id) || !is_safe_component(me.0)
    {
        return WatchOutcome::Done;
    }
    let path = endpoint_path(state, me.0, me.1);
    let own = std::process::id();
    if !claim_watcher(&path, own, (clock.now_ms)()) {
        return WatchOutcome::Done;
    }
    let out = watch_loop(input, me, roots, state, store, clock, enabled, &path, own);
    release_watcher(&path, own);
    out
}

/// The poll loop of `watch`; the pass order and the guard rule are described there.
#[allow(clippy::too_many_arguments)]
fn watch_loop(
    input: &HookInput,
    me: (&str, u32),
    roots: &Roots,
    state: &Path,
    store: &Store,
    clock: &Clock,
    enabled: &dyn Fn() -> bool,
    path: &Path,
    own: u32,
) -> WatchOutcome {
    loop {
        if !pid_alive(roots, me.1) || !enabled() {
            return WatchOutcome::Done;
        }
        let st = load_or_default(path);
        if st.watcher_pid != Some(own) {
            return WatchOutcome::Done;
        }
        let now = (clock.now_ms)();
        if now >= st.watch_until_ms {
            return WatchOutcome::Done;
        }
        let mut ids = vec![input.session_id.as_str()];
        if !st.session_id.is_empty() && st.session_id != input.session_id {
            ids.push(st.session_id.as_str());
        }
        let pending = ids.iter().any(|id| {
            is_safe_component(id)
                && store
                    .direct_after(id, get_direct(state, me.0, id), 1)
                    .map(|v| !v.is_empty())
                    .unwrap_or(false)
        });
        if pending && guard_allows(&st.wake_ms, now) {
            if let Some(text) = take(&ids, me, roots, state, store) {
                if let Err(e) = update(path, |s| {
                    s.wake_ms.retain(|&w| now - w <= HOUR_MS);
                    s.wake_ms.push(now);
                }) {
                    diag::note(&format!("wake: record wake time: {e}"));
                }
                return WatchOutcome::Wake(text);
            }
        }
        (clock.sleep_ms)(POLL_MS);
    }
}
