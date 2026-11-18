---
kind: bug
status: fixed
title: worktree hooks link the main checkout's .codescout/embeddings into every worktree, and the archived 2026-08-13 codescout bug calls that link a no-op
tags:
- codescout-companion
- hooks
- worktree
closed: 2026-11-12
opened: 2026-11-12
owner: marius
unverified: 'Not measured: a sqlite-vec user (lean build, or CODESCOUT_VECTOR_BACKEND=sqlite-vec) who relied on the link to share the main checkout''s store. By the resolve_sqlite_dir comment the store file is <project_id>.db and project_id is the directory basename, so a worktree would look for a different file than the main checkout holds; that is a reading of a comment, not a measurement. Observed on 2026-11-12 in this repo and in the codescout checkout: no data write to .codescout/embeddings since 2026-09-14; only codescout''s project.db-shm was touched on 2026-11-11 21:24 (an open, not attributed).'
---

## Summary

Two codescout-companion hooks symlink `<worktree>/.codescout/embeddings` to `<main checkout>/.codescout/embeddings`. Both do it only when the worktree's `.codescout` is a real directory and not a symlink, and both skip an `embeddings` entry that already exists.

- `codescout-companion/hooks/worktree-activate.mjs`: loop `for (const asset of ['embeddings'])`, line 128.
- `codescout-companion/hooks/session-start.mjs`: the same loop, line 394. It runs when a session starts inside a worktree.

A repository that tracks files under `.codescout/` has a real `.codescout` directory in every checkout, so every worktree of it gets the link.

The codescout bug `docs/issues/archive/2026-08-13-enter-worktree-desyncs-codescout-and-strands-semantic-search.md` (status `fixed`, closed 2026-08-15; it has no catalog id in its front matter) says about this link: "The sharing mechanism predates Qdrant and is now a no-op for semantic search." That bug found the link while it studied the `EnterWorktree` hook. It named the link, but its fix did not remove it. The design `codescout:docs/superpowers/specs/2026-08-13-worktree-semantic-search-design.md` (section Lifecycle, line 254) and its plan (`codescout:docs/superpowers/plans/2026-08-13-worktree-semantic-search.md`, line 1044, step unchecked) say the same and say to drop the link. Both hooks still create it.

## Symptom (Effect)

The link is an untracked entry in the worktree. In codescout it made `git worktree remove` refuse, until a `.gitignore` change (`codescout:652f12d88`) made git ignore a symlink as well as a directory. Details: codescout bug `3dde1548c3e5c310` (`codescout:docs/issues/2026-11-12-git-worktree-remove-refuses-after-codescout-and-agent-briefs-leave-untracked-files-in-a-worktree.md`).

## Reproduction

Not run. Evidence is one observation: on 2026-11-12, a worktree of codescout held `.codescout/embeddings -> /home/marius/work/claude/codescout/.codescout/embeddings`, created in the same minute as `.codescout/cc_session_id`. Which of the two hooks made that link is not determined; both make the same link.

## Environment

`claude-plugins` `main`, clean checkout, read on 2026-11-12. No hook was run.

## Root cause

The hooks link `embeddings` as a "shared asset" when the worktree has a real `.codescout`. Nothing in either hook checks whether the store behind that directory is still the one that semantic search reads.

## Evidence

Read on 2026-11-12:

- Both hook blocks above.
- `session-start.mjs` line 305 has a comment on the drift warnings: "legacy sqlite-vec surface; inert post-Qdrant — embeddings.db no longer exists".
- The archived codescout bug and the codescout spec cited above.
- On 2026-11-12, activating the main checkout of codescout returned `legacy_semantic_index` for `.codescout/embeddings/project.db`, with the hint "Run `codescout migrate-memories` to port memories to Qdrant, then delete this file." So codescout itself still calls that file a legacy store. This shows the store is flagged as legacy; it does not show that nothing reads the `.codescout/embeddings` directory in a worktree session.

## Hypotheses tried

That the link is a no-op: **not verified, and the current source does not settle it.** `codescout:src/retrieval/config.rs` `resolve_sqlite_dir` still returns `<root>/.codescout/embeddings` as the default directory of the sqlite-vec store, so the directory is live when that backend is in use. In the main checkout of codescout, `.codescout/embeddings` holds `codescout.db`, `project.db` and `project.db-shm`, and the `-shm` file was last written 2026-11-11 21:24. That shows something opened a store there; what opened it was not attributed. The archived bug's statement is about the Qdrant backend, and which backend a session uses was not checked. Until it is, "no-op" is the archived bug's claim, not a fact of this issue.

## Fix

Applied 2026-11-12: option 1. Both hooks no longer link `embeddings`.

- `codescout-companion/hooks/worktree-activate.mjs`: the fallback block and its `lstatSync` import are removed. A comment points here.
- `codescout-companion/hooks/session-start.mjs`: the same loop (inside the `inWorktree` block) and the `lstatSync` import are removed. The `.codescout` link itself stays.
- Tests first, then code. `tests/test-worktree-activate.sh` test 5 and `tests/test-session-start.sh` test 9 now assert that no link is created although the main checkout has an `embeddings` dir. Both failed before the hook change, with the unwanted symlink in the failure output. Tests 6, 10 and 11 are unchanged and pass; test 11 still guards a worktree's own real `embeddings` dir against being overwritten.
- Full runner `./tests/run-all.sh`: exit 0, `All suites passed`.

Option 2 (ignore the link in each repository's `.gitignore`) stays available to any repository whose worktrees already hold the link; the hooks no longer create new ones. An existing link is not removed by this change.

## Resume

Nothing to resume. If a sqlite-vec user reports that a worktree lost its semantic search after this change, re-open this issue and measure which `<project_id>.db` the worktree opens.

## References

- `codescout:docs/issues/archive/2026-08-13-enter-worktree-desyncs-codescout-and-strands-semantic-search.md` (the bug that calls the link a no-op).
- `codescout:docs/superpowers/specs/2026-08-13-worktree-semantic-search-design.md`, section Lifecycle.
- `codescout:docs/superpowers/plans/2026-08-13-worktree-semantic-search.md`, line 1044.
- `codescout:docs/issues/2026-11-12-git-worktree-remove-refuses-after-codescout-and-agent-briefs-leave-untracked-files-in-a-worktree.md` (catalog id `3dde1548c3e5c310`). This issue is split out of it.


## Fix provenance

- **SHA:** `83acfd2f32c5047b337d5c28a1005af97acc84f6` (`main`)
- **patch-id:** `eebb58dc9bcd4a40d1ac52652fad216dfd36e514`
