//! State-root and profile naming helpers.

use std::path::{Path, PathBuf};

/// `$XDG_STATE_HOME/session-bridge` when `XDG_STATE_HOME` is set and absolute,
/// else `$HOME/.local/state/session-bridge`.
pub fn state_root(env: &dyn Fn(&str) -> Option<String>) -> PathBuf {
    if let Some(x) = env("XDG_STATE_HOME") {
        if Path::new(&x).is_absolute() {
            return PathBuf::from(x).join("session-bridge");
        }
    }
    let home = env("HOME").unwrap_or_default();
    PathBuf::from(home).join(".local/state/session-bridge")
}

/// Basename of the config dir; `.claude` when unset or empty.
pub fn profile_of(config_dir: Option<&str>) -> String {
    config_dir
        .filter(|s| !s.is_empty())
        .and_then(|s| Path::new(s).file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".claude".to_string())
}

/// `.claude` -> `main`, `.claude-<x>` -> `<x>`; anything else is returned as is.
pub fn short_profile(profile: &str) -> String {
    if profile == ".claude" {
        return "main".to_string();
    }
    match profile.strip_prefix(".claude-") {
        Some(rest) if !rest.is_empty() => rest.to_string(),
        _ => profile.to_string(),
    }
}

/// True when `query` names `profile` in either its full or its short form.
pub fn profile_matches(profile: &str, query: &str) -> bool {
    query == profile || query == short_profile(profile)
}
