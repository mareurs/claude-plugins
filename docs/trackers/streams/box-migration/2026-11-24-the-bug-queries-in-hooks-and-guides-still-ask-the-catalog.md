---
kind: entry
status: open
title: The bug queries in hooks and guides still ask the catalog for `kind="bug"`
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

**What happened:** `codescout-companion/hooks/subagent-guidance.mjs` (STEP 3) tells a subagent to run `doc(action="find", kind="bug", ...)`. The codescout readme of the bugs box says that `doc find --kind bug` lists the old files, not the entries of the box. I did not verify this after a reindex: the catalog still showed the deleted files when I looked.

**What I did:** Nothing yet.

**Worth keeping:** After the reindex, run the query once. If it misses the box, the payload text, `tests/test-subagent-guidance.sh` and the tracker-hygiene skill must name `codescout box bugs list`.
