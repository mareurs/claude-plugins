use session_bridge_mcp::cursor::get_direct;
use session_bridge_mcp::direct::take;
use session_bridge_mcp::endpoints::Roots;
use session_bridge_mcp::hook::HookInput;
use session_bridge_mcp::state::{endpoint_path, load_or_default, update};
use session_bridge_mcp::store::{NewNotice, Origin, Store};
use session_bridge_mcp::wake::{
    claim_watcher, guard_allows, release_watcher, wake_enabled, watch, Clock, WatchOutcome,
    DEADLINE_MS, POLL_MS,
};
use std::cell::Cell;
use std::collections::HashMap;
use std::path::PathBuf;
use tempfile::TempDir;

fn env_of(pairs: Vec<(&'static str, String)>) -> impl Fn(&str) -> Option<String> {
    let m: HashMap<&'static str, String> = pairs.into_iter().collect();
    move |k: &str| m.get(k).cloned()
}

struct Fx {
    _d: TempDir,
    roots: Roots,
    state: PathBuf,
}

impl Fx {
    fn new() -> Self {
        let d = TempDir::new().unwrap();
        let proc_root = d.path().join("proc");
        std::fs::create_dir_all(&proc_root).unwrap();
        std::fs::write(proc_root.join("stat"), "cpu  1 2 3 4\nbtime 1000\n").unwrap();
        let roots = Roots {
            proc_root,
            socks: d.path().join("socks"),
        };
        let state = d.path().join("endpoint.json");
        Fx {
            _d: d,
            roots,
            state,
        }
    }

    /// A fake process `pid` that started at clock tick `ticks`.
    fn proc(&self, pid: u32, ticks: u64) {
        let dir = self.roots.proc_root.join(pid.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("stat"),
            format!("{pid} (claude) S 1 {pid} {pid} 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 12 0 {ticks} 1000000000 2000 18446744073709551615\n"),
        )
        .unwrap();
    }

    fn claim(&self, pid: u32, now: i64) -> bool {
        claim_watcher(&self.state, pid, now)
    }
}

#[test]
fn marker_file_enables_wake() {
    let d = TempDir::new().unwrap();
    let env = env_of(vec![(
        "CLAUDE_CONFIG_DIR",
        d.path().to_string_lossy().into(),
    )]);
    assert!(!wake_enabled(&env));
    std::fs::write(d.path().join("session-bridge-wake"), "").unwrap();
    assert!(wake_enabled(&env));
}

#[test]
fn config_dir_falls_back_to_home_dot_claude() {
    let d = TempDir::new().unwrap();
    let env = env_of(vec![("HOME", d.path().to_string_lossy().into())]);
    assert!(!wake_enabled(&env));
    std::fs::create_dir_all(d.path().join(".claude")).unwrap();
    std::fs::write(d.path().join(".claude/session-bridge-wake"), "").unwrap();
    assert!(wake_enabled(&env));
}

#[test]
fn guard_allows_first_wake_and_blocks_within_60s() {
    assert!(guard_allows(&[], 1_000_000));
    assert!(!guard_allows(&[1_000_000], 1_059_999));
    assert!(guard_allows(&[1_000_000], 1_060_000));
}

#[test]
fn guard_blocks_the_eleventh_wake_in_an_hour() {
    let start = 10_000_000i64;
    let wakes: Vec<i64> = (0..10).map(|i| start + i * 61_000).collect();
    let t = *wakes.last().unwrap();
    assert!(!guard_allows(&wakes, t + 61_000));
    // oldest wake is over an hour old
    assert!(guard_allows(&wakes, start + 3_600_001));
    // a wake exactly one hour old still counts: the window is inclusive
    assert!(!guard_allows(&wakes, start + 3_600_000));
}

#[test]
fn the_second_claim_wins_while_the_first_is_alive() {
    let f = Fx::new();
    f.proc(100, 500);
    f.proc(200, 600);
    assert!(f.claim(100, 1_000));
    let s = load_or_default(&f.state);
    assert_eq!(s.watcher_pid, Some(100));
    assert_eq!(s.watch_until_ms, 1_000 + DEADLINE_MS);
    assert!(f.claim(200, 2_000));
    let s = load_or_default(&f.state);
    assert_eq!(s.watcher_pid, Some(200));
    assert_eq!(s.watch_until_ms, 2_000 + DEADLINE_MS);
}

#[test]
fn claim_is_free_after_release() {
    let f = Fx::new();
    f.proc(100, 500);
    f.proc(200, 600);
    assert!(f.claim(100, 1_000));
    release_watcher(&f.state, 100);
    let s = load_or_default(&f.state);
    assert_eq!(s.watch_until_ms, 0);
    assert_eq!(s.watcher_pid, None);
    assert!(f.claim(200, 2_000));
    release_watcher(&f.state, 999);
    let s = load_or_default(&f.state);
    assert_eq!(s.watcher_pid, Some(200));
    assert_eq!(s.watch_until_ms, 2_000 + DEADLINE_MS);
}

// ---- watch ----

const PROFILE: &str = ".claude-stef";
const CLAUDE_PID: u32 = 20;
const T0: i64 = 1_800_000_000_000;

struct W {
    f: Fx,
    state_dir: PathBuf,
    store: Store,
}

impl W {
    fn new() -> Self {
        let f = Fx::new();
        let state_dir = f._d.path().join("state");
        std::fs::create_dir_all(&state_dir).unwrap();
        let store = Store::open(&state_dir.join("notices.db")).unwrap();
        W {
            f,
            state_dir,
            store,
        }
    }

    /// A W whose fake proc holds the Claude pid.
    fn alive() -> Self {
        let w = W::new();
        w.f.proc(CLAUDE_PID, 500);
        w
    }

    fn path(&self) -> PathBuf {
        endpoint_path(&self.state_dir, PROFILE, CLAUDE_PID)
    }

    fn post_to(&self, to: &str, title: &str) -> i64 {
        post(&self.store, to, title)
    }

    fn run(&self, input: &HookInput, now: &Cell<i64>, on_sleep: &dyn Fn(u32)) -> WatchOutcome {
        let calls = Cell::new(0u32);
        let now_fn = || now.get();
        let sleep = |ms: u64| {
            now.set(now.get() + ms as i64);
            calls.set(calls.get() + 1);
            on_sleep(calls.get());
        };
        let clock = Clock {
            now_ms: &now_fn,
            sleep_ms: &sleep,
        };
        watch(
            input,
            (PROFILE, CLAUDE_PID),
            &self.f.roots,
            &self.state_dir,
            &self.store,
            &clock,
        )
    }

    fn watch(&self, input: &HookInput, now: &Cell<i64>) -> WatchOutcome {
        self.run(input, now, &|_| {})
    }

    fn cursor(&self, id: &str) -> i64 {
        get_direct(&self.state_dir, PROFILE, id)
    }
}

fn post(store: &Store, to: &str, title: &str) -> i64 {
    store
        .post(NewNotice {
            at_ms: 1_700_000_000_000,
            repo: "/work/r".into(),
            author_profile: ".claude-kat".into(),
            author_pid: 5,
            author_session: "AUTHORSESSION".into(),
            origin: Origin::Manual,
            patch_id: None,
            title: title.into(),
            body: "body".into(),
            refs: vec![],
            to_session: Some(to.to_string()),
        })
        .unwrap()
}

fn input(id: &str) -> HookInput {
    HookInput {
        session_id: id.into(),
        ..Default::default()
    }
}

#[test]
fn a_notice_for_the_session_wakes_once() {
    let w = W::alive();
    w.post_to("s1", "hello there");
    let now = Cell::new(T0);
    match w.watch(&input("s1"), &now) {
        WatchOutcome::Wake(t) => assert!(t.contains("hello there"), "{t}"),
        o => panic!("expected a wake, got {o:?}"),
    }
    // wake_ms is recorded, so a second watch can only end at the deadline with nothing new
    assert_eq!(w.watch(&input("s1"), &now), WatchOutcome::Done);
    assert!(now.get() >= T0 + DEADLINE_MS);
}

#[test]
fn a_notice_for_another_id_does_not_wake() {
    let w = W::alive();
    w.post_to("s2", "not yours");
    let now = Cell::new(T0);
    assert_eq!(w.watch(&input("s1"), &now), WatchOutcome::Done);
    assert!(now.get() >= T0 + DEADLINE_MS, "ran to the deadline");
    assert_eq!(w.cursor("s2"), 0);
}

#[test]
fn a_notice_posted_while_waiting_wakes() {
    let w = W::alive();
    let now = Cell::new(T0);
    let out = w.run(&input("s1"), &now, &|n| {
        if n == 3 {
            w.post_to("s1", "late arrival");
        }
    });
    match out {
        WatchOutcome::Wake(t) => assert!(t.contains("late arrival"), "{t}"),
        o => panic!("expected a wake, got {o:?}"),
    }
    assert!(now.get() < T0 + DEADLINE_MS);
}

#[test]
fn the_old_id_after_clear_still_wakes() {
    let w = W::alive();
    update(&w.path(), |s| s.session_id = "old".into()).unwrap();
    w.post_to("old", "for the old id");
    let now = Cell::new(T0);
    match w.watch(&input("s1"), &now) {
        WatchOutcome::Wake(t) => assert!(t.contains("for the old id"), "{t}"),
        o => panic!("expected a wake, got {o:?}"),
    }
}

#[test]
fn host_gone_exits_without_taking() {
    // no proc/<claude pid>: the host check of the first pass fails before any peek
    let w = W::new();
    w.post_to("s1", "hello");
    let now = Cell::new(T0);
    assert_eq!(w.watch(&input("s1"), &now), WatchOutcome::Done);
    assert_eq!(w.cursor("s1"), 0);
    assert_eq!(load_or_default(&w.path()).watcher_pid, None);
}

#[test]
fn host_gone_while_waiting_exits_without_taking() {
    let w = W::alive();
    let now = Cell::new(T0);
    let out = w.run(&input("s1"), &now, &|n| {
        if n == 2 {
            w.post_to("s1", "hello");
            std::fs::remove_dir_all(w.f.roots.proc_root.join(CLAUDE_PID.to_string())).unwrap();
        }
    });
    assert_eq!(out, WatchOutcome::Done);
    assert_eq!(w.cursor("s1"), 0);
}

#[test]
fn the_guard_blocks_and_the_notice_survives() {
    let w = W::alive();
    update(&w.path(), |s| s.wake_ms = vec![T0 - 1_000]).unwrap();
    w.post_to("s1", "held back");
    let now = Cell::new(T0);
    assert_eq!(w.watch(&input("s1"), &now), WatchOutcome::Done);
    assert_eq!(w.cursor("s1"), 0);
    let got = take(
        &["s1"],
        (PROFILE, CLAUDE_PID),
        &w.f.roots,
        &w.state_dir,
        &w.store,
    );
    assert!(got.expect("still deliverable").contains("held back"));
}

#[test]
fn a_wake_is_recorded_for_the_guard() {
    let w = W::alive();
    let old = T0 - 4_000_000;
    update(&w.path(), |s| s.wake_ms = vec![old]).unwrap();
    w.post_to("s1", "hello");
    let now = Cell::new(T0);
    assert!(matches!(w.watch(&input("s1"), &now), WatchOutcome::Wake(_)));
    let wakes = load_or_default(&w.path()).wake_ms;
    assert_eq!(wakes, vec![T0], "entries older than an hour are dropped");
}

#[test]
fn a_subagent_never_arms() {
    let w = W::alive();
    w.post_to("s1", "hello");
    let now = Cell::new(T0);
    let mut i = input("s1");
    i.agent_id = Some("a".into());
    assert_eq!(w.watch(&i, &now), WatchOutcome::Done);
    assert_eq!(load_or_default(&w.path()).watcher_pid, None);
    assert_eq!(w.cursor("s1"), 0);
}

#[test]
fn release_happens_before_returning() {
    let w = W::alive();
    w.post_to("s1", "hello");
    let now = Cell::new(T0);
    assert!(matches!(w.watch(&input("s1"), &now), WatchOutcome::Wake(_)));
    let s = load_or_default(&w.path());
    assert_eq!(s.watcher_pid, None);
    assert_eq!(s.watch_until_ms, 0);
    // a re-arm after the wake is not refused by a stale claim
    assert_eq!(w.watch(&input("s1"), &now), WatchOutcome::Done);
    assert!(now.get() >= T0 + DEADLINE_MS, "second watch really ran");
    assert_eq!(load_or_default(&w.path()).watcher_pid, None);
}

#[test]
fn a_later_watcher_takes_the_slot_and_the_first_exits_within_one_poll() {
    let w = W::alive();
    let now = Cell::new(T0);
    // the first watcher runs; at its first sleep a newer arm takes the slot
    let out = w.run(&input("s1"), &now, &|n| {
        if n == 1 {
            assert!(claim_watcher(&w.path(), 77, now.get()));
        }
    });
    assert_eq!(out, WatchOutcome::Done);
    assert_eq!(now.get(), T0 + POLL_MS as i64, "exits within one poll");
    let s = load_or_default(&w.path());
    assert_eq!(s.watcher_pid, Some(77), "the newer claim stays");
    assert_eq!(s.watch_until_ms, T0 + POLL_MS as i64 + DEADLINE_MS);
}

#[test]
fn polling_uses_the_poll_interval() {
    let w = W::alive();
    let now = Cell::new(T0);
    let first = Cell::new(0i64);
    let out = w.run(&input("s1"), &now, &|n| {
        if n == 1 {
            first.set(now.get());
        }
    });
    assert_eq!(out, WatchOutcome::Done);
    assert_eq!(first.get(), T0 + POLL_MS as i64);
}

#[test]
fn a_guard_block_releases_the_claim() {
    let w = W::alive();
    update(&w.path(), |s| s.wake_ms = vec![T0 - 1_000]).unwrap();
    w.post_to("s1", "held back");
    let now = Cell::new(T0);
    assert_eq!(w.watch(&input("s1"), &now), WatchOutcome::Done);
    assert_eq!(load_or_default(&w.path()).watcher_pid, None);
}

#[test]
fn a_wake_keeps_a_wake_exactly_one_hour_old_and_drops_an_older_one() {
    let w = W::alive();
    update(&w.path(), |s| {
        s.wake_ms = vec![T0 - 3_600_000, T0 - 3_600_001];
    })
    .unwrap();
    w.post_to("s1", "hello");
    let now = Cell::new(T0);
    assert!(matches!(w.watch(&input("s1"), &now), WatchOutcome::Wake(_)));
    assert_eq!(load_or_default(&w.path()).wake_ms, vec![T0 - 3_600_000, T0]);
}

#[test]
fn a_watcher_that_lost_its_claim_exits_and_leaves_the_new_claim() {
    let w = W::alive();
    let now = Cell::new(T0);
    let out = w.run(&input("s1"), &now, &|n| {
        if n == 1 {
            update(&w.path(), |s| s.watcher_pid = Some(999_999)).unwrap();
        }
    });
    assert_eq!(out, WatchOutcome::Done);
    assert!(now.get() < T0 + DEADLINE_MS, "exited before the deadline");
    assert_eq!(load_or_default(&w.path()).watcher_pid, Some(999_999));
}
