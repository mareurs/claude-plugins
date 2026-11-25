---
id: 57818f684010b131
kind: plan
status: done
title: S4 preflight budgets and runtime deadline
---

# S4 preflight test isolation implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; use checkbox steps and an independent review with applied mutations.

**Goal:** Remove the reproduced S4 semantic-test dependency on a tight real-process deadline and, under the user's Task 2 request, raise the runtime ceiling to 3000 ms while preserving real CLI coverage and the historical S4 performance criterion.

**Architecture:** Thread an optional preflightTimeoutMs from runExperiment options into runPolicy's existing timeoutMs. The adapter owns validation/defaulting. Task 1 retained the original 500 ms default; Task 2 raises that runtime ceiling to 3000 ms independently of S4's registered 500 ms p95 target. Test wrappers supply 10000 ms for semantic CLI integration. A deliberately delayed CLI proves the omitted/invalid override still refuses before any model/hook call, and the explicit longer override permits the same response.

**Tech Stack:** Dependency-free Node ESM, native child processes and temporary Git fixtures.

**Spec / evidence:** docs/trackers/archive/s4-debug-session-log.md, entry s4-debug-session-log:F-1; natural ETIMEDOUT → adapter_timeout → prompt_not_steerable → zero calls.

## Approaches and scope

Task 1 initially preserved the production deadline because changing it changes the hook contract. Task 2 explicitly expands scope at the user's request to raise that deadline to 3000 ms. Replacing preflight with a fake would remove the real-copy, table and override coverage. Use an optional preflight-only budget instead; keep CLI decisions real. This is an implementation choice under the requested systematic debugging and correction, not a new user-facing setting. No retries, releases, installed configuration changes or unrelated refactors. The Task 1 closeout below records the earlier verified stage; Task 2 is the current runtime-default scope.

## Task 2 — runtime deadline increase requested by the user

The user explicitly requested raising the production 500 ms limit for slower machines and asked what it protects. This extends Task 1: use a 3000 ms runtime ceiling, retain the 10000 ms semantic-test budget, and preserve the historical registered 500 ms S4 p95 performance target. The timeout prevents the synchronous local policy process from hanging the hook; expiry kills it and continues without steering. Normal completion does not wait out the budget. An outer S4 hook deadline is 30000 ms.

**Files:** adapter/claude-code/run-policy.mjs and its tests; spikes/s4-run.test.mjs; misleading timeout comments in spikes/s4-prereg.mjs; effort-steering/README.md. Do not modify s4-prereg.json or historical results.

**Acceptance / review focus:** a valid response after 700 ms succeeds with omitted or invalid-zero timeout; the new default is exactly 3000 ms; a hanging policy is still killed and fails open; explicit shorter timeouts remain supported; S4 retains its 500 ms registered performance criterion independently of the runtime ceiling; wrapper and default-deadline regressions must still fail when their forwarding/budgets are removed. Delay only the first fixture prompt beyond 3000 ms to avoid multiplying test runtime across all four prompts.

- [x] Write adapter delayed-success and bounded-default regressions, replace the obsolete equality assertion with independent ceiling/performance assertions, and observe a failure at the old runtime default before changing implementation.
- [x] Set the runtime default to 3000 ms. Adjust S4 delayed fixtures beyond 3000 ms while preserving their explicit 10000 ms budget; clarify documentation and stale comments.
- [x] Run adapter, S4, prereg and hook suites, then complete root verification. Obtain independent review with applied mutations, record evidence and update PR #20; follow CI without merging automatically.

**Ruling:** A 3000 ms ceiling supplies headroom above the observed approximately 1.1 s startup, while bounding a stalled hook. It is a chosen operational margin, not a measured guarantee for every machine. Cost: a genuinely stuck policy can now hold the hook for up to three seconds before fail-open; very slow machines may still exceed that ceiling.

## Task 2 verification and publication — 2026-11-18

Source commit 0aaf656 implements the requested 3000 ms runtime ceiling. RED at the original default observed adapter_timeout for a valid 700 ms response and 500 != 3000. The adapter, hook, prereg and S4 suites then passed. Complete root command `env TMPDIR=/tmp/s4-runtime-verification.Qej1uK CODESCOUT_REPO=/home/marius/work/claude/codescout bash tests/run-all.sh` exited 0 with `All suites passed`.

The first full root run failed because empty .git directories in both shared temporary roots made unrelated Buddy/SDD fixtures resolve the wrong project root. The pre-change Buddy clone reproduced it. Only verified empty directories were removed with rmdir; the same four-group control then passed unchanged. Full details and the limits of Git-based absence checks are in s4-debug-session-log:F-3. No product fix was made for that environment interference.

Independent review found no Critical/Important/Minor findings. Adapter and S4 baselines exited 0. Five actual separate mutations each exited 1 (5 killed, 0 survived): runtime default 3000→500; remove spawnSync timeout; invalid-zero→0; remove experiment wrapper budget; remove main wrapper budget. Raw status/failure records in /tmp/policy-deadline-review-logs were read by the parent. Clone restored exactly, without claiming a post-restoration rerun.

**Ruling:** Reviewer did not judge the full root suite or platforms; the parent uses the actual root and PR CI outcomes instead of extending that review's scope. Cost if wrong: platform behavior not exercised by those checks remains outside the claim.

**Integrated on 2026-11-18:** The user explicitly requested integration. PR #20 was marked ready and squash-merged into main as 7d6a943f4293241504cf9ec73ad5abceeb258150, with --match-head-commit guarding reviewed head 52a731c9598a161c1dd2d7bd0401e20039064048. All five CI jobs passed before merge. The merge tree and reviewed-head tree are identical (02454e5e457f5284fa338ef34f9bd9285df9ec31). The local main checkout was fast-forwarded while preserving unrelated concurrent edits. No deferred minor findings. The host-managed worktree is retained because no native exit/remove capability is exposed.

## Review focus

- Omitted override keeps the production deadline and zero calls on a delayed policy.
- Invalid zero cannot disable the adapter timeout.
- A positive override must actually reach the copied CLI invocation and allow model orchestration.
- Existing user-override, unreadable-table and empty-steer refusals stay covered through the real CLI.
- main forwards dependencies; the test-only budget applies consistently without changing production defaults.

## Task 1 — one correction with regression coverage

**Files:** effort-steering/spikes/s4-run.mjs; effort-steering/spikes/s4-run.test.mjs.

**Interface:** runExperiment(preregFile, opts) accepts optional preflightTimeoutMs. unsteerablePrompts gains a final optional timeout argument forwarded as runPolicy timeoutMs. No change to run-policy.mjs.

- [x] Add a controlled delayed-CLI test using actual runExperiment defaults and a committed temporary tree. Assert default/zero override stop before hooks/model calls; explicit 10000 ms completes all 13 simulated model calls with stop=[]. Run it red before adding forwarding.
- [x] Thread the optional budget through the production preflight. Add test wrappers around runExperiment/main with 10000 ms; keep real policy output and all existing assertions. Both wrappers also have a controlled delayed-policy regression, so removing either fixture budget fails deterministically.
- [x] Run S4 suite and adapter timeout tests, then repeat the S4 suite. Run complete root suite and report every failure. No new dependency is needed for S4; install companion test dependencies only if required for the full suite.
- [x] Request independent review; apply/remove budget forwarding and mutate the production default deadline, observing killed/surviving outcomes. Correct findings, update this plan and the session log, and commit on the isolated branch.

## Verification and closeout — 2026-11-18

The override regression failed before forwarding was added. At ca54ca4, the final S4 suite passed two consecutive runs, the adapter suite passed, and the complete root command `env CODESCOUT_REPO=/home/marius/work/claude/codescout bash tests/run-all.sh` exited 0 with `All suites passed`.

Independent review found no Critical/Important/Minor issues. A separate clone baseline exited 0; five separately applied mutations each made the complete S4 command exit 1 (5 killed, 0 survived): remove runner forwarding, remove runPolicy forwarding, remove experiment fixture budget, remove main fixture budget, and change adapter default 500→1000. Clone restored exactly; no post-restoration rerun claimed. Raw mutation output remains in the reviewer's tool transcript.

**Ruling:** Keep the production deadline and real CLI, with a generous semantic-test budget. Cost if wrong: semantic tests tolerate slow preflight, so timing remains guarded by separate default-deadline and hook-latency tests.

**Ruling:** The reviewer did not exercise Windows or branch CI. Publish a draft PR with the observed Linux evidence and track CI separately; do not merge on an implied cross-platform verdict. Cost if wrong: a platform-specific process/timer issue may remain until CI exercises it.

**Integration:** Task 1 and the subsequent user-requested Task 2 are integrated through PR #20 at 7d6a943. This section records the earlier Task 1 verification; the Task 2 integration record above is the final state. No deferred minor findings.
