use session_bridge_mcp::endpoints::{
    claude_pid_of, discover, pid_alive, registered_session, repo_of, resolve_target, Endpoint, Roots,
};
use session_bridge_mcp::error::BridgeError;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

struct Fx {
    dir: TempDir,
    listeners: Vec<UnixListener>,
}

impl Fx {
    fn new() -> Self {
        // Short path: unix socket paths are limited to 108 bytes.
        let dir = tempfile::Builder::new().prefix("sb").tempdir_in("/tmp").unwrap();
        std::fs::create_dir_all(dir.path().join("proc")).unwrap();
        std::fs::create_dir_all(dir.path().join("socks")).unwrap();
        Fx { dir, listeners: vec![] }
    }
    fn roots(&self) -> Roots {
        Roots { proc_root: self.dir.path().join("proc"), socks: self.dir.path().join("socks") }
    }
    fn config(&self, profile: &str) -> PathBuf {
        self.dir.path().join(profile)
    }
    fn proc_entry(&self, pid: u32, ppid: u32, environ: &str, cwd: &Path) {
        let p = self.dir.path().join("proc").join(pid.to_string());
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("environ"), environ).unwrap();
        std::fs::write(p.join("status"), format!("Name:\tclaude\nPid:\t{pid}\nPPid:\t{ppid}\n")).unwrap();
        std::os::unix::fs::symlink(cwd, p.join("cwd")).unwrap();
    }
    fn socket(&mut self, pid: u32) {
        let s = self.dir.path().join("socks").join(format!("{pid}.sock"));
        self.listeners.push(UnixListener::bind(s).unwrap());
    }
    fn json(&self, profile: &str, pid: u32, body: &str) {
        let d = self.config(profile).join("sessions");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(format!("{pid}.json")), body).unwrap();
    }
    /// A full live Claude Code process: proc entry, socket, registry json.
    fn live(&mut self, profile: &str, pid: u32, sid: &str, name: Option<&str>) {
        let cfg = self.config(profile);
        self.proc_entry(pid, 1, &format!("A=b\0CLAUDE_CONFIG_DIR={}\0Z=y\0", cfg.display()), Path::new("/tmp"));
        self.socket(pid);
        let name = name.map(|n| format!(r#""name":"{n}","#)).unwrap_or_default();
        self.json(
            profile,
            pid,
            &format!(
                r#"{{"pid":{pid},"sessionId":"{sid}","cwd":"/tmp","kind":"interactive","status":"idle",{name}"messagingSocketPath":"x","extra":1}}"#
            ),
        );
    }
}

const ID: &str = "abcd1234-0000-0000-0000-000000000001";

#[test]
fn discover_reads_profile_session_and_cwd() {
    let mut fx = Fx::new();
    let cfg = fx.config(".claude-stef");
    fx.proc_entry(100, 1, &format!("CLAUDE_CONFIG_DIR={}\0", cfg.display()), Path::new("/var"));
    fx.socket(100);
    fx.json(
        ".claude-stef",
        100,
        &format!(r#"{{"pid":100,"sessionId":"{ID}","cwd":"/elsewhere","kind":"interactive","status":"busy","name":"wk"}}"#),
    );
    let eps = discover(&fx.roots());
    assert_eq!(eps.len(), 1);
    let e = &eps[0];
    assert_eq!(e.profile, ".claude-stef");
    assert_eq!(e.config_dir, cfg);
    assert_eq!(e.pid, 100);
    assert_eq!(e.session_id, ID);
    assert_eq!(e.kind.as_deref(), Some("interactive"));
    assert_eq!(e.status.as_deref(), Some("busy"));
    assert_eq!(e.name.as_deref(), Some("wk"));
    assert_eq!(e.launch_cwd, PathBuf::from("/var"));
    assert_eq!(e.key(), "stef:100");
}

#[test]
fn discover_defaults_to_home_dot_claude_without_config_env() {
    let mut fx = Fx::new();
    let home = fx.dir.path().join("home");
    fx.proc_entry(100, 1, &format!("HOME={}\0", home.display()), Path::new("/tmp"));
    fx.socket(100);
    let d = home.join(".claude/sessions");
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("100.json"), format!(r#"{{"pid":100,"sessionId":"{ID}","cwd":"/tmp"}}"#)).unwrap();
    let eps = discover(&fx.roots());
    assert_eq!(eps.len(), 1);
    assert_eq!(eps[0].profile, ".claude");
    assert_eq!(eps[0].config_dir, home.join(".claude"));
    assert_eq!(eps[0].name, None);
    assert_eq!(eps[0].kind, None);
    assert_eq!(eps[0].status, None);
    assert_eq!(eps[0].key(), "main:100");
}

#[test]
fn discover_skips_a_socket_without_a_live_proc_entry() {
    let mut fx = Fx::new();
    fx.socket(999);
    assert!(discover(&fx.roots()).is_empty());
}

#[test]
fn discover_skips_unreadable_environ_and_bad_json() {
    let mut fx = Fx::new();
    // pid 100: environ is a directory (unreadable as a file); pid 200: malformed json; pid 300: json missing.
    let cfg = fx.config(".claude-kat");
    fx.proc_entry(100, 1, "", Path::new("/tmp"));
    std::fs::remove_file(fx.dir.path().join("proc/100/environ")).unwrap();
    std::fs::create_dir(fx.dir.path().join("proc/100/environ")).unwrap();
    fx.socket(100);
    fx.proc_entry(200, 1, &format!("CLAUDE_CONFIG_DIR={}\0", cfg.display()), Path::new("/tmp"));
    fx.socket(200);
    fx.json(".claude-kat", 200, "{not json");
    fx.proc_entry(300, 1, &format!("CLAUDE_CONFIG_DIR={}\0", cfg.display()), Path::new("/tmp"));
    fx.socket(300);
    assert!(discover(&fx.roots()).is_empty());
}

#[test]
fn discover_ignores_key_files_next_to_the_json() {
    let mut fx = Fx::new();
    fx.live(".claude-stef", 100, ID, None);
    let junk = format!("100.{}.key", "ab".repeat(32));
    std::fs::write(fx.config(".claude-stef").join("sessions").join(junk), "not json").unwrap();
    assert_eq!(discover(&fx.roots()).len(), 1);
}

#[test]
fn discover_lists_twins_as_two_endpoints() {
    let mut fx = Fx::new();
    fx.live(".claude-stef", 100, ID, None);
    fx.live(".claude-kat", 200, ID, None);
    let mut keys: Vec<String> = discover(&fx.roots()).iter().map(Endpoint::key).collect();
    keys.sort();
    assert_eq!(keys, vec!["kat:200", "stef:100"]);
}

fn twins() -> (Fx, Vec<Endpoint>) {
    let mut fx = Fx::new();
    fx.live(".claude-stef", 100, ID, Some("alpha"));
    fx.live(".claude-kat", 200, ID, None);
    let mut eps = discover(&fx.roots());
    eps.sort_by_key(|e| e.pid);
    (fx, eps)
}

#[test]
fn resolve_refuses_an_ambiguous_twin_with_candidates() {
    let (_fx, eps) = twins();
    match resolve_target(&eps, ID, ("x", 1)) {
        Err(BridgeError::AmbiguousTarget { candidates, .. }) => {
            let all = candidates.join("\n");
            assert!(all.contains("stef:100") && all.contains("kat:200"), "{all}");
        }
        other => panic!("expected AmbiguousTarget, got {other:?}"),
    }
    let e = resolve_target(&eps, &format!("stef:{}", &ID[..8]), ("x", 1)).unwrap();
    assert_eq!(e.key(), "stef:100");
    let e = resolve_target(&eps, "kat:abcd", ("x", 1)).unwrap();
    assert_eq!(e.key(), "kat:200");
    // full profile form and registry name
    assert_eq!(resolve_target(&eps, &format!(".claude-stef:{ID}"), ("x", 1)).unwrap().pid, 100);
    assert_eq!(resolve_target(&eps, "alpha", ("x", 1)).unwrap().pid, 100);
    assert_eq!(resolve_target(&eps, "stef:alpha", ("x", 1)).unwrap().pid, 100);
    // rendered key form
    assert_eq!(resolve_target(&eps, "kat:200", ("x", 1)).unwrap().pid, 200);
}

#[test]
fn resolve_short_prefix_never_matches_by_prefix() {
    let (_fx, eps) = twins();
    assert!(matches!(resolve_target(&eps, "stef:abc", ("x", 1)), Err(BridgeError::TargetNotFound { .. })));
    assert!(matches!(resolve_target(&eps, "abc", ("x", 1)), Err(BridgeError::TargetNotFound { .. })));
}

#[test]
fn resolve_not_found_lists_candidates() {
    let (_fx, eps) = twins();
    match resolve_target(&eps, "zzzz", ("x", 1)) {
        Err(BridgeError::TargetNotFound { candidates, .. }) => assert_eq!(candidates.len(), 2),
        other => panic!("expected TargetNotFound, got {other:?}"),
    }
}

#[test]
fn resolve_refuses_a_twin_when_the_caller_is_one_of_them() {
    let (_fx, eps) = twins();
    match resolve_target(&eps, ID, (".claude-stef", 100)) {
        Err(BridgeError::AmbiguousTarget { candidates, .. }) => {
            let all = candidates.join("\n");
            assert!(all.contains("stef:100") && all.contains("kat:200"), "{all}");
        }
        other => panic!("expected AmbiguousTarget, got {other:?}"),
    }
}

#[test]
fn resolve_main_prefix_is_ambiguous_when_the_caller_is_a_match() {
    let mut fx = Fx::new();
    fx.live(".claude", 100, ID, None);
    fx.live(".claude-main", 200, ID, None);
    let eps = discover(&fx.roots());
    match resolve_target(&eps, &format!("main:{}", &ID[..8]), (".claude", 100)) {
        Err(BridgeError::AmbiguousTarget { candidates, .. }) => {
            let all = candidates.join("\n");
            assert!(all.contains("main:100") && all.contains("main:200"), "{all}");
        }
        other => panic!("expected AmbiguousTarget, got {other:?}"),
    }
}


#[test]
fn resolve_refuses_self() {
    let mut fx = Fx::new();
    fx.live(".claude-stef", 100, ID, None);
    let eps = discover(&fx.roots());
    assert!(matches!(resolve_target(&eps, ID, (".claude-stef", 100)), Err(BridgeError::TargetIsSelf)));
}

#[test]
fn resolve_main_prefix_is_ambiguous_across_dot_claude_and_dot_claude_main() {
    let mut fx = Fx::new();
    fx.live(".claude", 100, ID, None);
    fx.live(".claude-main", 200, ID, None);
    let eps = discover(&fx.roots());
    match resolve_target(&eps, &format!("main:{}", &ID[..8]), ("x", 1)) {
        Err(BridgeError::AmbiguousTarget { candidates, .. }) => assert_eq!(candidates.len(), 2),
        other => panic!("expected AmbiguousTarget, got {other:?}"),
    }
    // the full profile form is exact
    assert_eq!(resolve_target(&eps, &format!(".claude:{ID}"), ("x", 1)).unwrap().pid, 100);
}

#[test]
fn claude_pid_of_walks_to_the_socket_holder() {
    let mut fx = Fx::new();
    fx.proc_entry(100, 1, "", Path::new("/tmp"));
    fx.proc_entry(200, 100, "", Path::new("/tmp"));
    fx.proc_entry(300, 200, "", Path::new("/tmp"));
    assert_eq!(claude_pid_of(&fx.roots(), 300), None);
    fx.socket(100);
    assert_eq!(claude_pid_of(&fx.roots(), 300), Some(100));
    assert_eq!(claude_pid_of(&fx.roots(), 100), Some(100));
}

#[test]
fn claude_pid_of_survives_a_ppid_cycle() {
    let fx = Fx::new();
    fx.proc_entry(10, 20, "", Path::new("/tmp"));
    fx.proc_entry(20, 10, "", Path::new("/tmp"));
    assert_eq!(claude_pid_of(&fx.roots(), 10), None);
}

#[test]
fn repo_of_returns_the_work_tree_root_or_none() {
    let d = tempfile::Builder::new().prefix("sbr").tempdir_in("/tmp").unwrap();
    assert_eq!(repo_of(d.path()), None);
    let ok = std::process::Command::new("git").arg("-C").arg(d.path()).args(["init", "-q"]).status().unwrap();
    assert!(ok.success());
    std::fs::create_dir(d.path().join("sub")).unwrap();
    let got = repo_of(&d.path().join("sub")).unwrap();
    assert_eq!(got.canonicalize().unwrap(), d.path().canonicalize().unwrap());
    assert_eq!(repo_of(Path::new("/definitely/not/here")), None);
}
#[test]
fn repo_of_a_linked_worktree_is_the_main_worktree() {
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
    let d = tempfile::Builder::new().prefix("sbw").tempdir_in("/tmp").unwrap();
    let main = d.path().join("main");
    let linked = d.path().join("linked");
    std::fs::create_dir(&main).unwrap();
    git(&main, &["init", "-q"]);
    git(&main, &["commit", "--allow-empty", "-q", "-m", "base"]);
    git(&main, &["worktree", "add", "-q", "-b", "feat", linked.to_str().unwrap()]);
    std::fs::create_dir(linked.join("sub")).unwrap();
    let m = repo_of(&main).unwrap();
    assert_eq!(m.canonicalize().unwrap(), main.canonicalize().unwrap());
    assert_eq!(repo_of(&linked).unwrap(), m, "a linked worktree has the main worktree's key");
    assert_eq!(repo_of(&linked.join("sub")).unwrap(), m, "a directory inside it too");
}

#[test]
fn registered_session_reads_the_session_id() {
    let fx = Fx::new();
    fx.json(".claude", 5, r#"{"pid":5,"sessionId":"SID","extra":1}"#);
    assert_eq!(registered_session(&fx.config(".claude"), 5).as_deref(), Some("SID"));
    // pid field absent is accepted
    fx.json(".claude", 6, r#"{"sessionId":"NOPID"}"#);
    assert_eq!(registered_session(&fx.config(".claude"), 6).as_deref(), Some("NOPID"));
}

#[test]
fn registered_session_is_none_when_absent_malformed_or_for_another_pid() {
    let fx = Fx::new();
    assert_eq!(registered_session(&fx.config(".claude"), 5), None); // no file
    fx.json(".claude", 5, r#"{"pid":6,"sessionId":"SID"}"#); // json says another pid
    assert_eq!(registered_session(&fx.config(".claude"), 5), None);
    fx.json(".claude", 7, "{not json");
    assert_eq!(registered_session(&fx.config(".claude"), 7), None);
    fx.json(".claude", 8, r#"{"pid":8}"#); // no sessionId
    assert_eq!(registered_session(&fx.config(".claude"), 8), None);
}

#[test]
fn pid_alive_is_true_for_a_proc_dir_only() {
    let fx = Fx::new();
    fx.proc_entry(12, 1, "A=b\0", Path::new("/tmp"));
    assert!(pid_alive(&fx.roots(), 12));
    assert!(!pid_alive(&fx.roots(), 13));
    // a plain file named like a pid is not a process
    std::fs::write(fx.dir.path().join("proc").join("14"), "").unwrap();
    assert!(!pid_alive(&fx.roots(), 14));
}
