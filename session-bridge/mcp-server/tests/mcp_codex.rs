#[test]
fn codex_mcp_routing_and_caller_identity_are_observed_on_the_wire() {
    let out = std::process::Command::new("python3")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/mcp-codex.py"
        ))
        .arg(env!("CARGO_BIN_EXE_session-bridge"))
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}
