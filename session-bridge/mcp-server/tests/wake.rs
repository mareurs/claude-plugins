use session_bridge_mcp::endpoints::Roots;
use session_bridge_mcp::state::load_or_default;
use session_bridge_mcp::wake::{
    claim_watcher, guard_allows, release_watcher, wake_enabled, DEADLINE_MS,
};
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
        claim_watcher(&self.state, &self.roots, pid, now)
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
}

#[test]
fn second_claim_loses_while_the_first_is_alive() {
    let f = Fx::new();
    f.proc(100, 500);
    f.proc(200, 600);
    assert!(f.claim(100, 1_000));
    let s = load_or_default(&f.state);
    assert_eq!(s.watcher_pid, Some(100));
    assert_eq!(s.watch_until_ms, 1_000 + DEADLINE_MS);
    assert_ne!(s.watcher_started_ms, 0);
    assert!(!f.claim(200, 2_000));
    let s = load_or_default(&f.state);
    assert_eq!(s.watcher_pid, Some(100));
    assert_eq!(s.watch_until_ms, 1_000 + DEADLINE_MS);
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
    assert_eq!(s.watcher_started_ms, 0);
    assert!(f.claim(200, 2_000));
    release_watcher(&f.state, 999);
    let s = load_or_default(&f.state);
    assert_eq!(s.watcher_pid, Some(200));
    assert_eq!(s.watch_until_ms, 2_000 + DEADLINE_MS);
    assert_ne!(s.watcher_started_ms, 0);
}

#[test]
fn stale_claim_is_taken_over() {
    let f = Fx::new();
    f.proc(100, 500);
    f.proc(200, 600);
    assert!(f.claim(100, 1_000));
    std::fs::remove_dir_all(f.roots.proc_root.join("100")).unwrap();
    assert!(f.claim(200, 2_000));
    assert_eq!(load_or_default(&f.state).watcher_pid, Some(200));
}

#[test]
fn recycled_pid_does_not_keep_a_claim() {
    let f = Fx::new();
    f.proc(100, 5);
    f.proc(200, 600);
    assert!(f.claim(100, 1_000));
    f.proc(100, 9);
    assert!(f.claim(200, 2_000));
    assert_eq!(load_or_default(&f.state).watcher_pid, Some(200));
}
