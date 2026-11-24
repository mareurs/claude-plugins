# codescout-redirect: answer a native tool call from codescout instead of denying it

Date: 2026-11-24. Status: probe measured, design proposed, nothing built in this repository. Claude Code 2.1.331.

## Problem

`pre-tool-guard.mjs` refuses a native `Read`, `Grep`, `Glob`, `Edit`, `Write` and `Bash` call on source files and says which codescout tool to use. The agent then spends a turn to repeat the same request in the right tool. The refusal text is long, and a repeat gets a second refusal, "BLOCKED (see previous message)", that names no fix.

A classic PreToolUse hook cannot do better. It can change the arguments of a call (`updatedInput`) but not the tool name, so deny is the only way to send a call to another tool.

The Claude Code mod API can. A mod `tool.call` hook may return `{ result }` in place of `next(e)`. The model then reads that result as the answer of the native tool. A mod can call codescout itself with `$.mcp.call(server, tool, args)`.

## Decision

Ship one mod, `codescout-redirect`, that answers the native call from codescout and adds a one-line note for the model. The existing `pre-tool-guard.mjs` stays as the net for everything the mod does not answer.

```
codescout-redirect/
  .claude-plugin/plugin.json
  hooks/hooks.json          { "modules": ["./register.ts"] }
  hooks/register.ts         one tool.call hook per tool, each with a .catch that calls next(e)
  tests/*.test.ts           claude plugin test
```

Rules for every hook:

- **Answer exactly what the guard would deny.** The guard denies every call to these tools except the exemptions in `guard-rules.mjs` (`exemptReason`): for `Read` an image, a skill payload, harness `tool-results/` output or a config dir; for `Edit` and `Write` an image; for `Grep` and `Glob` a config-dir path. A source-file extension never exempts a call. A call the guard allows goes to `next(e)` unchanged.
- **Fail open to the guard.** A codescout error, a `pending_ack`, an unreadable result or a thrown error calls `next(e)`. The guard then refuses as it does today.
- **Pass native arguments to codescout unchanged.** codescout already accepts `file_path`, `-i`, `-C`, `-A` and `head_limit` (`src/tools/core/param_alias.rs`, `grep.rs`). The mod maps only the result.
- **The note states the situation only.** One line: which codescout call ran, with its parameters, and "call it directly". No history.
- **No UI.** The mod uses no `$.ui` call. Drawing a codescout call for the user is the job of the `codescout-display` plugin.
- **The description comes first.** A `tool.describe` hook puts the codescout call in front of the native tool's description (`Bash`, `Read`, `Grep`, `Glob`, `Edit`, `Write`), so the model chooses the codescout tool and never tries the native one. It stands aside under the same conditions as the redirect, and when the session's tool pool (`$.tool.list()`) has no matching codescout tool. The redirect is the net for the calls that still reach a native tool. The same event also takes eight codescout tools out from behind ToolSearch (`isDeferred: false`), under the same `block_reads` condition: a subagent chose the native tool whatever the description said, and chose the codescout tool once its schema was in the list.
- **The agent sees the real call.** The codescout reply goes in the result where the native schema has a text field (`Bash` stdout, `Read` content, `Grep` content). Elsewhere (`Glob`, `Write`, `Edit`) the native result has fixed fields, so the note carries the call and the reply. The tool name cannot change: the engine refuses a rewrite of it.
- **Every block of a reply is kept.** codescout adds a guide block to the first call of a session. The mod's call consumes it, so the mod passes it on, and it parses the reply from the first block only.

Result mapping (measured, see Results):

| Native tool | codescout call | Result returned to the engine |
|---|---|---|
| `Read` | `read_file(path, offset, limit)` | `{ type: "text", file: { filePath, content, numLines, startLine, totalLines } }`. Strip the `N lines` header, and on a range read the blank line after it. |
| `Grep` | `grep(...)` | `{ mode: "content", numFiles, filenames, content, numLines }` |
| `Glob` | `tree(glob, path)` | `{ durationMs, numFiles, filenames, truncated }`, one path per line |
| `Write` | `create_file(path, content, overwrite)` | `{ type: "create" or "update", filePath, content, structuredPatch, originalFile }`. Read the old file with `$.fs.read` first. |
| `Edit` | `edit_file(path, old_string, new_string, replace_all)` | `{ filePath, oldString, newString, originalFile, structuredPatch, userModified: false, replaceAll }` |
| `Bash` | `run_command(command, timeout_secs, effect)` | exit 0: `{ stdout, stderr, interrupted: false }`. Non-zero: `{ deny: "Exit code N\n..." }`. A buffered reply returns the excerpt and names the `@cmd_*` buffer in the note. |
| `Monitor` | none | `{ deny }` with the fix: `run_command(run_in_background=true)`, end the turn, the wake hook fires. In a subagent run in the foreground with `timeout_secs`. |

`Monitor` is not a redirect. A native monitor wakes the session for each stdout line and returns a `taskId` that `TaskStop` uses. A codescout background job wakes the session once, at the end, and has no `TaskStop` link. A `{ result }` there would hand the model a handle that does not work.

## Cost against the Iron Law

`CLAUDE.md` asks a design that adds a surface to name which rule it costs.

- **Simplicity (one way per job): costs it.** The mod and the guard are two paths to the same end. The guard cannot go: Codex and a Claude Code build without the mod API need it, and it catches whatever the mod passes on. The mod does not replace the guard. It takes the calls that have a clean codescout answer. Dropping the guard later is a separate decision.
- **A new surface and a new language.** A TypeScript module, loaded only by Claude Code, and loaded only after the person turns mods on (see Not decided).
- **Natural for an agent: gains.** The agent calls the tool it already knows, and gets an answer, not a refusal.
- **Few turns: gains.** One call answers. Today it is a refused call plus a repeat.
- **Token economy: gains.** The note is one line. The refusal is a long text, and it repeats.
- **Lenient: gains.** This is the rule "do what the agent meant, say in one line what you understood", applied to the tool name.

## Not decided here

- **How a user installs a mod from this marketplace.** The probe ran from a dev folder with hot reload. A mod in a marketplace entry, and the "turn on mods" approval, were not tested. `--plugin-dir` works as a fallback.
- **Where the guard's exemption rules live.** They are now a pure module, `codescout-companion/hooks/guard-rules.mjs` (no `node:` import), that the guard imports. A mod may import a file of its own plugin only. Measured 2026-11-24 (Claude Code 2.1.331): one plugin whose `hooks/hooks.json` holds both `hooks` and `modules` passes `claude plugin validate`, and in a headless `claude -p --plugin-dir` run both fired. **That is not a reason to do it**: `codescout-companion/hooks/hooks.json` is read by other harnesses too (Codex, Copilot), and what they do with a `modules` key was not measured. The mod therefore stays a separate, Claude-Code-only plugin, `codescout-redirect`, and carries a byte copy of `guard-rules.mjs`, kept in step by a sync script and a drift test (the `cs-hint-codex` precedent). Two gates stay outside the rules and are impure: `HAS_CODESCOUT` and `BLOCK_READS` (`detectFor`). A mod must respect `block_reads: false`, or it would answer calls the user opted out of.
- **The `Bash` scope.** The probe answers only one simple read-only command (`ls`, `pwd`, `echo`, `date`, `wc`, `git status|log|diff|branch`) with no chaining, pipes, redirection or substitution. A wider scope runs write commands through `run_command` and needs its own review. Commands outside the scope go to the guard.
- **The `Edit` diff.** The probe builds one hunk for the first match. How the terminal draws it, compared with the native diff, was not checked.
- **`Grep` and `Glob` result shapes.** The type file has no result record for them. The engine accepted the probe's shape. Whether it accepts any shape is not known.
- **A `tree` alias for `pattern`.** Not checked. If `tree(pattern=...)` fails, one `param_aliases` entry in codescout closes it for every agent.
- **A real line-by-line monitor.** A mod has `$.process.spawn` and `$.session.send`. That is new functionality with its own design.
- **Settings.** All four profiles denied `Write`, `Edit`, `Bash` and `Monitor` in `settings.json`. A denied tool never reaches the model, so no hook can answer it. Those entries were removed on 2026-11-24 (backups in the session scratchpad). A user who copies this setup must remove them too.

## Other harnesses

This repository serves more than Claude Code: Codex, GitHub Copilot, OpenCode (`harnesses/opencode/`) and Pi (`harnesses/pi/`). The mod is a Claude Code surface. It must not change what any other harness runs.

- **The guard is the common path.** Codex, Copilot and the OpenCode bridge run `pre-tool-guard.mjs` as a process and read its deny. Its stdin and stdout contract is unchanged by the `guard-rules.mjs` extraction (the OpenCode adapter tests pass). The mod answers first on Claude Code only; the guard stays the net everywhere.
- **No change to a shared file for the mod's sake.** The mod adds nothing to `codescout-companion/hooks/hooks.json` or to any file another harness reads.
- **Codex trust.** Codex binds hook approval to a hash of the whole plugin root, so the new `guard-rules.mjs` in `codescout-companion` asks Codex users to approve again at the next release, like any release that changes content. The mod's own plugin adds no file to that root.
- **Not measured:** an equivalent redirect for Codex, OpenCode or Pi. Each has its own interception surface, and each needs its own measurement and spec.

## Change scenarios absorbed

- A new codescout parameter alias: no mod change. The mod passes native names.
- A codescout result format change: one mapping function per tool changes, and its test.
- Claude Code adds a typed result for `Grep` or `Glob`: the probe's shape may be refused. The hook then fails open to the guard, so the cost is one refusal and not a broken session.
- A harness without the mod API: the guard works as it does today.

## Results (2026-11-24)

Instrument: the dev mod `codescout-redirect-probe`, hot-reloaded in a live session. Each row is one run (n = 1) unless it says otherwise. The mod answered only `.mjs` files under this repository, one sandbox folder for `Write` and `Edit`, and the `Bash` allowlist above. Measurements are also in the codescout memory `research/codescout-redirect-mod-probe-20261124`.

| Tool | Result |
|---|---|
| `Read` | Accepted. The guard did not fire. The first version leaked the codescout `N lines` header, which shifted line numbers by 2; the second version stripped it and `limit: 3` returned the real lines 1 to 3. |
| `Grep` | Accepted. Two real hits returned. `head_limit: 5` mapped to `limit: 5`. |
| `Glob` | Accepted. 44 paths parsed from the `tree` text. |
| `Write` | Accepted for create, then for update (the tool said "updated"). The file on disk matched. |
| `Edit` | Accepted. `beta` became `BETA` and the disk matched. A missing `old_string` gave the native error and no note. |
| `Bash` | `echo hello` and `git status --short` were answered with a note. `ls /nonexistent-dir` gave `Exit code 2` as an error. A chained command went to the guard. A 200-line `git log` returned an excerpt, the size marker and a note naming the `@cmd_*` buffer. |
| `Monitor` | The model received the mod's refusal text, not a bare deny. |

Widened `Read`, `Grep` and `Glob` (the repository's `codescout-redirect`, loaded with `claude -p --plugin-dir`, Haiku, one run): a `Read` of `harnesses/README.md`, which the guard denies, was answered by `read_file`. Line 1 was `# Other harnesses` and the `[codescout-redirect]` note arrived. The mod's own tests use fakes for `process.run`, `session.cwd` and `fs.read`; this run shows the real engine accepts them. Not run live: `block_reads: false`, a subagent, and a config dir path.

What this does not show:

Description of `Bash` (`tool.describe`, Claude Code 2.1.331, Haiku, headless `claude -p`, prompt "show me the last 2 commits, pick whatever tool you think is right", n=3 per arm, first tool from the raw event stream): without a probe `Bash` was the first choice 3 of 3. With the description replaced by advice, ToolSearch for `run_command` was first 3 of 3; with the advice in front of the native text, 3 of 3. The model quoted the new text, so it sees it. The mod in the repository (softer wording: "If it is not in your tool list, load it") gave 2 of 3, and 1 of 3 went to `Bash`; at this n that cannot be told from 3 of 3. Not measured: other models, subagents, a write prompt, a session after compaction, and `isDeferred: false` on the codescout tools (it would remove the ToolSearch step).

`isDeferred: false` on eight codescout tools (main agent, Haiku, n=5 per arm, mod installed alone against mod plus a probe that pins them): `ToolSearch` was used 5 of 5 without the pin and 0 of 5 with it; turns 3.8 against 3.0; duration 9.5 s against 7.7 s; cost per run 0.0099 against 0.0094 dollars, with a spread (0.003 to 0.0132) larger than the difference. `workspace` was not in the pinned list and was still called without ToolSearch in the pin arm; the cause was not found.

Subagents (the Agent tool, general-purpose, prompt "show the last 2 commits, pick whatever tool you think is right", n=3 per arm, subagent events read by `parent_tool_use_id`; the subagent ran on the same model as the main agent, read from the events). Without the mod: `Bash` first 3 of 3 on Haiku and on Sonnet, each with one guard refusal, then ToolSearch, then `run_command`. With the description advice only: the same, 3 of 3 on both. A subagent asked to quote its `Bash` description quoted the advice (2 of 2), so it sees it and does not follow it. With the eight tools pinned (probe): `run_command` first 3 of 3 on Haiku, no refusal, no ToolSearch; 2 of 3 on Sonnet, the third started with `Bash`, was refused, and went on to `run_command`. With the mod itself (description and pin), Haiku: 2 of 3, the third refused once. At n=3 these differences are small. Not measured: tasks other than reading git history, a real session's subagent instructions, tokens added by the schemas.

- The `ls` error case has the same text as a native run. The result fits the mod, but no marker proved which path answered.
- The first buffered `Bash` run fell back to the guard, which matches the plan. The fix was written after that run, and the second run was verified.
- Not tested: a large `Read` or `Write`, a `Write` outside the project root (codescout then waits for an approval, and the probe falls back), `Edit` with `replace_all`, concurrent calls, and the terminal display of the `Edit` diff.
- One session, one machine, one Claude Code build.
