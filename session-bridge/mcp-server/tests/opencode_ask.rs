//! `ask_session` into OpenCode: fork the target, switch the fork to the read-only
//! `session-bridge-reader` agent, prompt the fork, wait, read its answer, remove it.
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use session_bridge_mcp::{
    endpoints::Roots,
    opencode::OpenCodeEndpoint,
    opencode_api::OcApi,
    opencode_ask::{ask_opencode, MISSING_READER},
    sessions::Session,
    tools::{ask_session, AskArgs},
};
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

const FORK: &str = "ses_fork";
const SECS: Duration = Duration::from_secs(5);
/// (method, path, body)
type Call = (String, String, Option<Value>);

/// Scripted service. The message list is built around the prompt id the bridge sent:
/// `assistants` (newest first) are newer than it, `older` are the source's copied history.
#[derive(Clone)]
struct FakeApi {
    fork: Result<Value, String>,
    agent: Result<Value, String>,
    info_agent: &'static str,
    info_null: bool,
    prompt: Result<Value, String>,
    hang_wait: bool,
    assistants: Vec<Value>,
    older: Vec<Value>,
    calls: Arc<Mutex<Vec<Call>>>,
}
impl FakeApi {
    fn new() -> Self {
        Self {
            fork: Ok(json!({"data": {"id": FORK, "title": "t (fork #1)",
                "fork": {"sessionID": "ses_a", "boundary": {"type": "through", "messageID": "msg_old"}}}})),
            agent: Ok(Value::Null),
            info_agent: "session-bridge-reader",
            info_null: false,
            prompt: Ok(json!({"data": {"id": "msg_x"}})),
            hang_wait: false,
            assistants: vec![assistant("the answer", Some(0.25))],
            older: vec![assistant("an old source answer", Some(9.0))],
            calls: Arc::new(Mutex::new(vec![])),
        }
    }
    fn calls(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|c| format!("{} {}", c.0, c.1))
            .collect()
    }
    fn body_of(&self, call: &str) -> Option<Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .find(|c| format!("{} {}", c.0, c.1) == call)
            .and_then(|c| c.2.clone())
    }
    fn has(&self, call: &str) -> bool {
        self.calls().iter().any(|c| c == call)
    }
    fn pos(&self, call: &str) -> usize {
        self.calls()
            .iter()
            .position(|c| c == call)
            .unwrap_or_else(|| panic!("{call} not called: {:?}", self.calls()))
    }
    fn prompt_id(&self) -> Option<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .find(|c| c.1.ends_with("/prompt"))
            .and_then(|c| c.2.as_ref()?["id"].as_str().map(str::to_owned))
    }
}
impl OcApi for FakeApi {
    fn call(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> impl std::future::Future<Output = Result<Value>> + Send {
        self.calls
            .lock()
            .unwrap()
            .push((method.into(), path.into(), body.cloned()));
        let mut hang = false;
        let r: Result<Value, String> = match (method, path) {
            ("POST", p) if p.ends_with("/fork") => self.fork.clone(),
            ("POST", p) if p.ends_with("/agent") => self.agent.clone(),
            ("POST", p) if p.ends_with("/prompt") => self.prompt.clone(),
            ("POST", p) if p.ends_with("/wait") => {
                hang = self.hang_wait;
                Ok(Value::Null)
            }
            ("GET", p) if p.contains("/message") => {
                let mut all = self.assistants.clone();
                if let Some(id) = self.prompt_id() {
                    all.push(json!({"id": id, "type": "user", "text": "q"}));
                }
                all.extend(self.older.clone());
                // Pages like the service: `limit` rows from the first page or the offset
                // carried in `cursor` (`c<offset>`), `cursor.next` while rows remain.
                let query = p.split_once('?').map_or("", |q| q.1);
                let (mut limit, mut from) = (all.len(), 0);
                for kv in query.split('&').filter(|s| !s.is_empty()) {
                    match kv.split_once('=') {
                        Some(("limit", v)) => limit = v.parse().unwrap(),
                        Some(("cursor", v)) => from = v[1..].parse().unwrap(),
                        Some(("order", "desc")) => {}
                        _ => panic!("unexpected query {kv}"),
                    }
                }
                let to = (from + limit).min(all.len());
                let next = (to < all.len()).then(|| format!("c{to}"));
                Ok(json!({"data": all[from..to], "cursor": {"previous": null, "next": next}}))
            }
            ("GET", p) if p == format!("/api/session/{FORK}") && self.info_null => Ok(Value::Null),
            ("GET", p) if p == format!("/api/session/{FORK}") => {
                Ok(json!({"data": {"id": FORK, "agent": self.info_agent}}))
            }
            ("POST", p) if p.ends_with("/model") || p.ends_with("/interrupt") => Ok(Value::Null),
            ("DELETE", _) => Ok(Value::Null),
            ("PATCH", p) if p == format!("/api/session/{FORK}") => Ok(Value::Null),
            _ => Err(format!("unexpected call {method} {path}")),
        };
        async move {
            if hang {
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
            r.map_err(|e| anyhow!(e))
        }
    }
}

fn assistant(text: &str, cost: Option<f64>) -> Value {
    let mut m = json!({
        "id": format!("msg_a{}", text.len()),
        "type": "assistant",
        "agent": "session-bridge-reader",
        "content": [{"type": "reasoning", "text": "hmm"}, {"type": "text", "text": text}],
        "tokens": {"input": 10, "output": 2, "reasoning": 1, "cache": {"read": 4, "write": 0}},
        "finish": "stop",
    });
    if let Some(c) = cost {
        m["cost"] = json!(c);
    }
    m
}

fn ep() -> OpenCodeEndpoint {
    OpenCodeEndpoint {
        data_dir: "/d".into(),
        session_id: "ses_a".into(),
        title: Some("t".into()),
        directory: Some("/repo".into()),
        running: true,
        last_active_ms: 0,
    }
}

#[derive(Clone, Default)]
struct DelayedForkApi {
    allocated: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
    delete_entered: Arc<tokio::sync::Notify>,
    release_delete: Arc<tokio::sync::Notify>,
    removed: Arc<tokio::sync::Notify>,
}
impl OcApi for DelayedForkApi {
    async fn call(&self, method: &str, path: &str, _body: Option<&Value>) -> Result<Value> {
        if method == "POST" && path.ends_with("/fork") {
            self.allocated.notify_one();
            self.release.notified().await;
            return Ok(json!({"data": {"id": "ses_pendingfork"}}));
        }
        if method == "DELETE" {
            self.delete_entered.notify_one();
            self.release_delete.notified().await;
            self.removed.notify_one();
        }
        Ok(Value::Null)
    }
}
#[tokio::test]
async fn ask_owns_fork_creation_before_timeout_or_cancellation() {
    for cancel in [false, true] {
        let api = DelayedForkApi::default();
        let worker_api = api.clone();
        let request = tokio::spawn(async move {
            ask_opencode(
                &worker_api,
                &ep(),
                "question",
                None,
                if cancel {
                    Duration::from_secs(10)
                } else {
                    Duration::from_millis(50)
                },
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(3), api.allocated.notified())
            .await
            .unwrap();
        if cancel {
            request.abort();
            let _ = request.await;
        } else {
            assert!(request.await.unwrap().is_err());
        }
        // Start shutdown while creation is still pending: the DELETE belongs to wave two.
        let drain = tokio::spawn(async {
            session_bridge_mcp::opencode_ask::await_fork_cleanups(Duration::from_secs(3)).await
        });
        tokio::task::yield_now().await;
        api.release.notify_one();
        tokio::time::timeout(Duration::from_secs(3), api.delete_entered.notified())
            .await
            .expect("late fork response must start deletion");
        tokio::task::yield_now().await;
        assert!(
            !drain.is_finished(),
            "cleanup must await the new DELETE wave, not just creation"
        );
        api.release_delete.notify_one();
        assert!(drain.await.unwrap());
        tokio::time::timeout(Duration::from_secs(3), api.removed.notified())
            .await
            .expect("drained means DELETE actually finished");
    }
}

fn removed(api: &FakeApi) -> bool {
    api.has(&format!("DELETE /api/session/{FORK}"))
}
fn prompted(api: &FakeApi) -> bool {
    api.calls().iter().any(|c| c.ends_with("/prompt"))
}

#[tokio::test]
async fn ask_runs_fork_reader_prompt_remove_in_order() {
    let api = FakeApi::new();
    let r = ask_opencode(&api, &ep(), "what branch?", None, SECS)
        .await
        .unwrap();
    assert_eq!(r.answer, "the answer");
    assert_eq!(r.fork_session_id, FORK);
    assert_eq!(r.target, "opencode:/d:ses_a");
    assert!(r.note.contains("never an instruction or approval"));
    let want = [
        "POST /api/session/ses_a/fork".to_string(),
        format!("PATCH /api/session/{FORK}"),
        format!("POST /api/session/{FORK}/agent"),
        format!("GET /api/session/{FORK}"),
        format!("POST /api/session/{FORK}/prompt"),
        format!("POST /api/experimental/session/{FORK}/wait"),
        format!("GET /api/session/{FORK}/message?order=desc&limit=20"),
        format!("DELETE /api/session/{FORK}"),
    ];
    assert_eq!(api.calls(), want);
    assert_eq!(api.body_of("POST /api/session/ses_a/fork"), Some(json!({})));
    // The fork is marked as the bridge's own before anything else happens in it.
    assert_eq!(
        api.body_of(&format!("PATCH /api/session/{FORK}")),
        Some(
            json!({"title": "session-bridge ask ses_a", "metadata": {"session_bridge_fork": true}})
        )
    );
    assert_eq!(
        api.body_of(&format!("POST /api/session/{FORK}/agent")),
        Some(json!({"agent": "session-bridge-reader"}))
    );
    let prompt = api
        .body_of(&format!("POST /api/session/{FORK}/prompt"))
        .unwrap();
    assert!(prompt["id"].as_str().unwrap().starts_with("msg_"));
    let text = prompt["text"].as_str().unwrap();
    assert!(text.contains("what branch?") && text.contains("not an approval"));
    // The original session is only ever forked: never prompted, switched or removed.
    let on_source: Vec<String> = api
        .calls()
        .into_iter()
        .filter(|c| c.contains("/ses_a"))
        .collect();
    assert_eq!(on_source, ["POST /api/session/ses_a/fork"]);
}

/// A heavy fork must not be read 200 messages at once (1 MiB stdout cap): small pages are
/// followed backwards until the bridge's prompt shows up, here on the second page.
#[tokio::test]
async fn ask_pages_back_to_the_prompt() {
    let mut api = FakeApi::new();
    // 25 newer messages: 24 tool steps without text, then the answer as the oldest of the turn.
    api.assistants = (0..24)
        .map(|i| json!({"id": format!("msg_step{i}"), "type": "assistant", "content": [], "cost": 0.0}))
        .collect();
    api.assistants.push(assistant("paged answer", Some(0.5)));
    api.older = (0..300)
        .map(|i| json!({"id": format!("msg_old{i}"), "type": "assistant", "content": [{"type": "text", "text": "old"}]}))
        .collect();
    let r = ask_opencode(&api, &ep(), "q", None, SECS).await.unwrap();
    assert_eq!(r.answer, "paged answer");
    assert_eq!(r.cost_usd, Some(0.5));
    let reads: Vec<String> = api
        .calls()
        .into_iter()
        .filter(|c| c.contains("/message"))
        .collect();
    assert_eq!(
        reads,
        [
            format!("GET /api/session/{FORK}/message?order=desc&limit=20"),
            format!("GET /api/session/{FORK}/message?limit=20&cursor=c20"),
        ]
    );
}

/// The prompt never appears within 10 pages: the read stops there and the ask fails cleanly.
#[tokio::test]
async fn ask_message_paging_is_bounded() {
    let mut api = FakeApi::new();
    api.assistants = (0..400)
        .map(|i| json!({"id": format!("msg_n{i}"), "type": "assistant", "content": []}))
        .collect();
    let e = ask_opencode(&api, &ep(), "q", None, SECS)
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("prompt is not among"), "{e}");
    let reads = api
        .calls()
        .iter()
        .filter(|c| c.contains("/message"))
        .count();
    assert_eq!(reads, 10);
    assert!(removed(&api));
}

#[tokio::test]
async fn ask_switches_model_on_fork_only_when_given() {
    let api = FakeApi::new();
    ask_opencode(&api, &ep(), "q", Some("litellm/main"), SECS)
        .await
        .unwrap();
    let model = format!("POST /api/session/{FORK}/model");
    assert_eq!(
        api.body_of(&model),
        Some(json!({"model": {"providerID": "litellm", "id": "main"}}))
    );
    assert!(api.pos(&format!("POST /api/session/{FORK}/agent")) < api.pos(&model));
    assert!(api.pos(&model) < api.pos(&format!("POST /api/session/{FORK}/prompt")));
    // a model that is not <provider>/<model> is refused before anything is forked
    let api = FakeApi::new();
    assert!(ask_opencode(&api, &ep(), "q", Some("main"), SECS)
        .await
        .is_err());
    assert!(api.calls().is_empty());
}

#[tokio::test]
async fn ask_removes_fork_on_timeout() {
    let mut api = FakeApi::new();
    api.hang_wait = true;
    let t0 = std::time::Instant::now();
    let e = ask_opencode(&api, &ep(), "q", None, Duration::from_millis(300))
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("timed out"), "{e}");
    assert!(t0.elapsed() < Duration::from_secs(5));
    assert!(api.has(&format!("POST /api/session/{FORK}/interrupt")));
    assert!(removed(&api), "{:?}", api.calls());
    assert!(
        api.pos(&format!("POST /api/session/{FORK}/interrupt"))
            < api.pos(&format!("DELETE /api/session/{FORK}"))
    );
}

/// The MCP server drops a cancelled request's future mid-`wait`: the fork is still
/// interrupted and removed, by a task spawned from the guard's `Drop`.
#[tokio::test]
async fn ask_removes_fork_when_cancelled() {
    let mut api = FakeApi::new();
    api.hang_wait = true;
    let target = ep();
    let ask = ask_opencode(&api, &target, "q", None, Duration::from_secs(60));
    assert!(tokio::time::timeout(Duration::from_millis(200), ask)
        .await
        .is_err());
    for _ in 0..50 {
        if removed(&api) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(removed(&api), "{:?}", api.calls());
    assert!(
        api.pos(&format!("POST /api/session/{FORK}/interrupt"))
            < api.pos(&format!("DELETE /api/session/{FORK}"))
    );
    // a finished ask leaves nothing behind for the guard: exactly one DELETE
    let api = FakeApi::new();
    ask_opencode(&api, &ep(), "q", None, SECS).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let deletes = api
        .calls()
        .iter()
        .filter(|c| c.starts_with("DELETE"))
        .count();
    assert_eq!(deletes, 1, "{:?}", api.calls());
}

#[tokio::test]
async fn ask_rejects_an_empty_fork_reply() {
    let mut api = FakeApi::new();
    api.fork = Ok(Value::Null);
    let e = ask_opencode(&api, &ep(), "q", None, SECS)
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("empty reply"), "{e}");
    assert_eq!(api.calls(), ["POST /api/session/ses_a/fork"]);
}

#[tokio::test]
async fn ask_removes_fork_on_error() {
    // the prompt fails
    let mut api = FakeApi::new();
    api.prompt = Err("HTTP 503".into());
    assert!(ask_opencode(&api, &ep(), "q", None, SECS).await.is_err());
    assert!(removed(&api));
    // the fork answered nothing
    let mut api = FakeApi::new();
    api.assistants = vec![];
    let e = ask_opencode(&api, &ep(), "q", None, SECS)
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("no answer"), "{e}");
    assert!(removed(&api));
    // the fork's last turn failed
    let mut api = FakeApi::new();
    let mut failed = assistant("partial", None);
    failed["error"] = json!({"message": "provider down"});
    api.assistants = vec![failed];
    let e = ask_opencode(&api, &ep(), "q", None, SECS)
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("provider down"), "{e}");
    assert!(removed(&api));
}

#[tokio::test]
async fn ask_missing_reader_agent_is_explicit() {
    let mut api = FakeApi::new();
    api.agent = Err("HTTP 400 AgentNotFoundError".into());
    let e = ask_opencode(&api, &ep(), "q", None, SECS)
        .await
        .unwrap_err();
    assert_eq!(
        e.to_string(),
        "OpenCode ask needs the session-bridge OpenCode plugin (agent session-bridge-reader)"
    );
    assert_eq!(e.to_string(), MISSING_READER);
    assert!(removed(&api));
}

/// R4: the reader agent is switched in and confirmed before any prompt; without it, no
/// prompt ever reaches the fork and the fork is removed.
#[tokio::test]
async fn ask_never_prompts_fork_without_reader_agent() {
    let refused = || {
        let mut a = FakeApi::new();
        a.agent = Err("HTTP 404".into());
        a
    };
    let ignored = || {
        let mut a = FakeApi::new();
        a.info_agent = "build";
        a
    };
    let other = || {
        let mut a = FakeApi::new();
        a.agent = Ok(json!({"data": {"id": FORK, "agent": "build"}}));
        a
    };
    let null_info = || {
        let mut a = FakeApi::new();
        a.info_null = true;
        a
    };
    for api in [refused(), ignored(), other(), null_info()] {
        let e = ask_opencode(&api, &ep(), "q", None, SECS)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("session-bridge-reader"), "{e}");
        assert!(!prompted(&api), "{:?}", api.calls());
        assert!(!api.calls().iter().any(|c| c.ends_with("/wait")));
        assert!(removed(&api));
    }
    // and on success the switch precedes the prompt
    let api = FakeApi::new();
    ask_opencode(&api, &ep(), "q", None, SECS).await.unwrap();
    assert!(
        api.pos(&format!("GET /api/session/{FORK}"))
            < api.pos(&format!("POST /api/session/{FORK}/prompt"))
    );
}

#[tokio::test]
async fn ask_refuses_a_fork_that_is_the_source() {
    let mut api = FakeApi::new();
    api.fork = Ok(json!({"data": {"id": "ses_a"}}));
    assert!(ask_opencode(&api, &ep(), "q", None, SECS).await.is_err());
    // never prompt, never remove the original
    assert_eq!(api.calls(), ["POST /api/session/ses_a/fork"]);
}

#[tokio::test]
async fn ask_cost_null_when_absent() {
    let mut api = FakeApi::new();
    api.assistants = vec![assistant("a", None), assistant("tool step", None)];
    let r = ask_opencode(&api, &ep(), "q", None, SECS).await.unwrap();
    assert_eq!(r.cost_usd, None);
    assert_eq!(serde_json::to_value(&r).unwrap()["cost_usd"], Value::Null);
    // one step without a cost makes the total unknown
    let mut api = FakeApi::new();
    api.assistants = vec![assistant("a", Some(0.5)), assistant("tool step", None)];
    let r = ask_opencode(&api, &ep(), "q", None, SECS).await.unwrap();
    assert_eq!(r.cost_usd, None);
    // reported costs of this ask's own steps are summed; the source's history is not
    let mut api = FakeApi::new();
    api.assistants = vec![
        assistant("a", Some(0.5)),
        assistant("tool step", Some(0.25)),
    ];
    let r = ask_opencode(&api, &ep(), "q", None, SECS).await.unwrap();
    assert_eq!(r.cost_usd, Some(0.75));
    assert_eq!(
        r.usage,
        Some(json!({"input": 20, "output": 4, "reasoning": 2, "cache": {"read": 8, "write": 0}}))
    );
}

#[tokio::test]
async fn ask_bounds_the_answer() {
    let mut api = FakeApi::new();
    api.assistants = vec![assistant(&"x".repeat(100_000), None)];
    let r = ask_opencode(&api, &ep(), "q", None, SECS).await.unwrap();
    assert!(r.answer.chars().count() < 70_000);
    assert!(r.answer.ends_with("[answer truncated by session-bridge]"));
    let api = FakeApi::new();
    for q in ["", " \n", &"x".repeat(16001), "a\0b"] {
        assert!(ask_opencode(&api, &ep(), q, None, SECS).await.is_err());
    }
    assert!(api.calls().is_empty());
}

fn oc(id: &str) -> Session {
    Session::OpenCode(OpenCodeEndpoint {
        session_id: id.into(),
        ..ep()
    })
}
fn fake_bin(root: &Path, script: Value) -> std::path::PathBuf {
    let state = root.join("state");
    fs::create_dir_all(&state).unwrap();
    fs::write(state.join("script.json"), script.to_string()).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-opencode.py");
    // Symlink to the committed fixture (no ETXTBSY race); state dir is `state/` beside it.
    let bin = root.join("opencode");
    std::os::unix::fs::symlink(&fixture, &bin).unwrap();
    bin
}

/// Through `ask_session`: the OpenCode arm neither reads nor writes the Claude ask log, on
/// success or on failure (no `FAILED_ASK_CHARGE_USD`). The only test here that sets the env.
#[tokio::test]
async fn ask_does_not_touch_claude_budget() {
    let d = tempfile::tempdir().unwrap();
    let messages = json!({"data": [
        assistant("from the fork", Some(1.5)),
        {"id": "{{PROMPT_ID}}", "type": "user", "text": "q"},
    ], "cursor": {}})
    .to_string();
    let ok = json!({
        "POST /api/session/ses_a/fork": {"out": json!({"data": {"id": FORK}}).to_string()},
        "POST /api/session/ses_fork/agent": {"out": ""},
        "GET /api/session/ses_fork": {"out": json!({"data": {"id": FORK, "agent": "session-bridge-reader"}}).to_string()},
        "POST /api/session/ses_fork/prompt": {"out": "{\"data\":{}}"},
        "POST /api/experimental/session/ses_fork/wait": {"out": ""},
        "GET /api/session/ses_fork/message?order=desc&limit=20": {"out": messages},
        "DELETE /api/session/ses_fork": {"out": ""},
    });
    let bin = fake_bin(d.path(), ok.clone());
    std::env::set_var("SESSION_BRIDGE_OPENCODE_BIN", &bin);
    let state = d.path().join("sb-state");
    fs::create_dir_all(&state).unwrap();
    let log = "{\"asker\":\"x\",\"at\":\"2026-11-17T00:00:00Z\",\"cost_usd\":1.9}\n";
    fs::write(state.join("asks.jsonl"), log).unwrap();
    let roots = Roots {
        proc_root: d.path().join("proc"),
        socks: d.path().join("socks"),
    };
    let sessions = vec![oc("ses_me"), oc("ses_a")];
    let args = |t: &str| AskArgs {
        target: t.into(),
        question: "which branch?".into(),
        model: None,
        timeout_s: Some(20),
    };
    let out = ask_session(
        &sessions[0],
        &sessions,
        &[],
        args("opencode:/d:ses_a"),
        &roots,
        &state,
    )
    .await
    .unwrap();
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["answer"], "from the fork");
    assert_eq!(v["cost_usd"], 1.5);
    let argv = fs::read_to_string(d.path().join("state/argv.log")).unwrap();
    assert!(argv.contains("DELETE"), "{argv}");
    // the reader agent is missing: an explicit error, still nothing charged
    let mut missing = ok;
    missing["POST /api/session/ses_fork/agent"] =
        json!({"out": "HTTP 400 AgentNotFoundError", "exit": 1});
    fs::write(d.path().join("state/script.json"), missing.to_string()).unwrap();
    let e = ask_session(
        &sessions[0],
        &sessions,
        &[],
        args("opencode:/d:ses_a"),
        &roots,
        &state,
    )
    .await
    .unwrap_err();
    assert!(e.to_string().contains("session-bridge-reader"), "{e}");
    std::env::remove_var("SESSION_BRIDGE_OPENCODE_BIN");
    assert_eq!(fs::read_to_string(state.join("asks.jsonl")).unwrap(), log);
    let names: Vec<_> = fs::read_dir(&state)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names, ["asks.jsonl"], "the OpenCode ask wrote state");
}
