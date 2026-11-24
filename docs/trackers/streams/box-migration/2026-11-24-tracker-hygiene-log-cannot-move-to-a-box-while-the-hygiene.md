---
kind: entry
status: open
title: '`tracker-hygiene-log` cannot move to a box while the hygiene skill writes it by path'
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

**What happened:** The migrating-trackers skill refuses `tracker-hygiene-log` because the `tracker-hygiene` skill and the session-start banner write it. The banner says a sweep is overdue (due 2026-11-18). 34 flat markdown files are still directly under docs/trackers.

**What I did:** Nothing yet.

**Worth keeping:** Change the hygiene skill to write through a box first. Then move the log, and then the other flat trackers one at a time.
