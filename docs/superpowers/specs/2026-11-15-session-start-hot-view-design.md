---
id: dad37f4d10dda787
kind: spec
status: active
title: Session-start hot view — short design
tags:
- codescout-companion
- hooks
- hot-view
topic: collection-hot-path
---

# Session-start hot view — short design

**Status:** approved by the operator on 2026-11-15, with the calls in § My calls as written. Approach picked by the operator on 2026-11-15 (option 1 below).
**Session log:** `docs/trackers/collection-hot-path-session-log.md` (F-1 to F-4, W-1).
**Contract it consumes:** codescout `docs/superpowers/plans/2026-11-15-collection-hot-view.md` § Contract for the hook, on `integration/identity-lifecycle-20261114` at `5d655bfef`.

## Intent

At session start, the agent sees the live entries of each lifecycle collection that need attention: open entries, stale open entries and blocked or deferred entries whose revisit date has passed. This is the hot tier of the ledger memory system (codescout design note `2026-11-15-memory-system-for-ledgers-design-note.md`, operator decision 4: "a session-start hook in the companion plugin, built on a codescout CLI command that renders the view").

## Goals

- Show the `codescout hot-view` output of each collection that declares `hot_cap`, in the `additionalContext` that `codescout-companion/hooks/session-start.mjs` already emits.
- Fail open: any failure adds nothing about that collection and never breaks the rest of the hook.

## Non-goals

- No change to codescout. The command, its output and its exit codes are fixed by the contract.
- No Codex-specific adapter. If Codex runs this hook, it gets the same behaviour.
- No move of the `next-sweep-due` hygiene line (lines 233-242). The lifecycle spec moves it later, as a separate change.
- No migration of trackers (Plan L-E, a separate plan).

## Anti-goals

- A second reader of the collection format that could drift from codescout. The hook reads one key (`hot_cap`) to decide *whether* to ask. Everything it shows comes from the binary.
- A bare zero. When collections were checked and none had hot entries, the hook says which ones were checked (ADR `2026-08-27-negative-results-name-their-scope`, F-4).
- A silent skip of a lifecycle folder (F-3).

## Constraints

- The installed binary today (`codescout 0.15.0`) has no `hot-view` and exits 2 with empty stdout (F-1). The hook must treat this as "not shown", and stays dormant until a release.
- No collection exists yet in any repo (F-2). Tests must use fixtures.
- One process costs about 15 ms to start (W-1). The folder read is not measured.

## Approaches

1. **Every collection whose readme declares `hot_cap`** — picked. The hook finds the readmes itself and asks the binary once per collection. No configuration. The cost is one regex over one frontmatter key.
2. A list of collection keys in the routing config. Explicit, but a new collection stays hidden until someone edits the list.
3. A new codescout command that lists collections. One reader of the format, but it needs a codescout change and a release before the hook can work.

## Design

1. **Discovery.** Resolve the repository root with `git rev-parse --show-toplevel` from `cwd` (in a worktree this is the worktree). For each of `docs/trackers/ledgers`, `docs/trackers/streams` and `docs/trackers/temp`, list the child folders, skip `archive`, and keep a folder whose `readme.md` has a `hot_cap:` key inside its leading YAML frontmatter. The folder name is the key. Sort the keys.
2. **Call.** For each key, run `<CS_BINARY> hot-view <key> --project <root>` synchronously, in text mode, with a timeout.
3. **Classify each result.**
   - Exit 0 with stdout: shown. If the header line contains `: 0 of `, the collection is *quiet*.
   - Anything else (exit 2, empty stdout, 101, a timeout, a spawn error): *not shown*. Keep the reason only when stdout starts with `NOT SHOWN — `.
4. **Compose one block**, added to `msg` before the connectivity note:
   - `HOT VIEW (codescout hot-view; this hook shows collections whose readme declares hot_cap):`
   - each non-quiet view, verbatim;
   - one line `quiet (0 hot): a, b` when any collection was quiet;
   - one line `not shown: c (<reason>)` when any collection failed with a reason, and `not shown: d (hot-view unavailable)` for a failure without one.
   - If no readme declares `hot_cap`, the hook adds nothing at all. No block, no line.

## My calls (correct any of these)

- **When it fires:** on `startup`, `clear` and `compact`, and not on `resume`. A resumed transcript already holds the last view, while a compact or a clear has lost it.
- **Module shape:** the logic lives in a new `codescout-companion/hooks/hot-view.mjs`, which exports one function that returns the block text. `session-start.mjs` imports it. The function takes the root, the binary path and a clock-free input, so a test can call it with a fake binary.
- **Timeout:** 3 s per call, and at most 8 collections per session start. Collections beyond 8 are listed by name as `not checked: …`, so nothing is hidden silently.
- **Size:** `hot_cap` bounds each view. The hook adds no second cap on the text.
- **Opt-out:** `hot_view: false` in the routing config, the same pattern as `auto_index` and `drift_warnings`.
- **Text mode, not `--json`:** the text is what the agent reads, and the contract defines it. `--json` would need a JavaScript renderer, which is a second renderer.

## Tests (fixtures, fake binary)

- A fake `codescout` script that answers per key: a view, a quiet view, `NOT SHOWN — x` with exit 2, empty stdout with exit 2 (old binary), exit 101, and a sleep past the timeout.
- One collection in each of `ledgers`, `streams` and `temp`, one under `archive/` (must be skipped), and one without `hot_cap` (must not be called).
- No `hot_cap` anywhere: the hook output has no `HOT VIEW` text.
- `source=resume`: no block.
- `hot_view: false`: no block, and the fake binary is never called.
- The rest of the hook output is unchanged in every case.

## Left to the builder

- The exact place of the block in `msg`, as long as it comes before the connectivity note.
- How the test harness points `CS_BINARY` at the fake binary (`session-start.test.sh` already builds a fake `.claude.json` at line 201).
