use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use session_bridge_mcp::{
    opencode::OpenCodeEndpoint, opencode_api::OcApi, opencode_send::send_opencode,
};
use std::sync::Mutex;

/// Scripted fake: `post` is the POST outcome, `lists` are successive message-list answers
/// (the last repeats), `get` is the session lookup answer. `echo_id` makes the list contain
/// the id that was POSTed, like a consumed message.
struct FakeApi {
    get: Result<Value, String>,
    post: Result<Value, String>,
    lists: Vec<Value>,
    echo_id: bool,
    calls: Mutex<Vec<(String, String, Option<Value>)>>,
}
impl FakeApi {
    fn new() -> Self {
        Self {
            get: Ok(json!({"data": {"id": "ses_a", "time": {"created": 1, "updated": 2}}})),
            post: Ok(json!({"data": {"id": "x"}})),
            lists: vec![json!({"data": []})],
            echo_id: false,
            calls: Mutex::new(vec![]),
        }
    }
    fn posts(&self) -> Vec<Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.0 == "POST")
            .map(|c| c.2.clone().unwrap())
            .collect()
    }
    fn count(&self, method: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.0 == method)
            .count()
    }
}
impl OcApi for FakeApi {
    fn call(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> impl std::future::Future<Output = Result<Value>> + Send {
        let mut calls = self.calls.lock().unwrap();
        calls.push((method.into(), path.into(), body.cloned()));
        let r = if method == "POST" {
            self.post.clone()
        } else if path.contains("/message") {
            let n = calls
                .iter()
                .filter(|c| c.0 == "GET" && c.1.contains("/message"))
                .count();
            let mut v = self.lists[(n - 1).min(self.lists.len() - 1)].clone();
            if self.echo_id {
                if let Some(id) = calls
                    .iter()
                    .find(|c| c.0 == "POST")
                    .and_then(|c| c.2.as_ref())
                    .map(|b| b["id"].clone())
                {
                    v["data"].as_array_mut().unwrap().push(json!({"id": id}));
                }
            }
            Ok(v)
        } else {
            self.get.clone()
        };
        async move { r.map_err(|e| anyhow!(e)) }
    }
}
fn ep() -> OpenCodeEndpoint {
    OpenCodeEndpoint {
        data_dir: "/d".into(),
        session_id: "ses_a".into(),
        title: None,
        directory: None,
        running: true,
        last_active_ms: 0,
    }
}

#[tokio::test]
async fn send_posts_queue_delivery_with_marker() {
    let api = FakeApi::new();
    send_opencode(&api, &ep(), "claude:me", "hello", 1)
        .await
        .unwrap();
    let posts = api.posts();
    assert_eq!(posts.len(), 1);
    let b = &posts[0];
    assert_eq!(b["delivery"], "queue");
    assert!(b.get("resume").is_none());
    let id = b["id"].as_str().unwrap();
    assert!(id.starts_with("msg_"));
    assert_eq!(b["metadata"]["session_bridge"], id);
    let text = b["text"].as_str().unwrap();
    assert!(text.contains(id) && text.contains("claude:me") && text.contains("hello"));
    assert!(text.contains("not an approval"));
    let paths: Vec<String> = api
        .calls
        .lock()
        .unwrap()
        .iter()
        .map(|c| c.1.clone())
        .collect();
    assert_eq!(paths[0], "/api/session/ses_a");
    assert_eq!(paths[1], "/api/session/ses_a/prompt");
}

#[tokio::test]
async fn send_observed_on_exact_id_only() {
    let mut api = FakeApi::new();
    api.lists = vec![json!({"data": [{"id": "msg_other"}, {"id": "msg_other2"}]})];
    let r = send_opencode(&api, &ep(), "me", "hi", 1).await.unwrap();
    assert_eq!(r.status, "queued");
    let mut api = FakeApi::new();
    api.lists = vec![json!({"data": [{"id": "msg_other"}]}), json!({"data": []})];
    api.echo_id = true;
    let r = send_opencode(&api, &ep(), "me", "hi", 2).await.unwrap();
    assert_eq!(r.status, "observed");
    assert!(api.count("GET") >= 2);
}

#[tokio::test]
async fn send_after_post_failure_is_unknown_not_retried() {
    let mut api = FakeApi::new();
    api.post = Err("transport broke".into());
    let r = send_opencode(&api, &ep(), "me", "hi", 1).await.unwrap();
    assert_eq!(r.status, "unknown");
    assert!(r.reason.contains("not retried"));
    assert_eq!(api.count("POST"), 1);
}

#[tokio::test]
async fn send_to_removed_session_errors_before_post() {
    let mut api = FakeApi::new();
    api.get = Err("HTTP 404".into());
    assert!(send_opencode(&api, &ep(), "me", "hi", 1).await.is_err());
    assert_eq!(api.count("POST"), 0);
    let mut api = FakeApi::new();
    api.get =
        Ok(json!({"data": {"id": "ses_a", "time": {"created": 1, "updated": 2, "archived": 3}}}));
    assert!(send_opencode(&api, &ep(), "me", "hi", 1).await.is_err());
    assert_eq!(api.count("POST"), 0);
}

#[tokio::test]
async fn send_rejects_empty_and_oversized() {
    let api = FakeApi::new();
    for m in ["", "  \n", &"x".repeat(16001), "a\0b"] {
        assert!(send_opencode(&api, &ep(), "me", m, 1).await.is_err());
    }
    assert!(api.calls.lock().unwrap().is_empty());
    assert!(send_opencode(&api, &ep(), "me", &"x".repeat(16000), 1)
        .await
        .is_ok());
}
