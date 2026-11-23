use session_bridge_mcp::error::BridgeError;
use session_bridge_mcp::server::{
    addressed_result, post_notice_from, post_notice_impl, PostNoticeArgs,
};
use session_bridge_mcp::state::{endpoint_path, load_or_default, update, EndpointState};
use session_bridge_mcp::store::{advised_note, NewNotice, Origin, Store};
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
        to_session: None,
    }
}
fn addressed(repo: &str, to: &str, at_ms: i64, title: &str) -> NewNotice {
    let mut n = notice(repo, ".claude-kat", 2, at_ms);
    n.to_session = Some(to.to_string());
    n.title = title.to_string();
    n
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
    s.post(notice(R, ".claude-kat", 2, new_at - 14 * DAY - 1))
        .unwrap(); // seq 1: deleted
    s.post(notice(R, ".claude-kat", 2, new_at - 14 * DAY))
        .unwrap(); // seq 2: exactly at cutoff, kept
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
    n.title = "x".repeat(150);
    let e = s.post(n).unwrap_err().to_string();
    assert!(
        e.contains("title") && e.contains("150") && e.contains("144"),
        "{e}"
    );
    assert!(e.contains("Cut at least 6"), "{e}");
    assert!(e.contains("advised 120"), "the advised limit is named: {e}");

    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.body = "x".repeat(4900);
    let e = s.post(n).unwrap_err().to_string();
    assert!(
        e.contains("body") && e.contains("4900") && e.contains("4800"),
        "{e}"
    );
    assert!(e.contains("Cut at least 100"), "{e}");

    // One character past the tolerance is refused, on both fields.
    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.title = "x".repeat(145);
    assert!(s.post(n).is_err());
    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.body = "x".repeat(4801);
    assert!(s.post(n).is_err());

    // refs have no tolerance: a count is not a length.
    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.refs = (0..21).map(|i| i.to_string()).collect();
    let e = s.post(n).unwrap_err().to_string();
    assert!(
        e.contains("refs") && e.contains("21") && e.contains("20"),
        "{e}"
    );
    assert!(e.contains("Cut at least 1"), "{e}");
    assert!(
        !e.contains("advised"),
        "refs name no separate advised limit: {e}"
    );

    assert_eq!(s.head().unwrap(), 0);
    assert!(s.after(R, 0, STEF).unwrap().notices.is_empty());
}

#[test]
fn post_accepts_a_fifth_over_the_advised_limits_and_stores_it_whole() {
    let (_d, s) = open();
    // 120 and 4000 are the advised limits; a fifth more is tolerated, counted in characters.
    let mut n = notice(R, ".claude-kat", 2, 1000);
    n.title = "é".repeat(144);
    n.body = "é".repeat(4800);
    n.refs = (0..20).map(|i| i.to_string()).collect();
    s.post(n).unwrap();
    let got = s.after(R, 0, STEF).unwrap();
    assert_eq!(got.notices.len(), 1);
    assert_eq!(
        got.notices[0].title.chars().count(),
        144,
        "title is not cut"
    );
    assert_eq!(got.notices[0].body.chars().count(), 4800, "body is not cut");
}

#[test]
fn advised_note_is_silent_at_the_advised_limits_and_counts_characters() {
    assert_eq!(advised_note(&"é".repeat(120), &"é".repeat(4000)), None);
    assert_eq!(advised_note("t", "b"), None);
}

#[test]
fn advised_note_names_each_field_that_went_over() {
    let t = advised_note(&"x".repeat(130), "b").expect("title is over");
    assert!(t.contains("title has 130 characters (advised 120)"), "{t}");
    assert!(!t.contains("body"), "{t}");

    let b = advised_note("t", &"x".repeat(4100)).expect("body is over");
    assert!(b.contains("body has 4100 characters (advised 4000)"), "{b}");
    assert!(!b.contains("title"), "{b}");

    let both = advised_note(&"x".repeat(121), &"x".repeat(4001)).expect("both are over");
    assert!(
        both.contains("title has 121") && both.contains("body has 4001"),
        "{both}"
    );
    assert!(both.starts_with("Accepted whole"), "{both}");
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
fn post_commit_once_dedupes_per_repo() {
    // Through `post_commit_once`, the only reader of a stored patch-id.
    let (_d, s) = open();
    let commit = |repo: &str, patch: &str| {
        let mut n = notice(repo, ".claude-kat", 2, 1000);
        n.origin = Origin::Commit;
        n.patch_id = Some(patch.to_string());
        n
    };
    assert_eq!(s.post_commit_once(commit(R, "P")).unwrap(), Some(1));
    assert_eq!(
        s.post_commit_once(commit(R, "P")).unwrap(),
        None,
        "the same patch in the same repo"
    );
    assert_eq!(
        s.post_commit_once(commit(Q, "P")).unwrap(),
        Some(2),
        "another repo is another namespace"
    );
    // Mutation: the check ignores the patch id and looks only at the repo.
    assert_eq!(
        s.post_commit_once(commit(R, "other-patch")).unwrap(),
        Some(3)
    );
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

// Pins the `open` init race and distinct seqs, not interleaving of writers (SQLite serialises them).
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
    const N: i64 = 200;
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
                                                              // seq 6: same profile, other pid, inside the window. It must be returned, so a
                                                              // profile-only exclusion fails; seq 3 (same pid and profile) must stay out.
    s.post(notice(R, ".claude-stef", 7, since + 12)).unwrap();
    // seq 7: same pid, other profile: a pid-only exclusion would drop it.
    s.post(notice(R, ".claude-kat", 1, since + 13)).unwrap();
    let got = s.recent(R, since, 8, STEF).unwrap();
    let seqs: Vec<i64> = got.iter().map(|n| n.seq).collect();
    assert_eq!(seqs, vec![7, 6, 4, 2]);
}

fn git_repo() -> TempDir {
    let d = TempDir::new().unwrap();
    let ok = std::process::Command::new("git")
        .args(["init", "-q"])
        .arg(d.path())
        .status()
        .unwrap()
        .success();
    assert!(ok);
    d
}

fn args(title: &str) -> PostNoticeArgs {
    PostNoticeArgs {
        title: title.to_string(),
        body: "body".to_string(),
        refs: vec!["a.rs".to_string()],
        to: None,
    }
}

#[test]
fn post_notice_records_author_endpoint_and_current_session() {
    let state = TempDir::new().unwrap();
    let repo = git_repo();
    let sub = repo.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    update(&endpoint_path(state.path(), ".claude-stef", 4242), |s| {
        s.session_id = "SESS-X".into()
    })
    .unwrap();

    let seq = post_notice_impl(
        state.path(),
        (".claude-stef", 4242),
        &sub,
        args("moved main"),
    )
    .unwrap();
    assert_eq!(seq, 1);

    let want = session_bridge_mcp::endpoints::repo_of(&sub).unwrap();
    let s = Store::open(&state.path().join("notices.db")).unwrap();
    let page = s.after(&want.to_string_lossy(), 0, ("x", 1)).unwrap();
    assert_eq!(page.notices.len(), 1);
    let n = &page.notices[0];
    assert_eq!(n.author_profile, ".claude-stef");
    assert_eq!(n.author_pid, 4242);
    assert_eq!(n.author_session, "SESS-X");
    assert_eq!(n.origin, Origin::Manual);
    assert_eq!(n.title, "moved main");
    assert_eq!(n.refs, vec!["a.rs".to_string()]);
    assert!(n.at_ms > 1_700_000_000_000);
    assert_eq!(n.repo, want.to_string_lossy());
    // the author's endpoint state records when it last posted
    let st = load_or_default(&endpoint_path(state.path(), ".claude-stef", 4242));
    assert_eq!(st.last_post_ms, n.at_ms);
    assert_eq!(st.session_id, "SESS-X", "the update keeps the other fields");
}
#[test]
fn post_notice_survives_an_unwritable_endpoint_state() {
    let state = TempDir::new().unwrap();
    let repo = git_repo();
    // `<state>/endpoints` is a regular file, so no state file can be created
    std::fs::write(state.path().join("endpoints"), "x").unwrap();
    let seq = post_notice_impl(
        state.path(),
        (".claude", 5),
        repo.path(),
        args("still posted"),
    )
    .unwrap();
    assert_eq!(seq, 1);
    let s = Store::open(&state.path().join("notices.db")).unwrap();
    let want = session_bridge_mcp::endpoints::repo_of(repo.path()).unwrap();
    let page = s.after(&want.to_string_lossy(), 0, ("x", 1)).unwrap();
    assert_eq!(page.notices.len(), 1);
    assert_eq!(page.notices[0].title, "still posted");
}

#[test]
fn a_refused_post_leaves_last_post_ms_untouched() {
    let state = TempDir::new().unwrap();
    let plain = TempDir::new().unwrap();
    let repo = git_repo();
    let p = endpoint_path(state.path(), ".claude", 5);
    assert!(post_notice_impl(state.path(), (".claude", 5), plain.path(), args("t")).is_err());
    assert!(post_notice_impl(
        state.path(),
        (".claude", 5),
        repo.path(),
        args(&"x".repeat(145))
    )
    .is_err());
    assert_eq!(load_or_default(&p).last_post_ms, 0);
    assert!(!p.exists(), "no state file is created by a refused post");
}

#[test]
fn post_notice_outside_a_git_repo_is_refused() {
    let state = TempDir::new().unwrap();
    let plain = TempDir::new().unwrap();
    let err = post_notice_impl(state.path(), (".claude", 1), plain.path(), args("t")).unwrap_err();
    assert!(err.to_string().contains("not in a git repository"), "{err}");
    assert!(matches!(err, BridgeError::NotInRepo));
    assert!(
        !state.path().join("notices.db").exists(),
        "nothing is stored"
    );
}

#[test]
fn post_notice_surfaces_limit_errors() {
    let state = TempDir::new().unwrap();
    let repo = git_repo();
    let err = post_notice_impl(
        state.path(),
        (".claude", 1),
        repo.path(),
        args(&"x".repeat(145)),
    )
    .unwrap_err();
    assert!(
        matches!(err, BridgeError::OverLimit { field: "title", .. }),
        "{err}"
    );
}

#[test]
fn get_many_returns_existing_seqs_oldest_first_and_skips_missing() {
    let (_d, s) = open();
    for i in 0..4 {
        s.post(notice(R, ".claude-kat", 2, 1000 + i)).unwrap();
    }
    let got = s.get_many(&[4, 2, 99]).unwrap();
    assert_eq!(got.iter().map(|n| n.seq).collect::<Vec<_>>(), vec![2, 4]);
    assert!(s.get_many(&[]).unwrap().is_empty());
}

#[test]
fn post_commit_once_posts_one_row_per_repo_and_patch_even_when_racing() {
    let d = TempDir::new().unwrap();
    let path = d.path().join("n.db");
    let reader = Store::open(&path).unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let mk = |patch: &str| {
        let mut n = notice(R, ".claude-stef", 1, 1000);
        n.origin = Origin::Commit;
        n.patch_id = Some(patch.to_string());
        n
    };
    // Each thread owns its own connection to the same file and posts the same 20 patches,
    // released together at every round.
    let runner = |path: std::path::PathBuf, barrier: Arc<std::sync::Barrier>| {
        std::thread::spawn(move || {
            let store = Store::open(&path).unwrap();
            (0..20)
                .map(|round| {
                    barrier.wait();
                    let mut n = notice(R, ".claude-stef", 1, 1000);
                    n.origin = Origin::Commit;
                    n.patch_id = Some(format!("patch-{round}"));
                    store.post_commit_once(n).unwrap().is_some()
                })
                .collect::<Vec<bool>>()
        })
    };
    let (ta, tb) = (
        runner(path.clone(), barrier.clone()),
        runner(path.clone(), barrier),
    );
    let (ra, rb) = (ta.join().unwrap(), tb.join().unwrap());
    for round in 0..20 {
        assert_eq!(
            [ra[round], rb[round]].iter().filter(|x| **x).count(),
            1,
            "round {round}: {ra:?} {rb:?}"
        );
    }
    let rows = reader.recent(R, 0, 100, ("none", 0)).unwrap();
    assert_eq!(rows.len(), 20, "one row per patch");
    // Another repository is another namespace for the same patch-id.
    let mut other = mk("patch-0");
    other.repo = Q.to_string();
    assert!(reader.post_commit_once(other).unwrap().is_some());
}

#[test]
fn addressed_notice_is_invisible_to_after_and_recent() {
    let (_d, s) = open();
    s.post(notice(R, ".claude-kat", 2, 1000)).unwrap();
    s.post(addressed(R, "s1", 1001, "private")).unwrap();
    let page = s.after(R, 0, STEF).unwrap();
    assert_eq!(page.notices.len(), 1);
    assert_eq!(page.notices[0].title, "t");
    let recent = s.recent(R, 0, 10, STEF).unwrap();
    assert_eq!(recent.len(), 1);
    assert!(recent.iter().all(|n| n.to_session.is_none()));
}

#[test]
fn direct_after_returns_only_the_addressee_oldest_first_and_limited() {
    let (_d, s) = open();
    let a = s.post(addressed(R, "s1", 1000, "a")).unwrap();
    let b = s.post(addressed(R, "s1", 1001, "b")).unwrap();
    let c = s.post(addressed(Q, "s1", 1002, "c")).unwrap();
    s.post(addressed(R, "s2", 1003, "other")).unwrap();
    s.post(notice(R, ".claude-kat", 2, 1004)).unwrap();
    let first: Vec<i64> = s
        .direct_after("s1", 0, 2)
        .unwrap()
        .iter()
        .map(|n| n.seq)
        .collect();
    assert_eq!(first, vec![a, b]);
    let rest: Vec<i64> = s
        .direct_after("s1", b, 8)
        .unwrap()
        .iter()
        .map(|n| n.seq)
        .collect();
    assert_eq!(rest, vec![c], "the repository plays no part");
    assert_eq!(s.direct_after("s2", 0, 8).unwrap().len(), 1);
    assert!(s.direct_after("nobody", 0, 8).unwrap().is_empty());
}

#[test]
fn to_session_round_trips() {
    let (_d, s) = open();
    s.post(addressed(R, "s1", 1000, "x")).unwrap();
    let got = s.direct_after("s1", 0, 8).unwrap();
    assert_eq!(got[0].to_session.as_deref(), Some("s1"));
}

#[test]
fn old_database_without_to_session_opens_and_keeps_rows() {
    let d = TempDir::new().unwrap();
    let path = d.path().join("n.db");
    {
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE notice (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL,
                repo TEXT NOT NULL, author_profile TEXT NOT NULL, author_pid INTEGER NOT NULL,
                author_session TEXT NOT NULL, origin TEXT NOT NULL, patch_id TEXT,
                title TEXT NOT NULL, body TEXT NOT NULL, refs TEXT NOT NULL);
             CREATE TABLE deletion (lo INTEGER NOT NULL, hi INTEGER NOT NULL, at_ms INTEGER NOT NULL);
             INSERT INTO notice (at_ms, repo, author_profile, author_pid, author_session, origin, title, body, refs)
             VALUES (1000, '/work/r', '.claude-kat', 2, 's', 'manual', 'old', 'b', '[]');",
        )
        .unwrap();
    }
    drop(Store::open(&path).unwrap());
    let s = Store::open(&path).unwrap(); // the migration is idempotent
    let page = s.after(R, 0, STEF).unwrap();
    assert_eq!(page.notices.len(), 1);
    assert_eq!(page.notices[0].title, "old");
    assert_eq!(page.notices[0].to_session, None);
}

#[test]
fn post_notice_from_stores_the_resolved_target() {
    let state = TempDir::new().unwrap();
    let repo = git_repo();
    let mut a = args("for t");
    a.to = Some("t".into());
    let seq = post_notice_from(
        state.path(),
        (".claude-stef", 7),
        "AUTHOR",
        repo.path(),
        a,
        Some("sess-t".into()),
    )
    .unwrap();
    let s = Store::open(&state.path().join("notices.db")).unwrap();
    let got = s.direct_after("sess-t", 0, 8).unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].seq, seq);
    let want = session_bridge_mcp::endpoints::repo_of(repo.path()).unwrap();
    let broadcast = s.after(&want.to_string_lossy(), 0, ("x", 1)).unwrap();
    assert!(
        broadcast.notices.is_empty(),
        "an addressed notice never broadcasts"
    );
}

#[test]
fn post_notice_from_refuses_an_unresolved_target_instead_of_broadcasting() {
    let state = TempDir::new().unwrap();
    let repo = git_repo();
    let mut a = args("secret");
    a.to = Some("t".into());
    let err = post_notice_from(
        state.path(),
        (".claude-stef", 7),
        "AUTHOR",
        repo.path(),
        a,
        None,
    )
    .unwrap_err();
    assert!(matches!(err, BridgeError::UnresolvedTarget), "{err}");
    let s = Store::open(&state.path().join("notices.db")).unwrap();
    assert_eq!(s.head().unwrap(), 0, "nothing was written");
}

#[test]
fn addressed_result_warns_when_the_target_never_ran_a_hook() {
    let text = addressed_result(3, "kat:5", &EndpointState::default(), 1_000_000);
    assert!(text.contains("Posted notice 3 to kat:5"), "{text}");
    assert!(text.contains("Warning"), "{text}");
}

#[test]
fn addressed_result_reports_the_age_of_the_last_look() {
    let st = EndpointState {
        session_id: "S".into(),
        last_look_ms: 1_000_000 - 42_000,
        ..EndpointState::default()
    };
    let text = addressed_result(3, "kat:5", &st, 1_000_000);
    assert!(text.contains("42s"), "{text}");
    assert!(!text.contains("Warning"), "{text}");
}
