# session-toast

A Claude Code mod that shows a toast for each message from another Claude session.

A message from another session reaches the model and leaves no mark on the screen. This mod adds the mark: a small box at the top right of the transcript, for about 8 seconds, with the sender and the first line. The screen changes and the model does not: every hook returns what `next(e)` returned.

Design, measurements and open points: `docs/superpowers/specs/2026-11-24-session-toast-design.md`.

## What a toast shows

| Message | Toast |
|---|---|
| A native peer message (`SendMessage` from another session) | `from <sender name>: <first line>` |
| A session-bridge notice (`post_notice` to this session) | `notice from <sender id>: <title and body>` |

A line is cut at 160 characters. Escape sequences and control characters in the text are removed before it is drawn.

## Needs

- A Claude Code build with hooks modules (`hooks/hooks.json` with `modules`). Measured on 2.1.331.
- For notices: the `session-bridge` plugin.

## Try it

```bash
claude --plugin-dir session-toast
```

Then send a message from another session, for example with `SendMessage`, or run `post_notice` with `to=<this session>`. Check the mod with `claude plugin validate session-toast` and `claude plugin test session-toast`.

## Limits

- A notice appears when the session-bridge hook delivers it: at the next prompt or tool call. An idle session shows no toast for it until then. A peer message shows at once.
- A message for a subagent shows no toast.
- A notice in a shape the parser does not know shows as `notice: <text>`.
- Only a peer message (`origin.kind: 'peer'`) is handled. A coordinator hand-off or a relay event is not.
