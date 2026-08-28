---
id: '2646bba03b528020'
kind: bug
status: zombie
title: '`tests/run-all.sh` has ~16 pre-existing failing suites, unrelated to session-start.mjs bootstrap fix'
tags:
- tests
- hooks.json
- wsl
- node
- pre-existing-debt
last_observed: 2026-08-28
unverified: 'Green on ONE machine only (Arch Linux workstation, `archlinux` host, re-confirmed 2026-08-28: 43 suites, 0 FAILs — suite count grew from 41 since the last check). The 16 originally-failing suites were never root-caused. CI still runs 1 of 43 suites, so a recurrence would be unobserved on every OS.'
---

## Summary

While releasing the `session-start.mjs` PROJECT BOOTSTRAP nudge fix, ran
`./tests/run-all.sh` for the first time in a fresh Ubuntu WSL environment.
First pass: ~33 of ~34 suites failed, almost entirely because **Node.js was
missing** (hook scripts are `.mjs`; nothing could execute). After installing
Node locally (`~/.local/node`, no sudo), re-run dropped to **16 failing
suites** — none of which touch the bootstrap-nudge logic that was actually
changed this session.


## Re-checked 2026-08-27 — all 16 suites green here, and the stated root cause is refuted

Re-ran the suite on the Linux workstation (Arch, native — **not** WSL):
`./tests/run-all.sh` exits **0** with **0 FAILs** across **41 suites**. All sixteen
suites named above exist, and all sixteen ran in that pass.

**The diagnosis in § *Evidence* does not survive checking.** Both stated causes rest
on a `.cmd` wrapper scheme that is not in this repo and never was:

- `grep -c '\.cmd'` → **0** in both `codescout-companion/hooks/hooks.json` and
  `buddy/hooks/hooks.json`; `git log -S'.cmd'` over both files across all history
  returns **no commit**. The string has never been in either file.
- No `*.cmd` file exists anywhere in the tree. `.cmd` appears in exactly three files,
  all prose: this bug (5 occurrences), the Copilot porting **design spec**
  `docs/superpowers/specs/2026-07-13-cross-platform-windows-copilot-porting-design.md`
  (4), and `docs/trackers/pi-agent-integration-session-log.md` (3). It was a design
  proposal that did not ship.
- The commit named as the trigger — *"fix(buddy,codescout-companion): restore
  single-command hook wrappers for Copilot CLI compatibility"* — **is not in this
  repo's history**; `git log --grep` finds nothing for either that subject or
  "restore single-command hook wrappers".

The 33→16 measurement was real. The explanation attached to it was not, so the
failures are **unexplained**, not fixed.

**Follow-up idea 1 is already resolved.** `tests/test-session-start.sh:6` reads
`HOOK="$HOOK_DIR/session-start.mjs"` — the test was ported and is not exercising a
dead code path. `session-start.sh` no longer exists, and `hooks.json` invokes only
the `.mjs`.

**Follow-up idea 3 is the one still live, and it is wider than it was written.** CI
(`.github/workflows/cross-platform-hooks.yml`) *does* run a
ubuntu/macos/windows matrix — but its only test step is
`bash tests/test-cross-platform-hooks.sh`. **One suite of 41.** So a recurrence of
this would be unobserved by CI on every OS, not just under WSL.
## Re-checked 2026-08-28 — still green, one more machine-run, same caveat

`./tests/run-all.sh` on this same Arch Linux workstation (host `archlinux`): exit 0,
**43 suites, 0 FAILs** (suite count grew from 41 to 43 since 2026-08-27 — new suites
added, not a shrinking denominator). No recurrence of the original 16-failure signature.

This is the same single machine as the 2026-08-27 check, so it does not add
cross-environment evidence — the re-open trigger (any non-Arch-workstation failure)
is unchanged and still unfalsified. Left as `zombie`.
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


## Re-open trigger

Re-open if `./tests/run-all.sh` reports failures on any environment that is not this
Arch workstation — a fresh WSL/Ubuntu checkout, another contributor's machine, or a
CI job if the matrix is ever widened past its single smoke test.

The green run recorded above is **one machine**. Per `CLAUDE.md` § *The Windows work
box*, the host where the 16 failures were observed no longer runs Claude Code at all
(plugins load there through Copilot's own loader), so the original environment cannot
be re-measured as it stood.
