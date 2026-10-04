---
id: b11c9b68622f7884
kind: bug
status: open
title: Claude Code's native task tool (TaskCreate/TodoWrite) is absent from a ~/.claude-kat session's tool list, even after /reload-plugins
tags:
- claude-code
- tools
- task-tool
- claude-kat
- hooks
- plugins
---

## Summary

In a `~/.claude-kat` session on MRV-poc (2026-09-27, session `82063589-65a8-4b59-b0a5-f1c1bfd1232b`, model Opus 5.5 1M), Claude Code's native task tools were **absent from the model's tool list**. The user expected Claude Code's native task-creation tool (called "CreateTask" in the session).

Checked twice, including after `/reload-plugins` ("Reloaded: 5 plugins · 58 skills · 6 agents · 26 hooks · 1 plugin MCP server"):
- **Absent:** `TaskCreate` / `TodoWrite` / any task-list tool. There is also no `ToolSearch`, so no deferred tool could be loaded.
- **Present:** the only task-adjacent tool was `TaskStop` (stops background jobs).
- **User's reading:** they believe the tool exists and something in the plugin stack hides it, hence this issue in claude-plugins.

## Verified so far

- **`Bash`, `Write` and `Edit` are explained and not part of this bug.** `~/.claude-kat/settings.json` → `permissions.deny: ["Bash", "Write", "Edit"]`. They are denied on purpose, so codescout's tools are used instead.
- **Nothing denies the task tools at settings level.**
  - `~/.claude-kat/settings.json`'s `deny` has only those three.
  - MRV-poc's `.claude/settings.json` and `.claude/settings.local.json` contain no `deny`/`disallow` entry. Their only `task` hits are `mcp__southpole__*tasks*` allows.
- **No plugin manifest mentions them.** `grep -rl -E "TaskCreate|TodoWrite|ToolSearch|disallowedTools" --include=*.json` over this repo finds only `buddy/.buddy/*/verdicts.json` session artifacts.
- **Enabled plugins:** `superpowers@superpowers-marketplace`, `codescout-companion@sdd-misc-plugins`, `buddy@sdd-misc-plugins`.
- **Tools that were present:**
  - native: `Agent`, `AskUserQuestion`, `Read`, `Glob`, `Grep`, `Monitor`, `TaskStop`, `SendMessage`, `ListAgents`, `Skill`, `ScheduleWakeup`, `PushNotification`, `WebFetch`, `WebSearch`, `EnterPlanMode`/`ExitPlanMode`
  - MCP servers: codescout, southpole, chrome-devtools, researcher, claude.ai connectors

## Hypotheses (unverified)

1. **A hook or plugin component removes or hides the tool.** Candidates are the 26 hooks, e.g. a PreToolUse or SessionStart hook in codescout-companion or buddy. No evidence yet; nothing in the manifests names the tool.
2. **A CC version or feature gate.** The task tool may be gated to certain entry points or modes: SDK/print sessions, or `defaultMode: "auto"`. That would make it not a plugin issue.
3. **Profile drift.** Compare with a `~/.claude` or `~/.claude-sdd` session. If the tool is present there, diff the profiles' settings and enabled plugins.

## Next steps

1. Start a fresh `~/.claude-kat` session with all three plugins disabled. Is the task tool listed?
2. Re-enable the plugins one at a time to bisect.
3. Compare against a `~/.claude` session on the same CC version.
4. Record the CC version (`claude --version`) alongside each observation.

## Impact

The model cannot keep a native task list, so plans fall back to ledgers, trackers or Jira. In the MRV session that meant a round trip to explain the tool was absent.
