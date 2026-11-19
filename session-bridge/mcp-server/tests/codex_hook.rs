use session_bridge_mcp::{
    codex::CodexEndpoint,
    codex_hook::{handle, normalize},
    endpoints::Roots,
    filter::{drain_unfiltered, transcript_tail},
    hook::{now_ms, HookInput},
    server::{post_notice_from, PostNoticeArgs},
    store::{NewNotice, Origin, Store},
};
use std::{fs, path::Path};
fn endpoint(root: &Path, sid: &str) -> CodexEndpoint {
    CodexEndpoint {
        config_dir: root.join(".codex"),
        pid: 20,
        session_id: sid.into(),
        transcript_path: root.join(format!("{sid}.jsonl")),
        cwd: Some(root.to_path_buf()),
        name: None,
        generation: Some("99".into()),
    }
}
fn input(e: &CodexEndpoint) -> HookInput {
    HookInput {
        session_id: e.session_id.clone(),
        cwd: e.cwd.as_ref().unwrap().to_string_lossy().into_owned(),
        tool_input: Some(serde_json::json!({"command":"commit"})),
        ..Default::default()
    }
}
#[test]
fn hook_normalizes_thread_id_and_refuses_conflicting_ids_and_children() {
    let a = "11111111-1111-7111-8111-111111111111";
    assert_eq!(
        normalize(&format!(r#"{{"thread_id":"{a}","cwd":"/repo"}}"#))
            .unwrap()
            .session_id,
        a
    );
    assert!(normalize(&format!(r#"{{"thread_id":"{a}","session_id":"other"}}"#)).is_none());
    assert!(normalize(&format!(r#"{{"session_id":"{a}","agent_id":"child"}}"#)).is_none());
    assert!(normalize(r#"{"thread_id":"../../bad"}"#).is_none());
}
#[test]
fn notices_reach_sibling_threads_but_never_self_even_after_host_restart() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    assert!(std::process::Command::new("git")
        .args(["init", "-q"])
        .arg(root)
        .status()
        .unwrap()
        .success());
    let state = root.join("state");
    fs::create_dir(&state).unwrap();
    let store = Store::open(&state.join("notices.db")).unwrap();
    let a = endpoint(root, "11111111-1111-7111-8111-111111111111");
    let mut b = endpoint(root, "22222222-2222-7222-8222-222222222222");
    let roots = Roots {
        proc_root: root.join("proc"),
        socks: root.join("socks"),
    };
    let ia = input(&a);
    let ib = input(&b);
    let now = now_ms();
    handle(
        "session-start",
        &ia,
        &a,
        &roots,
        &state,
        &store,
        now,
        &|_, _| None,
    );
    handle(
        "session-start",
        &ib,
        &b,
        &roots,
        &state,
        &store,
        now,
        &|_, _| None,
    );
    let post = |e: &CodexEndpoint, title: &str| {
        post_notice_from(
            &state,
            (&e.storage_profile(), 0),
            &e.session_id,
            root,
            PostNoticeArgs {
                title: title.into(),
                body: "change".into(),
                refs: vec![],
                to: None,
            },
            None,
        )
        .unwrap()
    };
    post(&a, "from A");
    post(&b, "from B");
    handle(
        "post-tool",
        &ia,
        &a,
        &roots,
        &state,
        &store,
        now + 1,
        &|_, _| None,
    );
    handle(
        "post-tool",
        &ib,
        &b,
        &roots,
        &state,
        &store,
        now + 1,
        &|_, _| None,
    );
    drain_unfiltered(&state, &a.storage_profile(), 0, "test");
    drain_unfiltered(&state, &b.storage_profile(), 0, "test");
    let got_a = handle(
        "post-tool",
        &ia,
        &a,
        &roots,
        &state,
        &store,
        now + 2,
        &|_, _| None,
    )
    .unwrap();
    let got_b = handle(
        "post-tool",
        &ib,
        &b,
        &roots,
        &state,
        &store,
        now + 2,
        &|_, _| None,
    )
    .unwrap();
    assert!(
        got_a.contains("from B") && !got_a.contains("from A"),
        "{got_a}"
    );
    assert!(
        got_b.contains("from A") && !got_b.contains("from B"),
        "{got_b}"
    );
    assert!(got_a.contains("additionalContext"));
    b.pid = 40;
    assert!(handle(
        "post-tool",
        &ib,
        &b,
        &roots,
        &state,
        &store,
        now + 3,
        &|_, _| None
    )
    .is_none());
}
#[test]
fn codex_tail_uses_response_speech_once_without_tool_or_developer_data() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("rollout.jsonl");
    let records = [
        serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"duplicate"}}),
        serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"real user"}]}}),
        serde_json::json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"real assistant"}]}}),
        serde_json::json!({"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"secret instructions"}]}}),
        serde_json::json!({"type":"response_item","payload":{"type":"function_call_output","output":"tool result"}}),
    ];
    fs::write(
        &p,
        records
            .iter()
            .map(|v| v.to_string() + "\n")
            .collect::<String>(),
    )
    .unwrap();
    let got = transcript_tail(&p, 6000).unwrap();
    assert!(
        got.contains("real user") && got.contains("real assistant"),
        "{got}"
    );
    for forbidden in ["duplicate", "secret instructions", "tool result"] {
        assert!(!got.contains(forbidden), "{got}");
    }
}
#[test]
fn a_codex_thread_receives_a_direct_notice_on_prompt() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    assert!(std::process::Command::new("git")
        .args(["init", "-q"])
        .arg(root)
        .status()
        .unwrap()
        .success());
    let state = root.join("state");
    fs::create_dir(&state).unwrap();
    let store = Store::open(&state.join("notices.db")).unwrap();
    let b = endpoint(root, "22222222-2222-7222-8222-222222222222");
    let roots = Roots {
        proc_root: root.join("proc"),
        socks: root.join("socks"),
    };
    store
        .post(NewNotice {
            at_ms: now_ms(),
            repo: "/work/elsewhere".into(),
            author_profile: ".claude-kat".into(),
            author_pid: 5,
            author_session: "AUTHORSESSION".into(),
            origin: Origin::Manual,
            patch_id: None,
            title: "direct hello".into(),
            body: "b".into(),
            refs: vec![],
            to_session: Some(b.session_id.clone()),
        })
        .unwrap();
    let out = handle(
        "prompt",
        &input(&b),
        &b,
        &roots,
        &state,
        &store,
        now_ms(),
        &|_, _| None,
    )
    .expect("delivered");
    assert!(out.contains("direct hello"), "{out}");
}
