---
kind: entry
status: open
title: A box verb printed from another repository's checkout does not exist here
created: 2026-11-24
entry_kind: friction
log:
- '2026-11-24 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

**What happened:** I ran `codescout box help repoint` with the codescout repository as the working directory and read a verb that moves citations. In this repository `codescout box repoint '<json>'` answered: NOT DONE, the argument is not a plain name. The root card of this repository says `root scripts: none`: a verb is a script that a repository keeps, so each repository has its own.

**What I did:** I wrote one script that rewrites the path citations of moved files (dry run first), and kept the id citations as they were.

**Worth keeping:** Before you cite a verb, read the `verbs:` line of `codescout box` in THIS repository. A move of documents needs a repoint step, and this repository has none yet.
