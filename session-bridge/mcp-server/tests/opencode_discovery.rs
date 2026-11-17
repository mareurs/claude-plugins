use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use session_bridge_mcp::{
    endpoints::Roots,
    opencode::{discover_opencode, is_session_id, OpenCodeEndpoint},
    opencode_api::OcApi,
    sessions::{discover_sessions_all, resolve_session, Session},
};
use std::{fs, os::unix::fs::PermissionsExt, path::Path, sync::Mutex};

const NOW: i64 = 1_000_000_000_000;
const HOUR: i64 = 3_600_000;

struct FakeApi {
    list: Result<Value, String>,
    active: Result<Value, String>,
    calls: Mutex<Vec<String>>,
}
impl OcApi for FakeApi {
    fn call(
        &self,
        method: &str,
        path: &str,
        _body: Option<&Value>,
    ) -> impl std::future::Future<Output = Result<Value>> + Send {
        self.calls.lock().unwrap().push(format!("{method} {path}"));
        let r = match path {
            "/api/session" => self.list.clone(),
            "/api/session/active" => self.active.clone(),
            _ => Err("unexpected".into()),
        };
        async move { r.map_err(|e| anyhow!(e)) }
    }
}
fn row(id: &str, updated: i64) -> Value {
    json!({"id": id, "title": format!("t-{id}"), "location": {"directory": "/repo"},
           "time": {"created": 1, "updated": updated}})
}
fn ep(id: &str, title: &str) -> OpenCodeEndpoint {
    OpenCodeEndpoint {
        data_dir: "/data/opencode".into(),
        session_id: id.into(),
        title: Some(title.into()),
        directory: Some("/repo".into()),
        running: false,
        last_active_ms: NOW,
    }
}

#[tokio::test]
async fn discover_filters_old_child_and_fork_sessions() {
    let mut rows = vec![];
    rows.push(row("ses_recent0", NOW - HOUR));
    rows.push(row("ses_recent1", NOW - 2 * HOUR));
    // old `updated` but recently viewed: max(updated, viewed) keeps it live
    let mut viewed = row("ses_viewed", NOW - 90 * HOUR);
    viewed["time"]["viewed"] = json!(NOW - HOUR);
    rows.push(viewed);
    rows.push(row("ses_oldactive", NOW - 99 * HOUR));
    for i in 0..150 {
        rows.push(row(&format!("ses_old{i}"), NOW - 25 * HOUR - i));
    }
    for i in 0..80 {
        let mut r = row(&format!("ses_child{i}"), NOW - HOUR);
        r["parentID"] = json!("ses_recent0");
        rows.push(r);
    }
    for i in 0..66 {
        let mut r = row(&format!("ses_fork{i}"), NOW - HOUR);
        if i % 2 == 0 {
            r["fork"] = json!({"sessionID": "ses_recent0", "boundary": "x"});
        } else {
            r["title"] = json!(format!("Plan (fork #{i})"));
        }
        rows.push(r);
    }
    assert_eq!(rows.len(), 300);
    let api = FakeApi {
        list: Ok(json!({"data": rows})),
        active: Ok(json!({"data": {"ses_oldactive": {"type": "running"}}})),
        calls: Mutex::new(vec![]),
    };
    let eps = discover_opencode(&api, Path::new("/data/opencode"), NOW, 24)
        .await
        .unwrap();
    let mut ids: Vec<_> = eps.iter().map(|e| e.session_id.as_str()).collect();
    ids.sort();
    assert_eq!(
        ids,
        ["ses_oldactive", "ses_recent0", "ses_recent1", "ses_viewed"]
    );
    let running: Vec<_> = eps.iter().filter(|e| e.running).collect();
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].session_id, "ses_oldactive");
}

#[tokio::test]
async fn discover_makes_two_api_calls() {
    let api = FakeApi {
        list: Ok(json!({"data": [row("ses_a1b2", NOW)]})),
        active: Ok(json!({"data": {}})),
        calls: Mutex::new(vec![]),
    };
    discover_opencode(&api, Path::new("/d"), NOW, 24)
        .await
        .unwrap();
    assert_eq!(
        *api.calls.lock().unwrap(),
        ["GET /api/session", "GET /api/session/active"]
    );
}

#[test]
fn session_id_shape() {
    assert!(is_session_id("ses_abc123"));
    assert!(!is_session_id("ses_"));
    assert!(!is_session_id("ses_a-b"));
    assert!(!is_session_id("abc"));
}

#[test]
fn key_round_trips_and_resolves() {
    let a = ep("ses_aaaa1111", "alpha");
    let b = OpenCodeEndpoint {
        data_dir: "/other/opencode".into(),
        ..ep("ses_aaaa1111", "alpha")
    };
    assert_eq!(a.key(), "opencode:/data/opencode:ses_aaaa1111");
    assert_ne!(a.storage_profile(), b.storage_profile());
    assert!(a.storage_profile().starts_with("opencode-"));
    assert_eq!(a.storage_profile().len(), "opencode-".len() + 16);
    let sessions = vec![Session::OpenCode(a.clone()), Session::OpenCode(b)];
    // the same id in two data dirs is ambiguous by id, exact by key
    assert!(resolve_session(&sessions, "ses_aaaa1111", None).is_err());
    let got = resolve_session(&sessions, &a.key(), None).unwrap();
    assert_eq!(got.key(), a.key());
    // a key naming another data dir never matches this one
    assert!(a.match_rank("opencode:/nowhere:ses_aaaa1111").is_none());
}

#[test]
fn resolve_ambiguous_title_refused() {
    let sessions = vec![
        Session::OpenCode(ep("ses_one11", "dup")),
        Session::OpenCode(ep("ses_two22", "dup")),
    ];
    let err = resolve_session(&sessions, "dup", None)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("ses_one11") && err.contains("ses_two22"),
        "{err}"
    );
}

#[test]
fn resolve_prefix_needs_four_chars() {
    let sessions = vec![Session::OpenCode(ep("ses_abcdef", "x"))];
    assert!(resolve_session(&sessions, "ses", None).is_err());
    assert!(resolve_session(&sessions, "ses_a", None).is_ok());
    assert_eq!(
        resolve_session(&sessions, "ses_abcd", None).unwrap().key(),
        sessions[0].key()
    );
}

#[test]
fn render_marks_running() {
    let mut e = ep("ses_run1", "My title");
    e.running = true;
    let line = Session::OpenCode(e.clone()).render(true);
    assert!(line.starts_with("opencode:/data/opencode:ses_run1 (you) harness=opencode"));
    assert!(line.contains("session=ses_run1"));
    assert!(line.contains("name=My title"));
    assert!(line.contains("status=running"));
    assert!(line.contains("cwd=/repo"));
    e.running = false;
    assert!(Session::OpenCode(e).render(false).contains("status=idle"));
}

#[tokio::test]
async fn opencode_failure_becomes_note() {
    let api = FakeApi {
        list: Err("service down".into()),
        active: Ok(json!({"data": {}})),
        calls: Mutex::new(vec![]),
    };
    assert!(discover_opencode(&api, Path::new("/d"), NOW, 24)
        .await
        .is_err());
}

fn empty_roots(d: &Path) -> Roots {
    Roots {
        proc_root: d.join("proc"),
        socks: d.join("socks"),
    }
}
fn fake_bin(root: &Path, script: Value) -> std::path::PathBuf {
    let state = root.join("state");
    fs::create_dir_all(&state).unwrap();
    fs::write(state.join("script.json"), script.to_string()).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-opencode.py");
    let bin = root.join("opencode");
    fs::write(
        &bin,
        format!(
            "#!/bin/sh\nFAKE_OC_DIR='{}' exec python3 '{}' \"$@\"\n",
            state.display(),
            fixture.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

#[tokio::test]
async fn discover_all_lists_opencode_through_the_cli() {
    let d = tempfile::tempdir().unwrap();
    let data = d.path().join("xdg/opencode");
    fs::create_dir_all(&data).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let bin = fake_bin(
        d.path(),
        json!({
            "GET /api/session": {"out": json!({"data": [row("ses_live1", now)]}).to_string()},
            "GET /api/session/active": {"out": "{\"data\":{}}"},
        }),
    );
    let xdg = d.path().join("xdg");
    let env = move |k: &str| match k {
        "SESSION_BRIDGE_OPENCODE_BIN" => Some(bin.to_string_lossy().into_owned()),
        "XDG_DATA_HOME" => Some(xdg.to_string_lossy().into_owned()),
        _ => None,
    };
    let (sessions, notes) = discover_sessions_all(&empty_roots(d.path()), &env).await;
    assert!(notes.is_empty(), "{notes:?}");
    assert_eq!(sessions.len(), 1);
    assert!(matches!(&sessions[0], Session::OpenCode(e) if e.session_id == "ses_live1"));
}

#[tokio::test]
async fn missing_binary_lists_others_with_note() {
    let d = tempfile::tempdir().unwrap();
    let env = |k: &str| match k {
        "PATH" => Some(String::new()),
        _ => None,
    };
    let (sessions, notes) = discover_sessions_all(&empty_roots(d.path()), &env).await;
    assert!(sessions.is_empty());
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].contains("OpenCode"), "{notes:?}");
}

#[tokio::test]
async fn service_returning_html_becomes_note() {
    let d = tempfile::tempdir().unwrap();
    fs::create_dir_all(d.path().join("xdg/opencode")).unwrap();
    let bin = fake_bin(
        d.path(),
        json!({
            "GET /api/session": {"out": "<html>web ui</html>"},
            "GET /api/session/active": {"out": "{\"data\":{}}"},
        }),
    );
    let xdg = d.path().join("xdg");
    let env = move |k: &str| match k {
        "SESSION_BRIDGE_OPENCODE_BIN" => Some(bin.to_string_lossy().into_owned()),
        "XDG_DATA_HOME" => Some(xdg.to_string_lossy().into_owned()),
        _ => None,
    };
    let (sessions, notes) = discover_sessions_all(&empty_roots(d.path()), &env).await;
    assert!(sessions.is_empty());
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].contains("non-JSON"), "{notes:?}");
}
