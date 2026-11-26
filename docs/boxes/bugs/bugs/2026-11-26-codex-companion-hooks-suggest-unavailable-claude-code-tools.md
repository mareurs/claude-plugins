---
kind: entry
status: open
title: Codex companion hooks suggest unavailable Claude Code tools
created: 2026-11-26
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-26 open created codescout:anonymous'
severity: medium
status_since: 2026-11-26
---

## Summary

Codescout Companion 1.23.9 emits Claude Code skill and tool-discovery instructions in a native Codex CLI 0.171.0 session. The plugins, hooks, and codescout MCP are loaded. The instructions leave Codex without a usable recovery path for a missing tool.

## Symptom

SessionStart advertises `Skill('codescout-companion:reconnaissance')` and `ToolSearch`. The guarded shell read was correctly redirected to codescout but the denial then said “load it with ONE ToolSearch call” and suggested `/mcp` and `! <command>` as further recovery. Codex's active tool registry exposes neither a `Skill` nor a `ToolSearch` callable.

## Reproduction

1. Start Codex CLI 0.171.0 in the codescout checkout with companion 1.23.9 installed and trusted.
2. Read the SessionStart guidance. Invoke the native shell tool with `cat CLAUDE.md`. Compare the follow-up instructions in the refusal with the session's available tools.
3. Use codescout's available `workspace`, `read_file`, or `run_command` to confirm connection separately.

`git rev-parse HEAD` in the plugin source audit returned `b98ed312e3bfac779aa5202b89a90f6705580fe3`.

## Root cause

`codescout-companion/hooks/session-start.mjs:177` treats the absence of a Claude ancestor as evidence that the `Skill` tool may exist; the call at line 235 emits Claude syntax. `codescout-companion/hooks/pre-tool-guard.mjs:75` documents the Claude-only footer, emitted on lines 80–97. That footer reached the native Codex call intact. The Codex denial's capture and the installed/source byte comparison establish the affected path.

## Evidence

Observed both before and after a Codex restart. The restarted profile had the relevant skill enabled and its companion hooks trusted. Workspace activation, a heading read, and symbol lookup succeeded. See [[codescout/2026-11-26-companion-hooks-give-codex-claude-code-tool-instructions]].

## Fix

Pending.

## Tests added

None for this filing. A regression test should exercise both messages with native Codex input and retain a Claude Code positive control.

## Resume

Trace where the companion's installed hook bundle selects the host and test the startup skill hint and guarded read footer against Codex's actual tool registry.
