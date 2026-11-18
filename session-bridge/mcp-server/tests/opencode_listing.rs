use session_bridge_mcp::{
    opencode::OpenCodeEndpoint,
    sessions::Session,
    tools::{list_sessions, ListSessionsArgs},
};
use std::{path::Path, process::Command};
use tempfile::TempDir;

fn session(root: &Path, id: &str, title: &str) -> Session {
    Session::OpenCode(OpenCodeEndpoint {
        data_dir: root.join("data"),
        session_id: id.into(),
        title: Some(title.into()),
        directory: Some(root.into()),
        running: true,
        last_active_ms: 0,
    })
}

fn repositories() -> (TempDir, Vec<Session>) {
    let tmp = tempfile::tempdir().unwrap();
    let mut sessions = Vec::new();
    for (name, id) in [("caller", "ses_caller"), ("foreign", "ses_foreign")] {
        let repo = tmp.path().join(name);
        std::fs::create_dir(&repo).unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(&repo)
            .status()
            .unwrap()
            .success());
        sessions.push(session(&repo, id, name));
    }
    (tmp, sessions)
}

#[tokio::test]
async fn open_code_listing_defaults_to_the_callers_repository() {
    let (_tmp, sessions) = repositories();
    let out = list_sessions(
        Some(&sessions[0]),
        &sessions,
        &[],
        ListSessionsArgs::default(),
    )
    .await
    .unwrap();
    assert!(out.contains("ses_caller"), "{out}");
    assert!(out.contains("(you)"), "{out}");
    assert!(!out.contains("ses_foreign"), "{out}");
    assert!(out.contains("1 more session(s)"), "{out}");
    assert!(out.contains("all=true"), "{out}");
}

#[tokio::test]
async fn unknown_caller_lists_all_and_explains_the_missing_repository_filter() {
    let (_tmp, sessions) = repositories();
    let out = list_sessions(None, &sessions, &[], ListSessionsArgs::default())
        .await
        .unwrap();
    assert!(
        out.contains("ses_caller") && out.contains("ses_foreign"),
        "{out}"
    );
    assert!(out.contains("Repository filter not applied"), "{out}");
}
#[tokio::test]
async fn all_true_lists_foreign_repositories_without_a_hidden_count() {
    let (_tmp, sessions) = repositories();
    let out = list_sessions(
        Some(&sessions[0]),
        &sessions,
        &[],
        ListSessionsArgs { all: true },
    )
    .await
    .unwrap();
    assert!(
        out.contains("ses_caller") && out.contains("ses_foreign"),
        "{out}"
    );
    assert!(!out.contains("more session(s)"), "{out}");
    assert!(!out.contains("Repository filter not applied"), "{out}");
}
