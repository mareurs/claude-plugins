---
id: '892d64dc03e2fd82'
kind: plan
status: draft
title: Session-Start Hot View Implementation Plan
tags:
- codescout-companion
- hooks
- hot-view
topic: collection-hot-path
---

# Session-Start Hot View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `codescout-companion` SessionStart hook injects the `codescout hot-view` output of every lifecycle collection whose readme declares `hot_cap`.

**Architecture:** A new module `codescout-companion/hooks/hot-view.mjs` finds the collections, calls the binary once per collection, and composes one text block. `session-start.mjs` calls it with the repository root and `d.CS_BINARY`, and appends the block to `msg` before the connectivity note. The module reads one frontmatter key; everything shown comes from the binary.

**Tech Stack:** Node ESM (`node:fs`, `node:path`, `node:child_process` `spawnSync`), `node:assert/strict` tests, bash + `jq` for the hook-level test.

**Spec:** `docs/superpowers/specs/2026-11-15-session-start-hot-view-design.md` (approved 2026-11-15). Contract consumed: codescout `docs/superpowers/plans/2026-11-15-collection-hot-view.md` § Contract for the hook (branch `integration/identity-lifecycle-20261114`, `5d655bfef`). Findings: `docs/trackers/collection-hot-path-session-log.md` F-1 to F-4, W-1.

## Global Constraints

- Lifecycle folders, exactly: `docs/trackers/ledgers`, `docs/trackers/streams`, `docs/trackers/temp`. Skip a child folder named `archive`.
- Call shape, exactly: `<binary> hot-view <key> --project <root>`. Text mode, never `--json`.
- Timeout 3000 ms per call. At most 8 collections per session start.
- Header line of the block, exactly: `HOT VIEW (codescout hot-view; this hook shows collections whose readme declares hot_cap):`
- Shown = exit 0 and non-empty stdout. Every other outcome (exit 2, empty stdout, 101, timeout, spawn error) = not shown. A reason is read only when stdout starts with `NOT SHOWN — ` (em dash, U+2014).
- Quiet = shown, and the first stdout line contains `: 0 of `.
- No `hot_cap` in any readme → the block is the empty string (no header, no line).
- Fires on every `source` except `resume`. Routing config `hot_view: false` switches it off.
- The installed binary has no `hot-view` (F-1): nothing in this plan may need a real `codescout` with that command. Tests use a fake binary.
- No change to any other part of the hook output. No version bump in a feature commit (release goes through `./scripts/release.sh`).

## Review Focus

1. **`hot_cap` in the readme body but not in the frontmatter.** Expect: not selected, binary not called (Task 1 test `hot_cap_outside_frontmatter_is_ignored`).
2. **A readme with CRLF line endings.** Expect: frontmatter parsed, collection selected (Task 1 test `crlf_readme_is_selected`).
3. **The same key in two lifecycle folders.** Expect: the binary is called once for it; its exit-2 `Ambiguous` refusal shows as `not shown` (Task 1 test `duplicate_key_is_called_once`).
4. **A view whose stdout ends with extra blank lines.** Expect: the block has no run of blank lines between views (Task 1 test `trailing_newlines_are_trimmed`).
5. **`d.CS_BINARY` empty or a path that does not exist.** Expect: the rest of the hook output is unchanged and each collection is listed as `not shown: <key> (hot-view unavailable)` (Task 1 test `missing_binary_is_unavailable`, Task 2 hook test).

---

### Task 1: `hot-view.mjs` — discovery, call, block

**Files:**
- Create: `codescout-companion/hooks/hot-view.mjs`
- Test: `codescout-companion/hooks/hot-view.test.mjs` (picked up by `tests/run-all.sh` through `"$HOOK_TESTS_DIR"/*.test.mjs`)

**Interfaces:**
- Produces:

```js
export const LIFECYCLE_DIRS = ['ledgers', 'streams', 'temp'];
export const MAX_COLLECTIONS = 8;
export const TIMEOUT_MS = 3000;
// Sorted, de-duplicated keys of collections whose readme frontmatter declares `hot_cap`.
export function findHotCollections(root: string): string[]
// The whole block, ending in '\n\n', or '' when findHotCollections(root) is empty.
export function hotViewBlock({ root: string, binary: string, timeoutMs = TIMEOUT_MS, maxCollections = MAX_COLLECTIONS }): string
```

Block layout (lines omitted when empty, in this order):

```
HOT VIEW (codescout hot-view; this hook shows collections whose readme declares hot_cap):
<each non-quiet view's stdout, trailing whitespace trimmed, one after another>
quiet (0 hot): <key>, <key>
not shown: <key> (<reason>); <key> (hot-view unavailable)
not checked: <key>, <key> (limit 8 per session start)
<blank line>
```

`<reason>` is the rest of the first stdout line after `NOT SHOWN — `. `findHotCollections` treats a readme as having frontmatter only when its first line is `---`; the frontmatter ends at the next line that is exactly `---` (after stripping `\r`). It selects the readme when a frontmatter line matches `/^hot_cap\s*:/`. Every fs error means "not selected".

- [ ] **Step 1: Write the fixture helpers and the failing tests** in `hot-view.test.mjs`.

Helpers: `mkRoot()` makes a temp dir; `readme(root, lifecycle, key, text)` writes `docs/trackers/<lifecycle>/<key>/readme.md`; `fakeBinary(dir)` writes an executable bash script that appends `"$2|$4"` to `<dir>/calls.log` and answers by key (`$2`):

| key | stdout | exit |
|---|---|---|
| `busy` | `hot view: busy (docs/trackers/ledgers/busy): 1 of 1 hot, 1 live. Scope: x.\n- [[e1]] t: open since 2026-11-01\n\n\n` | 0 |
| `calm` | `hot view: calm (docs/trackers/streams/calm): 0 of 0 hot, 0 live. Scope: x.\n` | 0 |
| `refused` | `NOT SHOWN — broken readme\n` | 2 |
| `old` | (stderr `error: unrecognized subcommand 'hot-view'`) | 2 |
| `panic` | | 101 |
| `slow` | `sleep 5` | 0 |
| `empty` | | 0 |

`FM = (extra) => '---\ntitle: T\n' + extra + '---\n# body\n'`.

Tests, with their assertions:

- `no_hot_cap_anywhere_gives_empty_block`: one readme with `FM('')` → `hotViewBlock(...) === ''` and `calls.log` does not exist.
- `selects_all_three_lifecycles_and_skips_archive`: `ledgers/busy`, `streams/calm`, `temp/refused` with `FM('hot_cap: 5\n')`, plus `ledgers/archive/` holding a readme with `hot_cap` and `ledgers/nocap` with `FM('')` → `findHotCollections(root)` deep-equals `['busy', 'calm', 'refused']`.
- `hot_cap_outside_frontmatter_is_ignored` (RF1): `ledgers/a` with `'---\ntitle: T\n---\nhot_cap: 5\n'` → `[]`.
- `crlf_readme_is_selected` (RF2): `ledgers/a` with `FM('hot_cap: 5\n').replaceAll('\n', '\r\n')` → `['a']`.
- `duplicate_key_is_called_once` (RF3): `ledgers/refused` and `temp/refused`, both with `hot_cap` → `findHotCollections` gives `['refused']`; after `hotViewBlock`, `calls.log` has exactly one line.
- `composes_the_documented_block`: collections `busy`, `calm`, `refused`, `old`, `panic`, `empty` → the block equals, exactly:

```
HOT VIEW (codescout hot-view; this hook shows collections whose readme declares hot_cap):
hot view: busy (docs/trackers/ledgers/busy): 1 of 1 hot, 1 live. Scope: x.
- [[e1]] t: open since 2026-11-01
quiet (0 hot): calm
not shown: empty (hot-view unavailable); old (hot-view unavailable); panic (hot-view unavailable); refused (broken readme)

```

  and every `calls.log` line ends with `|<root>`.
- `trailing_newlines_are_trimmed` (RF4): covered by the exact string above (`busy` emits three trailing newlines); add `assert.doesNotMatch(block, /\n\n\n/)`.
- `timeout_is_not_shown`: collection `slow`, `timeoutMs: 300` → block contains `not shown: slow (hot-view unavailable)`, and the call returns in under 2000 ms.
- `limit_lists_the_rest_as_not_checked`: ten collections `c0`..`c9` with `hot_cap` (fake answers unknown keys with exit 2, empty stdout), `maxCollections: 8` → `calls.log` has 8 lines and the block ends with `not checked: c8, c9 (limit 8 per session start)\n\n`.
- `missing_binary_is_unavailable` (RF5): `binary: ''` and, separately, `binary: '/nonexistent/codescout'` → both blocks contain `not shown: busy (hot-view unavailable)` and the call does not throw.

- [ ] **Step 2: Run the tests and see them fail.**

Run: `node codescout-companion/hooks/hot-view.test.mjs`
Expected: FAIL, `Cannot find module` … `hot-view.mjs`.

- [ ] **Step 3: Implement `findHotCollections` and `hotViewBlock` in `hot-view.mjs`** with the interfaces and layout above. `spawnSync(binary, ['hot-view', key, '--project', root], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] })`; an empty `binary` is not spawned and counts as unavailable. Wrap the whole function body in `try` and return `''` on an unexpected error, so the hook can never fail through this module.

- [ ] **Step 4: Run the tests and see them pass.**

Run: `node codescout-companion/hooks/hot-view.test.mjs`
Expected: exit 0, every test reported as passed.

- [ ] **Step 5: Commit.**

```bash
git add codescout-companion/hooks/hot-view.mjs codescout-companion/hooks/hot-view.test.mjs
git commit -m "feat(companion): hot-view.mjs composes the session-start hot view block"
```

---

### Task 2: Wire the block into `session-start.mjs`

**Files:**
- Modify: `codescout-companion/hooks/session-start.mjs` (imports at lines 9-16; a new section after the auto-reindex config parse, which ends near line 273, and before `// Connectivity note.`; the header comment at lines 1-7 gains "hot view")
- Test: `codescout-companion/hooks/session-start.test.sh` (a new section at the end, before the summary)

**Interfaces:**
- Consumes: `hotViewBlock({ root, binary })` from Task 1.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing hook test** in `session-start.test.sh`. Build a git repo `$TMP/hv-repo` (`git init -q`) with `docs/trackers/ledgers/busy/readme.md` holding `hot_cap: 5` in its frontmatter. Build a profile dir `$TMP/hv-cfg` whose `.claude.json` is `{"mcpServers":{"codescout":{"command":"<fake>"}}}`, where `<fake>` is a bash script that prints the `busy` view from Task 1 and appends to `$TMP/hv-calls.log` (the same profile pattern as `NEST_CFG` at line 201). A helper `hv_ctx <source>` pipes `{"cwd":"$TMP/hv-repo","source":"<source>","session_id":"hv-<source>"}` into the hook with `CLAUDE_CONFIG_DIR="$TMP/hv-cfg"` and prints `additionalContext`. Assertions:
  - `startup`: context contains `HOT VIEW (codescout hot-view;` and `- [[e1]] t: open since 2026-11-01`, and the `HOT VIEW` line comes before `codescout: Detected in config`.
  - `compact` and `clear`: context contains `HOT VIEW`.
  - `resume`: context does not contain `HOT VIEW`.
  - Opt-out: with `$TMP/hv-repo/.claude/codescout-routing.json` = `{"hot_view": false}`, `startup` context has no `HOT VIEW` and `hv-calls.log` gains no line. Remove the file after this case.
  - Unavailable binary (RF5): with the profile's command set to `$TMP/does-not-exist`, `startup` context contains `not shown: busy (hot-view unavailable)` and still contains `codescout: Detected in config` and `CODESCOUT RULES`.
  - No `hot_cap`: after rewriting the readme without `hot_cap`, `startup` context has no `HOT VIEW`.

- [ ] **Step 2: Run it and see the new assertions fail.**

Run: `bash codescout-companion/hooks/session-start.test.sh`
Expected: the new `HOT VIEW` assertions FAIL; every existing assertion still passes.

- [ ] **Step 3: Implement the wiring.** Import `hotViewBlock` from `./hot-view.mjs`. Read `rc.hot_view === false` into a `hotView` flag in the existing routing-config parse (beside `auto_index` and `drift_warnings`). Then, when `hotView && source !== 'resume'`, take `root = git(cwd, ['rev-parse', '--show-toplevel'])` and, when it is non-empty, `msg += hotViewBlock({ root, binary: d.CS_BINARY })`. Place this before `// Connectivity note.`.

- [ ] **Step 4: Run the hook test and the whole suite.**

Run: `bash codescout-companion/hooks/session-start.test.sh` → every assertion passes.
Run: `./tests/run-all.sh` → all suites green, including `hot-view.test.mjs`.

- [ ] **Step 5: Commit.**

```bash
git add codescout-companion/hooks/session-start.mjs codescout-companion/hooks/session-start.test.sh
git commit -m "feat(companion): session-start injects the hot view of collections that declare hot_cap"
```

- [ ] **Step 6: Record the outcome.** Add a short `## Outcome` section to this plan (commits, test counts). Note in the session log, through `doc(update)` on F-1, that the hook is built and stays dormant until a codescout release with `hot-view` is installed. Do not run `release.sh`: the operator decides when to release.

## Self-review notes

- Spec coverage: Discovery → Task 1 (`findHotCollections`, three folders, archive skip); Call → Task 1 (`spawnSync`, 3 s); Classify → Task 1 (`composes_the_documented_block`, `timeout_is_not_shown`); Compose and the empty case → Task 1; fires on all but `resume`, opt-out, placement before the connectivity note → Task 2; tests listed in the spec → Tasks 1 and 2; F-4 quiet line → `composes_the_documented_block`.
- One deviation from the spec text, as a call: the spec said "on `startup`, `clear` and `compact`". This plan fires on every `source` except `resume`, so an unknown or empty `source` from another client still gets the view. This follows the hook's own `BOOTSTRAP_SUPPRESSED_SOURCES` reasoning (lines 190-197).
