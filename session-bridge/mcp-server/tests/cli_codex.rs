#[test]
fn sessions_cli_exposes_structured_discovery_without_a_model_call() {
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_session-bridge"))
        .args(["sessions", "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(value.is_array());
    for row in value.as_array().unwrap() {
        assert!(row["key"].is_string());
        assert!(row["harness"].is_string());
    }
}
