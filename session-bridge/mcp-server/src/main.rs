mod error;
mod registry;
mod claude_cli;
mod tools;

use rmcp::{
    ErrorData,
    ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
    transport::io::stdio,
    ServiceExt,
};
use serde::Deserialize;

// ── arg structs ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AskArgs {
    /// Session reference: session_id prefix, alias, or "cwd:<path>".
    #[schemars(rename = "ref")]
    r#ref: String,
    /// The prompt to send to the target session.
    prompt: String,
    /// "ephemeral" (default) leaves producer history untouched; "bidirectional" appends.
    #[serde(default = "default_mode")]
    mode: String,
    /// Timeout in seconds (default 120).
    #[serde(default = "default_timeout")]
    timeout_s: u64,
}

fn default_mode() -> String { "ephemeral".into() }
fn default_timeout() -> u64 { 120 }

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AliasArgs {
    /// The session_id to alias.
    session_id: String,
    /// New alias string, or omit/null to clear.
    alias: Option<String>,
}

// ── server struct ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Bridge {
    tool_router: ToolRouter<Self>,
}

impl Bridge {
    fn new() -> Self {
        Self { tool_router: Self::tool_router() }
    }
}

// ── tool implementations ──────────────────────────────────────────────────────

#[tool_router]
impl Bridge {
    #[tool(description = "List active Claude Code sessions registered on this machine.")]
    fn list_sessions(&self) -> Result<String, ErrorData> {
        let items = tools::list_sessions().map_err(bridge_err)?;
        serde_json::to_string_pretty(&items)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }

    #[tool(description = "Ask a question to a running Claude Code session. Returns the answer text. Use mode=\"ephemeral\" (default) to leave the producer's conversation history untouched.")]
    async fn ask_session(&self, Parameters(args): Parameters<AskArgs>) -> Result<String, ErrorData> {
        let result = tools::ask_session(&args.r#ref, &args.prompt, &args.mode, args.timeout_s)
            .await
            .map_err(bridge_err)?;
        serde_json::to_string_pretty(&result)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }

    #[tool(description = "Set or clear an alias for a registered session. Pass alias=null to clear.")]
    fn set_alias(&self, Parameters(args): Parameters<AliasArgs>) -> Result<String, ErrorData> {
        tools::set_alias(&args.session_id, args.alias).map_err(bridge_err)?;
        Ok("ok".into())
    }
}

// ── ServerHandler (tool routing delegated to ToolRouter) ─────────────────────

#[tool_handler]
impl ServerHandler for Bridge {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(
                "session-bridge: list and query active Claude Code sessions. \
                 ask_session(ref, prompt) sends a prompt to a running session and returns \
                 the answer; use mode=\"ephemeral\" (default) to leave the producer's \
                 history untouched.",
            )
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn bridge_err(e: error::BridgeError) -> ErrorData {
    ErrorData::invalid_params(e.to_string(), None)
}

// ── entry point ───────────────────────────────────────────────────────────────

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    let bridge = Bridge::new();
    bridge.serve(stdio()).await?.waiting().await?;
    Ok(())
}
