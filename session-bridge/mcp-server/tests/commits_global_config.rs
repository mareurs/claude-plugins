//! `trailer.separators` set in the user's GLOBAL git config. This file is its own test binary
//! (its own process) with ONE test, so it can point `GIT_CONFIG_GLOBAL` at a file of its own:
//! the production git calls inherit the process environment, and tests/commits.rs pins that
//! variable to /dev/null for all of its tests.

use globset::{Glob, GlobSetBuilder};
use session_bridge_mcp::commits::scan;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

const S: &str = "sess-S";
const T0: i64 = 1_700_000_000;

/// The fixture's own git calls never read the bad global file.
fn git(dir: &Path, hooks: &Path, args: &[&str]) -> String {
    let date = format!("{T0} +0000");
    let out = Command::new("git")
        .current_dir(dir)
        .arg("-c")
        .arg(format!("core.hooksPath={}", hooks.display()))
        .args([
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "T")
        .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
        .env("GIT_COMMITTER_NAME", "T")
        .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}

#[test]
fn a_global_trailer_separators_without_a_colon_still_finds_own_commits() {
    let d = TempDir::new().unwrap();
    let hooks = d.path().join("empty-hooks");
    let r = d.path().join("repo");
    std::fs::create_dir_all(&hooks).unwrap();
    std::fs::create_dir_all(&r).unwrap();
    let global = d.path().join("global.gitconfig");
    std::fs::write(&global, "[trailer]\n\tseparators = \" =\"\n").unwrap();
    std::env::set_var("GIT_CONFIG_GLOBAL", &global);
    std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");

    git(&r, &hooks, &["init", "-q"]);
    std::fs::write(r.join("README"), "x\n").unwrap();
    git(&r, &hooks, &["add", "-A"]);
    git(&r, &hooks, &["commit", "-q", "-m", "base"]);
    let old = git(&r, &hooks, &["rev-parse", "HEAD"]);
    std::fs::write(r.join("Cargo.toml"), "a\n").unwrap();
    git(&r, &hooks, &["add", "-A"]);
    git(
        &r,
        &hooks,
        &["commit", "-q", "-m", &format!("bump\n\nSession-Id: {S}")],
    );
    let sha = git(&r, &hooks, &["rev-parse", "HEAD"]);

    // Control: the global file really hides the trailer from a git that reads it.
    let plain = Command::new("git")
        .current_dir(&r)
        .args(["log", "-1", "--format=%(trailers:key=Session-Id,valueonly)"])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&plain.stdout).trim(),
        "",
        "the bad global value is in effect"
    );

    let mut b = GlobSetBuilder::new();
    b.add(Glob::new("Cargo.toml").unwrap());
    let (_, c) = scan(&r, Some(&old), S, &b.build().unwrap(), 0).unwrap();
    let shas: Vec<&str> = c.iter().map(|c| c.sha.as_str()).collect();
    assert_eq!(shas, vec![sha.as_str()], "the own commit is counted");
}
