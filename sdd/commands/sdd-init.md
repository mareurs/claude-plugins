---
description: Set up strict SDD in this project, with its config and a constitution tracker
---

# /sdd-init

Sets a project up for strict SDD. It never commits: the user reviews and commits.

## 1. Ask

- Stack: `base` (default), `kotlin` or `python`.
- Enforcement: `strict` (default; hooks deny) or `warn` (hooks only note).
- If `.sdd/config.json` exists, say so and ask before changing anything.

## 2. Write the config

Create `.sdd/config.json` with `{"enforcement": "strict"}` (or `"warn"`). Add
`"baseBranch": "<name>"` only if the base branch is not `main` or `master`. Its presence
turns the sdd hooks on for the project.

## 3. Create the constitution

Fetch the exact shape first: `librarian(action="tracker_design", archetype="constitution")`.
Read `${CLAUDE_PLUGIN_ROOT}/templates/constitution/base.md` and, for kotlin or python, the
stack file next to it. Each has a JSON list of rules (articles I to VI are global, with no
`paths`; VII and VIII may carry `paths`) and one `## C-N` section per rule.

Use `find` first (tags `constitution`) so you do not create a second constitution. Then
create the tracker with every rule from the list, and the `## C-N` sections as its body:

```python
doc(action="create", kind="tracker", status="active", tags=["constitution", "sdd"],
    title="Constitution", rel_path="docs/trackers/constitution.md",
    body="## Why this constitution exists\n\nRules for strict SDD.\n\n## Per-rule detail\n\n## C-1 — Specification first\n\nWhy, how, evidence.\n",
    augment={"prompt": "Rules the agent must follow. Add rules with append_entry; supersede, never delete.",
             "entry_collection": "rules",
             "params": {"rules": [{"id": "C-1", "title": "Specification first", "rule": "No source change without an approved spec and plan.", "status": "active"}]}})
```

## 4. CLAUDE.md section (optional)

Ask whether to add the strict-flow section from `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.template`
(the part under "SDD workflow"). Instruction files outrank skills, so this section keeps the
flow in force. Append it; do not overwrite the file.

## 5. Report

List what was created and say: nothing is committed. Next, start a feature with
`superpowers:brainstorming`, guided by the `sdd-flow` skill.
