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
