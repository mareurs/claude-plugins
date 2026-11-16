//! Backup notices from commits.
//!
//! When an endpoint's own session committed a change to a watched file and nobody announced
//! it, a `commit` notice is posted. The scan runs inside the detached filter worker, never in
//! a hook: it visits every worktree of the repository. A commit counts only when its
//! `Session-Id:` trailer equals the endpoint's session id and one of its changed paths matches
//! the repository's watch list (`.claude/notice-watch.txt`, one glob per line). A patch-id
//! keeps one change from being announced twice (merge, fast-forward, rebase, twin session).

use crate::diag;
use crate::error::{BridgeError, Result};
use crate::store::{NewNotice, Origin, Store};
use globset::{Glob, GlobSet, GlobSetBuilder};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Time one git call may take.
const GIT_TIMEOUT: Duration = Duration::from_secs(5);
/// New commits considered per worktree and scan; older ones are dropped.
const MAX_COMMITS: usize = 50;
/// Worktrees scanned per repository.
const MAX_WORKTREES: usize = 32;
/// Paths listed in a notice body.
const MAX_LISTED_PATHS: usize = 20;
const MAX_TITLE_CHARS: usize = 120;
const MAX_BODY_CHARS: usize = 4000;
/// Wall time of one whole backup scan over all worktrees.
pub const SCAN_BUDGET: Duration = Duration::from_secs(15);
const WATCH_FILE: &str = ".claude/notice-watch.txt";

/// One own commit that touched a watched path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Counted {
    pub sha: String,
    pub subject: String,
    pub patch_id: String,
    /// Changed paths that match the watch list.
    pub matched: Vec<String>,
    /// Committer time, milliseconds since the epoch.
    pub committed_ms: i64,
    /// Branch checked out in the scanned worktree; `None` when detached or unknown.
    pub branch: Option<String>,
}

/// Run `git args` in `dir` with `input` on stdin (none: closed). No shell, argv elements are
/// never joined. Stderr is dropped, git never prompts or takes optional locks, and a call that
/// takes over `GIT_TIMEOUT` is killed and reaped. Stdout is read on a thread, so a large
/// output cannot fill the pipe and stall git.
fn git_bytes(dir: &Path, args: &[&str], input: Option<Vec<u8>>) -> Result<Vec<u8>> {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir)
        .args(args)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_PAGER", "cat")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = cmd.spawn()?;
    let writer = match (input, child.stdin.take()) {
        (Some(data), Some(mut stdin)) => Some(std::thread::spawn(move || {
            // A git that stops reading early closes the pipe: not an error here.
            let _ = stdin.write_all(&data);
        })),
        _ => None,
    };
    let reader = child.stdout.take().map(|mut out| {
        std::thread::spawn(move || {
            let mut buf = vec![];
            let _ = out.read_to_end(&mut buf);
            buf
        })
    });
    let deadline = Instant::now() + GIT_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if Instant::now() >= deadline => break None,
            Ok(None) => std::thread::sleep(Duration::from_millis(2)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e.into());
            }
        }
    };
    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(w) = writer {
        let _ = w.join();
    }
    let out = reader.and_then(|r| r.join().ok()).unwrap_or_default();
    match status {
        None => Err(BridgeError::Timeout(GIT_TIMEOUT.as_secs())),
        Some(s) if s.success() => Ok(out),
        Some(s) => Err(std::io::Error::other(format!("git {}: {s}", args.first().copied().unwrap_or(""))).into()),
    }
}

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    Ok(String::from_utf8_lossy(&git_bytes(dir, args, None)?).into_owned())
}

/// The watch globs in `<root>/.claude/notice-watch.txt`. `None` when the file is absent or
/// unreadable or holds no usable pattern. Blank lines and `#` lines are ignored; a line that is
/// not a valid glob is noted and skipped.
pub fn watch_list(root: &Path) -> Option<GlobSet> {
    let text = std::fs::read_to_string(root.join(WATCH_FILE)).ok()?;
    let mut builder = GlobSetBuilder::new();
    let mut any = false;
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        match Glob::new(line) {
            Ok(g) => {
                builder.add(g);
                any = true;
            }
            Err(e) => diag::note(&format!("commits: watch list: skipped {line:?}: {e}")),
        }
    }
    if !any {
        return None;
    }
    builder.build().map_err(|e| diag::note(&format!("commits: watch list: {e}"))).ok()
}

/// The worktrees of the repository `any_worktree` belongs to (`git worktree list
/// --porcelain`): no bare entry, no entry whose directory is gone, no duplicates, at most 32.
pub fn worktrees(any_worktree: &Path) -> Vec<PathBuf> {
    let out = match git(any_worktree, &["worktree", "list", "--porcelain"]) {
        Ok(o) => o,
        Err(e) => {
            diag::note(&format!("commits: worktree list: {e}"));
            return vec![];
        }
    };
    let mut found: Vec<PathBuf> = vec![];
    for block in out.split("\n\n") {
        let mut path = None;
        let mut bare = false;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(PathBuf::from(p));
            } else if line == "bare" {
                bare = true;
            }
        }
        if let Some(p) = path.filter(|p| !bare && p.exists()) {
            if !found.contains(&p) {
                found.push(p);
            }
        }
    }
    if found.len() > MAX_WORKTREES {
        diag::note(&format!("commits: {} worktrees, scanning the first {MAX_WORKTREES}", found.len()));
        found.truncate(MAX_WORKTREES);
    }
    found
}

fn is_sha(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The patch-id of commit `sha`, empty for a commit with no diff (a merge, an empty commit).
fn patch_id(dir: &Path, sha: &str) -> Result<String> {
    let diff = git_bytes(dir, &["diff-tree", "-p", "--root", sha], None)?;
    if diff.is_empty() {
        return Ok(String::new());
    }
    let out = git_bytes(dir, &["patch-id", "--stable"], Some(diff))?;
    Ok(String::from_utf8_lossy(&out).split_whitespace().next().unwrap_or("").to_string())
}

/// New commits of `worktree` since `old`, oldest first, that this session made and that touch
/// a watched path; plus the new head. First sight (`old == None`), or an `old` that no longer
/// exists (rebased away, collected), returns the head and counts nothing. More than 50 new
/// commits: the newest 50 are considered and the head is still the new one.
pub fn scan(worktree: &Path, old: Option<&str>, session_id: &str, watch: &GlobSet) -> Result<(String, Vec<Counted>)> {
    scan_until(worktree, old, session_id, watch, Instant::now() + Duration::from_secs(3600))
}

fn scan_until(
    worktree: &Path,
    old: Option<&str>,
    session_id: &str,
    watch: &GlobSet,
    deadline: Instant,
) -> Result<(String, Vec<Counted>)> {
    let new = git(worktree, &["rev-parse", "--verify", "HEAD^{commit}"])?.trim().to_string();
    let session_id = session_id.trim();
    let Some(old) = old.filter(|o| is_sha(o) && !session_id.is_empty()) else {
        return Ok((new, vec![]));
    };
    if old == new {
        return Ok((new, vec![]));
    }
    let exclude = format!("^{old}");
    let limit = (MAX_COMMITS + 1).to_string();
    let log = git(
        worktree,
        &[
            "log",
            "--format=%H%x00%ct%x00%s%x00%(trailers:key=Session-Id,valueonly,separator=%x1f)%x1e",
            "-n",
            &limit,
            &new,
            &exclude,
        ],
    );
    let log = match log {
        Ok(l) => l,
        Err(e) => {
            let probe = format!("{old}^{{commit}}");
            if git(worktree, &["rev-parse", "--verify", "--quiet", &probe]).is_err() {
                diag::note(&format!("commits: old head {old} is gone in {}: first sight", worktree.display()));
                return Ok((new, vec![]));
            }
            return Err(e);
        }
    };
    let mut records: Vec<&str> = log.split('\x1e').map(|r| r.trim_start_matches('\n')).filter(|r| !r.is_empty()).collect();
    if records.len() > MAX_COMMITS {
        diag::note(&format!(
            "commits: more than {MAX_COMMITS} new commits in {}: the older ones are dropped",
            worktree.display()
        ));
        records.truncate(MAX_COMMITS);
    }
    records.reverse();

    let mut counted = vec![];
    for rec in records {
        if Instant::now() >= deadline {
            return Err(std::io::Error::other("scan budget exceeded").into());
        }
        let mut f = rec.splitn(4, '\0');
        let (Some(sha), Some(ct), Some(subject), Some(trailers)) = (f.next(), f.next(), f.next(), f.next()) else {
            continue;
        };
        if !trailers.split(['\x1f', '\n']).any(|t| t.trim() == session_id) {
            continue;
        }
        let paths = git_bytes(worktree, &["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "-z", sha], None)?;
        let matched: Vec<String> = paths
            .split(|b| *b == 0)
            .filter(|p| !p.is_empty())
            .map(|p| String::from_utf8_lossy(p).into_owned())
            .filter(|p| watch.is_match(p))
            .collect();
        if matched.is_empty() {
            continue;
        }
        let patch_id = patch_id(worktree, sha)?;
        if patch_id.is_empty() {
            continue;
        }
        counted.push(Counted {
            sha: sha.to_string(),
            subject: subject.to_string(),
            patch_id,
            matched,
            committed_ms: ct.trim().parse::<i64>().unwrap_or(0).saturating_mul(1000),
            branch: None,
        });
    }
    if !counted.is_empty() {
        let branch = git(worktree, &["rev-parse", "--abbrev-ref", "HEAD"]).ok().map(|b| b.trim().to_string());
        let branch = branch.filter(|b| !b.is_empty() && b != "HEAD");
        for c in &mut counted {
            c.branch = branch.clone();
        }
    }
    Ok((new, counted))
}

/// The commits found by one backup scan of a repository.
#[derive(Debug, Default)]
pub struct Collected {
    /// The repository key notices are stored under.
    pub repo: String,
    /// New head of every worktree that was scanned without error.
    pub heads: BTreeMap<String, String>,
    pub counted: Vec<Counted>,
}

/// Scan every worktree of the repository of `cwd` for own commits. A worktree uses its own
/// watch file, else the main worktree's. `None` when `cwd` is in no repository or there is no
/// session id. A worktree that fails keeps its old head (it is left out of `heads`); the scan
/// stops, noted, once `budget` is used up. It never fails.
pub fn collect(cwd: &Path, session_id: &str, heads: &BTreeMap<String, String>, budget: Duration) -> Option<Collected> {
    if session_id.is_empty() {
        return None;
    }
    let started = Instant::now();
    let deadline = started + budget;
    let repo = crate::endpoints::repo_of(cwd)?;
    let main_watch = watch_list(&repo);
    let mut out = Collected { repo: repo.to_string_lossy().into_owned(), ..Default::default() };
    for tree in worktrees(&repo) {
        if Instant::now() >= deadline {
            diag::note("commits: scan budget used up, the remaining worktrees wait for the next scan");
            break;
        }
        let own = watch_list(&tree);
        let Some(watch) = own.as_ref().or(main_watch.as_ref()) else { continue };
        let key = tree.to_string_lossy().into_owned();
        let old = heads.get(&key).map(String::as_str).filter(|h| !h.is_empty());
        match scan_until(&tree, old, session_id, watch, deadline) {
            Ok((head, counted)) => {
                out.heads.insert(key, head);
                out.counted.extend(counted);
            }
            Err(e) => diag::note(&format!("commits: scan of {}: {e}", tree.display())),
        }
    }
    Some(out)
}

fn clean(s: &str) -> String {
    s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect()
}

/// Post one `commit` notice per counted commit, oldest first, and return how many were posted.
/// A commit is skipped when the endpoint posted a notice after it (`last_post_ms` is later than
/// the commit time: the agent announced it itself) or when the store already holds its
/// patch-id for `repo`. A store limit error on one commit is noted and the next still posts.
pub fn post_commit_notices(
    store: &Store,
    repo: &str,
    author: (&str, u32),
    session_id: &str,
    counted: &[Counted],
    last_post_ms: i64,
) -> Result<usize> {
    let mut posted = 0;
    for c in counted {
        if last_post_ms > c.committed_ms || store.has_patch_id(repo, &c.patch_id)? {
            continue;
        }
        let title: String = clean(&c.subject).chars().take(MAX_TITLE_CHARS).collect();
        let sha9: String = c.sha.chars().take(9).collect();
        let mut list: Vec<String> = c.matched.iter().take(MAX_LISTED_PATHS).map(|p| clean(p)).collect();
        if c.matched.len() > MAX_LISTED_PATHS {
            list.push(format!("+{} more", c.matched.len() - MAX_LISTED_PATHS));
        }
        let mut body = format!("Commit {sha9} changed: {}.", list.join(", "));
        if body.chars().count() > MAX_BODY_CHARS {
            body = body.chars().take(MAX_BODY_CHARS).collect();
        }
        let mut refs = vec![c.sha.clone()];
        refs.extend(c.branch.clone());
        let notice = NewNotice {
            at_ms: chrono::Utc::now().timestamp_millis(),
            repo: repo.to_string(),
            author_profile: author.0.to_string(),
            author_pid: author.1,
            author_session: session_id.to_string(),
            origin: Origin::Commit,
            patch_id: Some(c.patch_id.clone()),
            title,
            body,
            refs,
        };
        match store.post(notice) {
            Ok(_) => posted += 1,
            Err(e @ BridgeError::OverLimit { .. }) => diag::note(&format!("commits: commit {sha9} not announced: {e}")),
            Err(e) => return Err(e),
        }
    }
    Ok(posted)
}
