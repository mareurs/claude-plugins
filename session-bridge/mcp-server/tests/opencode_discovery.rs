#![cfg(unix)] // Unix-only: fakes /proc, unix permissions or process groups
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use session_bridge_mcp::{
    endpoints::Roots,
    opencode::{discover_opencode, is_session_id, opencode_caller, OpenCodeEndpoint},
    opencode_api::OcApi,
    sessions::{
        discover_sessions_all, resolve_noted, resolve_session, with_opencode_for_target, Session,
    },
};
use std::{fs, path::Path, sync::Mutex};

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
        let r = if let Some(q) = path.strip_prefix("/api/session?") {
            self.page(q)
        } else if path == "/api/session/active" {
            self.active.clone()
        } else if let Some(id) = path.strip_prefix("/api/session/") {
            self.lookup(id)
        } else {
            Err("unexpected".into())
        };
        async move { r.map_err(|e| anyhow!(e)) }
    }
}
impl FakeApi {
    fn new(list: Result<Value, String>, active: Result<Value, String>) -> Self {
        FakeApi {
            list,
            active,
            calls: Mutex::new(vec![]),
        }
    }
    /// Pages `list.data` like the service: `limit` rows from the offset in `cursor`.
    fn page(&self, query: &str) -> Result<Value, String> {
        let list = self.list.clone()?;
        let Some(rows) = list["data"].as_array() else {
            return Ok(list);
        };
        let (mut limit, mut from) = (50, 0);
        for kv in query.split('&') {
            match kv.split_once('=') {
                Some(("limit", v)) => limit = v.parse().unwrap(),
                Some(("cursor", v)) => from = v.strip_prefix("off").unwrap().parse().unwrap(),
                _ => panic!("unexpected query {kv}"),
            }
        }
        let to = (from + limit).min(rows.len());
        let next = (to < rows.len()).then(|| format!("off{to}"));
        Ok(json!({"data": rows[from..to], "cursor": {"previous": null, "next": next}}))
    }
    fn lookup(&self, id: &str) -> Result<Value, String> {
        let list = self.list.clone()?;
        list["data"]
            .as_array()
            .and_then(|a| a.iter().find(|r| r["id"] == id).cloned())
            .ok_or_else(|| "HTTP 404".to_string())
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
    for i in 0..80 {
        let mut r = row(&format!("ses_child{i}"), NOW - HOUR);
        r["parentID"] = json!("ses_recent0");
        rows.push(r);
    }
    // The bridge's own ask forks, each with one of its markers: hidden.
    for i in 0..66 {
        let mut r = row(&format!("ses_fork{i}"), NOW - HOUR);
        r["fork"] = json!({"sessionID": "ses_recent0", "boundary": "x"});
        match i % 3 {
            0 => r["metadata"] = json!({"session_bridge_fork": true}),
            1 => r["title"] = json!("session-bridge ask ses_recent0"),
            _ => r["agent"] = json!("session-bridge-reader"),
        }
        rows.push(r);
    }
    // A fork the user made in OpenCode, and a session merely titled like a fork: listed.
    let mut user_fork = row("ses_userfork", NOW - HOUR);
    user_fork["fork"] = json!({"sessionID": "ses_recent0", "boundary": "x"});
    user_fork["agent"] = json!("build");
    rows.push(user_fork);
    let mut fork_title = row("ses_forktitle", NOW - HOUR);
    fork_title["title"] = json!("Plan (fork #2)");
    rows.push(fork_title);
    // old `updated` but recently viewed: max(updated, viewed) keeps it live
    let mut viewed = row("ses_viewed", NOW - 90 * HOUR);
    viewed["time"]["viewed"] = json!(NOW - HOUR);
    rows.push(viewed);
    rows.push(row("ses_oldactive", NOW - 99 * HOUR));
    for i in 0..248 {
        rows.push(row(&format!("ses_old{i}"), NOW - 99 * HOUR - i));
    }
    assert_eq!(rows.len(), 400);
    // Pages of 100: the third page holds no row inside the window, so the fourth is never read.
    let api = FakeApi::new(
        Ok(json!({"data": rows})),
        Ok(json!({"data": {"ses_oldactive": {"type": "running"}}})),
    );
    let eps = discover_opencode(&api, Path::new("/data/opencode"), NOW, 24)
        .await
        .unwrap();
    let mut ids: Vec<_> = eps.iter().map(|e| e.session_id.as_str()).collect();
    ids.sort();
    assert_eq!(
        ids,
        [
            "ses_forktitle",
            "ses_oldactive",
            "ses_recent0",
            "ses_recent1",
            "ses_userfork",
            "ses_viewed"
        ]
    );
    let running: Vec<_> = eps.iter().filter(|e| e.running).collect();
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].session_id, "ses_oldactive");
    assert_eq!(
        *api.calls.lock().unwrap(),
        [
            "GET /api/session?limit=100",
            "GET /api/session?limit=100&cursor=off100",
            "GET /api/session?limit=100&cursor=off200",
            "GET /api/session/active"
        ]
    );
    // The user fork is targetable and accepted as a caller; a bridge fork is neither.
    let sessions: Vec<Session> = eps.into_iter().map(Session::OpenCode).collect();
    assert!(resolve_session(&sessions, "ses_userfork", None).is_ok());
    assert!(resolve_session(&sessions, "ses_fork0", None).is_err());
    let me = opencode_caller(&sessions, &api, "ses_userfork")
        .await
        .unwrap();
    assert_eq!(me.session_id(), "ses_userfork");
    assert!(opencode_caller(&sessions, &api, "ses_fork1").await.is_err());
}

#[tokio::test]
async fn discover_excludes_archived_even_if_recent_or_active() {
    let mut archived = row("ses_archived", NOW - HOUR);
    archived["time"]["archived"] = json!(NOW);
    let mut active_archived = row("ses_activearchive", NOW - 99 * HOUR);
    active_archived["time"]["archived"] = json!(NOW);
    let mut restored = row("ses_restored", NOW - HOUR);
    restored["time"]["archived"] = Value::Null;
    let api = FakeApi::new(
        Ok(json!({"data": [row("ses_live", NOW - HOUR), archived, active_archived, restored]})),
        Ok(json!({"data": {"ses_activearchive": {"type": "running"}}})),
    );
    let eps = discover_opencode(&api, Path::new("/data/opencode"), NOW, 24)
        .await
        .unwrap();
    let ids: Vec<_> = eps.iter().map(|e| e.session_id.as_str()).collect();
    assert_eq!(ids, ["ses_live", "ses_restored"]);
}

/// The page cut-off uses max(updated, viewed), like liveness: a page whose rows are all stale
/// by `updated` but holds one recently viewed row is followed to the next page.
#[tokio::test]
async fn discover_pages_on_recently_viewed_rows() {
    let mut rows: Vec<Value> = (0..100)
        .map(|i| row(&format!("ses_a{i}"), NOW - 50 * HOUR - i))
        .collect();
    rows[40]["time"]["viewed"] = json!(NOW - HOUR);
    let mut late = row("ses_late1", NOW - 60 * HOUR);
    late["time"]["viewed"] = json!(NOW - 2 * HOUR);
    rows.push(late);
    let api = FakeApi::new(Ok(json!({"data": rows})), Ok(json!({"data": {}})));
    let eps = discover_opencode(&api, Path::new("/d"), NOW, 24)
        .await
        .unwrap();
    let mut ids: Vec<_> = eps.iter().map(|e| e.session_id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, ["ses_a40", "ses_late1"]);
}

#[tokio::test]
async fn discover_makes_two_api_calls() {
    // A short list (no full page) costs one list call plus the active call.
    let api = FakeApi::new(
        Ok(json!({"data": [row("ses_a1b2", NOW)]})),
        Ok(json!({"data": {}})),
    );
    discover_opencode(&api, Path::new("/d"), NOW, 24)
        .await
        .unwrap();
    assert_eq!(
        *api.calls.lock().unwrap(),
        ["GET /api/session?limit=100", "GET /api/session/active"]
    );
}

/// The service returns only its newest 50 rows by default; a live top-level session at row 121
/// and an active one past every read page must still be found, and be accepted as callers.
#[tokio::test]
async fn discover_pages_past_the_default_page_and_looks_up_active() {
    let mut rows = vec![];
    for i in 0..120 {
        let mut r = row(&format!("ses_kid{i}"), NOW - HOUR);
        r["parentID"] = json!("ses_deep1");
        rows.push(r);
    }
    rows.push(row("ses_deep1", NOW - 2 * HOUR));
    for i in 0..200 {
        rows.push(row(&format!("ses_stale{i}"), NOW - 30 * HOUR - i));
    }
    rows.push(row("ses_busy1", NOW - 500 * HOUR));
    let mut busy_kid = row("ses_busykid", NOW - 500 * HOUR);
    busy_kid["parentID"] = json!("ses_busy1");
    rows.push(busy_kid);
    let api = FakeApi::new(
        Ok(json!({"data": rows})),
        Ok(json!({"data": {"ses_busy1": {}, "ses_busykid": {}, "ses_gone1": {}}})),
    );
    let eps = discover_opencode(&api, Path::new("/d"), NOW, 24)
        .await
        .unwrap();
    let mut ids: Vec<_> = eps.iter().map(|e| e.session_id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, ["ses_busy1", "ses_deep1"]);
    let calls = api.calls.lock().unwrap().clone();
    assert_eq!(
        calls,
        [
            "GET /api/session?limit=100",
            "GET /api/session?limit=100&cursor=off100",
            "GET /api/session?limit=100&cursor=off200",
            // page 3 holds no row inside the window: ses_busy1 (row 321) comes from the
            // active lookup
            "GET /api/session/active",
            "GET /api/session/ses_busy1",
            "GET /api/session/ses_busykid",
            "GET /api/session/ses_gone1",
        ]
    );
    let sessions: Vec<Session> = eps.into_iter().map(Session::OpenCode).collect();
    for (caller, top) in [
        ("ses_deep1", "ses_deep1"),
        ("ses_kid119", "ses_deep1"),
        ("ses_busy1", "ses_busy1"),
        ("ses_busykid", "ses_busy1"),
    ] {
        let me = opencode_caller(&sessions, &api, caller).await.unwrap();
        assert!(
            matches!(me, Session::OpenCode(e) if e.session_id == top),
            "{caller}"
        );
    }
}

#[tokio::test]
async fn discover_stops_at_the_row_cap() {
    let rows: Vec<_> = (0..2500)
        .map(|i| row(&format!("ses_r{i}"), NOW - i))
        .collect();
    let api = FakeApi::new(Ok(json!({"data": rows})), Ok(json!({"data": {}})));
    let eps = discover_opencode(&api, Path::new("/d"), NOW, 24)
        .await
        .unwrap();
    assert_eq!(eps.len(), 2000);
    assert_eq!(api.calls.lock().unwrap().len(), 21);
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
    // Symlink to the committed fixture (no ETXTBSY race); state dir is `state/` beside it.
    let bin = root.join("opencode");
    std::os::unix::fs::symlink(&fixture, &bin).unwrap();
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
            "GET /api/session?limit=100": {"out": json!({"data": [row("ses_live1", now)]}).to_string()},
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
async fn list_without_opencode_has_no_note() {
    let d = tempfile::tempdir().unwrap();
    let env = |k: &str| match k {
        "PATH" => Some(String::new()),
        _ => None,
    };
    let (sessions, notes) = discover_sessions_all(&empty_roots(d.path()), &env).await;
    assert!(sessions.is_empty());
    assert!(notes.is_empty(), "{notes:?}");
}

/// An explicitly set but invalid override is a misconfiguration, not an absent OpenCode.
#[tokio::test]
async fn invalid_override_keeps_its_note() {
    let d = tempfile::tempdir().unwrap();
    let env = |k: &str| match k {
        "PATH" => Some(String::new()),
        "SESSION_BRIDGE_OPENCODE_BIN" => Some("relative/opencode".into()),
        _ => None,
    };
    let (_, notes) = discover_sessions_all(&empty_roots(d.path()), &env).await;
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].contains("must be absolute"), "{notes:?}");
}

/// Listing never starts the OpenCode service; a stopped one is a short note.
#[tokio::test]
async fn list_never_starts_the_service() {
    let d = tempfile::tempdir().unwrap();
    let env = down_service(d.path());
    let (sessions, notes) = discover_sessions_all(&empty_roots(d.path()), &env).await;
    assert!(sessions.is_empty());
    assert!(
        !d.path().join("state/starts").exists(),
        "listing started the service"
    );
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(
        notes[0].contains("OpenCode service is not running"),
        "{notes:?}"
    );
}

#[tokio::test]
async fn service_returning_html_becomes_note() {
    let d = tempfile::tempdir().unwrap();
    fs::create_dir_all(d.path().join("xdg/opencode")).unwrap();
    let bin = fake_bin(
        d.path(),
        json!({
            "GET /api/session?limit=100": {"out": "<html>web ui</html>"},
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

#[test]
fn storage_profile_is_per_session() {
    let a = ep("ses_aaaa1111", "alpha");
    let b = ep("ses_bbbb2222", "beta");
    assert_ne!(a.storage_profile(), b.storage_profile());
    assert_eq!(
        a.storage_profile(),
        ep("ses_aaaa1111", "other").storage_profile()
    );
    assert!(a.storage_profile().ends_with("-ses_aaaa1111"));
    assert_eq!(Session::OpenCode(a).storage_id().1, 0);
}

fn claude(id: &str) -> Session {
    Session::Claude(session_bridge_mcp::endpoints::Endpoint {
        profile: ".claude".into(),
        config_dir: "/home/.claude".into(),
        pid: 30,
        session_id: id.into(),
        name: Some("worker".into()),
        kind: None,
        status: None,
        launch_cwd: "/repo".into(),
        repo: None,
    })
}

/// A fake `opencode` whose service probe fails until `service start` ran; the session list
/// then holds `ses_live1`.
fn down_service(root: &Path) -> impl Fn(&str) -> Option<String> + Sync {
    fs::create_dir_all(root.join("xdg/opencode")).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let up = |out: String| json!({"out": "HTTP 503", "exit": 1, "after_start": {"out": out}});
    let bin = fake_bin(
        root,
        json!({
            "GET /api/session/active": up("{\"data\":{}}".into()),
            "GET /api/session?limit=100": up(json!({"data": [row("ses_live1", now)]}).to_string()),
        }),
    );
    let xdg = root.join("xdg");
    move |k: &str| match k {
        "SESSION_BRIDGE_OPENCODE_BIN" => Some(bin.to_string_lossy().into_owned()),
        "XDG_DATA_HOME" => Some(xdg.to_string_lossy().into_owned()),
        _ => None,
    }
}

/// A Claude-to-Claude ask or send never runs OpenCode (no call, no service start), and a
/// target nothing matches probes OpenCode without starting it; the note reaches the error.
#[tokio::test]
async fn claude_target_never_depends_on_opencode() {
    let d = tempfile::tempdir().unwrap();
    let env = down_service(d.path());
    let id = "11111111-1111-7111-8111-111111111111";
    let (sessions, notes) = with_opencode_for_target(vec![claude(id)], &env, id).await;
    assert_eq!(sessions.len(), 1);
    assert!(notes.is_empty(), "{notes:?}");
    assert!(
        !d.path().join("state/argv.log").exists(),
        "OpenCode was called for a Claude target"
    );
    let (_, notes) = with_opencode_for_target(vec![claude(id)], &env, "worker").await;
    assert!(notes.is_empty(), "{notes:?}");
    assert!(!d.path().join("state/argv.log").exists());
    // an unknown name: OpenCode is probed (it may be an OpenCode title) but never started
    let (sessions, notes) = with_opencode_for_target(vec![claude(id)], &env, "nobody").await;
    assert!(
        !d.path().join("state/starts").exists(),
        "service start ran for a non-OpenCode target"
    );
    assert_eq!(notes.len(), 1, "{notes:?}");
    let e = resolve_noted(&sessions, "nobody", None, &notes)
        .unwrap_err()
        .to_string();
    assert!(e.contains("no live session matches"), "{e}");
    assert!(e.contains("OpenCode service is not running"), "{e}");
}

/// An OpenCode address or id may start the service and then resolves.
#[tokio::test]
async fn opencode_target_send_may_start_the_service() {
    let d = tempfile::tempdir().unwrap();
    let env = down_service(d.path());
    let id = "11111111-1111-7111-8111-111111111111";
    for target in ["ses_live1", "opencode:ses_live1"] {
        let _ = fs::remove_file(d.path().join("state/starts"));
        let (sessions, notes) = with_opencode_for_target(vec![claude(id)], &env, target).await;
        assert!(notes.is_empty(), "{notes:?}");
        let starts = fs::read_to_string(d.path().join("state/starts")).unwrap();
        assert_eq!(starts.lines().count(), 1, "{target}: {starts:?}");
        assert!(sessions
            .iter()
            .any(|s| matches!(s, Session::OpenCode(e) if e.session_id == "ses_live1")));
    }
}
