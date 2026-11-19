---
id: '6d792b7037080008'
kind: plan
status: done
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

## Current state — 2026-11-18 live continuation

Review and live acceptance completed against runtime head `8135318` (published main `69db242` reconciled). F-1 through F-8 are fixed with regressions and applied mutation evidence; F-9 is mitigated by the functioning 27B provider. Actual model-driven OpenCode list/ask/send/notice calls, native child caller resolution, Claude-MCP send/ask, source-history isolation and read-only permission enforcement were observed. See the tracker provider-retry section and docs/evidence/2026-11-18-pr19-opencode-provider-retry.json for precise scope.

Private probe sessions/services/processes stopped and credential copies removed. Combined-tree checks pass: 390 Rust tests, 207 adapter checks, fmt/Clippy, the full root suite and version consistency. All five CI jobs on `8135318` succeeded. The final continuation changes evidence/docs only.

PR19 is ready for integration and remains open; no PR19 merge authorization was inferred from prior PR16 instructions. Alexandre's existing PR19 feedback comment should be updated with the successful retry and final evidence commit.
