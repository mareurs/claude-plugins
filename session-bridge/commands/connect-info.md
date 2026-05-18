---
description: Show the currently-connected bridge target and the full list of registered sessions.
---

Display two blocks:

1. **Active bridge target** (set via `/connect-to`):
   - If set: show `session_id`, `alias`, `cwd`, `instance`, `branch`, `age_seconds`.
   - If unset: say "no active connection — use `/connect-to <ref>` to set one".

2. **All registered sessions** (from `session-bridge.list_sessions`):
   - Render as a compact table with columns: `instance`, `alias`, `id8` (first 8 chars of session_id), `cwd`, `branch`, `age`.
   - Mark the active target row with `→` in the first column.
   - If the list is empty, say so plainly.

Do not call `ask_session`. This is a read-only status command.
