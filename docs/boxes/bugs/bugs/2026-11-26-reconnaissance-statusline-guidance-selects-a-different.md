---
kind: entry
status: open
title: Reconnaissance statusline guidance selects a different session in Codex
created: 2026-11-26
entry_kind: bug
last_observed: 2026-11-26
log:
- '2026-11-26 open created codescout:anonymous'
severity: low
status_since: 2026-11-26
---

## Summary

The reconnaissance skill is available in Codex, but its optional statusline step uses Claude Code's session lookup. In the observed workspace this would write the marker into a different session's Buddy directory.

## Symptom

A read-only probe returned `codex_session_present=True`, `claude_session_present=False`, `fallback_present=True`, and `marker_would_use_current_codex_session=False`.

## Reproduction

Open the workspace in Codex 0.171.0 with companion 1.23.9. Through codescout's `run_command`, evaluate the skill's selection without touching a file:

```sh
sid="${CLAUDE_CODE_SESSION_ID:-$(cat .buddy/.current_session_id 2>/dev/null)}"
test -n "$CODEX_SESSION_ID" && test -n "$sid" && test "$sid" != "$CODEX_SESSION_ID"
```

Exit 0 reproduces the mismatched session selection. `git rev-parse HEAD` in the plugin source audit returned `b98ed312e3bfac779aa5202b89a90f6705580fe3`.

## Root cause

`codescout-companion/skills/reconnaissance/SKILL.md:55` recommends touching `.buddy/$SID/recon-active`. Its expression at line 58 checks `CLAUDE_CODE_SESSION_ID` and then a shared last-writer file. It never reads the native Codex ID exposed by `run_command`.

## Evidence

The initial session compared the candidate and native identities without printing them. After a Codex restart, the active skill still contained the same expression and the active plugin's skill files matched the local source. The marker was never written and the effect in a Codex statusline was not exercised. See [[codescout/2026-11-26-reconnaissance-chooses-a-foreign-statusline-session-in-codex]].

## Fix

Pending.

## Tests added

None for this filing. A regression case should isolate the fallback file and give Claude Code and Codex different session identities.

## Resume

Identify whether Codex consumes that marker. If it does, use the current Codex identity; otherwise omit the marker step in Codex.
