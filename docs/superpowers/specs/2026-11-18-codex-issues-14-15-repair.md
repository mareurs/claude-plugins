---
id: '3108db5ae41d3fc5'
kind: spec
status: done
title: Repair Codex wake version parsing and native approval metadata
tags:
- codex
- background-wake
- native-approval
---

# Repair Codex issues 14 and 15

The user requested repairs after both GitHub issues reproduced on 2026-11-18. The choices below are implementation decisions under that request.

## Issue 14

Parse the leading `<originator>/<major.minor.patch>` in the daemon's userAgent without requiring the originator to be codex-tui. Share one strict parser between capability checking and the callback probe. Keep all exact-version, profile, endpoint-generation and callback-evidence gates unchanged. Malformed or mismatching versions must still fail closed; this repair does not add support for Codex0.169.0.

Use real evidence artifact references. Add an honest0.167.0 manifest entry describing the partial throwaway native-observability evidence, and align support docs and historical spec state. Do not relabel synthetic fixtures as native measurements.

## Issue 15

The real CLI0.169.0 nested functions.exec→exec_command call includes sandbox_permissions=require_escalated, but its Bash PreToolUse payload drops the field, so the existing guard blocks before approval. Patch the corresponding host handler on the exact rust-v0.169.0 source. Preserve only supplied sandbox_permissions, justification and prefix_rule from parsed structured arguments. Keep omitted fields omitted and preserve the raw command. Never infer escalation from command text or grant approval in the plugin.

Pin native metadata forwarding in unit and nested code-mode integration coverage. Verify both approve and deny decisions remain the host's; a denied command must not create the isolated marker. Retest through the real companion guard in an isolated home with the corrected host candidate.

## Delivery and validation

Changes must preserve the unrelated dirty session-bridge and s4-debug work. Run focused tests, appropriate complete suites, and independent review with individually applied mutations on load-bearing logic. Keep existing regression reproductions as final end-to-end checks. Build the corrected host into an isolated candidate first; do not replace the system package during implementation. Release/install and GitHub closure require concrete verified results. Record limitations explicitly.

## Verification — 2026-11-18

Local implementation and candidate verification completed. Issue14: shared strict parser consumed by both actual callsites; live0.169.0 initialization and controlled accepted-version fixture retested; exact-version/profile/generation gates preserved. Final wake suite208/208, focused21/21; ten applied review mutations initially8 killed/2 surviving, both observed gaps closed with exact failing rechecks. Evidence and limitations: ../../evidence/2026-11-18-codex-originator-parser-review.md.

Issue15: exact-tag four-file patch, metadata omission/default/empty/raw-command tests, direct/nested native approve/deny tests, real unchanged companion-guard candidate accept/decline acceptance. Final affected unit24/24, related native hooks97/97, format and Clippy -D warnings exit0. Six review mutations initially5 killed/1 raw-whitespace survivor; observed exact recheck failed after test strengthening. Final package independently approved and applied/reversed against a clean exact baseline with byte comparisons. Evidence: ../../evidence/2026-11-18-codex-native-approval-0169-repair.md.

Complete repository run exited1 on a new peer test's missing+x and an experimental Docker helper assertion. The permission repair and focused reruns both passed; no subsequent complete-command pass is claimed. Record: ../../evidence/2026-11-18-issues-14-15-repository-checks.json.

Installed CLI/App and profiles were not replaced. GitHub14 and15 were freshly read as OPEN; no closure, release, push or commit was performed. The repaired isolated0.169.0 app-server and version-specific patch are available for host delivery.
