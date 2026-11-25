---
kind: entry
status: open
title: HY-2 — The doctor finds a cited id prefix with no definer, and no detector does
created: 2026-11-25
entry_kind: meta
log:
- '2026-11-25 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-25
---

**Valid:** dated 2026-10-19

**Verdict:** miss

**Sweep:** 2026-10-19 (this ledger).

**Observation:** `librarian(action="doctor")` reported `cited_prefix_with_no_definer` for `MQ-N` in `docs/trackers/claude-mods-research-2026-10-06.md`. The prefix is cited 10 times across 2 files, but no `## MQ-N — <title>` heading exists anywhere in the corpus. The doctor message is clipped at `entry_pr…`, so I read the rest of its claim (no artifact declares an `entry_prefix`) only as far as that clipped text shows. No detector D1 to D11 flagged this. The sweep logged it and did not fix it, because you asked only for a log entry.

**Proposal (if any):** the v2 detector D7 (citation format) should consume the doctor's `cited_prefix_with_no_definer` check. Until D7 exists, Phase 2 could list the doctor's per-check counts that are non-zero for `docs/trackers/`.

**Promote-when:** the same shape (a cited id prefix with no defining heading) is found by a doctor run in a second sweep.
