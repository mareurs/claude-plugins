---
description: List active Claude Code sessions registered by session-bridge.
---

Call the `session-bridge.list_sessions` MCP tool and present the result as a compact table with columns: `instance`, `alias`, `session_id` (first 8 chars), `cwd`, `branch`, `age`.

If the tool returns an empty array, say so plainly: no other sessions are currently registered.
