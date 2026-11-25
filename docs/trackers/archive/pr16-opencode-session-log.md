---
id: 05a908d9fb08e31b
kind: tracker
status: archived
title: PR16 OpenCode audit session log
tags:
- pr16
- opencode
- review
topic: pr16-opencode
archived_on: 2026-11-25
entry_high_water_F: 5
entry_prefix:
- F
- W
snapshot_anchor: '| ID | Date | Severity | Status | Finding |'
---

## Scope
Audit PR #16 and reconcile current main in the native worktree. Original head: `3cee73cabc688442786839056c79d8a45b9c9a0c`. Plan: `c00c42d403fe1bb2`.

## Index
| ID | Date | Severity | Status | Finding |
| --- | --- | --- | --- | --- |
| F-1 | 2026-11-18 | med | fixed-verified | Report fixtures inherit an ancestor project marker |
| F-2 | 2026-11-18 | high | wontfix-false-alarm | Controlled cwd probe confirms original server layout loads |
| F-3 | 2026-11-18 | med | fixed-verified | Timed-out hooks survive when they ignore SIGTERM |
| F-4 | 2026-11-18 | med | fixed-verified | TUI lifecycle cleanup mutations survive helper-only tests |
| F-5 | 2026-11-18 | low | fixed-verified | Missing PyYAML warning contradicts core SessionStart behavior |

## F-1 — Report fixtures inherit an ancestor project marker

**Valid:** dated 2026-11-18

**Observed:** Original PR adapter suite exited 1: 177 passed, 3 report tests failed. Report output resolved the project to `/home/marius`; direct filesystem check found `/home/marius/.codescout/project.toml`. `TMPDIR=/tmp node harnesses/opencode/tests/test-tui.mjs` passed 31. `resolve_project_root()` correctly selects the nearest ancestor marker, but the report fixture had none.

**Impact:** Environment-dependent false failures hide runtime review results. No runtime defect established by this evidence.

**Status:** fixed-verified — fixture gets its own `.codescout/project.toml`; original TMPDIR TUI suite passes all 31 and complete adapter passes 180/0.

## F-2 — OpenCode 2.2.7 does not discover installed server files

**Observed:** Initial isolated config listing from the worktree showed only TUI sources. A directory control was confounded by changing cwd. Repeating with the ORIGINAL layout in the SAME temporary project cwd loads all five bare `.js` server plugins on 2.2.7. Thus the initial listing does not establish a loader defect.

**Evidence:** `/tmp/pr16-opencode-load.Axx8yR/original-layout-control.log` has loading events for buddy, codescout-companion, legible, sdd and session-bridge. No installer change made.

**Status:** wontfix-false-alarm — original hypothesis refuted by controlled execution.

## F-3 — Timed-out hooks survive when they ignore SIGTERM

**Valid:** dated 2026-11-18

**Observed:** Added real-process regression: hook installs a SIGTERM handler, writes its own PID, stays alive. `runHook` with 1500 ms deadline returns null, but `process.kill(pid, 0)` still succeeds after 400 ms. Suite exits 1 with missing expected ESRCH. Existing normal-process tree test passes, so it does not pin this case.

**Evidence:** background job `@bg_00000013` (server3458708); regression in `test-codescout-companion.mjs`. Test always kills its own PID in finally.

**Impact:** A timeout bounds waiting but leaks uncooperative hook processes. Repeated calls can accumulate them in the long-lived OpenCode service.

**Status:** fixed-verified — SIGKILL for the POSIX process group (Windows already taskkill /T /F). Adapter 184/0; reviewer independently reproduced the old leak, observed fixed suite 29/0, then reverted the signal and observed 28/1.

## F-4 — TUI lifecycle cleanup mutations survive helper-only tests

**Valid:** dated 2026-11-18

**Observed:** Independent reviewer applied 11 mutations in `/tmp/pr16-review`: M1–M8 killed, M9–M11 survived. Surviving mutations replace cleanup with a no-op in hint-echo, statusline and buddy. Each original TUI suite run exits 0 with 31 pass. Actual production cleanup is present; exported-helper tests never exercise setup/unload.

**Evidence:** `/tmp/pr16-review/M9-hint-cleanup.log`, M10/M11 logs and reviewer report. New `test-tui-lifecycle.mjs` stubs only the unavailable OpenTUI/Solid imports, invokes the actual three setup methods, observes interval registrations, triggers Buddy pending debounce, then verifies clearInterval/clearTimeout/unlisten on cleanup. Baseline 3 passed.

**Status:** fixed-verified — reviewer reran all three original surviving mutants against the new lifecycle suite: each now exits 1, 2 pass/1 fail. Baseline 3/0. Final review across 12 distinct mutants: 12 killed, 0 surviving, 0 equivalent.

## F-5 — Missing PyYAML warning contradicts core SessionStart behavior

**Valid:** dated 2026-11-18

**Observed:** New installer warning and README claim SessionStart does nothing without PyYAML. Actual `buddy/scripts/hook_entry.py::run_session_start` catches consolidation import failures separately, updates PPID mapping and executes core state handling. Existing cross-platform launcher regression explicitly covers missing PyYAML. Strengthened adapter assertion to require the affected optional feature; before changing the warning, adapter exits 1 (180 pass, 1 failure), `/tmp/pr16-pyyaml-red.log`.

**Fix:** Warning and requirements now identify memory consolidation as unavailable; core hooks still run. No Buddy Python runtime change.

**Status:** fixed-verified — complete adapter 184 passed, 0 failed, including the strengthened warning assertion.

## Independent review — 2026-11-18

Reviewer approved the reviewed follow-up changes with no outstanding correctness findings in scope. Twelve distinct mutations were actually applied in `/tmp/pr16-review`; final relevant suites killed all twelve (0 surviving, 0 equivalent). M9–M11 had survived before lifecycle tests and were reapplied afterward.

| Mutated behavior | Final pass / fail |
| --- | --- |
| compact notice injected into summary | 31 / 1 |
| child ID used for tool state | 31 / 1 |
| context injected into child sessions | 30 / 2 |
| compact notice repeated on later turns | 30 / 2 |
| failed family lookup cached permanently | 29 / 3 |
| sidebar chooses child | 30 / 1 |
| sidebar ignores changed inputs | 30 / 1 |
| TUI family-root mapping removed | 29 / 2 |
| hint-echo cleanup removed | 2 / 1 |
| statusline cleanup removed | 2 / 1 |
| buddy cleanup removed | 2 / 1 |
| timeout uses SIGTERM again | 28 / 1 |

Raw logs remain under `/tmp/pr16-review/M*.log`. This review does not independently establish Windows taskkill behavior, live TUI visual behavior or real LLM judge operation. OpenCode 2.2.7 isolated loading was probed separately (F-2); no visual claim is made. The broader harness identity issue remains KNOWN (`33de9ea8980e85c9`).

## Integration completed — 2026-11-18

User authorized merge and owner notification. PR #16 squash-merged as `297e2055101476eb07c6e0ba91f52facbad7b44b`; merged and reviewed head `99da8f16b20725e51a3836b4898981a859dff6d6` share tree `7cd67ff3e47bc9d214e0e84cff37c109ad1d0539`.

All five CI checks passed: https://github.com/mareurs/claude-plugins/actions/runs/44320248454. The final local full run's four affected suites subsequently passed after removing only verified empty temporary-root `.git` markers. Native worktree catalog rows were reseated to main; frontmatter IDs repaired for these two artifacts only.

Author notified: https://github.com/mareurs/claude-plugins/pull/16#issuecomment-6981359840. Main checkout synchronized; pre/post unstaged patches and untracked path lists matched exactly. No plugin release or profile configuration changes were performed.

## Template for new entries
Entries record observed evidence, impact and verification.
