---
kind: entry
status: open
title: 'CLAUDE.md is sorted by read trigger: rules and a pointer table stay, facts and measurements live in memory topics'
anchors:
- CLAUDE.md#Where things live sha256:1bd5e877df4d6a26ae6adb87210575687beb57fbbe48d7395a921cf5c9f92d4d
created: 2026-11-24
entry_kind: decision
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- claude-md
---

**What:** `CLAUDE.md` keeps what a session needs before it opens anything else. Machine facts, measurements and procedures live in memory topics, named in the `Where things live` table.

**Why it matters:** one owner per fact; `CLAUDE.md` went from 36 KB to 16 KB (2026-11-24).

**Next step:** none. Spec: `docs/superpowers/specs/2026-11-24-claude-md-restructure-design.md`.
