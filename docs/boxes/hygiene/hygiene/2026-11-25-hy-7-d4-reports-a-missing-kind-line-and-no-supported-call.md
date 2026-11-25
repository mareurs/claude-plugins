---
kind: entry
status: open
title: 'HY-7 — D4 reports a missing kind: line, and no supported call can fix it on a ledger'
created: 2026-11-25
entry_kind: meta
log:
- '2026-11-25 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-25
---

**Valid:** dated 2026-11-25

**Verdict:** miss

**Sweep:** 2026-11-25, second sweep of the day (this ledger).

**Observation:** D4 fired on two files with no `kind:` line in their frontmatter: `collection-hot-path-session-log.md` and `archive/portable-workflows-session-log.md`. The operator approved the fix, and it could not be applied. `edit_file` refused both files: each declares `entry_prefix`, so each is a ledger, and the ledger guard blocks a direct edit. `doc(action="update")` takes `status`, `title`, `owners`, `tags`, `topic`, `time_scope`, `extra`, `body`, `body_edits` and `params`, and it has no `kind`. So no supported call adds `kind:` to the frontmatter of a ledger. A test of `doc(action="update", patch={extra:{kind:"tracker"}})` on `collection-hot-path-session-log` was refused: "extra must not contain frontmatter field(s) the schema already models: kind", with the hint that `kind` is fixed once the artifact exists. The catalog lists both files as `kind=tracker` anyway, so the missing line changes no result of this skill. The morning sweep fixed the neighbouring `status:` line of the same two files and left `kind:` out.

**Proposal (if any):** Either D4 stops reporting a file whose catalog row already carries the right `kind`, or `doc(action="update")` accepts `kind`. The first costs one condition in the skill; the second is a codescout change.

**Promote-when:** the same two files fire D4 in the next sweep.
