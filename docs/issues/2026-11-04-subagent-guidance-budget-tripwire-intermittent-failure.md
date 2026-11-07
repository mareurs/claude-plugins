---
kind: bug
status: fixed
title: Subagent guidance loses buffered stdout on immediate exit
closed: 2026-11-07
---

# Subagent-guidance budget tripwire intermittently observes a small payload

Status: fixed and verified in source on 2026-11-07; release pending.

During `bash tests/run-all.sh` in `/tmp/codex-wake-fix`, `test-subagent-guidance.sh` reported 42 passes and one failure: the 20 KB system-prompt tripwire emitted 8136 bytes instead of exceeding 12000 bytes. It was the only suite the runner listed as failed. The hook and this suite were unchanged from the clone's starting commit.

Isolated reruns with fresh `CS_TEST_STATE_SANDBOX` and `XDG_STATE_HOME` passed all 43 checks both in `/home/marius/work/claude/claude-plugins` and the staging clone. Each observed the oversized prompt produce 12232 bytes. This does not establish the cause or prove the problem absent. No fix was attempted as part of the independent versionless wake-launcher repair.

Evidence: codescout background job `@bg_0000000d` in the originating server; full-run failure around output line 839. This handle is server-local and is not a durable replay command. Reproduce with the full runner, then compare `bash tests/test-subagent-guidance.sh` under fresh isolated state.

## Fix — 2026-11-07

The actual hook was run with a 4096-byte stdout pipe and a delayed reader. It exited 0 after writing only 4096 bytes; JSON parsing failed with an unterminated string. `emit()` calls `process.stdout.write()`, and the following `process.exit(0)` discarded queued pipe writes. The prompt was being injected; its transport was truncated.

The terminal forced exit was removed so Node drains stdout naturally. `codescout-companion/hooks/subagent-guidance.test.mjs` runs the real hook with a large prompt and a paused consumer, then asserts valid JSON and the complete prompt suffix. It failed on the original hook with `Unexpected end of JSON input` and passed after the fix. The existing shell suite also passed all 43 checks, including the 20 KB tripwire. This fixes pipe truncation; it does not change the host's inline output cap or add spilling.

## Final verification — 2026-11-07

`./tests/run-all.sh` exited 0 with `All suites passed`, including the new slow-consumer test. Buddy pytest passed 534 tests. Independent review restored the premature exit in a temporary copy and observed the regression fail. Source fix only; version bump, release, cache installation and restart remain pending.
