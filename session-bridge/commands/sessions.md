---
description: List live Claude Code sessions, loaded Codex threads and live OpenCode sessions through session-bridge.
---

Call `session-bridge.list_sessions`. Present every session row in a compact table with `key`, `harness`, `status`, `name`, and `repo`; preserve `(you)`. Claude keys retain `<short profile>:<pid>`. Canonical Codex keys are `codex:<absolute CODEX_HOME>:<thread UUID>` and distinguish threads sharing a process. Canonical OpenCode keys are `opencode:<OpenCode data dir>:<ses_id>`; a `ses_` id, a prefix of at least four characters or a title also works when unambiguous. Preserve discovery-scope and caller-identity notes separately from the rows.

Use `ask_session` for an isolated read-only answer. Use `send_message` when an original Codex thread or live OpenCode session should receive a direct message and potentially run tools. A Claude Code target instead gets a stored message (at most 4000 characters) shown once at its next prompt or tool call; it expires after 24 h or when that session ends, and its status (`pending`, `delivered`, `expired`) appears below the list. Preserve the queued/observed/unknown result instead of treating every accepted queue as delivery.
