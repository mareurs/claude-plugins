---
kind: entry
status: open
title: 'buddy: on Claude Code the model-driven summon and /buddy:focus resolve the session by last-writer, because session_id_from_env reads only OPENCODE_SESSION_ID'
created: 2026-11-25
entry_kind: bug
log:
- '2026-11-25 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
status_since: 2026-11-25
---

**Summary:** Under Claude Code, two buddy paths find the session id through the `.buddy/.current_session_id` pointer (whichever session prompted last) or a sole-directory guess, not through the host's own id. With several Claude Code sessions in one project, which this machine runs, a persona or a focus can be written into another session's state.

**Symptom:** Not observed as a wrong write. Found by reading the code while verifying `portable-workflows-session-log` F-2 and F-6 on 2026-11-25. `unverified` is set because no run with two live sessions was made.

**Reproduction:** Not run. To run it: two Claude Code sessions in the same project, `/buddy:focus <path>` in the older one after the newer one prompted, then read `.buddy/<sid>/` for each. `git rev-parse HEAD` at the time of reading: aa1507f.

**Root cause:** `buddy/scripts/state.py:211` sets `SESSION_ID_ENV = "OPENCODE_SESSION_ID"`, and `session_id_from_env` (`state.py:214`) reads only that variable. On Claude Code it returns None. Then `track_specialist._resolve_sid` (`track_specialist.py:39`) takes the `.current_session_id` pointer, and `resolve_session_id_for_command` (`state.py:229`) takes `by-ppid`, then the pointer, then the sole session directory. `buddy/commands/focus.md:5-8` first tells the model to read "the stdin JSON Claude Code delivers to this command", which a command never receives, then falls back to that resolver, and says the resolver "reads the host's session id first", which is true for OpenCode only. `$CLAUDE_CODE_SESSION_ID` reaches the shell on Claude Code: the `reconnaissance` skill reads it first and the 2026-10-13 measurement in `portable-workflows-session-log` F-2 matched the session.

**Evidence:** `grep -rn CLAUDE_CODE_SESSION_ID buddy/scripts/*.py` finds nothing. The origin entries are `portable-workflows-session-log:F-2` and `portable-workflows-session-log:F-6`, both dated 2026-10-13.

**Fix:** Let `session_id_from_env` also read `$CLAUDE_CODE_SESSION_ID`, with the same `.buddy/<sid>/` directory check. Caveat from the F-2 entry: Claude Code updates the variable on `/clear` for shell subprocesses, but an MCP server subprocess keeps the id it started with, so a shell routed through an MCP `run_command` may carry a stale id. Then reword `focus.md` Step 1 to drop the stdin sentence.

**Tests added:** none.

**Resume:** Write a failing test for `session_id_from_env` with `CLAUDE_CODE_SESSION_ID` set and a matching `.buddy/<sid>/` directory, then make it pass; decide the stale-id caveat before the change.
