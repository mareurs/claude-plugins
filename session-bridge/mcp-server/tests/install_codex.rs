#[test]
fn codex_installer_merges_idempotently_and_never_creates_absent_profiles() {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/install-codex.py");
    let d = tempfile::tempdir().unwrap();
    let profile = d.path().join("profile");
    std::fs::create_dir(&profile).unwrap();
    std::fs::write(profile.join("config.toml"),"# keep this comment\nmodel = \"unchanged\"\n[features]\nhooks = true\n[mcp_servers.other]\ncommand = \"/other\"\n").unwrap();
    let hooks = serde_json::json!({"hooks":{"PostToolUse":[{"matcher":"Keep","hooks":[{"type":"command","command":"/opt/other-plugin hook prompt --harness codex","timeout":3}]}]}});
    std::fs::write(profile.join("hooks.json"), hooks.to_string()).unwrap();
    let run = |apply: bool| {
        let mut cmd = std::process::Command::new("python3");
        cmd.arg(script).args([
            "--profile",
            profile.to_str().unwrap(),
            "--binary",
            env!("CARGO_BIN_EXE_session-bridge"),
        ]);
        if apply {
            cmd.arg("--apply");
        }
        let out = cmd.output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    };
    let before = std::fs::read(profile.join("config.toml")).unwrap();
    run(false);
    assert_eq!(before, std::fs::read(profile.join("config.toml")).unwrap());
    run(true);
    let first = std::fs::read(profile.join("config.toml")).unwrap();
    let hfirst = std::fs::read(profile.join("hooks.json")).unwrap();
    run(true);
    assert_eq!(first, std::fs::read(profile.join("config.toml")).unwrap());
    assert_eq!(hfirst, std::fs::read(profile.join("hooks.json")).unwrap());
    let text = String::from_utf8(first).unwrap();
    assert!(text.contains("# keep this comment"));
    assert!(text.contains("model = \"unchanged\""));
    assert!(text.contains("[mcp_servers.other]"));
    assert!(text.contains("[mcp_servers.session-bridge]"));
    let after: serde_json::Value = serde_json::from_slice(&hfirst).unwrap();
    assert_eq!(
        after["hooks"]["PostToolUse"][0],
        hooks["hooks"]["PostToolUse"][0]
    );
    assert_eq!(after["hooks"]["PostToolUse"].as_array().unwrap().len(), 2);
    let absent = d.path().join("absent");
    let out = std::process::Command::new("python3")
        .arg(script)
        .args([
            "--profile",
            absent.to_str().unwrap(),
            "--binary",
            env!("CARGO_BIN_EXE_session-bridge"),
            "--apply",
        ])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(!absent.exists());
    // Malformed hook state cannot leave the TOML half installed.
    std::fs::write(profile.join("config.toml"), "model = \"old\"\n").unwrap();
    std::fs::write(profile.join("hooks.json"), "{").unwrap();
    let out = std::process::Command::new("python3")
        .arg(script)
        .args([
            "--profile",
            profile.to_str().unwrap(),
            "--binary",
            env!("CARGO_BIN_EXE_session-bridge"),
            "--apply",
        ])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert_eq!(
        std::fs::read_to_string(profile.join("config.toml")).unwrap(),
        "model = \"old\"\n"
    );
}

#[test]
fn installer_rolls_config_back_if_hooks_write_fails() {
    let d = tempfile::tempdir().unwrap();
    let config = d.path().join("config.toml");
    std::fs::write(&config, "model = \"keep\"\n").unwrap();
    let probe = r#"
import runpy,sys,pathlib
module=runpy.run_path(sys.argv[1],run_name="installer_probe")
main=module["main"]
original=main.__globals__["atomic_write"]
def fail_hooks(path,content):
    if path.name=="hooks.json": raise OSError("injected hooks failure")
    original(path,content)
main.__globals__["atomic_write"]=fail_hooks
sys.argv=["installer","--profile",sys.argv[2],"--binary",sys.argv[3],"--apply"]
try: main()
except OSError: pass
else: raise AssertionError("expected write failure")
assert pathlib.Path(sys.argv[2],"config.toml").read_text()=='model = "keep"\n'
assert not pathlib.Path(sys.argv[2],"hooks.json").exists()
"#;
    let output = std::process::Command::new("python3")
        .arg("-c")
        .arg(probe)
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../scripts/install-codex.py"
        ))
        .arg(d.path())
        .arg(env!("CARGO_BIN_EXE_session-bridge"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
