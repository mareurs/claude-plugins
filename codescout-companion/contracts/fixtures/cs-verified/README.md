# cs-verified fixtures: real PostToolUse input for a codescout `edit_code` result

Recorded 2026-11-05 by the probe in `codescout-companion/scripts/probe-cs-verified/`
(`run.sh`, `stub_mcp.py`, `hook.py`, `analyze.py`). Findings and the decisions that bind the
cs-verified hook are in [`results.md`](results.md).

## How every fixture was made

- CLI binaries: `~/.local/share/claude/versions/2.1.318` (sha256 prefix `708c77b204db3008`) and
  `~/.local/share/claude/versions/2.1.311` (sha256 prefix `86dc1fcc69498159`). Model `claude-haiku-5-5`, `--max-budget-usd 0.25`.
- The stub MCP server is registered as `codescout`, so the tool is `mcp__codescout__edit_code`.
  Its result is the envelope codescout's `edit_code replace` emits:
  `{"status":"ok","replaced_lines":"10-12","hint":"HINT_KEEP_4K: …","advice":{"text":"verify callers: references(symbol=\"probe_fn_9v\", path=\"src/lib.rs\") | `probe_fn_9v` is called by name in src/other.rs (a syntactic match, not resolved by the language server)","verified":true}}`
  as block 1, then (stub mode `two`) a text block `SECOND_BLOCK_7Q: …`, then (mode `mixed`) a 1x1 PNG image block.
- The CLI ran with an explicit environment (execve; the `env -i` equivalent) holding exactly
  `HOME`, `PATH=/usr/local/bin:/usr/bin:/bin`, `CLAUDE_CONFIG_DIR=<fresh dir in the run dir>`,
  `CLAUDE_CODE_OAUTH_TOKEN` and `DISABLE_AUTOUPDATER=1`. No profile config dir (`~/.claude*`) was read or written.
  The isolation is not total: the CLI still loaded its builtin plugins (4 on 2.1.318: `cc-plugin-agents-md`,
  `cc-plugin-telemetry`, `cc-plugin-privacy`, `cc-plugin-plugin-authoring`; 3 on 2.1.311, without `cc-plugin-privacy`;
  per the stream's `init` event) and fetched `remote-settings.json` (`{}` in all 23 runs) and `policy-limits.json`
  into the run's own config dir.
  The `polluted` runs add fake values for eight host-signal variables (listed in those fixtures).
- Command (`run.sh` builds it; `<RUN>` is the run dir):
  `claude -p '<prompt>' --model claude-haiku-5-5 --session-id <uuid> --setting-sources local --mcp-config <RUN>/mcp.json --strict-mcp-config --settings <RUN>/settings.json --tools '' --allowedTools mcp__codescout__edit_code --max-budget-usd 0.25 --output-format stream-json --verbose --include-hook-events`
  (subagent runs: `--tools default --allowedTools mcp__codescout__edit_code,Agent,Task`; plugin runs add `--plugin-dir <RUN>/plugin` and pass `{}` as settings).
- Hook registration (settings form): `{"hooks":{"PostToolUse":[{"matcher":"mcp__codescout__.*","hooks":[{"type":"command","command":"/usr/bin/python3 -I <probe>/hook.py <mode> <RUN>/hook-log.jsonl"}]}]}}`.

## Files

Stdin fixtures are the exact bytes the CLI wrote to the hook's stdin (session ids and paths as recorded;
the paths point into a scratch directory under the session scratchpad, which may be cleaned up at any time; after that,
the committed fixtures and `results.md` are the only evidence left).

| File | CLI | Run (`run.sh` args) | Case |
|---|---|---|---|
| `claude-2.1.318-root-one-block.json` | 2.1.318 | `2.1.318 v318-one-empty one empty` | main agent, 1 text block |
| `claude-2.1.318-root-two-blocks.json` | 2.1.318 | `2.1.318 v318-two-empty two empty` | main agent, 2 text blocks |
| `claude-2.1.318-root-text-text-image.json` | 2.1.318 | `2.1.318 v318-mixed-relocate mixed relocate` | main agent, text + text + image (the CLI adds a 4th block) |
| `claude-2.1.318-subagent-two-blocks.json` | 2.1.318 | `2.1.318 v318-subagent-relocate two relocate "" subagent` | call made inside a general-purpose subagent |
| `claude-2.1.311-root-one-block.json` | 2.1.311 | `2.1.311 v311-one-braces one braces` | main agent, 1 text block |
| `claude-2.1.311-root-two-blocks.json` | 2.1.311 | `2.1.311 v311-two-empty two empty` | main agent, 2 text blocks |
| `claude-2.1.311-root-text-text-image.json` | 2.1.311 | `2.1.311 v311-mixed-relocate mixed relocate` | main agent, text + text + image |
| `claude-2.1.311-subagent-two-blocks.json` | 2.1.311 | `2.1.311 v311-subagent-relocate two relocate "" subagent` | subagent call |

Environment fixtures (`hookEnv` = the hook process's whole environment; secret-looking values replaced by their length;
`stdinKeys`, `stdinSessionId`, `stdinAgentId` from the same call):

| File | CLI | Run | Case |
|---|---|---|---|
| `claude-2.1.318-hook-env-clean.json` | 2.1.318 | `v318-two-empty` | settings hook, clean environment |
| `claude-2.1.318-hook-env-polluted.json` | 2.1.318 | `PROBE_POLLUTE=1 … v318-polluted-empty two empty` | settings hook, fake host-signal variables handed to the CLI |
| `claude-2.1.318-hook-env-plugin.json` | 2.1.318 | `v318-plugin-relocate two plugin:relocate` | plugin hook (`${CLAUDE_PLUGIN_ROOT}` in the command) |
| `claude-2.1.318-hook-env-subagent.json` | 2.1.318 | `v318-subagent-relocate` | settings hook, subagent call |
| `claude-2.1.311-hook-env-clean.json` | 2.1.311 | `v311-two-empty` | as above |
| `claude-2.1.311-hook-env-polluted.json` | 2.1.311 | `PROBE_POLLUTE=1 … v311-polluted-empty two empty` | as above |
| `claude-2.1.311-hook-env-plugin.json` | 2.1.311 | `v311-plugin-relocate two plugin:relocate` | as above |
| `claude-2.1.311-hook-env-subagent.json` | 2.1.311 | `v311-subagent-relocate` | as above |

To re-record: `PROBE_OUT=<scratch dir> PROBE_TOKEN_FILE=<0600 token file> codescout-companion/scripts/probe-cs-verified/run.sh <version> <label> <stub-mode> <hook-mode> [timeout] [main|subagent]`,
then `python3 -I codescout-companion/scripts/probe-cs-verified/analyze.py <PROBE_OUT>/<label>` for the summary.
The fixtures are written from a run dir by the same script (first hook call of the run):

```bash
A=codescout-companion/scripts/probe-cs-verified/analyze.py
F=codescout-companion/contracts/fixtures/cs-verified
python3 -I $A stdin-fixture <PROBE_OUT>/v318-two-empty $F/claude-2.1.318-root-two-blocks.json   # raw stdin bytes
python3 -I $A env-fixture   <PROBE_OUT>/v318-two-empty $F/claude-2.1.318-hook-env-clean.json    # environment record
```

The run for each file is in the tables above. Re-running both subcommands over the 23 recorded run dirs reproduced
all 16 committed fixtures byte for byte (checked with `cmp`, 2026-11-05).

## End-to-end fixtures (Task 4, the shipped hook)

Recorded by the same harness extended in Task 4 (`run.sh` hook modes `shipped`, `exact`, `crash`, `standin`; `PROBE_RESUME_FROM`,
`PROBE_FORK`, `PROBE_INTERACTIVE`; `wrap_shipped.py`, `standin.py`, `pty_drive.py`, `digest.py`). The hook is registered as a
throwaway plugin (`--plugin-dir`): a `--settings` hook with `${CLAUDE_PLUGIN_ROOT}` is refused by the CLI (see `results.md`
section 7). Stub modes added: `false` (advice with `verified: false`) and `hintonly` (hint, no advice). Findings: `results.md`
sections 7 to 11.

| File | CLI | Run | Case |
|---|---|---|---|
| `claude-<ver>-root-verified-false.json` | 2.1.318, 2.1.311 | `e318-c-false`, `e311-c-false` (`<ver-short> <label> false shipped`) | stdin for a 2-block result whose advice has `verified: false` |
| `claude-<ver>-root-hint-only.json` | 2.1.318, 2.1.311 | `e318-d-hintonly`, `e311-d-hintonly` | stdin for a 2-block result with a `hint` and no `advice` |
| `claude-<ver>-interactive-after-clear.json` | 2.1.318, 2.1.311 | `e318-g-interactive`, `e311-g-interactive` (`PROBE_INTERACTIVE=1`), second hook call | stdin of an interactive session's call after `/clear` (14 keys, `permission_mode` `auto`) |
| `claude-<ver>-hook-env-interactive-after-clear.json` | 2.1.318, 2.1.311 | same, second hook call | hook environment there (`CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_CODE_SESSION_ATTENDED=1`, session id equal to stdin) |
| `claude-<ver>-hook-env-fork.json` | 2.1.318, 2.1.311 | `e318-g-fork`, `e311-g-fork` (`PROBE_RESUME_FROM=<run> PROBE_FORK=1`) | hook environment of a `--fork-session` call (new session id, equal to stdin) |

Write them with `analyze.py stdin-fixture|env-fixture <run-dir> <out> [n]` (`n`: the 0-based hook call, default the first; the
interactive files use `1`).
