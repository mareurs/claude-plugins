use session_bridge_mcp::{
    codex::CodexEndpoint,
    filter::run_codex_filter,
    state::{endpoint_path, load_or_default, update},
    store::{NewNotice, Origin, Store},
};
use std::{fs, os::unix::fs::PermissionsExt, time::Duration};
#[tokio::test]
async fn codex_filter_uses_receivers_account_and_quotes_actual_codex_speech() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    let store = Store::open(&root.join("notices.db")).unwrap();
    let sid = "11111111-1111-7111-8111-111111111111";
    let transcript = root.join("rollout.jsonl");
    fs::write(&transcript,serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"working on tool.txt"}]}}).to_string()+"\n").unwrap();
    let e = CodexEndpoint {
        config_dir: root.to_path_buf(),
        pid: 20,
        session_id: sid.into(),
        transcript_path: transcript.clone(),
        cwd: Some(root.to_path_buf()),
        name: None,
        generation: Some("99".into()),
    };
    let seq = store
        .post(NewNotice {
            at_ms: chrono::Utc::now().timestamp_millis(),
            repo: root.display().to_string(),
            author_profile: ".claude".into(),
            author_pid: 30,
            author_session: "other".into(),
            origin: Origin::Manual,
            patch_id: None,
            title: "tool.txt changed".into(),
            body: "new API".into(),
            refs: vec![],
        })
        .unwrap();
    let path = endpoint_path(root, &e.storage_profile(), 0);
    update(&path, |s| {
        s.session_id = sid.into();
        s.transcript_path = Some(transcript.display().to_string());
        s.pending = vec![seq];
        s.worker_pid = Some(123);
    })
    .unwrap();
    let answer=serde_json::json!({"verdicts":[{"notice":format!("N{seq}"),"relevant":true,"evidence":"tool.txt","why":"same file"}]}).to_string();
    let bin = root.join("fake");
    fs::write(&bin,format!("#!/usr/bin/env python3\nimport sys,os,json\nassert os.environ['CODEX_HOME']=={home:?}\nassert 'CLAUDE_CONFIG_DIR' not in os.environ\nassert 'tool.txt' in sys.argv[-1]\nprint(json.dumps({{'type':'thread.started','thread_id':'22222222-2222-7222-8222-222222222222'}}))\nprint(json.dumps({{'type':'item.completed','item':{{'type':'agent_message','text':{answer:?}}}}}))\nprint(json.dumps({{'type':'turn.completed','usage':{{'input_tokens':4}}}}))\n",home=root.to_str().unwrap())).unwrap();
    fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
    run_codex_filter(&bin, root, &store, &e, Duration::from_secs(3))
        .await
        .unwrap();
    let state = load_or_default(&path);
    assert!(state.pending.is_empty());
    assert_eq!(state.worker_pid, None);
    assert!(state.verdicts[0].relevant);
    assert_eq!(state.verdicts[0].evidence, "tool.txt");
    assert_eq!(state.verdicts[0].unfiltered_reason, None);
    // The same executable fails: pending notices are still made deliverable with an explicit reason.
    update(&path, |s| s.pending.push(seq)).unwrap();
    fs::write(&bin, "#!/usr/bin/env python3\nraise SystemExit(2)\n").unwrap();
    run_codex_filter(&bin, root, &store, &e, Duration::from_secs(3))
        .await
        .unwrap();
    let state = load_or_default(&path);
    assert!(state.pending.is_empty());
    assert!(state.verdicts[0]
        .unfiltered_reason
        .as_ref()
        .unwrap()
        .contains("Codex"));
}
