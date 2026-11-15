//! The `Bridge` MCP server. Tools are stubs until later tasks fill them in.

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use serde::Deserialize;
use crate::ask::{ask, clamp_timeout, locate_claude};
use crate::endpoints::{discover, repo_of, resolve_target, Endpoint, Roots};
use crate::error::BridgeError;
use crate::paths::{profile_of, short_profile, state_root};

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AskArgs {
    /// Target endpoint, `<short profile>:<pid>`, or a session name.
    pub target: String,
    /// The question to ask the target session.
    pub question: String,
    /// Model alias or id (default `haiku`).
    #[serde(default)]
    pub model: Option<String>,
    /// Seconds to wait for the answer (default 120, clamped to 1..=300).
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

#[derive(Debug, Clone)]
pub struct Bridge {
    #[allow(dead_code)] // read by #[tool_router]/#[tool_handler] macro expansion
    tool_router: ToolRouter<Self>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self::new()
    }
}

impl Bridge {
    pub fn new() -> Self {
        Self { tool_router: Self::tool_router() }
    }
}

/// The calling endpoint: (full profile of `CLAUDE_CONFIG_DIR`, pid of the Claude Code parent).
fn calling_endpoint() -> (String, u32) {
    (
        profile_of(std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref()),
        std::os::unix::process::parent_id(),
    )
}

fn to_error(e: BridgeError) -> ErrorData {
    ErrorData::internal_error(e.to_string(), None)
}


fn not_implemented() -> ErrorData {
    ErrorData::internal_error("not implemented", None)
}

/// One line per live session, sorted by profile then pid; the caller's own is marked `(you)`.
fn render_sessions(eps: &[Endpoint], me: (&str, u32)) -> String {
    if eps.is_empty() {
        return "No live Claude Code sessions found.".to_string();
    }
    let mut sorted: Vec<&Endpoint> = eps.iter().collect();
    sorted.sort_by(|a, b| (&a.profile, a.pid).cmp(&(&b.profile, b.pid)));
    sorted
        .iter()
        .map(|e| {
            format!(
                "{}{} session={} name={} kind={} status={} cwd={} repo={}",
                e.key(),
                if e.profile == me.0 && e.pid == me.1 { " (you)" } else { "" },
                e.session_id,
                e.name.as_deref().unwrap_or("-"),
                e.kind.as_deref().unwrap_or("-"),
                e.status.as_deref().unwrap_or("-"),
                e.launch_cwd.display(),
                e.repo.as_ref().map_or("-".to_string(), |r| r.display().to_string()),
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tool_router]
impl Bridge {
    #[tool(description = "List live Claude Code sessions on this machine.")]
    fn list_sessions(&self) -> Result<String, ErrorData> {
        let roots = Roots::system();
        let me = calling_endpoint();
        let mut eps = discover(&roots);
        for e in &mut eps {
            e.repo = repo_of(&e.launch_cwd);
        }
        Ok(render_sessions(&eps, (&me.0, me.1)))
    }

    #[tool(
        description = "Ask another live Claude Code session a question. A read-only fork of it answers from its context; the session itself is not disturbed. Works across profiles; the target's profile pays. Returns the answer with its cost."
    )]
    async fn ask_session(&self, Parameters(args): Parameters<AskArgs>) -> Result<String, ErrorData> {
        let me = calling_endpoint();
        let eps = discover(&Roots::system());
        let target = resolve_target(&eps, &args.target, (&me.0, me.1)).map_err(to_error)?.clone();
        let asker = format!("{}:{}", short_profile(&me.0), me.1);
        let bin = locate_claude(&|k| std::env::var(k).ok()).map_err(to_error)?;
        let state = state_root(&|k| std::env::var(k).ok());
        let model = args.model.as_deref().unwrap_or("haiku");
        let timeout_s = clamp_timeout(args.timeout_s);
        let result = ask(&bin.to_string_lossy(), &target, &asker, &args.question, model, timeout_s, &state)
            .await
            .map_err(to_error)?;
        serde_json::to_string_pretty(&result).map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }


    #[tool(description = "Post a notice that reaches the sessions it matters to.")]
    fn post_notice(&self, Parameters(_args): Parameters<PostNoticeArgs>) -> Result<String, ErrorData> {
        Err(not_implemented())
    }
}

#[tool_handler]
impl ServerHandler for Bridge {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "session-bridge: channel between Claude Code sessions. list_sessions, \
             ask_session(target, question) and post_notice(title, body, refs).",
        )
    }
}
