//! A whole-file `read_file` of a TOML file with no table headers and wide top-level keys is
//! summarised and the listing of keys is cut. Whatever ready-made range the answer then offers
//! for the missing keys (a `(L<a>-L<b>)` marker, a `(lines <a>-<b>)` note or a call
//! `start_line=<a>, end_line=<b>`) must be readable and must return the omitted keys.
//!
//! These tests go through the public tool entry points only (`ReadFile::call_content` and
//! `ReadFile::call`), so they name no internal item and hold for any correct design: a design
//! that offers no numbers, and one that offers numbers that are right, both pass.

use codescout::agent::Agent;
use codescout::lsp::LspManager;
use codescout::tools::output_buffer::OutputBuffer;
use codescout::tools::read_file::ReadFile;
use codescout::tools::section_coverage::SectionCoverage;
use codescout::tools::{Tool, ToolContext};
use serde_json::json;
use std::path::Path;
use std::sync::Arc;

const KEYS: usize = 20;
const WIDTH: usize = 600;

/// Key `i` is `WIDTH` letters `k` followed by `i` in two digits.
fn key_name(i: usize) -> String {
    format!("{}{i:02}", "k".repeat(WIDTH))
}

/// One `key = 1` line per index, in the order given.
fn flat_toml(order: impl Iterator<Item = usize>) -> String {
    order.map(|i| format!("{} = 1\n", key_name(i))).collect()
}

async fn ctx_in(root: &Path) -> ToolContext {
    std::fs::create_dir_all(root.join(".codescout")).unwrap();
    ToolContext {
        agent: Agent::new(Some(root.to_path_buf())).await.unwrap(),
        lsp: LspManager::new_arc(),
        output_buffer: Arc::new(OutputBuffer::new(20)),
        progress: None,
        peer: None,
        section_coverage: Arc::new(std::sync::Mutex::new(SectionCoverage::new())),
        guide_hints_emitted: Arc::new(parking_lot::Mutex::new(Default::default())),
        workspace_override: None,
    }
}

/// The primary text block `read_file(path)` returns.
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

/// The leading run of digits of `s`, and the rest.
fn take_number(s: &str) -> (Option<u64>, &str) {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    (s[..end].parse().ok(), &s[end..])
}

/// Every pair of real line numbers the answer offers as a range: `(L<a>-L<b>)`,
/// `(lines <a>-<b>)` and `start_line=<a>, end_line=<b>`. The generic `N`/`M` placeholders do
/// not match.
fn numeric_ranges(text: &str) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    for (open, sep, close) in [
        ("(L", "-L", ")"),
        ("(lines ", "-", ")"),
        ("start_line=", ", end_line=", ""),
    ] {
        let mut rest = text;
        while let Some(at) = rest.find(open) {
            rest = &rest[at + open.len()..];
            let (a, after_a) = take_number(rest);
            let (Some(a), Some(tail)) = (a, after_a.strip_prefix(sep)) else {
                continue;
            };
            let (b, after_b) = take_number(tail);
            if let Some(b) = b {
                if after_b.starts_with(close) {
                    out.push((a, b));
                }
            }
        }
    }
    out
}

/// The indexes of the keys the answer lists (a key is `WIDTH` letters `k` and two digits).
fn listed_keys(text: &str) -> Vec<usize> {
    let needle = "k".repeat(WIDTH);
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find(&needle) {
        rest = &rest[at + needle.len()..];
        if let Some(Ok(n)) = rest.get(..2).map(str::parse::<usize>) {
            out.push(n);
        }
    }
    out
}

/// The `@file_...` handle the answer names.
fn file_handle(text: &str) -> String {
    let at = text
        .find("@file_")
        .unwrap_or_else(|| panic!("no @file_ handle in: {text:.600}"));
    text[at..]
        .chars()
        .enumerate()
        .take_while(|(i, c)| (*i == 0 && *c == '@') || c.is_ascii_alphanumeric() || *c == '_')
        .map(|(_, c)| c)
        .collect()
}

/// Read lines `start..=end` of the buffered file.
async fn read_range(ctx: &ToolContext, handle: &str, start: u64, end: u64) -> String {
    let followed = ReadFile
        .call(
            json!({ "path": handle, "start_line": start, "end_line": end }),
            ctx,
        )
        .await
        .unwrap_or_else(|e| panic!("the range {start}-{end} the answer offered fails: {e:#}"));
    followed["content"]
        .as_str()
        .unwrap_or_else(|| panic!("no content for {start}-{end}: {followed:.300}"))
        .to_string()
}

/// Read `rel`, then hold every numeric range the answer offers to its promise: it is a range
/// (`start <= end`), the buffered file accepts it, and what it returns covers every omitted
/// key and no listed one. An answer with no numeric range passes this part; the generic route
/// is followed by the caller. Returns the text and the file handle.
async fn read_and_check_routes(ctx: &ToolContext, rel: &str) -> (String, String) {
    let text = read_text(ctx, rel).await;

    let listed = listed_keys(&text);
    assert!(
        !listed.is_empty() && listed.len() < KEYS,
        "the fixture must be cut: listed {listed:?} in {text:.600}"
    );
    assert!(
        text.contains("entries omitted"),
        "a cut must say so: {text:.600}"
    );
    let omitted: Vec<usize> = (0..KEYS).filter(|i| !listed.contains(i)).collect();

    let ranges = numeric_ranges(&text);
    for (start, end) in &ranges {
        assert!(
            start <= end,
            "an impossible range was offered: {start}-{end}, in {text:.1500}"
        );
    }

    let handle = file_handle(&text);
    let mut seen = String::new();
    for (start, end) in &ranges {
        let content = read_range(ctx, &handle, *start, *end).await;
        for i in &listed {
            assert!(
                !content.contains(&key_name(*i)),
                "lines {start}-{end} were offered for the omitted keys but return the listed key {i}"
            );
        }
        seen.push_str(&content);
    }
    if !ranges.is_empty() {
        for i in &omitted {
            assert!(
                seen.contains(&key_name(*i)),
                "the ranges offered {ranges:?} do not return the omitted key {i} (omitted: {omitted:?})"
            );
        }
    }
    (text, handle)
}

#[tokio::test]
async fn a_flat_toml_written_against_its_key_order_offers_only_routes_that_can_be_read() {
    // Written from the last key to the first.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("reversed.toml"),
        flat_toml((0..KEYS).rev()),
    )
    .unwrap();
    let ctx = ctx_in(dir.path()).await;

    let (_, handle) = read_and_check_routes(&ctx, "reversed.toml").await;

    // Whatever else is offered, reading the file in ranges from its handle works: line 1 is
    // the key written first.
    let head = read_range(&ctx, &handle, 1, 2).await;
    assert!(head.starts_with(&key_name(KEYS - 1)), "{head:.100}");
}

#[tokio::test]
async fn a_flat_toml_with_a_scrambled_middle_offers_only_routes_that_return_the_omitted_keys() {
    // The keys at both ends are written in order; the block between them is written backwards.
    let dir = tempfile::tempdir().unwrap();
    let order = (0..=5).chain((6..=13).rev()).chain(14..KEYS);
    std::fs::write(dir.path().join("scrambled.toml"), flat_toml(order)).unwrap();
    let ctx = ctx_in(dir.path()).await;

    let (_, handle) = read_and_check_routes(&ctx, "scrambled.toml").await;

    let head = read_range(&ctx, &handle, 1, 2).await;
    assert!(head.starts_with(&key_name(0)), "{head:.100}");
}

#[tokio::test]
async fn a_flat_toml_in_line_order_keeps_an_exact_numeric_route() {
    // Written first to last: the omitted keys are one block of lines, and the answer names it.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("ordered.toml"), flat_toml(0..KEYS)).unwrap();
    let ctx = ctx_in(dir.path()).await;

    let (text, _) = read_and_check_routes(&ctx, "ordered.toml").await;

    assert!(
        !numeric_ranges(&text).is_empty(),
        "keys in line order must keep a ready-made numeric range: {text:.1500}"
    );
}
