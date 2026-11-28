#![cfg(unix)] // Unix-only: fakes /proc, unix permissions or process groups
use session_bridge_mcp::{
    codex::CodexEndpoint,
    codex_process::{ask_codex, parse_answer, run_bounded},
};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;
const A: &str = "11111111-1111-7111-8111-111111111111";
const B: &str = "22222222-2222-7222-8222-222222222222";
fn target(root: &Path) -> CodexEndpoint {
    let host = root.join("proc/20");
    fs::create_dir_all(host.join("fd")).unwrap();
    let transcript = root.join(format!("rollout-2026-11-16T10-00-00-{A}.jsonl"));
    fs::write(&transcript, "").unwrap();
    fs::write(host.join("cmdline"), b"codex\0app-server\0").unwrap();
    fs::write(
        host.join("environ"),
        format!("CODEX_HOME={}\0", root.display()),
    )
    .unwrap();
    let mut fields = ["0"; 22];
    fields[0] = "S";
    fields[19] = "99";
    fs::write(
        host.join("stat"),
        format!("20 (codex) {}", fields.join(" ")),
    )
    .unwrap();
    let fd = host.join("fd/3");
    let _ = fs::remove_file(&fd);
    std::os::unix::fs::symlink(&transcript, fd).unwrap();
    CodexEndpoint {
        config_dir: root.to_path_buf(),
        pid: 20,
        session_id: A.into(),
        transcript_path: transcript,
        cwd: Some(root.to_path_buf()),
        name: None,
        generation: Some("99".into()),
    }
}
fn roots(root: &Path) -> session_bridge_mcp::endpoints::Roots {
    session_bridge_mcp::endpoints::Roots {
        proc_root: root.join("proc"),
        socks: root.join("socks"),
    }
}
#[tokio::test]
async fn refuses_unloaded_fork_before_spawning_the_cli() {
    let d = tempfile::tempdir().unwrap();
    let endpoint = target(d.path());
    fs::remove_file(d.path().join("proc/20/fd/3")).unwrap();
    let marker = d.path().join("spawned");
    let bin = exe(
        d.path(),
        &format!(
            "open({:?},'w').write('spawned')\nprint({:?})",
            marker,
            output("bad")
        ),
    );
    let error = ask_codex(&bin, &endpoint, &roots(d.path()), "q", None, 5, d.path())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("no longer loaded"), "{error}");
    assert!(!marker.exists());
}

fn exe(root: &Path, body: &str) -> PathBuf {
    let path = root.join("fake-codex");
    fs::write(&path, format!("#!/usr/bin/env python3\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}
fn output(answer: &str) -> String {
    format!(
        "{}\n{}\n{}\n",
        serde_json::json!({"type":"thread.started","thread_id":B}),
        serde_json::json!({"type":"item.completed","item":{"type":"agent_message","text":answer}}),
        serde_json::json!({"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":4}})
    )
}
#[test]
fn requires_completed_answer_and_rejects_failed_or_truncated_streams() {
    let good = output("reply");
    let (answer, usage, thread) = parse_answer(&good).unwrap();
    assert_eq!(answer, "reply");
    assert_eq!(usage.unwrap()["input_tokens"], 12);
    assert_eq!(thread, B);
    for bad in ["","{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"partial\"}}\n",
        "{\"type\":\"turn.completed\"}\n", "{\"type\":\"turn.failed\",\"error\":{\"message\":\"oops\"}}\n",
        "{\"type\":\"item.completed\"", "{\"type\":\"error\",\"message\":\"bad\"}\n"] {assert!(parse_answer(bad).is_err(),"{bad}");}
    assert!(parse_answer(&(good + "{")).is_err());
}

#[test]
fn rejects_answer_when_turn_completion_is_missing() {
    let incomplete = format!(
        "{}\n{}\n",
        serde_json::json!({"type":"thread.started","thread_id":B}),
        serde_json::json!({"type":"item.completed","item":{"type":"agent_message","text":"plausible but unfinished"}})
    );
    assert!(parse_answer(&incomplete)
        .unwrap_err()
        .to_string()
        .contains("completed turn"));
}

#[test]
fn isolated_forks_remove_callers_credentials_and_endpoint_overrides() {
    let cmd = session_bridge_mcp::codex_process::isolated_command(
        Path::new("/absolute/codex"),
        Path::new("/target/.codex"),
        Path::new("/tmp"),
    )
    .unwrap();
    let env: std::collections::HashMap<_, _> = cmd.as_std().get_envs().collect();
    for key in [
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
        "CODEX_ACCESS_TOKEN",
        "OPENAI_BASE_URL",
        "CHATGPT_BASE_URL",
    ] {
        assert_eq!(env.get(std::ffi::OsStr::new(key)), Some(&None), "{key}");
    }
}

#[tokio::test]
async fn fork_is_ephemeral_read_only_no_hooks_or_plugins_with_literal_arguments() {
    let d = tempfile::tempdir().unwrap();
    let bin = exe(
        d.path(),
        r#"import os,sys,json
answer=json.dumps({'argv':sys.argv[1:],'home':os.environ.get('CODEX_HOME'),'child':os.environ.get('SESSION_BRIDGE_CHILD'),'cwd':os.getcwd()})
print(json.dumps({'type':'thread.started','thread_id':'22222222-2222-7222-8222-222222222222'}))
print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':answer}}))
print(json.dumps({'type':'turn.completed','usage':{'input_tokens':7,'output_tokens':2}}))"#,
    );
    let question = format!(
        "literal {0}touch BAD{0} $(touch BAD) 'quotes'\nsecond line",
        char::from(96)
    );
    let model = "model-id";
    let result = ask_codex(
        &bin,
        &target(d.path()),
        &roots(d.path()),
        &question,
        Some(model),
        5,
        d.path(),
    )
    .await
    .unwrap();
    let data: serde_json::Value = serde_json::from_str(&result.answer).unwrap();
    let argv: Vec<String> = serde_json::from_value(data["argv"].clone()).unwrap();
    for flag in [
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--json",
    ] {
        assert!(argv.iter().any(|a| a == flag), "{flag}");
    }
    for pair in [
        ["--sandbox", "read-only"],
        ["--disable", "hooks"],
        ["--disable", "plugins"],
        ["-c", "approval_policy=\"never\""],
        ["--model", model],
    ] {
        assert!(argv.windows(2).any(|a| a == pair), "{pair:?}");
    }
    assert!(argv.windows(2).any(|a| a == ["fork", A]));
    assert!(argv.last().unwrap().contains(&question));
    assert_eq!(data["home"], d.path().to_str().unwrap());
    assert_eq!(data["child"], "1");
    assert_ne!(data["cwd"], d.path().to_str().unwrap());
    assert_eq!(result.cost_usd, None);
    assert_eq!(result.usage.unwrap()["input_tokens"], 7);
    assert!(!d.path().join("BAD").exists());
}
#[tokio::test]
async fn successful_looking_output_with_nonzero_exit_is_failure() {
    let d = tempfile::tempdir().unwrap();
    let body = format!("import sys\nprint({:?})\nsys.exit(3)", output("plausible"));
    let bin = exe(d.path(), &body);
    assert!(ask_codex(
        &bin,
        &target(d.path()),
        &roots(d.path()),
        "q",
        None,
        5,
        d.path()
    )
    .await
    .is_err());
}
#[tokio::test]
async fn refuses_same_thread_id_and_relative_program() {
    let d = tempfile::tempdir().unwrap();
    let bin = exe(d.path(), &format!("print({:?})", output("x").replace(B, A)));
    assert!(ask_codex(
        &bin,
        &target(d.path()),
        &roots(d.path()),
        "q",
        None,
        5,
        d.path()
    )
    .await
    .is_err());
    assert!(ask_codex(
        Path::new("relative"),
        &target(d.path()),
        &roots(d.path()),
        "q",
        None,
        5,
        d.path()
    )
    .await
    .is_err());
}
#[tokio::test]
async fn bounds_output_and_time_and_kills_descendants() {
    let d = tempfile::tempdir().unwrap();
    let marker = d.path().join("leaked");
    let bin=exe(d.path(),&format!("import os,time\nif os.fork()==0:\n time.sleep(1);open({:?},'w').write('bad');os._exit(0)\ntime.sleep(10)",marker.to_str().unwrap()));
    let mut cmd = Command::new(&bin);
    let start = std::time::Instant::now();
    assert!(run_bounded(&mut cmd, Duration::from_millis(100))
        .await
        .is_err());
    assert!(start.elapsed() < Duration::from_secs(2));
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert!(
        !marker.exists(),
        "timed-out subprocess descendants survived"
    );
    let bin = exe(d.path(), "print('x'*2000000)");
    assert!(run_bounded(&mut Command::new(bin), Duration::from_secs(3))
        .await
        .is_err());
}
