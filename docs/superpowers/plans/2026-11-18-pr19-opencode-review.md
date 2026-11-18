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

## Current state — 2026-11-18 live continuation

Implementation findings F-1 through F-8 are fixed with regressions and applied mutation evidence. Live continuation established actual Claude-MCP→OpenCode message observation and notice injection into the current plugin context, plus OpenCode-identity CLI→Claude/Codex asks and CLI→Codex send/ACK on disposable native sessions. Successful OpenCode model inference/tool calls remain blocked by local provider500 (F-9); user was asked for a functional backend/model. Preserve that distinction when reporting acceptance.

Probe services and processes stopped; copied credentials removed. Raw noncredential evidence/scripts remain under /tmp/pr19-live-acceptance-7btoc4mi, while the tracker contains portable conclusions. Claude disposable transcripts remain in the native profile. Restarting probes requires fresh temporary config/auth; do not assume the old root is runnable as-is.

Published origin/main69db24297dc5d30428e4d7f6a0adf2ba7b50d7d2 reconciled without conflicts. Combined-tree Rust390/0, fmt, Clippy and adapter207/0 pass. Full root suite also passed with private TMPDIR, version consistency passed; review branch is ready for publication and fresh CI. Acceptance remains partial due to F-9. No PR19 merge authorization was inferred; PR16 is already merged. Alexandre received detailed learning-oriented feedback on both PRs; update the existing PR19 comment with subsequent live evidence rather than duplicating feedback.
