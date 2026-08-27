---
id: f9cb185adaa8fc5b
kind: bug
status: open
title: The guide-ledger snapshot/restore bracket cannot affect the session it runs in
tags:
- codescout-companion
- hooks
- guide-ledger
- subagent
- design-defect
---

---
kind: bug
status: open
closed:
unverified:
---

# The guide-ledger snapshot/restore bracket cannot affect the session it runs in

**Found:** 2026-08-27, by runtime measurement, immediately after shipping a concurrency fix
*to this same bracket*.
**Affects:** `codescout-companion` — the whole `agent-guide-snapshot.mjs` /
`agent-guide-restore.mjs` feature, shipped 1.18.0, rewired 1.19.0, made concurrency-safe
1.19.1.
**Severity:** the feature does not do the thing it was built to do. It is not *harmful* —
every version is correct file-state engineering — but its stated goal is out of reach by
construction.

## Summary

The bracket works by editing codescout's guide-hints ledger **file**. codescout loads that
file **once, at server construction**, and the in-memory map is authoritative for the rest
of the process's life. So a hook's edit is invisible to the running server, and the very
next mark overwrites the file from memory.

The feature exists to stop a subagent's `get_guide` fetch starving its parent *within the
session*. That is precisely what it cannot do.

## Measured — the discriminating test

The first attempt at this test was **confounded and its conclusion was wrong**: it removed
a key from `<real-session-id>.json`, but this server was writing to a different file
entirely (see `docs/issues/2026-08-27-test-suite-rekeys-live-codescout-server.md`).
Removing a key from a file the server never reads proves nothing. Redone against the file
the server actually writes:

1. `get_guide("untrusted-content")` → note: *"This guide is static and now in your
   context"* (`first_fetch = true`).
2. Remove `untrusted-content` from the live ledger file — exactly what restore does.
3. `get_guide("untrusted-content")` again → note: **"You already fetched … earlier this
   session"** (`first_fetch = false`).
4. Re-read the file: `untrusted-content` is **back**, re-persisted from memory.

Step 3 proves the server did not re-read. Step 4 proves the file is downstream of memory,
not the other way round.

## Root cause, in codescout's own words

`GuideLedger::load` has exactly **one** production call site — `src/server.rs:453`, in
`from_parts_with_env`. Every other reference is test scaffolding. `insert`, `clear`,
`rekey`, `re_arm` and `expire_idle` all mutate the in-memory `BTreeMap` and write through.
None reads back. `persist`'s own doc comment states the contract:

> *Deliberately NOT read-modify-write: merging the on-disk set back in would resurrect
> exactly the topics `re_arm` and `expire_idle` just removed. The in-memory map is
> authoritative for this process; last writer wins.*

This is deliberate, documented, and correct for codescout. The companion built a mechanism
on the opposite assumption.

## What the bracket DOES still do

Not nothing, and the narrower benefit is real: a **new** server process loads from disk. So
across an MCP reconnect or restart, a ledger the bracket cleaned starts without the
subagent's marks, where an uncleaned one would carry them forward and starve the parent
*then*.

That is worth keeping. It is just a much smaller claim than the one the feature, its bug
files, and its commit messages have been making.

## Why three rounds of work missed it

Every test in `agent-guide-snapshot.test.sh` — including the 5 assertions added in 1.19.1 —
drives the hooks directly and asserts on **file state**. File state was always the thing
that worked. No test, and no live check, ever asked the question that discriminates:
*does the parent actually get its guide back?* The suite could not have caught this, because
its subject is the wrong layer.

This is the `roster-audit-session-log:W-4` shape once more, at feature scope rather than
assertion scope: a check that is green in both the working and the broken world.

## Fix directions (none implemented — this needs a decision, not a patch)

1. **Accept the narrower scope.** Keep the bracket for its cross-restart value, and correct
   every claim attached to it. Cheapest, honest, loses the in-session goal.
2. **Add a reload path to codescout** — e.g. re-stat the ledger and merge on change. Runs
   straight into the reason `persist` is not read-modify-write: a merge would resurrect
   topics `re_arm`/`expire_idle` deliberately dropped. Would need a real design, not a flag.
3. **Move the mechanism server-side.** The parent/subagent distinction the hooks are trying
   to reconstruct from outside is one codescout could hold directly — but MCP gives it no
   subagent identity, which is the upstream bug
   (`codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md`)
   this bracket was a workaround for in the first place.

Option 1 is the recommendation; 2 and 3 are recorded so the next reader does not have to
rediscover why they are hard.

## References

- `codescout:src/tools/guide_ledger.rs` — `load`, `persist`, `rekey`
- `codescout:src/server.rs:453` — the sole production `load` call site
- `codescout-companion/hooks/agent-guide-restore.mjs`
- `docs/issues/archive/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md`
- `docs/issues/archive/2026-08-27-concurrent-subagent-restores-discard-parent-guide-marks.md`
- `docs/issues/2026-08-27-test-suite-rekeys-live-codescout-server.md` — what confounded
  the first attempt at the test above

