---
kind: entry
status: open
title: A graft deletes the old id, so a residual that TRACKS the old id must be repointed first
created: 2026-11-24
entry_kind: friction
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

**What happened:** I grafted 12 ghost catalog rows into the migrated bug entries (`doc graft … force=true`). The graft deletes `from_id`. Two archived issues held `unverified: TRACKED af3292c4ea2d4712`. After the graft `doctor` reported that id as "resolves to no artifact", and after my repoint it reported the new home as `fixed`: "the home closed, so the work lost it".

**What I did:** Repointed both lines to `cf21be73063a04c2` (the files are stamped, so `edit_file` refuses; a script replaced the id and `reindex` followed). The two residuals stay flagged. Their caveat text is old; whether to discharge it with RESOLVED is a content decision for the owner of each record.

**Worth keeping:** Before a graft, grep the old id (`grep -rl <id> --include=*.md`). A ghost row hid this finding because its kind was `unknown`; a live row exposes it. `doctor` before and after a graft shows the difference: `missing_file` 12 → 0, `terminal_status_with_caveat` 2 → 4.
