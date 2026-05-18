---
description: Set a default target session for ask_session calls. Persisted in .session-bridge/&lt;sid&gt;/connection.json. Usage&#58; /connect-to &lt;ref&gt;
---

The user wants to "connect" the current conversation to another Claude Code session so subsequent questions are routed there without re-typing the reference.

**State file (session-scoped, persists across context summary):**

- `<cwd>/.session-bridge/.current-session-id` — written by the SessionStart hook. Tells you which session ID you are running inside. `cat` it to read.
- `<cwd>/.session-bridge/<our-session-id>/connection.json` — the active bridge target for THIS session. Schema:

```json
{
  "target_session_id": "abc-…",
  "target_cwd": "/home/u/work/foo",
  "alias": "foo-session-or-null",
  "instance": "main",
  "set_at": 1779120000,
  "mode_default": "ephemeral"
}
```

**Steps for `/connect-to <ref>`:**

1. Read `<cwd>/.session-bridge/.current-session-id` (call it `OUR_SID`). If missing, fall back to looking up our session in `session-bridge.list_sessions` by matching cwd; if still ambiguous, ask the user. If `.session-bridge/` doesn't exist, create it.

2. Special argument handling:
   - `<ref>` empty → call `list_sessions`, print candidates, ask user which to connect to.
   - `<ref>` is `clear`, `off`, or `none` → delete `<cwd>/.session-bridge/$OUR_SID/connection.json` and reply "no active connection". Stop.

3. Call `session-bridge.list_sessions` and resolve `<ref>` (rules mirror MCP `resolve_ref`):
   - exact `session_id`
   - exact `alias`
   - `session_id` prefix
   - substring on `alias`
   - substring on `cwd`
   Zero matches → tell user, show available; do nothing. Multiple → ask user to disambiguate.

4. Warn if resolved target == `OUR_SID` (connecting to yourself) and require explicit confirmation.

5. Write `<cwd>/.session-bridge/$OUR_SID/connection.json` atomically (write to `.tmp`, `mv`). Fill all fields from the resolved entry; `set_at` = `date +%s`; `mode_default` = "ephemeral".

6. Echo confirmation: `connected → <alias-or-id8> @ <cwd> (instance=<instance>)`.

7. From now on, when the user says "ask the other session", "ask <alias>", or asks something that needs cross-session lookup, call `session-bridge.ask_session` with `ref=<target_session_id from connection.json>` and `mode=mode_default`. Use `mode="bidirectional"` only when the user explicitly says "send", "post", "tell", or "leave a note for".

**Implementation notes:**

- Always use absolute paths for state files. `$PWD` from the assistant's shell context is the right cwd because slash commands run in the session's cwd.
- Use `mkdir -p` and tolerate the dir already existing.
- Never touch `<cwd>/.session-bridge/<other-sid>/` — those belong to other sessions that may run in the same project.
