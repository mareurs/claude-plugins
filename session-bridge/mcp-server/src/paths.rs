//! State-root and profile naming helpers.

use std::path::{Path, PathBuf};

/// `$XDG_STATE_HOME/session-bridge` when `XDG_STATE_HOME` is set and absolute,
/// else `$HOME/.local/state/session-bridge`; `None` when that is not an absolute path
/// (`HOME` empty, unset or relative): a relative root would put the state inside whatever
/// directory the process runs in, a repository maybe.
pub fn state_root(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    if let Some(x) = env("XDG_STATE_HOME") {
        if Path::new(&x).is_absolute() {
            return Some(PathBuf::from(x).join("session-bridge"));
        }
    }
    let root = PathBuf::from(env("HOME").unwrap_or_default()).join(".local/state/session-bridge");
    root.is_absolute().then_some(root)
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
/// True when `s` can be used as part of a file name: 1 to 128 bytes of `[A-Za-z0-9._-]`,
/// not `.` or `..`, and no `..` inside. A session id from hook input is untrusted and
/// becomes a file name, so every path built from one goes through this check.
pub fn is_safe_component(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s != "."
        && s != ".."
        && !s.contains("..")
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}
