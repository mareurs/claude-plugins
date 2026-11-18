//! End-to-end checks, on the dispatch path every real tool call takes, of what a
//! per-call `workspace=` argument may and may not change about a project's
//! read-only state.
//!
//! This file is compiled into `server` as a child module (the line that declares it is
//! appended to `src/server.rs` when the hidden tests are grafted in), so that it can
//! reach the dispatcher's private entry point. It uses nothing but items that exist
//! before any fix: `call_tool_inner`, `test_support::make_server` and the tools
//! themselves.

use super::test_support::make_server;
use super::*;
use tempfile::tempdir;

async fn dispatch_tool(
    server: &CodeScoutServer,
    name: &str,
    args: serde_json::Value,
) -> CallToolResult {
    let req = CallToolRequestParams::new(name.to_string())
        .with_arguments(serde_json::from_value(args).unwrap());
    server
        .call_tool_inner(req, None, None, tokio_util::sync::CancellationToken::new())
        .await
        .unwrap()
}

fn result_text(r: &CallToolResult) -> String {
    r.content
        .iter()
        .find_map(|c| c.as_text().map(|t| t.text.clone()))
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Fail-to-pass
// ---------------------------------------------------------------------------

/// The order makes each half falsifiable, and the assertion that fails on the
/// unfixed code is the LAST one:
///
/// * the CONTROL unpinned write is refused first, so the guard is demonstrably armed and
///   a later "still refused" is not vacuous;
/// * the PINNED write must SUCCEED. Refusing it would "fix" the leak by making the pin
///   useless;
/// * the UNPINNED write afterwards must be refused AGAIN.
///
/// `memory` for the writes: it is a core tool, so this runs in the lean lane too.
#[tokio::test]
async fn an_unpinned_write_is_refused_again_after_a_pinned_write_to_the_same_read_only_project() {
    let (_home, server) = make_server().await;
    let browsed = tempdir().unwrap();
    std::fs::create_dir_all(browsed.path().join(".codescout")).unwrap();
    let root = std::fs::canonicalize(browsed.path()).unwrap();
    let pin = root.to_string_lossy().to_string();
    let write = |topic: &str, pinned: bool| {
        let mut a = serde_json::json!({
            "action": "write", "topic": topic, "content": "probe"
        });
        if pinned {
            a["workspace"] = serde_json::json!(pin);
        }
        a
    };

    let armed = dispatch_tool(
        &server,
        "workspace",
        serde_json::json!({ "action": "activate", "path": pin, "read_only": true }),
    )
    .await;
    assert_ne!(
        armed.is_error,
        Some(true),
        "precondition: {}",
        result_text(&armed)
    );

    let control = dispatch_tool(&server, "memory", write("pin-control", false)).await;
    assert_eq!(
        control.is_error,
        Some(true),
        "control: an unpinned write must be refused while explicitly read-only; got: {}",
        result_text(&control)
    );

    let pinned = dispatch_tool(&server, "memory", write("pin-write", true)).await;
    assert_ne!(
        pinned.is_error,
        Some(true),
        "a write that names the project in `workspace` must still succeed; got: {}",
        result_text(&pinned)
    );

    let after = dispatch_tool(&server, "memory", write("pin-after", false)).await;
    assert_eq!(
        after.is_error,
        Some(true),
        "the named write above must not have ended the read-only activation for a caller \
         that does not name the project. Got: {}",
        result_text(&after)
    );
}

/// The second place a write is decided. `approve_write` must behave like any other
/// write call that names its project: succeed for that call, change nothing for the
/// callers that follow.
#[tokio::test]
async fn an_unpinned_write_is_refused_again_after_a_pinned_approve_write_under_read_only() {
    let (_home, server) = make_server().await;
    let browsed = tempdir().unwrap();
    std::fs::create_dir_all(browsed.path().join(".codescout")).unwrap();
    std::fs::create_dir_all(browsed.path().join("notes")).unwrap();
    let root = std::fs::canonicalize(browsed.path()).unwrap();
    let pin = root.to_string_lossy().to_string();

    let armed = dispatch_tool(
        &server,
        "workspace",
        serde_json::json!({ "action": "activate", "path": pin, "read_only": true }),
    )
    .await;
    assert_ne!(
        armed.is_error,
        Some(true),
        "precondition: {}",
        result_text(&armed)
    );

    let approved = dispatch_tool(
        &server,
        "approve_write",
        serde_json::json!({ "path": "notes", "workspace": pin }),
    )
    .await;
    // NOT `is_error`: a refusal by `approve_write` arrives as a success-shaped result
    // (`is_error == false`) that carries the refusal text, so `is_error != Some(true)`
    // is satisfied by the very refusal this test exists to catch. The text is the
    // discriminator.
    let approved_text = result_text(&approved);
    assert!(
        !approved_text.to_lowercase().contains("writes are disabled"),
        "approve_write naming the project in `workspace` is a write call that names its \
         project and must succeed for that call; got: {approved_text}"
    );

    let after = dispatch_tool(
        &server,
        "memory",
        serde_json::json!({ "action": "write", "topic": "approve-after", "content": "probe" }),
    )
    .await;
    assert_eq!(
        after.is_error,
        Some(true),
        "the named approve_write must not have ended the read-only activation for a \
         caller that does not name the project; got: {}",
        result_text(&after)
    );
}

// ---------------------------------------------------------------------------
// Pass-to-pass: behaviour that exists before the fix and must survive it.
// Each is an existing test of the server module, restated here so that the copy
// the grader runs is the one at the parent commit.
// ---------------------------------------------------------------------------

/// A write call that names a project which was never activated in this session must
/// succeed: the project is loaded read-only by default, and the name is the caller's
/// consent to write there.
#[tokio::test]
async fn a_write_naming_a_never_activated_project_goes_through() {
    let dir_a = tempdir().unwrap();
    let (_dir_b, server) = make_server().await;
    std::fs::create_dir_all(dir_a.path().join(".codescout")).unwrap();
    let root_a = std::fs::canonicalize(dir_a.path()).unwrap();

    // dir_a is NEVER explicitly activated: only referenced through `workspace`.
    let result = dispatch_tool(
        &server,
        "create_file",
        serde_json::json!({
            "path": "new_file.txt",
            "content": "hello",
            "workspace": root_a.to_string_lossy(),
        }),
    )
    .await;

    assert_ne!(
        result.is_error,
        Some(true),
        "a write that names a never-activated project must succeed; got: {}",
        result_text(&result)
    );
    assert!(
        dir_a.path().join("new_file.txt").exists(),
        "file must be created in the named project"
    );
}

/// A project whose own `project.toml` turns writes off stays closed to a write call
/// that names it, judged by that project's config and not by the session default's.
#[tokio::test]
async fn a_write_naming_a_project_that_disables_writes_in_its_config_is_refused() {
    let dir_a = tempdir().unwrap();
    let (_dir_b, server) = make_server().await;
    std::fs::create_dir_all(dir_a.path().join(".codescout")).unwrap();
    std::fs::write(
        dir_a.path().join(".codescout").join("project.toml"),
        "[project]\nname = \"pin-test-a\"\n\n[security]\nfile_write_enabled = false\n",
    )
    .unwrap();
    let root_a = std::fs::canonicalize(dir_a.path()).unwrap();

    let result = dispatch_tool(
        &server,
        "create_file",
        serde_json::json!({
            "path": "new_file.txt",
            "content": "hello",
            "workspace": root_a.to_string_lossy(),
        }),
    )
    .await;

    assert_eq!(
        result.is_error,
        Some(true),
        "a write naming a project whose config disables writes must be refused using \
         that project's config; got: {}",
        result_text(&result)
    );
    assert!(
        !dir_a.path().join("new_file.txt").exists(),
        "file must not have been created in the named project"
    );
}

/// An unpinned write under an explicit read-only activation is refused, with the write
/// refusal, naming the project.
#[tokio::test]
async fn a_read_only_activation_refuses_an_unpinned_write() {
    let (_home, server) = make_server().await;
    let browsed = tempdir().unwrap();
    std::fs::create_dir_all(browsed.path().join(".codescout")).unwrap();
    let root = std::fs::canonicalize(browsed.path()).unwrap();

    let activated = dispatch_tool(
        &server,
        "workspace",
        serde_json::json!({
            "action": "activate",
            "path": root.to_string_lossy(),
            "read_only": true,
        }),
    )
    .await;
    assert_ne!(
        activated.is_error,
        Some(true),
        "the activation itself must succeed, or the write below proves nothing"
    );

    let result = dispatch_tool(
        &server,
        "memory",
        serde_json::json!({
            "action": "write",
            "topic": "read-only-probe",
            "content": "if this lands, the gate did not refuse",
        }),
    )
    .await;
    let text = result_text(&result);

    assert_eq!(
        result.is_error,
        Some(true),
        "memory(action=write) is a write; a read-only activation must refuse it. Got: {text}"
    );
    assert!(
        text.contains("File writes are disabled"),
        "the refusal must be the WRITE refusal, not some other failure: {text}"
    );
    assert!(
        text.contains(&root.display().to_string()),
        "the refusal must name the read-only project so the caller can name it: {text}"
    );
}

/// The exit the refusal names (an unpinned `activate` with `read_only: false`) must
/// work, and the write after it must land.
#[tokio::test]
async fn a_read_only_activation_can_be_lifted_by_an_unpinned_activate() {
    let (_home, server) = make_server().await;
    let browsed = tempdir().unwrap();
    std::fs::create_dir_all(browsed.path().join(".codescout")).unwrap();
    let root = std::fs::canonicalize(browsed.path()).unwrap();
    let write = |topic: &'static str| {
        serde_json::json!({ "action": "write", "topic": topic, "content": "probe" })
    };

    let armed = dispatch_tool(
        &server,
        "workspace",
        serde_json::json!({
            "action": "activate", "path": root.to_string_lossy(), "read_only": true
        }),
    )
    .await;
    assert_ne!(
        armed.is_error,
        Some(true),
        "precondition: {}",
        result_text(&armed)
    );

    // Control: the block is armed.
    let blocked = dispatch_tool(&server, "memory", write("lift-probe-before")).await;
    assert_eq!(
        blocked.is_error,
        Some(true),
        "control: an unpinned write must be refused while read-only; got: {}",
        result_text(&blocked)
    );

    // Treatment: the exit the refusal names, unpinned.
    let lifted = dispatch_tool(
        &server,
        "workspace",
        serde_json::json!({
            "action": "activate", "path": root.to_string_lossy(), "read_only": false
        }),
    )
    .await;
    assert_ne!(
        lifted.is_error,
        Some(true),
        "activate(read_only=false) is the remedy the write refusal prescribes; it must not \
         be refused by the very block it lifts. Got: {}",
        result_text(&lifted)
    );

    // The lift must have TAKEN EFFECT, not merely returned ok.
    let after = dispatch_tool(&server, "memory", write("lift-probe-after")).await;
    assert_ne!(
        after.is_error,
        Some(true),
        "the block must be gone after the lift; got: {}",
        result_text(&after)
    );
}

/// Moving on from a read-only project must not require lifting it first.
#[tokio::test]
async fn a_read_only_activation_does_not_block_activating_a_different_root() {
    let (_home, server) = make_server().await;
    let (first, second) = (tempdir().unwrap(), tempdir().unwrap());
    for d in [&first, &second] {
        std::fs::create_dir_all(d.path().join(".codescout")).unwrap();
    }
    let activate = |root: &std::path::Path, read_only: bool| {
        serde_json::json!({
            "action": "activate",
            "path": std::fs::canonicalize(root).unwrap().to_string_lossy(),
            "read_only": read_only,
        })
    };

    let armed = dispatch_tool(&server, "workspace", activate(first.path(), true)).await;
    assert_ne!(armed.is_error, Some(true), "precondition");
    let moved = dispatch_tool(&server, "workspace", activate(second.path(), false)).await;
    assert_ne!(
        moved.is_error,
        Some(true),
        "activating another root must not be refused by the first root's read-only \
         state; got: {}",
        result_text(&moved)
    );
}
