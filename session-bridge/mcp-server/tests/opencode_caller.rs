//! OpenCode callers: `session-bridge call <tool> --opencode-caller <ses_id>` and the caller
//! validation behind it (exact id, parent-chain walk, live top-level session).
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use session_bridge_mcp::{
    opencode::{opencode_caller, OpenCodeEndpoint},
    opencode_api::OcApi,
    sessions::Session,
    store::Store,
};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
};

/// `GET /api/session/{id}` answers from `rows`; every other call fails.
struct FakeApi {
    rows: HashMap<String, Value>,
    calls: Mutex<Vec<String>>,
}
impl FakeApi {
    fn new(rows: &[(&str, Option<&str>)]) -> Self {
        let rows = rows
            .iter()
            .map(|(id, parent)| {
                let mut v = json!({"id": id, "title": format!("t-{id}")});
                if let Some(p) = parent {
                    v["parentID"] = json!(p);
                }
                (id.to_string(), json!({ "data": v }))
            })
            .collect();
        FakeApi {
            rows,
            calls: Mutex::new(vec![]),
        }
    }
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}
impl OcApi for FakeApi {
    fn call(
        &self,
        method: &str,
        path: &str,
        _body: Option<&Value>,
    ) -> impl std::future::Future<Output = Result<Value>> + Send {
        self.calls.lock().unwrap().push(format!("{method} {path}"));
        let r = path
            .strip_prefix("/api/session/")
            .filter(|_| method == "GET")
            .and_then(|id| self.rows.get(id).cloned())
            .ok_or_else(|| anyhow!("HTTP 404 Not Found"));
        async move { r }
    }
}

fn oc(id: &str) -> Session {
    Session::OpenCode(OpenCodeEndpoint {
        data_dir: "/data/opencode".into(),
        session_id: id.into(),
        title: Some(format!("t-{id}")),
        directory: Some("/repo".into()),
        running: false,
        last_active_ms: 0,
    })
}

#[tokio::test]
async fn subagent_caller_resolves_to_parent() {
    let sessions = vec![oc("ses_parent1"), oc("ses_other1")];
    let api = FakeApi::new(&[
        ("ses_parent1", None),
        ("ses_child1", Some("ses_parent1")),
        ("ses_grand1", Some("ses_child1")),
    ]);
    // a top-level id resolves to itself
    let me = opencode_caller(&sessions, &api, "ses_parent1")
        .await
        .unwrap();
    assert_eq!(me.session_id(), "ses_parent1");
    // a child id (what OpenCode may pass from a subagent tool call) resolves to its parent
    let me = opencode_caller(&sessions, &api, "ses_child1")
        .await
        .unwrap();
    assert_eq!(me.session_id(), "ses_parent1");
    // and so does a grandchild
    let me = opencode_caller(&sessions, &api, "ses_grand1")
        .await
        .unwrap();
    assert_eq!(me.session_id(), "ses_parent1");
    assert!(api
        .calls()
        .contains(&"GET /api/session/ses_grand1".to_string()));
}

#[tokio::test]
async fn parent_chain_is_bounded_and_must_end_live() {
    let sessions = vec![oc("ses_parent1")];
    // a cycle never terminates by itself: the walk gives up at depth 8
    let api = FakeApi::new(&[
        ("ses_loopa", Some("ses_loopb")),
        ("ses_loopb", Some("ses_loopa")),
    ]);
    let e = opencode_caller(&sessions, &api, "ses_loopa")
        .await
        .unwrap_err();
    assert!(
        e.to_string().contains("not a live top-level session"),
        "{e:#}"
    );
    assert!(api.calls().len() <= 9, "{:?}", api.calls());
    // a top-level session that discovery did not list (e.g. a bridge fork) is refused
    let api = FakeApi::new(&[("ses_fork1", None)]);
    let e = opencode_caller(&sessions, &api, "ses_fork1")
        .await
        .unwrap_err();
    assert!(
        e.to_string().contains("not a live top-level session"),
        "{e:#}"
    );
    // an id the service does not know is refused
    let api = FakeApi::new(&[]);
    assert!(opencode_caller(&sessions, &api, "ses_parent1")
        .await
        .is_err());
}

#[tokio::test]
async fn malformed_ids_are_refused_before_any_api_call() {
    let sessions = vec![oc("ses_parent1")];
    let api = FakeApi::new(&[("ses_parent1", None)]);
    for bad in [
        "",
        "ses_",
        "parent1",
        "ses_x/../y",
        "ses_a;rm -rf",
        "ses_parent1 ",
    ] {
        assert!(
            opencode_caller(&sessions, &api, bad).await.is_err(),
            "{bad:?}"
        );
    }
    assert!(api.calls().is_empty(), "{:?}", api.calls());
}

#[tokio::test]
async fn caller_requires_exact_live_row_at_every_parent_hop() {
    for row in [
        Value::Null,
        json!({"data": null}),
        json!({"data": {}}),
        json!({"data": {"id": "ses_different"}}),
        json!({"data": {"id": "ses_different", "parentID": "ses_parent"}}),
        json!({"data": {"id": "ses_caller", "time": {"archived": 1}}}),
    ] {
        let mut api = FakeApi::new(&[("ses_caller", None)]);
        api.rows.insert("ses_caller".into(), row.clone());
        let sessions = vec![oc("ses_caller"), oc("ses_parent")];
        assert!(
            opencode_caller(&sessions, &api, "ses_caller")
                .await
                .is_err(),
            "{row}"
        );
    }
    let mut api = FakeApi::new(&[("ses_child", Some("ses_parent")), ("ses_parent", None)]);
    api.rows
        .insert("ses_parent".into(), json!({"data": {"id": "ses_other"}}));
    assert!(opencode_caller(&[oc("ses_parent")], &api, "ses_child")
        .await
        .is_err());
}

// ---- the `session-bridge call` CLI, against the fake `opencode` binary ----

struct Env {
    _dir: tempfile::TempDir,
    root: PathBuf,
    bin: PathBuf,
    repo: PathBuf,
}
impl Env {
    /// One live top-level OpenCode session `ses_live1` working in a fresh git repository, and
    /// one subagent child `ses_kid1` of it (not listed by the service as a session of its own).
    fn new() -> Env {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("xdg/opencode")).unwrap();
        let repo = root.join("repo");
        fs::create_dir_all(&repo).unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(&repo)
            .status()
            .unwrap()
            .success());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let row = |id: &str| {
            json!({"id": id, "title": format!("t-{id}"),
                   "location": {"directory": repo.to_string_lossy()},
                   "time": {"created": 1, "updated": now}})
        };
        let mut kid = row("ses_kid1");
        kid["parentID"] = json!("ses_live1");
        let script = json!({
            "GET /api/session?limit=100": {"out": json!({"data": [row("ses_live1"), kid.clone()]}).to_string()},
            "GET /api/session/active": {"out": "{\"data\":{}}"},
            "GET /api/session/ses_live1": {"out": json!({"data": row("ses_live1")}).to_string()},
            "GET /api/session/ses_kid1": {"out": json!({"data": kid}).to_string()},
        });
        let state = root.join("state");
        fs::create_dir_all(&state).unwrap();
        fs::write(state.join("script.json"), script.to_string()).unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-opencode.py");
        let bin = root.join("opencode");
        // Symlink to the committed fixture (no ETXTBSY race); state dir is `state/` beside it.
        std::os::unix::fs::symlink(&fixture, &bin).unwrap();
        Env {
            _dir: dir,
            root,
            bin,
            repo,
        }
    }
    fn data_dir(&self) -> PathBuf {
        self.root.join("xdg/opencode").canonicalize().unwrap()
    }
    fn storage_profile(&self, id: &str) -> String {
        OpenCodeEndpoint {
            data_dir: self.data_dir(),
            session_id: id.into(),
            title: None,
            directory: None,
            running: false,
            last_active_ms: 0,
        }
        .storage_profile()
    }
    fn key(&self, id: &str) -> String {
        format!("opencode:{}:{id}", self.data_dir().display())
    }
    fn state(&self) -> PathBuf {
        self.root.join("state/session-bridge")
    }
    /// `session-bridge call <tool> --opencode-caller <caller>` with `args` on stdin.
    fn call(&self, tool: &str, caller: &str, args: &str) -> (i32, String, String) {
        let mut child = Command::new(env!("CARGO_BIN_EXE_session-bridge"))
            .args(["call", tool, "--opencode-caller", caller])
            .env("SESSION_BRIDGE_OPENCODE_BIN", &self.bin)
            .env("XDG_DATA_HOME", self.root.join("xdg"))
            .env("XDG_STATE_HOME", self.root.join("state"))
            .env("HOME", &self.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(args.as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        (
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stdout).into_owned(),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        )
    }
    fn notices(&self) -> Vec<session_bridge_mcp::store::Notice> {
        let db = self.state().join("notices.db");
        if !db.exists() {
            return vec![];
        }
        Store::open(&db).unwrap().get_many(&[1, 2, 3]).unwrap()
    }
}

#[test]
fn call_requires_valid_ses_id() {
    let env = Env::new();
    let args = r#"{"title":"t","body":"b"}"#;
    for bad in ["", "live1", "ses_", "ses_live1;true", "../ses_live1"] {
        let (code, out, err) = env.call("post_notice", bad, args);
        assert_eq!(code, 2, "{bad:?}: {out} {err}");
        assert!(out.is_empty(), "{bad:?}: {out}");
        assert!(err.contains("OpenCode caller"), "{bad:?}: {err}");
    }
    assert!(env.notices().is_empty());
    // an unknown tool is an error too
    let (code, _, err) = env.call("rm_rf", "ses_live1", "{}");
    assert_eq!(code, 2, "{err}");
    assert!(err.contains("rm_rf"), "{err}");
}

#[test]
fn unknown_caller_is_refused_for_send_but_list_works() {
    let env = Env::new();
    let live = env.key("ses_live1");
    // listing without a valid caller works, with no `(you)` mark
    let (code, out, err) = env.call("list_sessions", "ses_nobody1", "");
    assert_eq!(code, 0, "{err}");
    let line = out
        .lines()
        .find(|l| l.starts_with(&live))
        .unwrap_or_else(|| panic!("{out}"));
    assert!(!line.contains("(you)"), "{line}");
    assert!(
        !out.contains("ses_kid1"),
        "child sessions are never listed: {out}"
    );
    // a valid caller gets the `(you)` mark, exactly as a Claude/Codex caller does
    let (code, out, err) = env.call("list_sessions", "ses_live1", "{}");
    assert_eq!(code, 0, "{err}");
    assert!(
        out.contains(&format!("{live} (you) harness=opencode")),
        "{out}"
    );
    // and so does its subagent child, which resolves to it
    let (_, out, _) = env.call("list_sessions", "ses_kid1", "{}");
    assert!(
        out.contains(&format!("{live} (you) harness=opencode")),
        "{out}"
    );

    // mutating calls from an unknown caller are refused before any effect
    let send = r#"{"target":"ses_live1","message":"hi"}"#;
    let (code, out, err) = env.call("send_message", "ses_nobody1", send);
    assert_eq!(code, 2, "{out}");
    assert!(err.contains("not a live top-level session"), "{err}");
    let (code, _, err) = env.call("post_notice", "ses_nobody1", r#"{"title":"t","body":"b"}"#);
    assert_eq!(code, 2);
    assert!(err.contains("not a live top-level session"), "{err}");
    assert!(env.notices().is_empty());
    // a live caller may not target itself
    let (code, _, err) = env.call("send_message", "ses_live1", send);
    assert_eq!(code, 2);
    assert!(err.contains("calling session itself"), "{err}");
}

#[test]
fn call_post_notice_uses_opencode_author() {
    let env = Env::new();
    let (code, out, err) = env.call(
        "post_notice",
        "ses_kid1",
        r#"{"title":"moved main","body":"b","refs":["main"]}"#,
    );
    assert_eq!((code, out.trim()), (0, "Posted notice 1."), "{err}");
    let rows = env.notices();
    assert_eq!(rows.len(), 1);
    let n = &rows[0];
    // the subagent's notice is authored by its top-level parent session
    assert_eq!(n.author_profile, env.storage_profile("ses_live1"));
    assert_eq!(n.author_pid, 0);
    assert_eq!(n.author_session, "ses_live1");
    assert_eq!(n.title, "moved main");
    assert_eq!(n.refs, vec!["main".to_string()]);
    // the repository is the OpenCode session's directory
    assert_eq!(
        Path::new(&n.repo).canonicalize().unwrap(),
        env.repo.canonicalize().unwrap()
    );
}

#[test]
fn call_args_with_shell_metachars_are_literal() {
    let env = Env::new();
    let marker = env.root.join("pwned");
    // Keep the title within its public limit regardless of the temp-directory prefix.
    // The body carries the absolute side-effect marker, so shell execution is still observable.
    let title = "literal '\"; $(id) `id` && echo | cat";
    let body = format!(
        "$(touch {}) `touch $HOME/pwned2`; echo 'quoted' | cat",
        marker.display()
    );
    let args = json!({"title": title, "body": body, "refs": ["a b", "$(id)"]});
    let (code, out, err) = env.call("post_notice", "ses_live1", &args.to_string());
    assert_eq!(code, 0, "{out} {err}");
    let rows = env.notices();
    assert_eq!(rows[0].title, title);
    assert_eq!(rows[0].body, body);
    assert_eq!(rows[0].refs, vec!["a b".to_string(), "$(id)".to_string()]);
    assert!(!marker.exists());
    assert!(!env.root.join("pwned2").exists());
    // A metacharacter-laden target is a lookup miss, never a command.
    let send = json!({"target": format!("$(touch {})", marker.display()), "message": "hi"});
    let (code, _, err) = env.call("send_message", "ses_live1", &send.to_string());
    assert_eq!(code, 2);
    assert!(err.contains("no live session matches"), "{err}");
    assert!(!marker.exists());
    let (code, _, _) = env.call("post_notice", "ses_live1", "{\"title\":");
    assert_eq!(code, 2);
}
#[test]
fn call_listing_preserves_repository_scope_and_all_override() {
    let env = Env::new();
    let other = env.root.join("other-repository");
    fs::create_dir(&other).unwrap();
    assert!(Command::new("git")
        .args(["init", "-q"])
        .arg(&other)
        .status()
        .unwrap()
        .success());
    let script_path = env.root.join("state/script.json");
    let mut script: serde_json::Value =
        serde_json::from_slice(&fs::read(&script_path).unwrap()).unwrap();
    let key = "GET /api/session?limit=100";
    let mut listed: serde_json::Value =
        serde_json::from_str(script[key]["out"].as_str().unwrap()).unwrap();
    let mut foreign = listed["data"][0].clone();
    foreign["id"] = json!("ses_foreign");
    foreign["title"] = json!("other repository");
    foreign["location"]["directory"] = json!(other.to_string_lossy());
    listed["data"].as_array_mut().unwrap().push(foreign);
    script[key]["out"] = json!(listed.to_string());
    fs::write(script_path, script.to_string()).unwrap();

    let (code, out, err) = env.call("list_sessions", "ses_live1", "{}");
    assert_eq!(code, 0, "{out} {err}");
    assert!(out.contains("ses_live1") && out.contains("(you)"), "{out}");
    assert!(!out.contains("ses_foreign"), "{out}");
    assert!(
        out.contains("more session(s) in other repositories") && out.contains("all=true"),
        "{out}"
    );

    let (code, out, err) = env.call("list_sessions", "ses_live1", r#"{"all":true}"#);
    assert_eq!(code, 0, "{out} {err}");
    assert!(
        out.contains("ses_live1") && out.contains("ses_foreign"),
        "{out}"
    );
    assert!(!out.contains("more session(s)"), "{out}");
}

#[test]
fn call_timeout_drains_late_fork_creation_before_process_exit() {
    let env = Env::new();
    let state = env.root.join("state");
    let mut script: Value =
        serde_json::from_str(&fs::read_to_string(state.join("script.json")).unwrap()).unwrap();
    let mut list: Value = serde_json::from_str(
        script["GET /api/session?limit=100"]["out"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let mut peer = list["data"][0].clone();
    peer["id"] = json!("ses_peer1");
    list["data"].as_array_mut().unwrap().push(peer);
    script["GET /api/session?limit=100"]["out"] = json!(list.to_string());
    script["POST /api/session/ses_peer1/fork"] =
        json!({"out": "{\"data\":{\"id\":\"ses_latefork\"}}", "sleep": 2});
    script["POST /api/session/ses_latefork/interrupt"] = json!({"out": ""});
    script["DELETE /api/session/ses_latefork"] = json!({"out": ""});
    fs::write(state.join("script.json"), script.to_string()).unwrap();
    let (code, _, err) = env.call(
        "ask_session",
        "ses_live1",
        r#"{"target":"ses_peer1","question":"question","timeout_s":1}"#,
    );
    assert_eq!(code, 2, "{err}");
    assert!(err.contains("timed out"), "{err}");
    let log = fs::read_to_string(state.join("argv.log")).unwrap();
    assert!(
        log.contains(r#"["api", "DELETE", "/api/session/ses_latefork"]"#),
        "{log}"
    );
    assert!(!log.contains("/api/session/ses_peer1/prompt"), "{log}");
}

/// The OpenCode plugin SIGTERMs `session-bridge call` on Esc and on its own timeout. A
/// signalled ask must still interrupt and remove its fork before the process exits.
#[test]
fn sigterm_during_ask_interrupts_and_removes_the_fork() {
    let env = Env::new();
    let state = env.root.join("state");
    let mut script: Value =
        serde_json::from_str(&fs::read_to_string(state.join("script.json")).unwrap()).unwrap();
    let mut list: Value = serde_json::from_str(
        script["GET /api/session?limit=100"]["out"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let mut peer = list["data"][0].clone();
    peer["id"] = json!("ses_peer1");
    peer["title"] = json!("t-ses_peer1");
    list["data"].as_array_mut().unwrap().push(peer);
    let fork = "ses_fk1";
    let extra = json!({
        "GET /api/session?limit=100": {"out": list.to_string()},
        "POST /api/session/ses_peer1/fork": {"out": json!({"data": {"id": fork}}).to_string()},
        "PATCH /api/session/ses_fk1": {"out": ""},
        "POST /api/session/ses_fk1/agent": {"out": ""},
        "GET /api/session/ses_fk1": {"out": json!({"data": {"id": fork, "agent": "session-bridge-reader"}}).to_string()},
        "POST /api/session/ses_fk1/prompt": {"out": "{\"data\":{}}"},
        "POST /api/experimental/session/ses_fk1/wait": {"out": "", "sleep": 60},
        "POST /api/session/ses_fk1/interrupt": {"out": ""},
        "DELETE /api/session/ses_fk1": {"out": ""},
    });
    for (k, v) in extra.as_object().unwrap() {
        script[k] = v.clone();
    }
    fs::write(state.join("script.json"), script.to_string()).unwrap();

    let mut child = Command::new(env!("CARGO_BIN_EXE_session-bridge"))
        .args(["call", "ask_session", "--opencode-caller", "ses_live1"])
        .env("SESSION_BRIDGE_OPENCODE_BIN", &env.bin)
        .env("XDG_DATA_HOME", env.root.join("xdg"))
        .env("XDG_STATE_HOME", &state)
        .env("HOME", &env.root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"target":"ses_peer1","question":"what branch?","timeout_s":120}"#)
        .unwrap();
    let argv = || fs::read_to_string(state.join("argv.log")).unwrap_or_default();
    let wait = r#"["api", "POST", "/api/experimental/session/ses_fk1/wait"]"#;
    let t0 = std::time::Instant::now();
    while !argv().contains(wait) {
        assert!(
            t0.elapsed() < std::time::Duration::from_secs(20),
            "the ask never reached wait: {}",
            argv()
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    nix::sys::signal::kill(
        nix::unistd::Pid::from_raw(child.id() as i32),
        nix::sys::signal::Signal::SIGTERM,
    )
    .unwrap();
    let t1 = std::time::Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().unwrap() {
            break s;
        }
        if t1.elapsed() > std::time::Duration::from_secs(10) {
            let _ = child.kill();
            panic!("session-bridge call did not exit after SIGTERM");
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    let mut err = String::new();
    std::io::Read::read_to_string(&mut child.stderr.take().unwrap(), &mut err).unwrap();
    assert_eq!(status.code(), Some(2), "{status:?} {err}");
    assert!(err.contains("SIGTERM"), "{err}");
    let log = argv();
    let interrupt = log
        .find(r#"["api", "POST", "/api/session/ses_fk1/interrupt"]"#)
        .unwrap_or_else(|| panic!("no interrupt: {log}"));
    let delete = log
        .find(r#"["api", "DELETE", "/api/session/ses_fk1"]"#)
        .unwrap_or_else(|| panic!("no DELETE: {log}"));
    assert!(interrupt < delete, "{log}");
    // the original session is only ever forked
    assert!(
        !log.contains(r#""DELETE", "/api/session/ses_peer1""#),
        "{log}"
    );
}
