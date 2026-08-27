---
id: cedbb7f0919a7444
kind: tracker
status: draft
title: Passover — <thread-name> — <YYYY-MM-DD>
tags:
- passover
topic: <thread-name>
time_scope: dated:<YYYY-MM-DD>
branch: <git-branch>
origin_session_id: <cc-session-id-or-omit>
---

# Passover — <thread-name> — <YYYY-MM-DD>

> **This file is the SKELETON, not a handoff. Its `status:` must stay `draft`.**
> It carries `tags: [passover]` deliberately — `tests/test-passover-template.sh` asserts
> that tag, and a copy of this file needs it to be discoverable. But the discovery query
> in `CLAUDE.md` § *Session Passover* filters on `tags contains passover` **AND**
> `status == active`, so an `active` template is returned to every incoming session as a
> candidate live thread — an empty skeleton offered as work. `draft` is what keeps it out
> of that result while leaving it visible to `find`.
>
> When you copy this file, set `status: active` in **the copy**.
>
> (Measured 2026-08-27, the day the discovery query started working: it returned 6 rows
> and this template was one of them. The fault was invisible while the query's operator
> was broken and returning zero — fixing one defect is what surfaced the other.)

## State

<One paragraph: where things stand and the status, e.g. "Diagnosis done; fix proposed, NOT implemented.">

## Next actions

1. Read this doc, then **VERIFY** the working state below still holds
   (`git status`, run the suite) BEFORE acting — the handoff may be stale.
2. <concrete next step>
3. <…>

## Working state

- Branch / commit / clean-or-dirty:
- Files changed, uncommitted — each tagged KEEP / DELETE / WIP with intent:
- Processes / servers that must be running:

## Anti-goals

- <dead end already walked; do NOT re-attempt>

## Open threads

<optional — loose ends; carry-forward Status:open items. Delete this section if none.>

## Pointers

- Specs / plans / related trackers:
- Back-link: `.buddy/<origin_session_id>/` and the session transcript
