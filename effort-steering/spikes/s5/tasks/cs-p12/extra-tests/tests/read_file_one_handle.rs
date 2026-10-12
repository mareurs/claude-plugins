//! A whole-file `read_file` of a file over the inline limit answers with a summary of the file and
//! the file's own buffer handle. Whatever the file type, that answer must fit the inline limit and
//! must name exactly one buffer handle, an `@file_...` one, never a `@tool_...` one.
//!
//! These tests go through the public tool entry points only (`ReadFile::call_content` and
//! `ReadFile::call`), so they name no internal item and hold for any correct design.

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

/// A project rooted at `root`.
async fn ctx_in(root: &Path) -> ToolContext {
    std::fs::create_dir_all(root.join(".codescout")).unwrap();
    ToolContext {
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
    }
}

/// The primary text block `read_file(path)` returns for `rel`.
async fn read_text(ctx: &ToolContext, rel: &str) -> String {
    let content = ReadFile
        .call_content(json!({ "path": rel }), ctx)
        .await
        .unwrap();
    content[0]
        .as_text()
        .map(|t| t.text.clone())
        .unwrap_or_default()
}

/// The answer holds exactly one buffer handle, an `@file_` one, and fits the inline limit.
fn assert_one_handle_within_limit(text: &str) {
    assert!(
        !text.contains("@tool_"),
        "a second handle was minted: {text:.400}"
    );
    let handles = handles_in(text);
    assert_eq!(
        handles.len(),
        1,
        "one read, one handle; got {handles:?} in {text:.400}"
    );
    assert!(
        handles.iter().next().unwrap().starts_with("@file_"),
        "the one handle must be the file's own: {handles:?}"
    );
    assert!(
        !over_inline_limit(text),
        "{} B is over the inline limit",
        text.len()
    );
}

/// 1,500 one-line functions `fn f0001() {}` .. `fn f1500() {}`, each on its own line.
fn fifteen_hundred_functions() -> String {
    (1..=1500).map(|i| format!("fn f{i:04}() {{}}\n")).collect()
}

#[tokio::test]
async fn a_source_file_of_1500_small_functions_comes_back_inline_with_one_handle() {
    let dir = tempfile::tempdir().unwrap();
    let src = fifteen_hundred_functions();
    std::fs::write(dir.path().join("big.rs"), &src).unwrap();
    assert!(
        src.len() > 20_000,
        "fixture must be far over the inline limit"
    );
    let ctx = ctx_in(dir.path()).await;

    let text = read_text(&ctx, "big.rs").await;

    assert_one_handle_within_limit(&text);
    assert!(text.contains("f0001"), "the FIRST symbol must survive");
    assert!(text.contains("f1500"), "the LAST symbol must survive");
    assert!(
        text.contains("entries omitted"),
        "a cut must say so, and say how much: {text:.600}"
    );
}

#[tokio::test]
async fn a_file_of_a_dozen_very_wide_lines_comes_back_inline_with_one_handle() {
    // Twelve lines of 6 KB: far fewer lines than any listing of a file would cut, still far
    // over the inline limit.
    let dir = tempfile::tempdir().unwrap();
    let body: String = (b'a'..=b'l')
        .map(|c| format!("{}\n", (c as char).to_string().repeat(6_000)))
        .collect();
    std::fs::write(dir.path().join("wide.txt"), &body).unwrap();
    let ctx = ctx_in(dir.path()).await;

    let text = read_text(&ctx, "wide.txt").await;

    assert_one_handle_within_limit(&text);
    assert!(
        text.contains("bytes shown"),
        "a cut must say so: {text:.300}"
    );
    assert!(text.contains("aaaa"), "the head of the file must survive");
    assert!(text.contains("llll"), "the tail of the file must survive");
}

#[tokio::test]
async fn unparseable_json_on_one_enormous_line_comes_back_inline_with_one_handle() {
    // A single 80 KB line that does not parse as JSON: the summary falls back to the head and
    // tail of the text, which here is one line wide.
    let dir = tempfile::tempdir().unwrap();
    let body = format!("{{\"items\": [{}", "{\"k\": \"v\"}, ".repeat(6_500));
    assert!(body.len() > 70_000);
    std::fs::write(dir.path().join("broken.json"), &body).unwrap();
    let ctx = ctx_in(dir.path()).await;

    let text = read_text(&ctx, "broken.json").await;

    assert_one_handle_within_limit(&text);
}

#[tokio::test]
async fn a_config_file_of_wide_lines_comes_back_inline_with_one_handle() {
    // 40 lines of 700 B: the preview of a config file is its first 30 lines, a count that is
    // within any line limit while its bytes are not.
    let dir = tempfile::tempdir().unwrap();
    let body: String = (0..40)
        .map(|i| format!("key{i:02}={}\n", "v".repeat(700)))
        .collect();
    std::fs::write(dir.path().join("wide.ini"), &body).unwrap();
    let ctx = ctx_in(dir.path()).await;

    let text = read_text(&ctx, "wide.ini").await;

    assert_one_handle_within_limit(&text);
    assert!(
        text.contains("bytes shown"),
        "a cut must say so: {text:.300}"
    );
    assert!(
        text.contains("key00="),
        "the beginning of the preview must survive: {text:.300}"
    );
}

#[tokio::test]
async fn a_yaml_file_of_wide_keys_comes_back_inline_with_one_handle() {
    // 30 top-level keys of 600 B each: the number of keys is small, their bytes are not.
    let dir = tempfile::tempdir().unwrap();
    let body: String = (0..30)
        .map(|i| format!("{}{i:02}: 1\n", "k".repeat(600)))
        .collect();
    std::fs::write(dir.path().join("wide.yaml"), &body).unwrap();
    let ctx = ctx_in(dir.path()).await;

    let text = read_text(&ctx, "wide.yaml").await;

    assert_one_handle_within_limit(&text);
    assert!(
        text.contains("entries omitted"),
        "a cut must say so: {text:.300}"
    );
}

#[tokio::test]
async fn the_cut_is_made_only_where_needed_and_the_handle_reads_what_it_dropped() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("big.rs"), fifteen_hundred_functions()).unwrap();
    // Over the inline limit as TEXT (40 functions of about 330 B), but the list of 40 symbols is a
    // few KB: there is nothing to cut.
    let fits: String = (1..=40)
        .map(|i| format!("fn g{i:02}() {{ let _ = \"{}\"; }}\n", "p".repeat(300)))
        .collect();
    assert!(over_inline_limit(&fits), "fixture must be over the limit");
    std::fs::write(dir.path().join("fits.rs"), &fits).unwrap();
    // Under the inline limit.
    let small: String = (1..=30)
        .map(|i| format!("line {i:02} of a small file\n"))
        .collect();
    assert!(!over_inline_limit(&small), "fixture must be under the limit");
    std::fs::write(dir.path().join("small.txt"), &small).unwrap();
    let ctx = ctx_in(dir.path()).await;

    // The long listing is cut, and the answer says so.
    let big_text = read_text(&ctx, "big.rs").await;
    assert_one_handle_within_limit(&big_text);
    assert!(
        big_text.contains("entries omitted"),
        "a cut must say so: {big_text:.600}"
    );

    // The short listing is not: every symbol is listed and nothing is reported as omitted.
    let fits_text = read_text(&ctx, "fits.rs").await;
    assert_one_handle_within_limit(&fits_text);
    for i in 1..=40 {
        let name = format!("g{i:02}");
        assert!(
            fits_text.contains(&name),
            "symbol {name} is missing from an answer that needed no cut: {fits_text:.600}"
        );
    }
    assert!(
        !fits_text.contains("entries omitted"),
        "nothing was cut, so nothing may be reported as cut: {fits_text:.600}"
    );

    // A file under the inline limit is read as before.
    let small_text = read_text(&ctx, "small.txt").await;
    for i in [1, 15, 30] {
        let line = format!("line {i:02} of a small file");
        assert!(
            small_text.contains(&line),
            "{line:?} is missing from: {small_text:.600}"
        );
    }
    assert!(!small_text.contains("@tool_"), "{small_text:.300}");

    // Whatever the summary of the long file leaves out is read from the file's handle, in ranges.
    let summary = ReadFile
        .call(json!({ "path": "big.rs" }), &ctx)
        .await
        .unwrap();
    let handle = summary["file_id"]
        .as_str()
        .unwrap_or_else(|| panic!("an oversized read names the file's handle: {summary:.300}"))
        .to_string();
    assert!(handle.starts_with("@file_"), "{handle}");
    let slice = ReadFile
        .call(
            json!({ "path": handle, "start_line": 700, "end_line": 702 }),
            &ctx,
        )
        .await
        .unwrap();
    let content = slice["content"]
        .as_str()
        .unwrap_or_else(|| panic!("no content in: {slice:.300}"));
    for i in 700..=702 {
        let line = format!("fn f{i:04}()");
        assert!(
            content.contains(&line),
            "{line:?} is missing from: {content}"
        );
    }
}
