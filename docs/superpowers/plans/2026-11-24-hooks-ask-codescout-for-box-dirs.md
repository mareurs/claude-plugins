# Hooks ask codescout for box folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `subagent-guidance.mjs` and `hot-view.mjs` stop building tracker paths and ask the codescout binary, so they keep working when codescout moves the boxes to `docs/boxes/<box>/<collection>/`.

**Architecture:** Both hooks call the binary found by `resolveCodescoutBinary` with `spawnSync`, a timeout, and fail-open behaviour, as `hot-view.mjs` already does for `hot-view`. `subagent-guidance.mjs` asks `codescout box --project <root> bugs --json` and reads `shown`; `hot-view.mjs` asks `codescout box --project <root> --json` and takes the collections whose `hot_cap` is not null.

**Tech Stack:** Node ESM hooks, `node:test`-style `.test.mjs` files and bash tests under `tests/`.

**Spec:** codescout `docs/superpowers/specs/2026-11-24-box-collections-design.md`, sections "Code outside codescout" and "Release order" (this plan is step 3 of the release order).

## Global Constraints

- Needs a codescout binary whose `box --json` items carry `dir` and `hot_cap` (release A and later); codescout plan `docs/superpowers/plans/2026-11-24-box-collections.md`, Task 1. The binary on this machine is release B (the new layout), so a repository still on the old layout gets `{"done":false,"not_done":"the boxes use the old layout …"}` from `box --json` and `box bugs --json`, with exit 0 and no `collections` or `shown` (measured 2026-11-25, `codescout 0.15.0`). Both hooks read that answer as "nothing": an empty hot view and no bugs-box line. So the hooks lose those two lines in a repository until `codescout box migrate --apply` runs there.
- No hook builds a path under `docs/trackers/` or `docs/boxes/`.
- A hook never fails the session: a missing binary, a timeout, a non-zero exit or bad JSON gives today's fallback (no bugs box; an empty hot view).
- Timeout: 3000 ms per call (`TIMEOUT_MS` of `hot-view.mjs`).
- `codescout box bugs --json` takes about 70 ms and `codescout box --json` about 190 ms (measured 2026-11-24, codescout 0.15.0, this machine).
- Forward-compatible with release B: use `item.address` when present, else `item.key`, as the argument of `codescout hot-view`.

## Review Focus

1. The binary is on `PATH` in the developer's shell but the test sandbox seals only `HOME` and `CLAUDE_CONFIG_DIR` → each test sets `PATH` to a folder with a fake `codescout` (or none), so the real binary never answers a test.
2. `codescout box --json` from an older binary has no `hot_cap` field → no collection is selected (empty hot view), no crash. Test in Task 2.
3. A collection item with a `problem` → not selected. Test in Task 2.
4. The old-layout refusal (exit 0, no `collections`, no `shown`) → no collection selected, no bugs box. Tests in Task 1 (`hasBugsBox`, the bash test with `oldproj`) and Task 2 (`the_old_layout_refusal_selects_nothing`, and the `session-start.test.sh` case).
5. A readme left at the old path must not make a bugs box: the answer comes from the binary alone. Test in Task 1 (bash test, "a readme at the old path does not make a bugs box").

---

### Task 1: `subagent-guidance.mjs` asks codescout whether a bugs box exists

**Files:**
- Modify: `codescout-companion/hooks/lib.mjs` (new `codescoutJson`, `hasBugsBox`; `spawnSync` import)
- Modify: `codescout-companion/hooks/subagent-guidance.mjs` (imports, the `hasBugsBox` line)
- Modify: `codescout-companion/hooks/subagent-guidance.test.mjs` (tests of `hasBugsBox`)
- Modify: `tests/test-subagent-guidance.sh` (`run_hook` seals `PATH`; fake `codescout`; fixtures `boxproj`, `oldproj`)

**Interfaces:**
- Produces: `export function hasBugsBox(root, binary, timeoutMs = 3000)` and `export function codescoutJson(binary, args, timeoutMs = 3000)` in `lib.mjs`, not in `subagent-guidance.mjs`: that file runs the hook on import, so a test cannot import from it. `hasBugsBox` is true only when `codescoutJson(binary, ['box', '--project', root, 'bugs', '--json'])` gives `shown === true`; `codescoutJson` is `spawnSync` with `{encoding:'utf8', timeout, stdio:['ignore','pipe','ignore']}`, and gives `null` on a missing binary, a timeout, a non-zero exit or output that is not JSON. The hook calls `hasBugsBox(root, resolveCodescoutBinary(cwd))`.

- [x] **Step 1: Write the failing test.** In `tests/test-subagent-guidance.sh`, replace the `mkdir -p .../docs/boxes/bugs/bugs` fixture with a fake `codescout` in `$T/bin` that prints `{"shown":true,"key":"bugs"}` and exits 0 when its arguments are `box --project <boxproj> bugs --json`, else prints `NOT SHOWN — no box bugs` and exits 2; run the hook with `PATH="$T/bin:/usr/bin:/bin"`. Assert: `boxproj` output contains `codescout box bugs list`; `proj` output contains `kind="bug"`; with `PATH="/usr/bin:/bin"` (no binary) both show `kind="bug"`.
- [x] **Step 2: Run** `bash tests/test-subagent-guidance.sh`; expect FAIL (the hook still reads the file).
- [x] **Step 3: Implement `hasBugsBox`**; import `resolveCodescoutBinary` from `./lib.mjs` and `spawnSync` from `node:child_process`; drop the `existsSync(join(...))` line.
- [x] **Step 4: Run** `bash tests/test-subagent-guidance.sh` and `node codescout-companion/hooks/subagent-guidance.test.mjs`; expect PASS.
- [x] **Step 5: Commit** `fix(codescout-companion): subagent guidance asks codescout for the bugs box instead of reading its path`.

---

### Task 2: `hot-view.mjs` takes the hot collections from `codescout box --json`

**Files:**
- Modify: `codescout-companion/hooks/hot-view.mjs` (`LIFECYCLE_DIRS`, `findHotCollections`, `declaresHotCap`, `hotViewBlock`)
- Modify: `codescout-companion/hooks/hot-view.test.mjs` (`readme` helper L18, `fakeBinary` L24)
- Modify: `codescout-companion/hooks/session-start.test.sh` (the hot-view section: its fixture holds a readme file with `hot_cap`, its fake binary answers only `hot-view`, the wrapper test compares the whole log with one line, and the missing-binary test expects a "not shown" line)

**Interfaces:**
- Produces: `export function findHotCollections(root, binary, timeoutMs = TIMEOUT_MS)` returns the sorted names to pass to `hot-view`: for each item of `collections` in `codescout box --project <root> --json` with `hot_cap` a number and `problem` null, `item.address ?? item.key`; `[]` on any failure. `hotViewBlock` passes `binary` and `timeoutMs` to it. `LIFECYCLE_DIRS` and `declaresHotCap` are removed.

- [x] **Step 1: Write failing tests** in `hot-view.test.mjs`: `fakeBinary` also answers `box --project <root> --json` with a `collections` array; tests `selects_collections_with_a_hot_cap` (items `busy` hot_cap 5, `calm` hot_cap 5, `plain` hot_cap null → `['busy','calm']`), `skips_a_collection_with_a_problem`, `an_old_binary_without_hot_cap_selects_nothing` (items without the field → `[]`, block `''`), `prefers_the_address_when_present` (`{key:'bugs', address:'quality/bugs', hot_cap:5}` → `['quality/bugs']`, and the fake is then asked `hot-view quality/bugs --project <root>`). Remove the `readme(root, lifecycle, key, text)` fixture helper.
- [x] **Step 2: Run** `node codescout-companion/hooks/hot-view.test.mjs`; expect FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** the hot-view test and `bash codescout-companion/hooks/session-start.test.sh`; expect PASS.
- [x] **Step 5: Commit** `fix(codescout-companion): the SessionStart hot view asks codescout which collections are hot instead of walking docs/trackers`.

---

### Task 3: Ship

- [x] **Step 1:** Run `bash tests/run-all.sh` (2026-11-25): 3 failed suites, `test-frictions-box.sh`, `test-skill-call-legality.sh` and `migrating-trackers.test.sh`. All three fail the same way on a clean `HEAD`: they meet the release-B binary (old-layout refusal, `docs/boxes` paths, new mapping keys) and are Part 2 work of the spec. No new failure.
- [ ] **Step 2:** Release with `./scripts/release.sh codescout-companion patch` (use `NO_PUSH=1` unless the operator asked for the push). The release does not need release A installed: the binary is already release B. Then run `codescout box migrate` (dry run) in this repository, show it, and run `--apply` only on the operator's word; until then the hot view and the bugs-box line fall back (Global Constraints). `migrate` rewrites citations in `subagent-guidance.mjs` and `pre-tool-guard.mjs`, so run it after the release commit, with a clean tree.
- [ ] **Step 3:** Cold-restart all four profiles (a `resume` is not enough); open a new session and read the hot view in the SessionStart payload.
