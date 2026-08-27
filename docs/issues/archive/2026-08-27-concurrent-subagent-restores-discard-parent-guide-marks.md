---
id: a0c6e29c75ae5e10
kind: bug
status: fixed
title: 'Concurrent subagents: the last restore wins and replays the oldest ledger view, discarding the parent''s own marks'
tags:
- codescout-companion
- hooks
- subagent
- guide-ledger
- concurrency
closed: 2026-08-27
unverified: 'Regression-tested (17 assertions, 3 mutants killed) but NOT observed live with real concurrent subagent dispatches — every trace in this file is hook-driven simulation. Separately, the fix is PARTIAL by construction: a parent mark landing after ALL live agents started is unattributable and still removed (see the 2026-08-27 correction under Proposed fix).'
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

### Correction, 2026-08-27 — this design is PARTIAL, and the traces above hid it

Both measured variants happen to put the parent's mark **between** the two
`SubagentStart`s, which is exactly the case a sibling snapshot can attribute. Enumerating
all three positions for a parent mark `Z`, with agents A (starts t1) and B (starts t3):

| when `Z` is marked | overwrite (1.19.0) | subtractive + siblings |
|---|---|---|
| before both starts | kept — `Z ∈ snapA ∩ snapB` | kept ✅ |
| between t1 and t3 | **50%** — kept iff B stops last | **always kept** ✅ |
| after both starts | lost | **still lost** ❌ |

The third row is not an oversight in the implementation; it is the information limit this
file already names. No sibling snapshot predates such a key, so nothing distinguishes it
from a subagent's own mark. Closing it needs **per-tool-call attribution** — a `PostToolUse`
hook recording `(agent_id, topic)` from each response's `_guide_hint` — which is real
complexity on the hot path of every codescout call, and was judged out of proportion to a
defect whose cost is one re-injected guide body. Not built; recorded here as the known
route if the cost ever justifies it.

Removal remains the correct side to err on for the unattributable row: **keeping** an
unattributable key risks the parent starvation this entire bracket exists to prevent
(`codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md`), while
removing it costs one re-injection.

Two prerequisites, **both now verified** (were unverified when this was filed):

- **Sibling snapshots must be enumerable.** ✅ Done by splitting the filename into
  `cs-guide-snapshot-<sessionHash>-<agentHash>`. Only two hooks and one test suite consume
  the name, so the change was contained.
- **`{}` must be equivalent to "no ledger" on codescout's reader.** ✅ Verified at the bytes
  in `codescout:src/tools/guide_ledger.rs`: `read_entries` early-returns `BTreeMap::new()`
  when `read_to_string` fails (missing file) and parses `{}` as `LedgerFile::Stamped(empty)`
  — identical results, so `is_empty()` and therefore the bootstrap re-arm behave the same.
  `gc` skips the caller's own file and falls back to mtime for an empty one, so a freshly
  written `{}` is not pruned. Nothing in either repo tests the ledger for *existence*.
  Restore nevertheless **deletes when the result is empty**, preserving the observable
  contract this hook has always had so that nothing downstream depends on the equivalence
  continuing to hold.
## Tests to add

All added in `codescout-companion/hooks/agent-guide-snapshot.test.sh` — 12 assertions → 17.

- **The old Case 3 asserted the bug as correct.** Its setup is Variant 1 exactly, and its
  `WANT` was the post-discard ledger. Rewritten to require the parent's interleaved mark to
  survive, plus a second assertion that the sibling's own stop converges on the same ledger.
- **Case 3b — stamp preservation.** A topic the parent re-marked mid-dispatch must keep its
  *new* stamp. Case 3 cannot catch this: its stamps never change, so overwrite and
  subtraction agree there.
- **Case 3c — order independence.** One fixed interleaving, both completion orders, same
  final ledger. This is the property 1.19.0 actually violated.
- **Case 3d — Variant 3.** The agent that started before any ledger existed, finishing last,
  must no longer delete the ledger on its way out.

**Mutation-tested 2026-08-27** — each gate fails on a distinct defect:

| mutant | assertions killed |
|---|---|
| sibling awareness removed (`vouched = ∅`) | 4 |
| tombstone retention removed | order-independence + Variant 3 |
| delete-when-empty removed | "restores true absence" |

One result worth keeping: **order-independence alone stayed GREEN under the first mutant**,
because both completion orders then converge on the same *wrong* ledger. The property check
pins the shape; only the value check underneath pins the content. They are paired in the
suite for that reason, with the finding noted inline — another instance of
`roster-audit-session-log:W-4` (a check returning the same value for every candidate reads
exactly like a check that passed).
## Workaround today

None needed — fixed in `6046ea09`. Sequential dispatch avoids the residual
after-all-starts window entirely.
## Fixed — 2026-08-27

**Fix:** `6046ea09` on `main` (patch-id `548739f240a44319ed729cdf29160f08fe55c767`).

What changed, beyond the subtraction itself:

- **Snapshot filenames** split into `<sessionHash>-<agentHash>` so a session's snapshots are
  enumerable. A single combined hash cannot be globbed by session.
- **Snapshots store the ledger's KEY SET, not its bytes.** Restore never writes a stamp
  back, so surviving topics keep the parent's real delivery times. The 1.19.0 overwrite
  rewound every stamp to snapshot time — and that stamp is the input to codescout's
  idle-expiry, so the old restore was quietly extending every topic's life.
- **The `__ABSENT__` sentinel is gone.** An absent ledger is simply an empty key set; the
  sentinel existed only because restore-by-overwrite had no way to say "and there was no
  file", and its `unlinkSync` path is what produced Variant 3's total wipe.
- **`decodeGuideSnapshot` accepts every historical shape** (`{v,keys,done}`, `__ABSENT__`,
  raw 1.19.0 ledger bytes, codescout's legacy bare array), so a mid-session plugin upgrade
  degrades to a slightly stale key set rather than a crash.
- **24h GC on snapshot debris.** Nothing collected it before: the only deleter was a
  `SubagentStop` that may never fire.

Incidental, found while reading: `ba2d214` left a **stale duplicate comment block** in
`lib.mjs` that still described the snapshot as keyed by `tool_use_id`, contradicting the
code directly below it. Removed in the same commit.

No reload was required for this fix to go live: hook **content** loads from the working
tree on every invocation, and the **registration** (`SubagentStart` / `SubagentStop`) is
unchanged. See `.codescout/memories/agent-dispatch-hooks.md` § *Hook CONTENT vs hook
REGISTRATION*.

## References

- `docs/issues/archive/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md` —
  the fix that made this reachable (`ba2d214`, patch-id `2e9c082fb34c06d51c9be686e3aa019938cf3d56`)
- `codescout-companion/hooks/agent-guide-restore.mjs`
- `codescout-companion/hooks/lib.mjs` — `agentGuideSnapshotFile`
- `codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md` — the
  upstream bug this whole bracket exists to work around
