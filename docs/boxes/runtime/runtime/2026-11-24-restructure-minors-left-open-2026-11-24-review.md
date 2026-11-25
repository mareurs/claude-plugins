---
kind: entry
status: done
title: Restructure minors left open (2026-11-24 review)
closed: 2026-11-24
created: 2026-11-24
entry_kind: residual
log:
- '2026-11-24 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-24 open -> done codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-24
topics:
- claude-md
---

**What:** `machine-linux.md` still says "§ Installing" and "the Windows section below"; three memories use history wording; `tests/test-passover-template.sh:41` has a stale comment; `AGENTS.md` names a memory topic where a Codex session needs the file path; one lowercase fragment near `design in` in `CLAUDE.md`; `plugin-load-channels.md` keeps an old contradiction about hooks and `installPath`; "installing does not approve" lives only in `README.md`.

**Why it matters:** each is a small wrong or missing pointer.

**Next step:** fix in one pass; the first four are one-line edits.

## Closed

Fixed: stale test comment, lowercase fragment, hooks/installPath contradiction. Dropped as already done: machine-linux refs, AGENTS.md pointer (now a command), installing-does-not-approve (README plus AGENTS.md approval line).
