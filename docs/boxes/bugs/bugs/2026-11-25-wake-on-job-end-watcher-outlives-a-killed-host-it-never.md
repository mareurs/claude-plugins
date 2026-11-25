---
kind: entry
status: open
title: 'wake-on-job-end watcher outlives a killed host: it never checks that its Claude Code session is alive'
created: 2026-11-25
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-25 open created codescout:6bb10174-8084-4777-b7ef-38b92a18572d'
severity: low
status_since: 2026-11-25
---

## Summary

The job-end wake watcher (`codescout-companion/hooks/wake-on-job-end.mjs`) never checks that its Claude Code host is alive. After the host dies (`kill -9`, crash) the watcher keeps polling every second until the job ends or its deadline (1800 s default, 7000 s maximum), then writes an exit-2 wake to a dead pipe. Low impact: bounded, no wrong wake. Found 2026-11-26 while measuring the session-bridge wake design (`docs/superpowers/specs/2026-11-26-session-bridge-wake-design.md`, gate G5), which has the same defect in its probe.

## Symptom (Effect)

Measured 2026-11-26, Claude Code 2.1.332, linux, headless session (`claude -p --input-format stream-json`, haiku) in this repository. The session started a background job `sleep 240` through `mcp__codescout__run_command`. The probe then sent `SIGKILL` to the `claude` process.

| Process | Before kill | 3 s, 20 s, 40 s after |
|---|---|---|
| `codescout start --debug` (MCP server) | alive | gone |
| `node .../wake-on-job-end.mjs` (watcher) | alive | alive |
| `sleep 240` (job) | alive | alive |

The watcher is in the "server gone, job alive" branch of `watch()` (`wake-on-job-end.mjs`, the inner `for (;;)` after `!pidAlive(rec.server_pid)`): it polls `rec.job_pid` only. The v1 engine path has the same shape: `processStatus` in `background-wake/platform-node.mjs` checks the server pid, never the host pid.

## Reproduction

1. Start a headless Claude Code session with the codescout-companion hooks and ask it to run `run_command("sleep 240", run_in_background=true)`.
2. Wait until a `wake-on-job-end.mjs` process is a descendant of the `claude` pid.
3. `kill -9` the `claude` pid. Watch the descendants: the MCP server exits, the watcher and the job stay.

## Cause

`watch()` knows the server pid and the job pid. It has no input that names the host session. The hook input carries `session_id`, but no host pid.

## Fix direction (not done)

Exit 0 from the watcher when its parent process is gone (`process.ppid` changes to 1 or the original ppid is dead), checked in the poll loop. Add a test next to `wake-on-job-end.test.sh`.
