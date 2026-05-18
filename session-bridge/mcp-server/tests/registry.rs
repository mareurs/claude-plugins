use session_bridge_mcp::registry::{Registry, SessionEntry};

#[test]
fn loads_minimal_registry_from_json() {
    let json = r#"{
      "version": 1,
      "sessions": {
        "id-a": {
          "session_id": "id-a",
          "transcript_path": "/tmp/a.jsonl",
          "cwd": "/tmp/a",
          "branch": "main",
          "pid": 1,
          "started_at": 1000,
          "alias": null,
          "instance": "main"
        }
      }
    }"#;
    let reg: Registry = serde_json::from_str(json).unwrap();
    assert_eq!(reg.version, 1);
    assert_eq!(reg.sessions.len(), 1);
    let e: &SessionEntry = reg.sessions.get("id-a").unwrap();
    assert_eq!(e.session_id, "id-a");
    assert_eq!(e.cwd, "/tmp/a");
    assert_eq!(e.pid, 1);
    assert_eq!(e.alias, None);
}

#[test]
fn empty_registry_round_trips() {
    let reg = Registry::default();
    let s = serde_json::to_string(&reg).unwrap();
    let back: Registry = serde_json::from_str(&s).unwrap();
    assert_eq!(back.version, 1);
    assert!(back.sessions.is_empty());
}

use session_bridge_mcp::registry::prune_with;
use std::collections::BTreeMap;

fn entry(id: &str, pid: i32) -> SessionEntry {
    SessionEntry {
        session_id: id.into(),
        transcript_path: format!("/tmp/{}.jsonl", id),
        cwd: "/tmp".into(),
        branch: "main".into(),
        pid,
        started_at: 0,
        alias: None,
        instance: "main".into(),
    }
}

#[test]
fn prune_removes_dead_pids_only() {
    let mut sessions = BTreeMap::new();
    sessions.insert("a".into(), entry("a", 1));
    sessions.insert("b".into(), entry("b", 2));
    sessions.insert("c".into(), entry("c", 3));
    let mut reg = Registry { version: 1, sessions };

    let pruned = prune_with(&mut reg, |pid| pid != 2);
    assert_eq!(pruned, vec!["b".to_string()]);
    assert_eq!(reg.sessions.len(), 2);
    assert!(reg.sessions.contains_key("a"));
    assert!(reg.sessions.contains_key("c"));
}

#[test]
fn prune_noop_when_all_alive() {
    let mut sessions = BTreeMap::new();
    sessions.insert("a".into(), entry("a", 1));
    let mut reg = Registry { version: 1, sessions };
    let pruned = prune_with(&mut reg, |_| true);
    assert!(pruned.is_empty());
    assert_eq!(reg.sessions.len(), 1);
}

use session_bridge_mcp::registry::resolve_ref;
use session_bridge_mcp::error::BridgeError;

fn fixture() -> Registry {
    let mut sessions = BTreeMap::new();
    let mut a = entry("abc-123", 1);
    a.cwd = "/home/u/work/foo".into();
    a.alias = Some("foo-session".into());
    let mut b = entry("def-456", 2);
    b.cwd = "/home/u/work/bar".into();
    sessions.insert("abc-123".into(), a);
    sessions.insert("def-456".into(), b);
    Registry { version: 1, sessions }
}

#[test]
fn resolve_by_full_id() {
    let reg = fixture();
    let e = resolve_ref(&reg, "abc-123").unwrap();
    assert_eq!(e.session_id, "abc-123");
}

#[test]
fn resolve_by_id_prefix() {
    let reg = fixture();
    let e = resolve_ref(&reg, "def").unwrap();
    assert_eq!(e.session_id, "def-456");
}

#[test]
fn resolve_by_alias() {
    let reg = fixture();
    let e = resolve_ref(&reg, "foo-session").unwrap();
    assert_eq!(e.session_id, "abc-123");
}

#[test]
fn resolve_by_cwd_substring() {
    let reg = fixture();
    let e = resolve_ref(&reg, "work/bar").unwrap();
    assert_eq!(e.session_id, "def-456");
}

#[test]
fn resolve_not_found() {
    let reg = fixture();
    let err = resolve_ref(&reg, "nope").unwrap_err();
    assert!(matches!(err, BridgeError::SessionNotFound(_, _)));
}

#[test]
fn resolve_ambiguous() {
    let reg = fixture();
    let err = resolve_ref(&reg, "work").unwrap_err();
    assert!(matches!(err, BridgeError::AmbiguousRef(_, _)));
}

#[test]
fn resolve_full_id_wins_over_substring() {
    let reg = fixture();
    let e = resolve_ref(&reg, "abc-123").unwrap();
    assert_eq!(e.session_id, "abc-123");
}

use session_bridge_mcp::registry::set_alias_in;

#[test]
fn set_alias_updates_existing_entry() {
    let mut reg = fixture();
    set_alias_in(&mut reg, "abc-123", Some("renamed".into())).unwrap();
    assert_eq!(reg.sessions["abc-123"].alias.as_deref(), Some("renamed"));
}

#[test]
fn set_alias_clears_when_none() {
    let mut reg = fixture();
    set_alias_in(&mut reg, "abc-123", None).unwrap();
    assert_eq!(reg.sessions["abc-123"].alias, None);
}

#[test]
fn set_alias_errors_on_unknown_session() {
    let mut reg = fixture();
    let err = set_alias_in(&mut reg, "missing", Some("x".into())).unwrap_err();
    assert!(matches!(err, BridgeError::SessionNotFound(_, _)));
}
