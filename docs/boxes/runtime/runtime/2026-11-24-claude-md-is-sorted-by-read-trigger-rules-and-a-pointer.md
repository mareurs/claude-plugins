---
kind: entry
status: open
title: 'CLAUDE.md is sorted by read trigger: rules and a pointer table stay, facts and measurements live in memory topics'
anchors:
- CLAUDE.md#Where things live sha256:3946b205ca72c5372814c0806ae175b98bf80777ef8ba0b9dbecef99151c2069
created: 2026-11-24
entry_kind: decision
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-24 open confirmed codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-25 open confirmed codescout:f28fefc6-99c0-4659-8dd2-25250cd05f33'
status_since: 2026-11-25
topics:
- claude-md
---

**What:** `CLAUDE.md` keeps what a session needs before it opens anything else. Machine facts and measurements live in the runtime ledger, procedures and incident detail in memory topics; the `Where things live` table names where.

**Why it matters:** one owner per fact; `CLAUDE.md` went from 36 KB to 16 KB (2026-11-24).

**Next step:** none. Spec: `docs/superpowers/specs/2026-11-24-claude-md-restructure-design.md`.

## Reaffirmed

2026-11-24: Added one row for the runtime ledger to the table; the rule is unchanged.

2026-11-24: The table now points to ledger entries for the machine facts; the rule is unchanged.

2026-11-24: Table row for open leftovers now names runtime-residuals; the read-trigger rule is unchanged.

2026-11-25: 2026-11-25: checked against the section as committed in 979ad85 (the stored hash matches it). The only change since is one new pointer row to the memory topic where-agents-listen, which exists. The rule is unchanged.
