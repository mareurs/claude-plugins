# codescout-redirect

A Claude Code mod that answers a native tool call from codescout, in place of a refusal.

`codescout-companion` refuses a native `Read`, `Grep`, `Glob`, `Edit`, `Write` and `Bash` call on source files. The agent then repeats the call in the codescout tool. This mod hooks `tool.call`, calls codescout with `$.mcp.call("codescout", ...)`, and returns the result in the shape of the native tool, with a one-line note that names the codescout call. A call it does not answer goes on to the next hook, so `pre-tool-guard.mjs` still refuses it.

Design, measurements and open points: `docs/superpowers/specs/2026-11-24-codescout-redirect-mod-design.md`.

**Adapter logic only, no UI.** The mod draws nothing: no toast, no card, no status line. What the user sees of a codescout call is the job of the `codescout-display` plugin. What the mod adds for the agent is text: the codescout reply in the result where the native schema has a text field (`Bash` stdout, `Read` content, `Grep` content), and a note that names the real call with its parameters.

## Scope

| Tool | Answered |
|---|---|
| `Read`, `Grep`, `Glob` | every call the guard would deny: all except images and PDF, skill payloads, harness `tool-results/` output and Claude config dirs (`exemptReason` in `guard-rules.mjs`) |
| `Write`, `Edit` | only inside `claude-plugins/redirect-probe-sandbox/` |
| `Bash` | one simple read-only command: `ls`, `pwd`, `echo`, `date`, `wc`, `git status\|log\|diff\|branch`; no `;`, `&`, `\|`, `<`, `>`, backtick, `$` or newline |
| `Monitor` | always a refusal that names the fix: `run_command(run_in_background=true)`, then end the turn |

The mod stands aside, and the next hook (the guard) decides, when `block_reads` is `false` in `.claude/codescout-companion.json` (or `codescout-routing.json`) and the caller is the main agent, when `HOME` cannot be read, and when codescout answers with an error. A subagent is still redirected under `block_reads: false`, as in the guard.

`hooks/guard-rules.mjs` is a byte copy of `codescout-companion/hooks/guard-rules.mjs`. After a change there run `scripts/sync-codescout-redirect.sh`; `tests/test-codescout-redirect.sh` fails while the copy drifts. The mod adds nothing to a file that Codex, Copilot, OpenCode or Pi read.

## Descriptions

The mod also rewrites the description that the model reads for `Bash`, `Read`, `Grep`, `Glob`, `Edit` and `Write` (`tool.describe`). The codescout call that replaces the tool goes in front, with the `ToolSearch` query that loads it, and the native text stays after it. The advice is left out when `block_reads` is `false`, when the session's tool pool has no matching `mcp__codescout__*` tool, or when the pool cannot be read. A change reaches a thread at its start or after a compaction. Measured on Haiku, n=3 per arm: `Bash` was the first choice 3 times of 3 without the advice, and the codescout tool was the first choice 3 of 3 with a probe's advice and 2 of 3 with this text.

The mod also takes eight codescout tools (`run_command`, `read_file`, `edit_file`, `create_file`, `grep`, `tree`, `symbols`, `edit_code`) out from behind ToolSearch and puts their schema in the prompt list (`isDeferred: false`), under the same `block_reads` condition. For a subagent this is what counts: with the tools behind ToolSearch and the advice in the description, a subagent chose `Bash` first 3 of 3 on Haiku and 3 of 3 on Sonnet, although it quotes the advice when asked. With the schemas in the list it chose `run_command` first 3 of 3 on Haiku and 2 of 3 on Sonnet (probe), and 2 of 3 on Haiku with the mod itself. The list costs prompt size; a cost difference was not visible at n=5, but it was not measured as tokens.

## Needs

- A Claude Code build with hooks modules (`hooks/hooks.json` with `modules`). Measured on 2.1.331.
- The codescout MCP server, connected under the name `codescout`.
- The tool must reach the model. A tool listed in `permissions.deny` of `settings.json` never reaches a hook.

Check it with `claude plugin validate codescout-redirect` and `claude plugin test codescout-redirect`.
