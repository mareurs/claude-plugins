//! An `update_entry` call that carries no usable patch must not report success.
//!
//! Driven through the `artifact` tool, the way a caller reaches the action.

use crate::librarian::catalog::{artifact as artifact_rows, augmentation, Catalog};
use crate::librarian::tools::artifact::Artifact;
use crate::librarian::tools::{TestToolContextBuilder, Tool, ToolContext};
use serde_json::{json, Value};

fn mk_ctx() -> ToolContext {
    TestToolContextBuilder::new(Catalog::open_in_memory().unwrap()).build()
}

fn seed(ctx: &ToolContext, id: &str) {
    let cat = ctx.catalog.lock();
    artifact_rows::upsert(
        &cat,
        &artifact_rows::TestArtifactRowBuilder::new(id)
            .with_abs_path(format!("/repo/docs/trackers/{id}.md"))
            .with_kind("tracker")
            .build(),
    )
    .unwrap();
    augmentation::upsert(
        &cat,
        &augmentation::AugmentationRow {
            artifact_id: id.to_string(),
            prompt: "p".into(),
            params: r#"{"tasks":[{"id":"T-1","status":"open"},{"id":"T-2","status":"open"}]}"#
                .to_string(),
            last_refreshed_at: None,
            refresh_count: 0,
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
            render_template: None,
            params_schema: None,
            append_mode: false,
            history_cap: None,
            entry_collection: Some("tasks".into()),
            refreshed_at_commit: None,
        },
    )
    .unwrap();
}

/// The stored params of the seeded artifact, parsed.
fn params_of(ctx: &ToolContext) -> Value {
    let cat = ctx.catalog.lock();
    let row = augmentation::get(&cat, "art1").unwrap().unwrap();
    serde_json::from_str(&row.params).unwrap()
}

#[tokio::test]
async fn a_patch_sent_as_entry_is_refused_and_changes_nothing() {
    let ctx = mk_ctx();
    seed(&ctx, "art1");
    let before = params_of(&ctx);

    let result = Artifact
        .call(
            &ctx,
            json!({
                "action": "update_entry",
                "id": "art1",
                "entry_collection": "tasks",
                "entry_id": "T-1",
                "entry": {"status": "done"}
            }),
        )
        .await;

    assert!(
        result.is_err(),
        "a patch that arrived as `entry` was never applied, so the call must not succeed: {result:?}"
    );
    assert_eq!(params_of(&ctx), before, "a refused call must change nothing");
}

#[tokio::test]
async fn an_empty_patch_is_refused_and_changes_nothing() {
    let ctx = mk_ctx();
    seed(&ctx, "art1");
    let before = params_of(&ctx);

    let with_empty_fields = Artifact
        .call(
            &ctx,
            json!({
                "action": "update_entry",
                "id": "art1",
                "entry_collection": "tasks",
                "entry_id": "T-1",
                "fields": {}
            }),
        )
        .await;
    assert!(
        with_empty_fields.is_err(),
        "an empty `fields` patch must not succeed: {with_empty_fields:?}"
    );

    let without_fields = Artifact
        .call(
            &ctx,
            json!({
                "action": "update_entry",
                "id": "art1",
                "entry_collection": "tasks",
                "entry_id": "T-1"
            }),
        )
        .await;
    assert!(
        without_fields.is_err(),
        "a call with no patch at all must not succeed: {without_fields:?}"
    );

    assert_eq!(params_of(&ctx), before, "a refused call must change nothing");
}

#[tokio::test]
async fn a_patch_sent_as_fields_is_still_applied() {
    let ctx = mk_ctx();
    seed(&ctx, "art1");

    let out = Artifact
        .call(
            &ctx,
            json!({
                "action": "update_entry",
                "id": "art1",
                "entry_collection": "tasks",
                "entry_id": "T-2",
                "fields": {"status": "done"}
            }),
        )
        .await
        .unwrap();

    assert_eq!(out["entry_id"], "T-2");
    assert_eq!(out["changed_fields"], json!(["status"]));
    assert_eq!(out["entries_total"], 2);

    let params = params_of(&ctx);
    assert_eq!(params["tasks"][0]["status"], "open");
    assert_eq!(params["tasks"][1]["status"], "done");
}
