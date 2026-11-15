use clap::{Parser, Subcommand};
use rmcp::{transport::io::stdio, ServiceExt};
use session_bridge_mcp::server::Bridge;

#[derive(Parser)]
#[command(name = "session-bridge", version, about = "Channel between Claude Code sessions")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the MCP server over stdio.
    Serve,
    /// Handle one Claude Code hook event (JSON on stdin).
    Hook {
        /// Hook event name, e.g. SessionStart.
        event: String,
    },
    /// Filter notices against a session transcript.
    Filter {
        #[arg(long)]
        profile: String,
        #[arg(long)]
        pid: u32,
    },
    /// List notices for a repository.
    Notices {
        #[arg(long)]
        repo: String,
        #[arg(long)]
        after: u64,
        #[arg(long)]
        json: bool,
    },
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    match Cli::parse().command {
        Command::Serve => {
            Bridge::new().serve(stdio()).await?.waiting().await?;
        }
        Command::Hook { .. } | Command::Filter { .. } | Command::Notices { .. } => {
            eprintln!("not implemented");
        }
    }
    Ok(())
}
