//! `run_command` when the process's temporary directory cannot be written to.
//!
//! The directory is made unusable by pointing `TMPDIR` at a path below a regular file, which
//! fails any attempt to create a file in it (or to create the directory) as a full or read-only
//! directory would.
//! Everything goes through the public tool surface (`RunCommand::call`).
//!
//! `TMPDIR` is process-global. `temp_env` serialises its own mutations, and `TMPDIR_LOCK`
//! additionally keeps every test of this binary from creating its project directory (which
//! also needs a working temp dir) while another test has the variable pointed at nothing.

use codescout::agent::Agent;
use codescout::lsp::LspManager;
use codescout::tools::run_command::RunCommand;
use codescout::tools::{Tool, ToolContext};
use serde_json::{json, Value};
use tempfile::tempdir;

static TMPDIR_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn project_ctx() -> (tempfile::TempDir, ToolContext) {
    let dir = tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".codescout")).unwrap();
    std::fs::write(dir.path().join("README.md"), "# test\n").unwrap();
    let agent = Agent::new(Some(dir.path().to_path_buf())).await.unwrap();
    let ctx = ToolContext {
        agent,
        lsp: LspManager::new_arc(),
        output_buffer: std::sync::Arc::new(codescout::tools::output_buffer::OutputBuffer::new(20)),
        progress: None,
        peer: None,
        section_coverage: std::sync::Arc::new(std::sync::Mutex::new(
            codescout::tools::section_coverage::SectionCoverage::new(),
        )),
        guide_hints_emitted: std::sync::Arc::new(parking_lot::Mutex::new(Default::default())),
        workspace_override: None,
    };
    (dir, ctx)
}

/// Run `command` through the tool with `TMPDIR` set to `tmpdir`. The error is rendered to a
/// string so that a refusal and a failure read the same to the caller of this helper.
async fn run_with_tmpdir(
    ctx: &ToolContext,
    tmpdir: &std::path::Path,
    command: &str,
) -> Result<Value, String> {
    let tmpdir = tmpdir.to_str().unwrap().to_string();
    temp_env::async_with_vars([("TMPDIR", Some(tmpdir.as_str()))], async {
        RunCommand
            .call(json!({ "command": command, "timeout_secs": 10 }), ctx)
            .await
            .map_err(|e| format!("{e:#}"))
    })
    .await
}

fn stdout_of(result: &Value) -> &str {
    result["stdout"].as_str().unwrap_or_default()
}

/// A command whose last pipe stage is a filter must still run and return its output when the
/// temp dir cannot be written to. Two different filters, so that handling one filter name
/// specially is not enough.
#[tokio::test]
async fn a_filter_terminated_command_still_runs_when_the_temp_dir_is_unusable() {
    let _lock = TMPDIR_LOCK.lock().await;
    let (dir, ctx) = project_ctx().await;
    // A path below a regular FILE: it does not exist and, unlike a merely missing
    // directory, it cannot be created either (ENOTDIR, also as root). So creating the
    // temp dir on demand does not pass; only not depending on it does.
    let blocker = dir.path().join("not-a-directory");
    std::fs::write(&blocker, "").unwrap();
    let unusable = blocker.join("tmp");

    for command in ["echo hi | head -1", "echo hi | grep hi"] {
        let result = run_with_tmpdir(&ctx, &unusable, command).await;
        assert!(
            result.is_ok(),
            "`{command}` must run when the temp dir is unusable, but the call failed: {:?}",
            result.as_ref().err()
        );
        let value = result.unwrap();
        assert_eq!(value["exit_code"], 0, "`{command}` should exit 0: {value}");
        assert!(
            stdout_of(&value).contains("hi"),
            "`{command}` should have produced its output; got: {value}"
        );
    }
}

/// Control: a command with no filter stage does not depend on the temp dir, so it runs under
/// the same unusable setting. Keeps the test above from passing by never reaching the code
/// that differs between the two kinds of command.
#[tokio::test]
async fn a_command_without_a_filter_runs_when_the_temp_dir_is_unusable() {
    let _lock = TMPDIR_LOCK.lock().await;
    let (dir, ctx) = project_ctx().await;
    // A path below a regular FILE: it does not exist and, unlike a merely missing
    // directory, it cannot be created either (ENOTDIR, also as root). So creating the
    // temp dir on demand does not pass; only not depending on it does.
    let blocker = dir.path().join("not-a-directory");
    std::fs::write(&blocker, "").unwrap();
    let unusable = blocker.join("tmp");

    let result = run_with_tmpdir(&ctx, &unusable, "echo hi").await;
    assert!(
        result.is_ok(),
        "a command with no filter must run with an unusable temp dir: {:?}",
        result.as_ref().err()
    );
    let value = result.unwrap();
    assert_eq!(value["exit_code"], 0, "should exit 0: {value}");
    assert!(
        stdout_of(&value).contains("hi"),
        "should have produced its output; got: {value}"
    );
}

/// Control: with a usable temp dir a filter-terminated command still offers the unfiltered
/// output as a buffer reference, so a fix cannot pass by dropping that feature altogether.
#[tokio::test]
async fn a_filter_terminated_command_with_a_usable_temp_dir_still_offers_the_unfiltered_buffer() {
    let _lock = TMPDIR_LOCK.lock().await;
    let (_dir, ctx) = project_ctx().await;
    let usable = tempdir().unwrap();

    let result = run_with_tmpdir(&ctx, usable.path(), "echo hi | head -1").await;
    assert!(
        result.is_ok(),
        "a filter-terminated command must run with a usable temp dir: {:?}",
        result.as_ref().err()
    );
    let value = result.unwrap();
    assert!(
        stdout_of(&value).contains("hi"),
        "should have produced its output; got: {value}"
    );
    assert!(
        value.get("unfiltered_output").is_some(),
        "a usable temp dir must still yield the unfiltered-output buffer; got: {value}"
    );
}
