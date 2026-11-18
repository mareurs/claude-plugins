//! cs-p04 hidden extra: the two other routes by which a file's handle takes whole-file text (a
//! later path read that finds the live handle, and a handle read that re-reads a changed file),
//! each under a last-modified time ahead of the clock, followed by an ordinary edit.

use super::{big_text, ctx, delivered_handle};
use crate::tools::read_file::ReadFile;
use crate::tools::Tool;
use serde_json::json;

fn set_mtime_from_now(p: &std::path::Path, secs: i64) {
    let now = std::time::SystemTime::now();
    let d = std::time::Duration::from_secs(secs.unsigned_abs());
    let t = if secs >= 0 { now + d } else { now - d };
    filetime::set_file_mtime(p, filetime::FileTime::from_system_time(t)).unwrap();
}

async fn first_line(ctx: &crate::tools::ToolContext, h: &str) -> String {
    let v = ReadFile
        .call(json!({ "path": h, "start_line": 1, "end_line": 1 }), ctx)
        .await
        .unwrap();
    v["content"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn a_path_reread_under_a_later_mtime_then_an_edit_is_followed_by_the_handle() {
    let ctx = ctx().await;
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("hit.txt");
    std::fs::write(&p, big_text("v0", 400)).unwrap();
    set_mtime_from_now(&p, -100);
    let path = p.to_str().unwrap().to_string();
    let h = delivered_handle(&ctx, &json!({ "path": path })).await;
    std::fs::write(&p, big_text("v1", 400)).unwrap();
    set_mtime_from_now(&p, 86_400);
    assert_eq!(
        delivered_handle(&ctx, &json!({ "path": path })).await,
        h,
        "fixture: one file, one handle"
    );
    std::thread::sleep(std::time::Duration::from_millis(30));
    std::fs::write(&p, big_text("v2", 400)).unwrap();
    let line = first_line(&ctx, &h).await;
    assert!(line.starts_with("v2"), "the handle kept the pre-edit text: {line:?}");
}

#[tokio::test]
async fn a_handle_refreshed_under_a_later_mtime_then_an_edit_follows_the_edit() {
    let ctx = ctx().await;
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("refresh.txt");
    std::fs::write(&p, big_text("v0", 400)).unwrap();
    set_mtime_from_now(&p, -100);
    let path = p.to_str().unwrap().to_string();
    let h = delivered_handle(&ctx, &json!({ "path": path })).await;
    std::fs::write(&p, big_text("v1", 400)).unwrap();
    set_mtime_from_now(&p, 86_400);
    let line = first_line(&ctx, &h).await;
    assert!(line.starts_with("v1"), "fixture: the handle read picked up v1: {line:?}");
    std::thread::sleep(std::time::Duration::from_millis(30));
    std::fs::write(&p, big_text("v2", 400)).unwrap();
    let line = first_line(&ctx, &h).await;
    assert!(line.starts_with("v2"), "the handle kept the pre-edit text: {line:?}");
}
