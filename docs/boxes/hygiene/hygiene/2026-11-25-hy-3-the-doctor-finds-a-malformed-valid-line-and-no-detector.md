---
kind: entry
status: open
title: HY-3 — The doctor finds a malformed Valid line, and no detector does
created: 2026-11-25
entry_kind: meta
log:
- '2026-11-25 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-25
---

**Valid:** dated 2026-10-19

**Verdict:** miss

**Sweep:** 2026-10-19 (this ledger).

**Observation:** `librarian(action="doctor")` reported `validity_unparseable` for `F-8` in `subagent-bootstrap-session-log.md`. The line read `**Valid:** invariant — measured directly end-to-end; supersedes both the original conditional and the retraction's`. The accepted forms are `invariant`, `dated YYYY-MM-DD` and `conditional — <event>`, so prose after `invariant` makes the line unparseable. The source line also ended in the middle of a sentence, at "the retraction's". No detector D1 to D11 flagged it.

**Fix applied:** the line is now `**Valid:** invariant`. The former text sits on the next line, marked as the former Valid line, verbatim and still cut at the same word. The sweep did not guess how the sentence continued. The log was then archived (D10) under its stable name.

**Proposal (if any):** Phase 2 should read `librarian(action="doctor")` and list its non-zero `validity_unparseable` findings for `docs/trackers/`. A D10 candidate with this defect should have it repaired before the digest or archive step.

**Promote-when:** the same shape is found in a second sweep, or by a sibling project's ledger.
