---
description: Show the currently-connected bridge target (from .session-bridge/&lt;sid&gt;/connection.json) and all registered sessions.
---

Read-only status command. Do NOT call `ask_session`.

**Steps:**

1. Determine our session id:
   - `OUR_SID = cat <cwd>/.session-bridge/.current-session-id 2>/dev/null` (may be missing).

2. Load the active connection:
   - `CONN_FILE = <cwd>/.session-bridge/$OUR_SID/connection.json` (only if `OUR_SID` is set and the file exists).

3. Display two blocks:

   **Active connection**
   - If `CONN_FILE` exists: pretty-print `target_session_id` (first 8 chars), `alias`, `target_cwd`, `instance`, `mode_default`, and a human age from `set_at`.
   - If absent: say "no active connection — use `/connect-to <ref>` to set one".

   **Registered sessions** (from `session-bridge.list_sessions`)
   - Compact table, columns: `instance`, `alias`, `id8`, `cwd`, `branch`, `age`.
   - Prefix the row for the active connection target with `→`.
   - If list is empty: "no sessions registered."
