//! What `run_command` hands back when a command prints a secret.
//!
//! Everything goes through the public tool surface (`RunCommand::call`), and a stored buffer is
//! read back the way a caller reads it: with a later `run_command` that names its handle.
//!
//! No secret-shaped literal is written in this file. Every value is built when the test runs
//! from `CYCLE`, a body of upper-case letters and digits that is a valid tail for every format.
//! A reply that holds any `CYCLE`-sized window of the body shows part of a secret, which catches
//! a value that is shortened or whose tail is left behind, not only one that comes back whole.

use codescout::agent::Agent;
use codescout::lsp::LspManager;
use codescout::tools::run_command::RunCommand;
use codescout::tools::{Tool, ToolContext};
use serde_json::{json, Value};
use tempfile::tempdir;

/// Eight characters, upper-case letters and digits only.
const CYCLE: &str = "Q7Z3X9LM";

/// `n` characters of the repeating body.
fn body(n: usize) -> String {
    CYCLE.chars().cycle().take(n).collect()
}

/// `prefix` followed by `n` characters of the body.
fn secret(prefix: &str, n: usize) -> String {
    format!("{}{}", prefix, body(n))
}

/// Every rotation of `CYCLE`: each is a window of any body that is at least 15 characters long.
fn body_windows() -> Vec<String> {
    let twice = format!("{}{}", CYCLE, CYCLE);
    (0..CYCLE.len())
        .map(|i| twice[i..i + CYCLE.len()].to_string())
        .collect()
}

fn shows_part_of_a_secret(text: &str) -> bool {
    body_windows().iter().any(|w| text.contains(w.as_str()))
}

/// One `grep -E` pattern per window, written with a bracket so that the command text never holds
/// a window itself: a reply that echoed the command could not be mistaken for a leak.
fn window_patterns() -> Vec<String> {
    body_windows()
        .iter()
        .map(|w| format!("{}[{}]{}", &w[..3], &w[3..4], &w[4..]))
        .collect()
}

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

/// Run `command` through the tool. A refusal or an error fails the test: every command here is
/// one the tool must run.
async fn run(ctx: &ToolContext, command: &str) -> Value {
    RunCommand
        .call(json!({ "command": command, "timeout_secs": 10 }), ctx)
        .await
        .unwrap_or_else(|e| panic!("the command was refused or failed: {e:#}"))
}

fn stdout_of(result: &Value) -> &str {
    result["stdout"].as_str().unwrap_or_default()
}

/// The lines of a stored buffer that show part of a secret, read back through the tool.
async fn secret_lines_in(ctx: &ToolContext, handle: &str) -> String {
    let mut command = String::from("grep -n -E");
    for pattern in window_patterns() {
        command.push_str(&format!(" -e '{}'", pattern));
    }
    command.push(' ');
    command.push_str(handle);
    let reply = run(ctx, &command).await;
    format!(
        "{}{}",
        reply["stdout"].as_str().unwrap_or_default(),
        reply["stderr"].as_str().unwrap_or_default()
    )
}

/// What a buffer stores, read directly by its handle, the way `read_file` and the `grep` tool read it:
/// no command runs, so nothing on the way back can replace a value that is stored there.
fn stored_in(ctx: &ToolContext, handle: &str) -> String {
    let entry = ctx
        .output_buffer
        .get(handle)
        .unwrap_or_else(|| panic!("the handle {handle} resolves"));
    format!("{}{}", entry.stdout, entry.stderr)
}

/// Wait until a background job has exited and its log holds something.
async fn wait_until_the_job_has_finished(ctx: &ToolContext, handle: &str) {
    for _ in 0..200 {
        let job = ctx
            .output_buffer
            .get_background(handle)
            .expect("the job is registered under its handle");
        let log = std::fs::read_to_string(&job.log_path).unwrap_or_default();
        if !job.state.may_still_be_writing() && !log.is_empty() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("the background job did not finish within 10 seconds");
}

/// `printf '%s\n' 'line' 'line' ...` for lines that hold no single quote.
fn print_lines(lines: &[String]) -> String {
    let quoted: Vec<String> = lines.iter().map(|l| format!("'{}'", l)).collect();
    format!("printf '%s\\n' {}", quoted.join(" "))
}

// ---- fail to pass: a value must not reach the caller ----------------------------------------

#[tokio::test]
async fn a_token_printed_on_stdout_is_replaced_and_the_lines_around_it_are_kept() {
    let (_dir, ctx) = project_ctx().await;
    let token = secret("ghp_", 36);
    let command = print_lines(&[
        "HOME=/x".to_string(),
        format!("GITHUB_TOKEN={}", token),
        "PATH=/bin".to_string(),
    ]);
    let result = run(&ctx, &command).await;

    let shown = result.to_string();
    assert!(
        !shows_part_of_a_secret(&shown),
        "part of the token reached the caller: {shown}"
    );
    let stdout = stdout_of(&result);
    let lines: Vec<&str> = stdout.lines().collect();
    assert!(
        lines.contains(&"HOME=/x") && lines.contains(&"PATH=/bin"),
        "the lines around the value are kept: {stdout:?}"
    );
    let line = lines
        .iter()
        .find(|l| l.starts_with("GITHUB_TOKEN="))
        .unwrap_or_else(|| panic!("the line that held the token is still there: {stdout:?}"));
    assert!(
        line.len() > "GITHUB_TOKEN=".len(),
        "the value is replaced, not just removed: {stdout:?}"
    );
    assert_eq!(result["exit_code"], 0, "{result}");
    assert!(result.get("pending_ack").is_none(), "{result}");
}

#[tokio::test]
async fn a_token_printed_on_stderr_is_replaced() {
    let (_dir, ctx) = project_ctx().await;
    let token = secret("ghp_", 36);
    let result = run(&ctx, &format!("printf '%s' '{}' >&2", token)).await;

    let shown = result.to_string();
    assert!(
        !shows_part_of_a_secret(&shown),
        "part of the token reached the caller: {shown}"
    );
    assert!(
        result["stderr"].as_str().is_some_and(|s| !s.is_empty()),
        "the value is replaced, not just removed: {result}"
    );
}

#[tokio::test]
async fn a_token_in_output_large_enough_to_buffer_cannot_be_read_back_from_the_buffer() {
    let (_dir, ctx) = project_ctx().await;
    let token = secret("ghp_", 36);
    // About 14 KB: more than the tool returns inline, so the output is buffered.
    let result = run(
        &ctx,
        &format!("{{ seq 1 3000; printf '%s\\n' '{}'; seq 1 10; }}", token),
    )
    .await;

    let shown = result.to_string();
    assert!(
        !shows_part_of_a_secret(&shown),
        "part of the token reached the caller: {shown}"
    );
    let handle = result["output_id"]
        .as_str()
        .unwrap_or_else(|| panic!("about 14 KB of output is buffered: {result}"));

    let leaked = secret_lines_in(&ctx, handle).await;
    assert!(
        !shows_part_of_a_secret(&leaked),
        "a later query of the buffer shows the token: {leaked:?}"
    );
    let stored = stored_in(&ctx, handle);
    assert!(
        !shows_part_of_a_secret(&stored),
        "the buffer behind the handle stores part of the token"
    );

    // The one line that is not a bare number is the line that held the token.
    let odd = run(&ctx, &format!("grep -n -v -e '^[0-9]*$' {}", handle)).await;
    let odd_lines: Vec<&str> = stdout_of(&odd).lines().collect();
    assert_eq!(odd_lines.len(), 1, "{odd}");
    assert!(
        odd_lines[0].starts_with("3001:") && odd_lines[0].len() > "3001:".len(),
        "the line that held the token is still line 3001, with a replacement in it: {odd}"
    );
}

#[tokio::test]
async fn a_token_the_filter_hides_cannot_be_read_back_from_the_unfiltered_capture() {
    let (_dir, ctx) = project_ctx().await;
    let token = secret("ghp_", 36);
    // The filter drops every line, so the token is not in `stdout`. The unfiltered stream, which
    // the tool keeps behind a handle, still held it.
    let result = run(
        &ctx,
        &format!("printf '%s\\n' '{}' b | grep zzz", token),
    )
    .await;

    let shown = result.to_string();
    assert!(
        !shows_part_of_a_secret(&shown),
        "part of the token reached the caller: {shown}"
    );
    // A design that keeps no capture for such output passes too: then there is no handle.
    if let Some(handle) = result["unfiltered_output"].as_str() {
        let leaked = secret_lines_in(&ctx, handle).await;
        assert!(
            !shows_part_of_a_secret(&leaked),
            "the unfiltered capture kept the token: {leaked:?}"
        );
        let stored = stored_in(&ctx, handle);
        assert!(
            !shows_part_of_a_secret(&stored),
            "the unfiltered capture stores the token: {stored:?}"
        );
        let all = run(&ctx, &format!("grep -n -v -e '^$' {}", handle)).await;
        assert!(
            stdout_of(&all).lines().any(|l| l == "2:b"),
            "the rest of the capture is kept: {all}"
        );
    }
}

#[tokio::test]
async fn a_background_job_that_printed_a_token_does_not_return_it_when_read_back() {
    let (_dir, ctx) = project_ctx().await;
    // The token is produced by printf (forty characters after the prefix, all zeros), so the
    // job's command, which the reply may echo, holds no value of the format.
    let started = RunCommand
        .call(
            json!({ "command": "printf 'ghp_%036d\\n' 0", "run_in_background": true }),
            &ctx,
        )
        .await
        .unwrap();
    let handle = started["output_id"]
        .as_str()
        .unwrap_or_else(|| panic!("a background job returns its handle at once: {started}"))
        .to_string();
    wait_until_the_job_has_finished(&ctx, &handle).await;

    let read = run(&ctx, &format!("cat {}", handle)).await;
    let shown = read.to_string();
    assert!(
        !shown.contains("0000000000"),
        "the job's output came back with the token in it: {shown}"
    );
    assert!(
        stdout_of(&read).lines().any(|l| !l.is_empty()),
        "the job's output is still readable, with a replacement where the token was: {shown}"
    );
}

#[tokio::test]
async fn every_listed_format_is_replaced_wherever_it_stands_in_a_line() {
    let (_dir, ctx) = project_ctx().await;
    // (text before the value, the value, text after it)
    let cases: Vec<(String, String, String)> = vec![
        ("GH_CLASSIC=".into(), secret("ghp_", 36), "".into()),
        ("GH_OAUTH=".into(), secret("gho_", 36), "".into()),
        ("GH_USER=".into(), secret("ghu_", 36), "".into()),
        ("GH_SERVER=".into(), secret("ghs_", 36), "".into()),
        ("GH_REFRESH=".into(), secret("ghr_", 36), "".into()),
        ("GH_FINE=".into(), secret("github_pat_", 50), "".into()),
        ("OPENAI_API_KEY=".into(), secret("sk-", 20), "".into()),
        (
            "ANTHROPIC_API_KEY=".into(),
            secret("sk-ant-api03-", 40),
            "".into(),
        ),
        ("AWS_ACCESS_KEY_ID=".into(), secret("AKIA", 16), "".into()),
        ("AWS_TEMP_KEY_ID=".into(), secret("ASIA", 16), "".into()),
        (
            "{\"token\":\"".into(),
            secret("ghp_", 36),
            "\"}".into(),
        ),
        (
            "pair: ".into(),
            format!("{} and {}", secret("ghp_", 36), secret("gho_", 40)),
            "".into(),
        ),
    ];
    let printed: Vec<String> = cases
        .iter()
        .map(|(before, value, after)| format!("{}{}{}", before, value, after))
        .collect();
    let result = run(&ctx, &print_lines(&printed)).await;

    let shown = result.to_string();
    assert!(
        !shows_part_of_a_secret(&shown),
        "part of a value reached the caller: {shown}"
    );
    let stdout = stdout_of(&result);
    let got: Vec<&str> = stdout.lines().collect();
    assert_eq!(
        got.len(),
        cases.len(),
        "no line is dropped or added: {stdout:?}"
    );
    for ((before, _, after), line) in cases.iter().zip(got.iter()) {
        assert!(
            line.starts_with(before.as_str())
                && line.ends_with(after.as_str())
                && line.len() > before.len() + after.len(),
            "`{before}` ... `{after}` keeps its surroundings and gets a replacement: {line:?}"
        );
    }
    assert!(
        got[got.len() - 1].contains(" and "),
        "both values of the last line are replaced in place: {stdout:?}"
    );
}

#[tokio::test]
async fn a_value_longer_than_the_minimum_is_replaced_whole() {
    let (_dir, ctx) = project_ctx().await;
    let printed = vec![
        format!("A={}", secret("ghp_", 100)),
        format!("B={}", secret("github_pat_", 120)),
        format!("C={}", secret("sk-", 90)),
    ];
    let result = run(&ctx, &print_lines(&printed)).await;

    let shown = result.to_string();
    assert!(
        !shows_part_of_a_secret(&shown),
        "a tail of a long value reached the caller: {shown}"
    );
    let stdout = stdout_of(&result);
    let got: Vec<&str> = stdout.lines().collect();
    assert_eq!(got.len(), 3, "{stdout:?}");
    for (label, line) in ["A=", "B=", "C="].iter().zip(got.iter()) {
        let label: &str = label;
        assert!(
            line.starts_with(label) && line.len() > label.len(),
            "{label} keeps its name and gets a replacement: {line:?}"
        );
    }
}

#[tokio::test]
async fn an_environment_dump_that_holds_a_token_does_not_return_it() {
    let (_dir, ctx) = project_ctx().await;
    let token = secret("ghp_", 36);
    temp_env::async_with_vars([("GITHUB_TOKEN", Some(token.as_str()))], async {
        for command in ["env", "env | grep GITHUB", "printenv GITHUB_TOKEN"] {
            let result = run(&ctx, command).await;
            assert_eq!(result["exit_code"], 0, "`{command}` ran: {result}");

            let shown = result.to_string();
            assert!(
                !shows_part_of_a_secret(&shown),
                "`{command}` returned part of the token: {shown}"
            );
            for key in ["output_id", "unfiltered_output"] {
                if let Some(handle) = result[key].as_str() {
                    let leaked = secret_lines_in(&ctx, handle).await;
                    assert!(
                        !shows_part_of_a_secret(&leaked),
                        "`{command}`: the buffer behind {key} shows the token: {leaked:?}"
                    );
                    let stored = stored_in(&ctx, handle);
                    assert!(
                        !shows_part_of_a_secret(&stored),
                        "`{command}`: the buffer behind {key} stores the token"
                    );
                }
            }
            if command == "printenv GITHUB_TOKEN" {
                assert!(
                    !stdout_of(&result).trim().is_empty(),
                    "the value is replaced, not just removed: {result}"
                );
            }
        }
    })
    .await;
}

// ---- pass to pass: nothing else changes -----------------------------------------------------

#[tokio::test]
async fn unaltered_plain_output_and_its_unfiltered_capture() {
    let (_dir, ctx) = project_ctx().await;
    let plain = run(&ctx, "printf 'plain\\nsecond line\\n'").await;
    assert!(
        stdout_of(&plain).contains("plain\nsecond line"),
        "{plain}"
    );
    assert_eq!(plain["exit_code"], 0, "{plain}");

    let filtered = run(&ctx, "printf 'a\\nb\\n' | grep a").await;
    assert_eq!(stdout_of(&filtered).trim_end(), "a", "{filtered}");
    let handle = filtered["unfiltered_output"]
        .as_str()
        .unwrap_or_else(|| panic!("a filtered command still offers its unfiltered output: {filtered}"));
    let stored = run(&ctx, &format!("grep -n -v -e '^$' {}", handle)).await;
    let lines: Vec<&str> = stdout_of(&stored).lines().collect();
    assert_eq!(lines, vec!["1:a", "2:b"], "{stored}");
}

#[tokio::test]
async fn unaltered_text_that_is_not_one_of_the_formats() {
    let (_dir, ctx) = project_ctx().await;
    let printed = vec![
        secret("ghp_", 35),
        secret("ghx_", 40),
        secret("task-force-", 30),
        secret("risk-assessment-", 30),
        secret("sk-", 19),
        secret("AKIA", 15),
        secret("github_pat_", 49),
        "GITHUB_TOKEN=not-a-token".to_string(),
        "PASSWORD=hunter2".to_string(),
    ];
    let result = run(&ctx, &print_lines(&printed)).await;

    let stdout = stdout_of(&result);
    let got: Vec<&str> = stdout.lines().collect();
    for line in &printed {
        assert!(
            got.contains(&line.as_str()),
            "`{line}` is not a credential and must come back as printed: {stdout:?}"
        );
    }
    assert_eq!(result["exit_code"], 0, "{result}");
}

#[tokio::test]
async fn unaltered_exit_code_and_the_lines_around_a_value() {
    let (_dir, ctx) = project_ctx().await;
    let token = secret("ghp_", 36);
    let command = format!("printf '%s\\n' 'before' '{}' 'after'; exit 3", token);
    let result = run(&ctx, &command).await;

    assert_eq!(result["exit_code"], 3, "{result}");
    assert!(
        result.get("pending_ack").is_none(),
        "the command is not held back for what it prints: {result}"
    );
    let stdout = stdout_of(&result);
    let got: Vec<&str> = stdout.lines().collect();
    assert!(
        got.contains(&"before") && got.contains(&"after"),
        "{stdout:?}"
    );
}

#[tokio::test]
async fn unaltered_background_output_without_a_value() {
    let (_dir, ctx) = project_ctx().await;
    let started = RunCommand
        .call(
            json!({ "command": "printf 'hello\\n'", "run_in_background": true }),
            &ctx,
        )
        .await
        .unwrap();
    let handle = started["output_id"]
        .as_str()
        .unwrap_or_else(|| panic!("a background job returns its handle at once: {started}"))
        .to_string();
    wait_until_the_job_has_finished(&ctx, &handle).await;

    let read = run(&ctx, &format!("cat {}", handle)).await;
    assert!(stdout_of(&read).contains("hello"), "{read}");
}
