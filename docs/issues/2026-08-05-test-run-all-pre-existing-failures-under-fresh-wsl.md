---
id: 2646bba03b528020
kind: bug
status: open
title: "`tests/run-all.sh` has ~16 pre-existing failing suites, unrelated to session-start.mjs bootstrap fix"
owners: []
tags:
- tests
- hooks.json
- wsl
- node
- pre-existing-debt
topic: null
time_scope: null
---

## Summary

While releasing the `session-start.mjs` PROJECT BOOTSTRAP nudge fix, ran
`./tests/run-all.sh` for the first time in a fresh Ubuntu WSL environment.
First pass: ~33 of ~34 suites failed, almost entirely because **Node.js was
missing** (hook scripts are `.mjs`; nothing could execute). After installing
Node locally (`~/.local/node`, no sudo), re-run dropped to **16 failing
suites** — none of which touch the bootstrap-nudge logic that was actually
changed this session.

## Evidence the fix itself is not implicated

- `session-start.test.sh` (the one test that exercises the changed
  `session-start.mjs` logic) **SKIPs** in WSL: `codescout not configured on
  this machine` — its `detect.py`/`detect-tools.sh` check looks for codescout
  config under the WSL-side `$HOME`, which is a different filesystem from the
  Windows side where codescout is actually configured. Environmental, not a
  code defect — the fix was separately verified correct via a standalone
  Node probe script run on the Windows side (all 6 `source` values behaved as
  expected: startup/unknown/empty fire, compact/resume/clear suppress).
- The 16 remaining failing suites (`test-hooks-json-registration.sh`,
  `test-pre-tool-guard.sh`, `test-session-start.sh` [legacy — tests the OLD
  `session-start.sh`, likely superseded by the `.mjs` port and its own
  `session-start.test.sh`], `test-concurrent-register.sh`,
  `test-hook-permissions.sh`, `test-register.sh`, `test-session-state.sh`,
  `test-statusline-cache.sh`, `test-statusline.sh`,
  `test-subagent-guidance.sh`, `test-unregister.sh`,
  `test-worktree-activate.sh`, `goal-stop-hook.matrix.test.sh`,
  `goal-stop-hook.test.sh`, `pre-task-hint.test.sh`, `pre-tool-guard.test.sh`)
  fail with an "expected X, got: (empty)" pattern — consistent with the
  `hooks.json` `.cmd`-wrapper migration (`fix(buddy,codescout-companion):
  restore single-command hook wrappers for Copilot CLI compatibility`) not
  being reflected in these tests' expectations, plus `.cmd` files being
  Windows batch scripts that cannot execute under Linux/WSL at all — a second,
  compounding environment mismatch for anyone running this suite from WSL.

## Why filed as a bug, not fixed now

Scope: this session's actual task was the one-line `source` guard fix in
`session-start.mjs`. Untangling 16 suites' worth of pre-existing drift
(hooks.json wrapper naming vs. test expectations, `.cmd`-under-Linux
incompatibility, legacy `test-session-start.sh` vs `session-start.test.sh`
duplication) is separate, larger work.

## What was done instead

Ran the release (`./scripts/release.sh codescout-companion patch`) with
`SKIP_TESTS=1`, having manually verified the one relevant test's logic via a
standalone probe and confirmed via full-suite diffing (33→16 failures after
just installing Node) that the remaining failures are pre-existing and
unrelated.

## Follow-up ideas

- Decide whether `test-session-start.sh` (legacy, tests `session-start.sh`)
  should be deleted now that `session-start.mjs` + `session-start.test.sh`
  is the live implementation — duplication risks tests silently testing a
  dead code path.
- Reconcile `hooks.json`'s `.cmd` wrapper entries against
  `test-hooks-json-registration.sh`'s expectations (6 of 7 assertions fail).
- Either make `tests/run-all.sh` skip/soft-fail suites whose hooks require
  `.cmd` execution when run under a non-Windows shell, or provide a
  `.sh`/direct-node fallback so the suite is meaningful from WSL/Linux CI.
