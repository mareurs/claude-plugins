//! Which `edit_file` calls may change a file that the librarian keeps in its catalog.
//!
//! Every call below writes to a markdown file inside the project. A file is a
//! librarian-managed artifact when its frontmatter holds an `id:` line whose value is
//! 16 lower-case hex characters; the extension and the location play no part.

use crate::agent::Agent;
use crate::lsp::LspManager;
use crate::tools::edit_file::EditFile;
use crate::tools::{Tool, ToolContext};
use serde_json::{json, Value};
use tempfile::tempdir;

async fn project_ctx() -> (tempfile::TempDir, ToolContext) {
    let dir = tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".codescout")).unwrap();
    let agent = Agent::new(Some(dir.path().to_path_buf())).await.unwrap();
    (
        dir,
        ToolContext {
            agent,
            lsp: LspManager::new_arc(),
            output_buffer: std::sync::Arc::new(crate::tools::output_buffer::OutputBuffer::new(20)),
            progress: None,
            peer: None,
            section_coverage: std::sync::Arc::new(std::sync::Mutex::new(
                crate::tools::section_coverage::SectionCoverage::new(),
            )),
            guide_hints_emitted: std::sync::Arc::new(parking_lot::Mutex::new(Default::default())),
            workspace_override: None,
        },
    )
}

/// The shapes of an `edit_file` call that the markdown rule lets through for a
/// `.md` / `.markdown` file.
#[derive(Clone, Copy, Debug)]
enum Form {
    SingleReplaceAll,
    BatchOfOne,
    BatchOfTwo,
    Prepend,
    Append,
}

const ALL_FORMS: [Form; 5] = [
    Form::SingleReplaceAll,
    Form::BatchOfOne,
    Form::BatchOfTwo,
    Form::Prepend,
    Form::Append,
];

const EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// Managed artifacts. Every body holds `alpha alpha` and the heading `# T`.
const MANAGED: [(&str, &str); 2] = [
    (
        "the id on its first line",
        "---\nid: abc513d3ee0f0b50\nkind: tracker\n---\n\n# T\n\nalpha alpha\n",
    ),
    (
        "the id after another key",
        "---\nkind: tracker\nid: 0123456789abcdef\n---\n\n# T\n\nalpha alpha\n",
    ),
];

/// Files that are not managed artifacts, with the same body text.
const UNMANAGED: [(&str, &str); 4] = [
    ("no frontmatter", "# T\n\nalpha alpha\n"),
    (
        "frontmatter without an id",
        "---\nkind: notes\n---\n\n# T\n\nalpha alpha\n",
    ),
    (
        "an id of the wrong length",
        "---\nid: abc123\nkind: notes\n---\n\n# T\n\nalpha alpha\n",
    ),
    (
        "an upper-case id",
        "---\nid: ABC513D3EE0F0B50\nkind: notes\n---\n\n# T\n\nalpha alpha\n",
    ),
];

fn call_for(form: Form, file: &std::path::Path) -> Value {
    let path = file.to_str().unwrap();
    match form {
        Form::SingleReplaceAll => json!({
            "path": path,
            "old_string": "alpha",
            "new_string": "beta",
            "replace_all": true
        }),
        Form::BatchOfOne => json!({
            "path": path,
            "edits": [
                { "old_string": "alpha", "new_string": "beta", "replace_all": true }
            ]
        }),
        Form::BatchOfTwo => json!({
            "path": path,
            "edits": [
                { "old_string": "alpha", "new_string": "beta", "replace_all": true },
                { "old_string": "# T", "new_string": "# U", "replace_all": true }
            ]
        }),
        Form::Prepend => json!({
            "path": path,
            "insert": "prepend",
            "new_string": "head\n"
        }),
        Form::Append => json!({
            "path": path,
            "insert": "append",
            "new_string": "tail\n"
        }),
    }
}

/// Whether `after` is what a call of `form` leaves behind in a body that held
/// `alpha alpha` and `# T`.
fn applied(form: Form, after: &str) -> bool {
    let replaced = after.contains("beta beta") && !after.contains("alpha");
    match form {
        Form::SingleReplaceAll | Form::BatchOfOne => replaced,
        Form::BatchOfTwo => replaced && after.contains("# U"),
        Form::Prepend => after.starts_with("head\n"),
        Form::Append => after.ends_with("tail\n"),
    }
}

/// Every call of every given form, on every managed file, must be refused and must
/// leave the file byte-identical.
async fn assert_refused_everywhere(forms: &[Form]) {
    let (dir, ctx) = project_ctx().await;
    let mut n = 0;
    for ext in EXTENSIONS {
        for (shape, body) in MANAGED {
            for &form in forms {
                n += 1;
                let file = dir.path().join(format!("doc{n}.{ext}"));
                std::fs::write(&file, body).unwrap();
                let label = format!("{form:?} on a .{ext} file with {shape}");

                let result = EditFile.call(call_for(form, &file), &ctx).await;

                let err = result.expect_err(&format!(
                    "{label}: a librarian-managed artifact must be refused, not written"
                ));
                assert!(
                    err.to_string().contains("librarian-managed artifact"),
                    "{label}: wrong error: {err}"
                );
                assert_eq!(
                    std::fs::read_to_string(&file).unwrap(),
                    body,
                    "{label}: a refused call must leave the file byte-identical"
                );
            }
        }
    }
}

#[tokio::test]
async fn a_replace_all_edit_of_a_managed_markdown_file_is_refused() {
    assert_refused_everywhere(&[Form::SingleReplaceAll]).await;
}

#[tokio::test]
async fn a_batch_of_replace_all_edits_of_a_managed_markdown_file_is_refused() {
    assert_refused_everywhere(&[Form::BatchOfOne, Form::BatchOfTwo]).await;
}

#[tokio::test]
async fn prepend_and_append_to_a_managed_markdown_file_are_refused() {
    assert_refused_everywhere(&[Form::Prepend, Form::Append]).await;
}

#[tokio::test]
async fn an_unmanaged_markdown_file_is_edited_by_every_form() {
    let (dir, ctx) = project_ctx().await;
    let mut n = 0;
    for ext in EXTENSIONS {
        for (shape, body) in UNMANAGED {
            for form in ALL_FORMS {
                n += 1;
                let file = dir.path().join(format!("doc{n}.{ext}"));
                std::fs::write(&file, body).unwrap();
                let label = format!("{form:?} on a .{ext} file with {shape}");

                let result = EditFile.call(call_for(form, &file), &ctx).await;

                assert!(
                    result.is_ok(),
                    "{label}: a file that is not a managed artifact must still be edited: {result:?}"
                );
                let after = std::fs::read_to_string(&file).unwrap();
                assert!(
                    applied(form, &after),
                    "{label}: the edit did not land, the file now reads {after:?}"
                );
            }
        }
    }
}
