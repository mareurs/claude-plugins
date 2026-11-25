---
kind: entry
status: open
title: HY-6 — The precondition gate blocks on a memory read that no detector uses, and does not name stale rows after a deletion
created: 2026-11-25
entry_kind: meta
log:
- '2026-11-25 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-25
---

**Valid:** dated 2026-11-25

**Verdict:** proposal

**Sweep:** 2026-11-25, second sweep of the day (this ledger).

**Observation:** The precondition gate lists three reads and says to stop when any one fires. The sweep of the morning of 2026-11-25 saw `memories.missing_count` 2, called it "a memory-index gap, not a catalog gap" and went on. This sweep followed the text: `codescout migrate-memories --in-place --dry-run` (25 read, 25 upserts, 0 skipped), then the real run, then `index(verify)` showed `missing_count` 0. That took three calls. No detector of Phase 3 reads the memory store: the detectors read files, git, the catalog, `list_stale` and `link_scan`. So the memory read measures a different thing from the other two. A second effect of this sweep: a `git rm` of a box left 9 `missing_file` rows in the doctor. A reindex removed 8 and kept 1, because that row carried an event. The gate lists `reindex` as repair step 1, but no read of the gate tells the sweeper that the rows are stale after a deletion.

**Proposal (if any):** Split the gate. The catalog reads (`augmentation_declared_but_absent`, `edges_missing`) stop the sweep. The memory read becomes a one-line repair note that does not block. Add to the doctor read: "after a deletion or a move in this session, run `librarian(action=\"reindex\")` first, then read `missing_file`". Report any `vanished_kept_ids` row, because a reindex keeps it and the doctor then counts it every time.

**Promote-when:** same shape confirmed across 2+ sweeps.
