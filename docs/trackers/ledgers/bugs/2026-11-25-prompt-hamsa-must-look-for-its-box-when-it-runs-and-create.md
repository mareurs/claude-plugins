---
kind: entry
status: open
title: prompt-hamsa must look for its box when it runs and create it when the project has none
created: 2026-11-25
entry_kind: bug
log:
- '2026-11-25 open created codescout:71d13fb6-69a1-4c81-a031-75bc3b531573'
status_since: 2026-11-25
---

**Summary:** `buddy/skills/prompt-hamsa/SKILL.md` (line 52, "Record the audit") tells the agent to run `codescout box prompt-hamsa add …` and adds "No box: `codescout box new <skill dir>/box prompt-hamsa --title Audits`" as an afterthought. The agent runs `add` first, fails on a project that has no box, and only then reads the fallback. The skill never asks the agent to look for the box first.

**What the skill must do instead** (the goal, not the steps):
- When Hamsa runs, before it records anything, it finds out whether this project has the box `prompt-hamsa`: `codescout box` lists the boxes of the repository, and the key `prompt-hamsa` is there or not.
- If the box is there, `add` goes to it.
- If the box is not there, Hamsa makes it from the skill's own template, `codescout box new <skill dir>/box prompt-hamsa --title "Prompt Hamsa audits"` (`<skill dir>` is the "Base directory for this skill" the harness prints when the skill loads), then commits the readme with the two lines that `box new` prints, and only then files the audit.
- In a linked worktree both calls take `--project <main>` (the box lives in the main checkout).
- Which project: the skill already says `claude-plugins` for craft reflections and the project for the rest; the lookup and the creation apply to whichever project the audit goes to.

**Done when:** a session in a repository with no `prompt-hamsa` box records an audit in one pass, with no failed `add`, and the box exists afterwards. Check it once on a scratch repository outside the system temp directory (`box new` refuses a scratch repository under it; see the codescout entry `box-new-cannot-be-tried-out`).

**Also pending in this skill's neighbourhood** (from codescout E7b-2, 2026-11-25): codescout moved its own `prompt-hamsa-audit-log` into its box `prompt-hamsa`, and the Protocol P-1..P-8 now lives in `docs/research/2026-11-25-prompt-hamsa-protocol.md` of codescout. Two files still cite the old path and must point there: `docs/templates/eval-pre-registration.md:7` ("Mirrors codescout `docs/trackers/prompt-hamsa-audit-log.md` § *Protocol*") and the citation in `buddy/skills/prompt-hamsa/references/eval.md`. This is the item 4 of the entry `2026-11-25-prompt-hamsa-records-its-audits-as-augmentation-params-which`.
