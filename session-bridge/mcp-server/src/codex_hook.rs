//! Codex hook normalization into the shared notice channel.
use crate::{
    codex::{is_thread_id, CodexEndpoint},
    endpoints::Roots,
    hook::{emit, on_trigger, session_start, HookInput},
    store::Store,
};
use std::path::Path;
pub fn normalize(raw: &str) -> Option<HookInput> {
    let mut value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let thread = value
        .get("thread_id")
        .or_else(|| value.get("threadId"))
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    if let Some(thread) = thread {
        if value
            .get("session_id")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s != thread)
        {
            return None;
        }
        value["session_id"] = thread.into();
    }
    let input: HookInput = serde_json::from_value(value).ok()?;
    if !is_thread_id(&input.session_id) || input.agent_id.is_some() {
        return None;
    }
    Some(input)
}
#[allow(clippy::too_many_arguments)]
pub fn handle(
    event: &str,
    input: &HookInput,
    target: &CodexEndpoint,
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
    normalized.transcript_path = Some(target.transcript_path.to_string_lossy().into_owned());
    if normalized.cwd.is_empty() {
        normalized.cwd = target.cwd.as_ref()?.to_string_lossy().into_owned();
    }
    if !Path::new(&normalized.cwd).is_absolute() {
        return None;
    }
    let profile = target.storage_profile();
    let (host_event, text) = match event {
        "session-start" => (
            "SessionStart",
            session_start(&normalized, (&profile, 0), roots, state, store)?,
        ),
        "prompt" => (
            "UserPromptSubmit",
            on_trigger(&normalized, (&profile, 0), roots, state, store, now, spawn)?,
        ),
        "post-tool" => (
            "PostToolUse",
            on_trigger(&normalized, (&profile, 0), roots, state, store, now, spawn)?,
        ),
        _ => return None,
    };
    Some(emit(host_event, &text))
}
pub fn spawn_filter(profile: &str, _pid: u32) -> Option<u32> {
    crate::hook::spawn_detached(
        &std::env::current_exe().ok()?,
        &["codex-filter", "--profile", profile],
    )
}
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
    let input = normalize(raw)?;
    let home = std::env::var("CODEX_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| Path::new(&h).join(".codex"))
        })?;
    let home = std::fs::canonicalize(home).ok()?;
    let found: Vec<_> = crate::codex::discover_codex(roots)
        .into_iter()
        .filter(|e| e.session_id == input.session_id && e.config_dir == home)
        .collect();
    let [target] = found.as_slice() else {
        return None;
    };
    handle(
        event,
        &input,
        target,
        roots,
        state,
        store,
        crate::hook::now_ms(),
        &spawn_filter,
    )
}
