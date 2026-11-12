---
kind: bug
status: fixed
title: the buddy parallel-write hint tests "same wall-clock second" in a session-wide log, so it fires on writes that ran one after the other and on writes from different agents
tags:
- buddy
- hooks
- cs-hint
- subagents
closed: 2026-11-12
opened: 2026-11-11
owner: marius
severity: low
unverified: 'Not checked: Codex users'' re-approval of the cs-hint-codex hook after 0.1.1, and the repair in this machine''s ~/.codex. Not measured: whether buddy hooks run under the Visual Studio Code client. The 2026-11-07 issue''s claim that this hint fired correctly 18 of 18 times was not re-checked.'
---

## Summary

`_check_parallel_write` in `buddy/scripts/cs_heuristics.py` (lines 238-260) emits `[cs-hint] Parallel writes risk inconsistent state — serialize write tool calls.` The user saw it in the main view while the main agent was idle and a subagent was working. The test is only: the current tool is a write tool, the previous log entry is a write tool, and both `ts` values are equal. That test is a proxy for "dispatched in parallel". It does not measure concurrency, and the log it reads is shared by every agent in the session.

## Verified

Read from source and data on 2026-11-11:

- **Clock.** `append_entry` in `buddy/scripts/cs_tool_log.py` (lines 15-44) stores `"ts": int(time.time())`. That is 1-second resolution, taken when the PostToolUse hook runs, not when the call started.
- **Log scope.** `handle_cs_tool_use` in `buddy/scripts/hook_helpers.py` (lines 526-670) writes `.buddy/<session_id>/cs_tool_log.jsonl`. `session_id` comes from the hook event. A subagent record carries the PARENT's `sessionId` plus its own `agentId`, so one log holds the main agent and every subagent. `handle_cs_tool_use` has no reference to `agent_id`.
- **Cap.** `MAX_ENTRIES = 50`. Older entries are rewritten away, so a log scan after the fact misses old pairs. The transcripts keep them.
- **Delivery.** The hint is recorded as an `attachment` of type `hook_additional_context` inside the subagent's own transcript (`isSidechain: true`, `agentId` set). The idle main agent did not receive it.
- **Copies.** `cs-hint-codex/scripts/cs_heuristics.py` has the same code at the same lines. `.claude-kat/plugins/cache/sdd-misc-plugins/buddy/0.11.13`, `0.11.14` and `0.11.15` each hold a `cs_heuristics.py` that matches the search string. Other profiles' caches were not checked.

## Evidence

**Population.** A scan of codescout-project transcripts modified in the last 2 days in `~/.claude-kat` (the `~/.claude-stef` project dirs mirror the same files) found 158 genuine deliveries. Classified by the assistant message that issued the calls:

| Class | Count |
|---|---|
| the previous write is in the same assistant message, same agent | 154 |
| the previous write is from a different agent that shares the log | 4 |

Of the 154, 100 wrote the same path twice and 54 wrote different paths. Same-path comparison uses the tool's `path` input only.

**One hit read to the bottom** (`agent-a8cfb37c549a5b648`, session `31731474`, 2026-11-11T19:32:36Z, worktree `tracker-lifecycle-plan-b`):

- Transcript: one assistant message holds an `edit_file` block (streamed 19:32:34.730) and an `edit_code` block (streamed 19:32:35.974), both on `src/librarian/lifecycle/checks.rs`.
- Log (`cs_tool_log.jsonl`): `1794425556 edit_file` and `1794425556 edit_code`. Equal `ts`, so the rule fired as coded.
- Server log (`.codescout/debug.log`): request id=49 received 36.031, response 36.119; request id=50 received 36.407, response 36.501. The writes ran one after the other, 0.29 s apart. The risk named in the hint did not occur.

**A main-agent hit with no subagent** (session `5f715d8f`, 2026-11-11T19:37:37.983Z): three `edit_file` calls on `src/lsp/client.rs`, all blocks of `msg_011CgwhqvLnC2pNzmtzgzhoR`. The first result is stamped 19:37:37.168 and the second block streamed 19:37:37.568, so the first call finished before the second was emitted. The server log for this hit was not read.

**Instrument traps hit while measuring** (they apply to anyone repeating this):

- A transcript splits one assistant message into one record per content block, so "blocks in this record" is always 1. Group by `message.id`.
- `tool_result` records are written as a batch and are not completion times. A `hook_success` attachment can be a PreToolUse hook (here `principal-stamp.mjs`, stamped 34.784), not the PostToolUse one.

## Measured 2026-11-11, second pass (root cause)

**Harness rule, measured.** Four `create_file` calls in ONE assistant message, from the main agent in `~/.claude-kat`, ran one after the other. Each `received request` came after the previous `response` (gaps 0.30, 0.31, 0.30 s; server log ids 14-17). The 0.3 s gap is the PostToolUse hook: `node run.mjs post-tool-use`, `durationMs` 143. Calls 2 and 3 landed in the same wall-clock second (`ts` 1794429333 twice), so the rule fired on call 3 and the hint reached the main agent. This reproduces the bug on demand.

**Population, measured.** A scan of every `.codescout/debug.log*` under `~/work` and `~/agents` (script: pair each `received request id=N` with `response message id=N`; two calls overlap when each starts before the other ends). 35,187 calls, 6,185 write-class calls, 10 write-write overlaps:

| Client | Overlaps | Who ran the two calls |
|---|---|---|
| Visual Studio Code (`claude-code-rust`) | 7 (4 clusters) | one client; calls 2-7 ms apart. This client DOES dispatch writes in parallel |
| Claude Code (`eduplanner-ui`, `garaj`) | 3 | always TWO DIFFERENT agents: principals `…/ad9b55…` vs `…/ade3cf…`, `…/a0ba0d…` vs `…/aabfe8…` (gaps 0.229, 0.101, 0.022 s) |

No Claude Code log shows two overlapping calls from the same principal. So, for Claude Code, the harness serializes one agent's own writes. Real overlap exists only between parallel subagents.

**Rule precision, replayed on the same logs** (hook second taken as the response second, so ±1 at second edges):

| Population | Adjacent write-write pairs | Rule fires | Fires on a real overlap | Real overlaps the rule missed |
|---|---|---|---|---|
| client `claude-code` | 2,560 | 258 | 1 | 0 |
| `claude-code` + rotated logs with no init line | 2,924 | 286 | 1 | 2 |
| `Visual Studio Code` | 9 | 7 | 4 | 0 |

For Claude Code: about 1 true firing in 286 (0.3 %). The one true firing was the 22 ms cross-agent pair. The two cross-agent overlaps it missed fell in different seconds.

**Mechanism.** For serial calls spaced Δ seconds apart, the chance that they share a second is 1 − Δ for Δ < 1 s. At the measured median spacing of 0.43 s, most consecutive writes fire the hint. The rule measures the clock, not concurrency.

**Hook event fields, measured** (headless `claude -p` probe with a dump hook, `~/.claude-kat`, one root call and one subagent call). A subagent's PostToolUse event carries `agent_id` and `agent_type`; a root event has neither. Both carry `tool_use_id`, `duration_ms`, `prompt_id` and the PARENT `session_id`. No event carries an assistant message id. `handle_cs_tool_use` reads none of `agent_id`, `tool_use_id` or `duration_ms`.

**Consequence for the options.**

- Within one Claude Code agent, the hint's premise is false (measured above), so the serializing advice is always a no-op.
- Across agents, concurrency is real, but the hint goes to the agent whose hook ran. That agent cannot serialize the other agent's call.
- Option 2 ("key by `agent_id`") would make the rule never fire in Claude Code, because it only pairs one agent's own calls. So Option 2 reduces to Option 1 for Claude Code.
- `cs_heuristics.py` is byte-identical in `buddy/scripts/` and `cs-hint-codex/scripts/` (`cmp`), and also in the cached buddy versions in all four profiles (0.11.12-0.11.15). The Codex bundle needs its own measurement, because Codex may dispatch writes in parallel the way Visual Studio Code does. Not measured.
- Existing tests: `buddy/tests/test_cs_heuristics.py:252` (`test_parallel_write_detected`) and the `parallel_write` fixture near line 479 pin the same-`ts` behavior, and `tests/test-cs-hint-codex.sh` mentions it. All three must change with any fix.

**Still not measured:** whether buddy hooks run under the Visual Studio Code client at all; Codex's dispatch behavior; the exact hit the user saw (it would be a same-second serial pair, by the mechanism above); how the main view shows a subagent's hook output.

## Effect

- The hint states a risk ("inconsistent state") that did not occur in the one case checked to the server log. It teaches the agent to serialize calls it already serialized.
- It goes to the agent that made the call, so a subagent spends context on it and the main agent cannot act on it.
- Cross-agent pairs can fire it for two agents that each issued one write.
- A prior issue (`2026-11-07-grep-for-concept-heuristic-fires-on-literal-phrase-searches.md`) says this hint "fired correctly 18 of 18 times". That claim was not re-checked here. "Correctly" there means one reader's label; this issue only shows that, for the hit read to the server log, the stated risk did not occur.

## Options (not decided)

1. Remove the heuristic. Justified only if the harness always runs write tools serially. That is the first thing to confirm, for example with the `claude-code-guide` agent or the harness source.
2. Keep it and fix the proxy: key the log by `agent_id` and drop the same-second test. Open problem: a hook may not receive the assistant `message.id`, so it may have no way to tell "same message" from "two calls in a row".
3. Keep it but measure first: for each of the 154 same-message hits, check the server log for overlap, then decide.

I recommend confirming the harness rule (option 1's premise) before any code change.

## Tests to add with any change

- Two write entries with equal `ts` from DIFFERENT `agent_id`s must not fire.
- Two write entries with equal `ts` that the server ran 0.29 s apart must not fire (needs a fixture that carries timing).
- If the heuristic stays, one case that does fire, with evidence that the calls overlapped.
- The 4-way copy set (`buddy`, `cs-hint-codex`, and cached versions) must change together, or a test must pin that they match.

## Resolution (2026-11-11, not yet released)

**Update 2026-11-12:** the words "not yet released" in this heading are out of date. The fix shipped in buddy 0.11.16 and cs-hint-codex 0.1.1; see `### Still to do`.

Decision: remove the rule from buddy (Claude Code) and from the cs-hint-codex bundle. The user chose "fix it first for CC, then we'll see Codex", then chose to measure Codex before touching the bundle.

### Codex 0.167.1 measurements (headless `codex exec`, scratch directory, codescout MCP, cs-hint-codex hook active)

One prompt: four `create_file` calls in parallel. The model wrote one `exec` call with `Promise.allSettled` over four MCP calls.

| Config | Completion times of the 4 `McpToolCall` items | Hook log `ts` | Hint |
|---|---|---|---|
| default (no `supports_parallel_tool_calls`) | 32.539, 32.829, 33.138, 33.455 (0.29-0.32 s apart; each call has its own PreToolUse, tool, PostToolUse cycle) | 832, 832, 833, 833 | fired twice; both wrong, the calls were serial |
| `-c mcp_servers.codescout.supports_parallel_tool_calls=true` | 49.796, 49.844, 49.883, 49.917 (121 ms in total, so the calls overlapped; `ts` order p2, p1, p4, p3) | 909, 909, 909, 910 | fired twice (calls 2 and 3) |

- Codex shows the hint to the model as a `developer` message, so Codex pays the context cost of every false firing. The key `supports_parallel_tool_calls` exists in the 0.167.1 binary.
- Read from source, not run: `codescout/src/server.rs` `acquire_write_guard_if_writing` wraps every call that `is_write_call` marks as a write (`edit_file`, `create_file`, all `edit_code` actions, among others) in a write guard: an in-process mutex plus an `flock` on `.codescout/write.lock` (`src/agent/write_guard.rs`). So codescout serializes the execution of the calls this rule watched, whatever the harness dispatches. Not measured at runtime: whether the 4 calls of the second probe waited on that guard (they were short).

### Changes

- Tests first, in `buddy/tests/test_cs_heuristics.py`: `test_two_writes_with_the_same_timestamp_get_no_hint` (4 write tools) and `test_back_to_back_writes_through_the_real_log_get_no_hint` (real `append_entry`, clock fixed). All 5 failed against the old code with `Parallel writes risk inconsistent state — serialize write tool calls.`
- Then the removal: `_check_parallel_write` and `_WRITE_TOOLS` are gone from `buddy/scripts/cs_heuristics.py`, and `check()` runs 5 checks. The old positive test, `test_sequential_writes_ok` and the `_TRIGGERS["parallel_write"]` fixture are gone. `buddy` suite: 574 passed.
- Codex bundle, test first: `tests/test-cs-hint-codex.sh` now asserts that two same-second writes print nothing, and it checks from the bundle's own log that the two writes really shared a second. It failed against the old bundle with the hint printed. Then `scripts/sync-cs-hint-codex.sh` copied the buddy file. `test-cs-hint-codex.sh`: 11 of 11 pass.
- The buddy architecture memory (`.codescout/projects/buddy/memories/architecture.md`) no longer lists the check.

### Still to do

- Nothing for the code. Released 2026-11-12 check: `0d899fc` (buddy 0.11.16) and `f0378e2` (cs-hint-codex 0.1.1) come after the fix commit `f601612` and both are on `origin/main`. `git grep _check_parallel_write` finds nothing in either bumped tree. `check-profile-parity.sh` reports buddy 0.11.16 in parity across 4 profiles.
- Not checked: whether each Codex user approved the bundle's hook again, and whether this machine's `~/.codex` has the repair from the Codex section of the repo `CLAUDE.md`.
- Not measured: whether buddy hooks run under the Visual Studio Code client.


## Fix provenance

- **SHA:** `f601612ad85b2f86c329feee5aa10026c41b4572` (`main`)
- **patch-id:** `1757cc51cfbb1ef7f43585f9df1567f26df49b92`
