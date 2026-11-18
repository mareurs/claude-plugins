//! A whole-file `read_file` of a JSON object whose keys are very wide must come back as one
//! inline answer with one buffer handle, the way a wide source, YAML or config file does.
//!
//! These tests go through the public tool entry point only (`ReadFile::call_content`), so they
//! name no internal item and hold for any correct design.

use codescout::agent::Agent;
use codescout::lsp::LspManager;
use codescout::tools::guide_ledger::GuideLedger;
use codescout::tools::output_buffer::OutputBuffer;
use codescout::tools::read_file::ReadFile;
use codescout::tools::section_coverage::SectionCoverage;
use codescout::tools::{Tool, ToolContext};
use serde_json::json;
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

/// The inline limit of a tool answer: 2,500 tokens at 4 bytes a token.
fn over_inline_limit(text: &str) -> bool {
    text.len() / 4 > 2_500
}

/// Every distinct buffer handle named in `text`, so "one handle" is counted, not assumed.
fn handles_in(text: &str) -> BTreeSet<String> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '@' || c == '_'))
        .filter(|t| {
            ["@file_", "@tool_", "@cmd_", "@bg_"]
                .iter()
                .any(|p| t.starts_with(p))
        })
        .map(str::to_owned)
        .collect()
}

/// A project rooted at `root`, and the primary text block `read_file` returns for `rel`.
async fn read_text(root: &Path, rel: &str) -> String {
    std::fs::create_dir_all(root.join(".codescout")).unwrap();
    let ctx = ToolContext {
        agent: Agent::new(Some(root.to_path_buf())).await.unwrap(),
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
    let content = ReadFile
        .call_content(json!({ "path": rel }), &ctx)
        .await
        .unwrap();
    content[0]
        .as_text()
        .map(|t| t.text.clone())
        .unwrap_or_default()
}

/// A valid JSON object of `keys` members. Key `i` is `"<i:02>_kkk...k"` with `width` letters
/// `k`, so the first and the last key are told apart by their leading digits.
fn wide_object(keys: usize, width: usize) -> String {
    let members: Vec<String> = (0..keys)
        .map(|i| format!("\"{i:02}_{}\": {i}", "k".repeat(width)))
        .collect();
    format!("{{{}}}", members.join(", "))
}

#[tokio::test]
async fn summary_inline_wide_json_keys_one_handle_within_limit() {
    let dir = tempfile::tempdir().unwrap();
    let body = wide_object(30, 600);
    std::fs::write(dir.path().join("wide.json"), &body).unwrap();
    assert!(over_inline_limit(&body), "fixture must be over the limit");

    let text = read_text(dir.path(), "wide.json").await;

    assert!(
        !text.contains("@tool_"),
        "a second handle was minted: {text:.300}"
    );
    assert_eq!(handles_in(&text).len(), 1, "{text:.300}");
    assert!(
        !over_inline_limit(&text),
        "{} B is over the inline limit",
        text.len()
    );
    assert!(
        text.contains("entries omitted"),
        "a cut must say so, and say how much: {text:.600}"
    );
    assert!(
        text.contains("keys omitted"),
        "the gap must be shown where it falls: {text:.600}"
    );
    assert!(text.contains("$.00_k"), "the FIRST key must survive");
    assert!(text.contains("$.29_k"), "the LAST key must survive");
}

#[tokio::test]
async fn summary_inline_few_very_wide_json_keys_one_handle_within_limit() {
    // Eight keys of 2,000 B: far fewer entries than the listing's own count cap, still far
    // over the inline limit, and each entry alone is a third of the budget.
    let dir = tempfile::tempdir().unwrap();
    let body = wide_object(8, 2_000);
    std::fs::write(dir.path().join("fat.json"), &body).unwrap();
    assert!(over_inline_limit(&body), "fixture must be over the limit");

    let text = read_text(dir.path(), "fat.json").await;

    assert!(
        !text.contains("@tool_"),
        "a second handle was minted: {text:.300}"
    );
    assert_eq!(handles_in(&text).len(), 1, "{text:.300}");
    assert!(
        !over_inline_limit(&text),
        "{} B is over the inline limit",
        text.len()
    );
    assert!(text.contains("entries omitted"), "{text:.600}");
    assert!(text.contains("keys omitted"), "{text:.600}");
}
