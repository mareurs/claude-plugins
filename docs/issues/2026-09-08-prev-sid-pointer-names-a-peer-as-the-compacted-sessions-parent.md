---
kind: bug
status: open
title: On a shared checkout, BUDDY_PREV_SID reads a last-writer pointer, so a compacted session records a live PEER as its parent
tags:
- cluster/shared-resource-carries-no-owner
- buddy
- compaction
- session-state
- shared-checkout
opened: 2026-09-08
owner: marius
related: []
severity: medium
---

# On a shared checkout, `BUDDY_PREV_SID` names a live PEER as the compacted session's parent

## Summary

`buddy/scripts/hook_entry.py` derives the previous session id from the `.current_session_id`
pointer file:

```python
# Capture previous session id BEFORE overwriting the pointer (reload uses it).
prev = ""
pointer = buddy_dir / ".current_session_id"
if pointer.is_file():
    prev = pointer.read_text().strip()
os.environ["BUDDY_PREV_SID"] = prev
```

The comment is correct on a **single-session** checkout, where the pointer's last writer
necessarily *is* your predecessor. It is a **last-writer** file, so on a checkout shared by
several independent sessions it holds whoever ran a hook most recently — a peer.

`handle_session_start` then treats that value as lineage:

```python
if prev_sid and prev_sid != incoming_sid:
    prev_state_path = project_root / ".buddy" / prev_sid / "state.json"
    if prev_state_path.is_file():
        prev_state = load_state(prev_state_path)
        carried_specialists = list(prev_state.get("active_specialists", []) or [])
        if carried_specialists:
            state["active_specialists"] = carried_specialists
        state["parent_sid"] = prev_sid
else:
    carried_specialists = list(state.get("active_specialists", []) or [])
```

**A compaction preserves the session id.** Verified below. So on a solo checkout
`prev_sid == incoming_sid`, the `else` branch runs, and the session correctly carries its own
specialists. On a shared checkout `prev_sid` is a peer, the equality fails, and the `if` branch
takes a *peer's* `state.json` as parent state.

## Symptom (Effect)

Two effects, and they are not equally severe. Distinguish them.

1. **Attribution corruption — lands every time, measured.** The compacted session records a live
   peer as its parent, and the reload marker announces it:

   ```
   <!-- buddy:reloaded sid=59112612-…-e19220d99eac from=5399543d-…-876be459989f source=compact -->
   ```

   `5399543d` was a live peer session in the same checkout, not this session's predecessor.

2. **Specialist adoption — armed, did NOT fire here.** The `if` branch reached
   `state["active_specialists"] = carried_specialists`, but the peer's list was `[]`, so the
   inner `if carried_specialists:` guard held and nothing was adopted. This is a
   data-dependent near miss, not an observed persona transfer, and it should not be reported as
   one until someone sees it.

## Reproduction

1. Two or more Claude Code sessions in one checkout (any profiles).
2. Let a peer session fire any buddy hook — this rewrites `.current_session_id` to the peer.
3. Compact a *different* session.
4. Its reload marker reads `from=<peer-sid>`, and its `.buddy/<sid>/state.json` records
   `parent_sid: <peer-sid>`.

## Evidence

Measured 2026-09-08 in the codescout checkout, immediately after a compaction:

```
git Session-Id trailer, my commits BEFORE compaction     59112612-…-e19220d99eac
git Session-Id trailer, my commits AFTER  compaction     59112612-…-e19220d99eac   <- unchanged
CLAUDE_CODE_SESSION_ID (harness, this shell)             59112612-…-e19220d99eac   <- available
.buddy/.current_session_id                               5399543d-…-876be459989f   <- a PEER
buddy reload marker,  from=                              5399543d-…-876be459989f   <- the PEER
.buddy/<my-sid>/state.json  parent_sid                   5399543d-…-876be459989f   <- landed
```

`5399543d` is independently confirmed as a distinct session: it authored five commits in this
repo's history that this session did not make.

**The harness value was in hand.** `hook_entry.py` computes `sid = _session_id(event)` two lines
above the pointer read. The composer held the correct input and used a different source — which is
the shape, not a missing capability.

## Root cause

`.current_session_id` is a **shared resource carrying no owner**. Nothing in the file distinguishes
"the session that preceded you" from "the session that most recently ran a hook", and on a solo
checkout those are the same string — so the abstraction is correct exactly until a second session
exists, and then fails silently rather than erroring.

The `source` field is what disambiguates and is not consulted for this:

- `source=compact` — the session id is **preserved**. The predecessor is the session itself, so
  `from=` should equal `sid` and the pointer should never be consulted at all.
- `source=resume` — a new id resumes an old one, so a genuine predecessor exists and must come
  from something that actually links the two. A last-writer pointer is not that either; it is
  merely right more often, because a resume usually follows the resumed session's own last hook.

## Why nobody catches this

A compacted session has **no independent memory of its own predecessor** — that is what compaction
removes. So `from=<peer>` is unfalsifiable from inside the one context that reads it, and the
party best placed to notice is the party structurally unable to.

It surfaced here only through an unrelated instrument: this repo's sibling project stamps a
`Session-Id` trailer on every commit, so the git log holds an independent record of which session
authored what. Without that, the marker reads as ordinary.

## Fix

Not implemented. Sketch, smallest first:

1. **On `source=compact`, do not read the pointer.** The id is preserved, so `prev_sid` is
   `incoming_sid` by definition; take the `else` branch unconditionally. This alone closes the
   measured effect and both halves of the latent one.
2. **Make the pointer owner-bearing, or drop it for lineage.** For `resume`/`fork`, a
   last-writer file cannot answer "who was I". If the harness supplies no parent id, recording
   nothing is better than recording a peer — an absent `parent_sid` is legible, a wrong one is not.

## Tests added

None yet. A regression test needs no race: seed `.buddy/.current_session_id` with a *different*
sid, fire `SessionStart source=compact` with a known `session_id`, and assert `parent_sid` is
unset and `from=` equals the incoming sid. The existing suite already builds this fixture shape
for the sibling defect.

Assert on **both** effects. A test that only checks `active_specialists` passes today against a
peer holding an empty list, which is exactly how this stayed invisible.

## References

- `buddy/scripts/hook_entry.py` — the pointer read and `BUDDY_PREV_SID`.
- `buddy/scripts/hook_helpers.py` — `handle_session_start`, the `prev_sid != incoming_sid` branch.
- `buddy/scripts/reload.py` — emits the `from=` marker.
- `docs/issues/archive/2026-09-01-subagent-compaction-fires-parent-session-compact.md` — the same
  neighbourhood and the same cluster, and **not** this bug: that one is a harness event routed
  under the parent's id; this one is a peer's id read from a shared file. Its fix does not reach
  this path.
