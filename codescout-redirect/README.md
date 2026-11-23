# codescout-redirect

A Claude Code mod that answers a native tool call from codescout, in place of a refusal.

`codescout-companion` refuses a native `Read`, `Grep`, `Glob`, `Edit`, `Write` and `Bash` call on source files. The agent then repeats the call in the codescout tool. This mod hooks `tool.call`, calls codescout with `$.mcp.call("codescout", ...)`, and returns the result in the shape of the native tool, with a one-line note that names the codescout call. A call it does not answer goes on to the next hook, so `pre-tool-guard.mjs` still refuses it.

Design, measurements and open points: `docs/superpowers/specs/2026-11-24-codescout-redirect-mod-design.md`.

## Scope of 0.1.0

The scope is narrow on purpose.

| Tool | Answered |
|---|---|
| `Read` | a `.mjs` file under `claude-plugins` |
| `Grep`, `Glob` | `path` unset, or under `claude-plugins` |
| `Write`, `Edit` | only inside `claude-plugins/redirect-probe-sandbox/` |
| `Bash` | one simple read-only command: `ls`, `pwd`, `echo`, `date`, `wc`, `git status\|log\|diff\|branch`; no `;`, `&`, `\|`, `<`, `>`, backtick, `$` or newline |
| `Monitor` | always a refusal that names the fix: `run_command(run_in_background=true)`, then end the turn |

A codescout error, a `pending_ack` or a thrown error falls through to the next hook.

## Needs

- A Claude Code build with hooks modules (`hooks/hooks.json` with `modules`). Measured on 2.1.331.
- The codescout MCP server, connected under the name `codescout`.
- The tool must reach the model. A tool listed in `permissions.deny` of `settings.json` never reaches a hook.

Check it with `claude plugin validate codescout-redirect` and `claude plugin test codescout-redirect`.
