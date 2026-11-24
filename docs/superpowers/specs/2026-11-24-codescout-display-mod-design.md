# codescout-display: draw codescout tool calls as cards in verbose mode

## Problem

In verbose mode (`--verbose`, or ctrl+o) Claude Code draws every codescout call with its generic MCP row: the call arguments, then the raw result text. The person sees no diff for an edit, no syntax colors for code, no rendered markdown, and a result of 500 lines buries the transcript. A hook that injects a note adds a second text block to the same result.

Anthropic declined the built-in fix. Five issues ask for collapsed or summarized MCP output ([#42780](https://github.com/anthropics/claude-code/issues/42780), [#12728](https://github.com/anthropics/claude-code/issues/12728) closed as not planned, [#35932](https://github.com/anthropics/claude-code/issues/35932), [#26968](https://github.com/anthropics/claude-code/issues/26968), [#14684](https://github.com/anthropics/claude-code/issues/14684)). The Claude Code mod API can do it: a `ui.render` hook on `ToolUse` may draw its own element in place of the engine row.

The request, in the person's words: "there is no proper diff, no highlighting, pretty markdown, code syntax colors, etc. as well sometimes is too much. I don't wanna see 500 lines of text but a summary." They want it slick and futuristic, and connected to `codescout-redirect`.

## Goals, non-goals, anti-goals

Goals:

- A codescout call in the terminal is one compact card: a header, then a view fitted to the tool.
- An edit shows a colored diff. Code shows syntax colors. A markdown result renders as markdown.
- A long result shows a head and a count of hidden lines. A control on the card opens the full text.
- The screen changes and the model does not. The model reads the same result bytes as before.
- Any error in the mod shows the engine's own row.

Non-goals:

- No change to what codescout returns, or to what the model reads.
- No other surface than `terminal` in 0.1.0. Desktop and VS Code rows pass through.
- No card for a native tool row (`Read`, `Edit`). That belongs to the link with `codescout-redirect` (see Not decided).
- No renderer for every codescout tool. A generic card covers the rest.

Anti-goals (the mod fails even if it works):

- A card that hides what the person needs: an error is never folded, and a hook note is never dropped without a trace.
- A summary that is wrong. A hidden-lines count that disagrees with the text is worse than the raw row.
- A render that is slow. `ui.render` runs on every redraw.

## Decision

Ship one mod, `codescout-display`, as its own plugin. A card **replaces** the engine row. There is no second treatment.

```
codescout-display/
  .claude-plugin/plugin.json
  hooks/hooks.json          { "modules": ["./register.tsx"] }
  hooks/register.tsx        one ui.render hook on ToolUse, with a .catch that calls next(e)
  hooks/cards.ts            pure functions: parse a result, build card data. No `$`, no JSX.
  tests/*.test.ts           claude plugin test, plus direct tests of cards.ts
  README.md
```

Rules for the hook:

- **Act only when all hold:** `e.surface === 'terminal'`; `e.props.isExpanded === true`; `tool` starts with `mcp__codescout__`; `isRunning` is false; `isErrored` is false; `isInterrupted` is not true; `output` is defined. Otherwise return `next(e)`: a running row, an errored row and any other tool keep the engine's own drawing, and an error keeps its full text. *(Builder-check call.)* The `isExpanded` test keeps the card out of the compact view, whose one-line row is already short; the API says a hook that draws a compact row of its own "passes when true". All four profiles on this machine set `"verbose": true`, so here every row is expanded and the card always applies.
- **Draw from `ToolUse` only.** `ToolResult` is not raised for an MCP row.
- **Never change what the model reads.** The hook returns a tree. It does not rewrite `input` or `output`.
- **An error codescout reports as a result keeps the engine row.** codescout answers a recoverable error as a success result with the body `{"ok": false, "error": …, "hint": …}`, so `isErrored` is false. `buildCard` returns `undefined` for it, and so for a blank reply with no notes and no command.
- **Fail open.** A thrown error, an unreadable result or an unknown shape calls `next(e)`.
- **Strip control characters** other than tab and newline from every string handed to `Text` or `Code`, or the engine refuses the tree.
- **Keep the work small.** Slice the head before drawing. `buildCard` also builds `full` on every render: measured 0.08 ms for a 100,000-character reply (the reviewer's probe), so it is not deferred to the open.

A result is `[{ type: "text", text }, ...]`. Block 0 is codescout's reply. Later blocks are notes: a note a hook added, or a block codescout appends itself (a path banner, a build notice, a guide). A card cannot tell them apart.

| Part | Rule |
|---|---|
| Header | `◆ <tool>  <main argument>`. The main argument is `path`, `pattern`, `name` or `command`, whichever the input has. No status mark in 0.1.0. |
| Plain text reply (`tree`, `read_file`, `grep`, `symbols`) | Head of the text. |
| JSON reply (`edit_file`, `run_command`, most others) | One line of the top-level scalar fields, for example `status: ok · replaced: 1`. Nested values are not drawn. |
| Long result | The first 12 lines, then `… N more lines hidden`. The constant lives in one place. |
| Notes (blocks after 0) | One dim line each, `↳ <first non-empty line>`, cut at the edge. They open whole. The `Buffer: … [N of M lines shown] … Next: …` footer of a cut `read_file` reply is split off the code and shown as a note. |
| `read_file` | The head in a `Code` element with a line gutter; a `.md` path uses `Markdown`. Details below. |
| `edit_file` | A `Code` element with `format: "diff"`, built from `input.old_string` and `input.new_string`, only when the edit applied. Details below. |
| `create_file` | A `Code` element with the head of `input.content`, when the reply says `status: ok`. |
| `run_command` | A full-width card (`width: "100%"`). The command shows in a `Code` element with `language: "bash"`, up to 5 lines (`COMMAND_LINES`), then `… N more command lines`; the open control shows the whole command. The reply is drawn as for any other tool. *(Added at the person's request, 2026-11-24.)* |
| Any other codescout tool | The generic card above. |

Details, all *builder-check calls*:

- **`read_file` reply.** Codescout writes `N lines`, a blank line, then the content. The card strips both lines (`codescout-redirect` strips the same header, measured). The gutter starts at `input.start_line`, else `input.offset`, else 1. The hidden count counts the text the model got, not the file on disk. A reply whose first line is `N lines  @file_…` is an outline of a large file and not file content; it takes the generic card with no gutter.
- **`edit_file` success.** The reply is the bare string `"ok"` or an object with `status: "ok"` (codescout source, `edit_file/mod.rs`). Any other reply, a missing `old_string` or `new_string` (insert, markdown and heading modes), or a reply that is not JSON takes the generic card. The diff never shows an edit that did not apply.
- **Language.** It comes from one path: `input.path` of `read_file`, `create_file` and `edit_file`. `grep` and `tree` have no single path and draw plain text. A `symbols` body takes its language from the file line of its group (see the `symbols` card). A path with no known language draws plain.
- **JSON reply.** A reply is JSON when block 0 parses to an object. The summary lists at most 6 top-level scalar fields, each value stripped of control characters and cut at 40 characters or at its first newline. An array, a scalar or a parse failure is plain text. When the line left anything out (a nested value, a seventh field, a cut value) the card is openable and the open control shows the whole reply.

The control that opens the full text is a `Button` with a stored flag keyed by `tool_use_id`. **Not measured.** The builder verifies it first, as a gate. If a press does not work inside a `ToolUse` row, the card **folds anyway** (the person's decision, 2026-11-24): it shows the head and the hidden count, an error is never folded, and each hook note is drawn as one dim line (cut with `wrap: 'truncate-end'`) instead of `+N notes`. The full text then stays only in the model's context and the session log, and the README says so.

## Approaches

1. **A separate plugin, `codescout-display`. Chosen.** Each mod installs and fails alone. The cost is one more plugin in the release scripts and the four-profile parity checks.
2. **One module in `codescout-redirect` that calls both.** One install, but a plugin named "redirect" would draw cards, and a drawing bug could break the redirect. A plugin holds one module path (Mods reference), so the two would share one `register` file.
3. **Merge into a new `codescout-mods`.** One install and an honest name, but it renames a plugin whose spec, tests and sync script are new.

Treatments, all three measured to work: **replace** the row with a card, **rewrite** `output` to a summary, **add** a diff under the engine row. Replace is the only one that can draw a `Code` element with a header of its own, and one method serves every tool. The other two are not shipped.

Not chosen: an external transcript viewer ([claude-code-trace](https://github.com/delexw/claude-code-trace) and others). It reads the JSONL after the fact and draws nothing in the session.

## Prior art

The `code-colors` mod ([issue #48636](https://github.com/anthropics/claude-code/issues/48636), Claude Code 2.1.287) draws a colored diff under the `ToolUse` row of `Edit` and `Write`. It hand-tokenizes code because that build had no `Code` element. It passes the engine an `output` with an empty `structuredPatch`. This build (2.1.331) has `Code` with a highlighter, a gutter and `format: "diff"`, so `codescout-display` needs no tokenizer. No mod for MCP tool rows turned up in search; that does not prove none exists.

## API surface used

The Mods reference page is a summary. The authority is the types file the engine writes for the build: `<mod folder>/.claude-plugin/types/claude-code/index.d.ts` once the mod has loaded, and before that the file next to the `plugin-authoring` skill. Run `claude plugin validate <mod folder>` to check a tree and `claude plugin test` for the tests. Read from that file for 2.1.331:

- `ToolUse` props: `tool_use_id`, `tool`, `input`, `isRunning`, `isErrored`, `isInterrupted`, `isExpanded`, `output`, `onScreen`.
- `Code` props: `source`, `language`, `path`, `startLine` (a gutter when present), `format: 'source' | 'diff'` (a diff reads unified hunks), `wrap`.
- `$.ui.resolve(e)` returns the elements for the surface: `Box`, `Text`, `Button`, `Code`, `Markdown` on `terminal`.
- A function that receives `$` must be a top-level function declaration of the module, or `claude plugin validate` refuses the module. Helpers that take no `$` may live in other files of the plugin.
- Not read: the props of `Button` and `Markdown`, and the stored-state call. The builder reads them for the open control.

The probe's source is not in this repository. Its measurements are in the codescout memory `research/codescout-display-probe-20261124`.

## Cost against the Iron Law

This is a human-facing surface. The model's context does not change, so the six agent rules (simplicity, natural, known patterns, token economy, few turns, lenient) lose nothing and gain nothing for the agent. The costs are in the repository:

- **Simplicity:** one more plugin and one more language (TypeScript, loaded only by Claude Code, and only after the person turns mods on). One treatment for every tool keeps the mod itself to one method.
- **Release:** `.claude-plugin/marketplace.json` and the `README.md` plugin table list the plugin, as they list `codescout-redirect` and `hint-echo`. `release.sh`, `check-versions.sh` and `lib-profiles.sh` name neither of those two (grep, 2026-11-24), so they take a plugin by argument. The plan includes the two list entries. Running `release.sh codescout-display` stays a final, separate step; whether it handles a mod plugin is checked there, not assumed.

## Other harnesses

Claude Code, terminal surface only. The mod adds nothing to a file that another harness reads, and nothing to `codescout-companion`. Codex, Copilot, OpenCode and Pi are untouched. The mod needs the MCP server registered as `codescout`. Under another name the prefix test fails and every row stays the engine's row.

## Link to codescout-redirect

The two plugins are independent. They share the `mcp__codescout__` prefix and nothing else. The link the person asked for is a mark on a redirected call, for example `↪ via codescout`. How a redirected call reaches `ToolUse` is **not measured** (see Not decided).

## Change scenarios absorbed

- A new codescout tool: it gets the generic card. No change.
- A codescout reply format change: the generic card shows head lines of the text, and a parse failure falls back to them.
- Claude Code changes the `ToolUse` props: the hook fails open to the engine row.
- Anthropic ships a native MCP collapse: delete the plugin.

## Tests

`cards.ts` is pure and tested directly: head and hidden count at 0, 12, 13 and 5,000 lines; JSON summary and the plain-text fallback; control-character stripping; diff text from two strings, one line and many; the main-argument choice. The hook is tested with `claude plugin test` and a fake `$`: each pass-through case (non-terminal, non-codescout, running, errored, no output) returns `next(e)`, and a thrown error does too.

## Results (2026-11-24)

Instrument: the dev mod `codescout-display-probe`, hot-reloaded in a live session on Claude Code 2.1.331, terminal surface. It lives in the session's dev-mods folder, not in this repository. n = 1 per row, one machine.

| Fact | Result |
|---|---|
| Tool name at `ui.render` | `mcp__codescout__<tool>`, for example `mcp__codescout__tree`. |
| `ToolResult` for an MCP row | 0 records for every codescout call in the session. It fired for the native `Write` calls that the guard blocked. |
| Renders per call | Several. First `input: {}` and no output, later the full input, then `isRunning: true`, then the final render with the output. Seen for `edit_file`; `run_command`, `tree` and `read_file` showed the same staging. |
| Output shape | `array(1)[{ type, text }]` for the results measured. |
| Hook notes | A `create_file` result held a second text block with the operator-rule note: `array(2)`. One run. |
| `isExpanded` | True on every logged render. All four profiles set `"verbose": true` in `settings.json` (grep, 2026-11-24), so this is expected. No compact render was seen. |
| Replace the row | A `tree` card (round cyan border, 8 lines, `… N more hidden`) drew in place of the engine row. |
| Rewrite `output` | A `read_file` result drew as a one-line summary in place of 40 lines. |
| Add under the row | An `edit_file` colored diff drew under the engine row, with syntax colors. |
| Test kit (plan Task 1) | `$.ui.mount({ plugin, surface, component: 'ToolUse', props })` mounts the hook. `ui.keepsBeneath()` is true when the hook kept the engine node and false when it replaced the row. A `*.test.ts` may import `../hooks/cards`. |
| Open control, hook level (plan Task 1) | A `Button` with an `atom` (`read`, `update`, one array of opened `tool_use_id`s) flips on `ui.press({ key })` in a mounted `ToolUse`. State needs `types/index.d.ts` that exports only types, named in `plugin.json`. A live press worked: see the next row. |
| Live check of the built mod (plan Tasks 4 and 5, 2026-11-24) | Loaded from the repository folder through a symlink in the session's dev-mods folder. The person reported, for one run each: a `tree` card with 12 lines, a hidden count and an open button; a `read_file` card with a gutter and syntax colors; a `read_file` of a `.md` file drawn as markdown; an `edit_file` card with a red and green diff; and the open and fold button, which showed the whole list and folded it back. Reported by the person, not instrumented. |

The `Replace the row`, `Rewrite output` and `Add under the row` rows above come from the person's report of their screen ("1. yes. 2. yes 3 yes"), not from an automated check. The log proves only that the hooks received complete input and output.

What this does not show: `Button` and stored state in a `ToolUse` row; the `Markdown` element; a replaced row that carries a `Code` element with a gutter; the desktop and VS Code surfaces; a compact (not expanded) view; a result with an image; a result over 100,000 characters; parallel calls; a narrow terminal; the language inferred for a `.mjs` path.

## `symbols` card (added 2026-11-24)

The person asked that `symbols` use code highlighting where it can, because a symbol is code even when the outline of it is an AST.

- **Bodies** (`include_body=true`): each body is one `Code` element. The language comes from the file line that heads its group (`path (N)`), else from `input.path`. A body gets **no line gutter**. The range in the reply counts from the declaration, but the body starts at its doc comment, so a gutter from the range would be off (measured: `fileBody` is `134-153`, its body opens with two comment lines). The label above the body carries the range.
- **Outline** (no bodies): a colored list, not source. The kind is dim, the name is in the accent color and the range is dim. An outline has no text of the declaration, so drawing `function name` through the highlighter would invent code, and the keyword is wrong in some languages.
- **Large reply**: codescout answers a long outline as JSON (`output_id`, `summary`, `hint`). The card draws `summary` as the reply and the `hint` as a note. Before this, the card showed one line cut at 40 characters.
- **Fold**: the head is the first 12 lines counted over labels and bodies together. The open control draws every block.
- **Fallback**: a reply that does not parse (no file line, no symbol line) keeps the generic card.
- **Costs against the six rules**: one more body kind in `Card` and one parser. It is a human-facing surface, so the model reads the same bytes. The parser reads the reply format of `symbols` (measured 2026-11-24 on codescout 0.15.0); a format change makes the card fall back to plain text, never to a wrong card.

## Token estimate (added 2026-11-24)

The person asked for the number of input and output tokens of each card, in the last row, on the right.

- **Row:** `in ~N · out ~M`, dim, in a `Box` with `justifyContent: flex-end`, after the open control. A finished card only: the pending frame has the input but not the output, and the engine's own row is left alone.
- **in** is the size of `JSON.stringify(input)`. **out** is the size of block 0 and of every note block, which is what the model reads; the folded head does not change it.
- **Estimate:** 4 characters to a token, shown with `~`. A `ToolUse` hook gets no usage figures and no tokenizer (the props are listed above), so an exact count is not reachable here. A tokenizer would add a dependency and a version to keep in step with the model's.
- **Cost against the six rules:** none for the model. One more row on a human-facing surface, and a figure that can be wrong by a margin that the `~` admits.

## Token colors (added 2026-11-24)

The token row is two figures, `in` and `out`, each green, orange or red by its own size. Both stay in the context for the rest of the session, but a call is about five times smaller than a reply, so the sides have separate limits. A `ToolUse` hook gets no context-window figure, so the card's own size is the only size it can show.

- **Limits, one pair for each side** (the call and the reply have different scales: input p50 54, p90 319, p99 2177; reply p50 285, p90 1682, p99 2509): the `in` figure is orange from `IN_MID = 100` and red from `IN_HIGH = 500`; the `out` figure is orange from `OUT_MID = 750` and red from `OUT_HIGH = 2000`. Each figure has its own color. Theme keys `success`, `warning`, `error`. A first version used the sum of both sides with one pair of limits; the person pointed out that the sides differ, and the sum hid a large call behind a small reply.
- **Measured** 2026-11-22 09:17 to 2026-11-24 09:17 UTC by a subagent over the transcripts of three profiles (the fourth had none): 37,043 results after dropping 6,877 duplicates and the `api-request-blob` lines, which repeat content. The orchestrator recomputed the totals from the dataset and got the same numbers.
- **Distribution (reply tokens):** p50 285, p75 794, p90 1686, p95 2304, p99 2509, max 14,080. Codescout is 91% of the results, and its replies stop near 2.5k tokens (its own output budget): 8% of its results sit between 2000 and 2550.
- **Why these numbers:** each side is set so that about 73% of results are green, about a fifth orange and about 7% red. Input: 72.7% / 20.7% / 6.6%. Reply: 73.6% / 18.7% / 7.7%. The reply's red at 2000 is the start of the pile-up at codescout's output budget, so red means "this reply is at its tool's cap" or, for a native `Read`, a large file; at 2500 red would almost never show (2.2%). A large input comes from writes: `create_file` p90 3851, `edit_code` p90 1162, `Agent` prompts p50 1282. The main agent alone is lighter than the sub-agents (reply p90 1141 against 1682 overall).
- **Largest sources:** codescout `read_file` 40% of all reply tokens, `run_command` 30%, `grep` 13%, `symbols` 7%. A native `Read` is rare but the heaviest (p99 10,461).
- **Limits of the measure:** two days, one person's work (mostly this repository), 61% of the results from sub-agents, and an estimate of 4 characters to a token. Re-measure with `scripts/measure-tool-result-sizes.py` before a change; the script prints the share of each color on each side at the limits in `cards.ts`.

## Not decided here

- **The open control.** The builder verifies `Button` plus state in a `ToolUse` row first, as the first task and a gate. Decided 2026-11-24: if it cannot work, the card folds anyway (see Decision). The plan treats the control as the main path.
- **The mark for a redirected call.** `codescout-redirect` answers a native `Read` with a result and a `[codescout-redirect]` note. How that note appears in the native row's `output` is not measured. It needs a probe before any design.
- **A diff for `edit_code`.** Its input holds the new body. The old body needs a `tool.call` hook that reads the symbol before the call. A separate design.
- **More renderers:** `grep` grouped by file, `run_command` with its exit code, a `memory` or `doc` card.
- **The head size** (12 lines) and the colors. Prefer theme keys to raw colors, so the card follows the person's theme.

## Latency and the early frame (2026-11-24)

The user saw two things: a lag between the engine's row and the card, and borders and text that redraw too much. An instrumented copy of the mod logged every `ui.render` call (47 card draws and 34 pass-through calls in one session).

| Measured | Result |
|---|---|
| `buildCard` | mean 0.11 ms, max 0.67 ms (a 200,000-character reply: 0.49 ms, Node benchmark) |
| A card draw, whole hook | mean 3.2 ms, p50 1.7 ms, p95 6.6 ms, max 41.8 ms |
| The atom `read` inside it | mean 2.9 ms: 91% of a card draw |
| The engine's own row through `next(e)` | mean 2.6 ms |
| Calls per tool call | the engine calls the hook 6 to 12 times; every visible row again on each update (20 rows: 62 ms in one pass) |

- **Cause of the swap.** The card needed the output, so the engine's row showed while the tool ran, and the card replaced it at the end: a change of frame, not slow code.
- **Fix, option 1.** `pendingCard(tool, input)` gives the frame from the input alone. The hook draws it for a codescout call with no output yet, with no state read. A running call adds `running…`. An error or an interrupted call keeps the engine's row.
- **Not measured.** The terminal's paint time, and whether an identical tree repaints. The atom `read` is still the largest cost of a draw and grows with the number of cards in the transcript. Option 2 (an engine-side hover reveal in place of the button) is not built.

## Verbs, parameters and written text in the header (2026-11-24)

The user asked to see which operation and which parameters a call has: memories, the verbs of `doc`, `librarian`, `workspace`. `mainArg` knew only `path`, `pattern`, `name` and `command`, so `memory(action=…, topic=…)` drew as `◆ memory`. The schemas of eleven codescout tools were read (`memory`, `doc`, `librarian`, `library`, `index`, `workspace`, `references`, `call_graph`, `symbol_at`, `semantic_search`, `get_guide`).

- **Decision (the user).** A write also draws the text it wrote: the body of `memory` write/add/now/close and `doc` create/append_entry/update as markdown, with the fold and the open button of the other cards.
- **Measured.** The reply of a `memory` write is `{"status":"ok","wrote_to":"<project root>"}`: a status and nothing the user wrote. So the body comes from the input, and the result is one dim line without `wrote_to`.
- **Header.** Title `◆ <tool> · <verb>  <subject>`; one dim line of up to 4 other parameters (`key=value`, each cut at 40, then `+N more`); the title in the `warning` theme key when the verb changes something. The pending frame has the same header, because the input is known before the output.
- **Not done.** The `librarian` and `workspace` verbs have no body of their own: their replies draw as before. No per-tool table of subjects; one ordered key list serves all tools.
