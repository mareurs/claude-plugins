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
//   apiErrorText the text of that record (default "API Error: 529 overloaded"); R-PL3's tests make it a plan-limit refusal or the real 401 text
//   subagents    [{ "name": "agent-x", "apiError": false, "effort": ".." }]   subagent transcripts
//   steer        "auto" (default: arm B, EFFORT_STEERING_HOLDOUT_RATE '0', gets ONE UserPromptSubmit hook context holding the shipped shallow phrase
//                of core/steer.table.json, as the real hook writes it; A and C get none) | null (none) | a list, one hook context each: a string
//                (content a string), a list of strings (content a list, the real shape) or an object { attachment } (written as it is)
//   steerLate    a list in the same shapes as `steer` (default none): the hook contexts are written AFTER the first assistant record, as Claude Code
//                does for a queued task-notification (R-ST1: such a context did not reach the model on its first turn)
//   decision     "auto" (default) | null (no log) | an object | a list of objects and raw strings, one log line each
//   decisionSession   the session id in the log's file name (default: the session id)
//   decisionLink      true: the log is a symlink to a file that holds the line
//   result       an object merged over the default result { type, subtype, is_error, num_turns, total_cost_usd, session_id, result }
//   stdoutRaw    a string printed instead of the result object
//   stderrRaw    a string printed on stderr (review 2, X5: runOne does not read the container's stderr)
//   {{TOKEN}}    anywhere in the scenario's text (a value or a key) is replaced by the value of CLAUDE_CODE_OAUTH_TOKEN before the scenario is read, so
//                a test can make the "agent" print the token (in a refusal, in the result) without writing it into the scenario it passes
//   exit         the exit status (default 0)
//   leak         true: a tool-result record in the main transcript that prints the token, as `env` would (the file holds the token)
//   configFiles / stateFiles   { "<path under $CLAUDE_CONFIG_DIR / $XDG_STATE_HOME>": "<text>" | { text, mtime?, mode? } } more files; the
//                text, and the path, may hold {{TOKEN}} (replaced for the whole scenario, above); mtime is an ISO date, mode a number
//   configLinks  { "<path under $CLAUDE_CONFIG_DIR>": "<target>" } symlinks (to a file or a directory anywhere)

import {
  chmodSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync,
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
const TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
const scenario = JSON.parse((process.env.FAKE_CLAUDE ?? '{}').replaceAll('{{TOKEN}}', TOKEN));
const has = (key) => Object.hasOwn(scenario, key);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
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
const apiErrorRecord = (text = 'API Error: 529 overloaded') => ({
  type: 'assistant', isApiErrorMessage: true, message: { id: 'msg_api_error', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } }, sessionId,
});

const records = [{ type: 'user', message: { role: 'user', content: has('firstUser') ? scenario.firstUser : prompt }, sessionId }];
// The hook's context as Claude Code 2.1.292 records it (measured on real S4 transcripts): an attachment record of type hook_additional_context,
// hookEvent UserPromptSubmit, content a list holding the steer. The auto value is the shipped shallow phrase, read from the table.
const shipped = JSON.parse(readFileSync(new URL('../../../core/steer.table.json', import.meta.url), 'utf8')).phrases.shallow;
const steerContexts = has('steer') && scenario.steer !== 'auto' ? (scenario.steer ?? []) : (process.env.EFFORT_STEERING_HOLDOUT_RATE === '0' ? [[shipped]] : []);
const steerRecord = (content, id) => ({
  type: 'attachment',
  attachment: isPlainObject(content)
    ? content.attachment
    : { type: 'hook_additional_context', hookEvent: 'UserPromptSubmit', hookName: 'UserPromptSubmit:steer', toolUseID: id, content },
  sessionId,
});
steerContexts.forEach((content, i) => records.push(steerRecord(content, `toolu_hook_${i + 1}`)));
if (scenario.leak === true) {
  records.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_env', content: `CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}` }] }, sessionId });
}
(scenario.bash ?? []).forEach((command, i) => {
  records.push(assistant([{ type: 'tool_use', id: `toolu_${i + 1}`, name: 'Bash', input: { command } }]));
  records.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i + 1}`, content: 'ok' }] }, sessionId });
});
const finalText = scenario.finalText ?? 'Done.';
records.push(assistant([{ type: 'text', text: finalText }]));
// R-ST1: `steerLate` contexts go straight after the first assistant record (the main transcript's), never before it.
if (Array.isArray(scenario.steerLate)) {
  records.splice(records.findIndex((r) => r.type === 'assistant') + 1, 0, ...scenario.steerLate.map((content, i) => steerRecord(content, `toolu_hook_late_${i + 1}`)));
}
if (scenario.apiError === true) records.push(apiErrorRecord(scenario.apiErrorText));

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

// ---- more files under the config and state directories, and links ----

for (const [base, files] of [[configDir, scenario.configFiles], [stateHome, scenario.stateFiles]]) {
  for (const [rel, spec] of Object.entries(files ?? {})) {
    const { text, mtime, mode } = typeof spec === 'string' ? { text: spec } : spec;
    const file = join(base, rel);
    write(file, text);
    if (mtime !== undefined) utimesSync(file, new Date(mtime), new Date(mtime));
    if (mode !== undefined) chmodSync(file, mode);
  }
}
for (const [rel, target] of Object.entries(scenario.configLinks ?? {})) {
  mkdirSync(dirname(join(configDir, rel)), { recursive: true });
  symlinkSync(target, join(configDir, rel));
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
if (typeof scenario.stderrRaw === 'string') process.stderr.write(scenario.stderrRaw);
process.exit(scenario.exit ?? 0);
