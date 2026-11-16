---
description: List the live Claude Code sessions on this machine through session-bridge.
---

Call the `session-bridge.list_sessions` MCP tool. It returns one line per live session, sorted by profile and pid, in the form `<key> [(you)] session=<id> name=<name> kind=<kind> status=<status> cwd=<dir> repo=<dir>`. The key is `<short profile>:<pid>`; a field that is unknown shows `-`.

Present the result as a compact table with the columns `key`, `kind`, `status`, `name`, `repo`. Keep the `(you)` mark after the key of the caller's own session. Do not hide any line.

If the tool returns "No live Claude Code sessions found.", say so plainly.
