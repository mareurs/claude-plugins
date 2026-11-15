use clap::{Parser, Subcommand};
use rmcp::{transport::io::stdio, ServiceExt};
use session_bridge_mcp::ask::locate_claude;
use session_bridge_mcp::endpoints::{claude_pid_of, repo_of, Roots};
use session_bridge_mcp::filter::{clear_worker_pid, run_filter};
use session_bridge_mcp::hook::{emit, session_start, HookInput};
use session_bridge_mcp::diag;
use session_bridge_mcp::paths::{is_safe_component, profile_of, short_profile, state_root};
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

fn main() -> anyhow::Result<()> {
    // Hooks are fail-open: a bad command line or a panic must exit 0 and print nothing,
    // so they never reach clap's own error handling or the default panic report.
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("hook")) {
        run_hook_fail_open();
    }
    run()
}

/// Run `session-bridge hook <event>`; never returns, always exits 0, prints only a view.
fn run_hook_fail_open() -> ! {
    std::panic::set_hook(Box::new(|_| {}));
    let _ = std::panic::catch_unwind(|| {
        if let Some(out) = hook_output() {
            use std::io::Write;
            let _ = writeln!(std::io::stdout(), "{out}");
        }
    });
    std::process::exit(0)
}

/// The text a hook prints, or `None` for nothing.
fn hook_output() -> Option<String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("SESSION_BRIDGE_TEST_PANIC").is_some() {
        panic!("forced by SESSION_BRIDGE_TEST_PANIC");
    }
    let Command::Hook { event } = Cli::try_parse().ok()?.command else {
        return None;
    };
    let mut raw = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut raw).ok()?;
    match event.as_str() {
        "session-start" => session_start_output(&raw),
        // `prompt` and `post-tool` arrive with the filter worker.
        _ => None,
    }
}

fn session_start_output(raw: &str) -> Option<String> {
    let input: HookInput = serde_json::from_str(raw).ok()?;
    let roots = Roots::system();
    let pid = claude_pid_of(&roots, std::process::id())?;
    let profile = profile_of(std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref());
    let state = state_root(&|k| std::env::var(k).ok());
    std::fs::create_dir_all(&state).ok()?;
    let store = Store::open(&state.join("notices.db")).ok()?;
    let view = session_start(&input, (&profile, pid), &roots, &state, &store)?;
    Some(emit("SessionStart", &view))
}

#[tokio::main(flavor = "multi_thread")]
async fn run() -> anyhow::Result<()> {
    match Cli::parse().command {
        Command::Serve => {
            Bridge::new().serve(stdio()).await?.waiting().await?;
        }
        Command::Notices { repo, after, json } => {
            if let Some(out) = notices_output(&repo, after, json).filter(|o| !o.is_empty()) {
                println!("{out}");
            }
        }
        // `hook` is handled in `main` before clap runs.
        Command::Hook { .. } => {}
        Command::Filter { profile, pid } => filter_cmd(&profile, pid).await,
    }
    Ok(())
}
/// `session-bridge filter`: judge the pending notices of one endpoint. Silent and exit 0 on
/// any error. The profile becomes part of a file name, so an unsafe one stops here, before
/// it can reach `endpoint_path`. Every later early return clears the endpoint's
/// `worker_pid` (only when its state file exists), so a worker that could not start does
/// not look alive.
async fn filter_cmd(profile: &str, pid: u32) {
    if !is_safe_component(profile) {
        return;
    }
    let state = state_root(&|k| std::env::var(k).ok());
    let Ok(bin) = locate_claude(&|k| std::env::var(k).ok()) else {
        clear_worker_pid(&state, profile, pid);
        return;
    };
    let db = state.join("notices.db");
    if !db.exists() {
        clear_worker_pid(&state, profile, pid);
        return;
    }
    let Ok(store) = Store::open(&db) else {
        clear_worker_pid(&state, profile, pid);
        return;
    };
    if let Err(e) = run_filter(&bin.to_string_lossy(), &state, &store, profile, pid).await {
        diag::note(&format!("filter: {e}"));
    }
}
