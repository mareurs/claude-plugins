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
- The model's reply (2.1.318, runs `v318-plugin-relocate` and `v318-two-big`): "Yes, I saw text starting with `[cs-verified]`, but not in the tool's result blocks.
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
Do not use `AI_AGENT`, `CLAUDE_CODE_ENTRYPOINT` or `CLAUDE_PLUGIN_ROOT` (inherited, measured), nor `CLAUDECODE` alone
(constant). A mismatch fails closed: the hook prints nothing and the advice stays in the result.

What the measurements establish:

- On 2.1.318 and 2.1.311, in `-p` mode, the CLI writes its own `CLAUDE_CODE_SESSION_ID` over an inherited one. This
  was measured once per version, with the inherited value `polluted`, and with `--session-id` always passed
  (`run.sh`, the `ARGS=` line). The CLI also overwrites `CLAUDECODE`.
- The environment value equals stdin `session_id` for main-agent, plugin and subagent calls, in all 23 hook calls.
- One extra run by the reviewer of `51519f4` (`-p --resume <id>` without `--session-id`, USD 0.00141; reported in the
  review, not re-run here) kept the session id, with the environment value equal to stdin `session_id` and the same
  13 stdin keys.

What they do not establish:

- (Task 4, sections 7 to 10 below, measured `-p --resume`, `--fork-session` and an interactive `/clear` once per version.) Still unmeasured: interactive resume and fork, `--continue`, `claude --bg`, compaction.
- Whether an inherited value shaped like a UUID is overwritten or adopted (adoption would still be self-consistent).
- What VS Code or Copilot put in a hook's stdin and environment.
- Inference, not measured: a `CLAUDE_CODE_SESSION_ID` inherited by some other host's hook process would name a
  different session than that host's stdin.

**BINDING NOTE:** the real risk of this gate is a SILENT fail-closed. If an interactive session or `/clear` leaves the
environment id and the stdin id different, the feature never fires and nothing reports it. Task 4 must include at
least one interactive-mode, `/clear` or `--fork-session` run before the gate is called proven, or state in its results
that this was not measured.

**Update (Task 4, sections 7 to 10 below):** measured on both versions with the shipped script, each mode ONCE per version and with
one model (`claude-haiku-5-5`): `-p --resume`, `-p --fork-session`, an interactive session across `/clear` and a subagent call all kept
the environment id equal to stdin `session_id`, and the relocation applied. This REDUCES the risk of a silent fail-closed; it does
not remove it. Compaction, `--continue`, interactive resume and fork, `claude --bg`, VS Code, Copilot and other CLI versions remain
unmeasured.

## 5. Failure modes

All on the two-block stub; both versions gave the same outcome.

| Mode (run) | Stream `hook_response` | Result the model got | Shown to the model | Session |
|---|---|---|---|---|
| sleep 5 s with `"timeout": 2` (`v318-two-timeout`, `v311-two-timeout`) | `outcome: cancelled`, `exit_code: 1`, stdout empty | unchanged (advice in it) | nothing | continued; exit 0. The CLI cancelled the hook 2.05 s / 2.07 s after it started (evidenced: hook start time vs the `hook_cancelled` timestamp). When the process was killed is not evidenced: its post-sleep log line never appeared, so it did not survive its 5 s sleep, but the log cannot say whether it died at the 2 s cancel or later (the runs took 6.48 s / 6.59 s wall) |
| `exit 2` + stderr line (`v318-two-exit2`, `v311-two-exit2`) | `outcome: error`, `exit_code: 2`, stderr = the line | unchanged | **yes**: a system turn `PostToolUse:mcp__codescout__edit_code hook blocking error from command: "<full command line>": [<full command line>]: PROBE_EXIT2_STDERR_5M: text the probe hook wrote to stderr before exit 2`; the model mentioned it in its reply | continued; exit 0 |
| truncated JSON on stdout, exit 0 (`v318-two-malformed`, `v311-two-malformed`) | `outcome: success`, `exit_code: 0` | unchanged | nothing (the raw text is kept as a `hook_success` attachment in the transcript only) | continued; exit 0 |
| 2 MiB stdout: valid relocation JSON with 2 MiB of spaces between its two members (`v318-two-big`, `v311-two-big`) | `outcome: success`, all 2,097,708 bytes | relocated (advice removed) | the `[cs-verified]` context, as in Q3 | continued; exit 0; the transcript stored the whole stdout (2.15 MB transcript vs 57 KB for `two-relocate`) |

**DECISION (Q5):** every path exits 0 and writes nothing to stderr; exit 2 is the one mode that leaks hook text
(and the command line) to the model, so the hook must never use it. A timeout and malformed JSON both leave the
result unchanged and show nothing; keep the default hook timeout (a short `timeout` only costs the relocation).
Output size was not a CLI failure mode at 2 MiB, measured only with 2 MiB of whitespace padding inside valid JSON;
a 2 MiB `updatedToolOutput` or `additionalContext` was not measured. The CLI writes the hook's stdout verbatim into the transcript
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
- Behaviour under VS Code / Copilot hosts. Interactive sessions: every Task 1 run was `-p`, entrypoint `sdk-cli`; Task 4 measured one interactive session per version (section 9).
- `/clear`, `--fork-session` and interactive sessions vs the session-id equality: not measured in Task 1 (`-p --resume` only: one reviewer run, see Q4); measured once per version in Task 4, see section 9 (which also lists what stays unmeasured).
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


---

# End-to-end: the SHIPPED hook `cs-verified-relocate.mjs` on Claude Code 2.1.318 and 2.1.311

Measured 2026-11-05 (Task 4). 32 runs (16 on each version), USD 0.0357 for the 30 `-p` runs (the CLI's `result` event) and
USD 0.0051 for the 2 interactive runs. An interactive session has no `result` event; the `cost-state` rows of its two session
transcripts give 0.0016975 + 0.00099246 on 2.1.318 and 0.001428 + 0.00093197 on 2.1.311. For `-p` runs that row equals the result
cost (for example `e318-b-two` 0.00038952), so it is a reliable source. Total USD 0.0408 for the 32 runs. With Task 1's
23 runs (USD 0.0293) the plan has used 55 runs and USD 0.0701 of the 60 runs and USD 5 allowed. **Caps:** every `-p` run had
`--max-budget-usd 0.25` enforced by the CLI; the 2 interactive runs had NO CLI-enforced per-run cap (`--max-budget-usd` only works
with `--print`), only the fixed pty script bounded them. Every run: model
`claude-haiku-5-5`, the stub as MCP server `codescout`, the hook registered with the shipped
entry (matcher `mcp__codescout__.*`, command `node ${CLAUDE_PLUGIN_ROOT}/hooks/cs-verified-relocate.mjs`, `"timeout": 5`),
the CLI started with the explicit environment of Task 1 (token read inside `execve`, never on a command line). The script under
test is the file in this worktree (`codescout-companion/hooks/cs-verified-relocate.mjs` at `5da73fc`), reached through
symlinks, not a copy; only the `crash` runs use a copy with one line added. Nothing was installed in any profile; no profile
settings, install record or plugin cache was touched.

## 7. How the shipped hook was registered, and why not `--settings`

**A `--settings` hook cannot carry `${CLAUDE_PLUGIN_ROOT}`; the CLI refuses it.** The first run put the shipped command in
`--settings`, as planned. Run `e318-x-settings-refused` used a wrapper command containing `${CLAUDE_PLUGIN_ROOT}` and had
`CLAUDE_PLUGIN_ROOT` set in the CLI's environment (its `env-passed.txt` lists it); `e311-x-settings-refused` used the bare shipped
command and had no `CLAUDE_PLUGIN_ROOT` in its environment. Both were refused, so the refusal does not depend on that variable. The
committed `run.sh settingsref` writes the `e311` form only; the `e318` form came from an earlier state of the harness that was not
kept. Both versions: stream `hook_response`
`outcome: error`, `exit_code: 1`, stderr
`Failed to run: Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin. This variable is only available in hooks defined in a plugin's hooks/hooks.json file, not in settings.json. Command: …`;
the hook process never started (no log line), the result reached the model unchanged (advice in block 1), the run exited 0.
So the end-to-end runs register the hook as a **throwaway plugin passed with `--plugin-dir`** (the registration form Task 1 also
measured), one plugin per hook, whose `hooks/hooks.json` holds exactly the shipped entry. The plugin's `hooks/*.mjs` are symlinks
to the worktree's files, so `${CLAUDE_PLUGIN_ROOT}/hooks/cs-verified-relocate.mjs` is the shipped script, and node resolves
`./lib.mjs` and `./detect.mjs` to the real files. For logging, most runs wrap the command:
`python3 -I wrap_shipped.py <log> ${CLAUDE_PLUGIN_ROOT}/hooks/cs-verified-relocate.mjs shipped` runs `node <script>` with the same
stdin bytes and environment, writes stdin, stdout, stderr and exit code to `hook-log.jsonl`, and passes stdout, stderr and exit
code on unchanged. Control runs without the wrapper (`e318-x-exact`, `e311-x-exact`: the bare shipped entry, same plugin form)
gave `outcome: success`, `exit_code: 0`, the same model-visible result and the same `[cs-verified]` message as the wrapped
runs, so the wrapper changes nothing observable. This deviates from the planned `--settings` form for the reason above; it keeps
the literal command string.

Checked offline for the `shipped` runs with a script over the hook log (stdin blocks vs the printed `updatedToolOutput`, runs
`b-two` and `b-mixed` on both versions, `e318-f1-ours-standin`, `e311-f3-standin-ours`): the edited block equals the original minus
`advice`; every other block is identical to its stdin block (`[False, True]` for 2 blocks, `[False, True, True, True]` for 4); the
output has exactly the keys `hookEventName`, `updatedToolOutput`, `additionalContext`; the context starts `[cs-verified] `.

## 8. Case table (each case on both versions; run ids are `e318-…` and `e311-…`)

"Model-visible" is read as in Task 1: the `tool_result` the transcript recorded for the model, the system-role `api-request-blob`
messages, and the model's reply. Hook stdin keys in every `-p` main-agent call: the 13 of Task 1
(`cwd, duration_ms, effort, hook_event_name, mcp_server, permission_mode, prompt_id, session_id, tool_input, tool_name, tool_response, tool_use_id, transcript_path`).

| Case | Run | Expected | Observed (both versions unless noted) | Evidence |
|---|---|---|---|---|
| (a) no hook | `a-none` | advice stays in the result, the model sees it | no hook ran (no hook events, no log); block 1 still holds `"advice": {…, "verified": true}`; no `hook_additional_context` | 318 reply: "I did not see any text starting with `[cs-verified]`. The only "verified" appears as a JSON key (`"verified": true`) inside block 1" |
| (b) verified advice, 2 blocks | `b-two` | no `advice` in the result, block 2 intact, system message `[cs-verified] <text>` | hook: 513 bytes, exit 0, stderr empty; CLI `hook_response` `success`/0; `tool_result` = `[{"type":"text","text":"{\"status\":\"ok\",\"replaced_lines\":\"10-12\",\"hint\":\"HINT_KEEP_4K: …\"}"},{"type":"text","text":"SECOND_BLOCK_7Q: …"}]`; hint kept; one system-role message | system message (both): `PostToolUse:mcp__codescout__edit_code hook additional context: [cs-verified] verify callers: references(symbol="probe_fn_9v", path="src/lib.rs") \| \`probe_fn_9v\` is called by name in src/other.rs (a syntactic match, not resolved by the language server)`. 318 reply: "Yes, I saw text starting with `[cs-verified]`. It did not come from the tool's result. It appeared in a PostToolUse hook's additional context" |
| (b) text, text, image | `b-mixed` | all four blocks preserved in order | stdin had 4 blocks (the CLI's converted form, as in Task 1); hook printed 4; `tool_result` block types `[text, text, image, text]`, block 1 without `advice`, blocks 2 to 4 byte-identical to stdin, the CLI's `[Image: source: …]` text block last; same system message | 311 reply: "The tool returned four blocks. Here they are, in order: 1. Text …" and "That prefix appears only in a separate PostToolUse hook context message that followed the call" |
| (c) `verified:false` | `c-false` | result keeps its advice, no context | hook: 0 bytes, exit 0; `success`/0; `tool_result` block 1 still has `advice` with `"verified": false`; no `hook_additional_context` attachment; no hook system message | 318 reply: "I did not see any text starting with `[cs-verified]` anywhere in the result. The closest match is `"verified": false` in the advice object" |
| (d) hint only | `d-hintonly` | `hint` kept, nothing relocated | hook: 0 bytes, exit 0; result block 1 = `{"status": "ok", "replaced_lines": "10-12", "hint": "HINT_KEEP_4K: …"}` unchanged; no context | 318 reply: "I did not see any text starting with `[cs-verified]` in either block." |
| (d) hint plus verified advice | `b-two` (the stub's envelope has both) | `hint` kept, advice relocated | as (b): `hint` in the result, `advice` removed, context delivered | see (b) |
| (e) script crashes | `e-crash` | result unchanged, nothing shown, session unaffected | the copy throws on its first line: node exit 1, stack on stderr (`…/cs-verified-relocate.mjs:1 throw new Error("PROBE_CRASH_8K: cs-verified probe crash")`); CLI `hook_response` `outcome: error`, `exit_code: 1`; transcript attachment `hook_non_blocking_error` ("Failed with non-blocking status code: file:///…"); the `tool_result` still has the advice and both blocks; no api-request-blob carries the stack or any hook text; run exit 0 | 318 reply: "I did not see any text starting with `[cs-verified]` anywhere in the result"; it did not mention an error. Note: this throw happens before the script installs its handlers, so it exits 1 (non-blocking). A throw inside `main` is caught by the script's own handlers (exit 0); not run on the CLI here |
| (f1) ours registered first, stand-in second | `f1-ours-standin` | record the merge | both hooks ran (stand-in 99 bytes, ours 513, both exit 0); `updatedToolOutput` applied (no advice, hint kept, block 2 intact); one system-role message holding both contexts, stand-in text first: `PostToolUse:mcp__codescout__edit_code hook additional context: [cs-hint] stand-in\n\nPostToolUse:mcp__codescout__edit_code hook additional context: [cs-verified] verify callers: …`; no error | 318 reply: "The same hook context also included a line reading `[cs-hint] stand-in`." |
| (f2) stand-in only | `f2-standin` | `[cs-hint]` delivered, result untouched | result keeps advice; one message `… hook additional context: [cs-hint] stand-in` | 318 reply: "The only bracketed tag I saw was `[cs-hint] stand-in`, which came in a PostToolUse hook message rather than the tool's result." |
| (f3) opposite order: stand-in first, ours second | `f3-standin-ours` | same merge | identical to f1: both delivered in one message, stand-in first; ours applied | as f1 |
| (f4) stand-in registered first but slow (sleeps 1.5 s), ours second | `f4-slow-standin-first` | is the delivery order the registration order or the completion order | ours first, stand-in second (`[cs-verified] …` then `[cs-hint] stand-in`), both delivered, ours applied; in f1 and f3 (stand-in finishing first, whichever was registered first) the stand-in came first | 318 reply: "…The same hook context also included `[cs-hint] stand-in`." |
| (h) exact registered command, no wrapper | `x-exact` | same as (b) | `success`/0, relocation applied, one `[cs-verified]` message, same `tool_result` as `b-two` | transcript `hook_additional_context` `["[cs-verified] verify callers: …"]` |
| (h) subagent call | `h-subagent` | relocation inside a subagent | hook stdin has `agent_id` (`a8b1a95942ce922c2` on 318, `ab9a393132f7c5062` on 311), `agent_type: "general-purpose"`, the parent's `session_id`, 15 keys; env session id equals stdin `session_id`; the subagent's own transcript has the 2-block result without `advice` and the system message `PostToolUse:mcp__codescout__edit_code hook additional context: [cs-verified] verify callers: …` | `…/subagents/agent-<id>.jsonl` in each run's config dir |
| settings registration | `x-settings-refused` | (found while running) | see section 7: refused, fail-open | stderr text in section 7 |

**Coexistence, as measured (n=1 per arrangement per version: f1, f3 and f4 are the three two-hook arrangements; f2 has one hook).**
The other hook was a STAND-IN (a python script registered in its own plugin without a matcher, printing `additionalContext` only),
not the real `buddy` hook. In every two-hook sample the CLI ran both hooks and delivered both `additionalContext` strings, joined
in a single system-role message, each under the same prefix `PostToolUse:mcp__codescout__edit_code hook additional context: `
(the prefix names the tool, not the hook, so the model cannot tell which hook spoke), separated by a blank line. Our
`updatedToolOutput` applied in f1, f3 and f4 next to the stand-in's output, which did not disturb it; no error or warning appeared.
The order in the message matched the order in which the hooks finished in all 6 samples (f1 and f3: the stand-in first; f4, the
stand-in slowed by 1.5 s: ours first). The hooks' own clocks (ms after the first start; start/end as logged by the wrapper and the
stand-in): 2.1.318 f1 stand-in 2/3, ours 0/129; f3 stand-in 0/0, ours 5/682; f4 stand-in 0/1500, ours 7/54; 2.1.311 f1 stand-in
0/0, ours 5/56; f3 stand-in 0/0, ours 10/56; f4 stand-in 0/1500, ours 6/55. Our hook runs through a python wrapper that starts node
(about 40 to 50 ms more than the bare script), so in f1 and f3 the stand-in finishes first by construction and those two
arrangements cannot separate finishing order from other rules; f4 rules out registration order and a fixed stand-in-first order. The
"finishing order" rule is a fit to these samples, not a general property. Not measured: another hook that also prints
`updatedToolOutput` (then one would have to win), a hook that exits 2, more than two hooks, the real `buddy` hook.

## 9. (g) Host gate in other session modes

The question: does `CLAUDE_CODE_SESSION_ID` (hook environment) equal the hook's stdin `session_id`? Each row below is ONE run (n=1 per
mode per CLI version), one model (`claude-haiku-5-5`). Answered from the hook log of
each call. The shipped script's own gate decision is observable: the relocation applied (513 bytes printed, advice removed from the
model-visible result, `[cs-verified]` message present) in every row, so the gate passed in every row.

| Mode | Run | Session ids (stdin `session_id` / env `CLAUDE_CODE_SESSION_ID`) | Equal | Relocation applied |
|---|---|---|---|---|
| `-p`, new session (2.1.318) | `e318-b-two` | `b2f64709-bcf5-4378-86b9-4bbdd3316c00` / same | yes | yes |
| `-p --resume <id>` (318), config dir and cwd of `e318-b-two` reused | `e318-g-resume` | `b2f64709-…` / same (the id of the resumed session) | yes | yes (the new call: tool_result `ReqSy8`, no advice) |
| `-p --fork-session --resume <id>` (318) | `e318-g-fork` | `5f495581-99b4-4b56-ba54-07438622c521` / same: a NEW id, different from the resumed `b2f64709-…` | yes | yes (new call `v16MLM`, no advice) |
| interactive, before `/clear` (318) | `e318-g-interactive` | `a3f723e9-7041-494a-8813-14b898027779` / same | yes | yes |
| interactive, after `/clear` (318) | `e318-g-interactive` | `dc577845-9712-4de3-b60f-cce8024e18e0` / same: a new session id | yes | yes (that session's transcript: result without advice, system message present) |
| `-p`, new session (2.1.311) | `e311-b-two` | `59fffe58-822c-4300-885f-3bbddb06dd42` / same | yes | yes |
| `-p --resume` (311) | `e311-g-resume` | `59fffe58-…` / same | yes | yes |
| `-p --fork-session --resume` (311) | `e311-g-fork` | `47257a77-8139-483e-bfe4-aacd017ead24` / same (new id) | yes | yes |
| interactive, before `/clear` (311) | `e311-g-interactive` | `b5a62015-df5e-405a-bd03-9e7a9d149aa8` / same | yes | yes |
| interactive, after `/clear` (311) | `e311-g-interactive` | `0ee84d03-ef95-440d-9f8a-df4882c2785c` / same: a new session id | yes | yes |

The interactive runs were driven through a pty (`pty_drive.py`): onboarding and folder trust pre-accepted in a temporary
`CLAUDE_CONFIG_DIR/.claude.json`, prompt 1, `/clear`, prompt 2, `/exit`, no `-p`; steps in each run's `pty-steps.txt` (the CLI exited
with status 0 after `/exit`). In interactive mode the hook environment has `CLAUDE_CODE_ENTRYPOINT=cli` and
`CLAUDE_CODE_SESSION_ATTENDED=1` (against `sdk-cli` and `0` in `-p`), the stdin has 14 keys (the 13 plus `scratchpad_dir`, as
in Task 1's polluted runs) and `permission_mode` is `"auto"` (`"default"` in `-p`). Fixtures:
`claude-<ver>-interactive-after-clear.json` (stdin of the call after `/clear`), `claude-<ver>-hook-env-interactive-after-clear.json`,
`claude-<ver>-hook-env-fork.json`; also `claude-<ver>-root-verified-false.json` and `claude-<ver>-root-hint-only.json` (stdin of cases (c) and (d)).

The recorded `cmd.txt` of `e318-g-interactive` and `e311-g-interactive` is WRONG for those two runs: the first version of `run.sh` wrote it from
the `-p` argument list, so it shows `-p <prompt> ... --max-budget-usd 0.25 --output-format stream-json ...`, which the pty invocation
never passed. The CLI was started with `--model claude-haiku-5-5 --session-id <uuid> --setting-sources local --mcp-config <run>/mcp.json
--strict-mcp-config --settings <run>/settings.json --tools '' --allowedTools mcp__codescout__edit_code --plugin-dir <run>/plugin-0-shipped`
(no `-p`, no budget flag, hence no CLI-enforced cap on those two runs). Those run dirs are not rewritten; the committed `run.sh` now
writes the real argv for interactive runs and copies the post-`/clear` transcript itself.

`/clear` through `--input-format stream-json`: **not tried.** `claude --help` documents `--input-format` only as `"text"` or
`"stream-json"` (realtime streaming input) and says nothing about slash commands there, so by the task rule it was not attempted.

## 10. NOT measured

- Compaction persistence of the relocated context (neither `/compact` nor auto-compact was run).
- VS Code and Copilot hosts (everything here is the Claude Code CLI, entrypoints `sdk-cli` and `cli`).
- `--continue`, resume or fork of an interactive session, a session started by `claude --bg`.
- `/clear` via `--input-format stream-json` (not documented, not tried).
- The shipped `hooks.json` loaded as part of the real companion plugin: the registration entry was run verbatim from a throwaway
  plugin, so the other hooks of the companion, the plugin cache path and a release install were not part of any run.
- Another hook that also prints `updatedToolOutput`; more than two hooks; the `buddy` plugin's real hook (a stand-in was used).
- A throw inside `main` on the CLI and exit 0 with text on stderr from the shipped script.
- Any CLI version other than 2.1.318 and 2.1.311, and any model other than `claude-haiku-5-5`.
- The effect of the `[cs-verified]` text on the model's behaviour (the replies above only show the model saw it and, in these
  runs, did not act on it).
- Interactive run cost: the CLI shows no `result` event interactively, but each session transcript's `cost-state` row gives it:
  USD 0.0016975 + 0.00099246 (2.1.318) and 0.001428 + 0.00093197 (2.1.311), about USD 0.0051 for the two runs (section 11).

## 11. Runs and cost (Task 4)

| Run | CLI | USD | wall s |
|---|---|---|---|
| e318-x-settings-refused | 318 | 0.00115 | 6.4 |
| e318-b-two | 318 | 0.00039 | 6.8 |
| e318-b-mixed | 318 | 0.00119 | 6.8 |
| e318-c-false | 318 | 0.00096 | 6.5 |
| e318-d-hintonly | 318 | 0.00084 | 5.1 |
| e318-a-none | 318 | 0.00094 | 6.0 |
| e318-e-crash | 318 | 0.00093 | 5.9 |
| e318-x-exact | 318 | 0.00105 | 7.2 |
| e318-f1-ours-standin | 318 | 0.00100 | 6.9 |
| e318-f2-standin | 318 | 0.00097 | 8.2 |
| e318-f3-standin-ours | 318 | 0.00104 | 12.7 |
| e318-f4-slow-standin-first | 318 | 0.00098 | 7.7 |
| e318-g-fork | 318 | 0.00082 | 5.7 |
| e318-g-resume | 318 | 0.00071 | 5.3 |
| e318-g-interactive | 318 | 0.00269 (0.0016975 + 0.00099246, cost-state of the 2 sessions) | 36.7 |
| e318-h-subagent | 318 | 0.00448 | 15.9 |
| e311-b-two | 311 | 0.00100 | 7.0 |
| e311-b-mixed | 311 | 0.00124 | 7.2 |
| e311-c-false | 311 | 0.00091 | 6.2 |
| e311-d-hintonly | 311 | 0.00084 | 6.1 |
| e311-a-none | 311 | 0.00093 | 6.0 |
| e311-e-crash | 311 | 0.00098 | 7.2 |
| e311-x-exact | 311 | 0.00097 | 6.6 |
| e311-x-settings-refused | 311 | 0.00093 | 6.2 |
| e311-f1-ours-standin | 311 | 0.00102 | 6.7 |
| e311-f2-standin | 311 | 0.00102 | 6.6 |
| e311-f3-standin-ours | 311 | 0.00096 | 6.2 |
| e311-f4-slow-standin-first | 311 | 0.00101 | 8.4 |
| e311-g-fork | 311 | 0.00146 | 6.0 |
| e311-g-resume | 311 | 0.00133 | 5.9 |
| e311-g-interactive | 311 | 0.00236 (0.001428 + 0.00093197, cost-state of the 2 sessions) | 36.4 |
| e311-h-subagent | 311 | 0.00367 | 14.4 |
| **total (32 runs; 30 from `result` events, 2 interactive from `cost-state`)** | | **0.0408** | |

With Task 1: 55 runs, USD 0.0701 (Task 4: 0.0357 from the `result` events of the 30 `-p` runs plus 0.0051 from the `cost-state` rows of the 2 interactive runs = 0.0408; Task 1: 0.0293).
