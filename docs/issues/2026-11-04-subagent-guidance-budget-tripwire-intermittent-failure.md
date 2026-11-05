# Subagent-guidance budget tripwire intermittently observes a small payload

Status: investigating; not changed in the wake-hook repair

During `bash tests/run-all.sh` in `/tmp/codex-wake-fix`, `test-subagent-guidance.sh` reported 42 passes and one failure: the 20 KB system-prompt tripwire emitted 8136 bytes instead of exceeding 12000 bytes. It was the only suite the runner listed as failed. The hook and this suite were unchanged from the clone's starting commit.

Isolated reruns with fresh `CS_TEST_STATE_SANDBOX` and `XDG_STATE_HOME` passed all 43 checks both in `/home/marius/work/claude/claude-plugins` and the staging clone. Each observed the oversized prompt produce 12232 bytes. This does not establish the cause or prove the problem absent. No fix was attempted as part of the independent versionless wake-launcher repair.

Evidence: codescout background job `@bg_0000000d` in the originating server; full-run failure around output line 839. This handle is server-local and is not a durable replay command. Reproduce with the full runner, then compare `bash tests/test-subagent-guidance.sh` under fresh isolated state.
