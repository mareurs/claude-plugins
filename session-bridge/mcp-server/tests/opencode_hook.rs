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
