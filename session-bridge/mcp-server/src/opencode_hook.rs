//! OpenCode plugin hook into the shared notice channel. The plugin calls
//! `session-bridge hook <event> --harness opencode` with `{session_id, cwd}` on stdin and
//! injects whatever PLAIN TEXT is printed. Only a live top-level session gets notices:
//! discovery lists no child and no fork, so those resolve to nothing.
use crate::{
    endpoints::Roots,
    hook::{on_trigger, session_start, HookInput},
    opencode::{is_session_id, OpenCodeEndpoint},
    store::Store,
};
use std::path::Path;

/// Why OpenCode notices are delivered without a relevance verdict from a model.
pub const UNFILTERED_REASON: &str = "OpenCode receiver: no isolated relevance filter";

/// The plugin payload, or `None` for anything that is not a plain top-level session call.
pub fn normalize(raw: &str) -> Option<HookInput> {
    let input: HookInput = serde_json::from_str(raw).ok()?;
    if !is_session_id(&input.session_id) || input.agent_id.is_some() {
        return None;
    }
    Some(input)
}

#[allow(clippy::too_many_arguments)]
pub fn handle(
    event: &str,
    input: &HookInput,
    target: &OpenCodeEndpoint,
    roots: &Roots,
    state: &Path,
    store: &Store,
    now: i64,
    spawn: &dyn Fn(&str, u32) -> Option<u32>,
) -> Option<String> {
    if input.agent_id.is_some() || input.session_id != target.session_id {
        return None;
    }
    let mut normalized = input.clone();
    if normalized.cwd.is_empty() {
        normalized.cwd = target.directory.as_ref()?.to_string_lossy().into_owned();
    }
    if !Path::new(&normalized.cwd).is_absolute() {
        return None;
    }
    let profile = target.storage_profile();
    match event {
        "session-start" => session_start(&normalized, (&profile, 0), roots, state, store),
        "prompt" | "post-tool" => {
            on_trigger(&normalized, (&profile, 0), roots, state, store, now, spawn)
        }
        _ => None,
    }
}

/// Launch the detached `opencode-filter` for `profile`. The hook cannot settle verdicts
/// itself: it runs inside the endpoint's locked state update.
pub fn spawn_filter(profile: &str, _pid: u32) -> Option<u32> {
    crate::hook::spawn_detached(
        &std::env::current_exe().ok()?,
        &["opencode-filter", "--profile", profile],
    )
}
/// What the detached `opencode-filter` does: turn every pending notice of `profile` into a
/// relevant verdict carrying `UNFILTERED_REASON`, then clear `worker_pid`. `drain_unfiltered`
/// settles one batch per locked update, so loop until `pending` is empty.
pub fn settle_pending(state: &Path, profile: &str) {
    let path = crate::state::endpoint_path(state, profile, 0);
    for _ in 0..1000 {
        if crate::state::read_locked(&path).pending.is_empty() {
            break;
        }
        crate::filter::drain_unfiltered(state, profile, 0, UNFILTERED_REASON);
    }
    crate::filter::clear_worker_pid(state, profile, 0);
}

/// Resolve the payload against `endpoints` (live top-level sessions) and handle it.
#[allow(clippy::too_many_arguments)]
pub fn output_for(
    raw: &str,
    event: &str,
    endpoints: &[OpenCodeEndpoint],
    roots: &Roots,
    state: &Path,
    store: &Store,
    now: i64,
    spawn: &dyn Fn(&str, u32) -> Option<u32>,
) -> Option<String> {
    let input = normalize(raw)?;
    let target = endpoints
        .iter()
        .find(|e| e.session_id == input.session_id)?;
    handle(event, &input, target, roots, state, store, now, spawn)
}

/// The real entry point: discover through the OpenCode service, then `output_for`.
pub fn output(
    raw: &str,
    event: &str,
    roots: &Roots,
    state: &Path,
    store: &Store,
) -> Option<String> {
    if std::env::var("SESSION_BRIDGE_CHILD").ok().as_deref() == Some("1") {
        return None;
    }
    normalize(raw)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .ok()?;
    let endpoints = rt
        .block_on(crate::opencode::discover_opencode_system(&|k| {
            std::env::var(k).ok()
        }))
        .ok()?;
    output_for(
        raw,
        event,
        &endpoints,
        roots,
        state,
        store,
        crate::hook::now_ms(),
        &spawn_filter,
    )
}
