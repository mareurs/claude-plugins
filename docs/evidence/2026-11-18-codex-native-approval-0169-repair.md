---
id: '1adb726596b25db3'
kind: report
status: done
title: Issue 15 — Codex 0.169.0 host repair and native acceptance
tags:
- codex
- native-approval
- review
- mutations
---

# Codex 0.169.0 native approval repair — 2026-11-18

The installed stock CLI drops explicit approval metadata before Bash PreToolUse. The corrected isolated host forwards the metadata, and both native approval decisions were observed through the unchanged companion guard. The system CLI and managed App were not replaced, and GitHub issue15 remains open pending delivery.

## Source and behavior

Baseline: `rust-v0.169.0`, commit `d32063f96c2dff1dc96af839b3952abb6acfeda4`, isolated source `/home/marius/.cache/cc-tmp/codex-issue15-0169-20261118`. The only production change is `ExecCommandHandler::pre_tool_use_payload` in `codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs`. Its existing interface is unchanged. It copies supplied `sandbox_permissions`, `justification`, and `prefix_rule` from typed arguments into the hook input, preserving the raw command. Omitted and null optional fields remain absent; supplied default and empty values remain present. Command text cannot request escalation. The plugin guard grants no approval.

The deliverable includes three test files: `core/src/tools/handlers/unified_exec_tests.rs`, `core/tests/suite/hooks.rs`, and `core/tests/suite/hooks_cwd_tests.rs`. The latter adjusts the exact PreToolUse expectation for a fixture that already explicitly requests escalation. PermissionRequest and PostToolUse expectations retain their existing shapes. Cargo.lock normalization and codescout bootstrap files are excluded.

## Native acceptance

[Stock baseline](2026-11-18-codex-native-approval-0169-before.json) records an actual nested `functions.exec` call with explicit `require_escalated`: the hook field was absent, both requested escalation and ordinary control were guard-blocked, no native approval callback arrived, and the isolated marker stayed absent.

[Corrected-host evidence](2026-11-18-codex-native-approval-0169-after.json) records two real model-generated nested call turns through the real companion guard in an isolated Git project. Each turn requested one harmless marker command explicitly and one ordinary control command. Exactly one native `item/commandExecution/requestApproval` arrived in each turn. The marker was absent before the decision; decline left it absent and accept created it. The hook received explicit `require_escalated` only for the escalation call. The ordinary call remained guard-blocked; the escalation call was not blocked by the guard. Both turns completed. Isolated auth symlink, home and session data were removed afterward.

Immutable app-server: `/home/marius/.cache/cc-tmp/issue15-candidate-0169-20261118/bin/codex-app-server`, version `codex-app-server 0.169.0`, SHA256 `60c882a543340edce3812462bf06dd3e2d0732bc31f84312b023f77a69e6408c`. Invoke this standalone executable directly, without an `app-server` subcommand. Its sibling unchanged `codex-code-mode-host` helper has SHA256 `603cd958ebfd95b46a8aadf8058f0f76e6f3abdd11ac2dc9ca9d3e906f217e23`. The unchanged `codescout-companion/hooks/pre-tool-guard.mjs` has SHA256 `c751c8db949c3b353b8860c63185a273d48d0ab91f41a3c6ddb63fc13f5f8eaf`. Controller freshly verified the executable version and all three hashes after native acceptance.

This candidate validates native approval metadata. It does not add wake support for0.169.0. The current managed App daemon is0.160.0, separate from the installed CLI0.169.0.

## Applied independent mutations

The reviewer independently ran the affected24-test unit module before review, then applied and restored six mutations individually. These are observed results, not coverage estimates.

| Mutation | Passed / failed | Initial result |
|---|---|---|
| Trim the raw command |24/0|Survived|
| Drop sandbox_permissions |23/1|Killed|
| Drop justification |23/1|Killed|
| Drop prefix_rule |23/1|Killed|
| Emit omitted metadata as null |22/2|Killed|
| Infer escalation from command text |23/1|Killed|

Initial result:5 killed and1 survivor. The surviving trim mutation revealed a test gap; the production handler already preserves the raw command. Only after observing that survival, the existing raw-command fixture gained leading/trailing spaces, newline and tabs. The exact trim mutation then failed that assertion: focused filter2 passed/1 failed. The original production handler was restored to SHA256 `9a85c6e27ed72af0d0ec2d181d6c80ec41306b23737b012f2cdf0653dc6e5283` before final verification. [Durable reviewer report](2026-11-18-codex-native-approval-0169-review.json) retains all six actually applied method bodies, commands, observations, restoration hashes and final package review. Exact closure RED: `/tmp/issue15-raw-trim-regression-red-0169.log`. The reviewer independently read the closure RED and restored24/24 GREEN logs and approved the final exact four-file patch, with no remaining findings.

## Verification and delivery pending

Initial exact-tag RED: focused2 passed/1 failed on missing sandbox_permissions (`/tmp/issue15-red-unit-0169.log`, first compile21m05s). After production repair: focused3/3 and affected unit module24/24. Related hooks suite97 passed/0 failed/0 ignored, including direct/nested code-mode × approve/deny; full log `/tmp/issue15-hooks-suite-final-0169.log`. The local integration run used `RUST_MIN_STACK=8388608` after a default-stack overflow was also reproduced in an existing adjacent test. This is a measured local workaround, not a core CI setting. `CODEX_SANDBOX_NETWORK_DISABLED` was explicitly unset so the native cases ran.

After the whitespace follow-up and exact handler restoration, the affected unit module passed24/24,0 ignored (`/tmp/issue15-unified-exec-final-green-0169.log`). `cargo +1.95.0 fmt --all -- --check` exited0. Clippy initially rejected one identity `.into()` conversion in the new test. After removing only that conversion, measured final `cargo +1.95.0 fmt -p codex-core --check`, the affected24-test module, and `cargo +1.95.0 clippy -p codex-core --lib --tests --no-deps -- -D warnings` all exited0. [Final commands, timing and exit codes](2026-11-18-codex-native-approval-0169-final-checks.json). No claim is made that the thousands of filtered unrelated tests ran.

Version-specific [host patch](../patches/2026-11-18-codex-0.169.0-native-approval-hook-payload.patch), SHA256 `70dfeff0a15391384d5be9c59d00bbcbad18692d731113ff32031d7bc9d09e9b`, contains exactly the four scoped files. The controller exported those files from the frozen source, archived the exact baseline, ran `git apply --check --whitespace=error`, actually applied the patch, compared all four resulting SHA256 values with the frozen source, reverse-checked and reversed the patch, and confirmed every baseline byte. All checks passed and the owned clean fixture was removed. [Machine-readable patch check](2026-11-18-codex-native-approval-0169-patch-check.json).

The production handler remains byte-identical to the native-tested candidate source. Follow-ups changed only unit tests. The reviewer approved the final package after independently verifying that the sole lint delta reconstructs the prior unit-file hash when reversed. Cargo.lock normalization was restored; final source retains only the four scoped repair files plus pre-existing codescout bootstrap metadata. Installation, release and GitHub closure have not been performed.

The separate [repository validation record](2026-11-18-issues-14-15-repository-checks.json) retains the complete command's two unrelated suite failures and successful focused reruns. It does not claim that the complete repository command passed after those reruns.
