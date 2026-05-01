---
name: explore-project
description: Use when exploring a topic in a foreign project. Spawns an isolated subagent that fully bootstraps the target project's context (CLAUDE.md, codescout index, system-prompt.md) before exploring. Read-only.
---

# /codescout-companion:explore-project

Explore a topic inside a foreign project as if Claude were running there.

**REQUIRED SUB-SKILL:** None. This skill is self-contained.

## When to Use

- You need to understand a topic, pattern, or subsystem in a project other than the current one
- You want the subagent to have full project context (CLAUDE.md, memories, system-prompt.md) not just raw file access
- Read-only exploration — no changes needed

## When NOT to Use

- You need to make changes → use a worktree-based workflow instead
- The target project is already the active project → explore directly with codescout tools

## Flow

1. **Parse args.** `[path]` and `[topic]` from invocation. If missing, ask — one question at a time.

2. **Build exploration brief** (template below). Infer from ambient context — don't ask what's obvious. Hard cap: 3 clarifying questions total.

3. **Confirm.** Show the compact brief, ask "proceed?" — one step so the user can correct wrong inferences.

4. **Spawn `Explore` subagent** using the subagent prompt template below. Fill in all `<...>` placeholders.

5. **Present findings.** Return the subagent's `## Exploration` block as-is. Do not re-synthesize.

## Clarifying Questions Flow

| Field | When to ask |
|---|---|
| Path | If not in args |
| Topic | If not in args |
| Questions to answer | Only if topic is ambiguous or very broad |
| What to look for | Infer from topic; ask only if stakes are high |

## Exploration Brief Template

Build this before spawning. Pass it verbatim inside the subagent prompt.

```
## Exploration Brief

### Project
- Path: <target project path>
- Why: <inferred from ambient task — why this exploration matters>

### Topic
<specific question or area to explore>

### Questions to answer
- <Q1: concrete, answerable question>
- <Q2: ...>

### What to look for
<relevant symbols, patterns, file areas, architectural seams>

### What to skip
<vendored code, fixtures, generated files, unrelated subsystems>
```

## Subagent Prompt Template

Pass verbatim to the `Explore` subagent. Substitute all `<...>` placeholders.

```
You are a code exploration subagent for <target path>.

## Bootstrap — do this FIRST, in order

1. workspace("<target path>", read_only: true)
2. read_markdown("<target path>/CLAUDE.md")           ← project rules and conventions
3. read_markdown("<target path>/.code-explorer/system-prompt.md")  ← skip if file absent

You are now operating as if you were launched inside <target path>.
Follow that project's CLAUDE.md conventions and restrictions for the duration of this task.

## Exploration Brief
<full brief from template above>

## Instructions
1. Complete the bootstrap sequence above before any exploration.
2. Use only codescout tools: symbols, semantic_search, grep, read_markdown, tree, glob.
3. Answer every question in the brief. Keep refining your search until each is answered or explicitly flagged unanswerable.
4. Do NOT write or modify any files — this is a read-only exploration.
5. Before returning: workspace("<original project path>", read_only: false)

## Response format — return ONLY this block

## Exploration: <topic>
**Project:** <target path>

### Findings
- <bullet with file/symbol ref where relevant>

### Key files
- `path/to/file` — what it does

**Confidence:** high / medium / low
**Caveats:** <gaps or what couldn't be determined>
**Follow-up:** <next suggested explorations, or "none">

Do not include raw symbol dumps, full file listings, or meta-commentary.
```

## Common Mistakes

- **Asking too many questions.** Hard cap at 3. Infer aggressively from ambient context.
- **Skipping the brief confirm.** Cheap insurance — always confirm before spawning.
- **Re-synthesizing the subagent output.** Present the `## Exploration` block as-is.
- **Forgetting the bootstrap sequence.** Without `workspace` + CLAUDE.md read, the subagent has no project context.
- **Leaving the active project changed.** The subagent MUST restore the original project at the end (Iron Law #4).
