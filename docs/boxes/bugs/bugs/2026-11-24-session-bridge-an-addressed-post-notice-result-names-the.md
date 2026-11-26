---
kind: entry
status: fixed
title: 'session-bridge: an addressed post_notice result names the receiver by pid key, the notice header by session-id prefix, so one session reads as two'
closed: 2026-11-26
created: 2026-11-24
entry_kind: bug
log:
- '2026-11-24 open created codescout:be5c3984-2bd4-45c8-897a-3b17ba6e951e'
- '2026-11-26 open -> fixed codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-26
---

**Summary:** A notice header labels its author `<profile>:<first 8 chars of session id>`. The result of `post_notice(to=...)` labels the receiver `<profile>:<pid>`. Both have the shape `main:<hex-ish>`, so a sender who replies to a notice by name sees a different label and concludes the message went to the wrong session. Every agent that answers a notice is affected.

**Symptom:** On 2026-11-24 a nudge arrived as `Notice from session codescout-74 (main:0bed4486), 09:27 UTC: ...`. The reply `post_notice(to="codescout-74", ...)` returned `Posted notice 228 to main:4068800 (queued: it shows at that session's next prompt or tool call).` The sender reported to the user that the name may have resolved to another session. `list_sessions(all=true)` shows they are one session: `main:4068800 harness=claude session=0bed4486-6e89-40e4-a3bd-d29d9c5c4294 name=codescout-74`. Delivery was correct; only the labels disagree.

**Reproduction:** claude-plugins `b6e02a3a3013caf64599c3d64acf6408bde6d4fa`.
1. Session A posts a broadcast notice; session B receives the nudge and reads `(main:<id8>)`.
2. B calls `post_notice(title, body, to="<A's name>")`.
3. The result reads `Posted notice N to main:<A's pid>`, a label that appears nowhere in the nudge.

**Root cause:** Two renderers use two identifiers. `author_name_and_id` (`session-bridge/mcp-server/src/deliver.rs:76-88`) renders `<short profile>:<cut(session id, 8)>`, falling back to the pid key only when the session is unknown. `addressed_result` (`session-bridge/mcp-server/src/server.rs:152-154`) renders `Posted notice {seq} to {key}` with the endpoint key `<profile>:<pid>`. Measured by reading both functions and by the `list_sessions` row above. `resolve_target` (`session-bridge/mcp-server/src/endpoints.rs:300-302`) accepts both forms, so `to="main:0bed4486"` would also have reached it.

**Evidence:** The three quoted strings above, from the sender's session `be5c3984-2bd4-45c8-897a-3b17ba6e951e` (codescout repository), notice 228.

**Fix:** Not started. One shape: `addressed_result` names the receiver as the nudge does, `<name> (<profile>:<id8>)`, and keeps the pid key only when the session id is unknown. The README and the coordinating-sessions skill describe the result text and would change with it.

**Tests added:** None yet. A regression test pins that the addressed result for a target with a known session id contains the same `<profile>:<id8>` label that `render_nudge` gives that session as an author.

**Resume:** Change `addressed_result` to take the target's name and session id, and add the test beside `addressed_result_warns_when_the_target_never_ran_a_hook` (`session-bridge/mcp-server/tests/store.rs`).

## Closed

Fixed in the source: server.rs receiver_label gives the receiver as `<name> (<short profile>:<first 8 of the session id>)`, the label render_nudge gives that session as an author; tools.rs uses it for the result of an addressed post (a Codex thread, or a session with no id yet, keeps its endpoint key); Session::name() added. Four tests in tests/store.rs pin the shape, the unknown-id and Codex cases and the cleaning of a name; the full cargo suite passes (462 tests), clippy and fmt are clean. README and the coordinating-sessions skill name the new result text. The wiring in tools.rs is covered by the compiler and the label tests, not by an end-to-end addressed-post test. Live after the next session-bridge release (it rebuilds the binary) and a cold restart of each session.
