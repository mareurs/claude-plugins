# codescout-redirect probe mod (measured 2026-11-24, Claude Code 2.1.331)

Goal: replace the brutal deny of native tools with an answer from codescout plus a note.

Mod location (dev only, not in this repo yet): ~/.claude-stef/dev-mods/<session>/codescout-redirect-probe/ (hooks/register.ts).
API: `on('tool.call', {tool}, hook)`; answer with `{ result, context? }` instead of `next`; `$.mcp.call("codescout", tool, args)`; `.catch` fails open to `next(e)`.

## Measured
- Read: accepted. codescout read_file puts an "N lines" header (+1 blank line on a range read) first: strip it, or line numbers shift by 2.
- Grep, Glob: accepted. The type file has NO result schema for them, so acceptance proves little.
- Write (create + update) and Edit: accepted typed results (type, filePath, content, structuredPatch, originalFile / oldString, newString, userModified, replaceAll). Disk verified. Missing old_string falls back to the native error.
- Bash: accepted for an allowlist of simple read-only commands. Non-zero exit -> `{ deny: "Exit code N\n..." }`. Large output: codescout returns output_id + clipped stdout; return the excerpt and name the @cmd_* buffer in `context`. Verified.
- Monitor: NOT a redirect (event stream per stdout line vs one wake at job end; taskId feeds TaskStop). A tool.call hook returns a deny that teaches run_command(run_in_background=true) + the wake hook. Verified.
- codescout already has a param-alias layer (src/tools/core/param_alias.rs): native names (file_path, -i, -C, head_limit) are accepted. Do not rename arguments in the mod. Unchecked gap: tree has no `pattern` alias.

## Gotchas
- A tool that settings deny never reaches the model, so a hook cannot fire. Write/Edit/Bash/Monitor were denied in all four profiles' settings.json; removed 2026-11-24 (backups in the session scratchpad settings-backup/).
- codescout write outside the project root returns pending_ack and writes nothing: detect it and fall back.
- Codex and builds without the mod API still need the old deny hook (pre-tool-guard.mjs).

## Open
- Spec a real `codescout-redirect` mod in this repo (Iron Law: replace the deny path, name the cost).
- Wider scope than the probe (sandbox / .mjs only), Bash allowlist, Edit diff display, large files.
