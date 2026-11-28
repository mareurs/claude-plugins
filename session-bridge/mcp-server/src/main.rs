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
        #[arg(long,default_value="claude",value_parser=["claude","codex","opencode"])]
        harness: String,
    },
    /// Wait for an addressed notice and wake an idle Claude session (asyncRewake hook).
    Watch,
    /// Filter Claude notices against a session transcript.
    Filter {
        #[arg(long)]
        profile: String,
        #[arg(long)]
        pid: u32,
    },
    /// Settle one OpenCode session's pending notices as unfiltered verdicts.
    OpencodeFilter {
        #[arg(long)]
        profile: String,
    },
    /// Filter one Codex thread's pending notices under its own account.
    CodexFilter {
        #[arg(long)]
        profile: String,
    },
    /// Run one bridge tool for an OpenCode session: JSON arguments on stdin, the tool's
    /// output on stdout; an error goes to stderr with exit code 2.
    Call {
        tool: String,
        /// The calling session's id, as OpenCode's plugin passes it (`tctx.sessionID`).
        #[arg(long)]
        opencode_caller: String,
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
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("watch")) {
        run_watch_fail_open();
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

/// Run `session-bridge watch`; never returns. Exit 2 with the notice text on stderr is the
/// deliberate wake; every other outcome, a panic included, exits 0 and prints nothing.
fn run_watch_fail_open() -> ! {
    std::panic::set_hook(Box::new(|_| {}));
    let woke = std::panic::catch_unwind(watch_output).ok().flatten();
    if let Some(text) = woke {
        use std::io::Write;
        let _ = writeln!(std::io::stderr(), "{text}");
        std::process::exit(2);
    }
    std::process::exit(0)
}

/// The notice text to wake the session with, or `None` for nothing.
fn watch_output() -> Option<String> {
    use session_bridge_mcp::wake::{wake_enabled, watch, Clock, WatchOutcome};
    let env = |k: &str| std::env::var(k).ok();
    if !wake_enabled(&env) {
        return None;
    }
    let mut raw = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin().take(1024 * 1024 + 1), &mut raw).ok()?;
    if raw.len() > 1024 * 1024 {
        return None;
    }
    let input: HookInput = serde_json::from_str(&raw).ok()?;
    let roots = Roots::system();
    let pid = claude_pid_of(&roots, std::process::id())?;
    let profile = profile_of(std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref());
    let state = state_root(&env)?;
    std::fs::create_dir_all(&state).ok()?;
    let store = Store::open(&state.join("notices.db")).ok()?;
    let clock = Clock {
        now_ms: &now_ms,
        sleep_ms: &|ms| std::thread::sleep(std::time::Duration::from_millis(ms)),
    };
    match watch(
        &input,
        (&profile, pid),
        &roots,
        &state,
        &store,
        &clock,
        &|| wake_enabled(&env),
    ) {
        WatchOutcome::Wake(text) => Some(text),
        WatchOutcome::Done => None,
    }
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
    if harness == "codex" || harness == "opencode" {
        let state = state_root(&|k| std::env::var(k).ok())?;
        let db = state.join("notices.db");
        if event != "session-start" && !db.exists() {
            return None;
        }
        std::fs::create_dir_all(&state).ok()?;
        let store = Store::open(&db).ok()?;
        let roots = Roots::system();
        if harness == "opencode" {
            return session_bridge_mcp::opencode_hook::output(&raw, &event, &roots, &state, &store);
        }
        return session_bridge_mcp::codex_hook::output(&raw, &event, &roots, &state, &store);
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

/// Upper bound on the fork cleanup a signalled `session-bridge call` waits for before it
/// exits. The OpenCode plugin's SIGTERM-to-SIGKILL grace is longer than this.
const SIGNAL_CLEANUP: std::time::Duration = std::time::Duration::from_secs(3);

/// `call_output`, raced against SIGTERM and SIGINT (the OpenCode plugin sends SIGTERM on Esc
/// and on its own timeout). On a signal the tool future is dropped, which arms the OpenCode
/// ask's fork cleanup (interrupt, then remove), and that cleanup is awaited, at most
/// `SIGNAL_CLEANUP`, before the error return makes the process exit non-zero.
async fn call_until_signal(tool: &str, opencode_caller: &str) -> anyhow::Result<String> {
    #[cfg(unix)]
    let (mut term, mut int) = {
        use tokio::signal::unix::{signal, SignalKind};
        (
            signal(SignalKind::terminate())?,
            signal(SignalKind::interrupt())?,
        )
    };
    #[cfg(windows)]
    let (mut term, mut int) = (
        tokio::signal::windows::ctrl_break()?,
        tokio::signal::windows::ctrl_c()?,
    );
    let mut work = Box::pin(call_output(tool, opencode_caller));
    let outcome = tokio::select! {
        r = &mut work => r,
        _ = term.recv() => Err(anyhow::anyhow!("stopped by SIGTERM")),
        _ = int.recv() => Err(anyhow::anyhow!("stopped by SIGINT")),
    };
    drop(work);
    // Normal timeout/error exit must drain late creation too, before runtime shutdown.
    let cleaned = session_bridge_mcp::opencode_ask::await_fork_cleanups(SIGNAL_CLEANUP).await;
    if cleaned {
        outcome
    } else {
        Err(anyhow::anyhow!(
            "{}; the OpenCode fork cleanup did not finish; a pending creation may remain",
            outcome
                .err()
                .map(|e| format!("{e:#}"))
                .unwrap_or_else(|| "tool completed".into())
        ))
    }
}

/// `session-bridge call`: the OpenCode entry to the shared tool bodies. The caller is the
/// `--opencode-caller` id only, validated against the discovered service; no environment or
/// state file can name an OpenCode identity. Listing works without a valid caller (no
/// `(you)` mark); every other tool refuses before any effect.
async fn call_output(tool: &str, opencode_caller: &str) -> anyhow::Result<String> {
    use anyhow::Context;
    use session_bridge_mcp::{
        opencode, opencode_api, server::state_dir, sessions::discover_sessions_all, tools,
    };
    anyhow::ensure!(
        [
            "list_sessions",
            "ask_session",
            "send_message",
            "post_notice"
        ]
        .contains(&tool),
        "unknown tool {tool:?}"
    );
    let mut raw = String::new();
    std::io::stdin()
        .take(1024 * 1024 + 1)
        .read_to_string(&mut raw)
        .context("could not read tool arguments")?;
    anyhow::ensure!(raw.len() <= 1024 * 1024, "tool arguments exceed 1 MiB");
    let args: serde_json::Value = if raw.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(&raw).context("tool arguments are not valid JSON")?
    };
    let env = |k: &str| std::env::var(k).ok();
    let roots = Roots::system();
    let (sessions, notes) = discover_sessions_all(&roots, &env).await;
    let caller = match opencode_api::locate_opencode(&env) {
        Ok(bin) => {
            let api = opencode_api::CliApi {
                bin,
                timeout: std::time::Duration::from_secs(10),
            };
            opencode::opencode_caller(&sessions, &api, opencode_caller).await
        }
        Err(e) => Err(e.context("OpenCode caller cannot be validated")),
    };
    match tool {
        "list_sessions" => {
            let me = caller.as_ref().ok().copied();
            let args = serde_json::from_value(args).context("invalid list_sessions arguments")?;
            let mut out = tools::list_sessions(me, &sessions, &notes, args).await?;
            if let Err(e) = &caller {
                out.push_str(&format!("\nCaller identity unavailable: {e:#}"));
            }
            Ok(out)
        }
        "ask_session" => {
            let args = serde_json::from_value(args).context("invalid ask_session arguments")?;
            let caller = caller?;
            let state = state_dir(&env)?;
            tools::ask_session(caller, &sessions, &notes, args, &roots, &state).await
        }
        "send_message" => {
            let args = serde_json::from_value(args).context("invalid send_message arguments")?;
            let caller = caller?;
            tools::send_message(caller, &sessions, &notes, args, &roots).await
        }
        _ => {
            let args = serde_json::from_value(args).context("invalid post_notice arguments")?;
            let caller = caller?;
            let state = state_dir(&env)?;
            tools::post_notice(caller, &sessions, args, &state)
        }
    }
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
        Command::Watch => {}
        Command::Call {
            tool,
            opencode_caller,
        } => match call_until_signal(&tool, &opencode_caller).await {
            Ok(out) => println!("{out}"),
            Err(e) => {
                eprintln!("session-bridge call: {e:#}");
                std::process::exit(2);
            }
        },
        Command::Filter { profile, pid } => filter_cmd(&profile, pid).await,
        Command::CodexFilter { profile } => codex_filter_cmd(&profile).await,
        Command::OpencodeFilter { profile } => {
            if is_safe_component(&profile) && profile.starts_with("opencode-") {
                if let Some(state) = state_root(&|k| std::env::var(k).ok()) {
                    session_bridge_mcp::opencode_hook::settle_pending(&state, &profile);
                }
            }
        }
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
