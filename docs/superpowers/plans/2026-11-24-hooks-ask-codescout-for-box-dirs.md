# Hooks ask codescout for box folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `subagent-guidance.mjs` and `hot-view.mjs` stop building tracker paths and ask the codescout binary, so they keep working when codescout moves the boxes to `docs/boxes/<box>/<collection>/`.

**Architecture:** Both hooks call the binary found by `resolveCodescoutBinary` with `spawnSync`, a timeout, and fail-open behaviour, as `hot-view.mjs` already does for `hot-view`. `subagent-guidance.mjs` asks `codescout box --project <root> bugs --json` and reads `shown`; `hot-view.mjs` asks `codescout box --project <root> --json` and takes the collections whose `hot_cap` is not null.

**Tech Stack:** Node ESM hooks, `node:test`-style `.test.mjs` files and bash tests under `tests/`.

**Spec:** codescout `docs/superpowers/specs/2026-11-24-box-collections-design.md`, sections "Code outside codescout" and "Release order" (this plan is step 3 of the release order).

## Global Constraints

- Needs codescout release A (each item of `collections` in `codescout box --json` carries `dir` and `hot_cap`); codescout plan `docs/superpowers/plans/2026-11-24-box-collections.md`, Task 1.
- No hook builds a path under `docs/trackers/` or `docs/boxes/`.
- A hook never fails the session: a missing binary, a timeout, a non-zero exit or bad JSON gives today's fallback (no bugs box; an empty hot view).
- Timeout: 3000 ms per call (`TIMEOUT_MS` of `hot-view.mjs`).
- `codescout box bugs --json` takes about 70 ms and `codescout box --json` about 190 ms (measured 2026-11-24, codescout 0.15.0, this machine).
- Forward-compatible with release B: use `item.address` when present, else `item.key`, as the argument of `codescout hot-view`.

## Review Focus

1. The binary is on `PATH` in the developer's shell but the test sandbox seals only `HOME` and `CLAUDE_CONFIG_DIR` → each test sets `PATH` to a folder with a fake `codescout` (or none), so the real binary never answers a test.
2. `codescout box --json` from an older binary has no `hot_cap` field → no collection is selected (empty hot view), no crash. Test in Task 2.
3. A collection item with a `problem` → not selected. Test in Task 2.

---

### Task 1: `subagent-guidance.mjs` asks codescout whether a bugs box exists

**Files:**
- Modify: `codescout-companion/hooks/subagent-guidance.mjs` (imports L22-23, `hasBugsBox` L47)
- Modify: `tests/test-subagent-guidance.sh` (L100-115)

**Interfaces:**
- Produces: `export function hasBugsBox(root, binary, timeoutMs = 3000)` in `subagent-guidance.mjs` (exported for tests; the hook calls it with `resolveCodescoutBinary(root)`): true only when `spawnSync(binary, ['box', '--project', root, 'bugs', '--json'], {encoding:'utf8', timeout, stdio:['ignore','pipe','ignore']})` exits 0 and its JSON has `shown === true`.

- [ ] **Step 1: Write the failing test.** In `tests/test-subagent-guidance.sh`, replace the `mkdir -p .../docs/trackers/ledgers/bugs` fixture with a fake `codescout` in `$T/bin` that prints `{"shown":true,"key":"bugs"}` and exits 0 when its arguments are `box --project <boxproj> bugs --json`, else prints `NOT SHOWN — no box bugs` and exits 2; run the hook with `PATH="$T/bin:/usr/bin:/bin"`. Assert: `boxproj` output contains `codescout box bugs list`; `proj` output contains `kind="bug"`; with `PATH="/usr/bin:/bin"` (no binary) both show `kind="bug"`.
- [ ] **Step 2: Run** `bash tests/test-subagent-guidance.sh`; expect FAIL (the hook still reads the file).
- [ ] **Step 3: Implement `hasBugsBox`**; import `resolveCodescoutBinary` from `./lib.mjs` and `spawnSync` from `node:child_process`; drop the `existsSync(join(...))` line.
- [ ] **Step 4: Run** `bash tests/test-subagent-guidance.sh` and `node codescout-companion/hooks/subagent-guidance.test.mjs`; expect PASS.
- [ ] **Step 5: Commit** `fix(codescout-companion): subagent guidance asks codescout for the bugs box instead of reading its path`.

---

### Task 2: `hot-view.mjs` takes the hot collections from `codescout box --json`

**Files:**
- Modify: `codescout-companion/hooks/hot-view.mjs` (`LIFECYCLE_DIRS`, `findHotCollections`, `declaresHotCap`, `hotViewBlock`)
- Modify: `codescout-companion/hooks/hot-view.test.mjs` (`readme` helper L18, `fakeBinary` L24)

**Interfaces:**
- Produces: `export function findHotCollections(root, binary, timeoutMs = TIMEOUT_MS)` returns the sorted names to pass to `hot-view`: for each item of `collections` in `codescout box --project <root> --json` with `hot_cap` a number and `problem` null, `item.address ?? item.key`; `[]` on any failure. `hotViewBlock` passes `binary` and `timeoutMs` to it. `LIFECYCLE_DIRS` and `declaresHotCap` are removed.

- [ ] **Step 1: Write failing tests** in `hot-view.test.mjs`: `fakeBinary` also answers `box --project <root> --json` with a `collections` array; tests `selects_collections_with_a_hot_cap` (items `busy` hot_cap 5, `calm` hot_cap 5, `plain` hot_cap null → `['busy','calm']`), `skips_a_collection_with_a_problem`, `an_old_binary_without_hot_cap_selects_nothing` (items without the field → `[]`, block `''`), `prefers_the_address_when_present` (`{key:'bugs', address:'quality/bugs', hot_cap:5}` → `['quality/bugs']`, and the fake is then asked `hot-view quality/bugs --project <root>`). Remove the `readme(root, lifecycle, key, text)` fixture helper.
- [ ] **Step 2: Run** `node codescout-companion/hooks/hot-view.test.mjs`; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the hot-view test and `bash codescout-companion/hooks/session-start.test.sh`; expect PASS.
- [ ] **Step 5: Commit** `fix(codescout-companion): the SessionStart hot view asks codescout which collections are hot instead of walking docs/trackers`.

---

### Task 3: Ship

- [ ] **Step 1:** Run `bash tests/run-all.sh` and compare with its known pre-existing failures (codescout bug `2026-11-24-tests-run-all-sh-has-16-pre-existing-failing-suites`); no new failure.
- [ ] **Step 2:** Release per this repository's process, after codescout release A is installed on this machine; then reload plugins (`/reload-plugins`) and open a new session to see the hot view.
