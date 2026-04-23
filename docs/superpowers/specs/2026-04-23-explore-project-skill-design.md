---
title: explore-project skill for codescout-companion
date: 2026-04-23
status: approved
---

# explore-project Skill Design

## Problem

Cross-project exploration works today but has no harness. Launching a subagent pointed at a foreign project means:
- No CLAUDE.md for that project loaded (harness only loads it at main session start)
- No codescout index activated for that project
- No system-prompt.md injected
- Subagent has shallow, context-free knowledge of the target

## Solution

A skill that builds an exploration brief, confirms with the user, then dispatches an `Explore` subagent that explicitly bootstraps the target project's full context before exploring.

## Skill

**Name:** `codescout-companion:explore-project`  
**Location:** `codescout-companion/skills/explore-project/SKILL.md`  
**Invocation:** `/codescout-companion:explore-project [path] [topic]`  
**Mode:** Always subagent — activating a foreign project in the main agent mutates shared MCP state

## Flow

```
parse args (path + topic)
    ↓
build exploration brief
(infer from ambient context, ≤3 clarifying questions)
    ↓
confirm brief → "proceed?"
    ↓
spawn Explore subagent
    ↓
present findings block
```

## Project Bootstrapping (subagent)

`activate_project` switches the codescout index and loads memories, but the harness does not auto-load the target project's CLAUDE.md for subagents. The subagent must bootstrap explicitly:

1. `activate_project(path, read_only: true)` — codescout index + project memories
2. `read_markdown("<path>/CLAUDE.md")` — project rules, conventions, active focus
3. `read_markdown("<path>/.code-explorer/system-prompt.md")` — codescout guidance (skip if absent)
4. Explore using codescout tools only (no writes)
5. `activate_project("<original>", read_only: false)` at end (Iron Law #4)

## Exploration Brief Template

```
## Exploration Brief

### Project
- Path: <target path>
- Why: <inferred from ambient task context>

### Topic
<specific question or area to explore>

### Questions to answer
- <Q1>
- <Q2>

### What to look for
<relevant symbols, patterns, file areas>

### What to skip
<vendored code, fixtures, unrelated subsystems>
```

Fields inferred from ambient context; only ask user for true unknowns. Hard cap: 3 questions.

## Clarifying Questions Flow

1. **Path** — from args, otherwise ask
2. **Topic** — from args, otherwise ask
3. **Questions to answer** — draft from topic + ambient context; ask only if thin
4. Hard cap: 3 questions total before building brief

Show compact brief, ask "proceed?" — one confirm step before spawning.

## Subagent Prompt Template

```
You are a code exploration subagent for <path>.

Your FIRST action must be:
  activate_project("<path>", read_only: true)

Then read the project context:
  read_markdown("<path>/CLAUDE.md")
  read_markdown("<path>/.code-explorer/system-prompt.md")  ← skip if file absent

You are now operating as if you were launched inside <path>.
Follow the project's CLAUDE.md conventions and restrictions.

## Exploration Brief
<full brief>

## Instructions
1. Bootstrap the project context as above before any exploration.
2. Use only codescout tools: list_symbols, find_symbol, semantic_search, grep, read_markdown, list_dir, glob.
3. Answer every question in the brief. Keep exploring until each is answered or explicitly flagged unanswerable.
4. Do NOT write or modify any files — read_only mode.
5. Before returning, call: activate_project("<original_path>", read_only: false)

## Response format — return ONLY this

## Exploration: <topic>
**Project:** <path>

### Findings
- <bullet with file/symbol refs>

### Key files
- `path/to/file` — what it does

**Confidence:** high / medium / low
**Caveats:** <gaps or uncertainties>
**Follow-up:** <next suggested explorations or "none">
```

## Output Contract

- No raw symbol dumps
- No listing of every file found
- Bullets cite file/symbol paths so main context can navigate
- Strict schema — no meta-commentary

## Backlog

`/codescout-companion:refactor-project` — same bootstrapping pattern but write-enabled, operates in a git worktree. Tracked in `codescout-companion/docs/backlog.md`.
