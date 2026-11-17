//! The bridge tool bodies, shared by the MCP server (`server.rs`) and the
//! `session-bridge call` CLI that OpenCode sessions use. Each body gets an already
//! resolved caller; how the caller was identified is the entry point's job.

use crate::ask::{ask, clamp_timeout, locate_claude};
use crate::codex_process::{ask_codex, locate_codex};
use crate::endpoints::{pid_alive, process_start_ms, registered_session, Endpoint, Roots};
use crate::hook::now_ms;
use crate::opencode_api::{locate_opencode, CliApi};
use crate::opencode_ask::ask_opencode;
use crate::opencode_send::send_opencode;
use crate::paths::short_profile;
use crate::send::{send_codex, SendResult};
use crate::server::post_notice_from;
use crate::sessions::{resolve_noted, Session};
use crate::store::{Direct, NewDirect, Store, DIRECT_TTL_MS};
use anyhow::{anyhow, Result};
use rmcp::schemars;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AskArgs {
    /// Claude endpoint, canonical Codex address, OpenCode address (`opencode:<data dir>:<ses_id>`), UUID/prefix or unambiguous session name.
    pub target: String,
    /// The question to ask the target session.
    pub question: String,
    /// Claude alias, Codex model id or OpenCode `provider/model`; defaults to haiku for Claude and the target's own default for Codex and OpenCode.
    #[serde(default)]
    pub model: Option<String>,
    /// Seconds to wait for the answer (default 120, clamped to 1..=300).
    #[serde(default)]
    pub timeout_s: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SendMessageArgs {
    /// Claude endpoint, exact loaded Codex thread address, OpenCode address, UUID/prefix or unambiguous name.
    pub target: String,
    /// Peer message. Codex and OpenCode targets: at most 16000 characters, starts a normal target turn. Claude targets: at most 4000 characters, delivered once at the target's next prompt or tool call, no turn is started; refused while the target has 20 pending messages.
    pub message: String,
    /// Queue/observation budget in seconds (default 20, clamped to 1..=30).
    #[serde(default)]
    pub timeout_s: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PostNoticeArgs {
    /// Short title (at most 120 characters).
    pub title: String,
    /// Notice body (at most 4000 characters).
    pub body: String,
    /// References such as files, branches or commits (at most 20).
    #[serde(default)]
    pub refs: Vec<String>,
}

/// The listing, one line per session; `caller` gets the `(you)` mark and, below the
/// listing, its own direct messages to Claude sessions from the last 24 h with their status.
pub async fn list_sessions(
    caller: Option<&Session>,
    sessions: &[Session],
    notes: &[String],
    roots: &Roots,
    state: &Path,
) -> Result<String> {
    let me = caller.map(Session::identity);
    let mut lines: Vec<String> = sessions
        .iter()
        .map(|s| s.render(me.as_deref() == Some(s.identity().as_str())))
        .collect();
    if lines.is_empty() {
        lines.push("No live Claude Code sessions, rollout-backed Codex threads or OpenCode sessions found.".into());
    }
    lines.push("Scope: local Linux, Claude native/IPC session registrations, Codex open rollouts and live OpenCode sessions (top-level, not bridge ask forks, running or active within SESSION_BRIDGE_OPENCODE_RECENT_HOURS); saved-only Codex threads and hosts without open rollouts are outside this listing.".into());
    for note in notes {
        lines.push(format!("Discovery note: {note}"));
    }
    if let Some(caller) = caller {
        lines.extend(sent_lines(caller, roots, state));
    }
    Ok(lines.join("\n"))
}

pub async fn ask_session(
    caller: &Session,
    sessions: &[Session],
    notes: &[String],
    args: AskArgs,
    roots: &Roots,
    state: &Path,
) -> Result<String> {
    let target = resolve_noted(sessions, &args.target, Some(&caller.identity()), notes)?.clone();
    let timeout = clamp_timeout(args.timeout_s);
    match target {
        Session::Claude(target) => {
            let bin = locate_claude(&|k| std::env::var(k).ok())?;
            let me = caller.storage_id();
            let asker = format!("{}:{}", short_profile(&me.0), me.1);
            let result = ask(
                &bin.to_string_lossy(),
                &target,
                &asker,
                &args.question,
                args.model.as_deref().unwrap_or("haiku"),
                timeout,
                state,
            )
            .await?;
            Ok(serde_json::to_string_pretty(&result)?)
        }
        Session::Codex(target) => {
            let bin = locate_codex(&|k| std::env::var(k).ok())?;
            let result = ask_codex(
                &bin,
                &target,
                roots,
                &args.question,
                args.model.as_deref(),
                timeout,
                state,
            )
            .await?;
            Ok(serde_json::to_string_pretty(&result)?)
        }
        // Like Codex, outside the Claude USD meter: no budget check, no ask log, no charge.
        Session::OpenCode(target) => {
            let bin = locate_opencode(&|k| std::env::var(k).ok())?;
            let timeout = std::time::Duration::from_secs(timeout);
            // The CLI budget is longer than the ask's own deadline, so the blocking wait is cut
            // by the ask's timeout (which then interrupts and removes the fork), never by it.
            let api = CliApi {
                bin,
                timeout: timeout + std::time::Duration::from_secs(30),
            };
            let result = ask_opencode(
                &api,
                &target,
                &args.question,
                args.model.as_deref(),
                timeout,
            )
            .await?;
            Ok(serde_json::to_string_pretty(&result)?)
        }
    }
}

pub async fn send_message(
    caller: &Session,
    sessions: &[Session],
    notes: &[String],
    args: SendMessageArgs,
    roots: &Roots,
    state: &Path,
) -> Result<String> {
    let target = resolve_noted(sessions, &args.target, Some(&caller.identity()), notes)?;
    let target = match target {
        Session::Codex(target) => target,
        Session::OpenCode(target) => {
            let bin = locate_opencode(&|k| std::env::var(k).ok())?;
            let timeout_s = args.timeout_s.unwrap_or(20);
            let api = CliApi {
                bin,
                timeout: std::time::Duration::from_secs(10),
            };
            let result =
                send_opencode(&api, target, &caller.identity(), &args.message, timeout_s).await?;
            return Ok(serde_json::to_string_pretty(&result)?);
        }
        Session::Claude(target) => {
            let result = queue_for_claude(caller, target, &args.message, roots, state)?;
            return Ok(serde_json::to_string_pretty(&result)?);
        }
    };
    let bin = locate_codex(&|k| std::env::var(k).ok())?;
    let result = send_codex(
        &bin,
        target,
        &caller.identity(),
        &args.message,
        args.timeout_s.unwrap_or(20),
        roots,
    )
    .await?;
    Ok(serde_json::to_string_pretty(&result)?)
}

/// Two readings of one process's start time differ by less than this: `btime` in
/// `/proc/stat` can move by a second when the wall clock is stepped.
const START_SLACK_MS: i64 = 2_000;

/// Whether the target of direct message `d` has ended, on POSITIVE evidence only: its pid is
/// not alive, or that pid now belongs to a process that started at another time (a reused
/// pid), or its registration is readable and names another session id. Absence from a
/// discovery listing is not evidence (discovery skips anything it cannot read, such as a
/// registration caught mid-rewrite), and an unreadable start time or registration for a
/// live pid counts as live.
fn target_ended(roots: &Roots, d: &Direct) -> bool {
    if !pid_alive(roots, d.target_pid) {
        return true;
    }
    if let (Some(then), Some(now)) = (d.target_start_ms, process_start_ms(roots, d.target_pid)) {
        if (now - then).abs() > START_SLACK_MS {
            return true;
        }
    }
    d.target_config_dir
        .as_deref()
        .and_then(|c| registered_session(Path::new(c), d.target_pid))
        .is_some_and(|sid| sid != d.target_session)
}

/// A Claude target cannot take a turn from outside, so the message is stored for that exact
/// session (profile, pid, session id) and its own hook delivers it once at its next prompt
/// or tool call. Expiry (24 h, or proof the target ended) is swept here first. The target's
/// process start time and config dir are stored with the message for that proof.
fn queue_for_claude(
    caller: &Session,
    target: &Endpoint,
    message: &str,
    roots: &Roots,
    state: &Path,
) -> Result<SendResult> {
    anyhow::ensure!(
        !state.as_os_str().is_empty(),
        "state directory not available: set HOME or XDG_STATE_HOME"
    );
    std::fs::create_dir_all(state)?;
    let store = Store::open(&state.join("notices.db"))?;
    let now = now_ms();
    store.expire_direct(now, &|d| target_ended(roots, d))?;
    let id = store.post_direct(NewDirect {
        at_ms: now,
        target_profile: target.profile.clone(),
        target_pid: target.pid,
        target_session: target.session_id.clone(),
        target_start_ms: process_start_ms(roots, target.pid),
        target_config_dir: Some(target.config_dir.to_string_lossy().into_owned()),
        sender: caller.identity(),
        body: message.to_string(),
    })?;
    Ok(SendResult {
        message_id: id,
        target: target.key(),
        status: "queued",
        at: chrono::DateTime::from_timestamp_millis(now)
            .map(|t| t.to_rfc3339())
            .unwrap_or_default(),
        reason: "stored for this Claude session; delivered once at its next prompt or tool call; expires after 24 h or when the session ends; an idle session is not woken".into(),
    })
}

/// The caller's direct messages to Claude sessions from the last 24 h, after an expiry
/// sweep, as listing lines. Nothing when there are none or no store exists yet (a listing
/// never creates one); a store error becomes one line instead of failing the listing.
fn sent_lines(caller: &Session, roots: &Roots, state: &Path) -> Vec<String> {
    let db = state.join("notices.db");
    if state.as_os_str().is_empty() || !db.exists() {
        return vec![];
    }
    let now = now_ms();
    let sent = Store::open(&db).and_then(|store| {
        store.expire_direct(now, &|d| target_ended(roots, d))?;
        store.sent_by(&caller.identity(), now - DIRECT_TTL_MS)
    });
    let sent = match sent {
        Ok(s) if s.is_empty() => return vec![],
        Ok(s) => s,
        Err(e) => return vec![format!("Sent messages unavailable: {e}")],
    };
    let mut lines = vec!["Sent messages (24 h):".to_string()];
    for d in sent {
        let at = chrono::DateTime::from_timestamp_millis(d.at_ms)
            .map_or_else(|| "??:??".to_string(), |t| t.format("%H:%M").to_string());
        let session: String = d.target_session.chars().take(8).collect();
        lines.push(format!(
            "- {} to {}:{} session={} status={} at {at} UTC",
            d.id,
            short_profile(&d.target_profile),
            d.target_pid,
            session,
            d.status
        ));
    }
    lines
}

/// Author identity and repository come from `caller`; for an OpenCode caller that is the
/// session's storage identity (logical pid 0) and its directory.
pub fn post_notice(caller: &Session, args: PostNoticeArgs, state: &Path) -> Result<String> {
    let cwd = caller
        .cwd()
        .ok_or_else(|| anyhow!("calling thread cwd is unavailable"))?;
    let me = caller.storage_id();
    let seq = post_notice_from(state, (&me.0, me.1), caller.session_id(), cwd, args)?;
    Ok(format!("Posted notice {seq}."))
}
