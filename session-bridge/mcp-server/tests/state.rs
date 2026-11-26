use session_bridge_mcp::state::{
    current_session, endpoint_path, load_or_default, update, EndpointState, Verdict,
};
use std::sync::Arc;
use tempfile::TempDir;

#[test]
fn endpoint_path_joins_profile_and_pid() {
    let p = endpoint_path(std::path::Path::new("/s"), ".claude-stef", 42);
    assert_eq!(
        p,
        std::path::PathBuf::from("/s/endpoints/.claude-stef__42.json")
    );
}

#[test]
fn default_state_has_schema_one() {
    assert_eq!(EndpointState::default().schema, 1);
}

#[test]
fn read_locked_waits_for_a_running_update() {
    let d = TempDir::new().unwrap();
    let p = endpoint_path(d.path(), ".claude-stef", 42);
    update(&p, |s| s.pending = vec![]).unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let writer = {
        let p = p.clone();
        std::thread::spawn(move || {
            update(&p, |s| {
                tx.send(()).unwrap();
                std::thread::sleep(std::time::Duration::from_millis(300));
                s.pending = vec![1];
            })
            .unwrap();
        })
    };
    rx.recv().unwrap();
    // The update holds the lock: a locked read sees its result, not the state before it.
    assert_eq!(session_bridge_mcp::state::read_locked(&p).pending, vec![1]);
    writer.join().unwrap();
}

#[test]
fn read_locked_creates_no_file() {
    let d = TempDir::new().unwrap();
    let p = endpoint_path(&d.path().join("nowhere"), ".claude-stef", 42);
    assert_eq!(
        session_bridge_mcp::state::read_locked(&p),
        EndpointState::default()
    );
    assert!(!d.path().join("nowhere").exists());
    // A state dir without the lock file: still the default, still no file.
    let p = endpoint_path(d.path(), ".claude-stef", 42);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    assert_eq!(
        session_bridge_mcp::state::read_locked(&p),
        EndpointState::default()
    );
    assert_eq!(std::fs::read_dir(p.parent().unwrap()).unwrap().count(), 0);
}

#[test]
fn an_old_state_file_without_last_spawn_ms_loads_with_zero() {
    let d = TempDir::new().unwrap();
    let p = d.path().join("s.json");
    std::fs::write(
        &p,
        r#"{"schema":1,"session_id":"S","pending":[3],"worker_pid":7}"#,
    )
    .unwrap();
    let s = load_or_default(&p);
    assert_eq!(
        (s.last_spawn_ms, s.pending, s.worker_pid),
        (0, vec![3], Some(7))
    );
}

#[test]
fn missing_corrupt_and_partial_files_load_as_defaults() {
    let d = TempDir::new().unwrap();
    let p = d.path().join("s.json");
    assert_eq!(load_or_default(&p), EndpointState::default());
    std::fs::write(&p, "{not json").unwrap();
    assert_eq!(load_or_default(&p), EndpointState::default());
    std::fs::write(&p, "").unwrap();
    assert_eq!(load_or_default(&p), EndpointState::default());
    // unknown and missing fields do not fail the load
    std::fs::write(&p, r#"{"session_id":"S","future_field":[1,2]}"#).unwrap();
    let s = load_or_default(&p);
    assert_eq!(s.session_id, "S");
    assert_eq!(s.schema, 1);
    assert!(s.pending.is_empty());
    // a directory where the file should be is unreadable, still a default
    let dir = d.path().join("isdir.json");
    std::fs::create_dir(&dir).unwrap();
    assert_eq!(load_or_default(&dir), EndpointState::default());
}

#[test]
fn update_creates_parents_and_round_trips_every_field() {
    let d = TempDir::new().unwrap();
    let p = d.path().join("a/b/s.json");
    update(&p, |s| {
        s.session_id = "S".into();
        s.transcript_path = Some("/t".into());
        s.cwd = Some("/c".into());
        s.last_look_ms = 5;
        s.pending = vec![1, 2];
        s.verdicts = vec![Verdict {
            seq: 1,
            relevant: true,
            evidence: "e".into(),
            why: "w".into(),
            unfiltered_reason: Some("r".into()),
        }];
        s.delivered = vec![3];
        s.heads.insert("/wt".into(), "abc".into());
        s.last_post_ms = 9;
        s.worker_pid = Some(77);
        s.watcher_pid = Some(88);
        s.watch_until_ms = 22;
        s.wake_ms = vec![33, 44];
    })
    .unwrap();
    let s = load_or_default(&p);
    assert_eq!(s.session_id, "S");
    assert_eq!(s.watcher_pid, Some(88));
    assert_eq!(
        (s.watch_until_ms, s.wake_ms.clone()),
        (22, vec![33, 44])
    );
    assert_eq!(s.verdicts[0].unfiltered_reason.as_deref(), Some("r"));
    assert_eq!(s.heads.get("/wt").map(String::as_str), Some("abc"));
    assert_eq!(s.worker_pid, Some(77));
    assert_eq!(
        (s.last_look_ms, s.last_post_ms, s.pending, s.delivered),
        (5, 9, vec![1, 2], vec![3])
    );
    // no temp file is left behind
    let names: Vec<String> = std::fs::read_dir(p.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names.iter().all(|n| n == "s.json" || n == "s.json.lock"),
        "{names:?}"
    );
}

#[test]
fn update_is_atomic_and_locked() {
    let d = TempDir::new().unwrap();
    let p = Arc::new(d.path().join("endpoints/x.json"));
    let handles: Vec<_> = (0..20i64)
        .map(|i| {
            let p = p.clone();
            std::thread::spawn(move || update(&p, |s| s.pending.push(i)).unwrap())
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let mut got = load_or_default(&p).pending;
    assert_eq!(got.len(), 20);
    got.sort();
    assert_eq!(got, (0..20).collect::<Vec<_>>());
}

#[test]
fn a_panicking_closure_does_not_hold_the_lock_or_change_the_file() {
    let d = TempDir::new().unwrap();
    let p = d.path().join("s.json");
    update(&p, |s| s.pending.push(1)).unwrap();
    let pc = p.clone();
    let r = std::panic::catch_unwind(move || {
        let _ = update(&pc, |s| {
            s.pending.push(2);
            panic!("boom");
        });
    });
    assert!(r.is_err());
    // the lock is free: a following update (from another thread, as another process would) succeeds
    let pc = p.clone();
    std::thread::spawn(move || update(&pc, |s| s.pending.push(3)).unwrap())
        .join()
        .unwrap();
    assert_eq!(load_or_default(&p).pending, vec![1, 3]);
}

#[test]
fn a_failed_write_releases_the_lock_and_reports_an_error() {
    let d = TempDir::new().unwrap();
    // the state path is a directory: rename over it fails
    let p = d.path().join("s.json");
    std::fs::create_dir(&p).unwrap();
    std::fs::write(p.join("keep"), "x").unwrap();
    assert!(update(&p, |s| s.pending.push(1)).is_err());
    // lock is free again: a second call gets an error too, instead of hanging
    assert!(update(&p, |s| s.pending.push(2)).is_err());
    // and no stray temp file remains
    let names: Vec<String> = std::fs::read_dir(d.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names.iter().all(|n| n == "s.json" || n == "s.json.lock"),
        "{names:?}"
    );
}

fn registration(config: &std::path::Path, pid: u32, sid: &str) {
    let d = config.join("sessions");
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(
        d.join(format!("{pid}.json")),
        format!(r#"{{"pid":{pid},"sessionId":"{sid}"}}"#),
    )
    .unwrap();
}

#[test]
fn current_session_prefers_the_endpoint_state() {
    let d = TempDir::new().unwrap();
    let state = d.path().join("state");
    let config = d.path().join(".claude-stef");
    registration(&config, 9, "S1");
    // no state file: falls back to the registration
    assert_eq!(
        current_session(&state, &config, ".claude-stef", 9).as_deref(),
        Some("S1")
    );
    // a state file with an empty session id still falls back
    update(&endpoint_path(&state, ".claude-stef", 9), |s| {
        s.last_look_ms = 1
    })
    .unwrap();
    assert_eq!(
        current_session(&state, &config, ".claude-stef", 9).as_deref(),
        Some("S1")
    );
    // the state's id wins
    update(&endpoint_path(&state, ".claude-stef", 9), |s| {
        s.session_id = "S2".into()
    })
    .unwrap();
    assert_eq!(
        current_session(&state, &config, ".claude-stef", 9).as_deref(),
        Some("S2")
    );
    // another pid or profile does not see it
    assert_eq!(current_session(&state, &config, ".claude-stef", 10), None);
}

#[test]
fn update_is_atomic_for_unlocked_readers() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let d = TempDir::new().unwrap();
    let p = Arc::new(d.path().join("endpoints/r.json"));
    const SEED: usize = 100;
    update(&p, |s| {
        s.session_id = "S".into();
        s.pending = (0..SEED as i64).collect();
    })
    .unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let reader = {
        let (p, stop) = (p.clone(), stop.clone());
        std::thread::spawn(move || {
            let mut reads = 0u32;
            let mut last = SEED;
            while !stop.load(Ordering::Relaxed) {
                let s = load_or_default(&p);
                assert_eq!(
                    s.session_id, "S",
                    "an unlocked reader saw a torn or empty file"
                );
                assert!(
                    s.pending.len() >= last,
                    "pending shrank: {} < {last}",
                    s.pending.len()
                );
                assert!(s.pending.len() >= SEED);
                last = s.pending.len();
                reads += 1;
            }
            reads
        })
    };
    for i in 0..100i64 {
        update(&p, |s| s.pending.push(1000 + i)).unwrap();
    }
    stop.store(true, Ordering::Relaxed);
    let reads = reader.join().unwrap();
    assert!(reads >= 50, "reader only managed {reads} reads");
    assert_eq!(load_or_default(&p).pending.len(), SEED + 100);
}

#[test]
fn a_state_file_with_retired_fields_still_loads() {
    let d = TempDir::new().unwrap();
    let p = d.path().join("s.json");
    std::fs::write(
        &p,
        r#"{"schema":1,"session_id":"S","watcher_pid":88,"watcher_started_ms":11,"pid":5,"watch_until_ms":22}"#,
    )
    .unwrap();
    let s = load_or_default(&p);
    assert_eq!(s.session_id, "S");
    assert_eq!(s.watcher_pid, Some(88));
    assert_eq!(s.watch_until_ms, 22);
}
