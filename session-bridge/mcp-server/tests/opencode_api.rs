use serde_json::{json, Value};
use session_bridge_mcp::opencode_api::{
    ensure_service, ensure_service_within, locate_opencode, CliApi, OcApi,
};
use std::{fs, os::unix::fs::PermissionsExt, path::Path, time::Duration};

const BODY_EVIL: &str = "x'; rm -rf / #";

/// A wrapper script that runs the fake with its state dir pinned.
fn fake(root: &Path, script: Value) -> std::path::PathBuf {
    let state = root.join("state");
    fs::create_dir_all(&state).unwrap();
    fs::write(state.join("script.json"), script.to_string()).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-opencode.py");
    let bin = root.join("opencode");
    fs::write(
        &bin,
        format!(
            "#!/bin/sh\nFAKE_OC_DIR='{}' exec python3 '{}' \"$@\"\n",
            state.display(),
            fixture.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
    bin
}
fn api(bin: &Path) -> CliApi {
    CliApi {
        bin: bin.to_path_buf(),
        timeout: Duration::from_secs(10),
    }
}
fn argv_log(root: &Path) -> Vec<Vec<String>> {
    fs::read_to_string(root.join("state/argv.log"))
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}
fn starts(root: &Path) -> usize {
    fs::read_to_string(root.join("state/starts"))
        .map(|s| s.lines().count())
        .unwrap_or(0)
}

#[tokio::test]
async fn cli_api_passes_body_as_single_argv() {
    let d = tempfile::tempdir().unwrap();
    let bin = fake(d.path(), json!({"POST /api/x": {"out": "{\"ok\":true}"}}));
    let body = json!({"text": BODY_EVIL});
    let v = api(&bin).call("POST", "/api/x", Some(&body)).await.unwrap();
    assert_eq!(v, json!({"ok": true}));
    let log = argv_log(d.path());
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].len(), 5, "api, method, path, -d, body: {:?}", log[0]);
    assert_eq!(&log[0][..4], ["api", "POST", "/api/x", "-d"]);
    let sent: Value = serde_json::from_str(&log[0][4]).unwrap();
    assert_eq!(sent, body);
}

#[tokio::test]
async fn cli_api_without_body_has_no_dash_d() {
    let d = tempfile::tempdir().unwrap();
    let bin = fake(d.path(), json!({"GET /api/y": {"out": "{\"data\":{}}"}}));
    api(&bin).call("GET", "/api/y", None).await.unwrap();
    assert_eq!(argv_log(d.path())[0], ["api", "GET", "/api/y"]);
}

#[tokio::test]
async fn cli_api_http_error_is_err() {
    let d = tempfile::tempdir().unwrap();
    // exit 0 on purpose: the HTTP-looking stdout alone must be an error.
    let bin = fake(
        d.path(),
        json!({
            "GET /api/a": {"out": "HTTP 404 Not Found", "exit": 0},
            "GET /api/b": {"out": "<html>ui</html>", "exit": 0},
            "GET /api/c": {"out": "{}", "exit": 1}
        }),
    );
    for p in ["/api/a", "/api/b", "/api/c"] {
        assert!(api(&bin).call("GET", p, None).await.is_err(), "{p}");
    }
}

fn liveness(after: Value) -> Value {
    json!({"GET /api/session/active": {"out": "HTTP 503 Service Unavailable", "exit": 1, "after_start": after}})
}

#[tokio::test]
async fn ensure_service_starts_once_then_retries() {
    let d = tempfile::tempdir().unwrap();
    let bin = fake(d.path(), liveness(json!({"out": "{\"data\":{}}"})));
    ensure_service(&api(&bin), &bin).await.unwrap();
    assert_eq!(starts(d.path()), 1);
    let probes = argv_log(d.path()).iter().filter(|a| a[0] == "api").count();
    assert_eq!(probes, 2);
}

#[tokio::test]
async fn ensure_service_does_not_start_a_running_service() {
    let d = tempfile::tempdir().unwrap();
    let bin = fake(
        d.path(),
        json!({"GET /api/session/active": {"out": "{\"data\":{}}"}}),
    );
    ensure_service(&api(&bin), &bin).await.unwrap();
    assert_eq!(starts(d.path()), 0);
}

#[tokio::test]
async fn ensure_service_never_starts_twice() {
    let d = tempfile::tempdir().unwrap();
    let bin = fake(
        d.path(),
        liveness(json!({"out": "HTTP 503 Service Unavailable", "exit": 1})),
    );
    let wait = Duration::from_millis(600);
    let r = ensure_service_within(&api(&bin), &bin, wait, Duration::from_millis(50)).await;
    assert!(r.is_err());
    assert_eq!(starts(d.path()), 1);
}
#[tokio::test]
async fn ensure_service_polls_until_the_listener_is_up() {
    let d = tempfile::tempdir().unwrap();
    let bin = fake(
        d.path(),
        liveness(json!({"out": "{\"data\":{}}", "healthy_after": 3})),
    );
    ensure_service(&api(&bin), &bin).await.unwrap();
    assert_eq!(starts(d.path()), 1);
    let probes = argv_log(d.path()).iter().filter(|a| a[0] == "api").count();
    assert_eq!(probes, 4, "1 pre-start probe + 3 after the start");
}

fn env_of(pairs: &[(&str, String)]) -> impl Fn(&str) -> Option<String> {
    let m: Vec<(String, String)> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect();
    move |k| m.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone())
}

#[test]
fn locate_rejects_relative_override() {
    let env = env_of(&[("SESSION_BRIDGE_OPENCODE_BIN", "opencode".into())]);
    let e = locate_opencode(&env).unwrap_err().to_string();
    assert!(e.contains("absolute"), "{e}");
}

#[test]
fn locate_accepts_absolute_override_and_finds_on_path() {
    let d = tempfile::tempdir().unwrap();
    let bin = fake(d.path(), json!({}));
    let env = env_of(&[("SESSION_BRIDGE_OPENCODE_BIN", bin.display().to_string())]);
    assert_eq!(locate_opencode(&env).unwrap(), bin);
    let env = env_of(&[("PATH", d.path().display().to_string())]);
    assert_eq!(locate_opencode(&env).unwrap(), bin);
}

#[test]
fn locate_missing_binary_is_err() {
    let d = tempfile::tempdir().unwrap();
    let env = env_of(&[("PATH", d.path().display().to_string())]);
    assert!(locate_opencode(&env).is_err());
}

#[test]
fn data_dir_prefers_xdg_then_home_and_canonicalizes() {
    let d = tempfile::tempdir().unwrap();
    let xdg = d.path().join("xdg/opencode");
    let home = d.path().join("home/.local/share/opencode");
    fs::create_dir_all(&xdg).unwrap();
    fs::create_dir_all(&home).unwrap();
    let link = d.path().join("link");
    std::os::unix::fs::symlink(d.path().join("xdg"), &link).unwrap();
    let env = env_of(&[
        ("XDG_DATA_HOME", link.display().to_string()),
        ("HOME", d.path().join("home").display().to_string()),
    ]);
    let got = session_bridge_mcp::opencode_api::data_dir(&env).unwrap();
    assert_eq!(got, xdg.canonicalize().unwrap());
    let env = env_of(&[("HOME", d.path().join("home").display().to_string())]);
    let got = session_bridge_mcp::opencode_api::data_dir(&env).unwrap();
    assert_eq!(got, home.canonicalize().unwrap());
    assert!(session_bridge_mcp::opencode_api::data_dir(&env_of(&[])).is_none());
}
