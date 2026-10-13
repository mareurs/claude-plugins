import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../../core/testkit.mjs';
import { TEST_COMMAND_SENTENCE } from './r1-prompt.mjs';
import { main, parseFlags, parseRows, usableTasks } from './r1.mjs';

t('parseRows reads JSON lines, skips blank lines, and keeps non-row objects for the analysis to ignore', () => {
  const text = '{"taskId":"a","arm":"C"}\n\n{"type":"stopped","reason":"signal"}\n';
  assert.deepEqual(parseRows(text, 'f'), [{ taskId: 'a', arm: 'C' }, { type: 'stopped', reason: 'signal' }]);
});

t('parseRows names the file and line of a bad line', () => {
  assert.throws(() => parseRows('{"a":1}\nnot json\n', 'rows.jsonl'), /rows\.jsonl line 2/);
});

t('parseFlags reads strings, numbers and repeated list flags', () => {
  const f = parseFlags(['--a', 'x', '--n', '4', '--rows', 'r1', '--rows', 'r2'], { a: 'string', n: 'number', rows: 'list' });
  assert.deepEqual(f, { a: 'x', n: 4, rows: ['r1', 'r2'] });
});

t('parseFlags refuses an unknown flag, a missing value and a bad number', () => {
  assert.throws(() => parseFlags(['--zzz', '1'], { a: 'string' }), /unknown argument/);
  assert.throws(() => parseFlags(['--a'], { a: 'string' }), /needs a value/);
  assert.throws(() => parseFlags(['--n', '0'], { n: 'number' }), /above 0/);
});

t('usableTasks keeps the tasks that are ok in the report and ok in the review', () => {
  const report = [{ id: 'a', ok: true }, { id: 'b', ok: true }, { id: 'c', ok: false }, { id: 'd', ok: true }];
  const review = { a: 'ok', b: 'leak', c: 'ok', d: 'unfair' };
  assert.deepEqual(usableTasks(report, review), ['a']);
});

t('usableTasks refuses a task with no review verdict', () => {
  assert.throws(() => usableTasks([{ id: 'a', ok: true }], {}), /no review verdict for a/);
});

t('usableTasks refuses a verdict outside ok, leak, unfair', () => {
  assert.throws(() => usableTasks([{ id: 'a', ok: true }], { a: 'maybe' }), /verdict/);
});

t('usableTasks does not need a verdict for a task the report already dropped', () => {
  assert.deepEqual(usableTasks([{ id: 'a', ok: false }], {}), []);
});

t('parseFlags reads a switch without a value, first, in the middle or last', () => {
  const spec = { a: 'string', 'reuse-output': 'switch' };
  assert.deepEqual(parseFlags(['--reuse-output', '--a', 'x'], spec), { 'reuse-output': true, a: 'x' });
  assert.deepEqual(parseFlags(['--a', 'x', '--reuse-output'], spec), { a: 'x', 'reuse-output': true });
  assert.deepEqual(parseFlags(['--a', 'x'], spec), { a: 'x' });
});

t('parseFlags refuses a stray value after a switch', () => {
  assert.throws(() => parseFlags(['--reuse-output', 'stray'], { 'reuse-output': 'switch' }), /unknown argument "stray"/);
});

// ---- main(): the stage0 wiring. The fixture task is `python`, so a capture would stop at captureTrace's refusal before any Docker call. ----
let failedCli = false;
async function ta(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failedCli = true;
    console.log(`not ok - ${name}`);
    console.log(String(err && err.stack ? err.stack : err));
  }
}
const SAVED = [
  '---- x::y stdout ----',
  "thread 'x::y' panicked at src/lib.rs:1:1:",
  'assertion failed: é → ü',
  'stack backtrace:',
  '   0: f',
  '             at ./src/lib.rs:34:9',
  '',
].join('\n');
const cliScratch = mkdtempSync(join(tmpdir(), 'r1-cli-'));
const cliWork = join(cliScratch, 'work');
const cliOut = join(cliScratch, 'out');
mkdirSync(join(cliWork, 'tasks', 'cs-s'), { recursive: true });
mkdirSync(join(cliWork, 'tasks', 'cs-t'), { recursive: true });
writeFileSync(join(cliWork, 'tasks', 'cs-s', 'manifest.json'), JSON.stringify({ id: 'cs-s', repo: 'codescout', def: { testRunner: 'python', f2p: { command: ['x'], names: [] } } }));
writeFileSync(join(cliWork, 'tasks', 'cs-s', 'gate.json'), JSON.stringify({ ok: true }));
mkdirSync(join(cliOut, 'stage0'), { recursive: true });
writeFileSync(join(cliOut, 'stage0', 'cs-s.f2p.out'), SAVED);
const cliIo = () => {
  const io = { logs: [], errs: [], log: (l) => io.logs.push(l), err: (l) => io.errs.push(l) };
  return io;
};

await ta('stage0 --reuse-output rebuilds the prompt from the saved output and never captures', async () => {
  const io = cliIo();
  const code = await main(['stage0', '--reuse-output', '--work-root', cliWork, '--out-root', cliOut, '--tasks', 'cs-s'], io);
  assert.equal(code, 0, io.errs.join('\n'));
  assert.ok(readFileSync(join(cliOut, 'stage0', 'cs-s.prompt.txt'), 'utf8').endsWith(` ${TEST_COMMAND_SENTENCE}\n`));
  assert.equal(readFileSync(join(cliOut, 'stage0', 'cs-s.f2p.out'), 'utf8'), SAVED);
});

await ta('stage0 without --reuse-output captures (and the fixture task is refused before any Docker call)', async () => {
  const io = cliIo();
  const code = await main(['stage0', '--work-root', cliWork, '--out-root', cliOut, '--tasks', 'cs-s'], io);
  assert.equal(code, 1);
  assert.match(io.errs.join('\n'), /captureTrace: cs-s is not a cargo task/);
});

await ta('stage0 without --tasks takes the gated tasks of the work root and enforces the floor of 12', async () => {
  const io = cliIo();
  const code = await main(['stage0', '--reuse-output', '--work-root', cliWork, '--out-root', cliOut], io);
  assert.equal(code, 1);
  assert.ok(io.logs.includes('usable 1 of 1'), `logs: ${JSON.stringify(io.logs)}`);
  assert.match(io.errs.join('\n'), /below the floor of 12/);
});

rmSync(cliScratch, { recursive: true, force: true });
if (failedCli) process.exitCode = 1;
