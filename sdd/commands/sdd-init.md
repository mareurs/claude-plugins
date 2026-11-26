---
description: Set up strict SDD in this project, with its config and a constitution box
---

# /sdd-init

Sets a project up for strict SDD. It commits no config and no readme: the user reviews and commits those. `codescout box add` commits each rule file itself.

## 1. Ask

- Stack: `base` (default), `kotlin` or `python`.
- Enforcement: `strict` (default; hooks deny) or `warn` (hooks only note).
- If `.sdd/config.json` exists, say so and ask before changing anything.

## 2. Write the config

Create `.sdd/config.json` with `{"enforcement": "strict"}` (or `"warn"`). Add
`"baseBranch": "<name>"` only if the base branch is not `main` or `master`. Its presence
turns the sdd hooks on for the project.

## 3. Create the constitution

The constitution is the box `constitution`: one entry per rule. Read
`${CLAUDE_PLUGIN_ROOT}/templates/constitution/base.md` (if `${CLAUDE_PLUGIN_ROOT}` is still an
unexpanded `${...}` placeholder, use the folder of this plugin that contains `templates/`; sdd
has no `.codex-plugin/` folder) and, for kotlin or python, the
stack file next to it. Each has a JSON list of rules (articles I to VI are global, with no
`paths`; VII and VIII carry `paths`) and one `## <title>` section per rule.

Run `codescout box` first. If it lists `constitution`, do not make a second box: add only
the rules that its `codescout box constitution list` lacks. Otherwise make the box once, and
show the user the `git add` and `git commit` lines that it prints, without running them:

```bash
codescout box new constitution constitution --title "Constitution"
```

Then file every rule with one call. The body is `**Rule:**` with the rule text, a blank line,
and the text of the rule's section:

```bash
codescout box constitution add --kind rule --title "Specification first" --text body - <<'EOF'
**Rule:** No source change without an approved spec and plan.

Why, how, evidence.
EOF
```

A rule with `paths` takes them as a JSON argument, after `--text body -`:

```bash
codescout box constitution add --kind rule --title "Kotlin architecture" --text body - '{"fields":{"paths":["**/*.kt","**/*.kts"]}}' <<'EOF'
**Rule:** Dependencies point inward.
EOF
```

A rule is never deleted. To replace one, file the new rule and close the old one with
`codescout box constitution close <entry> superseded --text reason -`.

## 4. CLAUDE.md section (optional)

Ask whether to add the strict-flow section from
`${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.template` (same fallback as above)
(the part under "SDD workflow"). Instruction files outrank skills, so this section keeps the
flow in force. Append it; do not overwrite the file.

## 5. Report

List what was created and say: nothing is committed. Next, start a feature with
`superpowers:brainstorming`, guided by the `sdd-flow` skill.
