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
    s.post(notice(R, ".claude-kat", 2, 1000)).unwrap();
    s.post(notice(R, ".claude-kat", 2, 1000 + 14 * DAY + 1)).unwrap();
    let page = s.after(R, 0, STEF).unwrap();
    assert_eq!(page.notices.len(), 1);
    assert_eq!(page.notices[0].seq, 2);
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
    let handles: Vec<_> = (0..2u32)
        .map(|t| {
            let path = path.clone();
            std::thread::spawn(move || {
                let s = Store::open(&path).unwrap();
                for i in 0..50 {
                    s.post(notice(R, ".claude-kat", t, 1000 + i)).unwrap();
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
