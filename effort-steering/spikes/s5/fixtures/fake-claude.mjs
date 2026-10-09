#!/usr/bin/env node
// fake-claude.mjs — a scripted stand-in for the Claude Code binary, for the S5 runOne tests. It never starts a model, never reads
// the network and never looks at the prompt except to copy it into the transcript. It writes what a real headless run
// (`claude -p ... --session-id <uuid> --output-format json -- <prompt>`) leaves behind:
//
//   * the transcript  $CLAUDE_CONFIG_DIR/projects/-work/<sessionId>.jsonl   (and subagent transcripts beside it)
//   * the hook's decision log  $XDG_STATE_HOME/effort-steering/<sessionId>.jsonl
//   * one JSON object on stdout (the --output-format json result)
//   * edits to files under its working directory (and under $CARGO_TARGET_DIR)
//
// It is meant to run through fake-docker.mjs's `run.exec`, which maps the container's paths to the bound host directories, so
// CLAUDE_CONFIG_DIR, XDG_STATE_HOME and the working directory are host directories here. A scenario is JSON in the environment
// variable FAKE_CLAUDE; every key is optional, and {} is a good run: the prompt as the first user message, the effort of --effort on
// every assistant record, a decision log that matches EFFORT_STEERING_HOLDOUT_RATE ('0' treated and steered, anything else holdout),
// a result object, exit 0.
//
//   edit         { "<path under the working directory>": "<text>" }       files the "agent" writes into /work
//   editTarget   { "<path under $CARGO_TARGET_DIR>": "<text>" }           files it writes into the warm-target copy
//   transcript   true (default) | false (none) | "directory" (a directory where the file belongs: it exists and cannot be read) |
//                "twice" (the same session file under two project directories)
//   effort       the effort recorded on every assistant record; null records none. Default: the --effort argument
//   efforts      [..] the effort of the i-th assistant record in turn (the last repeats); overrides `effort`
//   firstUser    the first user message. Default: the prompt argument
//   bash         ["cargo test", ..] one Bash tool_use per command, before the final text
//   finalText    the final assistant text (default "Done.")
//   apiError     true: an API-error record in the main transcript
//   subagents    [{ "name": "agent-x", "apiError": false, "effort": ".." }]   subagent transcripts
//   decision     "auto" (default) | null (no log) | an object | a list of objects and raw strings, one log line each
//   decisionSession   the session id in the log's file name (default: the session id)
//   decisionLink      true: the log is a symlink to a file that holds the line
//   result       an object merged over the default result { type, subtype, is_error, num_turns, total_cost_usd, session_id, result }
//   stdoutRaw    a string printed instead of the result object
//   exit         the exit status (default 0)

import {
  mkdirSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const dashes = args.indexOf('--');
const prompt = dashes === -1 ? undefined : args[dashes + 1];
const sessionId = flag('--session-id');
const model = flag('--model');
const effortArg = flag('--effort');
const configDir = process.env.CLAUDE_CONFIG_DIR;
const stateHome = process.env.XDG_STATE_HOME;
if (!sessionId || !effortArg || prompt === undefined || !configDir || !stateHome) {
  process.stderr.write('fake-claude: needs --session-id, --effort, `-- <prompt>`, CLAUDE_CONFIG_DIR and XDG_STATE_HOME\n');
  process.exit(64);
}
const scenario = JSON.parse(process.env.FAKE_CLAUDE ?? '{}');
const has = (key) => Object.hasOwn(scenario, key);
const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const jsonl = (records) => records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

// ---- the transcript ----

let messages = 0;
const efforts = has('efforts') ? scenario.efforts : [has('effort') ? scenario.effort : effortArg];
const effortOf = (i) => efforts[Math.min(i, efforts.length - 1)];
const usageOf = (n) => ({
  input_tokens: 10, output_tokens: 100 + n, cache_creation_input_tokens: 200, cache_read_input_tokens: 5000, output_tokens_details: { thinking_tokens: 40 },
});
function assistant(content, { prefix = 'msg', sidechain = false } = {}) {
  const i = messages++;
  const effort = effortOf(i);
  return {
    type: 'assistant',
    ...(effort === null ? {} : { effort }),
    ...(sidechain ? { isSidechain: true } : {}),
    message: { id: `${prefix}_${i + 1}`, role: 'assistant', model: model ?? 'fake-model', content, usage: usageOf(i) },
    sessionId,
  };
}
const apiErrorRecord = () => ({
  type: 'assistant', isApiErrorMessage: true, message: { id: 'msg_api_error', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: 529 overloaded' }], usage: { input_tokens: 0, output_tokens: 0 } }, sessionId,
});

const records = [{ type: 'user', message: { role: 'user', content: has('firstUser') ? scenario.firstUser : prompt }, sessionId }];
(scenario.bash ?? []).forEach((command, i) => {
  records.push(assistant([{ type: 'tool_use', id: `toolu_${i + 1}`, name: 'Bash', input: { command } }]));
  records.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i + 1}`, content: 'ok' }] }, sessionId });
});
const finalText = scenario.finalText ?? 'Done.';
records.push(assistant([{ type: 'text', text: finalText }]));
if (scenario.apiError === true) records.push(apiErrorRecord());

const mode = has('transcript') ? scenario.transcript : true;
const slugDir = (slug) => join(configDir, 'projects', slug);
if (mode === true || mode === 'twice') {
  for (const slug of mode === 'twice' ? ['-work', '-other'] : ['-work']) write(join(slugDir(slug), `${sessionId}.jsonl`), jsonl(records));
} else if (mode === 'directory') {
  mkdirSync(join(slugDir('-work'), `${sessionId}.jsonl`), { recursive: true });
}

// Subagent transcripts live beside the session's, under <session id>/subagents/.
(scenario.subagents ?? []).forEach((sub, i) => {
  const n = messages++;
  const effort = Object.hasOwn(sub, 'effort') ? sub.effort : effortArg;
  const record = {
    type: 'assistant', ...(effort === null ? {} : { effort }), isSidechain: true,
    message: { id: `msg_sub_${i + 1}`, role: 'assistant', model: model ?? 'fake-model', content: [{ type: 'text', text: 'subagent finding' }], usage: usageOf(n) },
    sessionId,
  };
  const lines = sub.apiError === true ? [record, apiErrorRecord()] : [record];
  write(join(slugDir('-work'), sessionId, 'subagents', `${sub.name ?? `agent-${i + 1}`}.jsonl`), jsonl(lines));
});

// ---- the decision log ----

const rate = process.env.EFFORT_STEERING_HOLDOUT_RATE;
const auto = rate === '0' ? { arm: 'treated', steered: true } : { arm: 'holdout', steered: false };
const decision = has('decision') && scenario.decision !== 'auto' ? scenario.decision : auto;
if (decision !== null) {
  const lines = [].concat(decision).map((d) => (typeof d === 'string' ? d : { session_id: sessionId, turn_id: 'turn-1', harness: 'claude-code', ...d }));
  const logFile = join(stateHome, 'effort-steering', `${scenario.decisionSession ?? sessionId}.jsonl`);
  if (scenario.decisionLink === true) {
    const real = join(stateHome, 'real-decision.jsonl');
    write(real, jsonl(lines));
    mkdirSync(dirname(logFile), { recursive: true });
    symlinkSync(real, logFile);
  } else {
    write(logFile, jsonl(lines));
  }
}

// ---- the work ----

for (const [rel, text] of Object.entries(scenario.edit ?? {})) write(join(process.cwd(), rel), text);
for (const [rel, text] of Object.entries(scenario.editTarget ?? {})) write(join(process.env.CARGO_TARGET_DIR, rel), text);

// ---- stdout and exit ----

if (typeof scenario.stdoutRaw === 'string') {
  process.stdout.write(scenario.stdoutRaw);
} else {
  const result = {
    type: 'result', subtype: 'success', is_error: false, num_turns: 7, total_cost_usd: 0.4321, session_id: sessionId, result: finalText, ...(scenario.result ?? {}),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
process.exit(scenario.exit ?? 0);
