---
id: bf528f91450857a4
kind: bug
status: open
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

**The bracket closes before the subagent starts.** Measured on one dispatch, matched by
`tool_use_id` (`toolu_01YbYmpcXtCwf7nbBjnLPVvX`), local time:

| t | event | evidence |
|---|---|---|
| `10:25:28.429` | `PreToolUse` snapshot written | hook-internal `snapExistsAfter: true` |
| `10:25:30.504` | `PostToolUse` restore consumes + deletes it | hook-internal `snapExisted: true` |
| `10:25:33.464` | **subagent finally runs** | its own `date` + `ls` → `NO SNAPSHOT FILES` |

Restore fires **2.1 s** after snapshot, and the subagent does not begin work until **3 s
after restore has already finished**. Every `get_guide` mark the subagent makes lands
*after* the restore that was meant to undo it, and survives.

## Root cause

`Agent` dispatches in this harness are **asynchronous**. The tool returns as soon as the
background agent is launched (`"Async agent launched successfully"`), so Claude Code
considers the tool call complete and fires `PostToolUse` immediately. The hooks assume
`PostToolUse:Agent` means *the subagent finished*; it actually means *the subagent was
launched*.

Both hooks are individually correct. The defect is the lifecycle assumption.

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

## Fix directions (not yet chosen)

1. **Restore on a signal that means "subagent finished."** If the harness exposes a
   subagent-completion event, bracket on that instead of `PostToolUse:Agent`.
2. **Defer the restore.** Have `PostToolUse` leave the snapshot in place and restore
   lazily — e.g. the parent's next codescout call reconciles, keyed by `tool_use_id`.
3. **Drop the feature and reopen the upstream bug.** If neither is reachable, `d47dea4`
   should be reverted rather than left shipping a guard that does nothing, so the
   starvation bug is visibly open instead of visibly fixed.

**Whichever is chosen, the regression test must assert on ORDERING against a real
dispatch**, not on a self-sequenced pair of hook invocations. A test that calls Pre then
Post itself can never fail this bug.

## Note on scope

`1.18.0` is otherwise fine and does not need reverting: the hooks are fail-open, so the
worst case is the pre-existing starvation behaviour. There is a narrow window (~2 s
between Pre and Post) in which a parent `get_guide` mark could be rolled back, but no
instance of that has been observed.

