---
description: List live Claude Code sessions and loaded Codex threads through session-bridge.
---

Call `session-bridge.list_sessions`. It lists only the sessions of the caller's repository, linked worktrees included. If its last lines say that sessions in other repositories were not shown, tell the user, and call `list_sessions` with `all=true` only when the user wants them. Present every session row in a compact table with `key`, `harness`, `status`, `name`, and `repo`; preserve `(you)`. Claude keys retain `<short profile>:<pid>`. Canonical Codex keys are `codex:<absolute CODEX_HOME>:<thread UUID>` and distinguish threads sharing a process. Canonical OpenCode keys are `opencode:<OpenCode data dir>:<ses_id>`; a `ses_` id, a prefix of at least four characters or a title also works when unambiguous. Preserve discovery-scope and caller-identity notes separately from the rows.

Use `ask_session` for an isolated read-only answer. Use `post_notice` with `to` to send one message to a live Claude Code or Codex session, in any repository or profile: it shows at the receiver's next prompt or tool call and its result says `queued`. Use `send_message` when an original Codex thread or live OpenCode session should receive a direct message and potentially run tools. Preserve its queued/observed/unknown result instead of treating every accepted queue as delivery.
