//! Authored hidden tests (S5 task cs-p20). Compiled into the lib test binary as a child of
//! `librarian::adapter` by a grafted `mod` line, so it can reach the crate-private test helpers.
//!
//! Everything here goes through symbols that exist before the fix: the public `adapters_for`, the
//! test-only `TestToolContextBuilder`, the core `ToolContext` with its `progress` field, and the
//! test-only `ProgressReporter::with_sink`. No test names an item a fix would have to add.
//!
//! Timing: every embedding call sleeps 600 ms, which is longer than the 500 ms window inside which
//! the progress reporter drops a notification. So a run that reports after every item delivers
//! every notification, whatever the load on the machine: a sleep can only be longer than asked.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::librarian::artifact_store::test_support::InMemoryArtifactStore;
use crate::librarian::catalog::Catalog;
use crate::librarian::classify::load_rules;
use crate::librarian::embedding::EmbeddingService;
use crate::librarian::tools::TestToolContextBuilder;
use crate::tools::progress::{ProgressReporter, ProgressSink};

const ITEM_DELAY_MS: u64 = 600;
const FILES: usize = 3;

/// An embedder whose every call takes `delay_ms` (changeable between calls) and which can be told
/// to fail instead of answering.
struct SlowEmbedder {
    delay_ms: Arc<AtomicU64>,
    fail: bool,
}

#[async_trait::async_trait]
impl codescout_embed::Embedder for SlowEmbedder {
    fn dimensions(&self) -> usize {
        4
    }
    async fn embed(&self, texts: &[&str]) -> anyhow::Result<Vec<Vec<f32>>> {
        let ms = self.delay_ms.load(Ordering::SeqCst);
        if ms > 0 {
            tokio::time::sleep(Duration::from_millis(ms)).await;
        }
        if self.fail {
            anyhow::bail!("connection refused");
        }
        Ok(texts.iter().map(|_| vec![1.0, 0.0, 0.0, 0.0]).collect())
    }
}

/// Records every `(progress, total)` pair the sink is asked to deliver, in order.
#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<(f64, Option<f64>)>>,
}

impl RecordingSink {
    fn events(&self) -> Vec<(f64, Option<f64>)> {
        self.events.lock().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl ProgressSink for RecordingSink {
    async fn emit_progress(
        &self,
        step: f64,
        total: Option<f64>,
        _token: &rmcp::model::NumberOrString,
    ) {
        self.events.lock().unwrap().push((step, total));
    }
    async fn emit_text(&self, _text: &str) {}
}

struct Fixture {
    _tmp: tempfile::TempDir,
    adapter: Arc<dyn crate::tools::Tool>,
    ctx: crate::tools::ToolContext,
    delay_ms: Arc<AtomicU64>,
}

/// A project of `FILES` one-chunk specs, a `librarian` tool registered the way the server registers
/// it (wrapped by the adapter), and a core `ToolContext` rooted at the project with no progress
/// reporter. The test sets `ctx.progress` per call, as the server does per request.
async fn fixture(fail: bool) -> Fixture {
    let tmp = tempfile::TempDir::new().unwrap();
    let proj = tmp.path().join("proj");
    std::fs::create_dir_all(proj.join("docs/specs")).unwrap();
    std::fs::create_dir_all(proj.join(".codescout")).unwrap();
    for i in 0..FILES {
        std::fs::write(
            proj.join(format!("docs/specs/item{i}.md")),
            format!("# item {i}\nbody {i}\n"),
        )
        .unwrap();
    }

    let rules = load_rules("[[rule]]\nglob = \"**/docs/specs/*.md\"\nkind = \"spec\"\n").unwrap();
    let delay_ms = Arc::new(AtomicU64::new(0));
    let lib_ctx = TestToolContextBuilder::new(Catalog::open_in_memory().unwrap())
        .with_rules(rules)
        .with_embedding(Arc::new(EmbeddingService::new(Arc::new(SlowEmbedder {
            delay_ms: delay_ms.clone(),
            fail,
        }))))
        .with_artifact_store(Arc::new(InMemoryArtifactStore::default()))
        .build();

    let adapter = super::adapters_for(Arc::new(lib_ctx))
        .into_iter()
        .find(|t| crate::tools::Tool::name(&**t) == "librarian")
        .expect("the librarian tool is registered");

    let ctx = crate::tools::ToolContext {
        agent: crate::agent::Agent::new(Some(proj.clone())).await.unwrap(),
        lsp: crate::lsp::LspManager::new_arc(),
        output_buffer: std::sync::Arc::new(crate::tools::output_buffer::OutputBuffer::new(20)),
        progress: None,
        peer: None,
        section_coverage: std::sync::Arc::new(std::sync::Mutex::new(
            crate::tools::section_coverage::SectionCoverage::new(),
        )),
        guide_hints_emitted: std::sync::Arc::new(parking_lot::Mutex::new(
            crate::tools::guide_ledger::GuideLedger::mid_session(),
        )),
        workspace_override: None,
    };

    Fixture {
        _tmp: tmp,
        adapter,
        ctx,
        delay_ms,
    }
}

/// One `librarian(action="reindex", reembed=true)` call, through the adapter, with whatever
/// reporter `f.ctx.progress` holds.
async fn reindex(f: &Fixture) -> Value {
    crate::tools::Tool::call(
        &*f.adapter,
        json!({"action": "reindex", "scope": "project", "reembed": true}),
        &f.ctx,
    )
    .await
    .expect("the reindex call itself must succeed")
}

/// What a client that asked for progress must have received from one run of `items` items.
fn assert_trace(what: &str, events: &[(f64, Option<f64>)], items: u64) {
    let total = items as f64;
    assert!(
        events.len() >= 2,
        "{what}: every item takes 600 ms, so the caller must be told about the run's progress \
         more than once while it works; it received {events:?}"
    );
    let mut previous = 0.0_f64;
    for (step, t) in events {
        assert_eq!(
            *t,
            Some(total),
            "{what}: every notification must carry total = the {items} items the run embeds, \
             got {events:?}"
        );
        assert!(
            *step >= previous,
            "{what}: progress must never decrease, got {events:?}"
        );
        assert!(
            *step <= total,
            "{what}: progress must never exceed total, got {events:?}"
        );
        previous = *step;
    }
    assert!(
        previous >= 2.0,
        "{what}: the last notification must show the run advanced past its first item, \
         got {events:?}"
    );
}

#[tokio::test]
async fn a_reembedding_reindex_keeps_a_caller_that_asked_for_updates_informed() {
    let mut f = fixture(false).await;
    f.delay_ms.store(ITEM_DELAY_MS, Ordering::SeqCst);

    // Call 1: the client attached a progress token.
    let sink_a = Arc::new(RecordingSink::default());
    f.ctx.progress = Some(ProgressReporter::with_sink(
        sink_a.clone(),
        rmcp::model::NumberOrString::Number(1),
    ));
    let first = reindex(&f).await;
    let items = first["embedded"].as_u64().unwrap();
    assert!(
        items >= FILES as u64,
        "test setup: every spec must reach the embed loop, or the assertions below are vacuous: {first}"
    );
    assert_trace("first call", &sink_a.events(), items);
    let a_after_first = sink_a.events().len();

    // Call 2: a different client request, with a token of its own. It must be told about its own
    // run, and the first call's reporter must not hear about it.
    let sink_b = Arc::new(RecordingSink::default());
    f.ctx.progress = Some(ProgressReporter::with_sink(
        sink_b.clone(),
        rmcp::model::NumberOrString::Number(2),
    ));
    let second = reindex(&f).await;
    assert_eq!(
        second["embedded"].as_u64().unwrap(),
        items,
        "test setup: the second run embeds the same items: {second}"
    );
    assert_trace("second call", &sink_b.events(), items);
    let b_after_second = sink_b.events().len();
    assert_eq!(
        sink_a.events().len(),
        a_after_first,
        "a call's notifications go to the token of that call, never to an earlier call's"
    );

    // Call 3: the client sent no token. Nothing may be delivered anywhere on its behalf.
    f.ctx.progress = None;
    f.delay_ms.store(0, Ordering::SeqCst);
    let third = reindex(&f).await;
    assert_eq!(
        third["embedded"].as_u64().unwrap(),
        items,
        "test setup: the third run embeds the same items, so the check below is not vacuous: {third}"
    );
    assert_eq!(
        sink_a.events().len(),
        a_after_first,
        "a call without a token must not reach the first call's reporter"
    );
    assert_eq!(
        sink_b.events().len(),
        b_after_second,
        "a call without a token must not reach the second call's reporter"
    );
}

#[tokio::test]
async fn the_updates_also_advance_through_items_whose_embedding_fails() {
    let mut f = fixture(true).await;
    f.delay_ms.store(ITEM_DELAY_MS, Ordering::SeqCst);

    let sink = Arc::new(RecordingSink::default());
    f.ctx.progress = Some(ProgressReporter::with_sink(
        sink.clone(),
        rmcp::model::NumberOrString::Number(7),
    ));
    let v = reindex(&f).await;

    assert_eq!(
        v["embedded"].as_u64().unwrap(),
        0,
        "test setup: nothing embeds against a dead embedder: {v}"
    );
    let attempted = v["embed_error_count"].as_u64().unwrap();
    assert!(
        attempted >= FILES as u64,
        "test setup: every item must reach the embed loop and fail there: {v}"
    );
    assert_trace("run with every embedding failing", &sink.events(), attempted);
}
