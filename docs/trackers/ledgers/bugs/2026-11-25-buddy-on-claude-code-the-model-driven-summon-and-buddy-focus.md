---
kind: entry
status: fixed
title: 'buddy: on Claude Code the model-driven summon and /buddy:focus resolve the session by last-writer, because session_id_from_env reads only OPENCODE_SESSION_ID'
closed: 2026-11-25
created: 2026-11-25
entry_kind: bug
log:
- '2026-11-25 open created codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-25 edited:severity codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-25 edited:unverified codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
- '2026-11-25 open -> fixed codescout:9b880af2-23db-4b95-9e16-ebb0c6f8d466'
severity: medium
status_since: 2026-11-25
---

**Summary:** Under Claude Code, two buddy paths find the session id through the `.buddy/.current_session_id` pointer (whichever session prompted last) or a sole-directory guess, not through the host's own id. With several Claude Code sessions in one project, which this machine runs, a persona or a focus can be written into another session's state.

**Symptom:** Not observed as a wrong write. Found by reading the code while verifying `portable-workflows-session-log` F-2 and F-6 on 2026-11-25. `unverified` is set because no run with two live sessions was made.

**Reproduction:** Not run. To run it: two Claude Code sessions in the same project, `/buddy:focus <path>` in the older one after the newer one prompted, then read `.buddy/<sid>/` for each. `git rev-parse HEAD` at the time of reading: aa1507f.

**Root cause:** `buddy/scripts/state.py:211` sets `SESSION_ID_ENV = "OPENCODE_SESSION_ID"`, and `session_id_from_env` (`state.py:214`) reads only that variable. On Claude Code it returns None. Then `track_specialist._resolve_sid` (`track_specialist.py:39`) takes the `.current_session_id` pointer, and `resolve_session_id_for_command` (`state.py:229`) takes `by-ppid`, then the pointer, then the sole session directory. `buddy/commands/focus.md:5-8` first tells the model to read "the stdin JSON Claude Code delivers to this command", which a command never receives, then falls back to that resolver, and says the resolver "reads the host's session id first", which is true for OpenCode only. `$CLAUDE_CODE_SESSION_ID` reaches the shell on Claude Code: the `reconnaissance` skill reads it first and the 2026-10-13 measurement in `portable-workflows-session-log` F-2 matched the session.

**Evidence:** `grep -rn CLAUDE_CODE_SESSION_ID buddy/scripts/*.py` finds nothing. The origin entries are `portable-workflows-session-log:F-2` and `portable-workflows-session-log:F-6`, both dated 2026-10-13.

**Fix:** `resolve_session_id_for_command` (`buddy/scripts/state.py`) now looks up `by-ppid/<pid>` for the direct parent and then for each ancestor, nearest first, with the start-time check per pid, a depth cap of 16 and a cycle guard (`_parent_pid` reads the parent through `ps`, like `pid_started_at`). The host writes that entry at every SessionStart, so it names the session that runs the command. `track_specialist._resolve_sid` asks the resolver after the host env id, instead of reading the pointer first. `buddy/commands/focus.md` Step 1 no longer tells the model to read stdin JSON. The env-var idea of the first draft was dropped: an MCP server subprocess keeps the id it was spawned with, so `$CLAUDE_CODE_SESSION_ID` can be stale after a `/clear`, while the by-ppid entry is rewritten for the same host pid.

**Tests added:** `buddy/tests/test_state.py` (`test_resolve_walks_up_to_an_ancestor_with_a_by_ppid_entry`, `test_resolve_prefers_the_nearest_ancestor`, `test_resolve_rejects_an_ancestor_whose_pid_was_reused`, `test_resolve_ends_on_a_cyclic_process_chain`) and `buddy/tests/test_track_specialist.py` (`test_resolve_sid_takes_the_host_ancestor_over_the_last_writer_pointer`). Each failed first. The buddy suite passes, 584 tests. Control on the real machine with the live process chain, a copy of the live by-ppid index and a pointer naming the peer session: the resolver returned this session, not the peer.

**Resume:** Fixed; ships with the next buddy release. Nothing left to do.

## Fix provenance

- **SHA:** 03e4cc79d77bb36d1abf5aba3621f6ccbdfdca9a (main)
- **patch-id:** 39c4ab1f0a79a7dc1f8ab657e7736020f721b2de

## Closed

Fixed in 03e4cc7: the resolver walks the process ancestry to the host's by-ppid entry before it reads the last-writer pointer, and track_specialist and focus.md use it. Five new tests failed first; the buddy suite passes (584).
