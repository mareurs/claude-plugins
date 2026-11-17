//! The bridge tool bodies, shared by the MCP server (`server.rs`) and the
//! `session-bridge call` CLI that OpenCode sessions use. Each body gets an already
//! resolved caller; how the caller was identified is the entry point's job.

use crate::ask::{ask, clamp_timeout, locate_claude};
use crate::codex_process::{ask_codex, locate_codex};
use crate::endpoints::Roots;
use crate::opencode_api::{locate_opencode, CliApi};
use crate::opencode_ask::ask_opencode;
use crate::opencode_send::send_opencode;
use crate::paths::short_profile;
use crate::send::send_codex;
use crate::server::post_notice_from;
use crate::sessions::{resolve_session, Session};
use anyhow::{anyhow, Result};
use rmcp::schemars;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AskArgs {
    /// Claude endpoint, canonical Codex address, UUID/prefix or unambiguous session name.
    pub target: String,
    /// The question to ask the target session.
    pub question: String,
    /// Claude alias or Codex model id; defaults to haiku for Claude and the Codex default for Codex.
    #[serde(default)]
    pub model: Option<String>,
    /// Seconds to wait for the answer (default 120, clamped to 1..=300).
    #[serde(default)]
    pub timeout_s: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SendMessageArgs {
    /// Exact loaded Codex thread address, UUID or unambiguous name.
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
    pub title: String,
    /// Notice body (at most 4000 characters).
    pub body: String,
    /// References such as files, branches or commits (at most 20).
    #[serde(default)]
    pub refs: Vec<String>,
}

/// The listing, one line per session; `caller` gets the `(you)` mark.
pub async fn list_sessions(
    caller: Option<&Session>,
    sessions: &[Session],
    notes: &[String],
    _state: &Path,
) -> Result<String> {
    let me = caller.map(Session::identity);
    let mut lines: Vec<String> = sessions
        .iter()
        .map(|s| s.render(me.as_deref() == Some(s.identity().as_str())))
        .collect();
    if lines.is_empty() {
        lines.push("No live Claude Code sessions or rollout-backed Codex threads found.".into());
    }
    lines.push("Scope: local Linux, Claude native/IPC session registrations and Codex open rollouts; saved-only threads and hosts without open rollouts are outside this listing.".into());
    for note in notes {
        lines.push(format!("Discovery note: {note}"));
    }
    Ok(lines.join("\n"))
}

pub async fn ask_session(
    caller: &Session,
    sessions: &[Session],
    args: AskArgs,
    roots: &Roots,
    state: &Path,
) -> Result<String> {
    let target = resolve_session(sessions, &args.target, Some(&caller.identity()))?.clone();
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
    args: SendMessageArgs,
    roots: &Roots,
    _state: &Path,
) -> Result<String> {
    let target = resolve_session(sessions, &args.target, Some(&caller.identity()))?;
    let target = match target {
        Session::Codex(target) => target,
        Session::OpenCode(target) => {
            let bin = locate_opencode(&|k| std::env::var(k).ok())?;
            let timeout_s = args.timeout_s.unwrap_or(20);
            let api = CliApi {
                bin,
                timeout: std::time::Duration::from_secs(10),
            };
            let result = send_opencode(
                &api,
                target,
                &caller.identity(),
                &args.message,
                timeout_s,
            )
            .await?;
            return Ok(serde_json::to_string_pretty(&result)?);
        }
        Session::Claude(_) => {
            return Err(anyhow!(
                "direct messages currently support Codex and OpenCode targets only; use ask_session for Claude"
            ))
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
pub fn post_notice(caller: &Session, args: PostNoticeArgs, state: &Path) -> Result<String> {
    let cwd = caller
        .cwd()
        .ok_or_else(|| anyhow!("calling thread cwd is unavailable"))?;
    let me = caller.storage_id();
    let seq = post_notice_from(state, (&me.0, me.1), caller.session_id(), cwd, args)?;
    Ok(format!("Posted notice {seq}."))
}
