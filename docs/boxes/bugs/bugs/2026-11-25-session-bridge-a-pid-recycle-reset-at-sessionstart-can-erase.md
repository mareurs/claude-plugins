---
kind: entry
status: open
title: 'session-bridge: a pid-recycle reset at SessionStart can erase the wake watcher''s claim, so the watcher exits and no wake arrives until the first Stop'
created: 2026-11-25
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-25 open created codescout:6bb10174-8084-4777-b7ef-38b92a18572d'
severity: low
status_since: 2026-11-25
---

## Summary

`reset_if_recycled` (`session-bridge/mcp-server/src/hook.rs`, run by `session_start`) resets the whole endpoint state when the Claude pid was reused by a new process. The wake watcher (branch `feat/session-bridge-wake`, `src/wake.rs`) claims its slot in the same state file from a parallel `SessionStart` hook. If the claim lands before `session_start` runs the reset, the reset erases the new claim. The watcher then sees `watcher_pid != own` and exits, so there is no wake until the first `Stop` hook re-arms it.

## Why it happens (read at the bytes, not reproduced)

- `reset_if_recycled` treats a state as stale when `started_ms > 0` and the process started more than `RECYCLE_GRACE_MS` after it, then writes `EndpointState::default()` (`hook.rs:101-124`).
- `claim_watcher` writes only the watcher fields into whatever state is on disk; it does not touch `started_ms`, so the old `started_ms` is still there and the state still looks stale.
- Both hooks are separate `SessionStart` entries and run in parallel (`session-bridge/hooks/hooks.json`).

## Effect

Narrow: it needs a reused Claude pid and that order of the two hooks. It heals itself at the end of the first turn, because `Stop` arms a new watcher. A session that stays idle from its first second never gets the wake until then. Found by the Task 5 review of the wake plan.

## Fix direction (not done)

Let the watcher run the same recycle check before it claims (share `reset_if_recycled`), or make `claim_watcher` refuse to write into a stale state. Add a test with a state whose `started_ms` is older than the process start.
