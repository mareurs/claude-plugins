---
id: '1e4f8ea57dbb90e2'
kind: spec
status: done
title: Codex callback probe waits for actual turn start
tags:
- codex
- background-wake
- callback
---

# Codex callback probe start ordering

## Scope and decision

The user authorized continuing systematic runtime debugging and delivery. This is the selected minimal bug repair within that authorization; event-based synchronization is an implementation choice. A fixed delay has no readiness guarantee and retrying arbitrary resume failures could conceal real incompatibility. Retain the single actual thread/turn and all callback/profile/version safeguards.

## Root cause evidence

Actual installed0.169 diagnostic: with a preliminary codescout_background_wake initialize, turn/start accepted at597ms, secondary thread/resume rejected list_turns at606ms, turn/started arrived at613ms. Empty-rollout errors occurred in the same premature attach window on the direct runner. Holding only thread/resume until the own turn/started notification gave a successful native callback probe with one original permission callback, one original dynamic tool callback and no secondary callbacks. Raw sanitized traces are in /tmp/codex-runtime-callbacks-20261118.

## Acceptance criteria

- Wait for the primary's turn/started notification matching both owned threadId and the turnId returned by turn/start, before opening/attaching the secondary.
- Handle a matching notification arriving before the turn/start response. Unrelated thread/turn notifications never unblock the wait.
- Keep one shared bounded timeout for startup and completion. A missing start times out and cleanup interrupts/archives only the owned turn/thread; timers and sockets are cleaned.
- Preserve early-callback rejection, original approval decline, secondary-callback rejection, profile/version validation, and one-thread/one-turn accounting. A server-returned error is never retried or converted to supported.
- Update synthetic fixtures to emit native-style turn/started. Tests deterministically reproduce response-before-start ordering and pin correlation, missing start, completion timeout and early callbacks.
- Run focused/full wake and repo checks. Re-run direct stock0.169 native probe without a proxy, including preflight first-originator initialization. No native automatic-wake claim without a separate test.
