//! The bridge tool bodies, shared by the MCP server (`server.rs`) and the
//! `session-bridge call` CLI that OpenCode sessions use. Each body gets an already
//! resolved caller; how the caller was identified is the entry point's job.

use crate::ask::{ask, clamp_timeout, locate_claude};
use crate::codex_process::{ask_codex, locate_codex};
use crate::endpoints::{repo_of, Roots};
use crate::opencode_api::{locate_opencode, CliApi};
use crate::opencode_ask::ask_opencode;
use crate::opencode_send::send_opencode;
use crate::paths::short_profile;
use crate::send::send_codex;
use crate::server::{addressed_result, now_ms, post_notice_from};
use crate::sessions::{resolve_noted, resolve_session, split_by_repo, Session};
use crate::state::{endpoint_path, load_or_default};
use crate::store::advised_note;
use anyhow::{anyhow, Result};
use rmcp::schemars;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
pub struct ListSessionsArgs {
    /// List sessions of every repository. Default false: only the caller's repository.
    #[serde(default)]
    pub all: bool,
}

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
    /// Exact loaded Codex thread address, OpenCode address, UUID/prefix or unambiguous name.
    pub target: String,
    /// Peer message, at most 16000 characters. Starts a normal target turn.
    pub message: String,
    /// Queue/observation budget in seconds (default 20, clamped to 1..=30).
    #[serde(default)]
    pub timeout_s: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PostNoticeArgs {
    /// Short title (at most 120 characters).
    #[schemars(length(max = 120))]
    pub title: String,
    /// Notice body (at most 4000 characters).
    #[schemars(length(max = 4000))]
    pub body: String,
    /// References such as files, branches or commits (at most 20).
    #[serde(default)]
    pub refs: Vec<String>,
    /// Optional target: a session key, session id, id prefix of 4 or more characters, or name; without it the notice goes to the repository.
    #[serde(default)]
    pub to: Option<String>,
}

/// The listing, one line per session; `caller` gets the `(you)` mark.
pub async fn list_sessions(
    caller: Option<&Session>,
    sessions: &[Session],
    notes: &[String],
    args: ListSessionsArgs,
) -> Result<String> {
    let me = caller.map(Session::identity);
    let my_repo = caller.and_then(Session::cwd).and_then(repo_of);
    let (shown, hidden): (Vec<&Session>, Vec<&Session>) = match (&my_repo, args.all) {
        (Some(repo), false) => split_by_repo(sessions, repo, &repo_of),
        _ => (sessions.iter().collect(), Vec::new()),
    };
    let mut lines: Vec<String> = shown
        .iter()
        .map(|s| s.render(me.as_deref() == Some(s.identity().as_str())))
        .collect();
    if lines.is_empty() {
        lines.push(match my_repo.as_ref().filter(|_| !args.all) {
            Some(repo) => format!("No live sessions in this repository ({}).", repo.display()),
            None => "No live Claude Code sessions, rollout-backed Codex threads or OpenCode sessions found.".into(),
        });
    }
    if !hidden.is_empty() {
        lines.push(format!(
            "{} more session(s) in other repositories are not shown. Call list_sessions with all=true to list them.",
            hidden.len()
        ));
    }
    if my_repo.is_none() && !args.all {
        lines.push("Repository filter not applied: the caller's repository is unknown, so every session is listed.".into());
    }
    lines.push("Scope: local Linux, Claude native/IPC session registrations, Codex open rollouts and live OpenCode sessions (top-level, not bridge ask forks, running or active within SESSION_BRIDGE_OPENCODE_RECENT_HOURS); saved-only Codex threads and hosts without open rollouts are outside this listing.".into());
    for note in notes {
        lines.push(format!("Discovery note: {note}"));
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
        Session::Claude(_) => {
            return Err(anyhow!(
                "direct messages support Codex and OpenCode targets only; use post_notice(to=...) to message a Claude Code session, or ask_session for a question"
            ));
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

/// Author identity and repository come from `caller`; for an OpenCode caller that is the
/// session's storage identity (logical pid 0) and its directory.
pub fn post_notice(
    caller: &Session,
    sessions: &[Session],
    args: PostNoticeArgs,
    state: &Path,
) -> Result<String> {
    let cwd = caller
        .cwd()
        .ok_or_else(|| anyhow!("calling thread cwd is unavailable"))?;
    // An addressed notice resolves its target first: a failure posts nothing.
    let target = match args.to.as_deref() {
        Some(to) => {
            let t = resolve_session(sessions, to, Some(&caller.identity()))?;
            // OpenCode hooks never read addressed notices, so one posted there would vanish.
            if matches!(t, Session::OpenCode(_)) {
                return Err(anyhow!(
                    "addressed notices support Claude Code and Codex targets only; use send_message for an OpenCode session"
                ));
            }
            Some(t)
        }
        None => None,
    };
    let to_session = target.map(|t| t.session_id().to_string());
    let me = caller.storage_id();
    // Read the lengths before `args` moves: a notice over its advised length but inside the
    // tolerance is stored whole, and the result says so.
    let note = advised_note(&args.title, &args.body);
    let seq = post_notice_from(
        state,
        (&me.0, me.1),
        caller.session_id(),
        cwd,
        args,
        to_session,
    )?;
    let result = match target {
        None => format!("Posted notice {seq}."),
        Some(t) => {
            let (profile, pid) = t.storage_id();
            let st = load_or_default(&endpoint_path(state, &profile, pid));
            addressed_result(seq, &t.key(), &st, now_ms())
        }
    };
    Ok(match note {
        Some(note) => format!("{result} {note}"),
        None => result,
    })
}
