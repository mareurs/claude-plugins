use session_bridge_mcp::store::{NewNotice, Origin, Store};
use std::sync::Arc;
use tempfile::TempDir;

const R: &str = "/work/r";
const Q: &str = "/work/q";
const DAY: i64 = 86_400_000;
const STEF: (&str, u32) = (".claude-stef", 1);

fn notice(repo: &str, profile: &str, pid: u32, at_ms: i64) -> NewNotice {
    NewNotice {
        at_ms,
        repo: repo.to_string(),
        author_profile: profile.to_string(),
        author_pid: pid,
        author_session: "sess".to_string(),
        origin: Origin::Manual,
        patch_id: None,
        title: "t".to_string(),
        body: "b".to_string(),
        refs: vec![],
    }
}

fn open() -> (TempDir, Store) {
    let d = TempDir::new().unwrap();
    let s = Store::open(&d.path().join("n.db")).unwrap();
    (d, s)
}

#[test]
fn post_then_after_returns_other_authors_only() {
    let (_d, s) = open();
    s.post(notice(R, ".claude-stef", 1, 1000)).unwrap();
    s.post(notice(R, ".claude-kat", 2, 1001)).unwrap();
    let page = s.after(R, 0, STEF).unwrap();
    assert_eq!(page.notices.len(), 1);
    assert_eq!(page.notices[0].author_profile, ".claude-kat");
    assert_eq!(page.notices[0].author_pid, 2);
    assert_eq!(page.next_cursor, 2);
}

#[test]
fn after_filters_by_repo_but_cursor_passes_other_repos() {
    let (_d, s) = open();
    for i in 0..5 {
        s.post(notice(Q, ".claude-kat", 2, 1000 + i)).unwrap();
    }
    let page = s.after(R, 0, STEF).unwrap();
    assert!(page.notices.is_empty());
    assert_eq!(page.next_cursor, 5);
}

#[test]
fn prune_records_a_gap() {
    let (_d, s) = open();
    s.post(notice(R, ".claude-kat", 2, 1000)).unwrap();
    s.post(notice(R, ".claude-kat", 2, 2000)).unwrap();
    s.post(notice(R, ".claude-kat", 2, 3000)).unwrap();
    assert_eq!(s.prune(2500).unwrap(), 2);
    assert_eq!(s.after(R, 0, STEF).unwrap().gap, Some((1, 2)));
    assert_eq!(s.after(R, 2, STEF).unwrap().gap, None);
    assert_eq!(s.prune(2500).unwrap(), 0);
}

#[test]
fn head_survives_prune_of_everything() {
    let (_d, s) = open();
    assert_eq!(s.head().unwrap(), 0);
    for i in 0..3 {
        s.post(notice(R, ".claude-kat", 2, 1000 + i)).unwrap();
    }
    assert_eq!(s.prune(i64::MAX).unwrap(), 3);
    assert_eq!(s.head().unwrap(), 3);
    assert_eq!(s.post(notice(R, ".claude-kat", 2, 5000)).unwrap(), 4);
}

#[test]
fn post_prunes_notices_older_than_fourteen_days() {
    let (_d, s) = open();
    let new_at = 100 * DAY;
    // Mutation: retention cutoff off by one (<= instead of <, or 14d +/- 1ms).
    s.post(notice(R, ".claude-kat", 2, new_at - 14 * DAY - 1)).unwrap(); // seq 1: deleted
    s.post(notice(R, ".claude-kat", 2, new_at - 14 * DAY)).unwrap(); // seq 2: exactly at cutoff, kept
    s.post(notice(R, ".claude-kat", 2, new_at)).unwrap(); // seq 3
    let page = s.after(R, 0, STEF).unwrap();
    let seqs: Vec<i64> = page.notices.iter().map(|n| n.seq).collect();
    assert_eq!(seqs, vec![2, 3]);
    assert_eq!(page.gap, Some((1, 1)));
}

#[test]
fn post_refuses_over_limits() {
    let (_d, s) = open();
    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.title = "x".repeat(121);
    let e = s.post(n).unwrap_err().to_string();
    assert!(e.contains("title") && e.contains("120"), "{e}");

    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.body = "x".repeat(4001);
    let e = s.post(n).unwrap_err().to_string();
    assert!(e.contains("body") && e.contains("4000"), "{e}");

    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.refs = (0..21).map(|i| i.to_string()).collect();
    let e = s.post(n).unwrap_err().to_string();
    assert!(e.contains("refs") && e.contains("20"), "{e}");

    assert_eq!(s.head().unwrap(), 0);
    assert!(s.after(R, 0, STEF).unwrap().notices.is_empty());

    // exactly at the limits is accepted, counted in characters
    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.title = "é".repeat(120);
    n.body = "é".repeat(4000);
    n.refs = (0..20).map(|i| i.to_string()).collect();
    s.post(n).unwrap();
}

#[test]
fn recent_is_newest_first_and_capped() {
    let (_d, s) = open();
    let now = 100 * DAY;
    for i in 0..10 {
        s.post(notice(R, ".claude-kat", 2, now - DAY + i)).unwrap();
    }
    // older than the window: must not show up
    s.post(notice(R, ".claude-kat", 2, now - 5 * DAY)).unwrap();
    let got = s.recent(R, now - 3 * DAY, 8, STEF).unwrap();
    assert_eq!(got.len(), 8);
    assert!(got.windows(2).all(|w| w[0].at_ms > w[1].at_ms));
    assert_eq!(got[0].at_ms, now - DAY + 9);
}


#[test]
fn has_patch_id_is_per_repo() {
    let (_d, s) = open();
    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.origin = Origin::Commit;
    n.patch_id = Some("P".to_string());
    s.post(n).unwrap();
    assert!(s.has_patch_id(R, "P").unwrap());
    assert!(!s.has_patch_id(Q, "P").unwrap());
    // Mutation: has_patch_id ignores the patch id and checks only the repo.
    assert!(!s.has_patch_id(R, "other-patch").unwrap());
}

#[test]
fn refs_and_fields_round_trip() {
    let (_d, s) = open();
    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.refs = vec!["a".into(), "b c".into()];
    n.origin = Origin::Commit;
    n.patch_id = Some("P".into());
    s.post(n).unwrap();
    let got = &s.after(R, 0, STEF).unwrap().notices[0];
    assert_eq!(got.refs, vec!["a".to_string(), "b c".to_string()]);
    assert_eq!(got.origin, Origin::Commit);
    assert_eq!(got.patch_id.as_deref(), Some("P"));
    assert_eq!(got.author_session, "sess");
}

#[test]
fn two_connections_post_concurrently() {
    let d = TempDir::new().unwrap();
    let path = Arc::new(d.path().join("n.db"));
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2u32)
        .map(|t| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let s = Store::open(&path).unwrap();
                barrier.wait();
                for i in 0..50 {
                    s.post(notice(R, ".claude-kat", t, 1000 + i)).unwrap();
                    std::thread::yield_now();
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let s = Store::open(&path).unwrap();
    let page = s.after(R, 0, STEF).unwrap();
    assert_eq!(page.notices.len(), 100);
    let mut seqs: Vec<i64> = page.notices.iter().map(|n| n.seq).collect();
    seqs.sort();
    seqs.dedup();
    assert_eq!(seqs.len(), 100);
    assert_eq!(s.head().unwrap(), 100);
}

#[test]
fn after_never_skips_a_notice_posted_during_the_read() {
    const N: i64 = 3000;
    let d = TempDir::new().unwrap();
    let path = Arc::new(d.path().join("n.db"));
    let reader = Store::open(&path).unwrap();
    let wpath = path.clone();
    let writer = std::thread::spawn(move || {
        let w = Store::open(&wpath).unwrap();
        for i in 0..N {
            w.post(notice(R, ".claude-kat", 2, 1000 + i)).unwrap();
        }
    });
    let mut cursor = 0;
    let mut seen: Vec<i64> = Vec::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    while cursor < N && std::time::Instant::now() < deadline {
        let page = reader.after(R, cursor, STEF).unwrap();
        seen.extend(page.notices.iter().map(|n| n.seq));
        cursor = page.next_cursor;
    }
    writer.join().unwrap();
    let expected: Vec<i64> = (1..=N).collect();
    let missing = expected.iter().filter(|s| !seen.contains(s)).count();
    assert_eq!(missing, 0, "{missing} of {N} notices were never seen");
    assert_eq!(seen, expected, "duplicates or out-of-order reads");
}

// Mutation: exclude by profile only. Two sessions of one profile must see each other.
#[test]
fn exclusion_needs_both_profile_and_pid() {
    let (_d, s) = open();
    s.post(notice(R, ".claude-stef", 7, 1000)).unwrap();
    s.post(notice(R, ".claude-stef", 1, 1001)).unwrap();
    let page = s.after(R, 0, (".claude-stef", 1)).unwrap();
    assert_eq!(page.notices.len(), 1);
    assert_eq!(page.notices[0].author_pid, 7);
    // same pid under another profile is a different endpoint too
    s.post(notice(R, ".claude-kat", 1, 1002)).unwrap();
    assert_eq!(s.after(R, 0, (".claude-stef", 1)).unwrap().notices.len(), 2);
}

#[test]
fn recent_window_is_inclusive_and_excludes_the_excluded_author() {
    let (_d, s) = open();
    let since = 50 * DAY;
    s.post(notice(R, ".claude-kat", 2, since - 1)).unwrap(); // seq 1: just outside
    s.post(notice(R, ".claude-kat", 2, since)).unwrap(); // seq 2: exactly at since
    s.post(notice(R, ".claude-stef", 1, since + 5)).unwrap(); // seq 3: excluded author
    s.post(notice(R, ".claude-kat", 2, since + 10)).unwrap(); // seq 4
    s.post(notice(Q, ".claude-kat", 2, since + 11)).unwrap(); // seq 5: other repo
    let got = s.recent(R, since, 8, STEF).unwrap();
    let seqs: Vec<i64> = got.iter().map(|n| n.seq).collect();
    assert_eq!(seqs, vec![4, 2]);
}
