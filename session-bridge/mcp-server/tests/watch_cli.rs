//! Process-level tests of `session-bridge watch`: fail-open, silent unless it wakes.

use std::io::Write;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};
use tempfile::TempDir;

fn run_watch(stdin: &str, state: &std::path::Path, config: &std::path::Path) -> Output {
    let started = Instant::now();
    let mut child = Command::new(env!("CARGO_BIN_EXE_session-bridge"))
        .arg("watch")
        .env("XDG_STATE_HOME", state)
        .env("CLAUDE_CONFIG_DIR", config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // The watcher may exit without reading stdin; a broken pipe here is fine.
    let _ = child.stdin.take().unwrap().write_all(stdin.as_bytes());
    // A regression that arms under a Claude Code host would run for up to 7000 s: kill at the deadline.
    while child.try_wait().unwrap().is_none() {
        if started.elapsed() > Duration::from_secs(10) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("the watcher must not hang");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    child.wait_with_output().unwrap()
}

fn assert_silent_ok(o: &Output) {
    assert_eq!(
        o.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    assert!(o.stdout.is_empty(), "stdout not empty");
    assert!(
        o.stderr.is_empty(),
        "stderr: {}",
        String::from_utf8_lossy(&o.stderr)
    );
}

const INPUT: &str = r#"{"session_id":"s1","cwd":"/tmp"}"#;

#[test]
fn watch_without_the_marker_exits_0_silently() {
    let state = TempDir::new().unwrap();
    let config = TempDir::new().unwrap();
    let o = run_watch(INPUT, state.path(), config.path());
    assert_silent_ok(&o);
    assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
}

#[test]
fn watch_without_a_claude_ancestor_exits_0_silently() {
    // The test run may itself sit under a Claude Code session, whose ancestry the watcher
    // would find. Orphan the watcher (shell background job) so its parent chain ends at init.
    let state = TempDir::new().unwrap();
    let config = TempDir::new().unwrap();
    let work = TempDir::new().unwrap();
    std::fs::write(config.path().join("session-bridge-wake"), "").unwrap();
    std::fs::write(work.path().join("in"), INPUT).unwrap();
    let script = r#"cd "$W"; ( while kill -0 $$ 2>/dev/null; do sleep 0.05; done; "$BIN" watch <in >out 2>err; echo $? >code.tmp; mv code.tmp code ) >/dev/null 2>&1 &"#;
    let st = Command::new("sh")
        .arg("-c")
        .arg(script)
        .env("BIN", env!("CARGO_BIN_EXE_session-bridge"))
        .env("W", work.path())
        .env("XDG_STATE_HOME", state.path())
        .env("CLAUDE_CONFIG_DIR", config.path())
        .status()
        .unwrap();
    assert!(st.success());
    let started = Instant::now();
    let code = loop {
        if let Ok(c) = std::fs::read_to_string(work.path().join("code")) {
            break c;
        }
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the watcher must not hang"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(code.trim(), "0");
    assert!(std::fs::read(work.path().join("out")).unwrap().is_empty());
    assert!(std::fs::read(work.path().join("err")).unwrap().is_empty());
}

#[test]
fn watch_survives_garbage_stdin() {
    let state = TempDir::new().unwrap();
    let config = TempDir::new().unwrap();
    std::fs::write(config.path().join("session-bridge-wake"), "").unwrap();
    // The marker is present and the input does not parse: the watcher must reach the parse
    // and end silently with 0 (run_watch kills and fails at the deadline if it arms instead).
    let o = run_watch("not json", state.path(), config.path());
    assert_silent_ok(&o);
    assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
}
