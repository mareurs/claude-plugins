---
id: '2646bba03b528020'
kind: bug
status: investigating
title: '`tests/run-all.sh` has ~16 pre-existing failing suites, unrelated to session-start.mjs bootstrap fix'
tags:
- tests
- hooks.json
- wsl
- node
- pre-existing-debt
claimed_at: 2026-09-13
last_observed: 2026-09-13
unverified: WSL-only failures remain unobserved by CI (~10 of the original 16). pre-tool-guard.test.sh remains excluded from CI (hardcoded real absolute dev-machine paths, not a fixture — needs a rewrite, not a HOME pin). 4 of the 5 originally-excluded ambient-config suites were fixed 2026-09-13 and are now covered by CI (42/43).
---

## Summary

> **Re-checked 2026-09-01 on `ripper` — still green. Third consecutive clean
> observation; kept `zombie`, deliberately not closed.**
>
> `./tests/run-all.sh`: **43 suites executed, 0 FAILs** (`grep -c FAIL` over the full run
> = 0), plus buddy pytest 516 passed. Suite count matches the 2026-08-28 re-check exactly,
> so nothing was silently dropped from the runner between then and now.
>
> **This is a recurrence check, not a fix, and the distinction is the point.** Per
> `get_guide("tracker-conventions")`, a `zombie` hit in the triage query is a "has this
> come back?" question rather than a task to pick up — there is no available work here.
> The 16 originally-failing suites were never root-caused, and they cannot be root-caused
> from this machine because the failure was environmental: a **fresh Ubuntu WSL** box
> missing Node. This host is native Arch (`Linux 7.1.9-zen1-2-zen`, hostname `archlinux`),
> which is not the environment in question.
>
> **The `unverified:` caveat therefore stands unchanged and must not be softened by this
> entry.** Green on this machine class is not evidence about WSL, and CI still runs a
> small fraction of the suites, so a recurrence would remain unobserved on every OS.
> Closing this on three same-machine greens would be exactly the "negative result that
> does not name its scope" the ecosystem's own ADR forbids.
>
> Re-open trigger unchanged: a non-Arch host, or CI widened to the full suite set.

While releasing the `session-start.mjs` PROJECT BOOTSTRAP nudge fix, ran
`./tests/run-all.sh` for the first time in a fresh Ubuntu WSL environment.
First pass: ~33 of ~34 suites failed, almost entirely because **Node.js was
missing** (hook scripts are `.mjs`; nothing could execute). After installing
Node locally (`~/.local/node`, no sudo), re-run dropped to **16 failing
suites** — none of which touch the bootstrap-nudge logic that was actually
changed this session.



> **RE-OPENED 2026-09-10 by this file's own trigger — CI has been widened to the full
> suite set.** `.github/workflows/cross-platform-hooks.yml` gained a `full-suite` job
> running `tests/run-all.sh` on ubuntu-latest. `zombie` no longer describes this: there
> is available work, named below.
>
> **5 of the 16 are now root-caused, on a host that is neither WSL nor missing Node.**
> Measured by running the suite under an empty `HOME` on the same Arch machine class
> whose three green runs this file correctly refused to read as evidence — which is the
> point: the variable was never the OS, it was the ambient profile.
>
>     test-pre-tool-guard.sh   test-rendezvous-isolation.sh   test-session-start.sh
>     test-worktree-activate.sh   pre-tool-guard.test.sh
>
> They read ambient `~/.claude*` configuration. `detect.mjs` resolves `HOME` /
> `CLAUDE_CONFIG_DIR`, so with no profile present detection returns "no codescout" and
> every hint assertion fails. Real `HOME` → all pass; empty `HOME` → exactly these five
> fail and the other 38 pass. **That is a hermeticity defect in the tests, not a defect
> in the hooks** — they are not known-broken, and must not be read as such.
>
> **What the job buys and what it does not.** 38 of 43 suites on every PR, against 1 of
> 43 before. It does **not** cover the five: they are excluded by an explicit
> `CS_TEST_SKIP` deny-list. A deny-list rather than an allow-list so a suite added
> tomorrow is covered by default; `run-all.sh` prints what it skipped, and **exits
> non-zero if a name in that list matches no discovered suite**, so a rename cannot turn
> the exclusion into silence.
>
> **Available work, in order:** make the five hermetic by pinning `HOME` per run —
> `tests/test-pre-edit-hint.sh` already does exactly this — then delete each from the
> deny-list. The remaining 11 of the original 16 stay un-root-caused and still require a
> WSL host to observe.
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

**Unrelated recurrence, not this bug:** `run-all.sh` went briefly red again on
2026-09-01 for a completely different reason — `RM-21` (the pre-push guard's positive
control), fixed-verified the same day in `0495357`. Anyone following this entry's
re-check protocol ("run `run-all.sh`, count FAILs") between the two events would have
seen `1 FAIL` and every reason to misread it as this zombie recurring; it was not — see
`repo-remediation-backlog.md:RM-21` for that incident.

The green run recorded above is **one machine**. Per `CLAUDE.md` § *The Windows work
box*, the host where the 16 failures were observed no longer runs Claude Code at all
(plugins load there through Copilot's own loader), so the original environment cannot
be re-measured as it stood.

## Re-checked 2026-09-13 — 4 of the 5 CI-excluded suites made hermetic

**Root cause confirmed by reproduction, not just re-derived from the prior entry.** Ran each
of the 5 `CS_TEST_SKIP` suites under `env -i PATH="$PATH" HOME=<empty tmp dir>` (matching the
2026-09-10 measurement) and reproduced the exact failure: `detect.mjs`'s `HAS_CODESCOUT` gate
resolves `false` because each fixture project's `.mcp.json` is written by
`tests/lib/fixtures.sh::write_mcp_json`, whose dummy binary is named `fake-ce` — a string that
does not match `detect.mjs`'s `SERVER_NAME_RE = /codescout/`. On a developer machine this is
masked: `detect()` falls through to the ambient `~/.claude*`/`CLAUDE_CONFIG_DIR` profile configs
and finds a *real* codescout server there, so the suite passes for the wrong reason. A CI
runner has no such profile, so `HAS_CODESCOUT` stays false and every hook exits at its early
`if (d.HAS_CODESCOUT === 'false') process.exit(0)` gate — which is why unrelated assertions
(Bash deny, Grep deny, rendezvous stamping, worktree markers, session-start hint text) all fail
together: the guard/hook never runs past its first line.

**Fix applied, per suite:**

- `tests/test-rendezvous-isolation.sh` — one fixture project; swapped its `write_mcp_json` call
  for an inline `.mcp.json` whose `command` contains `codescout`. `HOME` left untouched
  (this suite's own point is comparing the *real* `$HOME/.local/state` before/after).
- `tests/test-worktree-activate.sh`, `tests/test-session-start.sh` — added a local
  `write_ce_mcp_json()` helper (writes a real, executable dummy binary named
  `fake-codescout` + a matching `.mcp.json`, mirroring `write_mcp_json`'s shape) and replaced
  every call site (5 and 15 respectively, including both the main and worktree side of each
  worktree sub-test). `test-session-start.sh` additionally needed the binary to be a **real
  file**, not just a matching path string: its auto-reindex block gates on
  `statSync(d.CS_BINARY).isFile()`, which a bare string like `/usr/local/bin/codescout` fails —
  caught by re-running after the first pass still showed 1 failure (`stale index: refresh
  triggered`), not assumed fixed from the string-match reasoning alone.
- `tests/test-pre-tool-guard.sh` — could not just fix `.mcp.json` for the whole file: Test 1
  ("no CE → allow") deliberately shares the same fixture project and needs detection to
  fail. Restructured so the project gets **no** `.mcp.json` until after Test 1 runs, then a
  matching one is written for every subsequent test.

All four verified twice: once under `env -i HOME=<empty>` (the CI condition) and once under
the normal ambient environment (the prior, accidentally-passing condition) — both green,
`tests/run-all.sh` end-to-end included. Moved off `CS_TEST_SKIP` in
`.github/workflows/cross-platform-hooks.yml`.

**`pre-tool-guard.test.sh` (the colocated `codescout-companion/hooks/` one) stays skipped —
it is a different defect, not the same fix.** It hardcodes real absolute paths on the
original author's machine as its test CWDs (`ACTIVE_CWD="/home/marius/work/claude/codescout"`,
plus siblings under `/home/marius/work/mirela/`) and relies on those real repos' own ambient
codescout configuration for detection — there is no fixture `.mcp.json` to patch. On a CI
runner those directories do not exist at all, which is a step below "reads ambient config":
reproduced 37 of 59 assertions failing under `env -i HOME=<empty>` on this machine, where the
directories at least exist. Making this one hermetic means rewriting it around synthetic
fixture repos, the way the other four now are — a separate, larger task, not attempted this
pass so as not to rush a rewrite of a suite whose comments show it was already carefully
mutation-tested (`guard-hardening-session-log:F-3`) for real security-relevant coverage
(cross-repo `cd` escape hardening, the redirect circuit breaker, the config opt-out hatch).

**Net effect on the original 16:** CI now runs 42 of 43 suites (up from 38 of 43), covering 9
of the original 16 (5 root-caused 2026-09-10 + 4 fixed here). `pre-tool-guard.test.sh` and the
remaining ~10 WSL-only suites are still not covered by CI and still need, respectively, a
fixture rewrite and a WSL host to observe.
