---
id: bf528f91450857a4
kind: bug
status: investigating
title: 'Agent-dispatch guide-ledger guard is a no-op: PostToolUse fires at launch, not at completion'
tags:
- codescout-companion
- hooks
- subagent
- guide-ledger
---

---
kind: bug
status: open
closed:
unverified:
---

# Agent-dispatch guide-ledger guard is a no-op: PostToolUse fires at launch, not at completion

**Found:** 2026-08-27, by direct measurement, ~20 minutes after `1.18.0` shipped.
**Affects:** `codescout-companion` `1.18.0` — `hooks/agent-guide-snapshot.mjs`,
`hooks/agent-guide-restore.mjs`, both added by `d47dea4`.
**Fixes:** nothing. The bug it was written to fix
(`codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md`)
is **still live**.

## Symptom

The snapshot/restore pair is supposed to bracket a subagent dispatch: `PreToolUse:Agent`
snapshots codescout's `guide_hints` ledger, the subagent runs and marks topics delivered,
`PostToolUse:Agent` restores the snapshot so the parent is not starved of guidance the
server thinks it already handed over.

**The bracket closes before the subagent starts.** Re-measured 2026-08-27 on two fresh
dispatches with an in-hook timing probe, UTC, `PostToolUse` matched to `PreToolUse` by
`tool_use_id`:

| event | run 1 | run 2 |
|---|---|---|
| `PreToolUse:Agent` (snapshot) | `07:58:59.304` | `08:00:10.460` |
| `SubagentStart` | `07:59:01.520` | `08:00:12.547` |
| `PostToolUse:Agent` (restore) | `07:59:01.522` | `08:00:12.550` |
| subagent's own first command | — | `08:00:20` |
| subagent finished | `07:59:12` | `08:00:35` |

**Restore fires 2 ms and 3 ms after the subagent starts** — and in run 2, a full **8 s
before the subagent executed its first tool call**, 22 s before it finished. The window
in which the restore could undo a subagent's `get_guide` mark is not merely short; it
closes before the subagent can make one.

The original single-dispatch measurement (`10:25:28.429` / `10:25:30.504` /
`10:25:33.464`) reported restore firing 3 s *before* the subagent ran. These two runs
put restore 2-3 ms *after* `SubagentStart`, which is the more precise reading: the
harness launches the agent and returns from the tool in the same beat.
## Root cause

`Agent` dispatches in this harness are **asynchronous**. The tool returns as soon as the
background agent is launched (`"Async agent launched successfully"`), so Claude Code
considers the tool call complete and fires `PostToolUse` immediately. The hooks assume
`PostToolUse:Agent` means *the subagent finished*; it actually means *the subagent was
launched*.

Both hooks are individually correct. The defect is the lifecycle assumption.

## Measured payload inventory (2026-08-27)

What each hook actually receives on stdin, captured by probe rather than read from docs.
This is what any fix has to key on.

| key | `PreToolUse:Agent` | `SubagentStart` | `PostToolUse:Agent` |
|---|:--:|:--:|:--:|
| `tool_use_id` | ✅ | ❌ | ✅ |
| `agent_id` | ❌ | ✅ | ❌ |
| `agent_type` | ❌ | ✅ | ❌ |
| `tool_name` / `tool_input` | ✅ | ❌ | ✅ |
| `tool_response` / `duration_ms` | ❌ | ❌ | ✅ |
| `prompt_id` / `session_id` / `cwd` / `transcript_path` | ✅ | ✅ | ✅ |
| `effort` / `permission_mode` | ✅ | ❌ | ✅ |

**The tool lifecycle and the agent lifecycle do not share an identifier.** The tool pair
is keyed by `tool_use_id`; the agent pair by `agent_id`; neither key appears on the other
side. `prompt_id` is present on all three, but its uniqueness *per dispatch* is
unmeasured — it plausibly identifies the parent turn, in which case two agents dispatched
in one turn would collide. Do not treat it as a join key without measuring it.

The consequence for the fix: bracket the **agent** lifecycle, not the tool call. Snapshot
at `SubagentStart` (which fires before the subagent's first tool call — 8 s before it in
run 2) and restore at `SubagentStop`, both keyed by `agent_id`. That needs no join key at
all.

## `SubagentStop`: fires after completion, and carries `agent_id`

`SubagentStop` is a real event name in this build (`2.1.247`) — 32 string occurrences in
the binary, comparable to `SubagentStart` (19) and `SessionEnd` (33). It was registered by
no plugin here.

**Measured 2026-08-27 after `/reload-plugins`: it fires, after the subagent finishes, and
it carries `agent_id`.**

The first attempt at this measurement was VOID and was correctly discarded rather than
read. A probe registered on `SubagentStop` wrote nothing — but so did its **positive
control**, the same script registered in the same edit under `PreToolUse:Agent` (an event
known to fire, with a matcher three live hooks already use), while the three hooks whose
*file contents* were instrumented all fired normally. Plugin hook **content** loads live
from the working tree; plugin hook **registration** resolves at process launch, and
`/compact` is not a launch. So that silence measured "registration is stale", not "the
event does not fire". `/reload-plugins` then took the hook count 24 → 26.

The valid run, with the control present:

| t (UTC) | event | Δ |
|---|---|---|
| `08:32:13.384` | `control-pretooluse` — **control present, run is valid** | — |
| `08:32:13.394` | `PreToolUse:Agent` (snapshot) | +10 ms |
| `08:32:15.461` | `PostToolUse:Agent` (restore) | +2.07 s |
| `08:32:15.461` | `SubagentStart` | same millisecond |
| `08:32:18.859` | subagent's first command | +3.4 s |
| `08:32:28.863` | subagent's last command | +10.0 s |
| **`08:32:32.562`** | **`SubagentStop`** | **+17.2 s after restore** |

`PostToolUse:Agent` and `SubagentStart` landed in the *same millisecond* here (in two
earlier runs `PostToolUse` trailed `SubagentStart` by 2-3 ms). Their relative order is not
dependable and nothing should be built on it.

`SubagentStop` payload keys: `agent_id`, `agent_transcript_path`, `agent_type`,
`background_tasks`, `cwd`, `effort`, `hook_event_name`, `last_assistant_message`,
`permission_mode`, `prompt_id`, `session_crons`, `session_id`, `stop_hook_active`,
`transcript_path`. **No `tool_use_id`** — so the restore cannot be keyed on the tool call,
and the snapshot has to move off `PreToolUse:Agent` too.
## Not the causes (each excluded by measurement)

Ruled out before the timing was found, because every one of them produces the same
observable — an absent snapshot:

- **Not unregistered.** `codescout-companion` went 16 → 18 hook commands with `d47dea4`;
  18 + buddy 5 + superpowers 1 = **24**, exactly what `/reload-plugins` reports. Without
  the two it would be 22.
- **Not a matcher mismatch.** Captured payload carries `tool_name: "Agent"`.
- **Not a missing `tool_use_id`.** Captured: `toolu_01YbYmpcXtCwf7nbBjnLPVvX`.
- **Not `HAS_CODESCOUT=false`.** Hook-internal `detect: "true"`, `cwd` correct.
- **Not a stale cache copy.** Hook-internal `CLAUDE_PLUGIN_ROOT` resolves to the repo
  working tree; a marker planted in the cache copy never fired while the tree copy's did.

## Why the test suite is green

`hooks/agent-guide-snapshot.test.sh` passes, and it is a good test of the wrong thing.

It pipes a **hand-written** payload — `{session_id, tool_use_id, cwd, tool_name:"Agent"}` —
into each hook and asserts the ledger transitions, then `jq`s `hooks.json` to confirm both
hooks are wired to the `Agent` matcher. Both checks are real. Neither can observe **when**
Claude Code invokes them, because the test calls the hooks itself, in the order it chooses.

The suite verifies the logic and the configuration. The defect lives in the interface
between them, which is the one thing a synthetic-payload test cannot reach.

## Why it was invisible without instrumentation

Both hooks are fail-open with no logging, by design. `restore` deletes the snapshot in a
`finally`. So **"no snapshot file" is the identical observable** for: not registered,
wrong matcher, missing `tool_use_id`, codescout undetected, write failure, *and* correct
operation that already completed. Six causes, one reading.

Diagnosis required adding temporary in-hook logging, dispatching real agents, and reading
timestamps. Nothing short of that discriminates — which is itself worth fixing.

## Fix direction (chosen 2026-08-27)

**Chosen: direction 1 — bracket the agent lifecycle, not the tool call.** The measurement
above makes it available and makes the other two unnecessary.

- Snapshot moves `PreToolUse:Agent` → **`SubagentStart`**, keyed by `agent_id`.
  `SubagentStart` fires before the subagent's first tool call (by 3.4 s in the valid run,
  8 s in an earlier one), so it is a sound snapshot point.
- Restore moves `PostToolUse:Agent` → **`SubagentStop`**, keyed by `agent_id`.
- Both ends carry `agent_id`, so **no join key is required** — which matters, because the
  tool pair (`tool_use_id`) and the agent pair (`agent_id`) share no identifier, and
  `prompt_id`, though present on all four events, has unmeasured per-dispatch uniqueness
  and plausibly identifies the parent turn instead.

Rejected, and why:

2. **Defer the restore / lazy reconciliation.** Unnecessary now that a completion event
   exists, and it would have needed a key that does not exist.
3. **Revert `d47dea4` and reopen the upstream bug.** This was the fallback if no completion
   signal was reachable. One is.

**The regression test must assert on ORDERING against a real dispatch**, not on a
self-sequenced pair of hook invocations. A test that calls Pre then Post itself can never
fail this bug — that is precisely why `hooks/agent-guide-snapshot.test.sh` stayed green
through it.
## Note on scope

`1.18.0` is otherwise fine and does not need reverting: the hooks are fail-open, so the
worst case is the pre-existing starvation behaviour. There is a narrow window (~2 s
between Pre and Post) in which a parent `get_guide` mark could be rolled back, but no
instance of that has been observed.
