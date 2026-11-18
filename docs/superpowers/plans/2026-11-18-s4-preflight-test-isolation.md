---
id: '49bd1e681dc60a95'
kind: plan
status: active
title: S4 preflight test isolation
---

# S4 preflight test isolation implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; use checkbox steps and an independent review with applied mutations.

**Goal:** Remove the reproduced S4 semantic-test dependency on a 500 ms real process startup while preserving the production deadline and real CLI coverage.

**Architecture:** Thread an optional preflightTimeoutMs from runExperiment options into runPolicy's existing timeoutMs. The adapter continues to own validation/defaulting and defaults to 500 ms. Test wrappers supply 10000 ms for semantic CLI integration. A deliberately delayed CLI proves the omitted/invalid override still refuses before any model/hook call, and the explicit longer override permits the same response.

**Tech Stack:** Dependency-free Node ESM, native child processes and temporary Git fixtures.

**Spec / evidence:** docs/trackers/s4-debug-session-log.md, entry s4-debug-session-log:F-1; natural ETIMEDOUT → adapter_timeout → prompt_not_steerable → zero calls.

## Approaches and scope

Raising the adapter's global production deadline changes the hook contract. Replacing preflight with a fake would remove the real-copy, table and override coverage. Use an optional preflight-only budget instead; keep CLI decisions real. This is an implementation choice under the requested systematic debugging and correction, not a new user-facing setting. No retries, releases, installed configuration changes or unrelated refactors.

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
- [ ] Run S4 suite and adapter timeout tests, then repeat the S4 suite. Run complete root suite and report every failure. No new dependency is needed for S4; install companion test dependencies only if required for the full suite.
- [ ] Request independent review; apply/remove budget forwarding and mutate the production default deadline, observing killed/surviving outcomes. Correct findings, update this plan and the session log, and commit on the isolated branch.
