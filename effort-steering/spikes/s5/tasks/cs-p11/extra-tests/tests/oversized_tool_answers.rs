//! A tool answer that already carries a buffer handle of its own (a string `output_id`) and is
//! over the inline limit. The caller must be left with that one handle: the answer is cut to fit
//! instead of being stored a second time behind a new handle.
//!
//! These tests go through the public entry point only (`Tool::call_content`), with a tool
//! defined here, so they name no internal item and hold for any correct design.

use codescout::agent::Agent;
use codescout::lsp::LspManager;
use codescout::tools::guide_ledger::GuideLedger;
use codescout::tools::output_buffer::OutputBuffer;
use codescout::tools::section_coverage::SectionCoverage;
use codescout::tools::{Tool, ToolContext};
use serde_json::{json, Value};
use std::sync::Arc;

/// The inline limit of a tool answer: 2,500 tokens at 4 bytes a token.
fn over_inline_limit(text: &str) -> bool {
    text.len() / 4 > 2_500
}

/// A project in a temp dir, and a context to call a tool in.
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

/// A tool that answers with a fixed JSON value.
struct Stub {
    result: Value,
    force_inline: bool,
}

#[async_trait::async_trait]
impl Tool for Stub {
    fn name(&self) -> &str {
        "echo_tool"
    }
    fn description(&self) -> &str {
        "test"
    }
    fn input_schema(&self) -> Value {
        json!({})
    }
    async fn call(&self, _input: Value, _ctx: &ToolContext) -> anyhow::Result<Value> {
        Ok(self.result.clone())
    }
    fn force_inline(&self) -> bool {
        self.force_inline
    }
}

/// Call a `Stub` that answers with `result`; return the first content block's text and its parse.
async fn answer(result: Value, force_inline: bool) -> (String, Value) {
    let (_dir, ctx) = project_ctx().await;
    let tool = Stub {
        result,
        force_inline,
    };
    let content = tool
        .call_content(json!({}), &ctx)
        .await
        .expect("the call succeeds");
    let text = content[0]
        .as_text()
        .map(|t| t.text.clone())
        .unwrap_or_default();
    let parsed: Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("the first block is not JSON ({e}): {text:.200}"));
    (text, parsed)
}

/// `head`, then `n` bytes of `fill`, then `tail`: ends that can be told apart.
fn wide(head: &str, fill: char, n: usize, tail: &str) -> String {
    format!("{head}{}{tail}", fill.to_string().repeat(n))
}

/// What every cut answer must satisfy: the tool's own handle is the only one, the text fits, and
/// `field` was shortened, still starts with `head`, says so and names the handle.
fn assert_cut_keeping_handle(
    text: &str,
    parsed: &Value,
    handle: &str,
    field: &str,
    head: &str,
    original_len: usize,
) {
    assert_eq!(
        parsed["output_id"], handle,
        "the tool's own handle must be the only one: {text:.300}"
    );
    assert!(
        parsed.get("buffered_bytes").is_none(),
        "`buffered_bytes` belongs to a stored copy of the answer: {text:.300}"
    );
    assert!(
        !text.contains("@tool_"),
        "a second handle was minted: {text:.300}"
    );
    assert!(
        !over_inline_limit(text),
        "the answer is {} bytes and is over the inline limit",
        text.len()
    );
    let cut = parsed[field]
        .as_str()
        .unwrap_or_else(|| panic!("field `{field}` must stay a string: {text:.300}"));
    assert!(
        cut.starts_with(head),
        "a shortened value starts with the original's first bytes: {cut:.80}"
    );
    assert!(
        cut.contains("bytes shown"),
        "a cut must say so with the words `bytes shown`: {cut:.200}"
    );
    assert!(
        cut.contains(handle),
        "a cut must name the tool's own handle {handle}: {cut:.300}"
    );
    assert!(
        cut.len() >= 1_000,
        "a shortened value is never under 1,000 bytes, got {}",
        cut.len()
    );
    assert!(
        cut.len() < original_len,
        "field `{field}` was {original_len} bytes and came back whole"
    );
}

/// The plain case, used as the control of the tests that say what must NOT be cut: without it
/// they would also pass on code that never cuts anything.
async fn assert_a_plain_oversized_answer_is_cut() {
    let original = wide("HEAD", 'q', 40_000, "TAIL");
    let (text, parsed) = answer(
        json!({
            "output_id": "@cmd_own0",
            "exit_code": 0,
            "diagnostic": original.clone(),
        }),
        false,
    )
    .await;
    assert_cut_keeping_handle(
        &text,
        &parsed,
        "@cmd_own0",
        "diagnostic",
        "HEAD",
        original.len(),
    );
}

#[tokio::test]
async fn an_oversized_answer_with_a_handle_of_its_own_is_cut_to_fit() {
    let original = wide("HEAD", 'q', 40_000, "TAIL");
    let (text, parsed) = answer(
        json!({
            "output_id": "@cmd_own1",
            "exit_code": 0,
            "diagnostic": original.clone(),
        }),
        false,
    )
    .await;

    assert_cut_keeping_handle(
        &text,
        &parsed,
        "@cmd_own1",
        "diagnostic",
        "HEAD",
        original.len(),
    );
    assert_eq!(
        parsed["exit_code"], 0,
        "a field that is not a long string keeps its value: {text:.300}"
    );
}

#[tokio::test]
async fn only_as_much_as_needed_is_cut_from_the_largest_field() {
    // One field is far over the limit; the other two fit on their own. Cutting the largest is
    // enough, so the 4 KB field and the short one must come back byte for byte.
    let big = wide("HEAD", 'b', 40_000, "TAIL");
    let medium = wide("MID", 'q', 4_000, "END");
    let (text, parsed) = answer(
        json!({
            "output_id": "@cmd_own2",
            "big": big.clone(),
            "medium": medium.clone(),
            "note": "keep me",
        }),
        false,
    )
    .await;

    assert_cut_keeping_handle(&text, &parsed, "@cmd_own2", "big", "HEAD", big.len());
    assert_eq!(
        parsed["medium"].as_str(),
        Some(medium.as_str()),
        "a field that did not need cutting must be returned exactly: {text:.300}"
    );
    assert_eq!(parsed["note"], "keep me");
}

#[tokio::test]
async fn the_fit_is_measured_on_the_text_after_json_escaping() {
    // 20,000 double quotes are 20,000 bytes of raw text and 40,000 bytes once serialized. A cut
    // sized on the raw length alone would leave this answer over the limit.
    let original = format!("<{}>", "\"".repeat(20_000));
    let (text, parsed) = answer(
        json!({
            "output_id": "@cmd_own3",
            "diagnostic": original.clone(),
        }),
        false,
    )
    .await;

    assert_cut_keeping_handle(
        &text,
        &parsed,
        "@cmd_own3",
        "diagnostic",
        "<",
        original.len(),
    );
}

#[tokio::test]
async fn every_oversized_field_is_cut_when_one_cut_is_not_enough() {
    // Two 30 KB fields: the answer cannot fit with either of them whole, and neither may be
    // shortened below 1,000 bytes, so both are cut.
    let alpha = wide("ALPHA", 'a', 30_000, "END");
    let beta = wide("BETA", 'b', 30_000, "END");
    let (text, parsed) = answer(
        json!({
            "output_id": "@cmd_own9",
            "exit_code": 0,
            "alpha": alpha.clone(),
            "beta": beta.clone(),
        }),
        false,
    )
    .await;

    assert_cut_keeping_handle(&text, &parsed, "@cmd_own9", "alpha", "ALPHA", alpha.len());
    assert_cut_keeping_handle(&text, &parsed, "@cmd_own9", "beta", "BETA", beta.len());
    assert_eq!(parsed["exit_code"], 0);
}

#[tokio::test]
async fn a_cut_never_splits_a_multibyte_character() {
    // 14,000 euro signs are 42,000 bytes of 3-byte characters: no byte offset is a boundary
    // except every third one.
    let original = "\u{20ac}".repeat(14_000);
    let (text, parsed) = answer(
        json!({
            "output_id": "@cmd_own10",
            "exit_code": 0,
            "diagnostic": original.clone(),
        }),
        false,
    )
    .await;

    assert_cut_keeping_handle(
        &text,
        &parsed,
        "@cmd_own10",
        "diagnostic",
        "\u{20ac}\u{20ac}\u{20ac}",
        original.len(),
    );
}

#[tokio::test]
async fn a_force_inline_tool_is_never_cut() {
    // A `force_inline` tool opts out of overflow handling: its answer is returned whole however
    // large. A handle of its own does not change that.
    let stdout = "z".repeat(40_000);
    let result = json!({
        "output_id": "@cmd_own7",
        "stdout": stdout.clone(),
    });
    let (text, parsed) = answer(result.clone(), true).await;
    assert_eq!(parsed["output_id"], "@cmd_own7", "{text:.200}");
    assert_eq!(
        parsed["stdout"].as_str(),
        Some(stdout.as_str()),
        "a force_inline tool's answer must come back whole"
    );

    // The same answer from a tool that did not opt out IS cut.
    let (text, parsed) = answer(result, false).await;
    assert_cut_keeping_handle(&text, &parsed, "@cmd_own7", "stdout", "zzzz", 40_000);
}

#[tokio::test]
async fn an_answer_without_a_handle_of_its_own_is_buffered_whole() {
    assert_a_plain_oversized_answer_is_cut().await;

    // The same oversized field with no `output_id`: nothing else would hold the rest of it, so
    // it is stored whole under a new handle and nothing is cut inline.
    let (text, parsed) = answer(
        json!({ "diagnostic": wide("HEAD", 'm', 40_000, "TAIL") }),
        false,
    )
    .await;
    assert!(
        parsed["output_id"]
            .as_str()
            .unwrap_or_default()
            .starts_with("@tool_"),
        "an answer with no handle of its own must be buffered: {text:.200}"
    );
    assert!(
        parsed.get("diagnostic").is_none(),
        "nothing may be cut inline: {text:.200}"
    );
    assert!(
        parsed["buffered_bytes"].as_u64().unwrap_or(0) > 40_000,
        "the buffer must hold the whole answer: {text:.200}"
    );
}

#[tokio::test]
async fn an_answer_that_fits_is_returned_as_it_is() {
    assert_a_plain_oversized_answer_is_cut().await;

    let small = wide("HEAD", 's', 3_000, "TAIL");
    let (text, parsed) = answer(
        json!({ "output_id": "@cmd_own5", "stdout": small.clone() }),
        false,
    )
    .await;
    assert_eq!(parsed["output_id"], "@cmd_own5", "{text:.200}");
    assert_eq!(
        parsed["stdout"].as_str(),
        Some(small.as_str()),
        "an answer that fits is returned as built"
    );

    // About 9,300 bytes: above 9,000 and still inside the limit, so it already fits and cutting
    // it would lose bytes for nothing.
    let near = wide("HEAD", 's', 9_292, "TAIL");
    let (text, parsed) = answer(
        json!({ "output_id": "@cmd_own6", "stdout": near.clone() }),
        false,
    )
    .await;
    assert!(
        text.len() > 9_000,
        "the fixture must sit above 9,000 bytes: {} B",
        text.len()
    );
    assert_eq!(parsed["output_id"], "@cmd_own6", "{text:.200}");
    assert_eq!(
        parsed["stdout"].as_str(),
        Some(near.as_str()),
        "an answer inside the limit must not be cut"
    );
}

#[tokio::test]
async fn many_small_fields_that_cannot_be_cut_are_buffered_whole() {
    assert_a_plain_oversized_answer_is_cut().await;

    // 200 fields of 100 bytes each: none may be changed, yet the whole is far over the limit.
    // Losing that data silently is worse than a second handle, so it is stored whole.
    let mut obj = serde_json::Map::new();
    obj.insert("output_id".into(), json!("@cmd_own4"));
    for i in 0..200 {
        obj.insert(format!("k{i:03}"), json!("v".repeat(100)));
    }
    let (text, parsed) = answer(Value::Object(obj), false).await;

    assert!(
        parsed["output_id"]
            .as_str()
            .unwrap_or_default()
            .starts_with("@tool_"),
        "an answer that cannot be cut to fit must still be buffered: {text:.200}"
    );
    assert!(
        parsed["buffered_bytes"].as_u64().unwrap_or(0) > 20_000,
        "the buffer must hold the whole answer: {text:.200}"
    );
}

#[tokio::test]
async fn an_answer_still_too_big_after_every_allowed_cut_is_buffered_whole() {
    assert_a_plain_oversized_answer_is_cut().await;

    // One 40 KB field plus 100 small ones. The big field may go down to 1,000 bytes and no
    // further, and the small ones may not change: about 12 KB remains, over the limit. What is
    // stored must be the ORIGINAL 51 KB, not a half-cut copy that nothing else holds the rest of.
    let mut obj = serde_json::Map::new();
    obj.insert("output_id".into(), json!("@cmd_own8"));
    obj.insert("big".into(), json!("B".repeat(40_000)));
    for i in 0..100 {
        obj.insert(format!("k{i:03}"), json!("v".repeat(100)));
    }
    let (text, parsed) = answer(Value::Object(obj), false).await;

    assert!(
        parsed["output_id"]
            .as_str()
            .unwrap_or_default()
            .starts_with("@tool_"),
        "an answer that cannot be cut to fit must still be buffered: {text:.200}"
    );
    assert!(
        parsed["buffered_bytes"].as_u64().unwrap_or(0) > 50_000,
        "the buffer must hold the whole original, got {}",
        parsed["buffered_bytes"]
    );
}
