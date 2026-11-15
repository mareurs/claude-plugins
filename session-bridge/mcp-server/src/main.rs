use clap::{Parser, Subcommand};
use rmcp::{transport::io::stdio, ServiceExt};
use session_bridge_mcp::endpoints::repo_of;
use session_bridge_mcp::paths::{short_profile, state_root};
use session_bridge_mcp::server::Bridge;
use session_bridge_mcp::store::Store;

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

/// `session-bridge notices`: the page of notices for the repository of `repo_dir` after
/// `after`, as text (one line per notice) or JSON. `None` on any internal error, so the
/// caller prints nothing and exits 0 (scripts call this).
fn notices_output(repo_dir: &str, after: u64, json: bool) -> Option<String> {
    let state = state_root(&|k| std::env::var(k).ok());
    let db = state.join("notices.db");
    if !db.exists() {
        return None;
    }
    let repo = repo_of(std::path::Path::new(repo_dir))?;
    let store = Store::open(&db).ok()?;
    // No author is excluded: the CLI shows the repository's whole log.
    let page = store.after(&repo.to_string_lossy(), i64::try_from(after).ok()?, ("", 0)).ok()?;
    if json {
        return serde_json::to_string(&page).ok();
    }
    let lines: Vec<String> = page
        .notices
        .iter()
        .map(|n| {
            let at = chrono::DateTime::from_timestamp_millis(n.at_ms)
                .map_or_else(|| "??:??".to_string(), |t| t.format("%H:%M").to_string());
            format!(
                "{} {} UTC {}:{} {}",
                n.seq,
                at,
                short_profile(&n.author_profile),
                n.author_pid,
                n.title
            )
        })
        .collect();
    Some(lines.join("\n"))
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    match Cli::parse().command {
        Command::Serve => {
            Bridge::new().serve(stdio()).await?.waiting().await?;
        }
        Command::Notices { repo, after, json } => {
            if let Some(out) = notices_output(&repo, after, json).filter(|o| !o.is_empty()) {
                println!("{out}");
            }
        }
        Command::Hook { .. } | Command::Filter { .. } => {
            eprintln!("not implemented");
        }
    }
    Ok(())
}
