use session_bridge_mcp::paths::{profile_matches, profile_of, short_profile, state_root};
use session_bridge_mcp::server::state_dir;
use std::collections::HashMap;
use std::path::PathBuf;

fn env_of<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
    let map: HashMap<&str, &str> = pairs.iter().copied().collect();
    move |k| map.get(k).map(|v| v.to_string())
}

#[test]
fn state_root_uses_absolute_xdg_state_home() {
    let env = env_of(&[("XDG_STATE_HOME", "/x/state"), ("HOME", "/h")]);
    assert_eq!(
        state_root(&env),
        Some(PathBuf::from("/x/state/session-bridge"))
    );
}

#[test]
fn state_root_ignores_relative_xdg_state_home() {
    let env = env_of(&[("XDG_STATE_HOME", "rel"), ("HOME", "/h")]);
    assert_eq!(
        state_root(&env),
        Some(PathBuf::from("/h/.local/state/session-bridge"))
    );
}

#[test]
fn state_root_is_none_when_the_result_is_not_absolute() {
    for pairs in [
        vec![("HOME", "")],
        vec![],
        vec![("HOME", ""), ("XDG_STATE_HOME", "rel")],
        vec![("HOME", "rel/home")],
        vec![("XDG_STATE_HOME", "")],
    ] {
        let env = env_of(&pairs);
        assert_eq!(state_root(&env), None, "{pairs:?}");
    }
}

#[test]
fn a_tool_without_a_state_dir_gets_a_clear_error() {
    let env = env_of(&[("HOME", "")]);
    let err = state_dir(&env).unwrap_err();
    assert_eq!(
        err.to_string(),
        "state directory not available: set HOME or XDG_STATE_HOME"
    );
    let env = env_of(&[("HOME", "/h")]);
    assert_eq!(
        state_dir(&env).unwrap(),
        PathBuf::from("/h/.local/state/session-bridge")
    );
}

#[test]
fn profile_defaults_to_dot_claude() {
    assert_eq!(profile_of(None), ".claude");
    assert_eq!(profile_of(Some("/home/u/.claude-stef")), ".claude-stef");
}

#[test]
fn short_profile_maps_main_and_suffix() {
    assert_eq!(short_profile(".claude"), "main");
    assert_eq!(short_profile(".claude-kat"), "kat");
}

#[test]
fn profile_matches_either_form() {
    assert!(profile_matches(".claude-stef", "stef"));
    assert!(profile_matches(".claude-stef", ".claude-stef"));
    assert!(!profile_matches(".claude", "stef"));
}
