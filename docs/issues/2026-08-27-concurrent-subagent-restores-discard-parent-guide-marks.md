---
id: '39de718d4fc037c6'
kind: bug
status: open
title: 'Concurrent subagents: the last restore wins and replays the oldest ledger view, discarding the parent''s own marks'
tags:
- codescout-companion
- hooks
- subagent
- guide-ledger
- concurrency
---

---
kind: bug
status: open
closed:
unverified:
---

# Concurrent subagents: the last restore wins and replays the oldest ledger view, discarding the parent's own marks

**Found:** 2026-08-27, by direct measurement, immediately after `ba2d214` shipped.
**Affects:** `codescout-companion` — `hooks/agent-guide-restore.mjs`.
**Severity:** low-impact, high-reachability. The cost is **re-injected guide bodies**
(wasted context), never wrong behaviour or corrupted state. But concurrent dispatch is
normal and encouraged, and `ba2d214` is what made the race reachable.

## Summary

Each dispatch gets its own snapshot file — keyed `sha256(session_id:agent_id)` — so
**snapshots never collide**. That part is correct and is what suite Case 3 tests.

The collision is on the **shared ledger**. Restore is a *wholesale overwrite*: it writes
its own snapshot over whatever the ledger currently holds. With two dispatches in flight,
the **last restore to fire wins**, and it replays the ledger as it looked when *its* agent
started — discarding anything the parent marked after that instant.

## Measured — three variants, driven through the real hooks

Ledger keys shown. `PARENT_Z` is a topic the **parent** marked between the two dispatches;
`subX`/`subY` are subagent marks that *should* be undone.

**Variant 1 — parent marks Z between dispatches; long agent finishes LAST**

| t | event | ledger |
|---|---|---|
| t0 | parent ledger | `["base"]` |
| t1 | A starts (snapA = `base`) | `["base"]` |
| t2 | **parent** marks Z | `["PARENT_Z","base"]` |
| t3 | B starts (snapB = `base`+Z) | `["PARENT_Z","base"]` |
| t4 | both subagents mark | `["PARENT_Z","base","subX","subY"]` |
| t5 | B stops | `["PARENT_Z","base"]` ✅ correct |
| t6 | A stops | **`["base"]`** ❌ `PARENT_Z` gone |

**Variant 2 — identical inputs, long agent finishes FIRST**

| t | event | ledger |
|---|---|---|
| t5 | A stops first | `["base"]` |
| t6 | B stops | `["PARENT_Z","base"]` ✅ correct |

Same inputs, different completion order, different result. Pure order dependence.

**Variant 3 — earliest agent started with NO ledger (`__ABSENT__`), finishes last**

| t | event | ledger |
|---|---|---|
| t0 | no ledger at all | *(none)* |
| t2 | parent marks Z | `["PARENT_Z"]` |
| t4 | subagent marks | `["PARENT_Z","subX"]` |
| t5 | B stops | `["PARENT_Z"]` ✅ |
| t6 | A stops — `__ABSENT__` replayed | ***(none)*** ❌ whole ledger deleted |

Variant 3 is the worst: the `__ABSENT__` sentinel makes restore `unlinkSync` the ledger, so
**every** parent mark is wiped and the full guide set re-injects.

## Root cause

`agent-guide-restore.mjs` restores by **overwrite** (`writeFileSync(tmp)` + `rename`), or by
`unlinkSync` for the `__ABSENT__` sentinel. Neither operation is aware that a sibling
dispatch may be in flight, or that the ledger has advanced for reasons unrelated to *this*
agent.

The deeper constraint is real and not a coding slip: the parent and every subagent share
one `session_id`, therefore one ledger keyspace, with **no per-key attribution**. A restore
genuinely cannot tell "the parent marked this" from "a subagent marked this" by inspecting
the ledger alone. Overwrite-from-snapshot is the simplest thing that works for one dispatch
and the wrong thing for two.

## Not introduced by `ba2d214` — but made reachable by it

The pre-`ba2d214` wiring had **identical** restore logic. It was unreachable because the
bracket closed ~2 ms after it opened (`PostToolUse:Agent` fires at launch), so no second
dispatch could interleave. `ba2d214` correctly moved the bracket to
`SubagentStart`/`SubagentStop`, widening the window from **~2 ms to the full subagent
lifetime** — measured at 24 s on a trivial probe.

So the fix is right and this is its honest cost: it traded an inert guard for a working one
with a live race. Stated here rather than left for someone to find.

## Proposed fix — subtractive restore with sibling awareness

Replace overwrite with subtraction:

1. `additions = current_keys − snapshot_keys` — what appeared during this agent's lifetime.
2. Remove only those keys **that no live sibling snapshot also contains**. A key present in
   a sibling's start-snapshot existed before that sibling began, so it is not this agent's
   to remove.
3. Delete your snapshot only when no sibling snapshots remain; otherwise retain it as a
   tombstone so a later-finishing sibling can still consult it.

Traced against the measurements above:

- **Variant 1, t6:** `additions = {Z}`; retained `snapB` contains `Z` → not removed →
  `["PARENT_Z","base"]` ✅
- **Variant 3, t6:** `additions = {Z}`; retained `snapB` contains `Z` → kept →
  `["PARENT_Z"]` ✅ (and the destructive `unlinkSync` path disappears entirely)
- **Single dispatch:** `additions` = exactly the subagent's marks, no siblings → removed.
  Same behaviour as today.

Two prerequisites, neither yet verified:

- **Sibling snapshots must be enumerable.** The filename is
  `sha256(session_id:agent_id)`, which cannot be globbed by session. Needs a
  session-scoped prefix: `cs-guide-snapshot-<sessionHash>-<agentHash>`.
- **`{}` must be equivalent to "no ledger" on codescout's reader.** Subtractive restore
  can leave an empty object where today's `__ABSENT__` path deletes the file. Suite Case 2
  currently asserts *deletion*, so that contract changes. **Confirm against
  `src/tools/guide_ledger.rs` before implementing** — if an empty file is not equivalent,
  keep a delete-when-empty step.

## Tests to add

- The three variants above, driven through the real hooks with an interleaved parent write.
  Suite Case 3 covers snapshot non-collision but **not** ledger convergence, which is why
  this shipped green.
- An order-permutation test: for a fixed interleaving, both completion orders must produce
  the *same* final ledger. That is the property actually being violated, and asserting it
  directly is stronger than asserting either specific outcome.

## Workaround today

None needed for correctness. The observable cost is a guide body re-injecting once.
Sequential dispatch avoids it entirely.

## References

- `docs/issues/archive/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md` —
  the fix that made this reachable (`ba2d214`, patch-id `2e9c082fb34c06d51c9be686e3aa019938cf3d56`)
- `codescout-companion/hooks/agent-guide-restore.mjs`
- `codescout-companion/hooks/lib.mjs` — `agentGuideSnapshotFile`
- `codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md` — the
  upstream bug this whole bracket exists to work around

