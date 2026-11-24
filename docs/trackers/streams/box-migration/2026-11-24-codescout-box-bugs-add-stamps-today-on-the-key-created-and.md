---
kind: entry
status: open
title: '`codescout box bugs add` stamps today on the key, `created` and `closed`'
created: 2026-11-24
entry_kind: friction
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

**What happened:** I moved 18 bug files from docs/issues into the bugs box. `add` committed each entry by itself (`commit: new-entries`), and it gave every entry the key prefix 2026-11-24 and today's `created` and `closed`. The original dates (for example closed 2026-11-07 on the subagent-guidance bug) were not kept. The codescout repository shows the same: 73 of its 104 bug entries carry the key prefix 2026-11-22, the day it moved its bugs.

**What I did:** I put one header line at the top of each body: the old path, opened, closed, priority, tags, owners and the old id.

**Worth keeping:** A migration that must keep dates needs an `add` option for them, or a body header like this one. The old id in the header keeps the old citations findable with grep.
