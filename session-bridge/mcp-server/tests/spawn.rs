//! The detached spawn the hook uses for the filter worker, checked on a harmless child
//! (`/bin/sh -c "sleep 2"`). No filter worker and no `claude` is started here.

use nix::sys::signal::{kill, Signal};
use nix::sys::wait::waitpid;
use nix::unistd::Pid;
use session_bridge_mcp::hook::spawn_detached;
use std::path::Path;

/// Field 6 (session id) of `/proc/<pid>/stat`. The comm field (2) is in parentheses and can
/// hold spaces, so the fields are counted after its LAST `)`: state, ppid, pgrp, session.
fn session_of(pid: &str) -> i64 {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let rest = &stat[stat.rfind(')').unwrap() + 1..];
    rest.split_whitespace().nth(3).unwrap().parse().unwrap()
}

#[test]
fn the_child_runs_in_its_own_session_with_null_stdio() {
    let pid = spawn_detached(Path::new("/bin/sh"), &["-c", "sleep 2"]).expect("the child starts");
    let p = pid.to_string();
    let checks = std::panic::catch_unwind(|| {
        assert_eq!(session_of(&p), i64::from(pid), "the child leads a new session");
        assert_ne!(session_of(&p), session_of("self"), "not the test's session");
        for fd in 0..3 {
            let target = std::fs::read_link(format!("/proc/{p}/fd/{fd}")).unwrap();
            assert_eq!(target, Path::new("/dev/null"), "fd {fd}");
        }
    });
    // Leave no process behind, whatever the checks found.
    let child = Pid::from_raw(pid as i32);
    kill(child, Signal::SIGKILL).unwrap();
    waitpid(child, None).unwrap();
    if let Err(e) = checks {
        std::panic::resume_unwind(e);
    }
}
