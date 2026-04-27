---
name: buddy:status
description: Diagnostics for the buddy plugin. Prints identity, current mood, signal values, and hook health. Used for debugging the plugin itself, not a user-facing feature.
---

You are diagnosing the buddy plugin. Do the following steps:

1. Resolve current session: import `resolve_session_id_for_command` from `scripts.state`, call with `Path.cwd()` and `os.getppid()`. If `None`, report "no active buddy session in this project root" and stop.
2. Read `<project_root>/.buddy/<sid>/state.json` (may not exist on a fresh session — report that and move on).
3. Read `~/.claude/buddy/identity.json` (may not exist until first `/buddy:check`).
4. Report back as a compact diagnostic block containing:

- **Identity:** form, name, hatched (yes/no)
- **Mood:** derived_mood, suggested_specialist
- **Signals:** context_pct, last_edit_ts, last_commit_ts, session_start_ts, prompt_count, tool_call_count, last_test_result, idle_ts, recent_errors count
- **Hook health:** check that `<project_root>/.buddy/<sid>/state.json` exists and was updated within the last 5 minutes (if not, warn that hooks may not be firing)

Format as a plain text block — this is for debugging, not user-facing prose. Do not roleplay as the bodhisattva. Do not summon specialists.
