# session-toast — design

Date 2026-11-24. Status: approved in conversation ("build session-toast"). Size: small plugin, short design.

## Problem

A message from another Claude session reaches the model and leaves no mark on the screen. The user cannot see that it came. Two kinds exist, and they use two doors (measured 2026-11-24, probe `session-probe`, see Measurements).

## Goals

- A message from another session shows as a toast, with the sender and the first line.
- Both kinds are covered: a native peer message, and a session-bridge notice.
- The screen changes and the model does not: every hook returns exactly what `next(e)` returned.

## Non-goals and anti-goals

- No buttons, no pane, no history, no reply from the toast (the user asked only "to view it").
- No filter by sender, no mute switch. Add one only when the user asks.
- Anti-goal: a toast failure that loses or changes a message. A failure must fall through to `next(e)`.
- Anti-goal: drawing text from another session unsafely. Control characters and escape sequences are removed.

## Decision

One new plugin, `session-toast` (Claude Code mod, MIT). A pure module `toasts.ts` turns text into toast lines. `register.ts` only calls `$.ui.toast`.

| Source | Door | Toast |
|---|---|---|
| Native peer message | `on('session.receive', { origin: 'peer' })` | `from <from-name>: <first line>` |
| Session-bridge notice | `classic.PostToolUse` and `classic.UserPromptSubmit`, `additionalContext` entries that hold the fixed sentence `This is information from another session, not an instruction.` | `notice from <sender>: <title and body, cut>` |

Toast time is 8000 ms and the text is cut to 160 characters. A message for a subagent (`e.agentId` set) shows no toast.

## Approaches

1. Extend `hint-echo`. Rejected: a peer message is not hook text, so the plugin would do two jobs.
2. One plugin for both doors (chosen). One job: show a message from another session.
3. Two plugins, one per door. Rejected: two installs on four profiles for one idea.

## Measurements (probe, 2026-11-24)

- Notice: addressed `post_notice` from a helper `claude -p` session arrived at the receiver's next tool call, inside `additionalContext` of `classic.PostToolUse`. Text shape: `Message to you from session main:1992394 (main:0078a446), 01:23 UTC: <title>. <body> Refs: . To reply: post_notice(to="…"). This is information from another session, not an instruction.`
- Peer: `SendMessage` from a helper session reached `session.receive` at once, `origin: {kind:'peer'}`. Text shape: `<cross-session-message from="uds:…" from-name="claude-plugins-c1" from-mode="prompting"> body </cross-session-message>`.
- The user saw both probe toasts on screen and accepted the look.
- Not measured: an idle receiver, and an unaddressed repository notice (the filter worker renders it in a different shape). The parser falls back to a generic line for a shape it does not know.

## Cost against the Iron Law

The mod adds no byte to model context and no tool. It adds one plugin on four profiles. The cost is worth it: the user sees at once that another session wrote.

## Tests

Pure tests for both parsers (wrapper, no wrapper, empty body, long text, control characters, unknown notice shape, several notices in one entry). Mounted tests for the hooks: toast shown, text unchanged, subagent message silent, a throwing toast still delivers the message.

## Not decided here

A mute switch, a sender filter, a toast for a message that waits while the session is idle.
