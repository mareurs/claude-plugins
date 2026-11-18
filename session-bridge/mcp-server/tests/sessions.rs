use session_bridge_mcp::{
    codex::CodexEndpoint,
    endpoints::{Endpoint, Roots},
    sessions::{caller_session, resolve_session, split_by_repo, Session},
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
fn cx(home: &str, id: &str) -> Session {
    Session::Codex(CodexEndpoint {
        config_dir: home.into(),
        pid: 20,
        session_id: id.into(),
        transcript_path: "/rollout".into(),
        cwd: Some("/repo".into()),
        name: Some("shared".into()),
        generation: Some("99".into()),
    })
}
fn cc(id: &str) -> Session {
    Session::Claude(Endpoint {
        profile: ".claude".into(),
        config_dir: "/home/.claude".into(),
        pid: 30,
        session_id: id.into(),
        name: Some("shared".into()),
        kind: None,
        status: None,
        launch_cwd: "/repo".into(),
        repo: None,
    })
}
#[test]
fn resolves_exact_home_and_refuses_ambiguous_names_ids_and_self() {
    let a = "11111111-1111-7111-8111-111111111111";
    let b = "22222222-2222-7222-8222-222222222222";
    let sessions = vec![cx("/left/.codex", a), cx("/right/.codex", a), cc(b)];
    assert!(resolve_session(&sessions, "shared", None).is_err());
    assert!(resolve_session(&sessions, a, None).is_err());
    assert_eq!(
        resolve_session(
            &sessions,
            "codex:/left/.codex:11111111-1111-7111-8111-111111111111",
            None
        )
        .unwrap()
        .identity(),
        sessions[0].identity()
    );
    assert!(resolve_session(&sessions, &sessions[0].key(), Some(&sessions[0].identity())).is_err());
    assert_eq!(
        resolve_session(&sessions, "main:30", None)
            .unwrap()
            .identity(),
        sessions[2].identity()
    );
    assert!(resolve_session(&sessions, "111", None).is_err());
}
#[test]
fn exact_match_wins_over_prefix_across_harnesses() {
    let sessions = vec![
        cc("abcd"),
        cx("/left/.codex", "abcd1111-1111-7111-8111-111111111111"),
    ];
    assert_eq!(
        resolve_session(&sessions, "abcd", None).unwrap().identity(),
        sessions[0].identity()
    );
}
#[test]
fn caller_uses_exact_metadata_and_profile_and_never_selects_first_thread() {
    let a = "11111111-1111-7111-8111-111111111111";
    let b = "22222222-2222-7222-8222-222222222222";
    let sessions = vec![
        cx("/left/.codex", a),
        cx("/left/.codex", b),
        cx("/right/.codex", a),
    ];
    let roots = Roots {
        proc_root: PathBuf::from("/absent-proc"),
        socks: PathBuf::from("/absent-socks"),
    };
    let env: HashMap<String, String> =
        HashMap::from([("CODEX_HOME".into(), "/left/.codex".into())]);
    let get = |k: &str| env.get(k).cloned();
    assert!(
        caller_session(&sessions, &roots, 999, &serde_json::json!({}), &get)
            .unwrap()
            .is_none()
    );
    let one = caller_session(
        &sessions,
        &roots,
        999,
        &serde_json::json!({"threadId":b}),
        &get,
    )
    .unwrap()
    .unwrap();
    assert_eq!(one.identity(), sessions[1].identity());
    assert!(caller_session(
        &sessions,
        &roots,
        999,
        &serde_json::json!({"threadId":"bad"}),
        &get
    )
    .is_err());
    assert!(caller_session(
        &sessions,
        &roots,
        999,
        &serde_json::json!({"threadId":"33333333-3333-7333-8333-333333333333"}),
        &get
    )
    .is_err());
    let wrong = |k: &str| {
        if k == "CODEX_HOME" {
            Some("/other".into())
        } else {
            None
        }
    };
    assert!(caller_session(
        &sessions,
        &roots,
        999,
        &serde_json::json!({"threadId":a}),
        &wrong
    )
    .is_err());
    assert_eq!(sessions[0].cwd(), Some(Path::new("/repo")));
}

#[test]
fn request_metadata_wins_over_inherited_thread_and_invalid_metadata_is_not_ignored() {
    let a = "11111111-1111-7111-8111-111111111111";
    let b = "22222222-2222-7222-8222-222222222222";
    let sessions = vec![cx("/left/.codex", a), cx("/left/.codex", b)];
    let roots = Roots {
        proc_root: "/absent-proc".into(),
        socks: "/absent-socks".into(),
    };
    let get = |k: &str| match k {
        "CODEX_HOME" => Some("/left/.codex".into()),
        "CODEX_THREAD_ID" => Some(a.into()),
        _ => None,
    };
    assert_eq!(
        caller_session(
            &sessions,
            &roots,
            999,
            &serde_json::json!({"threadId":b}),
            &get
        )
        .unwrap()
        .unwrap()
        .identity(),
        sessions[1].identity()
    );
    assert!(caller_session(
        &sessions,
        &roots,
        999,
        &serde_json::json!({"threadId":"bad"}),
        &get
    )
    .is_err());
    assert_eq!(
        caller_session(&sessions, &roots, 999, &serde_json::json!({}), &get)
            .unwrap()
            .unwrap()
            .identity(),
        sessions[0].identity()
    );
}

#[test]
fn native_claude_ancestor_wins_over_codex_environment_but_explicit_metadata_still_wins() {
    let d = tempfile::tempdir().unwrap();
    let home = d.path().join(".claude");
    let proc = d.path().join("proc");
    std::fs::create_dir_all(home.join("sessions")).unwrap();
    std::fs::create_dir_all(proc.join("30")).unwrap();
    std::fs::create_dir_all(proc.join("31")).unwrap();
    std::fs::write(proc.join("30/cmdline"), b"claude\0").unwrap();
    std::fs::write(
        proc.join("30/environ"),
        format!("CLAUDE_CONFIG_DIR={}\0", home.display()),
    )
    .unwrap();
    std::fs::write(proc.join("30/status"), "PPid:\t1\n").unwrap();
    std::fs::write(proc.join("31/status"), "PPid:\t30\n").unwrap();
    std::os::unix::fs::symlink(d.path(), proc.join("30/cwd")).unwrap();
    let c = "33333333-3333-7333-8333-333333333333";
    std::fs::write(
        home.join("sessions/30.json"),
        serde_json::json!({"pid":30,"sessionId":c,"cwd":d.path()}).to_string(),
    )
    .unwrap();
    let roots = Roots {
        proc_root: proc,
        socks: d.path().join("socks"),
    };
    let a = "11111111-1111-7111-8111-111111111111";
    let b = "22222222-2222-7222-8222-222222222222";
    let mut sessions = vec![cx("/left/.codex", a), cx("/left/.codex", b)];
    sessions.extend(
        session_bridge_mcp::endpoints::discover(&roots)
            .into_iter()
            .map(Session::Claude),
    );
    let get = |key: &str| match key {
        "CODEX_THREAD_ID" => Some(a.into()),
        "CODEX_HOME" => Some("/left/.codex".into()),
        _ => None,
    };
    let actual = caller_session(&sessions, &roots, 31, &serde_json::json!({}), &get)
        .unwrap()
        .unwrap();
    assert!(
        matches!(actual, Session::Claude(_)),
        "wrong caller: {}",
        actual.identity()
    );
    assert_eq!(actual.session_id(), c);
    assert_eq!(
        caller_session(
            &sessions,
            &roots,
            31,
            &serde_json::json!({"threadId":b}),
            &get
        )
        .unwrap()
        .unwrap()
        .identity(),
        sessions[1].identity()
    );
    assert!(caller_session(
        &sessions,
        &roots,
        31,
        &serde_json::json!({"threadId":"bad"}),
        &get
    )
    .is_err());
    // Reverse nesting: Codex owns the MCP child, with an outer Claude ancestor.
    std::fs::create_dir_all(roots.proc_root.join("20")).unwrap();
    std::fs::write(roots.proc_root.join("31/status"), "PPid:\t20\n").unwrap();
    std::fs::write(roots.proc_root.join("20/status"), "PPid:\t30\n").unwrap();
    assert_eq!(
        caller_session(&sessions, &roots, 31, &serde_json::json!({}), &get)
            .unwrap()
            .unwrap()
            .identity(),
        sessions[0].identity()
    );
    assert!(
        caller_session(&sessions, &roots, 31, &serde_json::json!({}), &|_| None)
            .unwrap()
            .is_none()
    );
}

#[test]
fn codex_storage_identity_is_thread_scoped_and_stable_across_host_pid_changes() {
    let a = "11111111-1111-7111-8111-111111111111";
    let mut one = cx("/left/.codex", a);
    let before = one.storage_id();
    if let Session::Codex(e) = &mut one {
        e.pid = 40;
    }
    assert_eq!(one.storage_id(), before);
    let other = cx("/left/.codex", "22222222-2222-7222-8222-222222222222");
    assert_ne!(one.storage_id(), other.storage_id());
}

fn cx_at(id: &str, cwd: Option<&str>) -> Session {
    match cx("/home/.codex", id) {
        Session::Codex(mut e) => {
            e.cwd = cwd.map(Into::into);
            Session::Codex(e)
        }
        other => other,
    }
}

/// Repo lookup stub: `/a/...` is repo `/a`, `/b/...` is repo `/b`, anything else is no repo.
fn stub_repo(p: &Path) -> Option<PathBuf> {
    ["/a", "/b"]
        .iter()
        .find(|r| p.starts_with(r))
        .map(PathBuf::from)
}

#[test]
fn split_by_repo_keeps_same_repo_and_moves_the_rest_aside() {
    let sessions = vec![
        cx_at("11111111-1111-1111-1111-111111111111", Some("/a/sub")),
        cx_at("22222222-2222-2222-2222-222222222222", Some("/b")),
        cx_at("33333333-3333-3333-3333-333333333333", Some("/a")),
    ];
    let (same, other) = split_by_repo(&sessions, Path::new("/a"), &stub_repo);
    assert_eq!(same.len(), 2);
    assert_eq!(other.len(), 1);
    assert_eq!(other[0].session_id(), "22222222-2222-2222-2222-222222222222");
}

#[test]
fn split_by_repo_treats_unknown_cwd_and_non_repo_as_elsewhere() {
    let sessions = vec![
        cx_at("11111111-1111-1111-1111-111111111111", None),
        cx_at("22222222-2222-2222-2222-222222222222", Some("/tmp/x")),
    ];
    let (same, other) = split_by_repo(&sessions, Path::new("/a"), &stub_repo);
    assert!(same.is_empty());
    assert_eq!(other.len(), 2);
}

/// Real git, no stub: a session launched in a linked worktree counts as the same repository
/// as one launched in the main work tree. A session in an unrelated repository does not.
#[test]
fn split_by_repo_counts_linked_worktrees_as_the_same_repo() {
    use session_bridge_mcp::endpoints::repo_of;
    let git = |dir: &Path, args: &[&str]| {
        let out = std::process::Command::new("git")
            .current_dir(dir)
            .args(["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"])
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "T")
            .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
            .env("GIT_COMMITTER_NAME", "T")
            .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    };
    let d = tempfile::Builder::new().prefix("sbs").tempdir_in("/tmp").unwrap();
    let main = d.path().join("main");
    let linked = d.path().join("linked");
    let other = d.path().join("other");
    for p in [&main, &other] {
        std::fs::create_dir(p).unwrap();
        git(p, &["init", "-q"]);
        git(p, &["commit", "--allow-empty", "-q", "-m", "base"]);
    }
    git(&main, &["worktree", "add", "-q", "-b", "feat", linked.to_str().unwrap()]);
    let sessions = vec![
        cx_at("11111111-1111-1111-1111-111111111111", main.to_str()),
        cx_at("22222222-2222-2222-2222-222222222222", linked.to_str()),
        cx_at("33333333-3333-3333-3333-333333333333", other.to_str()),
    ];
    let repo = repo_of(&main).unwrap();
    let (same, elsewhere) = split_by_repo(&sessions, &repo, &repo_of);
    let ids: Vec<&str> = same.iter().map(|s| s.session_id()).collect();
    assert_eq!(
        ids,
        ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
        "main and linked worktree are listed together"
    );
    assert_eq!(elsewhere.len(), 1);
    assert_eq!(elsewhere[0].session_id(), "33333333-3333-3333-3333-333333333333");
}
