---
description: List live Claude Code sessions and loaded Codex threads through session-bridge.
---

Call `session-bridge.list_sessions`. Present every session row in a compact table with `key`, `harness`, `status`, `name`, and `repo`; preserve `(you)`. Claude keys retain `<short profile>:<pid>`. Canonical Codex keys are `codex:<absolute CODEX_HOME>:<thread UUID>` and distinguish threads sharing a process. Preserve discovery-scope and caller-identity notes separately from the rows.

Use `ask_session` for an isolated read-only answer. Use `send_message` when an original Codex thread should receive a direct message and potentially run tools. Preserve its queued/observed/unknown result instead of treating every accepted queue as delivery.
