use session_bridge_mcp::{
    endpoints::Roots,
    hook::{now_ms, HookInput},
    opencode::OpenCodeEndpoint,
    opencode_hook::{handle, output_for, settle_pending, UNFILTERED_REASON},
    server::{post_notice_from, PostNoticeArgs},
    state::{endpoint_path, load_or_default},
    store::Store,
};
use std::{fs, path::Path};

const A: &str = "ses_aaaaaaaa1";
const B: &str = "ses_bbbbbbbb2";
const CHILD: &str = "ses_cccccccc3";
/// Longer than the look interval, so every trigger looks at the store again.
const T: i64 = 200_000;

fn endpoint(root: &Path, sid: &str) -> OpenCodeEndpoint {
    OpenCodeEndpoint {
        data_dir: root.join("oc-data"),
        session_id: sid.into(),
        title: None,
        directory: Some(root.to_path_buf()),
        running: true,
        last_active_ms: 0,
    }
}
fn input(e: &OpenCodeEndpoint) -> HookInput {
    HookInput {
        session_id: e.session_id.clone(),
        cwd: e.directory.as_ref().unwrap().to_string_lossy().into_owned(),
        ..Default::default()
    }
}
struct Fx {
    _d: tempfile::TempDir,
    root: std::path::PathBuf,
    state: std::path::PathBuf,
    store: Store,
    roots: Roots,
}
fn fx() -> Fx {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().to_path_buf();
    assert!(std::process::Command::new("git")
        .args(["init", "-q"])
        .arg(&root)
        .status()
        .unwrap()
        .success());
    let state = root.join("state");
    fs::create_dir(&state).unwrap();
    let store = Store::open(&state.join("notices.db")).unwrap();
    let roots = Roots {
        proc_root: root.join("proc"),
        socks: root.join("socks"),
    };
    Fx {
        _d: d,
        root,
        state,
        store,
        roots,
    }
}
fn post(f: &Fx, e: &OpenCodeEndpoint, title: &str) {
    post_notice_from(
        &f.state,
        (&e.storage_profile(), 0),
        &e.session_id,
        &f.root,
        PostNoticeArgs {
            title: title.into(),
            body: "change".into(),
            refs: vec![],
        },
    )
    .unwrap();
}
fn run(f: &Fx, ev: &str, e: &OpenCodeEndpoint, now: i64) -> Option<String> {
    handle(
        ev,
        &input(e),
        e,
        &f.roots,
        &f.state,
        &f.store,
        now,
        &|_, _| None,
    )
}

#[test]
fn opencode_receives_notice_unfiltered_with_reason() {
    let f = fx();
    let a = endpoint(&f.root, A);
    let b = endpoint(&f.root, B);
    let now = now_ms();
    run(&f, "session-start", &a, now);
    run(&f, "session-start", &b, now);
    post(&f, &b, "from B");
    // The first trigger only queues the notice and asks for a filter.
    assert!(run(&f, "post-tool", &a, now + T).is_none());
    settle_pending(&f.state, &a.storage_profile());
    let st = load_or_default(&endpoint_path(&f.state, &a.storage_profile(), 0));
    assert!(st.pending.is_empty() && st.worker_pid.is_none());
    assert_eq!(st.verdicts.len(), 1);
    assert!(st.verdicts[0].relevant);
    assert_eq!(
        st.verdicts[0].unfiltered_reason.as_deref(),
        Some(UNFILTERED_REASON)
    );
    let got = run(&f, "post-tool", &a, now + 2 * T).unwrap();
    assert!(got.contains("from B"), "{got}");
    assert!(got.contains(UNFILTERED_REASON), "{got}");
    assert!(
        !got.contains("additionalContext"),
        "plain text, not host JSON: {got}"
    );
}

#[test]
fn opencode_self_notice_excluded() {
    let f = fx();
    let a = endpoint(&f.root, A);
    let now = now_ms();
    run(&f, "session-start", &a, now);
    post(&f, &a, "from A itself");
    run(&f, "post-tool", &a, now + T);
    // Settle whatever endpoint the hook used, so a wrong identity cannot hide behind it.
    for entry in fs::read_dir(f.state.join("endpoints")).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        if let Some(profile) = name.strip_suffix("__0.json") {
            settle_pending(&f.state, profile);
        }
    }
    let got = run(&f, "post-tool", &a, now + 2 * T);
    assert!(got.is_none_or(|g| !g.contains("from A itself")));
}

#[test]
fn opencode_fork_and_child_get_nothing() {
    let f = fx();
    let a = endpoint(&f.root, A);
    let b = endpoint(&f.root, B);
    let now = now_ms();
    run(&f, "session-start", &b, now);
    post(&f, &b, "from B");
    // Discovery lists only live top-level sessions: the child id is not among them.
    let live = vec![a.clone(), b];
    let raw = format!(r#"{{"session_id":"{CHILD}","cwd":"{}"}}"#, f.root.display());
    for ev in ["session-start", "prompt", "post-tool"] {
        assert!(output_for(
            &raw,
            ev,
            &live,
            &f.roots,
            &f.state,
            &f.store,
            now + T,
            &|_, _| None
        )
        .is_none());
    }
    // A payload that names the child as a subagent of a live session is refused too.
    let raw = format!(
        r#"{{"session_id":"{A}","agent_id":"x","cwd":"{}"}}"#,
        f.root.display()
    );
    assert!(output_for(
        &raw,
        "prompt",
        &live,
        &f.roots,
        &f.state,
        &f.store,
        now + T,
        &|_, _| None
    )
    .is_none());
    // Nothing was written for the child endpoint.
    let child = endpoint(&f.root, CHILD);
    assert!(!endpoint_path(&f.state, &child.storage_profile(), 0).exists());
}

#[test]
fn two_opencode_sessions_have_separate_cursors() {
    let f = fx();
    let a = endpoint(&f.root, A);
    let b = endpoint(&f.root, B);
    let c = endpoint(&f.root, "ses_dddddddd4");
    let now = now_ms();
    run(&f, "session-start", &a, now);
    run(&f, "session-start", &b, now);
    post(&f, &c, "from C");
    for e in [&a, &b] {
        run(&f, "post-tool", e, now + T);
        settle_pending(&f.state, &e.storage_profile());
    }
    let got_a = run(&f, "post-tool", &a, now + 2 * T).unwrap();
    assert!(got_a.contains("from C"));
    // A already saw it; B has not been shown it yet and must still get it.
    assert!(run(&f, "post-tool", &a, now + 3 * T).is_none());
    let got_b = run(&f, "post-tool", &b, now + 4 * T).unwrap();
    assert!(got_b.contains("from C"));
}

#[test]
fn hook_error_prints_nothing_exit_zero() {
    let f = fx();
    let a = endpoint(&f.root, A);
    let live = vec![a.clone()];
    for raw in ["", "not json", "{}", r#"{"session_id":"../x"}"#] {
        assert!(output_for(
            raw,
            "prompt",
            &live,
            &f.roots,
            &f.state,
            &f.store,
            1,
            &|_, _| None
        )
        .is_none());
    }
    let relative = format!(r#"{{"session_id":"{A}","cwd":"rel/dir"}}"#);
    assert!(output_for(
        &relative,
        "prompt",
        &live,
        &f.roots,
        &f.state,
        &f.store,
        1,
        &|_, _| None
    )
    .is_none());
    // The real binary: garbage on stdin, unusable state dir, exit 0 and empty stdout.
    for payload in ["garbage", &format!(r#"{{"session_id":"{A}","cwd":"/"}}"#)] {
        let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_session-bridge"))
            .args(["hook", "prompt", "--harness", "opencode"])
            .env("XDG_STATE_HOME", "/proc/nonexistent")
            .env("PATH", "/nonexistent")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(payload.as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        assert_eq!(out.status.code(), Some(0));
        assert!(out.stdout.is_empty(), "{:?}", out.stdout);
    }
}

struct OneApi {
    rows: std::collections::HashMap<String, serde_json::Value>,
    calls: std::sync::Mutex<Vec<String>>,
}
impl session_bridge_mcp::opencode_api::OcApi for OneApi {
    fn call(
        &self,
        method: &str,
        path: &str,
        _body: Option<&serde_json::Value>,
    ) -> impl std::future::Future<Output = anyhow::Result<serde_json::Value>> + Send {
        self.calls.lock().unwrap().push(format!("{method} {path}"));
        let r = path
            .strip_prefix("/api/session/")
            .and_then(|id| self.rows.get(id).cloned())
            .ok_or_else(|| anyhow::anyhow!("HTTP 404 Not Found"));
        async move { r }
    }
}

#[tokio::test]
async fn hook_resolves_session_with_exactly_one_lookup() {
    use serde_json::json;
    let row = |extra: serde_json::Value| {
        let mut v = json!({"id": "ses_ok1", "title": "t", "location": {"directory": "/repo"}});
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        json!({ "data": v })
    };
    let cases = [
        ("valid", json!({}), true),
        ("child", json!({"parentID": "ses_p"}), false),
        ("fork object", json!({"fork": {"of": "ses_p"}}), false),
        ("fork title", json!({"title": "t (fork #2)"}), false),
        ("archived", json!({"time": {"archived": 5}}), false),
    ];
    for (name, extra, ok) in cases {
        let api = OneApi {
            rows: [("ses_ok1".to_string(), row(extra))].into(),
            calls: Default::default(),
        };
        let got = session_bridge_mcp::opencode_hook::resolve_endpoint(
            &api,
            Path::new("/data"),
            "ses_ok1",
        )
        .await;
        assert_eq!(got.is_some(), ok, "{name}");
        assert_eq!(
            api.calls.lock().unwrap().as_slice(),
            ["GET /api/session/ses_ok1"],
            "{name}"
        );
        if ok {
            let e = got.unwrap();
            assert_eq!(e.directory.as_deref(), Some(Path::new("/repo")));
        }
    }
    let api = OneApi {
        rows: Default::default(),
        calls: Default::default(),
    };
    for id in ["ses_ok1", "../x", ""] {
        assert!(
            session_bridge_mcp::opencode_hook::resolve_endpoint(&api, Path::new("/d"), id)
                .await
                .is_none()
        );
    }
    // 404 made one call; the two invalid ids made none.
    assert_eq!(api.calls.lock().unwrap().len(), 1);
}

#[test]
fn hook_binary_resolves_with_one_api_call_and_never_starts_service() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    let state = root.join("state");
    fs::create_dir_all(&state).unwrap();
    fs::write(
        state.join("script.json"),
        serde_json::json!({
            "GET /api/session/ses_ok1": {"out": r#"{"data":{"id":"ses_ok1","title":"t","location":{"directory":"/tmp"}}}"#}
        })
        .to_string(),
    )
    .unwrap();
    // A symlink to the committed fixture, never a freshly written executable (ETXTBSY).
    let bin = root.join("opencode");
    std::os::unix::fs::symlink(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-opencode.py"),
        &bin,
    )
    .unwrap();
    fs::create_dir_all(root.join("xdg-data/opencode")).unwrap();
    for ev in ["session-start", "prompt", "post-tool"] {
        let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_session-bridge"))
            .args(["hook", ev, "--harness", "opencode"])
            .env("SESSION_BRIDGE_OPENCODE_BIN", &bin)
            .env("XDG_DATA_HOME", root.join("xdg-data"))
            .env("XDG_STATE_HOME", root.join("xdg-state"))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"session_id":"ses_ok1","cwd":"/tmp"}"#)
            .unwrap();
        let out = child.wait_with_output().unwrap();
        assert_eq!(out.status.code(), Some(0));
        let log: Vec<Vec<String>> = fs::read_to_string(state.join("argv.log"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        let want: Vec<String> = ["api", "GET", "/api/session/ses_ok1"]
            .map(String::from)
            .into();
        assert!(!log.is_empty(), "{ev}: the hook never reached the API");
        assert!(log.iter().all(|c| *c == want), "{ev}: {log:?}");
        assert!(!state.join("starts").exists(), "{ev}: service was started");
        fs::remove_file(state.join("argv.log")).unwrap();
    }
}
