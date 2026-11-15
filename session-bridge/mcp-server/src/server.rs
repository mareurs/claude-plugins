//! The `Bridge` MCP server. Tools are stubs until later tasks fill them in.

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use serde::Deserialize;
use crate::endpoints::{discover, repo_of, Endpoint, Roots};
use crate::paths::profile_of;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AskArgs {
    /// Target endpoint, `<short profile>:<pid>`, or a session name.
    pub target: String,
    /// The question to ask the target session.
    pub question: String,
    /// Model alias or id (default `haiku`).
    #[serde(default)]
    pub model: Option<String>,
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
        let me = (
            profile_of(std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref()),
            std::os::unix::process::parent_id(),
        );
        let mut eps = discover(&roots);
        for e in &mut eps {
            e.repo = repo_of(&e.launch_cwd);
        }
        Ok(render_sessions(&eps, (&me.0, me.1)))
    }

    #[tool(description = "Ask a live session a read-only question through a fork of its context.")]
    async fn ask_session(&self, Parameters(_args): Parameters<AskArgs>) -> Result<String, ErrorData> {
        Err(not_implemented())
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
