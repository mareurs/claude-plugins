---
id: '6a68ed5aa51727b5'
kind: tracker
status: active
title: Session Log — S4 systematic debugging
tags:
- systematic-debugging
- effort-steering
topic: s4-debug
entry_prefix:
- F
- W
snapshot_anchor: '| ID | Date | Severity | Status | Finding |'
entry_high_water_F: 1
---

# S4 systematic debugging

## Scope

Investigate the local S4 failures observed during PR #10 verification. The user requested systematic debugging after that PR merged. Work is isolated in the native managed worktree; existing session-bridge changes in the shared checkout are untouched.

## Index

| ID | Date | Severity | Status | Finding |
|----|------|----------|--------|---------|
| F-1 | 2026-11-18 | med | fixed-verified | Real policy CLI timeout propagates as a prompt failure into unrelated S4 assertions. |

## F-1 — Real 500 ms preflight timeout makes unrelated S4 semantic tests see zero simulated calls

**Observed:** 2026-11-18. A clean native worktree at b9f87db passed an uninstrumented S4 run. A diagnostic run also passed. In three further sequential instrumented runs, rounds one and two exited zero; round three failed naturally, without synthetic load.

**Evidence:** The prose-refusal test expected 13 simulated Claude calls but saw zero. The same case's adapter spawn returned ETIMEDOUT with timeout=500, elapsedMs=1097.837389, status=0, signal=null and empty stderr. The next records show adapter_timeout with steer=null at prompt index 1, then stop=[prompt_not_steerable], notSteerable=[1], latency=null. This establishes the complete propagation chain, not only a correlated assertion failure. Raw output is in codescout background buffer @bg_0000003f (ephemeral).

**Cause:** S4 orchestration tests inject fake model/hook spawning and clocks, but still run a real policy CLI during preflight with the adapter's 500 ms production deadline. A host-dependent process timeout therefore becomes a false failure of unrelated semantic assertions. The underlying reason that one process took about 1.1 seconds (scheduling, IO or otherwise) has not been established. Do not claim CPU load caused it.

**Fix direction:** Preserve the production default deadline. Expose a preflight-only timeout option for S4 and give semantic integration fixtures an explicit generous budget, while retaining real policy CLI coverage. Add a controlled slow-CLI regression proving default timeout still stops before model calls and an explicit longer budget permits the same valid response. No retries or global timeout increase.

**Status:** fixed-verified on branch `fix/s4-preflight-test-budget` (not yet merged) — the controlled regression failed before forwarding was added (0 != 13 with prompt_not_steerable), then passed. The final S4 suite passed two consecutive runs and the adapter tests passed. The complete root command `env CODESCOUT_REPO=/home/marius/work/claude/codescout bash tests/run-all.sh` also exited 0 with `All suites passed` at ca54ca4. Independent review of ca54ca4 found no Critical/Important/Minor issues. Its disposable-clone baseline exited 0. Five actual mutations were applied separately and each complete S4 command exited 1: remove runner forwarding; remove runPolicy forwarding; remove experiment fixture budget; remove main fixture budget; change adapter default 500→1000. Observed result: 5 killed, 0 survived. The first two failed both controlled slow-policy tests, the next two failed the semantic-fixtures regression, and the last failed the default-deadline regression. The clone was restored exactly; no post-restoration rerun was claimed. Raw review outputs exist only in the reviewer's tool transcript, not durable logs. Windows and branch CI were outside that review.

**Rests on:** The captured same-case spawn/preflight/runner chain above and the controlled delayed-CLI regression; the test isolation choice and its default-deadline controls are documented in docs/superpowers/plans/2026-11-18-s4-preflight-test-isolation.md.

**Valid:** dated 2026-11-18

## Template for new entries

Append findings atomically through the catalog.
