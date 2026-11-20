---
id: '4858a9179d30d447'
kind: bug
status: fixed
title: the Bash guard tells a subagent with no codescout tool to ask the user, and says only at strike 3 that a retry releases it
tags:
- codescout-companion
- hooks
- subagent
- pre-tool-guard
closed: 2026-11-20
opened: 2026-11-17
owner: marius
---

## Summary

When no codescout tool is loaded, `pre-tool-guard.mjs` still denies a subagent's Bash call. Its denial tells the subagent to "ask the user to run /mcp, or to run the command for you". A subagent cannot ask the user. The guard does stand down after `BREAKER_THRESHOLD = 3` unanswered redirects, but the denial says so only at strike 3. So a subagent that stops after one or two refusals ends its task with no shell. Found 2026-11-17 while reproducing Albert's auto-mode report (the auto-mode half is fixed in codescout-companion 1.22.3, `d32c1f6`).

## Symptom (Effect)

A subagent briefed "if Bash is blocked, use run_command" finds no `run_command` in its tool list. It tries Bash once, gets the denial, and reports that it could not run `echo ok`. The guard would have let the fourth Bash call through.

## Reproduction

Measured 2026-11-17, Claude Code 2.1.326, codescout-companion 1.22.2:

1. `claude -p --permission-mode auto --setting-sources project --settings <file enabling only codescout-companion>` in this repo. With `--setting-sources project`, the user-scope codescout MCP server does not load, but `detectFor(cwd)` still reports `HAS_CODESCOUT` from config.
2. Ask for one general-purpose subagent that calls `mcp__codescout__run_command("echo ok")`, retries once if refused, then tries Bash.
3. Result, verbatim from the subagent: `mcp__codescout__run_command is not callable. It is not in my tool list` … `Bash with command "echo ok" was blocked` … `No codescout tool is present in this subagent session`.

## Cause

- `HAS_CODESCOUT` comes from config, not from the tools the session actually has, so the guard arms in a session without the server.
- `ESCAPE_FOOTER` (`pre-tool-guard.mjs:86`) gives one way out when no codescout tool is present: ask the user. That is right for the main agent and impossible for a subagent.
- The breaker message (`enforce`, strike == `BREAKER_THRESHOLD`) is the first text that says retrying will release the guard. Strikes 1 and 2 do not say it.

## Fix direction (not decided)

**Fixed 2026-11-20, tested, release pending.** `pre-tool-guard.mjs` now builds `ESCAPE_FOOTER` from `input.agent_id`: a subagent gets "you cannot reach the user from here: retry the call" and the stand-down rule on every strike, with no "ask the user" sentence. The main agent keeps the old footer. Pinned by four cases in `pre-tool-guard.test.sh` (90/90; two failed before the change). Not measured: the two cases under *Not measured* below.

Option chosen (the first of two):

- For a caller with an `agent_id`, add one line to the footer on every strike: "If no codescout tool is present, retry the Bash call; the guard stands down after 3 unanswered redirects." Or
- For a subagent with no codescout tool, let the breaker stand down on the first strike.

## Not measured

- Whether a refused codescout call (no PostToolUse) leaves the strike count rising as expected. This covers the case in Albert's report, where Bash was blocked and `run_command` was refused.
- A main-agent session without the server (the footer's advice fits that case).
