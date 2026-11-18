---
id: '91b0eda6be47e047'
kind: plan
status: done
title: Implementation — Codex issues 14 and 15 repair
tags:
- codex
- background-wake
- native-approval
---

# Codex issues 14 and 15 repair implementation plan

> **For agentic workers:** Use superpowers:executing-plans or the already-dispatched independent implementation tasks. Each task follows TDD and returns to the controller for applied-mutation review.

**Goal:** Repair the reproduced wake parser failure and the host's dropped native approval metadata.

**Architecture:** Share strict userAgent version parsing inside companion compatibility utilities; forward explicit structured approval metadata in the exact Codex0.169.0 host handler. Keep capability and approval decisions where they already live.

**Tech Stack:** Node.js ESM, Rust1.95.0, existing Node/Rust test harnesses.

**Spec:** ../specs/2026-11-18-codex-issues-14-15-repair.md

## Global constraints

- Wake exact-version allowlists and profile/socket/generation checks stay unchanged; no new0.169.0 wake support.
- Plugin runtime floor remains Node22/Python3.12. Source host baseline is rust-v0.169.0 commit d32063f96c2dff1dc96af839b3952abb6acfeda4.
- No command-text inference, plugin auto-approval, system-package replacement, profile-config edits or unrelated session-bridge edits during implementation.
- Source changes use codescout edit_code; managed documentation uses doc. Record real test outputs and distinguish native evidence from fixtures.

## Review focus

1. Alternative originator names must parse while malformed/trailing/prerelease versions fail closed.
2. Actual adapter and probe must consume the shared parser; a helper-only test is insufficient.
3. Missing approval metadata must remain absent, including command text containing escalation-like tokens.
4. Nested code mode must preserve explicit fields; approval and denial remain native host decisions.
5. Denial must leave the isolated marker absent; matching-version tests must not bypass other compatibility gates.

## Task 1 — issue14 companion repair

**Files:** background-wake/compatibility.mjs, adapters/codex.mjs, tools/probe-codex-wake-callbacks.mjs, focused Node tests, fixture manifest/evidence summaries, docs/background-wake.md and the2026-11-10 spec.

**Interface:** Export parseCodexDaemonVersion(userAgent) returning a strict version string or null; both consumers use it.

- [x] Add direct parser, alternate-originator actual adapter/probe and resolvable-evidence tests; observe RED (baseline 12 pass/7 fail; repaired 19 pass/0 fail).
- [x] Implement shared parser and replace both duplicate parsers; repair evidence identifiers and honest manifest/documentation status.
- [x] Run focused and full wake suites (206 pass/0 fail); rerun isolated live initialization and accepted-version controlled fixture. Native 0.169.0 parses but remains unsupported. Saved sanitized live/fixture evidence under docs/evidence/2026-11-18-codex-originator-parser.json.
- [x] Independent review applied 10 mutations: 8 killed, 2 initially survived. Added two regression tests only after observing the survivors; exact rechecks now each fail. Final sequential wake suite 208 pass/0 fail, focused 21 pass/0 fail. Report: docs/evidence/2026-11-18-codex-originator-parser-review.md. One restored parallel run had 12 timing/receipt failures; cause was not established.

## Task 2 — issue15 host repair

**Workspace:** /home/marius/.cache/cc-tmp/codex-issue15-0169-20261118.

**Files:** codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs, unified_exec_tests.rs, core/tests/suite/hooks.rs, and core/tests/suite/hooks_cwd_tests.rs.

**Interface:** Existing impl CoreToolRuntime for ExecCommandHandler::pre_tool_use_payload(&ToolInvocation) -> Option<PreToolUsePayload>; no signature change.

- [x] Add tests for require_escalated/use_default, independently supplied justification/prefix_rule, omitted fields, and text that merely mentions escalation; observed RED on exact baseline: focused unit filter 2 pass/1 fail, missing sandbox_permissions (21m05s first compile; /tmp/issue15-red-unit-0169.log).
- [x] Populate tool_input from parsed optional fields while preserving raw command and command-only shape. Focused unit filter now 3 pass/0 fail after 1m56s incremental build (/tmp/issue15-green-unit-0169.log); the 3000 filtered tests are not claimed as run.
- [x] Add host approve/deny integration with a marker plus actual nested functions.exec coverage. Affected unified_exec unit suite:24 pass/0 fail. Related hooks suite:97 pass/0 fail/0 ignored, including direct/nested × approve/deny. Local integration commands use RUST_MIN_STACK=8388608 after default-stack overflow also reproduced in an existing adjacent hook test; this is not a claimed core CI setting. Exact-payload cwd expectations were updated in hooks_cwd_tests.rs for the newly forwarded field. Final format check and Clippy --lib --tests --no-deps with -D warnings exited0 after removing a test-only identity conversion; affected24 tests passed again. Measured exits: docs/evidence/2026-11-18-codex-native-approval-0169-final-checks.json.
- [x] Build an isolated corrected0.169.0 app-server candidate and rerun both real companion-guard decisions. Exactly one native approval callback each; marker absent before either decision, absent after decline, present after accept. Actual ordinary control output remains guard-blocked. Sanitized actual-rollout evidence: docs/evidence/2026-11-18-codex-native-approval-0169-after.json. Isolated home removed afterward; installed CLI/App unchanged.
- [x] Independent reviewer applied6 mutations:5 killed/1 raw-command whitespace survivor. After observing it, the existing raw fixture gained edge whitespace; exact trim rerun failed2pass/1fail, restored unit module24pass/0fail. Final four-file package independently approved; no remaining findings. Durable review: docs/evidence/2026-11-18-codex-native-approval-0169-review.json and -repair.md.

## Delivery

- [x] Saved docs/patches/2026-11-18-codex-0.169.0-native-approval-hook-payload.patch and sanitized before/after evidence plus independent review. Patch SHA70dfeff0a15391384d5be9c59d00bbcbad18692d731113ff32031d7bc9d09e9b. Clean exact-tag archive: apply-check/actual apply/four source hash comparisons/reverse-check/actual reverse/baseline byte comparison all passed; fixture removed. Evidence: docs/evidence/2026-11-18-codex-native-approval-0169-patch-check.json.
- [x] Ran final repository checks. Initial ./tests/run-all.sh passed (@bg_00000016). Later runs exposed3 then4 ancestor-fixture suites; seven fixtures now have isolated project boundaries/cleanup. The durable runner passed21/0 twice controlled and twice default TMPDIR. Complete run1e exited1, with only test-hook-permissions.sh (new parallel test lacked+x) and an experimental Docker300ms-helper assertion failing. Added only+x to that peer test; permissions rerun23/0. Unchanged Docker suite then exited0 and its original failing case passed; cause was not established. No whole-suite pass is claimed after those focused reruns. Evidence: docs/evidence/2026-11-18-issues-14-15-repository-checks.json and -hook-fixture-isolation.md.
- [x] Reviewed concrete production/test diffs and installation implications. Isolated candidate is native-tested, system CLI and App unchanged. No version/config/release/commit/push/GitHub mutation performed; unrelated session-bridge and peer hook changes preserved. Release/version changes must use scripts/release.sh. Both GitHub issues stay open until their repair is delivered; source verification does not claim an installed-host rollout.
