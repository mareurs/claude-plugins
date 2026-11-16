use session_bridge_mcp::{codex::discover_codex, endpoints::Roots, send::send_codex};
use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
    path::{Path, PathBuf},
};
const A: &str = "11111111-1111-7111-8111-111111111111";
struct Fx {
    dir: tempfile::TempDir,
    roots: Roots,
    transcript: PathBuf,
}
impl Fx {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join(".codex");
        fs::create_dir(&home).unwrap();
        let proc_root = dir.path().join("proc");
        let host = proc_root.join("20");
        fs::create_dir_all(host.join("fd")).unwrap();
        fs::write(host.join("cmdline"), b"codex\0app-server\0").unwrap();
        fs::write(
            host.join("environ"),
            format!("CODEX_HOME={}\0", home.display()),
        )
        .unwrap();
        let mut fields = vec!["0"; 22];
        fields[0] = "S";
        fields[19] = "99";
        fs::write(
            host.join("stat"),
            format!("20 (codex) {}", fields.join(" ")),
        )
        .unwrap();
        let transcript = home.join(format!("rollout-2026-11-16T10-00-00-{A}.jsonl"));
        fs::write(&transcript, "").unwrap();
        symlink(&transcript, host.join("fd/3")).unwrap();
        let roots = Roots {
            proc_root,
            socks: dir.path().join("socks"),
        };
        Self {
            dir,
            roots,
            transcript,
        }
    }
    fn bin(&self, body: &str) -> PathBuf {
        let path = self.dir.path().join("fake-codex");
        fs::write(&path,format!("#!/usr/bin/env python3\nimport os,sys,json\nargs=sys.argv[1:]\nopen({:?},'a').write(json.dumps({{'args':args,'home':os.environ.get('CODEX_HOME')}})+'\\n')\n{body}\n",self.dir.path().join("calls").to_str().unwrap())).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }
}
#[tokio::test]
async fn exact_user_message_marker_is_observed_and_arguments_are_literal() {
    let f = Fx::new();
    let endpoint = discover_codex(&f.roots).remove(0);
    let bin=f.bin(&format!("text=args[args.index('--message')+1]\nopen({:?},'a').write(json.dumps({{'type':'event_msg','payload':{{'type':'user_message','message':text}}}})+'\\n')",f.transcript.to_str().unwrap()));
    let message = "quotes ' and $(touch BAD) and\nnew line";
    let got = send_codex(&bin, &endpoint, "claude:/sender", message, 1, &f.roots)
        .await
        .unwrap();
    assert_eq!(got.status, "observed");
    assert_eq!(got.target, endpoint.key());
    assert!(got.message_id.starts_with("sb-"));
    let log: serde_json::Value = serde_json::from_str(
        fs::read_to_string(f.dir.path().join("calls"))
            .unwrap()
            .trim(),
    )
    .unwrap();
    let args: Vec<String> = serde_json::from_value(log["args"].clone()).unwrap();
    assert_eq!(&args[..3], ["queue", "--thread", A]);
    assert!(!args.iter().any(|s| s == "--resume"));
    assert!(args.last().unwrap().contains(message));
    assert!(args.last().unwrap().contains(&got.message_id));
    assert!(args.last().unwrap().contains("claude:/sender"));
    assert_eq!(log["home"], endpoint.config_dir.to_str().unwrap());
    assert!(!f.dir.path().join("BAD").exists());
}
#[tokio::test]
async fn zero_exit_without_consumption_is_only_queued() {
    let f = Fx::new();
    let endpoint = discover_codex(&f.roots).remove(0);
    let bin = f.bin("print('Queued')");
    let got = send_codex(&bin, &endpoint, "sender", "hello", 1, &f.roots)
        .await
        .unwrap();
    assert_eq!(got.status, "queued");
    assert_eq!(
        fs::read_to_string(f.dir.path().join("calls"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}
#[tokio::test]
async fn unrelated_growth_and_assistant_echo_are_not_confirmation() {
    let f = Fx::new();
    let endpoint = discover_codex(&f.roots).remove(0);
    let bin=f.bin(&format!("text=args[-1]\nopen({:?},'a').write(json.dumps({{'type':'response_item','payload':{{'type':'message','role':'assistant','content':[{{'type':'output_text','text':text}}]}}}})+'\\n')",f.transcript.to_str().unwrap()));
    assert_eq!(
        send_codex(&bin, &endpoint, "sender", "hello", 1, &f.roots)
            .await
            .unwrap()
            .status,
        "queued"
    );
}

#[tokio::test]
async fn assistant_record_with_input_text_is_not_delivery_confirmation() {
    let f = Fx::new();
    let endpoint = discover_codex(&f.roots).remove(0);
    let bin = f.bin(&format!("text=args[-1]\nopen({:?},'a').write(json.dumps({{'type':'response_item','payload':{{'type':'message','role':'assistant','content':[{{'type':'input_text','text':text}}]}}}})+'\\n')", f.transcript.to_str().unwrap()));
    assert_eq!(
        send_codex(&bin, &endpoint, "sender", "hello", 1, &f.roots)
            .await
            .unwrap()
            .status,
        "queued"
    );
}

#[tokio::test]
async fn unrelated_user_messages_in_either_format_do_not_confirm_delivery() {
    for record in [
        serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"some other user message"}}),
        serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"some other user message"}]}}),
    ] {
        let f = Fx::new();
        let endpoint = discover_codex(&f.roots).remove(0);
        let line = format!("{}\n", record);
        let bin = f.bin(&format!(
            "open({:?},'a').write({:?})",
            f.transcript.to_str().unwrap(),
            line
        ));
        assert_eq!(
            send_codex(&bin, &endpoint, "sender", "hello", 1, &f.roots)
                .await
                .unwrap()
                .status,
            "queued",
            "{record}"
        );
    }
}

#[tokio::test]
async fn partial_enqueue_failure_is_unknown_and_never_retried() {
    let f = Fx::new();
    let endpoint = discover_codex(&f.roots).remove(0);
    let bin = f.bin("sys.exit(4)");
    let got = send_codex(&bin, &endpoint, "sender", "hello", 1, &f.roots)
        .await
        .unwrap();
    assert_eq!(got.status, "unknown");
    assert_eq!(
        fs::read_to_string(f.dir.path().join("calls"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}
#[tokio::test]
async fn refuses_unloaded_target_empty_message_and_relative_binary_before_spawning() {
    let f = Fx::new();
    let endpoint = discover_codex(&f.roots).remove(0);
    let bin = f.bin("");
    assert!(send_codex(&bin, &endpoint, "sender", "", 1, &f.roots)
        .await
        .is_err());
    assert!(
        send_codex(Path::new("relative"), &endpoint, "sender", "q", 1, &f.roots)
            .await
            .is_err()
    );
    fs::remove_file(f.roots.proc_root.join("20/fd/3")).unwrap();
    assert!(send_codex(&bin, &endpoint, "sender", "q", 1, &f.roots)
        .await
        .is_err());
    assert!(!f.dir.path().join("calls").exists());
}
