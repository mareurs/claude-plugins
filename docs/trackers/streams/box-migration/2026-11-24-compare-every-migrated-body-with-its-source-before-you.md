---
kind: entry
status: open
title: Compare every migrated body with its source before you delete the source
created: 2026-11-24
entry_kind: win
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

**What happened:** Another session closed a bug in docs/issues (commit f7e6014) while I moved the files. A body check after the move and again just before `git rm` found 0 differences across 18 files. Without it, an edit made after the copy would have been deleted with the source.

**What I did:** A script compared each source body with the new entry (`in` the entry text), and I ran it twice.

**Worth keeping:** In a shared checkout, check the source again immediately before you delete it.
