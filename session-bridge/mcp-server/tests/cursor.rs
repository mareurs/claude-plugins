use session_bridge_mcp::cursor::{get, on_session_start, set, StartRule};
use session_bridge_mcp::paths::is_safe_component;
use session_bridge_mcp::state::{endpoint_path, update};
use tempfile::TempDir;

const STEF: &str = ".claude-stef";

#[test]
fn resume_takes_over_when_the_holder_is_dead() {
    let d = TempDir::new().unwrap();
    set(d.path(), STEF, "S", 10, 5).unwrap();
    let (rule, v) = on_session_start(d.path(), STEF, 20, "S", &|_| false, 99).unwrap();
    assert_eq!((rule, v), (StartRule::TakeOver, 5));
    assert_eq!(get(d.path(), STEF, "S", 20), Some(5));
    // The file now records pid 20: while 20 is alive, pid 30 is a twin of it.
    let (rule, v) = on_session_start(d.path(), STEF, 30, "S", &|p| p == 20, 99).unwrap();
    assert_eq!((rule, v), (StartRule::CopyFromTwin, 5));
}

#[test]
fn same_profile_twin_copies() {
    let d = TempDir::new().unwrap();
    set(d.path(), STEF, "S", 10, 5).unwrap();
    let (rule, v) = on_session_start(d.path(), STEF, 20, "S", &|p| p == 10, 99).unwrap();
    assert_eq!((rule, v), (StartRule::CopyFromTwin, 5));
    // The twin advances on its own; the original stays.
    set(d.path(), STEF, "S", 20, 8).unwrap();
    assert_eq!(get(d.path(), STEF, "S", 20), Some(8));
    assert_eq!(get(d.path(), STEF, "S", 10), Some(5));
    // The same pid starting again (compact) keeps its own twin value, not the original's.
    let (rule, v) = on_session_start(d.path(), STEF, 20, "S", &|p| p == 10, 99).unwrap();
    assert_eq!((rule, v), (StartRule::CopyFromTwin, 8));
}

#[test]
fn clear_moves_the_cursor_to_the_new_id() {
    let d = TempDir::new().unwrap();
    update(&endpoint_path(d.path(), STEF, 20), |s| s.session_id = "S".into()).unwrap();
    set(d.path(), STEF, "S", 20, 7).unwrap();
    let (rule, v) = on_session_start(d.path(), STEF, 20, "S2", &|_| true, 99).unwrap();
    assert_eq!((rule, v), (StartRule::MoveAfterClear, 7));
    assert_eq!(get(d.path(), STEF, "S2", 20), Some(7));
    assert_eq!(get(d.path(), STEF, "S", 20), None, "the old id's cursor is gone");
}

#[test]
fn clear_does_not_steal_a_cursor_held_by_another_live_pid() {
    let d = TempDir::new().unwrap();
    update(&endpoint_path(d.path(), STEF, 20), |s| s.session_id = "S".into()).unwrap();
    set(d.path(), STEF, "S", 10, 7).unwrap(); // held by pid 10, not by 20
    let (rule, v) = on_session_start(d.path(), STEF, 20, "S2", &|_| true, 99).unwrap();
    assert_eq!((rule, v), (StartRule::Fresh, 99));
    assert_eq!(get(d.path(), STEF, "S", 10), Some(7), "pid 10's cursor is untouched");
}

#[test]
fn fresh_starts_at_head() {
    let d = TempDir::new().unwrap();
    let (rule, v) = on_session_start(d.path(), STEF, 20, "S", &|_| true, 42).unwrap();
    assert_eq!((rule, v), (StartRule::Fresh, 42));
    assert_eq!(get(d.path(), STEF, "S", 20), Some(42));
}
fn files_for(d: &std::path::Path, session: &str) -> Vec<String> {
    let prefix = format!("{STEF}__{session}");
    let mut v: Vec<String> = std::fs::read_dir(d.join("cursors"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(&prefix))
        .collect();
    v.sort();
    v
}

#[test]
fn take_over_after_the_holder_dies_uses_this_pids_own_twin_value() {
    let d = TempDir::new().unwrap();
    set(d.path(), STEF, "S", 10, 5).unwrap();
    let (rule, v) = on_session_start(d.path(), STEF, 20, "S", &|p| p == 10, 99).unwrap();
    assert_eq!((rule, v), (StartRule::CopyFromTwin, 5));
    set(d.path(), STEF, "S", 20, 8).unwrap();
    // pid 10 dies; pid 20 compacts.
    let (rule, v) = on_session_start(d.path(), STEF, 20, "S", &|_| false, 99).unwrap();
    assert_eq!((rule, v), (StartRule::TakeOver, 8), "the twin is newer than the plain file");
    assert_eq!(get(d.path(), STEF, "S", 20), Some(8));
    assert_eq!(files_for(d.path(), "S").len(), 1, "{:?}", files_for(d.path(), "S"));
    // A new pid resuming while 20 is alive copies 8, so notices 6 to 8 are not repeated.
    let (rule, v) = on_session_start(d.path(), STEF, 30, "S", &|p| p == 20, 99).unwrap();
    assert_eq!((rule, v), (StartRule::CopyFromTwin, 8));
}

#[test]
fn compact_of_the_holder_takes_over() {
    let d = TempDir::new().unwrap();
    set(d.path(), STEF, "S", 10, 5).unwrap();
    let (rule, v) = on_session_start(d.path(), STEF, 10, "S", &|_| true, 99).unwrap();
    assert_eq!((rule, v), (StartRule::TakeOver, 5));
    assert_eq!(files_for(d.path(), "S").len(), 1, "no twin of itself: {:?}", files_for(d.path(), "S"));
}

#[test]
fn other_profile_twin_is_fresh() {
    let d = TempDir::new().unwrap();
    set(d.path(), ".claude-kat", "S", 10, 5).unwrap();
    let (rule, v) = on_session_start(d.path(), STEF, 30, "S", &|_| true, 9).unwrap();
    assert_eq!((rule, v), (StartRule::Fresh, 9));
    assert_eq!(get(d.path(), ".claude-kat", "S", 10), Some(5));
}

#[test]
fn unsafe_profile_or_session_id_never_builds_a_path() {
    let d = TempDir::new().unwrap();
    let root = d.path().join("state");
    for bad in ["../../etc/x", "a/b", "", "..", ".", "a..b", "x y"] {
        assert!(on_session_start(&root, STEF, 20, bad, &|_| false, 1).is_err(), "{bad:?}");
        assert!(set(&root, STEF, bad, 20, 1).is_err(), "{bad:?}");
        assert_eq!(get(&root, STEF, bad, 20), None, "{bad:?}");
        assert!(on_session_start(&root, bad, 20, "S", &|_| false, 1).is_err(), "{bad:?}");
    }
    assert!(!root.exists(), "nothing was created");
}

#[test]
fn is_safe_component_table() {
    for ok in ["S", ".claude-stef", "a1B2_c.d-e", "0123456789abcdef-0123"] {
        assert!(is_safe_component(ok), "{ok:?}");
    }
    for bad in ["", ".", "..", "a/b", "a\\b", "a..b", "a b", "é", "a\0b"] {
        assert!(!is_safe_component(bad), "{bad:?}");
    }
    assert!(is_safe_component(&"a".repeat(128)));
    assert!(!is_safe_component(&"a".repeat(129)));
}
