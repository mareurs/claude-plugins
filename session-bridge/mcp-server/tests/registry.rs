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
