import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'scribe-nudge.mjs');

// Runs the hook as Claude Code does: JSON on stdin, a marker directory of its own.
function run(payload, env = {}, stateDir) {
  const dir = stateDir ?? mkdtempSync(join(tmpdir(), 'scribe-nudge-'));
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const r = spawnSync('node', [SCRIPT], {
    input: raw,
    encoding: 'utf8',
    env: { ...process.env, CS_SCRIBE_STATE_DIR: dir, ...env },
  });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  return { out: r.stdout, dir };
}

const call = (command, extra = {}) => ({
  session_id: 's-1',
  cwd: '/work/repo',
  tool_name: 'Bash',
  tool_input: { command },
  ...extra,
});
const ADD = 'codescout box bugs add --title "x"';

test('the first box write of the main agent is refused with the scribe recipe', () => {
  const { out, dir } = run(call(ADD));
  const o = JSON.parse(out).hookSpecificOutput;
  assert.equal(o.hookEventName, 'PreToolUse');
  assert.equal(o.permissionDecision, 'deny');
  assert.ok(o.permissionDecisionReason.includes("get_guide('scribe')"));
  rmSync(dir, { recursive: true, force: true });
});

test('the same refusal comes through codescout run_command', () => {
  const { out, dir } = run(call(ADD, { tool_name: 'mcp__codescout__run_command' }));
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
  rmSync(dir, { recursive: true, force: true });
});

test('a repeat of the call in the same session passes', () => {
  const first = run(call(ADD));
  assert.notEqual(first.out, '');
  const second = run(call(ADD), {}, first.dir);
  assert.equal(second.out, '');
  rmSync(first.dir, { recursive: true, force: true });
});

test('a fork or subagent (agent_id present) is never refused and leaves no marker', () => {
  const { out, dir } = run(call(ADD, { agent_id: 'a1' }));
  assert.equal(out, '');
  assert.deepEqual(readdirSync(dir), []);
  rmSync(dir, { recursive: true, force: true });
});

test('calls that are not a box write pass', () => {
  for (const payload of [
    call('codescout box bugs list'),
    call('ls -la'),
    call(ADD, { tool_name: 'Read' }),
    call(ADD, { tool_input: {} }),
    '',
    'not json',
  ]) {
    const { out, dir } = run(payload);
    assert.equal(out, '', JSON.stringify(payload));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CS_SCRIBE_NUDGE=false turns the hook off', () => {
  const { out, dir } = run(call(ADD), { CS_SCRIBE_NUDGE: 'false' });
  assert.equal(out, '');
  rmSync(dir, { recursive: true, force: true });
});

test('the marker is per session: another session is refused again', () => {
  const first = run(call(ADD));
  const other = run(call(ADD, { session_id: 's-2' }), {}, first.dir);
  assert.notEqual(other.out, '');
  rmSync(first.dir, { recursive: true, force: true });
});

test('after the window a new refusal comes', async () => {
  const first = run(call(ADD), { CS_SCRIBE_WINDOW_MS: '1' });
  assert.notEqual(first.out, '');
  await new Promise((r) => setTimeout(r, 30));
  const again = run(call(ADD), { CS_SCRIBE_WINDOW_MS: '1' }, first.dir);
  assert.notEqual(again.out, '');
  rmSync(first.dir, { recursive: true, force: true });
});

test('a marker that cannot be written lets the call through', () => {
  const { out } = run(call(ADD), {}, '/dev/null/cannot-be-a-directory');
  assert.equal(out, '');
});

// --- Experiment arms (CS_SCRIBE_VARIANT). The loser arms are deleted after the decision. ---

const CLOSE = 'codescout box bugs close k fixed --text reason -';
const NOTE = 'codescout box frictions note --title "x" --tool run_command';

test('arm b: a complex verb is refused on every call, with no repeat exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-nudge-'));
  const env = { CS_SCRIBE_VARIANT: 'b' };
  const first = run(call(CLOSE), env, dir).out;
  const second = run(call(CLOSE), env, dir).out;
  assert.notEqual(first, '');
  assert.notEqual(second, '');
  assert.ok(!JSON.parse(first).hookSpecificOutput.permissionDecisionReason.includes('repeat this call'));
  rmSync(dir, { recursive: true, force: true });
});

test('arm b: the guard stands down after three refusals of complex verbs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-nudge-'));
  const env = { CS_SCRIBE_VARIANT: 'b' };
  const outs = [1, 2, 3, 4].map(() => run(call(CLOSE), env, dir).out);
  assert.deepEqual(outs.map((o) => o !== ''), [true, true, true, false]);
  rmSync(dir, { recursive: true, force: true });
});

test('arm b: add and note keep the single repeat exit', () => {
  for (const command of [ADD, NOTE]) {
    const dir = mkdtempSync(join(tmpdir(), 'scribe-nudge-'));
    const env = { CS_SCRIBE_VARIANT: 'b' };
    const first = run(call(command), env, dir).out;
    assert.ok(JSON.parse(first).hookSpecificOutput.permissionDecisionReason.includes('repeat this call'));
    assert.equal(run(call(command), env, dir).out, '', command);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('arm c: the message quotes the threshold and keeps the repeat exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-nudge-'));
  const env = { CS_SCRIBE_VARIANT: 'c' };
  const first = run(call(CLOSE), env, dir).out;
  const reason = JSON.parse(first).hookSpecificOutput.permissionDecisionReason;
  assert.ok(reason.includes('more than about two calls'));
  assert.ok(reason.includes('repeat this call'));
  assert.equal(run(call(CLOSE), env, dir).out, '');
  rmSync(dir, { recursive: true, force: true });
});

test('an unknown variant behaves as arm a', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-nudge-'));
  const env = { CS_SCRIBE_VARIANT: 'zzz' };
  assert.notEqual(run(call(CLOSE), env, dir).out, '');
  assert.equal(run(call(CLOSE), env, dir).out, '');
  rmSync(dir, { recursive: true, force: true });
});

test('the default window is long enough to mean once per session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-nudge-'));
  assert.notEqual(run(call(ADD), {}, dir).out, '');
  // a marker 2 hours old still counts: one refusal per session, not per half hour
  const marker = join(dir, readdirSync(dir)[0]);
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(marker, old, old);
  assert.equal(run(call(ADD), {}, dir).out, '');
  rmSync(dir, { recursive: true, force: true });
});
