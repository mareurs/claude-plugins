# cs-verified relocation preconditions: measured on Claude Code 2.1.318 and 2.1.311

Measured 2026-11-05 with the probe in `codescout-companion/scripts/probe-cs-verified/`. How runs were made,
the exact command and the fixture list: [`README.md`](README.md). 23 runs, 12 on 2.1.318 and 11 on 2.1.311,
USD 0.0293 in total as reported by the CLI (`total_cost_usd` of each run's `result` event; per-run table at
the end). Evidence for each claim: the run's stream (`--include-hook-events`), its session transcript, and the
probe hook's own log of its stdin and environment. "Model-visible" below means the text the CLI recorded as
sent to the API (transcript `api-request-blob` and `tool_result` entries), checked against the model's reply.

Common to all runs: stub registered as MCP server `codescout`, tool `mcp__codescout__edit_code`, called once
with `{}`; hook matcher `mcp__codescout__.*`; settings form
`{"hooks":{"PostToolUse":[{"matcher":"mcp__codescout__.*","hooks":[{"type":"command","command":"/usr/bin/python3 -I <probe>/hook.py <mode> <RUN>/hook-log.jsonl"}]}]}}`
(timeout runs add `"timeout": 2` to the hook object). The CLI's own stderr was empty and its exit code 0 in all 23 runs.

## 1. Empty stdout

Runs: `v318-one-empty`, `v318-two-empty`, `v311-two-empty` (hook prints nothing, exit 0); `v318-one-braces`,
`v311-one-braces` (hook prints `{}`).

- Empty stdout, both versions: stream `hook_response` `{"outcome":"success","exit_code":0,"stdout":"","stderr":""}`;
  no hook attachment in the transcript; the `tool_result` the model got is the stub output byte for byte (advice
  still in block 1); nothing hook-related in the API request. The model answered "I did not see any text starting
  with `[cs-verified]` anywhere in the result."
- `{}`, both versions: also `outcome: success`, result unchanged, nothing model-visible, but the transcript gains a
  `hook_success` attachment with `"stdout":"{}\n"`.

**DECISION (Q1):** when it does not act, the hook prints nothing (zero bytes) and exits 0. Accepted on 2.1.318
and 2.1.311; `{}` is accepted too but writes a transcript attachment for nothing.

## 2. `tool_response` form

Runs: one block `v318-one-empty`, `v311-one-braces`; two blocks `v318-two-empty`, `v311-two-empty`; text + text + image
`v318-mixed-relocate`, `v311-mixed-relocate`. Fixtures `claude-<ver>-root-*.json`.

- 1 block and 2 blocks, both versions: `tool_response` is a JSON list of the MCP content blocks,
  `[{"type":"text","text":"{\"status\": \"ok\", …, \"advice\": {…, \"verified\": true}}"}, {"type":"text","text":"SECOND_BLOCK_7Q: …"}]`.
  A string form was not seen on either version.
- With an image block the list the hook gets is the CLI's converted form, not the raw MCP content, and has one block
  more than the server sent: `{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0K…"},"data":null}`
  followed by a CLI-added `{"type":"text","text":"[Image: source: <config>/projects/<slug>/<session>/tool-results/mcp-codescout-blob-<n>.png]"}`
  (block types `["text","text","image","text"]` on both versions).
- Stdin keys, main-agent call, both versions identical: `cwd, duration_ms, effort, hook_event_name, mcp_server,
  permission_mode, prompt_id, session_id, tool_input, tool_name, tool_response, tool_use_id, transcript_path`
  (`effort` is `{"level":"medium"}`, `mcp_server` is `{"name":"codescout","source":"dynamic"}`, `permission_mode` `"default"`).

**DECISION (Q2):** the hook acts only on the list form; it addresses the block whose `type` is `"text"` and whose
text parses to the envelope, and echoes every other block unchanged (including the converted image block, its
`data: null`, and the CLI-added `[Image: …]` text block). Any other `tool_response` type: print nothing.

## 3. `updatedToolOutput` with several blocks, plus `additionalContext`

Runs: `v318-two-relocate`, `v311-two-relocate`, `v318-mixed-relocate`, `v311-mixed-relocate`, `v318-plugin-relocate`,
`v311-plugin-relocate`. Hook stdout (two-block case):
`{"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedToolOutput": [{"type": "text", "text": "{\"status\": \"ok\", \"replaced_lines\": \"10-12\", \"hint\": \"HINT_KEEP_4K: a protocol hint that must stay in the result\"}"}, {"type": "text", "text": "SECOND_BLOCK_7Q: a second text block from the stub"}], "additionalContext": "[cs-verified] verify callers: references(symbol=\"probe_fn_9v\", path=\"src/lib.rs\") | `probe_fn_9v` is called by name in src/other.rs (a syntactic match, not resolved by the language server)"}}`

- Both versions, settings and plugin registration alike: the `tool_result` the model got is exactly the
  `updatedToolOutput` list: block 1 without `advice` (`hint` kept), block 2 unchanged; in the image runs all 4 blocks
  arrived, image included. The transcript records a `hook_additional_context` attachment with the `[cs-verified]` text.
- How the context reaches the model (both versions): a separate **system-role** message in the API request, whose
  text is
  `PostToolUse:mcp__codescout__edit_code hook additional context: [cs-verified] verify callers: references(symbol="probe_fn_9v", path="src/lib.rs") | ...`
  followed by the CLI's own budget lines. It is not a `<system-reminder>` block, and the text the model sees does not
  start with `[cs-verified]`: the CLI prefixes `<hook name> hook additional context: `.
- The model's reply (2.1.318): "Yes, I saw text starting with `[cs-verified]`, but not in the tool's result blocks.
  It appeared in a PostToolUse hook's additional context, after the call".

**DECISION (Q3):** Task 2 prints exactly the shape above; it works on 2.1.318 and 2.1.311 for 1, 2 and 3(+1) blocks.
Slice 4 (declaration text) must expect the tag after the CLI's `PostToolUse:<tool> hook additional context: ` prefix,
in a system turn.

## 4. Host signals in a clean environment

Runs: clean `v318-two-empty`, `v311-two-empty` (and every other run); polluted `v318-polluted-empty`,
`v311-polluted-empty` (the CLI was handed `CLAUDECODE=polluted`, `CLAUDE_CODE_ENTRYPOINT=polluted`,
`CLAUDE_CODE_SESSION_ID=polluted`, `AI_AGENT=polluted`, `CLAUDE_PROJECT_DIR=/polluted`, `CLAUDE_EFFORT=polluted`,
`CLAUDE_PID=polluted`, `CLAUDE_PLUGIN_ROOT=/polluted`); plugin `v318-plugin-relocate`, `v311-plugin-relocate`.
Fixtures `claude-<ver>-hook-env-*.json`.

Passed to the CLI: `HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, `DISABLE_AUTOUPDATER`.
The hook process received (both versions, settings hook): `AI_AGENT=claude-code_2-1-318_harness` (`…2-1-311…` on
2.1.311), `CLAUDECODE=1`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_CODE_ENTRYPOINT=sdk-cli`,
`CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SESSION_ATTENDED=0`,
`CLAUDE_CODE_SESSION_ID=<the session id>`, `CLAUDE_EFFORT=medium`, `CLAUDE_PID=<cli pid>`,
`CLAUDE_PROJECT_DIR=<cwd>`, `COREPACK_ENABLE_AUTO_PIN=0`, `LC_CTYPE=C.UTF-8`, `NoDefaultCurrentDirectoryInExePath=1`,
plus `PWD`, `SHLVL`, `_` (the shell) and the passed `HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER`.
`CLAUDE_CODE_OAUTH_TOKEN` was not passed on to the hook. `CLAUDE_PLUGIN_ROOT` (and `CLAUDE_PLUGIN_DATA`) are present
only for the plugin-registered hook.

Which values the CLI sets over an inherited one (polluted runs, both versions):

| Variable | Hook saw | Inheritable? |
|---|---|---|
| `CLAUDECODE` | `1` | overwritten, but a constant: an inherited `1` looks the same |
| `CLAUDE_CODE_SESSION_ID` | the real session id, equal to stdin `session_id` | overwritten |
| `CLAUDE_EFFORT`, `CLAUDE_PID`, `CLAUDE_PROJECT_DIR` | real values | overwritten |
| `AI_AGENT` | `polluted` | **inherited** |
| `CLAUDE_CODE_ENTRYPOINT` | `polluted` | **inherited** |
| `CLAUDE_PLUGIN_ROOT` (settings hook) | `/polluted` | **inherited** |

`CLAUDE_CODE_SESSION_ID` equalled stdin `session_id` in every one of the 23 runs' hook calls checked (root, plugin and
subagent calls on both versions; the subagent call carries the parent's session id in both places).

**DECISION (Q4), the host gate:**
`input.hook_event_name === "PostToolUse" && typeof input.session_id === "string" && input.session_id !== "" && process.env.CLAUDE_CODE_SESSION_ID === input.session_id`.
It uses only what this CLI writes for the call itself: an inherited `CLAUDE_CODE_SESSION_ID` is overwritten, and a
value inherited by some other host's hook process would name a different session than that host's stdin. Do not use
`AI_AGENT`, `CLAUDE_CODE_ENTRYPOINT` or `CLAUDE_PLUGIN_ROOT` (inherited, measured), nor `CLAUDECODE` alone (constant).
Not measured: what VS Code or Copilot put in a hook's stdin and environment; whether the variable follows the stdin
id after `--resume`, `/clear`, `--fork-session` or compaction, and interactive (non `-p`) sessions. A mismatch fails
closed (the hook prints nothing, the advice stays in the result).

## 5. Failure modes

All on the two-block stub; both versions gave the same outcome.

| Mode (run) | Stream `hook_response` | Result the model got | Shown to the model | Session |
|---|---|---|---|---|
| sleep 5 s with `"timeout": 2` (`v318-two-timeout`, `v311-two-timeout`) | `outcome: cancelled`, `exit_code: 1`, stdout empty | unchanged (advice in it) | nothing | continued; exit 0. Cancelled 2.05 s / 2.07 s after the hook started; the hook process was killed (its post-sleep log line never appeared) |
| `exit 2` + stderr line (`v318-two-exit2`, `v311-two-exit2`) | `outcome: error`, `exit_code: 2`, stderr = the line | unchanged | **yes**: a system turn `PostToolUse:mcp__codescout__edit_code hook blocking error from command: "<full command line>": [<full command line>]: PROBE_EXIT2_STDERR_5M: text the probe hook wrote to stderr before exit 2`; the model mentioned it in its reply | continued; exit 0 |
| truncated JSON on stdout, exit 0 (`v318-two-malformed`, `v311-two-malformed`) | `outcome: success`, `exit_code: 0` | unchanged | nothing (the raw text is kept as a `hook_success` attachment in the transcript only) | continued; exit 0 |
| 2 MiB stdout: valid relocation JSON with 2 MiB of spaces between its two members (`v318-two-big`, `v311-two-big`) | `outcome: success`, all 2,097,708 bytes | relocated (advice removed) | the `[cs-verified]` context, as in Q3 | continued; exit 0; the transcript stored the whole stdout (2.15 MB transcript vs 57 KB for `two-relocate`) |

**DECISION (Q5):** every path exits 0 and writes nothing to stderr; exit 2 is the one mode that leaks hook text
(and the command line) to the model, so the hook must never use it. A timeout and malformed JSON both leave the
result unchanged and show nothing; keep the default hook timeout (a short `timeout` only costs the relocation).
Output size is not a CLI failure mode up to 2 MiB, but the CLI writes the hook's stdout verbatim into the transcript
on every call, so the hook's own size limit (Review Focus: huge `tool_response` → print nothing) is what bounds that growth.

## 6. Subagent tool calls (record only)

Runs: `v318-subagent-relocate`, `v311-subagent-relocate` (the main agent started one general-purpose subagent with
the `Agent` tool; the subagent called the stub once). Fixtures `claude-<ver>-subagent-two-blocks.json`.

- The PostToolUse hook fired for the subagent's call on both versions (once per run; the main agent made no call).
- Stdin adds `agent_id` (`aba3b2d7c9383daa5` on 2.1.318, `a9dfb364f21e98988` on 2.1.311) and
  `agent_type: "general-purpose"`; `session_id` and `transcript_path` are the parent session's.
- The relocation applied inside the subagent: its transcript (`<session>/subagents/agent-<id>.jsonl`) holds the
  edited two-block `tool_result` and a system turn `PostToolUse:mcp__codescout__edit_code hook additional context: [cs-verified] …`.

## Not measured

- Relocated context surviving compaction (spec "What is left to the builder"): no compaction was triggered.
- Behaviour under VS Code / Copilot hosts, and in interactive sessions (every run was `-p`, entrypoint `sdk-cli`).
- `--resume`, `/clear`, `--fork-session` effect on `CLAUDE_CODE_SESSION_ID` vs stdin `session_id`.
- Exit 0 with text on stderr; exit codes other than 0, 1 (prior probe) and 2.
- A `tool_response` that the CLI itself truncates or persists (large MCP results): the stub's results are small.
- Which variable switched on the extra stdin key `scratchpad_dir`, seen only in the two polluted runs (eight
  variables changed at once); the hook must not depend on an exact key set.

## Runs and cost

| Run | CLI | USD | wall s |
|---|---|---|---|
| v318-two-empty | 2.1.318 | 0.00108 | 4.8 |
| v318-one-empty | 2.1.318 | 0.00085 | 5.2 |
| v318-one-braces | 2.1.318 | 0.00087 | 5.1 |
| v318-two-relocate | 2.1.318 | 0.00096 | 5.7 |
| v318-mixed-relocate | 2.1.318 | 0.00111 | 6.1 |
| v318-two-timeout | 2.1.318 | 0.00087 | 6.5 |
| v318-two-exit2 | 2.1.318 | 0.00114 | 6.3 |
| v318-two-malformed | 2.1.318 | 0.00092 | 4.9 |
| v318-two-big | 2.1.318 | 0.00097 | 5.8 |
| v318-plugin-relocate | 2.1.318 | 0.00101 | 5.9 |
| v318-polluted-empty | 2.1.318 | 0.00109 | 4.9 |
| v318-subagent-relocate | 2.1.318 | 0.00440 | 11.0 |
| v311-two-empty | 2.1.311 | 0.00092 | 5.7 |
| v311-one-braces | 2.1.311 | 0.00088 | 5.4 |
| v311-two-relocate | 2.1.311 | 0.00102 | 6.1 |
| v311-mixed-relocate | 2.1.311 | 0.00121 | 6.7 |
| v311-two-timeout | 2.1.311 | 0.00090 | 6.6 |
| v311-two-exit2 | 2.1.311 | 0.00136 | 7.5 |
| v311-two-malformed | 2.1.311 | 0.00090 | 5.0 |
| v311-two-big | 2.1.311 | 0.00099 | 6.0 |
| v311-plugin-relocate | 2.1.311 | 0.00098 | 5.6 |
| v311-polluted-empty | 2.1.311 | 0.00111 | 5.0 |
| v311-subagent-relocate | 2.1.311 | 0.00374 | 11.4 |
| **total (23 runs)** | | **0.0293** | |
