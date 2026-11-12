---
kind: bug
status: open
title: worktree hooks link the main checkout's .codescout/embeddings into every worktree, and the archived 2026-08-13 codescout bug calls that link a no-op
tags:
- codescout-companion
- hooks
- worktree
owner: marius
opened: 2026-11-12
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

## Hypotheses tried

That the link is a no-op: **not verified, and the current source does not settle it.** `codescout:src/retrieval/config.rs` `resolve_sqlite_dir` still returns `<root>/.codescout/embeddings` as the default directory of the sqlite-vec store, so the directory is live when that backend is in use. In the main checkout of codescout, `.codescout/embeddings` holds `codescout.db`, `project.db` and `project.db-shm`, and the `-shm` file was last written 2026-11-11 21:24. That shows something opened a store there; what opened it was not attributed. The archived bug's statement is about the Qdrant backend, and which backend a session uses was not checked. Until it is, "no-op" is the archived bug's claim, not a fact of this issue.

## Fix

None applied. Two options:

1. Remove the `embeddings` loop from both hooks, as the 2026-08-13 spec says. This is right only if the link has no reader. If the sqlite-vec store is in use, a worktree would then build its own store.
2. Keep the link, and make the repository that uses it ignore it. codescout did this (`codescout:652f12d88`: its rules `.codescout/embeddings` and `crates/*/.codescout/embeddings` have no trailing slash). Other repositories get the untracked link until they do the same.

## Resume

- Decide between the two options. The operator must decide; the change is in this repository.
- Before option 1, find the reader of `<root>/.codescout/embeddings` in a worktree session: which backend is live, and does a worktree read the main checkout's store through this link.
- If the hooks change, add a test to `session-start.test.sh` and the `worktree-activate` hook tests for the choice made.

## References

- `codescout:docs/issues/archive/2026-08-13-enter-worktree-desyncs-codescout-and-strands-semantic-search.md` (the bug that calls the link a no-op).
- `codescout:docs/superpowers/specs/2026-08-13-worktree-semantic-search-design.md`, section Lifecycle.
- `codescout:docs/superpowers/plans/2026-08-13-worktree-semantic-search.md`, line 1044.
- `codescout:docs/issues/2026-11-12-git-worktree-remove-refuses-after-codescout-and-agent-briefs-leave-untracked-files-in-a-worktree.md` (catalog id `3dde1548c3e5c310`). This issue is split out of it.
