#![cfg(unix)] // Unix-only: fakes /proc, unix permissions or process groups
//! MCP `post_notice` resolves its caller among Claude Code and Codex sessions only: it never
//! runs OpenCode discovery (no `opencode` process, no service start). Own test binary because
//! it sets process environment.
use serde_json::json;
use session_bridge_mcp::{endpoints::Roots, server::post_notice_sessions, sessions::Session};
use std::{fs, path::Path};

#[tokio::test]
async fn post_notice_skips_opencode_discovery() {
    let d = tempfile::tempdir().unwrap();
    let state = d.path().join("state");
    fs::create_dir_all(&state).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let row = json!({"id": "ses_live1", "title": "t", "time": {"updated": now}});
    let script = json!({
        "GET /api/session?limit=100": {"out": json!({"data": [row]}).to_string()},
        "GET /api/session/active": {"out": "{\"data\":{}}"},
    });
    fs::write(state.join("script.json"), script.to_string()).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-opencode.py");
    let bin = d.path().join("opencode");
    std::os::unix::fs::symlink(&fixture, &bin).unwrap();
    fs::create_dir_all(d.path().join("xdg/opencode")).unwrap();
    std::env::set_var("SESSION_BRIDGE_OPENCODE_BIN", &bin);
    std::env::set_var("XDG_DATA_HOME", d.path().join("xdg"));
    let roots = Roots {
        proc_root: d.path().join("proc"),
        socks: d.path().join("socks"),
    };
    let sessions = post_notice_sessions(&roots).await;
    assert!(!sessions.iter().any(|s| matches!(s, Session::OpenCode(_))));
    assert!(
        !state.join("argv.log").exists(),
        "opencode was invoked: {:?}",
        fs::read_to_string(state.join("argv.log"))
    );
}
