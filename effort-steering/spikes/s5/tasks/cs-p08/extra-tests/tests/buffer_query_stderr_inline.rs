//! A buffer query (`grep ... @cmd_...`) answers from a stored command result whose stderr is
//! large. The answer must stay inline: one response under the inline limit, no second
//! `@tool_...` handle that hides the query's own output.
//!
//! These tests go through the public tool entry point only (`RunCommand::call_content`), so they
//! name no internal item and hold for any correct design.

#![cfg(unix)]

use codescout::agent::Agent;
use codescout::lsp::LspManager;
use codescout::tools::guide_ledger::GuideLedger;
use codescout::tools::output_buffer::OutputBuffer;
use codescout::tools::run_command::RunCommand;
use codescout::tools::section_coverage::SectionCoverage;
use codescout::tools::{Tool, ToolContext};
use serde_json::{json, Value};
use std::sync::Arc;

/// The inline limit of a tool answer: 2,500 tokens at 4 bytes a token.
fn over_inline_limit(text: &str) -> bool {
    text.len() / 4 > 2_500
}

/// A project in a temp dir, and a context whose output buffer the tests fill themselves.
async fn project_ctx() -> (tempfile::TempDir, ToolContext) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".codescout")).unwrap();
    std::fs::write(dir.path().join("main.rs"), "fn main() {}").unwrap();
    std::fs::write(dir.path().join("lib.py"), "def hello(): pass").unwrap();
    let ctx = ToolContext {
        agent: Agent::new(Some(dir.path().to_path_buf())).await.unwrap(),
        lsp: LspManager::new_arc(),
        output_buffer: Arc::new(OutputBuffer::new(20)),
        progress: None,
        peer: None,
        section_coverage: Arc::new(std::sync::Mutex::new(SectionCoverage::new())),
        guide_hints_emitted: Arc::new(parking_lot::Mutex::new({
            // GuideLedger::mid_session() is #[cfg(test)] in the library, so it is not visible here:
            // build the same ledger (session opener already delivered) from public items.
            let mut ledger = GuideLedger::default();
            ledger.insert(codescout::prompts::SESSION_OPENING_GUIDE.to_string());
            ledger
        })),
        workspace_override: None,
    };
    (dir, ctx)
}

/// Store a finished command result (`stdout`, `stderr`) under a `@cmd_...` handle, run
/// `command_for(handle)` through the tool, and return the handle, the primary text block and
/// that block parsed as JSON.
async fn query(
    stdout: String,
    stderr: String,
    command_for: impl FnOnce(&str) -> String,
) -> (String, String, Value) {
    let (_dir, ctx) = project_ctx().await;
    let id = ctx.output_buffer.store("cmd".into(), stdout, stderr, 0);
    let content = RunCommand
        .call_content(
            json!({ "command": command_for(&id), "timeout_secs": 10 }),
            &ctx,
        )
        .await
        .unwrap();
    let text = content[0]
        .as_text()
        .map(|t| t.text.clone())
        .unwrap_or_default();
    let parsed: Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("response is not JSON ({e}): {text:.200}"));
    (id, text, parsed)
}

/// What every such answer must satisfy, whatever shape the stored stderr had.
fn assert_stderr_stays_inline(
    id: &str,
    text: &str,
    parsed: &Value,
    stored_stderr_len: usize,
    stream_start: &str,
) {
    assert!(
        !text.contains("@tool_"),
        "the answer was buffered a second time under a @tool_ handle: {text:.300}"
    );
    assert!(
        !over_inline_limit(text),
        "the answer is {} bytes and is over the inline limit",
        text.len()
    );
    let stderr = parsed["stderr"]
        .as_str()
        .unwrap_or_else(|| panic!("no inline stderr string: {text:.300}"));
    assert!(
        stderr.starts_with(stream_start),
        "the start of the stored stderr must be kept: {stderr:.200}"
    );
    assert!(
        stderr.len() < stored_stderr_len,
        "stored stderr of {stored_stderr_len} bytes cannot have come back whole: {} bytes",
        stderr.len()
    );
    assert!(
        text.contains(id),
        "a cut must name the buffer handle {id} that holds the rest: {text:.600}"
    );
}

#[tokio::test]
async fn short_query_over_a_wide_stored_stderr_line_stays_inline() {
    // Tiny query output (a zero count): only the stored stderr can make the answer big.
    let stdout: String = (1..=30).map(|i| format!("out{i}\n")).collect();
    let stderr = format!("HEAD{}TAIL\n", "e".repeat(50_000));
    let stored = stderr.len();
    let (id, text, parsed) = query(stdout, stderr, |id| format!("grep -c NOSUCHTOKEN {id}")).await;

    assert_stderr_stays_inline(&id, &text, &parsed, stored, "HEAD");
    assert!(
        parsed["stdout"].as_str().unwrap_or_default().starts_with('0'),
        "the query's own answer (a zero count) must be shown: {text:.300}"
    );
}

#[tokio::test]
async fn large_query_over_a_wide_stored_stderr_line_stays_inline() {
    // The query's own output is over 10 KB, so it is cut to fit as well.
    let stdout: String = (1..=4000).map(|i| format!("out{i}\n")).collect();
    let stderr = format!("HEAD{}TAIL\n", "e".repeat(50_000));
    let stored = stderr.len();
    let (id, text, parsed) = query(stdout, stderr, |id| format!("grep out {id}")).await;

    assert_stderr_stays_inline(&id, &text, &parsed, stored, "HEAD");
    assert!(
        parsed["stdout"].as_str().unwrap_or_default().contains("out1"),
        "the first lines of the query's own output must be shown: {text:.300}"
    );
}

#[tokio::test]
async fn short_query_over_many_medium_stored_stderr_lines_stays_inline() {
    // Twenty lines of 700 bytes: no single line is huge, the stream as a whole is.
    let stdout: String = (1..=30).map(|i| format!("out{i}\n")).collect();
    let stderr: String = (1..=20)
        .map(|i| format!("L{i:02}_{}\n", "m".repeat(700)))
        .collect();
    let stored = stderr.len();
    let (id, text, parsed) = query(stdout, stderr, |id| format!("grep -c NOSUCHTOKEN {id}")).await;

    assert_stderr_stays_inline(&id, &text, &parsed, stored, "L01_");
    assert!(
        parsed["stdout"].as_str().unwrap_or_default().starts_with('0'),
        "the query's own answer (a zero count) must be shown: {text:.300}"
    );
}
