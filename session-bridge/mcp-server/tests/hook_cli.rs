//! Process-level tests: a hook never exits non-zero and never prints on an internal error.

use std::io::Write;
use std::process::{Command, Output, Stdio};
use tempfile::TempDir;

fn run(args: &[&str], stdin: &str, state: &std::path::Path, envs: &[(&str, &str)]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_session-bridge"));
    cmd.args(args)
        .env("XDG_STATE_HOME", state)
        .env("CLAUDE_CONFIG_DIR", "/nonexistent/.claude-stef")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().unwrap();
    // The hook may exit without reading stdin; a broken pipe here is fine.
    let _ = child.stdin.take().unwrap().write_all(stdin.as_bytes());
    child.wait_with_output().unwrap()
}

fn silent_ok(o: &Output) {
    assert_eq!(
        o.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    assert!(
        o.stdout.is_empty(),
        "stdout: {}",
        String::from_utf8_lossy(&o.stdout)
    );
}

#[test]
fn unknown_event_and_missing_argument_exit_zero_silently() {
    let d = TempDir::new().unwrap();
    silent_ok(&run(&["hook", "bogus-event"], "", d.path(), &[]));
    silent_ok(&run(&["hook"], "", d.path(), &[]));
    silent_ok(&run(&["hook", "--no-such-flag"], "", d.path(), &[]));
}

#[test]
fn malformed_json_exits_zero_silently_and_creates_no_files() {
    let d = TempDir::new().unwrap();
    silent_ok(&run(&["hook", "session-start"], "{not json", d.path(), &[]));
    silent_ok(&run(&["hook", "session-start"], "", d.path(), &[]));
    assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 0);
}

#[test]
fn a_panic_in_the_hook_body_exits_zero_silently() {
    let d = TempDir::new().unwrap();
    let o = run(
        &["hook", "session-start"],
        "{}",
        d.path(),
        &[("SESSION_BRIDGE_TEST_PANIC", "1")],
    );
    silent_ok(&o);
    assert!(o.stderr.is_empty(), "the panic hook is silent");
}

#[test]
fn other_commands_keep_the_normal_clap_errors() {
    let d = TempDir::new().unwrap();
    let o = run(&["notices"], "", d.path(), &[]);
    assert_ne!(
        o.status.code(),
        Some(0),
        "a missing argument of `notices` is still an error"
    );
}
#[test]
fn non_utf8_argument_exits_zero_silently() {
    use std::os::unix::ffi::OsStrExt;
    let d = TempDir::new().unwrap();
    let bad = std::ffi::OsStr::from_bytes(b"\xff\xfe");
    let o = Command::new(env!("CARGO_BIN_EXE_session-bridge"))
        .arg("hook")
        .arg(bad)
        .env("XDG_STATE_HOME", d.path())
        .stdin(Stdio::null())
        .output()
        .unwrap();
    silent_ok(&o);
    // A non-UTF-8 FIRST argument is the one `std::env::args()` panics on (exit 101).
    let o = Command::new(env!("CARGO_BIN_EXE_session-bridge"))
        .arg(bad)
        .env("XDG_STATE_HOME", d.path())
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_ne!(
        o.status.code(),
        Some(101),
        "no panic exit: {}",
        String::from_utf8_lossy(&o.stderr)
    );
}

fn tree(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            out.push(e.path());
            if e.path().is_dir() {
                out.extend(tree(&e.path()));
            }
        }
    }
    out
}

#[test]
fn prompt_and_post_tool_without_a_database_or_with_bad_input_exit_zero_and_write_nothing() {
    let d = TempDir::new().unwrap();
    let home = d.path().join("home");
    let state = d.path().join("xdg");
    // The state root exists, so anything that opened the store would create notices.db.
    let root = state.join("session-bridge");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&root).unwrap();
    let home_s = home.to_string_lossy().into_owned();
    let good = r#"{"session_id":"S","cwd":"/tmp","hook_event_name":"PostToolUse","tool_input":{"command":"git commit"}}"#;
    for event in ["prompt", "post-tool"] {
        for stdin in ["{not json", "", "[]", good] {
            let o = run(
                &["hook", event],
                stdin,
                &state,
                &[("HOME", home_s.as_str())],
            );
            silent_ok(&o);
            assert!(
                o.stderr.is_empty(),
                "{event} {stdin:?}: {}",
                String::from_utf8_lossy(&o.stderr)
            );
        }
    }
    let mut t = tree(d.path());
    t.sort();
    assert_eq!(
        t,
        vec![home.clone(), state.clone(), root.clone()],
        "no file was created"
    );
}

#[test]
fn a_panic_in_prompt_or_post_tool_exits_zero_silently() {
    let d = TempDir::new().unwrap();
    for event in ["prompt", "post-tool"] {
        let o = run(
            &["hook", event],
            "{}",
            d.path(),
            &[("SESSION_BRIDGE_TEST_PANIC", "1"), ("HOME", "/nonexistent")],
        );
        silent_ok(&o);
        assert!(o.stderr.is_empty());
    }
}
/// `HOME=""` and no `XDG_STATE_HOME`: there is no absolute state root. The child's cwd is a
/// temp dir, so a relative root would land there.
fn run_without_state_root(args: &[&str], stdin: &str, cwd: &std::path::Path) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_session-bridge"))
        .args(args)
        .current_dir(cwd)
        .env("HOME", "")
        .env_remove("XDG_STATE_HOME")
        .env("CLAUDE_CONFIG_DIR", "/nonexistent/.claude-stef")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let _ = child.stdin.take().unwrap().write_all(stdin.as_bytes());
    child.wait_with_output().unwrap()
}

/// The hook only gets as far as the state root when a Claude Code process with a messaging
/// socket is among its ancestors (it is when these tests run inside a Claude Code session; the
/// pure `state_root` test in tests/paths.rs carries the rule everywhere else).
#[test]
fn without_an_absolute_state_root_nothing_is_created_in_the_cwd() {
    let d = TempDir::new().unwrap();
    let cwd = d.path().to_string_lossy().into_owned();
    let start = format!(
        r#"{{"session_id":"S","cwd":"{cwd}","hook_event_name":"SessionStart","source":"startup"}}"#
    );
    let prompt =
        format!(r#"{{"session_id":"S","cwd":"{cwd}","hook_event_name":"UserPromptSubmit"}}"#);
    silent_ok(&run_without_state_root(
        &["hook", "session-start"],
        &start,
        d.path(),
    ));
    silent_ok(&run_without_state_root(
        &["hook", "prompt"],
        &prompt,
        d.path(),
    ));
    silent_ok(&run_without_state_root(
        &["notices", "--repo", &cwd, "--after", "0"],
        "",
        d.path(),
    ));
    silent_ok(&run_without_state_root(
        &["filter", "--profile", ".claude-stef", "--pid", "1"],
        "",
        d.path(),
    ));
    assert_eq!(
        tree(d.path()),
        Vec::<std::path::PathBuf>::new(),
        "nothing was created in the cwd"
    );
}
