use session_bridge_mcp::wake::{guard_allows, wake_enabled};
use std::collections::HashMap;
use tempfile::TempDir;

fn env_of(pairs: Vec<(&'static str, String)>) -> impl Fn(&str) -> Option<String> {
    let m: HashMap<&'static str, String> = pairs.into_iter().collect();
    move |k: &str| m.get(k).cloned()
}

#[test]
fn marker_file_enables_wake() {
    let d = TempDir::new().unwrap();
    let env = env_of(vec![(
        "CLAUDE_CONFIG_DIR",
        d.path().to_string_lossy().into(),
    )]);
    assert!(!wake_enabled(&env));
    std::fs::write(d.path().join("session-bridge-wake"), "").unwrap();
    assert!(wake_enabled(&env));
}

#[test]
fn config_dir_falls_back_to_home_dot_claude() {
    let d = TempDir::new().unwrap();
    let env = env_of(vec![("HOME", d.path().to_string_lossy().into())]);
    assert!(!wake_enabled(&env));
    std::fs::create_dir_all(d.path().join(".claude")).unwrap();
    std::fs::write(d.path().join(".claude/session-bridge-wake"), "").unwrap();
    assert!(wake_enabled(&env));
}

#[test]
fn guard_allows_first_wake_and_blocks_within_60s() {
    assert!(guard_allows(&[], 1_000_000));
    assert!(!guard_allows(&[1_000_000], 1_059_999));
    assert!(guard_allows(&[1_000_000], 1_060_000));
}

#[test]
fn guard_blocks_the_eleventh_wake_in_an_hour() {
    let start = 10_000_000i64;
    let wakes: Vec<i64> = (0..10).map(|i| start + i * 61_000).collect();
    let t = *wakes.last().unwrap();
    assert!(!guard_allows(&wakes, t + 61_000));
    // oldest wake is over an hour old
    assert!(guard_allows(&wakes, start + 3_600_001));
}
