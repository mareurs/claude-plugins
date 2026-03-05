# Design: Unconditional Tool Directive for Coding Subagents

**Date:** 2026-03-01
**Status:** Approved

## Problem

`subagent-guidance.sh` currently exits immediately if no `.code-explorer/system-prompt.md`
exists. When the system prompt does exist, the hook injects it verbatim — but provides no
active directive about *how* to navigate code.

Result: subagents (code-reviewer, design agents, implementation agents, etc.) default to
`git diff`, `Read`, `Grep`, `Bash` — exactly what the pre-tool-guard blocks and what
code-explorer is designed to replace.

## Goal

All coding subagents receive an imperative "use code-explorer for ALL code navigation"
directive, regardless of whether a project system-prompt.md exists.

## Design

### Change to `subagent-guidance.sh`

Remove the early exit on `HAS_CE_SYSTEM_PROMPT = false`. Always build and emit a message.

**New message structure:**

```
CODE-EXPLORER: For ALL code navigation, use code-explorer tools — not Read/Grep/Glob/Bash on source files:
  find_symbol / list_symbols / semantic_search — discover code
  goto_definition / find_references — navigate relationships
  replace_symbol / insert_code — edit code

[CE_SYSTEM_PROMPT appended here if system-prompt.md exists]
```

### Skip list unchanged

`Bash|statusline-setup|claude-code-guide` — agents that don't do code work.

### Exit conditions unchanged

Still exits if `HAS_CODE_EXPLORER = false` (no code-explorer configured for project).

## Rationale

- Mirrors how `session-start.sh` always appends "NEVER USE BASH AGENTS FOR CODE WORK"
  to the main agent, regardless of other content
- MCP `server_instructions` is passive reference; this hook adds the imperative layer
- One minimal change, universal coverage, no per-agent-type complexity
- Project system-prompt still appended as before — no regression
