---
kind: entry
status: open
title: A guide served by the codescout server keeps the catalog bug query after the bugs move to a box
created: 2026-11-24
entry_kind: friction
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

**What happened:** After the 18 bugs moved from `docs/issues/` to the `bugs` box, the hook query in `subagent-guidance.mjs` was repaired (`fea0936`). The guide `project-activation-bootstrap` is served by the codescout server and still tells agents to run `doc find kind="bug"`. That query no longer sees box entries. A repository cannot repair this from its own tree.

**What I did:** Filed the bug in the codescout repository: `2026-11-24-the-project-activation-bootstrap-guide-queries-the-catalog` (commit `1628d7180` on `experiments`). I verified the guide text with `get_guide` and the source line `src/prompts/guides/project-activation-bootstrap.md:10`.

**Worth keeping:** Before a move, list every place that holds the old query: hooks, guides, skills, tests and server-served text. Server-served text is the one a repository cannot change, so it needs a bug in the server repository.
