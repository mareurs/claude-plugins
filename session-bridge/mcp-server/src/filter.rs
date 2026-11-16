//! The filter worker: one Haiku call that says which pending notices matter to a session.
//!
//! The worker reads the tail of the session's transcript, asks the model once which
//! pending notices name something the transcript names too, and demands an exact quote for
//! every "relevant" answer. A quote that is not in the tail voids the verdict. Every
//! failure of the model call is fail-open: each pending notice still gets a verdict, marked
//! relevant and unfiltered, so a broken filter delays nothing and hides nothing.

use crate::error::{BridgeError, Result};
use crate::state::{endpoint_path, read_locked, update, EndpointState, Verdict};
use crate::store::{Notice, Store};
use serde::Deserialize;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

/// Spike prompt v2, verbatim.
pub const FILTER_PROMPT: &str = r#"You filter project notices for one running coding-agent session. You get the tail of that session's transcript and notices that other sessions wrote. A notice is relevant only if the transcript names something specific that the notice changes: the same file, branch, commit, plan, command or pending decision. Generic overlap does NOT count: every session uses codescout tools, commits, and runs in this repo. For a relevant notice, copy the exact words from the transcript that make it relevant, at most 15 words, character for character. If you cannot quote such words, the notice is not relevant. Do not guess what the session does beyond what the transcript says. Answer with JSON only, no prose: {"verdicts": [{"notice": "N1", "relevant": true, "evidence": "<exact quote or empty>", "why": "<one short line>"}]}"#;

/// Characters of transcript the model sees.
const TAIL_CHARS: usize = 6000;
/// Characters kept of one transcript item.
const ITEM_CHARS: usize = 1500;
/// Bytes read from the end of the transcript file; older lines cannot reach the tail.
const WINDOW_BYTES: u64 = 4 * 1024 * 1024;
/// Output bytes read from the model child.
const OUT_LIMIT: u64 = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_S: u64 = 60;
const VERDICT_LOG: &str = "verdicts.jsonl";
/// Pending notices judged by one model call.
pub const FILTER_BATCH: usize = 20;
/// Longest quote a relevant verdict may carry: the prompt's 15 words, and 200 characters.
pub const MAX_QUOTE_WORDS: usize = 15;
pub const MAX_QUOTE_CHARS: usize = 200;
/// `why` and `evidence` are stored (endpoint state, verdict log) cut to this many characters.
pub const MAX_STORED_CHARS: usize = 200;
const ENV_REMOVED: [&str; 4] =
    ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDECODE"];

/// The argv for `claude` (binary excluded); the input goes on stdin.
pub fn filter_argv() -> Vec<String> {
    [
        "-p",
        "--model",
        "claude-haiku-5-5",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--system-prompt",
        FILTER_PROMPT,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// The model budget from `SESSION_BRIDGE_FILTER_TIMEOUT_S` (test hook); a missing, zero or
/// unparsable value is 60 seconds.
pub fn filter_timeout(var: Option<&str>) -> Duration {
    let s = var.and_then(|v| v.trim().parse::<u64>().ok()).filter(|n| *n > 0).unwrap_or(DEFAULT_TIMEOUT_S);
    Duration::from_secs(s)
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// The speech items of one transcript record: `(role, text)` for user and assistant
/// records outside sidechains. `content` is a string or an array of blocks; only `text`
/// blocks count. System reminders, local-command output and task notifications are the
/// harness talking, not the session, and are skipped.
fn speech(record: &serde_json::Value) -> Vec<(&'static str, String)> {
    let role = match record.get("type").and_then(|t| t.as_str()) {
        Some("user") => "user",
        Some("assistant") => "assistant",
        _ => return vec![],
    };
    if record.get("isSidechain").and_then(|b| b.as_bool()) == Some(true) {
        return vec![];
    }
    let texts: Vec<&str> = match record.pointer("/message/content") {
        Some(serde_json::Value::String(s)) => vec![s.as_str()],
        Some(serde_json::Value::Array(blocks)) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect(),
        _ => vec![],
    };
    texts
        .into_iter()
        .filter(|t| {
            let head = t.trim_start();
            !t.trim().is_empty()
                && !head.starts_with("<system-reminder>")
                && !head.starts_with("<task-notification>")
                && !t.chars().take(200).collect::<String>().contains("<local-command")
        })
        .map(|t| (role, clip(t, ITEM_CHARS)))
        .collect()
}

/// The last `budget` characters of the session's speech: items rendered `[user] …` or
/// `[assistant] …` (each at most 1500 characters) and joined by a blank line. Malformed
/// lines are skipped; an unreadable file is the io error.
pub fn transcript_tail(path: &Path, budget: usize) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(WINDOW_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    file.take(WINDOW_BYTES).read_to_end(&mut buf)?;
    let mut lines = buf.split(|b| *b == b'\n');
    if start > 0 {
        // The window starts mid-line: that first piece is not a whole record.
        lines.next();
    }
    let mut items: Vec<String> = vec![];
    for line in lines {
        let Ok(record) = serde_json::from_slice::<serde_json::Value>(line) else { continue };
        for (role, text) in speech(&record) {
            items.push(format!("[{role}] {text}"));
        }
    }
    let joined = items.join("\n\n");
    let n = joined.chars().count();
    Ok(if n > budget { joined.chars().skip(n - budget).collect() } else { joined })
}

/// Notice text is data the model reads, written by another session: control characters
/// (newlines included) and Unicode line and paragraph separators become spaces
/// (`deliver::clean`), so a notice cannot add lines or forge an `N9:` entry. A literal
/// `</notices>` inside one line is not removed; only the line structure is protected.
fn flat(s: &str) -> String {
    crate::deliver::clean(s)
}

/// The stdin of the filter call.
pub fn filter_input(tail: &str, notices: &[Notice]) -> String {
    let lines: Vec<String> =
        notices.iter().map(|n| format!("N{}: {}. {}", n.seq, flat(&n.title), flat(&n.body))).collect();
    format!(
        "<session_transcript_tail>\n{tail}\n</session_transcript_tail>\n\n<notices>\n{}\n</notices>\n\nGive one verdict per notice.",
        lines.join("\n")
    )
}

#[derive(Deserialize)]
struct Answer {
    verdicts: Vec<RawVerdict>,
}

#[derive(Deserialize)]
struct RawVerdict {
    notice: String,
    #[serde(default)]
    relevant: bool,
    evidence: Option<String>,
    why: Option<String>,
}

/// One verdict per notice, in notice order, from the `--output-format json` envelope. The
/// model's `result` may carry prose or a fence around the JSON, so the object is the text
/// from the first `{` to the last `}`. A notice the answer does not mention gets an
/// unfiltered verdict (`no verdict returned`); ids that match no notice are ignored.
pub fn parse_verdicts(stdout: &str, notices: &[Notice]) -> Result<Vec<Verdict>> {
    let bad = |what: &str| BridgeError::BadForkOutput(format!("{what}: {}", clip(stdout, 200)));
    let envelope: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|_| bad("not json"))?;
    if envelope.get("is_error").and_then(|b| b.as_bool()) == Some(true) {
        return Err(bad("the model reported an error"));
    }
    let result = envelope.get("result").and_then(|r| r.as_str()).ok_or_else(|| bad("no result"))?;
    let (Some(a), Some(b)) = (result.find('{'), result.rfind('}')) else { return Err(bad("no object")) };
    let json = result.get(a..=b).ok_or_else(|| bad("no object"))?;
    let answer: Answer = serde_json::from_str(json).map_err(|_| bad("not a verdict list"))?;
    Ok(notices
        .iter()
        .map(|n| {
            let id = format!("N{}", n.seq);
            match answer.verdicts.iter().find(|v| v.notice == id) {
                Some(v) => Verdict {
                    seq: n.seq,
                    relevant: v.relevant,
                    evidence: v.evidence.clone().unwrap_or_default(),
                    why: v.why.clone().unwrap_or_default(),
                    unfiltered_reason: None,
                },
                None => unfiltered(std::slice::from_ref(n), "no verdict returned").remove(0),
            }
        })
        .collect())
}

fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A relevant verdict whose quote is over `MAX_QUOTE_WORDS` words or `MAX_QUOTE_CHARS`
/// characters (the prompt allows 15 words: a longer "quote" could carry any amount of
/// transcript text), whose quote is not in the tail (whitespace runs collapsed on both
/// sides), or whose quote is empty, becomes not relevant. Unfiltered verdicts carry no
/// quote by design and pass through. Every verdict leaves with `why` and `evidence` cut to
/// `MAX_STORED_CHARS` characters: both are stored in the endpoint state and the verdict log.
pub fn void_unquoted(verdicts: Vec<Verdict>, tail: &str) -> Vec<Verdict> {
    let tail = squash(tail);
    verdicts
        .into_iter()
        .map(|mut v| {
            if v.relevant && v.unfiltered_reason.is_none() {
                let quote = squash(&v.evidence);
                if quote.split(' ').count() > MAX_QUOTE_WORDS || quote.chars().count() > MAX_QUOTE_CHARS {
                    v.relevant = false;
                    v.why = "quote longer than 15 words or 200 characters".to_string();
                } else if quote.is_empty() || !tail.contains(&quote) {
                    v.relevant = false;
                    v.why = "quote not found in the transcript tail".to_string();
                }
            }
            v.why = clip(&v.why, MAX_STORED_CHARS);
            v.evidence = clip(&v.evidence, MAX_STORED_CHARS);
            v
        })
        .collect()
}

/// Fail-open verdicts: every notice relevant, none filtered, with the reason.
pub fn unfiltered(notices: &[Notice], reason: &str) -> Vec<Verdict> {
    notices
        .iter()
        .map(|n| Verdict {
            seq: n.seq,
            relevant: true,
            evidence: String::new(),
            why: String::new(),
            unfiltered_reason: Some(reason.to_string()),
        })
        .collect()
}

/// Run the model once. `Err` is the unfiltered reason: a timeout kills and reaps the child.
async fn call_model(
    bin: &str,
    cwd: &Path,
    config_dir: &Path,
    input: &str,
    timeout: Duration,
) -> std::result::Result<String, &'static str> {
    let mut cmd = Command::new(bin);
    cmd.args(filter_argv())
        .current_dir(cwd)
        .env("CLAUDE_CONFIG_DIR", config_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for v in ENV_REMOVED {
        cmd.env_remove(v);
    }
    let mut child = cmd.spawn().map_err(|_| "filter failed")?;
    let (Some(mut stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.kill().await;
        return Err("filter failed");
    };
    let run = async {
        // Write while reading: a large input must not wait on a full output pipe.
        let write = async move {
            let _ = stdin.write_all(input.as_bytes()).await;
            let _ = stdin.shutdown().await;
        };
        let read_out = async move {
            let mut b = Vec::new();
            let _ = stdout.take(OUT_LIMIT).read_to_end(&mut b).await;
            b
        };
        let read_err = async move {
            let mut b = Vec::new();
            let _ = stderr.take(OUT_LIMIT).read_to_end(&mut b).await;
        };
        let (_, out, _, status) = tokio::join!(write, read_out, read_err, child.wait());
        (out, status)
    };
    match tokio::time::timeout(timeout, run).await {
        Err(_) => {
            let _ = child.kill().await;
            Err("filter timed out")
        }
        Ok((out, Ok(status))) if status.success() => Ok(String::from_utf8_lossy(&out).into_owned()),
        Ok(_) => Err("filter failed"),
    }
}

/// The verdicts for `notices`: always one per notice.
async fn verdicts_for(
    bin: &str,
    state: &Path,
    config_dir: &Path,
    st: &EndpointState,
    notices: &[Notice],
    timeout: Duration,
) -> Vec<Verdict> {
    // A tail that is empty after trimming (the file holds no speech in its last window)
    // gives the model nothing to quote: it is treated like a missing transcript.
    let tail = match st.transcript_path.as_deref().map(|p| transcript_tail(Path::new(p), TAIL_CHARS)) {
        Some(Ok(t)) if !t.trim().is_empty() => t,
        _ => return unfiltered(notices, "no transcript"),
    };
    // An empty directory of our own: the call must not run inside a project, whose memory
    // file the CLI would otherwise load.
    let cwd = state.join("filter-cwd");
    if std::fs::create_dir_all(&cwd).is_err() {
        return unfiltered(notices, "filter failed");
    }
    match call_model(bin, &cwd, config_dir, &filter_input(&tail, notices), timeout).await {
        Err(reason) => unfiltered(notices, reason),
        Ok(out) => match parse_verdicts(&out, notices) {
            Ok(v) => void_unquoted(v, &tail),
            Err(_) => unfiltered(notices, "unparsable filter output"),
        },
    }
}

/// One JSON line per verdict, one `write_all` each. A failure is noted, never an error.
fn append_log(state: &Path, profile: &str, pid: u32, verdicts: &[Verdict]) {
    let at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(state)?;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(state.join(VERDICT_LOG))?;
        for v in verdicts {
            let mut value = serde_json::to_value(v).map_err(std::io::Error::other)?;
            value["at"] = at.clone().into();
            value["endpoint"] = format!("{profile}:{pid}").into();
            let mut line = value.to_string();
            line.push('\n');
            f.write_all(line.as_bytes())?;
        }
        Ok(())
    };
    if let Err(e) = write() {
        crate::diag::note(&format!("could not write the verdict log: {e}"));
    }
}

/// Clear `worker_pid` of endpoint (`profile`, `pid`), best effort, and only when its state
/// file already exists: a worker that stops early must not leave a stale pid behind, but it
/// must not make files for an endpoint that has none.
pub fn clear_worker_pid(state: &Path, profile: &str, pid: u32) {
    let path = endpoint_path(state, profile, pid);
    if path.exists() {
        let _ = update(&path, |s| s.worker_pid = None);
    }
}

/// Fail-open for a worker that cannot run the filter at all: settle the oldest
/// `FILTER_BATCH` pending notices as unfiltered verdicts with `reason`, remove them from
/// `pending` and clear `worker_pid`, in one locked update. The next hook trigger delivers
/// them, and `pending` shrinks, so a broken setup cannot keep the endpoint starting workers.
/// Only the seqs are needed, so no store is read. Only when the endpoint state file already
/// exists: it never creates that file. The drained verdicts go to the verdict log like any
/// others, so unfiltered deliveries can be counted from it.
pub fn drain_unfiltered(state: &Path, profile: &str, pid: u32, reason: &str) {
    let path = endpoint_path(state, profile, pid);
    if !path.exists() {
        return;
    }
    let mut logged: Vec<Verdict> = vec![];
    let drained = update(&path, |s| {
        let batch = oldest_batch(&s.pending);
        for q in &batch {
            let v = Verdict {
                seq: *q,
                relevant: true,
                evidence: String::new(),
                why: String::new(),
                unfiltered_reason: Some(reason.to_string()),
            };
            s.verdicts.retain(|o| o.seq != *q);
            s.verdicts.push(v.clone());
            logged.push(v);
        }
        s.pending.retain(|q| !batch.contains(q));
        s.worker_pid = None;
    });
    match drained {
        Err(e) => crate::diag::note(&format!("filter: drain: {e}")),
        Ok(()) if !logged.is_empty() => {
            append_log(state, profile, pid, &logged);
        }
        Ok(()) => {}
    }
}

/// The oldest `FILTER_BATCH` distinct seqs of `pending`.
fn oldest_batch(pending: &[i64]) -> Vec<i64> {
    let mut batch = pending.to_vec();
    batch.sort_unstable();
    batch.dedup();
    batch.truncate(FILTER_BATCH);
    batch
}


/// Filter the pending notices of endpoint (`profile`, `pid`) with the model program `bin`
/// (an absolute path), with the config dir from the environment of this process.
pub async fn run_filter(bin: &str, state: &Path, store: &Store, profile: &str, pid: u32) -> Result<()> {
    let config_dir = match std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|s| !s.is_empty()) {
        Some(c) => std::path::PathBuf::from(c),
        None => Path::new(&std::env::var("HOME").unwrap_or_default()).join(".claude"),
    };
    if !config_dir.is_absolute() {
        drain_unfiltered(state, profile, pid, "bad config dir");
        return Err(BridgeError::Io(std::io::Error::other("no absolute config dir")));
    }
    let timeout = filter_timeout(std::env::var("SESSION_BRIDGE_FILTER_TIMEOUT_S").ok().as_deref());
    run_filter_with(bin, state, store, profile, pid, &config_dir, timeout).await
}

/// Backup notices from the endpoint's own commits (see `commits`): scan every worktree of the
/// repository of the state's `cwd`, post what nobody announced, then record the new heads in one
/// locked update that touches `heads` and nothing else. The git work runs on a blocking thread.
/// Skips silently without a cwd, a repository, a session id or a watch list. Every error is
/// noted and ignored; the heads move only after the posting succeeded, so a failed post is
/// retried by the next scan (the patch-id check makes a retry harmless).
async fn backup_scan(state: &Path, path: &Path, store: &Store, profile: &str, pid: u32, st: &EndpointState) {
    let Some(cwd) = st.cwd.clone().filter(|c| !c.is_empty()) else { return };
    if st.session_id.is_empty() {
        return;
    }
    let (session, heads, started) = (st.session_id.clone(), st.heads.clone(), st.started_ms);
    let found = tokio::task::spawn_blocking(move || {
        crate::commits::collect(Path::new(&cwd), &session, &heads, started, crate::commits::SCAN_BUDGET)
    })
    .await;
    let found = match found {
        Ok(Some(f)) => f,
        Ok(None) => return,
        Err(e) => {
            crate::diag::note(&format!("filter: commit scan: {e}"));
            return;
        }
    };
    let posted = crate::commits::post_commit_notices(
        state,
        store,
        &found.repo,
        (profile, pid),
        &st.session_id,
        &found.counted,
        st.last_post_ms,
    );
    if let Err(e) = posted {
        crate::diag::note(&format!("filter: commit notices: {e}"));
        return;
    }
    if found.heads.iter().all(|(k, v)| st.heads.get(k) == Some(v)) {
        return;
    }
    if let Err(e) = update(path, |s| s.heads.extend(found.heads)) {
        crate::diag::note(&format!("filter: commit heads: {e}"));
    }
}


/// `run_filter` with the config dir and the timeout given. Reads the endpoint state, runs the
/// commit backup scan (even with nothing pending), makes
/// at most one model call for the oldest `FILTER_BATCH` pending notices (none when no
/// notice is left to judge), then stores the verdicts
/// in one locked update that also removes the handled seqs from `pending` and clears
/// `worker_pid`. The model call holds no lock.
pub async fn run_filter_with(
    bin: &str,
    state: &Path,
    store: &Store,
    profile: &str,
    pid: u32,
    config_dir: &Path,
    timeout: Duration,
) -> Result<()> {
    // The child runs with the endpoint's credentials: never resolve a relative program.
    if !bin.starts_with('/') {
        clear_worker_pid(state, profile, pid);
        return Err(BridgeError::RelativeBinary(bin.to_string()));
    }
    let path = endpoint_path(state, profile, pid);
    // Under the shared lock: the hook that started this worker may still be inside the
    // update that added the notices to `pending`.
    let st = read_locked(&path);
    // The backup scan runs first, whether or not anything is pending. It never fails the filter.
    backup_scan(state, &path, store, profile, pid, &st).await;
    // At most FILTER_BATCH notices per model call, the oldest first. The rest stay in
    // `pending`, so the next hook trigger starts another worker after this one ends.
    let handled = oldest_batch(&st.pending);
    let notices = if handled.is_empty() {
        vec![]
    } else {
        match store.get_many(&handled) {
            Ok(n) => n,
            Err(e) => {
                // Fail-open: the batch is delivered unfiltered and `worker_pid` cleared.
                drain_unfiltered(state, profile, pid, "store read failed");
                return Err(e);
            }
        }
    };
    // Notices that retention deleted since the look are in `handled` and not in `notices`:
    // they leave `pending` without a verdict.
    let verdicts = if notices.is_empty() {
        vec![]
    } else {
        verdicts_for(bin, state, config_dir, &st, &notices, timeout).await
    };
    update(&path, |s| {
        for v in &verdicts {
            s.verdicts.retain(|o| o.seq != v.seq);
            s.verdicts.push(v.clone());
        }
        s.pending.retain(|q| !handled.contains(q));
        s.worker_pid = None;
    })?;
    if !verdicts.is_empty() {
        append_log(state, profile, pid, &verdicts);
    }
    Ok(())
}
