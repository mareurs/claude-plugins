use session_bridge_mcp::server::{post_notice_impl, PostNoticeArgs};
use std::process::Command;
use tempfile::TempDir;

fn git_repo() -> TempDir {
    let d = TempDir::new().unwrap();
    assert!(Command::new("git")
        .args(["init", "-q"])
        .arg(d.path())
        .status()
        .unwrap()
        .success());
    d
}

fn run(state: &TempDir, repo: &str, extra: &[&str]) -> (i32, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_session-bridge"))
        .args(["notices", "--repo", repo, "--after", "0"])
        .args(extra)
        .env("XDG_STATE_HOME", state.path())
        .output()
        .unwrap();
    (
        out.status.code().unwrap(),
        String::from_utf8(out.stdout).unwrap(),
    )
}

#[test]
fn notices_prints_text_and_json_and_stays_silent_on_errors() {
    let xdg = TempDir::new().unwrap();
    let repo = git_repo();
    let repo_s = repo.path().to_str().unwrap();
    // no database yet: exit 0, nothing printed
    assert_eq!(run(&xdg, repo_s, &[]), (0, String::new()));

    let state = xdg.path().join("session-bridge");
    let a = PostNoticeArgs {
        title: "moved main".into(),
        body: "b".into(),
        refs: vec![],
        to: None,
    };
    post_notice_impl(&state, (".claude-stef", 77), repo.path(), a).unwrap();

    let (code, text) = run(&xdg, repo_s, &[]);
    assert_eq!(code, 0);
    assert_eq!(text.lines().count(), 1, "{text}");
    assert!(
        text.starts_with("1 ") && text.contains(" UTC stef:77 moved main"),
        "{text}"
    );

    let (code, json) = run(&xdg, repo_s, &["--json"]);
    assert_eq!(code, 0);
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["next_cursor"], 1);
    assert_eq!(v["notices"][0]["title"], "moved main");
    assert_eq!(v["notices"][0]["origin"], "manual");

    // not a repository: silent, exit 0
    let plain = TempDir::new().unwrap();
    assert_eq!(
        run(&xdg, plain.path().to_str().unwrap(), &[]),
        (0, String::new())
    );
}
