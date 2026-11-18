---
id: a9013e9c9ea4ea65
kind: plan
status: active
title: Codex callback start ordering implementation
tags:
- codex
- callback
---

# Codex callback start ordering implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; one fresh final reviewer applies actual mutations in a private snapshot.

**Goal:** Remove callback-probe false failures caused by attaching before the accepted turn actually starts.

**Architecture:** Track primary turn/started notifications in probeCodexCallbacks. Correlate owned thread/returned turn identity and await readiness before connecting the secondary. Use one independent deadline shared by startup and completion for timeout/cleanup; no changes to adapter protocol or compatibility policy.

**Tech Stack:** Node ESM/node:test, ws.

**Spec:** ../specs/2026-11-18-codex-callback-start-order-design.md.

## Global constraints

Only the probe and its fixtures/docs change. One owned thread, one turn, explicit native model-call opt-in. Keep exact version/profile, callback ownership, decline decision and cleanup. No arbitrary sleeps/retries, no existing-user thread access, no installed profile changes.

## Review focus

- Matching turn/started can precede turn/start response.
- Other threads/turns never unlock secondary attach.
- Start wait shares the full bounded timeout and cannot leak a rejection/timer.
- A primary callback before secondary close is still a failed probe.
- Actual attach errors and cleanup failures remain errors and are not retried.

## Task 1 — synchronize the probe and pin order

**Files:** tools/probe-codex-wake-callbacks.mjs, tools/probe-codex-wake-callbacks.test.mjs, tools/probe-codex-wake-originator.test.mjs, tools/probe-codex-wake-timeout.test.mjs, tools/probe-codex-wake-native.test.mjs, tools/probe-codex-wake-cleanup.test.mjs, new tools/probe-codex-wake-start-order.test.mjs; docs/background-wake.md.

**Interfaces:** Preserve probeCodexCallbacks(options), assessCallbackProbe(observed), native result schema and single-turn/cleanup behavior. All added readiness state is internal to probeCodexCallbacks.

- [x] Scout all fixture callsites; add a deferred-start test that refuses premature thread/resume, and unrelated/missing/pre-response-start cases. Run RED on the unchanged production probe.
- [x] Await the exactly correlated started event before secondary connect. Update successful protocol fixtures with real-style started notifications. Run focused GREEN and complete sequential wake tests.
- [x] Repeat direct owned stock0.169 native callback probe with preliminary client initialization; capture sanitized actual evidence. Document precise acceptance limits.

## Task 2 — review, integrate, verify

- [x] Independent reviewer actually applies readiness/correlation/timeout/cleanup mutations, reports observed survivors and restores exact bytes; close confirmed coverage gaps RED/GREEN.
- [ ] Run repository checks (known SDD fixture separately), spec-drift, whitespace and scoped integrity; integrate/commit only this repair, preserving unrelated work. Record findings and native limits.
