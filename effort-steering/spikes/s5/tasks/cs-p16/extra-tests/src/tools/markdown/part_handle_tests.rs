//! A buffer handle that covers only PART of a file keeps the text it was created with when the
//! file changes afterwards, whichever read created it. A handle that covers a whole file keeps
//! following the file.
//!
//! These tests go through the public tool entry points (`ReadFile::call`, `ReadMarkdown::call`)
//! and `OutputBuffer::get` only, so none of them names an item that a fix would add and they hold
//! for any correct design.

use crate::tools::markdown::ReadMarkdown;
use crate::tools::read_file::ReadFile;
use crate::tools::Tool;
use serde_json::json;

/// Replace the file's content and move its modification time two seconds past the clock, so that
/// nothing can mistake the new content for what the buffer already holds.
fn rewrite(path: &std::path::Path, text: &str) {
    std::fs::write(path, text).unwrap();
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(2);
    filetime::set_file_mtime(path, filetime::FileTime::from_system_time(later)).unwrap();
}

/// 40 lines of about 900 bytes each: a 12-line range of it is far over the inline limit.
fn wide_lines() -> String {
    let lines: Vec<String> = (1..=40)
        .map(|i| format!("line {i:04} {}", "x".repeat(900)))
        .collect();
    lines.join("\n")
}

// ── handles for part of a file: the text they were created with does not change ──────────

#[tokio::test]
async fn a_line_range_of_a_text_file_keeps_its_content_after_the_file_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.txt");
    std::fs::write(&path, wide_lines()).unwrap();
    let ctx = super::test_ctx().await;

    let result = ReadFile
        .call(
            json!({ "path": path.to_str().unwrap(), "start_line": 13, "end_line": 24 }),
            &ctx,
        )
        .await
        .unwrap();
    let file_id = result["file_id"]
        .as_str()
        .unwrap_or_else(|| panic!("an oversized range should come back with a handle: {result}"))
        .to_string();

    rewrite(&path, "REPLACED\n");

    let entry = ctx
        .output_buffer
        .get(&file_id)
        .expect("the handle should still resolve after the file changed");
    assert!(
        !entry.stdout.contains("REPLACED"),
        "a handle for lines 13-24 must not take on the file's new text; got: {:?}",
        entry.stdout.chars().take(80).collect::<String>()
    );
    assert_eq!(
        entry.stdout.lines().count(),
        12,
        "the handle was created for lines 13-24 and must stay 12 lines"
    );
    assert!(
        entry.stdout.starts_with("line 0013 "),
        "the handle's first line must still be line 13 of the file as it was read; got: {:?}",
        entry.stdout.chars().take(40).collect::<String>()
    );
    assert!(
        entry
            .stdout
            .lines()
            .last()
            .unwrap_or_default()
            .starts_with("line 0024 "),
        "the handle's last line must still be line 24 of the file as it was read"
    );
}
#[tokio::test]
async fn editing_lines_inside_the_range_does_not_change_the_handle() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.txt");
    std::fs::write(&path, wide_lines()).unwrap();
    let ctx = super::test_ctx().await;

    let result = ReadFile
        .call(
            json!({ "path": path.to_str().unwrap(), "start_line": 13, "end_line": 24 }),
            &ctx,
        )
        .await
        .unwrap();
    let file_id = result["file_id"]
        .as_str()
        .unwrap_or_else(|| panic!("an oversized range should come back with a handle: {result}"))
        .to_string();

    // Same 40 lines; only their text changes, so the range 13-24 still exists in the file.
    rewrite(&path, &wide_lines().replace("line 00", "EDIT 00"));

    let entry = ctx
        .output_buffer
        .get(&file_id)
        .expect("the handle should still resolve after the file changed");
    assert!(
        !entry.stdout.contains("EDIT"),
        "a handle for lines 13-24 must keep the text it was created with, not the edited lines"
    );
    assert_eq!(entry.stdout.lines().count(), 12, "the handle must stay 12 lines");
    assert!(
        entry.stdout.starts_with("line 0013 "),
        "the handle's first line must be the original line 13"
    );
}

#[tokio::test]
async fn reading_a_line_range_handle_after_the_file_changed_serves_the_range() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.txt");
    std::fs::write(&path, wide_lines()).unwrap();
    let ctx = super::test_ctx().await;

    let result = ReadFile
        .call(
            json!({ "path": path.to_str().unwrap(), "start_line": 13, "end_line": 24 }),
            &ctx,
        )
        .await
        .unwrap();
    let file_id = result["file_id"]
        .as_str()
        .unwrap_or_else(|| panic!("an oversized range should come back with a handle: {result}"))
        .to_string();

    // One more line at the end of the file: the smallest ordinary edit.
    let mut grown = wide_lines();
    grown.push_str("\nappended line\n");
    rewrite(&path, &grown);

    let again = ReadFile
        .call(
            json!({ "path": file_id.as_str(), "start_line": 1, "end_line": 1 }),
            &ctx,
        )
        .await
        .unwrap();
    let first = again["content"]
        .as_str()
        .unwrap_or_else(|| panic!("reading the handle should return content: {again}"));
    assert!(
        first.starts_with("line 0013 "),
        "line 1 of the handle must be the first line of the range it was created for; got: {:?}",
        first.chars().take(40).collect::<String>()
    );
    assert_eq!(
        again["total_lines"].as_u64(),
        Some(12),
        "the handle was created for 12 lines and must still report 12; got: {again}"
    );
}

#[tokio::test]
async fn several_sections_of_a_markdown_file_keep_their_content_after_the_file_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sections.md");
    let mut body = String::from("# Doc\n\n");
    for name in ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"] {
        body.push_str(&format!("## {name}\n\n"));
        body.push_str(&"word ".repeat(700));
        body.push_str("\n\n");
    }
    std::fs::write(&path, &body).unwrap();
    let ctx = super::test_ctx().await;

    let err = ReadMarkdown
        .call(
            json!({
                "path": path.to_str().unwrap(),
                "headings": ["## Alpha", "## Bravo", "## Charlie", "## Delta"],
            }),
            &ctx,
        )
        .await
        .unwrap_err();
    let rec = err
        .downcast_ref::<crate::tools::RecoverableError>()
        .expect("four oversized sections should come back as a RecoverableError");
    let file_id = rec
        .extra
        .get("file_id")
        .and_then(|v| v.as_str())
        .expect("the error should carry the handle of the combined sections")
        .to_string();

    rewrite(&path, "# Different\n\nnothing to see here\n");

    let entry = ctx
        .output_buffer
        .get(&file_id)
        .expect("the handle should still resolve after the file changed");
    assert!(
        !entry.stdout.contains("Different"),
        "a handle for four sections must not take on the file's new text; got: {:?}",
        entry.stdout.chars().take(60).collect::<String>()
    );
    assert!(
        entry.stdout.contains("## Alpha") && entry.stdout.contains("## Delta"),
        "the handle must still hold the sections it was created for"
    );
    assert!(
        !entry.stdout.contains("## Echo") && !entry.stdout.contains("## Foxtrot"),
        "the handle must not hold sections that were never requested"
    );
}

#[tokio::test]
async fn a_line_range_of_a_markdown_file_keeps_its_content_after_the_file_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.md");
    let lines: Vec<String> = (1..=300)
        .map(|i| format!("row {i:04} {}", "y".repeat(90)))
        .collect();
    std::fs::write(&path, lines.join("\n")).unwrap();
    let ctx = super::test_ctx().await;

    let result = ReadMarkdown
        .call(
            json!({ "path": path.to_str().unwrap(), "start_line": 51, "end_line": 250 }),
            &ctx,
        )
        .await
        .unwrap();
    let file_id = result["file_id"]
        .as_str()
        .unwrap_or_else(|| panic!("an oversized range should come back with a handle: {result}"))
        .to_string();

    rewrite(&path, "# Different\n\nnothing to see here\n");

    let entry = ctx
        .output_buffer
        .get(&file_id)
        .expect("the handle should still resolve after the file changed");
    assert!(
        !entry.stdout.contains("Different"),
        "a handle for lines 51-250 must not take on the file's new text; got: {:?}",
        entry.stdout.chars().take(60).collect::<String>()
    );
    assert_eq!(
        entry.stdout.lines().count(),
        200,
        "the handle was created for lines 51-250 and must stay 200 lines"
    );
    assert!(
        entry.stdout.starts_with("row 0051 "),
        "the handle's first line must still be line 51 of the file as it was read"
    );
}

// ── handles for a whole file: they keep following the file ──────────────────────────────

#[tokio::test]
async fn a_whole_text_file_handle_still_follows_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("whole.txt");
    std::fs::write(&path, wide_lines()).unwrap();
    let ctx = super::test_ctx().await;

    let result = ReadFile
        .call(json!({ "path": path.to_str().unwrap() }), &ctx)
        .await
        .unwrap();
    let file_id = result["file_id"]
        .as_str()
        .unwrap_or_else(|| panic!("an oversized file should come back with a handle: {result}"))
        .to_string();

    rewrite(&path, "fresh one\nfresh two\n");

    let entry = ctx
        .output_buffer
        .get(&file_id)
        .expect("the handle should still resolve after the file changed");
    assert_eq!(
        entry.stdout, "fresh one\nfresh two\n",
        "a handle created for a whole file must serve the file's current content"
    );
}

#[tokio::test]
async fn a_whole_markdown_file_handle_still_follows_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("whole.md");
    let mut body = String::from("# Title\n\n");
    for i in 0..20 {
        body.push_str(&format!("## Section {i}\n\n"));
        body.push_str(&"body line\n".repeat(600));
    }
    std::fs::write(&path, &body).unwrap();
    let ctx = super::test_ctx().await;

    let result = ReadMarkdown
        .call(json!({ "path": path.to_str().unwrap() }), &ctx)
        .await
        .unwrap();
    let file_id = result["file_id"]
        .as_str()
        .unwrap_or_else(|| panic!("an oversized file should come back with a handle: {result}"))
        .to_string();

    rewrite(&path, "# Other\n\nfresh content\n");

    let entry = ctx
        .output_buffer
        .get(&file_id)
        .expect("the handle should still resolve after the file changed");
    assert_eq!(
        entry.stdout, "# Other\n\nfresh content\n",
        "a handle created for a whole file must serve the file's current content"
    );
}
