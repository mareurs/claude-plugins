//! The `Bridge` MCP server. Tools are stubs until later tasks fill them in.

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use serde::Deserialize;

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

#[tool_router]
impl Bridge {
    #[tool(description = "List live Claude Code sessions on this machine.")]
    fn list_sessions(&self) -> Result<String, ErrorData> {
        Err(not_implemented())
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
