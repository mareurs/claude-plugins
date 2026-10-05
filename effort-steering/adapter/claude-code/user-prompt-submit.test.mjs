// Tests for the UserPromptSubmit hook entry. Exit code and stdout are the protocol, so
// they are tested at process level; the rest goes through `handle`.
//
// In Claude Code, exit 2 from this hook BLOCKS and ERASES the user's prompt, and any
// stray stdout is read as hook output. Both are pinned here.

import assert from 'node:assert/strict';
import { closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { handle } from './user-prompt-submit.mjs';

const ES = fileURLToPath(new URL('../..', import.meta.url));
const HOOK_REL = path.join('adapter', 'claude-code', 'user-prompt-submit.mjs');
const REAL_HOOK = path.join(ES, HOOK_REL);
const FIXTURE_TEXT = readFileSync(new URL('./fixtures/hook-input.json', import.meta.url), 'utf8');
const FIXTURE = JSON.parse(FIXTURE_TEXT);
const SHALLOW = 'Answer directly without deliberating.';

const ROOT = mkdtempSync(path.join(os.tmpdir(), 'ups-test-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

const rule = (over = {}) => ({ id: 'r-shallow', level: 'shallow', confidence: 'high', reason: 'test', when: { minChars: 0 }, ...over });
const freshState = () => mkdtempSync(path.join(ROOT, 'state-'));

// A copy of the whole effort-steering/ tree. The copy's hook script resolves the copy's CLI
// and the copy's rules through import.meta.url.
function copyTree({ rules, cliSource } = {}) {
  const tree = mkdtempSync(path.join(ROOT, 'tree-'));
  cpSync(ES, tree, { recursive: true });
  if (rules !== undefined) writeFileSync(path.join(tree, 'core', 'rules.json'), JSON.stringify({ version: 3, rules }));
  if (cliSource !== undefined) writeFileSync(path.join(tree, 'bin', 'effort-policy.mjs'), cliSource);
  return { tree, hook: path.join(tree, HOOK_REL), cli: path.join(tree, 'bin', 'effort-policy.mjs') };
}

function runHook(hook, input, { env = {}, stdio } = {}) {
  const res = spawnSync(process.execPath, [hook], {
    input: stdio ? undefined : input,
    stdio,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const stub = (result) => `console.log(${JSON.stringify(JSON.stringify(result))});\n`;
const result = (over = {}) => ({ level: 'default', confidence: 'low', reasons: [], steer: null, arm: 'treated', ...over });

const ALL_FOR_SHALLOW = copyTree({ rules: [rule()] });

t('a matching rule: stdout is exactly one JSON line carrying the steer, exit 0', () => {
  const res = runHook(ALL_FOR_SHALLOW.hook, FIXTURE_TEXT, { env: { XDG_STATE_HOME: freshState() } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(
    res.stdout,
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: SHALLOW } })}\n`,
  );
  assert.equal(res.stderr, '');
});

t('the shipped empty rules: stdout is empty, exit 0', () => {
  const res = runHook(REAL_HOOK, FIXTURE_TEXT, { env: { XDG_STATE_HOME: freshState() } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '');
});

t('ultrathink: user_override adds no second sentence, stdout is empty', () => {
  const input = JSON.stringify({ ...FIXTURE, prompt: 'ultrathink about x' });
  const res = runHook(ALL_FOR_SHALLOW.hook, input, { env: { XDG_STATE_HOME: freshState() } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '');
});

t('bad stdin (broken JSON, empty, an array, a string, null): stdout empty, exit 0', () => {
  for (const input of ['{oops', '', '[]', '"x"', 'null', '   ']) {
    const res = runHook(ALL_FOR_SHALLOW.hook, input, { env: { XDG_STATE_HOME: freshState() } });
    assert.equal(res.status, 0, `${JSON.stringify(input)}: ${res.stderr}`);
    assert.equal(res.stdout, '', JSON.stringify(input));
    assert.deepEqual(handle(input, {}), { output: null, alerts: [] }, JSON.stringify(input));
  }
});

t('a stdin that cannot be read at all (a directory) still ends in exit 0 with no stdout', () => {
  const fd = openSync(ROOT, 'r');
  try {
    const res = runHook(REAL_HOOK, undefined, { stdio: [fd, 'pipe', 'pipe'] });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '');
  } finally {
    closeSync(fd);
  }
});

t('a CLI that sleeps: handle reports adapter_timeout (tiny timeout), no output', () => {
  const { cli } = copyTree({ cliSource: "process.on('SIGTERM', () => {}); setTimeout(() => {}, 5000);\n" });
  const out = handle(FIXTURE_TEXT, {}, { cliPath: cli, timeoutMs: 200 });
  assert.equal(out.output, null);
  assert.ok(out.alerts.includes('adapter_timeout'), JSON.stringify(out));
});

t('a CLI that sleeps, at process level with the real timeout: exit 0, no stdout, alert on stderr', () => {
  const { hook } = copyTree({ cliSource: "process.on('SIGTERM', () => {}); setTimeout(() => {}, 6000);\n" });
  const res = runHook(hook, FIXTURE_TEXT, { env: { XDG_STATE_HOME: freshState() } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, 'effort-steering: adapter_timeout\n');
});

t('Review Focus 1: a 200 KB prompt finishes inside the timeout and steers', () => {
  const state = freshState();
  const input = JSON.stringify({ ...FIXTURE, prompt: 'x '.repeat(100 * 1024) });
  assert.ok(input.length > 200 * 1024);
  const start = Date.now();
  const res = runHook(ALL_FOR_SHALLOW.hook, input, { env: { XDG_STATE_HOME: state } });
  const elapsed = Date.now() - start;
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!/adapter_/.test(res.stderr), res.stderr);
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, SHALLOW);
  assert.equal(readdirSync(path.join(state, 'effort-steering')).length, 1);
});

t('Review Focus 2: an unwritable state dir still steers, says log_failed on stderr, exit 0', () => {
  const notADir = path.join(ROOT, 'regular-file');
  writeFileSync(notADir, 'x');
  const res = runHook(ALL_FOR_SHALLOW.hook, FIXTURE_TEXT, { env: { XDG_STATE_HOME: notADir } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, SHALLOW);
  assert.ok(res.stderr.split('\n').includes('effort-steering: log_failed'), res.stderr);
});

t('Review Focus 3: no prompt_id means a decision, a log_skipped_no_ids alert and no log file', () => {
  const state = freshState();
  const { prompt_id, ...noId } = FIXTURE;
  const res = runHook(ALL_FOR_SHALLOW.hook, JSON.stringify(noId), { env: { XDG_STATE_HOME: state } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, SHALLOW);
  assert.ok(res.stderr.split('\n').includes('effort-steering: log_skipped_no_ids'), res.stderr);
  assert.deepEqual(readdirSync(state), []);
  const out = handle(JSON.stringify(noId), {}, { cliPath: ALL_FOR_SHALLOW.cli });
  assert.ok(out.alerts.includes('log_skipped_no_ids'));
});

t('a rules file with one bad rule adds a rules_skipped alert, and the good rule still steers', () => {
  const { hook, cli } = copyTree({ rules: [rule(), rule({ id: 'bad', when: { matchesAny: ['('] } })] });
  const state = freshState();
  const res = runHook(hook, FIXTURE_TEXT, { env: { XDG_STATE_HOME: state } });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stderr.split('\n').includes('effort-steering: rules_skipped:bad:invalid_regex'), res.stderr);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, SHALLOW);
  const out = handle(FIXTURE_TEXT, {}, { cliPath: cli });
  assert.deepEqual(out.alerts, ['rules_skipped:bad:invalid_regex']);
});

t('two concurrent runs with different session_id make two files, one line each', () => {
  const state = freshState();
  const files = ['a', 'b'].map((id) => {
    const f = path.join(ROOT, `in-${id}.json`);
    writeFileSync(f, JSON.stringify({ ...FIXTURE, session_id: `sess-${id}`, prompt_id: `p-${id}` }));
    return f;
  });
  const node = JSON.stringify(process.execPath);
  const hook = JSON.stringify(ALL_FOR_SHALLOW.hook);
  const script = files.map((f) => `${node} ${hook} < ${JSON.stringify(f)} > /dev/null &`).join('\n') + '\nwait\n';
  const res = spawnSync('sh', ['-c', script], { env: { ...process.env, XDG_STATE_HOME: state }, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const dir = path.join(state, 'effort-steering');
  assert.deepEqual(readdirSync(dir).sort(), ['sess-a.jsonl', 'sess-b.jsonl']);
  for (const name of readdirSync(dir)) {
    const raw = readFileSync(path.join(dir, name), 'utf8');
    assert.equal(raw.slice(0, -1).split('\n').length, 1, name);
    JSON.parse(raw);
  }
});

t('no stderr line and no log line holds a probe substring of the prompt', () => {
  const probe = 'PROBE-SECRET-4412-zq';
  const state = freshState();
  const { prompt_id, ...noId } = FIXTURE;
  const bad = copyTree({ rules: [rule(), rule({ id: 'bad', when: { matchesAny: ['('] } })] });
  const runs = [
    runHook(ALL_FOR_SHALLOW.hook, JSON.stringify({ ...FIXTURE, prompt: `${probe} rename` }), { env: { XDG_STATE_HOME: state } }),
    runHook(ALL_FOR_SHALLOW.hook, JSON.stringify({ ...noId, prompt: `${probe} rename` }), { env: { XDG_STATE_HOME: state } }),
    runHook(bad.hook, JSON.stringify({ ...FIXTURE, prompt: `${probe} rename` }), { env: { XDG_STATE_HOME: state } }),
    runHook(ALL_FOR_SHALLOW.hook, JSON.stringify({ ...FIXTURE, prompt: `${probe} rename` }), { env: { XDG_STATE_HOME: path.join(ROOT, 'regular-file') } }),
  ];
  assert.ok(runs.some((r) => r.stderr.length > 0), 'the probe is only meaningful if stderr was used');
  for (const r of runs) {
    assert.equal(r.status, 0);
    assert.ok(!r.stderr.includes(probe), r.stderr);
    assert.ok(!r.stderr.includes('rename'), r.stderr);
  }
  const dir = path.join(state, 'effort-steering');
  for (const name of readdirSync(dir)) {
    const raw = readFileSync(path.join(dir, name), 'utf8');
    assert.ok(!raw.includes(probe), name);
  }
});

t('stdout hygiene: a CLI that is noisy on stdout and stderr leaks nothing into the hook stdout', () => {
  const noisy = `console.error('SECRET-DEBUG'); console.log(${JSON.stringify(JSON.stringify(result()))});\n`;
  const { hook } = copyTree({ cliSource: noisy });
  const res = runHook(hook, FIXTURE_TEXT, { env: { XDG_STATE_HOME: freshState() } });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.ok(!res.stderr.includes('SECRET-DEBUG'), res.stderr);
});

t('steer that is neither a string nor null (123, {}, true) gives no output and adapter_bad_output', () => {
  for (const steer of [123, {}, true, ['x']]) {
    const { cli } = copyTree({ cliSource: stub(result({ steer })) });
    assert.deepEqual(handle(FIXTURE_TEXT, {}, { cliPath: cli }), { output: null, alerts: ['adapter_bad_output'] }, JSON.stringify(steer));
  }
});

t('an empty steer string gives no output and no alert', () => {
  const { cli } = copyTree({ cliSource: stub(result({ steer: '' })) });
  assert.deepEqual(handle(FIXTURE_TEXT, {}, { cliPath: cli }), { output: null, alerts: [] });
});

t('a null steer gives no output (a held-out turn is silent)', () => {
  const { cli } = copyTree({ cliSource: stub(result({ steer: null, arm: 'holdout' })) });
  assert.deepEqual(handle(FIXTURE_TEXT, {}, { cliPath: cli }), { output: null, alerts: [] });
});

t('a string steer gives exactly the hookSpecificOutput object', () => {
  const { cli } = copyTree({ cliSource: stub(result({ steer: 'S' })) });
  assert.deepEqual(handle(FIXTURE_TEXT, {}, { cliPath: cli }), {
    output: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'S' } },
    alerts: [],
  });
});

t('alerts: exactly the alert reasons, in order; decision reasons are not alerts', () => {
  const reasons = [
    'user_override', 'no_rule', 'r-shallow', 'guard_shallow',
    'unknown_arg', 'bad_holdout_rate', 'rules_unreadable', 'rules_skipped:x:invalid_regex', 'table_unreadable',
    'log_skipped_no_ids', 'log_failed', 'adapter_timeout', 'adapter_cli_failed', 'adapter_bad_output',
    'bad_input', 'internal_error',
  ];
  const { cli } = copyTree({ cliSource: stub(result({ reasons })) });
  assert.deepEqual(handle(FIXTURE_TEXT, {}, { cliPath: cli }).alerts, [
    'unknown_arg', 'bad_holdout_rate', 'rules_unreadable', 'rules_skipped:x:invalid_regex', 'table_unreadable',
    'log_skipped_no_ids', 'log_failed', 'adapter_timeout', 'adapter_cli_failed', 'adapter_bad_output',
  ]);
});

t('the holdout rate env reaches the CLI as --holdout-rate; absent, no flag is passed', () => {
  const rules = [rule()];
  const { cli } = copyTree({ rules });
  const base = { ...FIXTURE };
  const run = (env) => handle(JSON.stringify(base), env, { cliPath: cli });
  assert.ok(run({}).output !== null, 'absent: steered');
  assert.equal(run({ EFFORT_STEERING_HOLDOUT_RATE: '0' }).output !== null, true, 'rate 0 steers');
  assert.deepEqual(run({ EFFORT_STEERING_HOLDOUT_RATE: '1' }), { output: null, alerts: [] }, 'rate 1 holds the turn out');
  assert.deepEqual(run({ EFFORT_STEERING_HOLDOUT_RATE: 'abc' }), { output: null, alerts: ['bad_holdout_rate'] });
});

t('the CLI is called with --log and nothing else when no env is set', () => {
  const echo = `const a = process.argv.slice(2).join(' '); console.log(JSON.stringify({level:'default',confidence:'low',reasons:[],steer:a,arm:'treated'}));\n`;
  const { cli } = copyTree({ cliSource: echo });
  assert.equal(handle(FIXTURE_TEXT, {}, { cliPath: cli }).output.hookSpecificOutput.additionalContext, 'decide --log');
  const withRate = handle(FIXTURE_TEXT, { EFFORT_STEERING_HOLDOUT_RATE: '0.25' }, { cliPath: cli });
  assert.equal(withRate.output.hookSpecificOutput.additionalContext, 'decide --log --holdout-rate 0.25');
});

t('R8: handle never throws, whatever the pipeline does', () => {
  const hostile = { toString() { throw new Error('boom'); } };
  const internal = { output: null, alerts: ['adapter_internal_error'] };
  assert.deepEqual(handle(hostile, {}), { output: null, alerts: [] }, 'unparseable stdin is silent, not an internal error');
  assert.deepEqual(handle(FIXTURE_TEXT, null), internal);
  const throwingEnv = { get EFFORT_STEERING_HOLDOUT_RATE() { throw new Error('boom'); } };
  assert.deepEqual(handle(FIXTURE_TEXT, throwingEnv), internal);
});
