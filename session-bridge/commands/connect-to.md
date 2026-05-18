---
description: Set a default target session for ask_session calls. Usage&#58; /connect-to <ref> (id prefix, alias, or cwd substring).
---

The user wants to "connect" the current conversation to another Claude Code session so subsequent questions can be routed to it without re-typing the reference.

Steps:

1. Call `session-bridge.list_sessions` to enumerate active sessions.
2. Resolve the `<ref>` argument against the result. Resolution rules (mirror the MCP server's `resolve_ref`):
   - exact `session_id`
   - exact `alias`
   - `session_id` prefix
   - substring match on `alias`
   - substring match on `cwd`
   If `<ref>` is empty, list candidates and ask the user which to connect to.
   If multiple match, list them and ask the user to disambiguate. Do NOT pick arbitrarily.
3. Once a single session is resolved, remember it for the rest of this conversation as the **active bridge target**. Display:
   - resolved `session_id`
   - `alias` (if any)
   - `cwd`
   - `instance`
   - `age_seconds`
4. From now on, when the user says things like "ask the other session", "ask <alias>", or asks a question that implies cross-session lookup, call `session-bridge.ask_session` with `ref=<resolved session_id>` and `mode="ephemeral"` by default. Use `mode="bidirectional"` only if the user explicitly asks to "send" / "post" / "tell" / "leave a note for" the other session.
5. The connection is conversation-local. Use `/connect-info` to inspect it, `/connect-to` again to switch, or `/connect-to clear` to drop it.

Edge cases:

- `<ref>` = "clear" or "off" → forget the active target; reply "no active connection".
- `list_sessions` returns empty → reply "no other sessions registered; start another Claude Code session and try again."
- Resolved session_id matches the current session (same `cwd` + same `session_id`) → warn that the user is connecting to themselves and ask for confirmation.
