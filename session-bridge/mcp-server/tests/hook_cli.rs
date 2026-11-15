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
    assert_eq!(o.status.code(), Some(0), "stderr: {}", String::from_utf8_lossy(&o.stderr));
    assert!(o.stdout.is_empty(), "stdout: {}", String::from_utf8_lossy(&o.stdout));
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
    let o = run(&["hook", "session-start"], "{}", d.path(), &[("SESSION_BRIDGE_TEST_PANIC", "1")]);
    silent_ok(&o);
    assert!(o.stderr.is_empty(), "the panic hook is silent");
}

#[test]
fn other_commands_keep_the_normal_clap_errors() {
    let d = TempDir::new().unwrap();
    let o = run(&["notices"], "", d.path(), &[]);
    assert_ne!(o.status.code(), Some(0), "a missing argument of `notices` is still an error");
}
