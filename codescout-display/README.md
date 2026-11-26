# codescout-display

A Claude Code mod that draws each codescout tool call as one compact card in verbose mode.

In verbose mode (`--verbose`, or ctrl+o) Claude Code draws a codescout call with its generic MCP row: the arguments, then the raw result text. This mod replaces that row with a card. The card has a header, a view fitted to the tool, and a fold for a long result. The screen changes and the model does not: the model reads the same result bytes as before.

The frame draws from the first render of a call: the border, the header (tool and main argument) and, for `run_command`, the command. A running call shows `running…` under the header, and the body fills in when the tool ends, so the row does not swap from the engine's row to a card. An error, an interrupted call and a non-codescout tool keep the engine's row.

Design, measurements and open points: `docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md`.

## What a card shows

| Call | Card |
|---|---|
| `read_file` | The first 12 lines in a code view with a line gutter and syntax colors. A `.md` path draws as markdown. |
| `edit_file` | A colored diff built from the call's `old_string` and `new_string`, only when codescout says the edit applied. |
| `create_file` | The first 12 lines of the new content. |
| `memory` write, add, now, close | The written text as markdown (first 12 lines, folded), and one dim line for the result (`status: ok`). |
| `memory` edit | A colored diff of `old_string` and `new_string`. |
| `doc` create, append_entry, update | The body (for update, `patch.body`) as markdown. |
| `symbols` | With bodies: a label per symbol (kind, name, line range) and its body in a code view with the colors of the file's language and no gutter. Without bodies: a list of labels. A long outline that codescout sends as JSON draws its `summary`, and the `hint` shows as a note. |
| `grep` | The search pattern, matches grouped by file with line numbers and enclosing symbols, and the reported totals and page range. File-count mode puts the paths first. |
| `doc` find | Each result's title, kind, status and path, with the matched line range when available. The summary shows page size and further results in scope when reported. |
| `call_graph` | Direct callers and callees first, or the file summary when the tool returns counts. Open the card for the full reply. |
| `references` | References grouped by file, with line numbers and the reported page range. |
| `semantic_search` | The query, ranked paths and line ranges, and up to two excerpt lines per hit. A score appears when the tool supplies one. The card shows the hit count and marks replies capped by the tool. |
| `codescout box` through `run_command` | The box and verb in the title, including invocations in pipelines and shell command lists. A batch names the box operations and shows their shared output. `list` shows titles, statuses and ranks, `find` shows matches and their excerpts, and `show` leads with the entry title and current section. Opening the root box shows its directory. Other box verbs show their CLI output. Open the card for the original reply when the preview leaves details out. |
| `run_command` | A full-width card. The command shows in up to 5 lines with shell colors, the rest counted and the whole command on open. The result is drawn as for any other tool. |
| Any other codescout tool | A JSON reply as one line of its scalar fields (`status: ok · replaced: 1`); a plain reply as its first 12 lines. |

A result longer than 12 lines ends with `… N more lines hidden`, and a button, `open (N more lines)`, opens the result. A second press folds it. A JSON reply whose line left something out (a long or multi-line value, more than 6 fields, a nested value) gets the same button. Notes are the blocks after the reply: a hook's note, or one that codescout appends itself. A closed card shows each as one dim line, and an open card shows it whole. The `Buffer: …` footer of a `read_file` reply that the output budget cut is a note too.

## The token estimate

The last row of every finished card, on the right, is one line, colored by size (below): `in ~42 · out ~3.4k`.

- **in:** the tokens of the call the model wrote (its arguments).
- **out:** the tokens of everything the model read back: the whole reply, not the folded head, and the notes that hooks added.
- **An estimate:** the mod has no tokenizer, so it counts 4 characters to a token and shows `~`. Under 1000 it shows the number, then `1.2k`, then whole thousands (`125k`). The count can differ from the real one, mostly for text that is not English or code.
- **Color:** each figure has its own color, because a call is about five times smaller than a reply. `in`: green below 100 tokens, orange from 100, red from 500. `out`: green below 750, orange from 750, red from 2000. The limits come from 37,043 measured tool results of the last two days; on each side about 73% of results are green, a fifth orange and 7% red. Red on `out` mostly means the reply is at its tool's own output cap; red on `in` is a large write. Notes and the method: `docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md` § Token colors.
- **Not shown:** on the frame of a call that has not ended, and on the engine's own row (an error, an interrupted call).

## The header

The title says what the call does: `◆ <tool> · <verb>  <subject>`.

- **Verb:** the `action` of the call (`read`, `write`, `find`, `update`, …), or `direction` for `call_graph`.
- **Subject:** the first of `topic`, `box`, `id`, `symbol`, `query`, `path`, `pattern`, `name`, `command` that is set. A `run_command` card shows its command in the body instead.
- **Parameters:** one dim line of `key=value` under the title: up to 4, then `+N more`. Each value is cut at 40 characters; an object shows as compact JSON. `workspace`, empty values, `false`, the text of a write and the command are left out.
- **Warning color:** a verb that changes something (`write`, `add`, `edit`, `drop`, `delete`, `close`, `now`, `create`, `update`, `move`, `append_entry`, `update_entry`, `event_create`, `register`, `build`) draws the title in the warning color.

```
◆ memory · read  architecture
◆ memory · write  scratch                    ← warning color
  private=true
◆ doc · find
  kind=tracker status=open
◆ call_graph · callers  Config/load
  path=src/a.rs max_depth=3
```

The frame draws from the first render of a call, with `running…` under the header, and the body fills in when the tool ends.

These keep Claude Code's own row: an error, including a result that codescout reports as `{"ok": false, …}`; an interrupted call; a blank result; and any tool that is not codescout.

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
- A diff's gutter counts from 1, not from the line of the edit in the file. The edit's real line is not in the result.
- A `run_command` that fails shows its exit code and the start of `stderr` as one line.
- A folded diff shows up to 40 lines from each side.
- Opening a card shows up to 20,000 characters of a result or command.
- It does not change what the model reads and it does not mark a call that `codescout-redirect` answered.
