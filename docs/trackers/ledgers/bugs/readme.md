---
kind: collection
title: Bugs
commit: new-entries
entry_kinds:
- bug
fields:
  severity:
    type: enum
    values:
    - low
    - medium
    - high
  claimed_by:
    type: scalar
  unverified:
    type: scalar
  no_fix_commit:
    type: scalar
  last_observed:
    type: scalar
  related:
    type: list
hot_cap: 12
initial_status: open
key_style: dated
owner: marius
stale_after: 30d
statuses:
  open: open
  taken: open
  investigating: open
  zombie: open
  fixed: terminal
  mitigated: terminal
  wontfix: terminal
  superseded: terminal
template: issues
---

# Bugs

The bugs of this repository. One entry per bug. An entry ends as `fixed`, `mitigated`, `wontfix` or `superseded`.

## When to open a bug

- The user asks to log it, or it blocks the current task.
- You notice a bug that you will not fix in this session.
- A fixed bug whose investigation is worth keeping.
- Not here: a typo (the commit message is enough), a feature idea, a dislike.

## Statuses

- `open`: logged, not started. `taken`: a live session holds it; set `claimed_by` to its session id.
- `investigating`: worked, no live owner. `zombie`: not seen again, cause unconfirmed; set `last_observed`.
- `fixed`: cause removed, regression test, verified. `mitigated`: workaround only.
- `wontfix`: the entry says why. `superseded`: another entry covers it.

## How to add

Run `codescout box <key> add --title "..."` and leave the body empty: the entry takes the skeleton below. Then fill the sections in the entry file.

## How an entry ends

A `fixed` or `mitigated` entry needs a `## Fix provenance` section with two bullets: `- **SHA:** <sha> (<branch>)` and `- **patch-id:** <id>` (`git show <sha> | git patch-id --stable`). With no commit at all, set `no_fix_commit` to the reason. Set `unverified` to what is not established; discharge it with CLEARED, REFUTED, RESOLVED or WITHDRAWN as its first word.

## Entry template

**Summary:** what is broken, and who is affected.

**Symptom:** the exact observed behavior, verbatim.

**Reproduction:** copy-pasteable steps, with the output of `git rev-parse HEAD`.

**Root cause:** the mechanism, with `path:line`. Add one line for what measured it.

**Evidence:** quoted output, with its source.

**Fix:** where the change lives. A workaround stays `mitigated`.

**Tests added:** the regression test and its `path:line`, or why there is none.

**Resume:** the next concrete action.
