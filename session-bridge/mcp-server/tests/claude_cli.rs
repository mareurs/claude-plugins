use session_bridge_mcp::claude_cli::{build_argv, AskMode, AskSpec};
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

#[test]
fn ephemeral_argv_uses_fork_session_and_restricts_tools() {
    let spec = AskSpec {
        mode: AskMode::Ephemeral,
        session_id: "abc-123".into(),
        cwd: PathBuf::from("/work"),
        prompt: "hello".into(),
        timeout_s: 60,
    };
    let argv = build_argv(&spec);
    assert!(argv.contains(&"-p".to_string()));
    assert!(argv.contains(&"--resume".to_string()));
    assert!(argv.contains(&"abc-123".to_string()));
    assert!(argv.contains(&"--fork-session".to_string()));
    assert!(argv.contains(&"--no-session-persistence".to_string()));
    let i = argv.iter().position(|s| s == "--allowed-tools").expect("--allowed-tools missing");
    assert_eq!(argv[i + 1], "Read,Grep,Glob,WebFetch");
    assert_eq!(argv.last().map(String::as_str), Some("hello"));
}

#[test]
fn bidirectional_argv_uses_resume_and_no_tool_restriction() {
    let spec = AskSpec {
        mode: AskMode::Bidirectional,
        session_id: "abc-123".into(),
        cwd: PathBuf::from("/work"),
        prompt: "hi".into(),
        timeout_s: 60,
    };
    let argv = build_argv(&spec);
    assert!(argv.contains(&"-p".to_string()));
    assert!(argv.contains(&"--resume".to_string()));
    assert!(argv.contains(&"abc-123".to_string()));
    assert!(!argv.iter().any(|s| s == "--allowed-tools"));
    assert!(!argv.iter().any(|s| s == "--fork-session"));
    assert_eq!(argv.last().map(String::as_str), Some("hi"));
}

#[tokio::test]
async fn spawn_captures_mock_stdout() {
    use session_bridge_mcp::claude_cli::run_with_binary;
    let tmp = tempfile::tempdir().unwrap();
    let script = tmp.path().join("claude");
    std::fs::write(&script, "#!/usr/bin/env bash\necho 'mock answer'\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

    let spec = AskSpec {
        mode: AskMode::Bidirectional,
        session_id: "id".into(),
        cwd: tmp.path().to_path_buf(),
        prompt: "x".into(),
        timeout_s: 5,
    };
    let out = run_with_binary(script.to_str().unwrap(), &spec).await.unwrap();
    assert!(out.contains("mock answer"));
}

#[tokio::test]
async fn spawn_times_out() {
    use session_bridge_mcp::claude_cli::run_with_binary;
    let tmp = tempfile::tempdir().unwrap();
    let script = tmp.path().join("claude");
    std::fs::write(&script, "#!/usr/bin/env bash\nsleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let spec = AskSpec {
        mode: AskMode::Bidirectional,
        session_id: "id".into(),
        cwd: tmp.path().to_path_buf(),
        prompt: "x".into(),
        timeout_s: 1,
    };
    let err = run_with_binary(script.to_str().unwrap(), &spec).await.unwrap_err();
    assert!(matches!(err, session_bridge_mcp::error::BridgeError::Timeout(_)));
}
