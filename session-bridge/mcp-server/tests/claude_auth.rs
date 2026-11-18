//! Exercise actual ask/filter subprocess environments without changing this test process's env.
use session_bridge_mcp::{ask::ask_with_bound, endpoints::Endpoint};
use std::{path::Path, process::Command, time::Duration};

const AUTH_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "CLAUDE_CODE_OAUTH_TOKEN_FD",
    "CLAUDE_CODE_OAUTH_SCOPES",
    "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
];

#[test]
fn target_auth_reaches_both_claude_children_without_loading_other_settings() {
    run_case("target");
}

#[test]
fn missing_target_settings_never_inherit_caller_auth() {
    run_case("missing");
}

#[test]
fn malformed_target_settings_fail_before_spawning() {
    run_case("malformed");
}
#[test]
fn non_string_target_auth_fails_before_spawning() {
    run_case("nonstring");
}

fn run_case(case: &str) {
    let out = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "profile_auth_child", "--nocapture"])
        .env("SB_AUTH_TEST_CASE", case)
        .envs(AUTH_KEYS.iter().map(|k| (*k, "caller-secret")))
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn profile_auth_child() {
    let Ok(case) = std::env::var("SB_AUTH_TEST_CASE") else {
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let config = tmp.path().join("target-profile");
    std::fs::create_dir_all(&config).unwrap();
    match case.as_str() {
        "target" => std::fs::write(
            config.join("settings.json"),
            serde_json::json!({
                "env": {
                    "CLAUDE_CODE_OAUTH_TOKEN": "target-oauth",
                    "ANTHROPIC_API_KEY": "target-api-key",
                    "ANTHROPIC_AUTH_TOKEN": "target-auth-token",
                    "ANTHROPIC_BASE_URL": "https://target.invalid",
                    "SB_AUTH_UNRELATED": "must-not-load",
                    "CLAUDE_CONFIG_DIR": "/must-not-load"
                },
                "hooks": {"SessionStart": [{"command": "must-not-run"}]},
                "apiKeyHelper": "must-not-run"
            })
            .to_string(),
        )
        .unwrap(),
        "nonstring" => std::fs::write(
            config.join("settings.json"),
            serde_json::json!({"env":{"CLAUDE_CODE_OAUTH_TOKEN":17}}).to_string(),
        )
        .unwrap(),
        "malformed" => std::fs::write(config.join("settings.json"), "{").unwrap(),
        _ => {}
    }
    let probe = tmp.path().join("probe.sh");
    std::fs::write(&probe, r#"#!/bin/sh
python3 - <<'PY'
import json, os
from pathlib import Path
keys = ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR','CLAUDE_CODE_OAUTH_TOKEN_FD','CLAUDE_CODE_OAUTH_SCOPES','CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH','ANTHROPIC_BASE_URL','ANTHROPIC_CUSTOM_HEADERS','SB_AUTH_UNRELATED','CLAUDE_CONFIG_DIR']
Path(os.environ['CLAUDE_CONFIG_DIR'], 'observed.json').write_text(json.dumps({k:os.environ.get(k) for k in keys}))
print(json.dumps({'result':'{"verdicts":[]}', 'total_cost_usd':0.01, 'is_error':False}))
PY
"#).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&probe, std::fs::Permissions::from_mode(0o755)).unwrap();
    let target = Endpoint {
        profile: "target-profile".into(),
        config_dir: config.clone(),
        pid: 42,
        session_id: "fixture-session".into(),
        name: None,
        kind: None,
        status: None,
        launch_cwd: tmp.path().to_owned(),
        repo: None,
    };
    let rt = tokio::runtime::Runtime::new().unwrap();
    let state = tmp.path().join("state");
    let r = rt.block_on(ask_with_bound(
        probe.to_str().unwrap(),
        &target,
        "main:1",
        "auth probe",
        "haiku",
        5,
        &state,
        None,
    ));
    if matches!(case.as_str(), "malformed" | "nonstring") {
        assert!(
            r.is_err(),
            "invalid settings must not silently use another account"
        );
        assert!(
            !config.join("observed.json").exists(),
            "ask spawned with invalid settings"
        );
    } else {
        r.unwrap();
        assert_observed(&config, &case);
    }
    let store = session_bridge_mcp::store::Store::open(&tmp.path().join("notices.db")).unwrap();
    let transcript = tmp.path().join("transcript.jsonl");
    std::fs::write(
        &transcript,
        "{\"type\":\"user\",\"message\":{\"content\":\"auth test\"}}\n",
    )
    .unwrap();
    let notice = store
        .post(session_bridge_mcp::store::NewNotice {
            at_ms: 1000,
            repo: "repo".into(),
            author_profile: ".claude".into(),
            author_pid: 2,
            author_session: "peer".into(),
            origin: session_bridge_mcp::store::Origin::Manual,
            title: "test".into(),
            body: "body".into(),
            refs: vec![],
            patch_id: None,
        })
        .unwrap();
    session_bridge_mcp::state::update(
        &session_bridge_mcp::state::endpoint_path(&state, "target-profile", 42),
        |s| {
            s.pending = vec![notice];
            s.transcript_path = Some(transcript.display().to_string());
        },
    )
    .unwrap();
    rt.block_on(session_bridge_mcp::filter::run_filter_with(
        probe.to_str().unwrap(),
        &state,
        &store,
        "target-profile",
        42,
        &config,
        Duration::from_secs(5),
    ))
    .unwrap();
    if matches!(case.as_str(), "malformed" | "nonstring") {
        assert!(
            !config.join("observed.json").exists(),
            "filter spawned with invalid settings"
        );
    } else {
        assert_observed(&config, &case);
    }
}

fn assert_observed(config: &Path, case: &str) {
    let path = config.join("observed.json");
    let observed: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    for key in AUTH_KEYS {
        let expected = match (case, *key) {
            ("target", "ANTHROPIC_API_KEY") => serde_json::json!("target-api-key"),
            ("target", "ANTHROPIC_AUTH_TOKEN") => serde_json::json!("target-auth-token"),
            ("target", "CLAUDE_CODE_OAUTH_TOKEN") => serde_json::json!("target-oauth"),
            ("target", "ANTHROPIC_BASE_URL") => serde_json::json!("https://target.invalid"),
            _ => serde_json::Value::Null,
        };
        assert_eq!(
            observed[*key], expected,
            "wrong child environment for {key}"
        );
    }
    assert_eq!(observed["SB_AUTH_UNRELATED"], serde_json::Value::Null);
    assert_eq!(observed["CLAUDE_CONFIG_DIR"], config.display().to_string());
    std::fs::remove_file(path).unwrap();
}
