import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { POLICY_TIMEOUT_MS, effectiveTimeoutMs, runPolicy } from './run-policy.mjs';

const ES = fileURLToPath(new URL('../..', import.meta.url));
const ROOT = mkdtempSync(path.join(os.tmpdir(), 'run-policy-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

// A copy of bin/ and core/ whose CLI is replaced by `source`.
function copyTree(source) {
  const tree = mkdtempSync(path.join(ROOT, 'tree-'));
  cpSync(path.join(ES, 'bin'), path.join(tree, 'bin'), { recursive: true });
  cpSync(path.join(ES, 'core'), path.join(tree, 'core'), { recursive: true });
  const cli = path.join(tree, 'bin', 'effort-policy.mjs');
  writeFileSync(cli, source);
  return { tree, cli };
}

const failOpen = (reason) => ({
  level: 'default',
  confidence: 'low',
  reasons: [reason],
  steer: null,
  arm: 'treated',
});

t('POLICY_TIMEOUT_MS is the 2000 ms placeholder', () => {
  assert.equal(POLICY_TIMEOUT_MS, 2000);
});

// I-3: 0 disables spawnSync's timeout, and -1, 150.5, '200', Infinity, NaN make it throw,
// which would turn every hook call into a silent adapter_cli_failed.
const BAD_TIMEOUTS = [0, -1, 150.5, '200', Infinity, NaN, undefined, null, 2 ** 53, true];

t('effectiveTimeoutMs keeps a positive safe integer and maps anything else to the default', () => {
  for (const bad of BAD_TIMEOUTS) assert.equal(effectiveTimeoutMs(bad), POLICY_TIMEOUT_MS, String(bad));
  for (const ok of [1, 200, 5000]) assert.equal(effectiveTimeoutMs(ok), ok);
});

t('runPolicy with a bad timeoutMs falls back to the default and still answers correctly', () => {
  for (const bad of BAD_TIMEOUTS) {
    const out = runPolicy({ prompt: 'x' }, { timeoutMs: bad });
    assert.deepEqual(out.reasons, ['no_rule'], `timeoutMs ${String(bad)}: ${JSON.stringify(out.reasons)}`);
  }
});

t('the real CLI answers no_rule for a prompt that matches nothing', () => {
  const out = runPolicy({ prompt: 'x' });
  assert.deepEqual(out.reasons, ['no_rule']);
  assert.equal(out.level, 'default');
});

t('a CLI that sleeps is killed at the timeout and the result fails open', () => {
  // The stub traps SIGTERM: only SIGKILL ends it early, so this pins killSignal.
  const { tree, cli } = copyTree("process.on('SIGTERM', () => {}); setTimeout(() => {}, 5000);\n");
  const start = Date.now();
  const out = runPolicy({ prompt: 'x' }, { cliPath: cli, timeoutMs: 200 });
  const elapsed = Date.now() - start;
  assert.deepEqual(out, failOpen('adapter_timeout'));
  assert.ok(elapsed < 1500, `took ${elapsed} ms`);
  // No orphan: nothing run from this tree is still alive.
  const ps = spawnSync('pgrep', ['-f', tree], { encoding: 'utf8' });
  assert.equal(ps.stdout.trim(), '', `orphan process: ${ps.stdout}`);
});

t('a valid line with non-default values in every field passes through whole', () => {
  const want = { level: 'deep', confidence: 'high', reasons: ['r1'], steer: 'STEER TEXT', arm: 'holdout' };
  const { cli } = copyTree(`console.log(${JSON.stringify(JSON.stringify(want))});\n`);
  assert.deepEqual(runPolicy({ prompt: 'x' }, { cliPath: cli }), want);
});

t('a CLI that exits 64 fails open as adapter_cli_failed', () => {
  const { cli } = copyTree('process.exit(64);\n');
  assert.deepEqual(runPolicy({ prompt: 'x' }, { cliPath: cli }), failOpen('adapter_cli_failed'));
});

t('a cliPath that does not exist fails open as adapter_cli_failed', () => {
  const out = runPolicy({ prompt: 'x' }, { cliPath: path.join(ROOT, 'nope.mjs') });
  assert.deepEqual(out, failOpen('adapter_cli_failed'));
});

t('two lines of output fail open as adapter_bad_output', () => {
  const valid = '{"level":"default","confidence":"low","reasons":[],"steer":null,"arm":"treated"}';
  const { cli } = copyTree(`console.log(${JSON.stringify(valid)}); console.log(${JSON.stringify(valid)});\n`);
  assert.deepEqual(runPolicy({ prompt: 'x' }, { cliPath: cli }), failOpen('adapter_bad_output'));
});

t('a JSON array fails open as adapter_bad_output', () => {
  const { cli } = copyTree('console.log("[1]");\n');
  assert.deepEqual(runPolicy({ prompt: 'x' }, { cliPath: cli }), failOpen('adapter_bad_output'));
});

t('an object missing one of the five keys fails open as adapter_bad_output', () => {
  const { cli } = copyTree('console.log(JSON.stringify({ level: "default", confidence: "low", reasons: [], steer: null }));\n');
  assert.deepEqual(runPolicy({ prompt: 'x' }, { cliPath: cli }), failOpen('adapter_bad_output'));
});

t('empty stdout fails open as adapter_bad_output', () => {
  const { cli } = copyTree('\n');
  assert.deepEqual(runPolicy({ prompt: 'x' }, { cliPath: cli }), failOpen('adapter_bad_output'));
});

t('a ctx that cannot be stringified does not throw and fails open', () => {
  const circular = {};
  circular.self = circular;
  assert.deepEqual(runPolicy(circular), failOpen('adapter_cli_failed'));
  assert.deepEqual(runPolicy({ n: 1n }), failOpen('adapter_cli_failed'));
});

t('a log written by a real --log run holds only whole JSON lines', () => {
  const state = mkdtempSync(path.join(ROOT, 'state-'));
  const ctx = { prompt: 'x', session_id: 'sess-1', turn_id: 'turn-1' };
  for (let i = 0; i < 3; i += 1) {
    const out = runPolicy({ ...ctx, turn_id: `turn-${i}` }, { args: ['--log'], env: { XDG_STATE_HOME: state } });
    assert.ok(!out.reasons.includes('log_failed'), JSON.stringify(out.reasons));
  }
  const dir = path.join(state, 'effort-steering');
  const files = readdirSync(dir);
  assert.deepEqual(files, ['sess-1.jsonl']);
  const raw = readFileSync(path.join(dir, files[0]), 'utf8');
  assert.ok(raw.endsWith('\n'));
  const lines = raw.slice(0, -1).split('\n');
  assert.equal(lines.length, 3);
  for (const line of lines) assert.equal(typeof JSON.parse(line), 'object');
});
