# Codex hook measurements on this machine (2026-11-11)

Measured with Codex 0.167.1 (`codex-cli`, Linux, Arch). Model `gpt-5.6-luna`. Context: review of PR #13 and PR #12 (Albert, `mic-urs` fork).

## Method (reusable)
- Isolated `CODEX_HOME` in a scratch dir. `codex plugin marketplace add <this repo>` then `codex plugin add codescout-companion@sdd-misc-plugins`. `auth.json` is a symlink to the real one (needed only for model turns). Never touch `~/.codex/config.toml`: a live `codex resume` session and the managed app-server daemon run from it.
- Drive `codex app-server` (stdio JSON-RPC) from a small script: `initialize`, `hooks/list` (cwds), `config/batchWrite` (edits of `hooks.state."<key>".<field>`, `mergeStrategy` `replace`; a null value removes the line), `thread/start`, `turn/start`; read `hook/completed` notifications (`run.status`, `run.entries`) and `item/completed` (`mcpToolCall`, `collabAgentToolCall`).
- A fake MCP server named `codescout` (one tool `workspace`) logs the exact arguments Codex delivers. Real hook, fake server: the real codescout server's guide-ledger effect is NOT measured.
- Schema: `codex app-server generate-json-schema --out DIR`.
- Hook state key is POSITIONAL: `<plugin>@<marketplace>:hooks/hooks.json:pre_tool_use:<group>:<handler>`. `hooks/list` `currentHash` is `declaration/content`; the config record takes `trusted_hash` = declaration half, `trusted_content_hash` = content half.

## principal-stamp.mjs on Codex (PR #13)
- Parent call, hook enabled: hook `completed`, silent (no `agent_id`). Tool gets `{"action":"status"}`.
- Subagent call, hook enabled (2 runs): hook run `failed`, entry text `PreToolUse hook returned updatedInput without permissionDecision:allow`. The tool call STILL completes, with the ORIGINAL arguments, so the stamp does not land on 0.167.1 whether the hook is enabled or not.
- Subagent call, `enabled = false` on `…:pre_tool_use:8:0`: no hook run, no failure, same arguments.
- Registry shift (extra PreToolUse group inserted before the stamp group): the saved `8:0` record then disables `pre-tool-guard.mjs`. After a hash-only repair (`trusted_hash`, `trusted_content_hash`) Codex reports that slot `trusted` with `enabled = false` still set. The stamp hook at `9:0` stays `untrusted`.
- The fixed doc procedure (renderer key vs saved key; move `enabled = false` to the new key; null-edit removes it from the old key) works end to end. The old record keeps stale hashes, so the handler now in that slot shows `trust=modified` until reviewed.

## Wake daemon version check (PR #12, merged as 85e66fa)
- A real app-server answers `initialize` with `userAgent` = `<originator>/<version> (...)`. The originator is the name of the FIRST client that initialized the process, process-wide: in an isolated unix-socket server a second client named `codex-tui` still got the first client's prefix.
- The wake adapter and the probe match `^codex-tui\/(\d+\.\d+\.\d+)`. The live daemon here answers `codex-tui/0.160.0 (...)`, so it matches. A daemon first initialized by another client would be denied with the misleading reason "observed daemon version differs…". Fails closed.
- This machine: Codex CLI 0.167.1 installed, live daemon 0.160.0, `~/.codex/codescout-wake.json` pins `hostVersion 0.165.0` and `daemonVersion 0.160.0` (both still accepted after PR #12). 0.167.1 is not in the PR's exact-match lists by design.

## Pointers
- PR #13 (draft, Albert): review + patch comment posted 2026-11-11 (issuecomment 6806257250). Local branch `fix/pr13-review-followups` held commit `4573155`; the same diff is in the PR comment.
- PR #12: approved and merged 2026-11-11 (`85e66fa`). Follow-ups tracked in GitHub issue #14 (opened 2026-11-11).

## Not measured
Real codescout server and guide ledgers; Codex TUI display of a failed hook; other Codex versions; `PostToolUse` payload shape for subagents on 0.167.x (PreToolUse carries `agent_id`).
