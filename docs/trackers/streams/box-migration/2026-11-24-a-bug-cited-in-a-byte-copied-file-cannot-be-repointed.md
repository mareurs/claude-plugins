---
kind: entry
status: open
title: A bug cited in a byte-copied file cannot be repointed without a Codex re-approval
created: 2026-11-24
entry_kind: friction
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

**What happened:** `buddy/scripts/cs_heuristics.py` and `cs-hint-codex/scripts/cs_heuristics.py` are byte copies, and both cite the old stem of one moved bug in a comment. CLAUDE.md says a change to the copy needs `scripts/sync-cs-hint-codex.sh`, a version bump, and a new approval from every Codex user.

**What I did:** I left both comments with the old name, and told the user.

**Worth keeping:** Do not cite a bug path in a file that another plugin copies byte for byte. Cite it where the copy does not reach, or by a name that does not move.
