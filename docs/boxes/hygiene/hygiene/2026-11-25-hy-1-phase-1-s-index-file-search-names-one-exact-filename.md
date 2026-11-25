---
kind: entry
status: open
title: HY-1 — Phase 1's index-file search names one exact filename, missing this project's real index
created: 2026-11-25
entry_kind: meta
log:
- '2026-11-25 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-25
---

**Valid:** dated 2026-09-05

**Verdict:** proposal

**Sweep:** 2026-09-05 (this ledger).

**Observation:** Phase 1 lists `docs/trackers/README.md` as the index file to look for.
This project's index is `docs/trackers/INDEX.md`. The first pass ran `ls
docs/trackers/README.md docs/TAXONOMY.md docs/trackers/CONVENTIONS.md
docs/trackers/archive-cadence-policy.md`, got four `No such file`s, and concluded "no
convention docs exist" — nearly running a thin sweep (D1 skipped) on a project that has
a rich, hand-maintained index covering 15+ trackers with purpose/status/blocking-edges
columns. Caught only because a later `git ls-files` incidentally surfaced `INDEX.md`
by name.

**Proposal (if any):** Phase 1's bullet should read "a tracker index (commonly
`docs/trackers/README.md` or `docs/trackers/INDEX.md`, but check for any file whose
content is an index/map of the other trackers)" rather than naming one exact filename.

**Promote-when:** same shape confirmed across 2+ sweeps (this project's next sweep, or
a sibling project's ledger hitting the same miss).
