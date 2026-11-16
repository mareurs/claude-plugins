//! Backup notices from commits. Every test builds REAL git repositories in a tempdir, with
//! git's environment scrubbed (no user or system config, no hooks, no signing, no remote).

use globset::{Glob, GlobSet, GlobSetBuilder};
use session_bridge_mcp::commits::{post_commit_notices, scan, watch_list, worktrees, Counted};
use session_bridge_mcp::filter::run_filter_with;
use session_bridge_mcp::state::{endpoint_path, load_or_default, update};
use session_bridge_mcp::store::{Notice, Origin, Store};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tempfile::TempDir;

const S: &str = "sess-S";
const T0: i64 = 1_700_000_000;
const ME: (&str, u32) = (".claude-stef", 4242);

struct Fx {
    d: TempDir,
    hooks: PathBuf,
}

impl Fx {
    fn new() -> Fx {
        let d = TempDir::new().unwrap();
        let hooks = d.path().join("empty-hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        Fx { d, hooks }
    }

    fn root(&self) -> &Path {
        self.d.path()
    }

    fn git_at(&self, dir: &Path, args: &[&str], at: i64) -> String {
        let date = format!("{at} +0000");
        let out = Command::new("git")
            .current_dir(dir)
            .arg("-c")
            .arg(format!("core.hooksPath={}", self.hooks.display()))
            .args(["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main"])
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("HOME", self.root())
            .env("GIT_AUTHOR_NAME", "T")
            .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
            .env("GIT_COMMITTER_NAME", "T")
            .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    fn git(&self, dir: &Path, args: &[&str]) -> String {
        self.git_at(dir, args, T0)
    }

    /// A repository with one base commit at `T0 - 100`.
    fn repo(&self) -> PathBuf {
        let r = self.root().join("repo");
        std::fs::create_dir_all(&r).unwrap();
        self.git(&r, &["init", "-q"]);
        self.commit(&r, &[("README", "x\n")], "base", None, T0 - 100);
        r
    }

    fn commit(&self, dir: &Path, files: &[(&str, &str)], subject: &str, session: Option<&str>, at: i64) -> String {
        for (p, c) in files {
            let f = dir.join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, c).unwrap();
        }
        self.git(dir, &["add", "-A"]);
        let msg = match session {
            Some(s) => format!("{subject}\n\nSession-Id: {s}"),
            None => subject.to_string(),
        };
        self.git_at(dir, &["commit", "-q", "-m", &msg], at);
        self.head(dir)
    }

    fn head(&self, dir: &Path) -> String {
        self.git(dir, &["rev-parse", "HEAD"])
    }
}

fn watch(pats: &[&str]) -> GlobSet {
    let mut b = GlobSetBuilder::new();
    for p in pats {
        b.add(Glob::new(p).unwrap());
    }
    b.build().unwrap()
}

fn store(fx: &Fx) -> Store {
    Store::open(&fx.root().join("notices.db")).unwrap()
}

fn post(store: &Store, repo: &str, counted: &[Counted], last_post_ms: i64) -> usize {
    post_commit_notices(store, repo, ME, S, counted, last_post_ms).unwrap()
}

#[test]
fn first_sight_records_head_and_counts_nothing() {
    let fx = Fx::new();
    let r = fx.repo();
    let head = fx.commit(&r, &[("Cargo.toml", "a\n")], "own", Some(S), T0);
    let (new, counted) = scan(&r, None, S, &watch(&["Cargo.toml"])).unwrap();
    assert_eq!(new, head);
    assert!(counted.is_empty(), "{counted:?}");
}

#[test]
fn own_commit_touching_the_watch_list_is_counted() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    let sha = fx.commit(&r, &[("Cargo.toml", "a\n"), ("src/x.rs", "b\n")], "bump deps", Some(S), T0);
    let (new, counted) = scan(&r, Some(&old), S, &watch(&["Cargo.toml"])).unwrap();
    assert_eq!(new, sha);
    assert_eq!(counted.len(), 1);
    let c = &counted[0];
    assert_eq!(c.sha, sha);
    assert_eq!(c.subject, "bump deps");
    assert_eq!(c.matched, vec!["Cargo.toml".to_string()]);
    assert!(!c.patch_id.is_empty());
    assert_eq!(c.committed_ms, T0 * 1000);
    assert_eq!(c.branch.as_deref(), Some("main"));
    // A commit of this session that touches nothing watched is not counted.
    let old2 = fx.head(&r);
    fx.commit(&r, &[("src/y.rs", "c\n")], "unwatched", Some(S), T0);
    let (_, none) = scan(&r, Some(&old2), S, &watch(&["Cargo.toml"])).unwrap();
    assert!(none.is_empty());
}

#[test]
fn other_sessions_commits_are_not_counted() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    fx.commit(&r, &[("Cargo.toml", "a\n")], "theirs", Some("sess-T"), T0);
    fx.commit(&r, &[("Cargo.toml", "b\n")], "no trailer", None, T0);
    // A session id that only contains ours is not ours.
    fx.commit(&r, &[("Cargo.toml", "c\n")], "longer", Some("sess-S2"), T0);
    let (_, counted) = scan(&r, Some(&old), S, &watch(&["Cargo.toml"])).unwrap();
    assert!(counted.is_empty(), "{counted:?}");
}

#[test]
fn no_watch_list_means_no_notices() {
    let fx = Fx::new();
    let r = fx.repo();
    assert!(watch_list(&r).is_none(), "no file");
    std::fs::create_dir_all(r.join(".claude")).unwrap();
    std::fs::write(r.join(".claude/notice-watch.txt"), "# only a comment\n\n   \n").unwrap();
    assert!(watch_list(&r).is_none(), "no pattern");
}

#[test]
fn watch_list_parses_globs_comments_and_blank_lines() {
    let fx = Fx::new();
    let r = fx.repo();
    std::fs::create_dir_all(r.join(".claude")).unwrap();
    std::fs::write(
        r.join(".claude/notice-watch.txt"),
        "# comment\n\n  Cargo.toml  \nscripts/**\n[unclosed\n#scripts2/**\n.claude/**\n",
    )
    .unwrap();
    let w = watch_list(&r).unwrap();
    assert!(w.is_match("Cargo.toml"));
    assert!(w.is_match("scripts/a/b.sh"), "** matches nested paths");
    assert!(w.is_match("scripts/a.sh"));
    assert!(w.is_match(".claude/notice-watch.txt"));
    assert!(!w.is_match("src/Cargo.toml"));
    assert!(!w.is_match("scripts2/a"));
    assert!(!w.is_match("# comment"));
}

#[test]
fn rebased_commit_is_not_announced_twice() {
    let fx = Fx::new();
    let r = fx.repo();
    let w = watch(&["Cargo.toml"]);
    let base = fx.head(&r);
    fx.git(&r, &["checkout", "-q", "-b", "feat"]);
    let x = fx.commit(&r, &[("Cargo.toml", "a\n")], "bump", Some(S), T0);
    let (_, c) = scan(&r, Some(&base), S, &w).unwrap();
    assert_eq!(c.len(), 1);
    let st = store(&fx);
    assert_eq!(post(&st, "R", &c, 0), 1);
    // The same patch on another base: a new sha, the same patch-id.
    fx.git(&r, &["checkout", "-q", "-b", "other", &base]);
    fx.commit(&r, &[("other.txt", "o\n")], "other base", None, T0);
    let old = fx.head(&r);
    fx.git(&r, &["cherry-pick", &x]);
    let (_, c2) = scan(&r, Some(&old), S, &w).unwrap();
    assert_eq!(c2.len(), 1);
    assert_ne!(c2[0].sha, x);
    assert_eq!(c2[0].patch_id, c[0].patch_id);
    assert_eq!(post(&st, "R", &c2, 0), 0, "announced once");
    // Another repository is another namespace for the patch-id.
    assert_eq!(post(&st, "R2", &c2, 0), 1);
}

#[test]
fn merge_to_another_worktree_is_not_announced_twice() {
    let fx = Fx::new();
    let r = fx.repo();
    let w = watch(&["Cargo.toml"]);
    let wt = fx.root().join("wt");
    fx.git(&r, &["worktree", "add", "-q", "-b", "feat", wt.to_str().unwrap()]);
    let listed = worktrees(&r);
    let canon: Vec<PathBuf> = listed.iter().map(|p| p.canonicalize().unwrap()).collect();
    assert_eq!(canon.len(), 2, "{listed:?}");
    assert!(canon.contains(&r.canonicalize().unwrap()));
    assert!(canon.contains(&wt.canonicalize().unwrap()));

    let old_a = fx.head(&wt);
    let old_b = fx.head(&r);
    fx.commit(&wt, &[("Cargo.toml", "a\n")], "in A", Some(S), T0);
    let (_, ca) = scan(&wt, Some(&old_a), S, &w).unwrap();
    assert_eq!(ca.len(), 1);
    let st = store(&fx);
    assert_eq!(post(&st, "R", &ca, 0), 1);

    fx.git(&r, &["merge", "--ff-only", "-q", "feat"]);
    let (_, cb) = scan(&r, Some(&old_b), S, &w).unwrap();
    assert_eq!(cb.len(), 1, "B sees the commit too");
    assert_eq!(post(&st, "R", &cb, 0), 0, "but it is announced once");
}

#[test]
fn a_manual_notice_after_the_commit_suppresses_the_backup() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    fx.commit(&r, &[("Cargo.toml", "a\n")], "bump", Some(S), T0);
    let (_, c) = scan(&r, Some(&old), S, &watch(&["Cargo.toml"])).unwrap();
    let st = store(&fx);
    assert_eq!(post(&st, "R", &c, (T0 + 10) * 1000), 0, "the agent announced it itself");
    assert_eq!(post(&st, "R", &c, (T0 - 10) * 1000), 1, "a manual notice from before the commit does not count");
}

fn only_notice(st: &Store, seq: i64) -> Notice {
    st.get_many(&[seq]).unwrap().remove(0)
}

#[test]
fn the_notice_carries_title_body_refs_and_origin() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    let sha = fx.commit(&r, &[("Cargo.toml", "a\n"), ("scripts/a.sh", "b\n")], "bump", Some(S), T0);
    let (_, c) = scan(&r, Some(&old), S, &watch(&["Cargo.toml", "scripts/**"])).unwrap();
    let st = store(&fx);
    assert_eq!(post(&st, "R", &c, 0), 1);
    let n = only_notice(&st, 1);
    assert_eq!(n.origin, Origin::Commit);
    assert_eq!(n.repo, "R");
    assert_eq!(n.title, "bump");
    assert_eq!(n.body, format!("Commit {} changed: Cargo.toml, scripts/a.sh.", &sha[..9]));
    assert_eq!(n.refs, vec![sha.clone(), "main".to_string()]);
    assert_eq!(n.author_session, S);
    assert_eq!((n.author_profile.as_str(), n.author_pid), ME);
    assert_eq!(n.patch_id.as_deref(), Some(c[0].patch_id.as_str()));
}

#[test]
fn a_detached_head_has_no_branch_ref() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    fx.git(&r, &["checkout", "-q", "--detach"]);
    let sha = fx.commit(&r, &[("Cargo.toml", "a\n")], "detached", Some(S), T0);
    let (new, c) = scan(&r, Some(&old), S, &watch(&["Cargo.toml"])).unwrap();
    assert_eq!(new, sha);
    let st = store(&fx);
    assert_eq!(post(&st, "R", &c, 0), 1);
    assert_eq!(only_notice(&st, 1).refs, vec![sha]);
}

#[test]
fn the_title_is_cut_to_120_characters_not_bytes() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    let subject = format!("ééééé\tx{}", "é".repeat(200));
    fx.commit(&r, &[("Cargo.toml", "a\n")], &subject, Some(S), T0);
    let (_, c) = scan(&r, Some(&old), S, &watch(&["Cargo.toml"])).unwrap();
    let st = store(&fx);
    assert_eq!(post(&st, "R", &c, 0), 1);
    let t = only_notice(&st, 1).title;
    assert_eq!(t.chars().count(), 120);
    assert!(t.starts_with("ééééé x"), "{t}");
    assert!(!t.chars().any(|c| c.is_control()));
}

#[test]
fn sixty_watched_paths_give_a_bounded_body() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    let names: Vec<String> = (0..60).map(|i| format!("scripts/f{i:02}.sh")).collect();
    let files: Vec<(&str, &str)> = names.iter().map(|n| (n.as_str(), "x\n")).collect();
    fx.commit(&r, &files, "many", Some(S), T0);
    let (_, c) = scan(&r, Some(&old), S, &watch(&["scripts/**"])).unwrap();
    assert_eq!(c[0].matched.len(), 60);
    let st = store(&fx);
    assert_eq!(post(&st, "R", &c, 0), 1);
    let b = only_notice(&st, 1).body;
    assert!(b.chars().count() <= 4000);
    assert!(b.contains("scripts/f19.sh"), "{b}");
    assert!(!b.contains("scripts/f20.sh"), "{b}");
    assert!(b.ends_with(", +40 more."), "{b}");
}

#[test]
fn a_merge_commit_is_skipped() {
    let fx = Fx::new();
    let r = fx.repo();
    let w = watch(&["Cargo.toml", "main.txt"]);
    let base = fx.head(&r);
    fx.git(&r, &["checkout", "-q", "-b", "side"]);
    let a = fx.commit(&r, &[("Cargo.toml", "a\n")], "side change", Some(S), T0);
    fx.git(&r, &["checkout", "-q", "main"]);
    fx.commit(&r, &[("main.txt", "m\n")], "main change", None, T0);
    let old = fx.head(&r);
    fx.git_at(&r, &["merge", "--no-ff", "-q", "side", "-m", &format!("merge side\n\nSession-Id: {S}")], T0);
    let (_, c) = scan(&r, Some(&old), S, &w).unwrap();
    let shas: Vec<&str> = c.iter().map(|c| c.sha.as_str()).collect();
    assert_eq!(shas, vec![a.as_str()], "the merge commit has no patch of its own");
    let _ = base;
}

#[test]
fn an_old_head_that_no_longer_exists_is_first_sight() {
    let fx = Fx::new();
    let r = fx.repo();
    let head = fx.commit(&r, &[("Cargo.toml", "a\n")], "own", Some(S), T0);
    let w = watch(&["Cargo.toml"]);
    let missing = "0123456789abcdef0123456789abcdef01234567";
    let (new, c) = scan(&r, Some(missing), S, &w).unwrap();
    assert_eq!(new, head);
    assert!(c.is_empty());
    let (new, c) = scan(&r, Some("--not-a-sha"), S, &w).unwrap();
    assert_eq!(new, head);
    assert!(c.is_empty());
}

#[test]
fn more_than_fifty_new_commits_keep_the_newest_fifty_and_the_new_head() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    let mut head = String::new();
    for i in 0..55 {
        head = fx.commit(&r, &[("Cargo.toml", &format!("{i}\n"))], &format!("c{i}"), Some(S), T0);
    }
    let (new, c) = scan(&r, Some(&old), S, &watch(&["Cargo.toml"])).unwrap();
    assert_eq!(new, head);
    assert_eq!(c.len(), 50);
    assert_eq!(c[0].subject, "c5", "oldest first");
    assert_eq!(c[49].subject, "c54");
}

#[test]
fn exactly_fifty_new_commits_are_all_considered() {
    let fx = Fx::new();
    let r = fx.repo();
    let old = fx.head(&r);
    for i in 0..50 {
        fx.commit(&r, &[("Cargo.toml", &format!("{i}\n"))], &format!("c{i}"), Some(S), T0);
    }
    let (_, c) = scan(&r, Some(&old), S, &watch(&["Cargo.toml"])).unwrap();
    assert_eq!(c.len(), 50);
    assert_eq!(c[0].subject, "c0");
}

// ---- the worker integration -------------------------------------------------------------

struct W {
    fx: Fx,
    repo: PathBuf,
    state: PathBuf,
    config: PathBuf,
    store: Store,
}

const PROFILE: &str = ".claude-stef";
const PID: u32 = 4242;

impl W {
    fn new() -> W {
        let fx = Fx::new();
        let repo = fx.repo();
        std::fs::create_dir_all(repo.join(".claude")).unwrap();
        std::fs::write(repo.join(".claude/notice-watch.txt"), "Cargo.toml\n").unwrap();
        let state = fx.root().join("xdg/session-bridge");
        let config = fx.root().join(PROFILE);
        std::fs::create_dir_all(&state).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(config.join(".sb-test-config"), "").unwrap();
        let store = Store::open(&state.join("notices.db")).unwrap();
        let cwd = repo.display().to_string();
        update(&endpoint_path(&state, PROFILE, PID), |s| {
            s.session_id = S.into();
            s.cwd = Some(cwd);
            s.delivered = vec![5];
            s.worker_pid = Some(99);
        })
        .unwrap();
        W { fx, repo, state, config, store }
    }

    async fn run(&self) {
        let bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-filter.sh");
        let t = Duration::from_secs(20);
        run_filter_with(bin.to_str().unwrap(), &self.state, &self.store, PROFILE, PID, &self.config, t)
            .await
            .unwrap();
    }

    fn st(&self) -> session_bridge_mcp::state::EndpointState {
        load_or_default(&endpoint_path(&self.state, PROFILE, PID))
    }

    fn calls(&self) -> Option<String> {
        std::fs::read_to_string(self.config.join("filter-calls")).ok()
    }

    fn key(&self) -> String {
        self.repo.display().to_string()
    }
}

#[tokio::test]
async fn the_worker_scans_even_with_nothing_pending_and_makes_no_model_call() {
    let w = W::new();
    w.run().await;
    let head0 = w.fx.head(&w.repo);
    assert_eq!(w.st().heads.get(&w.key()), Some(&head0), "first sight records the head");
    assert_eq!(w.store.head().unwrap(), 0, "and posts nothing");

    let head1 = w.fx.commit(&w.repo, &[("Cargo.toml", "a\n")], "bump deps", Some(S), T0);
    update(&endpoint_path(&w.state, PROFILE, PID), |s| s.worker_pid = Some(99)).unwrap();
    w.run().await;
    assert!(w.calls().is_none(), "no model call");
    let n = only_notice(&w.store, 1);
    assert_eq!(n.origin, Origin::Commit);
    assert_eq!(n.title, "bump deps");
    assert_eq!((n.author_profile.as_str(), n.author_pid, n.author_session.as_str()), (PROFILE, PID, S));
    let st = w.st();
    assert_eq!(st.heads.get(&w.key()), Some(&head1));
    assert!(st.pending.is_empty());
    assert_eq!(st.delivered, vec![5]);
    assert!(st.verdicts.is_empty());
    assert_eq!(st.worker_pid, None);

    // A third run finds nothing new and posts nothing.
    w.run().await;
    assert_eq!(w.store.head().unwrap(), 1);
}

#[tokio::test]
async fn no_watch_list_anywhere_skips_the_scan_silently() {
    let w = W::new();
    std::fs::remove_file(w.repo.join(".claude/notice-watch.txt")).unwrap();
    w.fx.commit(&w.repo, &[("Cargo.toml", "a\n")], "bump", Some(S), T0);
    w.run().await;
    assert!(w.st().heads.is_empty());
    assert_eq!(w.store.head().unwrap(), 0);
}

#[tokio::test]
async fn a_linked_worktree_without_a_watch_file_uses_the_main_one() {
    let w = W::new();
    let wt = w.fx.root().join("wt");
    // The watch file is untracked in the main worktree, so the linked one does not have it.
    w.fx.git(&w.repo, &["worktree", "add", "-q", "-b", "feat", wt.to_str().unwrap()]);
    assert!(!wt.join(".claude/notice-watch.txt").exists());
    w.run().await;
    assert_eq!(w.st().heads.len(), 2, "both worktrees were seen");
    w.fx.commit(&wt, &[("Cargo.toml", "z\n")], "in the linked one", Some(S), T0);
    w.run().await;
    assert_eq!(only_notice(&w.store, 1).title, "in the linked one");
}

#[tokio::test]
async fn a_failing_scan_does_not_stop_the_filter() {
    let w = W::new();
    let wt = w.fx.root().join("wt");
    w.fx.git(&w.repo, &["worktree", "add", "-q", "-b", "feat", wt.to_str().unwrap()]);
    // Break the linked worktree: its HEAD is garbage, so every git call there fails.
    let admin = w.repo.join(".git/worktrees/wt/HEAD");
    std::fs::write(&admin, "garbage\n").unwrap();
    // Two pending notices to judge.
    for t in ["first", "second"] {
        w.store
            .post(session_bridge_mcp::store::NewNotice {
                at_ms: 1000,
                repo: w.key(),
                author_profile: ".claude-kat".into(),
                author_pid: 7,
                author_session: "s".into(),
                origin: Origin::Manual,
                patch_id: None,
                title: t.into(),
                body: String::new(),
                refs: vec![],
            })
            .unwrap();
    }
    let transcript = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/transcript.jsonl");
    update(&endpoint_path(&w.state, PROFILE, PID), |s| {
        s.pending = vec![1, 2];
        s.transcript_path = Some(transcript.display().to_string());
    })
    .unwrap();
    w.run().await;
    assert!(w.calls().is_some(), "the model was still called");
    let st = w.st();
    assert!(st.pending.is_empty());
    assert_eq!(st.verdicts.len(), 2);
    assert_eq!(st.worker_pid, None);
    assert!(st.heads.contains_key(&w.key()), "the healthy worktree was scanned");
    assert!(!st.heads.contains_key(&wt.display().to_string()), "the broken one keeps its (absent) head");
}

#[tokio::test]
async fn a_vanished_cwd_does_not_stop_the_filter() {
    let w = W::new();
    update(&endpoint_path(&w.state, PROFILE, PID), |s| s.cwd = Some("/definitely/not/here".into())).unwrap();
    w.run().await;
    let st = w.st();
    assert_eq!(st.worker_pid, None);
    assert!(st.heads.is_empty());
}
