---
id: '6fce9ce4d8e5af43'
kind: report
status: done
title: Issue 14 independent review and applied mutations
tags:
- codex
- background-wake
- review
- mutations
---

# Issue 14 independent review — 2026-11-18

Verdict: no outstanding production correctness finding. The strict shared parser, both actual consumers, exact version allowlists, evidence references, and documentation match the repair requirements. Two confirmed regression-coverage gaps were closed and independently verified with the exact mutations that first survived.

Review workspace: `/home/marius/.cache/cc-tmp/issue14-review-20261118-8whvgd8f`; base commit `b9f87db662fc13d0001b542f9fb3c2ee042dd7be` plus only the frozen issue 14 production/doc/test changes. Refreshed only the two scoped test files after the implementer added regressions. Existing `codescout-companion/node_modules` was reused by symlink after the first clone run lacked `ws`; no package installation was performed. No root source, profile, version, install, release, or GitHub mutation was made by the reviewer.

Requirements: spec `3108db5ae41d3fc5`, plan `91b0eda6be47e047`. Phase 0 included architecture, gotchas, `research/issues-14-15-retest-20261118`, the active bug ledger, and explicit symbol-navigation/workspace-state/progressive-disclosure guides. Reviewed targeted diff and symbol bodies, including the two new test files. The review did not rerun a live native daemon; the alternate-originator callsite checks use the accepted-version protocol fixture.

## Findings and closure

- P2, closed: `codescout-companion/background-wake/adapters/codex.mjs:21` had no independent regression check for the runtime-generation half of its endpoint gate. Removing only `||binding?.runtimeGeneration!==identity.generation` initially left all 206 wake tests green. Existing `codex.test.mjs:25-28` changes only `hostInstanceId`. New `codex-version.test.mjs:70-79` uses a valid endpoint host ID and a stale runtime generation, and checks denial before initialize. Reapplying the exact mutation produced 13 passed / 1 failed; the new assertion at line 75 failed with `true !== false`.
- P2, closed: `tools/probe-codex-wake-callbacks.mjs:68` had no direct regression check for its separate profile ownership gate. Removing only its `codexHome`/`profileRoot` realpath comparison initially left all 206 wake tests green. New `probe-codex-wake-originator.test.mjs:47-58` supplies distinct existing profile directories, matching 0.167.0, and an alternate originator. Reapplying the exact mutation produced 6 passed / 1 failed: the expected ownership rejection became `create probe thread: probe thread was not created`. The restored implementation rejects before thread creation or archive.

The production guards were correct throughout; both findings concerned test coverage. The implementer added the tests only after the original surviving mutations had been applied and observed. The reviewer wrote no production tests.

## Applied mutation observations

Every mutation was applied individually in the isolated copy, tested, and restored before the next. Counts below are actual runner test counts, not estimated coverage.

| ID | Mutation | Command | Observed passed / failed | Result initially |
|---|---|---|---|---|
| M1 | Adapter callsite only: shared parser replaced with old codex-tui-only regex, `codex.mjs:24` | D | 11 / 2 | Killed |
| M2 | Probe callsite only: shared parser replaced with old codex-tui-only regex, probe:66 | P | 5 / 1 | Killed |
| M3 | Shared parser: removed terminal `(?:\s|$)` token boundary, compatibility:14 | T | 14 / 5 | Killed |
| M4 | Shared parser: removed leading `^`, compatibility:14 | T | 18 / 1 | Killed |
| M5 | `codexDaemonEvidence` returns the existing 0.167 evidence for 0.169.0, compatibility:8 | D | 11 / 2 | Killed |
| M6 | Adapter: removed profile ownership guard, codex:23 | A | 76 / 1 | Killed |
| M7 | Adapter: removed entire endpoint-generation guard, codex:21 | G | 20 / 1 | Killed |
| M8 | Changed 0.167 native summary `id` to `wrong-native-summary-id`, evidence JSON:3 | D | 12 / 1 | Killed |
| M9 | Adapter: removed runtimeGeneration comparison only, codex:21 | F | 206 / 0 | Survived |
| M10 | Probe: removed profile ownership guard only, probe:68 | F | 206 / 0 | Survived |
| M9 recheck | Same exact mutation, after the scoped runtime test | D | 13 / 1 | Killed |
| M10 recheck | Same exact mutation, after the scoped foreign-profile test | P | 6 / 1 | Killed |

Initial result: 8 killed / 2 surviving candidate mutations. After the two test-only follow-ups, both survivors were killed. No surviving candidate remains from this review set.

## Exact commands

Run from the review workspace above.

D:
```sh
node --test codescout-companion/background-wake/adapters/codex-version.test.mjs
```

P:
```sh
node --test tools/probe-codex-wake-originator.test.mjs
```

T:
```sh
node --test codescout-companion/background-wake/adapters/codex-version.test.mjs tools/probe-codex-wake-originator.test.mjs
```

A:
```sh
node --test codescout-companion/background-wake/adapters/codex*.test.mjs tools/probe-codex-wake*.test.mjs
```

G:
```sh
node --test codescout-companion/background-wake/adapters/codex.test.mjs codescout-companion/background-wake/adapters/codex-binding.test.mjs codescout-companion/background-wake/adapters/codex-version.test.mjs
```

F:
```sh
node --test codescout-companion/background-wake/*.test.mjs codescout-companion/background-wake/adapters/*.test.mjs tools/probe-codex-wake*.test.mjs codescout-companion/hooks/background-wake-capabilities.test.mjs codescout-companion/hooks/background-wake-captures.test.mjs
```

S, final complete validation:
```sh
node --test --test-concurrency=1 codescout-companion/background-wake/*.test.mjs codescout-companion/background-wake/adapters/*.test.mjs tools/probe-codex-wake*.test.mjs codescout-companion/hooks/background-wake-capabilities.test.mjs codescout-companion/hooks/background-wake-captures.test.mjs
```

## Validation evidence and limits

- Original baseline F: exit 0, 206 passed / 0 failed.
- One restored F run after mutations: exit 1, 194 passed / 12 failed, with receipt-lock timeouts and delayed heartbeat/native-intake assertions. No production byte difference was present; focused T passed 19/19 immediately after. This review does not claim to have established the cause of that parallel-run failure.
- Restored original S baseline: exit 0, 206 passed / 0 failed, duration 115463.843611 ms.
- After new tests and exact M9/M10 RED checks, restored T: exit 0, 21 passed / 0 failed.
- Final S: exit 0, 208 passed / 0 failed, duration 95667.70425 ms. Full output: `/tmp/issue14-review-full-wake-20261118.log`.
- `git diff --check`: exit 0.
- Exact byte comparison of all 10 reviewed production/doc/test files against the frozen root snapshot passed after restoration; no mutation remains.
- Both evidence references resolve to the expected version, non-synthetic native-protocol summary, and matching JSON `id` fragment. The 0.167 manifest spike SHA256 matches `86954b80a66db7638ee6203d7626fe5dcb651767466d45af78d201fdaeb07293`. Its limits accurately distinguish partial throwaway identity observations from standalone wake envelopes and complete transport evidence.

Ledger checked: 4858a9179d30d447, 2646bba03b528020, da6eaaa69498077b, 33de9ea8980e85c9. None described the two regression-coverage gaps above.
