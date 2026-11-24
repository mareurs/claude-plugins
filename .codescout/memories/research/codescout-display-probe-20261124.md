# codescout-display probe (measured 2026-11-24, Claude Code 2.1.331, terminal)

Goal: draw codescout tool calls as cards in verbose mode. Design: `docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md`.

Instrument: dev mod `codescout-display-probe` in `~/.claude/dev-mods/2a73eae7-7774-4ea0-b776-9245570a28f1/` (session folder, not in the repo). It logs every ToolUse and ToolResult render to a JSON file with `$.fs.write`.

## Measured
- `e.props.tool` for a codescout call is `mcp__codescout__<tool>`.
- `ToolResult` is never raised for an MCP row (0 records). It fired only for native `Write` calls that the guard blocked.
- `ToolUse` renders several times per call: input `{}` and no output, then full input, then `isRunning: true`, then the final render with `output`. Log only on a change of input or output length, or the first state hides the rest.
- MCP `output` is `[{ type: "text", text }]`. Block 0 is codescout's reply. A hook note arrives as block 1 (seen on `create_file`: the operator-rule text).
- Replies are plain text for `tree`, `read_file`, `grep`, `symbols`; JSON for `edit_file`, `run_command`, `create_file`.
- Three treatments drew correctly (the person's report of their screen): replace the row with a `Box` card; rewrite `output` through `next({...e, props:{...e.props, output}})`; add a `Code format="diff"` under `await next(e)`.
- All four profiles set `"verbose": true`, so `isExpanded` was true on every render.

## Gotchas
- `claude plugin validate` refuses a hooks module that passes `$` to a function that is not a top-level declaration of the file (`flush` inside `register` failed; moved out, passed).
- Native `Write` of a mod file is denied by `pre-tool-guard.mjs` here, even for JSON. Use codescout `create_file` after `approve_write` for the dev-mods folder.
- `edit_file` replies are `"ok"`, `{status: "ok"}` or `{status, replaced}`; no diff is returned. A diff must come from `input.old_string` and `input.new_string`.

## Open
- `Button` press and stored state in a `ToolUse` row; the `Markdown` element; desktop and VS Code surfaces; compact view; images; very large results.
- How a redirected native call reaches `ToolUse` (the `[codescout-redirect]` note).

## Built, live-checked, and what the review found

- The mod is built (plugin `codescout-display` 0.1.0, 75 tests) and live-checked by the person: tree card with fold, `read_file` gutter and colors, markdown read, `edit_file` diff, the open and fold button, and a full-width `run_command` card with a 5-line command.
- **codescout reports a recoverable error as a normal result** with the body `{"ok": false, "error": …, "hint": …}`, so `isErrored` is false. A display mod must treat `ok: false` as an error and leave the engine row. Found by the whole-branch review, then confirmed in this session's own replies.
- A truncated `read_file` reply ends with `Buffer: @file_…`, `[N of M lines shown]`, `Next: …`. The header `N lines` is the file's total, not the shown count. A `json_path`, `toml_key` or `heading` read has the same header, but its lines are not lines 1..N of the file.
- Decoded JSON strings can hold ESC and CR even when the raw text was stripped. Strip after `JSON.parse`, and strip whole ANSI sequences, or the engine refuses the tree.
- A review brief must not tell a read-only subagent to call `workspace(activate)`: it flips the shared project to read-only for every caller. Use `workspace=` per call.
- Plan and design: `docs/superpowers/plans/2026-11-24-codescout-display-mod.md`, `docs/superpowers/specs/2026-11-24-codescout-display-mod-design.md`.
