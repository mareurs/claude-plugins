# codescout-display

A Claude Code mod that draws each codescout tool call as one compact card in verbose mode.

In verbose mode (`--verbose`, or ctrl+o) Claude Code draws a codescout call with its generic MCP row: the arguments, then the raw result text. This mod replaces that row with a card. The card has a header, a view fitted to the tool, and a fold for a long result. The screen changes and the model does not: the model reads the same result bytes as before.

Design, measurements and open points: `docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md`.

## What a card shows

| Call | Card |
|---|---|
| `read_file` | The first 12 lines in a code view with a line gutter and syntax colors. A `.md` path draws as markdown. |
| `edit_file` | A colored diff built from the call's `old_string` and `new_string`, only when codescout says the edit applied. |
| `create_file` | The first 12 lines of the new content. |
| `run_command` | A full-width card. The command shows in up to 5 lines with shell colors, the rest counted and the whole command on open. The result is drawn as for any other tool. |
| Any other codescout tool | A JSON reply as one line of its scalar fields (`status: ok · replaced: 1`); a plain reply as its first 12 lines. |

A result longer than 12 lines ends with `… N more lines hidden`, and a button, `open (N more lines)`, shows the whole text. A second press folds it. A note that a hook added to the result is one dim line on a closed card, and the whole note on an open one.

An error, a running call and any tool that is not codescout keep Claude Code's own row.

## Needs

- A Claude Code build with hooks modules (`hooks/hooks.json` with `modules`). Measured on 2.1.331.
- The codescout MCP server, connected under the name `codescout` (tools named `mcp__codescout__<tool>`).
- The terminal surface, in verbose mode. Desktop and VS Code rows pass through.

## Try it

```bash
claude --plugin-dir codescout-display
```

Then make a codescout call, for example `tree` or `read_file`. Check it with `claude plugin validate codescout-display` and `claude plugin test codescout-display`.

## Limits

- No diff for `edit_code`: its input holds the new body and not the old one.
- A diff over 40 lines on a side shows its first 40 lines of each side; the button opens the whole diff.
- An opened card draws at most 100,000 characters.
- It does not change what the model reads and it does not mark a call that `codescout-redirect` answered.
