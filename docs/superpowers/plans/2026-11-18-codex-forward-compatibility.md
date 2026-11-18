---
id: '6da0633f21fec651'
kind: plan
status: done
title: Codex forward compatibility implementation
tags:
- codex
- background-wake
- compatibility
---

# Codex forward compatibility implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox syntax; one independent final reviewer checks the load-bearing guards with actually applied mutations.

**Goal:** Remove Codex wake's exact-version ceiling while retaining feature minimums and protocol/profile checks.

**Architecture:** Shared strict SemVer validation and minimum comparison in compatibility.mjs. Hook intake consumes the generalized hook check; the daemon adapter gates on minimum version plus existing per-profile callback proof rather than bundled historical evidence. Archived evidence lookup remains exact.

**Tech Stack:** Node.js ESM, node:test; no new dependency.

**Spec:** ../specs/2026-11-18-codex-forward-compatibility-design.md (3554963c3e08442d), approved by user.

## Global constraints

- CLI floor0.165.0; daemon floor0.160.0; no ceiling. Newer valid prereleases accepted; equal-floor prereleases rejected; build metadata does not lower a version.
- Exact configured/observed daemon version match, canonical profile, both endpoint-generation halves, callbackPreserved=true, subscription=resume-loaded, root-only intake and native callback/event validation remain.
- Archived measured evidence is not forward-version proof. New accepted versions return evidenceRef=null and an honest diagnostic reason.
- Preserve all existing dirty work. No inline version bump, release, profile writes or native approval changes.

## Review focus

- Numeric version comparison handles0.9 versus0.160 and major increments correctly without lexicographic/number-overflow mistakes.
- Malformed version tokens, numeric prerelease leading zeros and userAgent suffixes/control characters remain rejected.
- Unknown newer versions still need callback proof and exact observed version, correct profile and both generation fields.
- Hook eligibility changes only for Codex; child events and malformed hook shapes stay rejected.
- New stable/prerelease acceptance at actual adapter/intake/probe callsites is pinned, not only at helper tests.

## Task 1 — compatibility policy, consumers and regression coverage

**Files:** codescout-companion/background-wake/compatibility.mjs; adapters/codex.mjs; intake.mjs comments; tools/probe-codex-wake-callbacks.mjs; new background-wake/compatibility.test.mjs; adapters/codex-version.test.mjs and codex-compatibility.test.mjs; tools/probe-codex-wake-originator.test.mjs; docs/background-wake.md.

**Interfaces:** Preserve codexDaemonEvidence(version):string|null and parseCodexDaemonVersion(userAgent):string|null; generalize supportsCodexHook(version):boolean. Add isCodexVersion(version):boolean and supportsCodexDaemon(version):boolean. Internal strict parsing/minimum comparison is shared; no public configuration schema change.

- [x] Add regression cases for newer stable/patch/prerelease/build versions, both floors, malformed versions, adapter proof/profile/generation failures, root-only intake and probe prerelease validation. Update old hard-ceiling assertions to the approved policy; observe RED before production edits.
- [x] Implement strict version validation/minimum comparison and parser token extraction; separate bundled evidence from daemon eligibility. Preserve all existing runtime identity/callback gates and use honest unknown-version diagnostics. Update probe input validation to use shared SemVer validation.
- [x] Run focused tests GREEN, complete sequential wake tests and repository tests. Run the existing opt-in native callback probe in an owned isolated0.169 profile if feasible; retain actual results/limits and clean owned resources. Do not label fixture success as native wake acceptance.
- [x] Update support/configuration/recheck documentation to describe the floor/no-ceiling policy and exact per-profile callback proof. Keep historical native evidence unchanged.

## Task 2 — independent review and final evidence

- [x] Reviewer applies candidate mutations to minimum comparison and preserved runtime guards, runs actual suites, reports observed killed/surviving counts, restores exact bytes; close confirmed gaps only after observing survival.
- [x] Record final verification evidence and limits, update the approved spec/plan and codescout memory, verify diff whitespace and preservation of unrelated changes. Source rollout/release state remains explicit.

## Execution evidence

Local source implementation complete. Final focused64/64; complete sequential wake231/231. Independent17-mutation review had four survivors; all four exact candidates now fail with the added coverage and restored source passes. No current production defect found by independent review.

Full repository run exited1 only in unchanged sdd/hooks/lib.test.mjs (outside a repo fixture discovers ancestor .git under temporary roots); unchanged TMPDIR=/dev/shm rerun37/37. Default full run remains red and is not called green.

Two native0.169 capability checks accepted with null evidenceRef; callback probes failed secondary attach (empty rollout, then list_turns unsupported), so native callbacks/automatic wake remain unverified. No release/config/binary changes. Evidence and rulings: ../../evidence/2026-11-18-codex-forward-compatibility.md (f755dbdb21179631). Spec verdict24/24 implemented for local source scope.
