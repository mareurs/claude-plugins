use clap::{Parser, Subcommand};
use rmcp::{transport::io::stdio, ServiceExt};
use session_bridge_mcp::ask::locate_claude;
use session_bridge_mcp::diag;
use session_bridge_mcp::endpoints::{claude_pid_of, repo_of, Roots};
use session_bridge_mcp::filter::{drain_unfiltered, run_filter};
use session_bridge_mcp::hook::{emit, now_ms, on_trigger, session_start, spawn_worker, HookInput};
use session_bridge_mcp::paths::{is_safe_component, profile_of, short_profile, state_root};
use session_bridge_mcp::server::Bridge;
use session_bridge_mcp::store::Store;
use std::io::Read;

#[derive(Parser)]
#[command(
    name = "session-bridge",
    version,
    about = "Channel between Claude Code sessions"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the MCP server over stdio.
    Serve,
    /// List live sessions without a model call.
    Sessions {
        #[arg(long)]
        json: bool,
    },
    /// Handle one host hook event (JSON on stdin), fail-open.
    Hook {
        event: String,
        #[arg(long,default_value="claude",value_parser=["claude","codex"])]
        harness: String,
    },
    /// Filter Claude notices against a session transcript.
    Filter {
        #[arg(long)]
        profile: String,
        #[arg(long)]
        pid: u32,
    },
    /// Filter one Codex thread's pending notices under its own account.
    CodexFilter {
        #[arg(long)]
        profile: String,
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
    let state = state_root(&|k| std::env::var(k).ok())?;
    let db = state.join("notices.db");
    if !db.exists() {
        return None;
    }
    let repo = repo_of(std::path::Path::new(repo_dir))?;
    let store = Store::open(&db).ok()?;
    // No author is excluded: the CLI shows the repository's whole log.
    let page = store
        .after(&repo.to_string_lossy(), i64::try_from(after).ok()?, ("", 0))
        .ok()?;
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

/// Run `session-bridge hook <event>`; never returns, always exits 0, prints only hook output.
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
    let Command::Hook { event, harness } = Cli::try_parse().ok()?.command else {
        return None;
    };
    let mut raw = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin().take(1024 * 1024 + 1), &mut raw).ok()?;
    if raw.len() > 1024 * 1024 {
        return None;
    }
    if harness == "codex" {
        let state = state_root(&|k| std::env::var(k).ok())?;
        let db = state.join("notices.db");
        if event != "session-start" && !db.exists() {
            return None;
        }
        std::fs::create_dir_all(&state).ok()?;
        let store = Store::open(&db).ok()?;
        return session_bridge_mcp::codex_hook::output(
            &raw,
            &event,
            &Roots::system(),
            &state,
            &store,
        );
    }
    match event.as_str() {
        "session-start" => session_start_output(&raw),
        "prompt" => trigger_output(&raw, "UserPromptSubmit"),
        "post-tool" => trigger_output(&raw, "PostToolUse"),
        _ => None,
    }
}

fn session_start_output(raw: &str) -> Option<String> {
    let input: HookInput = serde_json::from_str(raw).ok()?;
    let roots = Roots::system();
    let pid = claude_pid_of(&roots, std::process::id())?;
    let profile = profile_of(std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref());
    let state = state_root(&|k| std::env::var(k).ok())?;
    std::fs::create_dir_all(&state).ok()?;
    let store = Store::open(&state.join("notices.db")).ok()?;
    let view = session_start(&input, (&profile, pid), &roots, &state, &store)?;
    Some(emit("SessionStart", &view))
}

/// `hook prompt` and `hook post-tool`. This runs on every tool call, so it stops before
/// touching anything when there is no notice store yet: no store open, no state write.
fn trigger_output(raw: &str, event: &str) -> Option<String> {
    let state = state_root(&|k| std::env::var(k).ok())?;
    let db = state.join("notices.db");
    if !db.exists() {
        return None;
    }
    let input: HookInput = serde_json::from_str(raw).ok()?;
    if input.agent_id.is_some() {
        return None;
    }
    let roots = Roots::system();
    let pid = claude_pid_of(&roots, std::process::id())?;
    let profile = profile_of(std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref());
    let store = Store::open(&db).ok()?;
    let text = on_trigger(
        &input,
        (&profile, pid),
        &roots,
        &state,
        &store,
        now_ms(),
        &spawn_worker,
    )?;
    Some(emit(event, &text))
}

#[tokio::main(flavor = "multi_thread")]
async fn run() -> anyhow::Result<()> {
    match Cli::parse().command {
        Command::Serve => {
            Bridge::new().serve(stdio()).await?.waiting().await?;
        }
        Command::Sessions { json } => {
            let (sessions, notes) =
                session_bridge_mcp::sessions::discover_sessions_all(&Roots::system(), &|k| {
                    std::env::var(k).ok()
                })
                .await;
            for note in &notes {
                eprintln!("note: {note}");
            }
            if json {
                let rows:Vec<_>=sessions.iter().map(|s|{
                    let (harness,pid,profile)=match s {
                        session_bridge_mcp::sessions::Session::Claude(e)=>("claude",e.pid,&e.config_dir),
                        session_bridge_mcp::sessions::Session::Codex(e)=>("codex",e.pid,&e.config_dir),
                        session_bridge_mcp::sessions::Session::OpenCode(e)=>("opencode",0,&e.data_dir)
                    };
                    serde_json::json!({"key":s.key(),"harness":harness,"pid":pid,"config_dir":profile,"session_id":s.session_id(),"cwd":s.cwd()})
                }).collect();
                println!("{}", serde_json::to_string_pretty(&rows)?);
            } else {
                for s in sessions {
                    println!("{}", s.render(false));
                }
            }
        }
        Command::Notices { repo, after, json } => {
            if let Some(out) = notices_output(&repo, after, json).filter(|o| !o.is_empty()) {
                println!("{out}");
            }
        }
        Command::Hook { .. } => {}
        Command::Filter { profile, pid } => filter_cmd(&profile, pid).await,
        Command::CodexFilter { profile } => codex_filter_cmd(&profile).await,
    }
    Ok(())
}
/// `session-bridge filter`: judge the pending notices of one endpoint. Silent and exit 0 on
/// any error. The profile becomes part of a file name, so an unsafe one stops here, before
/// it can reach `endpoint_path`. Every later early return drains the oldest batch of
/// `pending` into unfiltered verdicts and clears `worker_pid` (only when the endpoint state
/// file exists), so the notices are still delivered and a worker that could not run does
/// not look alive.
async fn filter_cmd(profile: &str, pid: u32) {
    if !is_safe_component(profile) {
        return;
    }
    // Without a state directory there is no endpoint state to drain into.
    let Some(state) = state_root(&|k| std::env::var(k).ok()) else {
        return;
    };
    let Ok(bin) = locate_claude(&|k| std::env::var(k).ok()) else {
        drain_unfiltered(&state, profile, pid, "no claude binary");
        return;
    };
    let db = state.join("notices.db");
    if !db.exists() {
        drain_unfiltered(&state, profile, pid, "notice store unavailable");
        return;
    }
    let Ok(store) = Store::open(&db) else {
        drain_unfiltered(&state, profile, pid, "notice store unavailable");
        return;
    };
    if let Err(e) = run_filter(&bin.to_string_lossy(), &state, &store, profile, pid).await {
        diag::note(&format!("filter: {e}"));
    }
}

async fn codex_filter_cmd(profile: &str) {
    if !is_safe_component(profile) || !profile.starts_with("codex-") {
        return;
    }
    let Some(state) = state_root(&|k| std::env::var(k).ok()) else {
        return;
    };
    let drain = |reason: &str| drain_unfiltered(&state, profile, 0, reason);
    let Some(target) = session_bridge_mcp::codex::discover_codex(&Roots::system())
        .into_iter()
        .find(|e| e.storage_profile() == profile)
    else {
        drain("Codex receiver no longer loaded");
        return;
    };
    let bin = match session_bridge_mcp::codex_process::locate_codex(&|k| std::env::var(k).ok()) {
        Ok(b) => b,
        Err(_) => {
            drain("no Codex binary");
            return;
        }
    };
    let store = match Store::open(&state.join("notices.db")) {
        Ok(s) => s,
        Err(_) => {
            drain("Codex notice store unavailable");
            return;
        }
    };
    let timeout = session_bridge_mcp::filter::filter_timeout(
        std::env::var("SESSION_BRIDGE_FILTER_TIMEOUT_S")
            .ok()
            .as_deref(),
    );
    if let Err(e) =
        session_bridge_mcp::filter::run_codex_filter(&bin, &state, &store, &target, timeout).await
    {
        diag::note(&format!("Codex filter: {e}"));
        drain("Codex filter failed");
    }
}
