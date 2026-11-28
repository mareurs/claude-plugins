#![cfg(unix)] // Unix-only: fakes /proc, unix permissions or process groups
//! The detached spawn the hook uses for the filter worker, checked on a harmless child
//! (`/bin/sh -c "sleep 30"`). No filter worker and no `claude` is started here.
//!
//! The spawn runs in a helper: this test binary, run again with `SB_SPAWN_HELPER` set and a
//! regular file as stdin and as stderr (stdout is the pipe the pid comes back on). The test's
//! own stdio may already be /dev/null (cargo started from a script), and an inherited fd
//! would then look right; a regular file or a pipe shows it. The helper is the child's
//! parent, so it reaps the child after the test kills it. The child sleeps 30 s, far longer
//! than the checks, so the kill never meets an exited (and reaped, or reused) pid.

use nix::sys::signal::{kill, Signal};
use nix::sys::wait::waitpid;
use nix::unistd::Pid;
use session_bridge_mcp::hook::spawn_detached;
use std::io::BufRead;
use std::path::Path;
use std::process::{Command, Stdio};

const HELPER: &str = "SB_SPAWN_HELPER";

/// Field 6 (session id) of `/proc/<pid>/stat`. The comm field (2) is in parentheses and can
/// hold spaces, so the fields are counted after its LAST `)`: state, ppid, pgrp, session.
fn session_of(pid: &str) -> i64 {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let rest = &stat[stat.rfind(')').unwrap() + 1..];
    rest.split_whitespace().nth(3).unwrap().parse().unwrap()
}

/// Only does something as the helper: spawn, report the pid, wait for (reap) the child.
#[test]
fn spawn_helper() {
    if std::env::var_os(HELPER).is_none() {
        return;
    }
    let pid = spawn_detached(Path::new("/bin/sh"), &["-c", "sleep 30"]).expect("the child starts");
    println!("PID={pid}");
    waitpid(Pid::from_raw(pid as i32), None).unwrap();
}

#[test]
fn the_child_runs_in_its_own_session_with_null_stdio() {
    let stdin = std::fs::File::open("/proc/self/stat").unwrap();
    let mut helper = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "spawn_helper", "--nocapture", "--test-threads=1"])
        .env(HELPER, "1")
        .stdin(stdin)
        .stdout(Stdio::piped())
        // A regular (unlinked) file: an inherited fd 2 shows up as `/tmp/… (deleted)`.
        .stderr(tempfile::tempfile().unwrap())
        .spawn()
        .unwrap();
    let mut out = std::io::BufReader::new(helper.stdout.take().unwrap()).lines();
    let pid: u32 = out
        .by_ref()
        .map_while(Result::ok)
        // The harness prints `test spawn_helper ... ` before the test's own output.
        .find_map(|l| l.split_once("PID=").map(|(_, p)| p.trim().parse().unwrap()))
        .expect("the helper reports the child pid");
    let p = pid.to_string();
    let checks = std::panic::catch_unwind(|| {
        assert_eq!(
            session_of(&p),
            i64::from(pid),
            "the child leads a new session"
        );
        assert_ne!(session_of(&p), session_of("self"), "not the test's session");
        for fd in 0..3 {
            let target = std::fs::read_link(format!("/proc/{p}/fd/{fd}")).unwrap();
            assert_eq!(target, Path::new("/dev/null"), "fd {fd}");
        }
    });
    // Leave no process behind, whatever the checks found: the helper reaps the child.
    kill(Pid::from_raw(pid as i32), Signal::SIGKILL).unwrap();
    // Read the helper's output to its end: a closed pipe would fail the helper's last write.
    out.for_each(drop);
    assert!(helper.wait().unwrap().success());
    if let Err(e) = checks {
        std::panic::resume_unwind(e);
    }
}
