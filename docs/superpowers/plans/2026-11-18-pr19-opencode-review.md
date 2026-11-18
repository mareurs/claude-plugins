---
id: '6d792b7037080008'
kind: plan
status: active
title: PR 19 OpenCode session-bridge review
tags:
- pr19
- session-bridge
- opencode
---

## Scope
Review PR #19 at original head `28c93b458dc421f7ea892b683aae9b0de61610a2`, reconcile current main, and fix confirmed defects with regressions. Do not alter concurrent main-checkout work on Claude auth/native approval.

## Steps
1. Establish original Rust and adapter baselines and inspect original CI failures.
2. Merge current main into the isolated review branch; preserve PR16 OpenCode changes and session-bridge 0.2.8 behavior.
3. Trace caller identity, discovery, reader permissions, cancellation/fork cleanup, send confirmation, notice delivery and installation against the PR spec.
4. Fix reproduced issues with red/green regressions; run Rust tests, fmt, Clippy and OpenCode/root checks.
5. Independent review with actually applied mutations, then publish the reviewed changes and fresh CI result for an integration decision.

## Baseline observations
Original adapter: 102 passed, 0 failed. Original cargo test stopped in `opencode_caller`: `call_args_with_shell_metachars_are_literal` constructs a title from an absolute temporary path repeated three times, producing169 characters versus the120-character title limit. Remaining tests are being run with that one test skipped to establish the rest of the baseline. Original Windows CI fails the Python-start counter fixture; macOS compares a /var path to its /private/var real path in Codex hook fixtures. Current main has fixes for those two areas; verify reconciliation rather than adding parallel workarounds.
