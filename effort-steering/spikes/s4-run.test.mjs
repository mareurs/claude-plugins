// s4-run.test.mjs — vectors for the S4 runner. EVERY test injects a fake `spawn`; nothing
// here (or in the module under these tests) ever executes the real `claude` binary.
// The only real child processes are `git` (temp repos, so the REAL loadPrereg decides) and,
// in one test, `sh -c <hook command>` to prove the scratch hook command survives odd paths.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stateDirFor } from '../core/log.mjs';
import { t } from '../core/testkit.mjs';
import { main, measureHookLatency, planRuns, runExperiment, stopReasons } from './s4-run.mjs';

const ROOT = realpathSync(mkdtempSync(path.join(os.tmpdir(), 's4-run-test-')));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));
let tmpN = 0;
const tmp = () => {
  const d = path.join(ROOT, `d${tmpN++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// Async tests: testkit's t is sync, so await the body and set the exit code the same way.
async function ta(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.log(`not ok - ${name}`);
    console.log(String(err && err.stack ? err.stack : err));
    process.exitCode = 1;
  }
}

// ---- a throwaway git repo so the REAL loadPrereg accepts or rejects a file ----------

const GENV = { ...process.env };
for (const k of Object.keys(GENV)) if (k.startsWith('GIT_')) delete GENV[k];
GENV.HOME = ROOT;
GENV.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const REPO = path.join(ROOT, 'repo');
mkdirSync(REPO);
git(REPO, 'init', '-q');
git(REPO, 'commit', '-q', '--allow-empty', '-m', 'init');
const head = () => git(REPO, 'rev-parse', 'HEAD').trim();

let fileN = 0;
function put(obj, { commit = true } = {}) {
  const f = path.join(REPO, `prereg-${fileN++}.json`);
  writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  if (commit) {
    git(REPO, 'add', '--', f);
    git(REPO, 'commit', '-q', '-m', 'add');
  }
  return f;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const prereg = (over = {}) => ({
  direction: 'down',
  effectSizeThinkingTokens: 150,
  latencyBudgetMs: 1000,
  holdoutRate: 0.5,
  repeats: 3,
  minPerArm: 3,
  model: 'm-test',
  prompts: ['p one', 'p two', 'p three', 'p four'],
  steerLevel: 'shallow',
  ...over,
});
const silent = () => {};
const sidOf = (args) => args[args.indexOf('--session-id') + 1];

const tline = (id, input, cc, cr, thinking) =>
  JSON.stringify({ type: 'assistant', message: { id, role: 'assistant', usage: { input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens_details: { thinking_tokens: thinking } } } });
// Message A is streamed twice: deduped, thinking 80 total and cache_creation 20, input_total 165.
const transcript = (thinking, cc = 20) => `${tline('A', 10, cc, 30, thinking - 30)}\n${tline('A', 10, cc, 30, thinking - 30)}\n${tline('B', 5, 0, 100, 30)}\n`;
const ZERO_USAGE = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens_details: { thinking_tokens: 0 } };
const apiErrorTranscript = (kind) =>
  `${JSON.stringify(
    kind === 'flag'
      ? { type: 'assistant', isApiErrorMessage: true, message: { id: 'E', role: 'assistant', model: 'real-model', usage: ZERO_USAGE } }
      : { type: 'assistant', message: { id: 'E', role: 'assistant', model: '<synthetic>', usage: ZERO_USAGE } },
  )}\n`;

// A fake that stands in for `claude` and for the hook. Never touches a real binary.
// plan(index) -> { arm, thinking, cc, nolog, notranscript, spawn: 'status'|'signal'|'error', apierr: 'flag'|'model', dup }
function fakeEnv({ plan, configDir, durations, hookResult, execHook } = {}) {
  const calls = { claude: [], hook: [] };
  let claudeIndex = 0;
  let hookIndex = 0;
  const spawn = (cmd, args, opts) => {
    if (cmd !== 'claude') {
      calls.hook.push({ cmd, args, opts });
      return hookResult ? hookResult(hookIndex++) : { status: 0, stdout: '', stderr: '' };
    }
    const settingsFile = args[args.indexOf('--settings') + 1];
    const rootDir = path.dirname(settingsFile);
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    const command = settings.hooks.UserPromptSubmit[0].hooks[0].command;
    const copyRoot = path.join(rootDir, 'es');
    const hookStatus = execHook ? spawnSync('sh', ['-c', command], { input: '{}', env: { ...process.env, XDG_STATE_HOME: opts.env.XDG_STATE_HOME }, encoding: 'utf8' }).status : null;
    calls.claude.push({
      cmd,
      args,
      opts,
      settings,
      command,
      rootDir,
      hookStatus,
      rules: JSON.parse(readFileSync(path.join(copyRoot, 'core', 'rules.json'), 'utf8')),
      copyHasTable: existsSync(path.join(copyRoot, 'core', 'steer.table.json')),
      copyHasBin: existsSync(path.join(copyRoot, 'bin', 'effort-policy.mjs')),
    });
    const p = plan ? plan(claudeIndex) : { arm: claudeIndex % 2 === 0 ? 'treated' : 'holdout', thinking: claudeIndex % 2 === 0 ? 80 : 400 };
    claudeIndex++;
    const sid = sidOf(args);
    if (!p.nolog) {
      // Where log.mjs would put it: a relative or unset XDG_STATE_HOME falls back to ~/.local/state.
      const dir = stateDirFor(opts.env);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${sid}.jsonl`), `${JSON.stringify({ session_id: sid, arm: p.arm, steered: p.arm === 'treated' })}\n`);
    }
    if (!p.notranscript) {
      const text = p.apierr ? apiErrorTranscript(p.apierr) : transcript(p.thinking ?? 80, p.cc ?? 20);
      for (const slug of p.dup ? ['slug', 'slug2'] : ['slug']) {
        mkdirSync(path.join(configDir, 'projects', slug), { recursive: true });
        writeFileSync(path.join(configDir, 'projects', slug, `${sid}.jsonl`), text);
      }
    }
    if (p.spawn === 'status') return { status: 1, stdout: '', stderr: '' };
    if (p.spawn === 'signal') return { status: 0, signal: 'SIGKILL' }; // status 0 on purpose: the signal check must stand alone
    if (p.spawn === 'error') return { status: 0, error: new Error('spawn failed') }; // status 0 on purpose: the error check must stand alone
    return { status: 0, stdout: '', stderr: '' };
  };
  // Fake clock: each measured run advances by the next duration.
  let k = 0;
  let clock = 0;
  const now = () => {
    const d = durations ?? [1];
    if (k % 2 === 0) {
      k++;
      return clock;
    }
    clock += d[((k - 1) / 2) % d.length];
    k++;
    return clock;
  };
  return { spawn, calls, now };
}

const run = (over, envOpts, extra = {}) => {
  const configDir = tmp();
  const f = fakeEnv({ configDir, ...envOpts });
  const p = prereg(over);
  return runExperiment(put(p), { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent, ...extra }).then((result) => ({ result, f, p }));
};
const std = (i) => ({ arm: i % 2 === 0 ? 'treated' : 'holdout', thinking: i % 2 === 0 ? 80 : 400 });
const total = (f) => f.calls.claude.length + f.calls.hook.length;

t('planRuns: prompts x repeats entries, distinct UUID session ids, each prompt repeated', () => {
  const p = prereg();
  const runs = planRuns(p);
  assert.equal(runs.length, 12);
  assert.equal(new Set(runs.map((r) => r.sessionId)).size, 12);
  assert.ok(runs.every((r) => UUID.test(r.sessionId)));
  for (const prompt of p.prompts) assert.equal(runs.filter((r) => r.prompt === prompt).length, 3);
});

// ---- R21: runExperiment itself is gated by loadPrereg ----------------------------------

await ta('runExperiment throws with ZERO spawn calls for an uncommitted, edited, invalid or missing prereg, with and without confirm', async () => {
  const uncommitted = put(prereg(), { commit: false });
  const edited = put(prereg());
  appendFileSync(edited, '\n');
  const invalid = put(prereg({ model: null }));
  const incomplete = put({ direction: 'down' });
  for (const file of [uncommitted, edited, invalid, incomplete, path.join(REPO, 'no-such-file.json')]) {
    for (const confirm of [true, false, undefined]) {
      const f = fakeEnv({ configDir: tmp() });
      await assert.rejects(runExperiment(file, { spawn: f.spawn, confirm, out: silent, now: f.now }), /prereg/, `${file} confirm=${confirm}`);
      assert.equal(total(f), 0, `${file} confirm=${confirm}`);
    }
  }
});

await ta('runExperiment records the prereg commit, with GIT_* env vars scrubbed', async () => {
  const other = tmp();
  git(other, 'init', '-q');
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(other, '.git');
  try {
    const { result } = await run();
    assert.equal(result.gitCommit, head());
    assert.match(result.gitCommit, /^[0-9a-f]{40}$/);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }
});

// ---- the claude argv ---------------------------------------------------------------------

await ta('each claude call carries the registered args and never --no-session-persistence', async () => {
  const { f, p } = await run();
  assert.equal(f.calls.claude.length, 12);
  const sids = new Set();
  for (const c of f.calls.claude) {
    assert.equal(c.cmd, 'claude');
    const a = c.args;
    assert.equal(a[0], '-p');
    assert.ok(p.prompts.includes(a.at(-1)));
    assert.equal(a[a.indexOf('--model') + 1], 'm-test');
    assert.match(sidOf(a), UUID);
    sids.add(sidOf(a));
    assert.equal(a[a.indexOf('--setting-sources') + 1], 'local');
    assert.equal(a.filter((x) => x === '--setting-sources').length, 1);
    assert.ok(a[a.indexOf('--settings') + 1].endsWith('settings.json'));
    assert.ok(!a.includes('--no-session-persistence'));
  }
  assert.equal(sids.size, 12);
});

await ta('the prompt is the LAST argv element, after `--`, so a prompt starting with - is never a flag', async () => {
  const prompts = ['--settings x', '-c', '--help', 'plain'];
  const { f } = await run({ prompts });
  assert.equal(f.calls.claude.length, 12);
  for (const c of f.calls.claude) {
    const a = c.args;
    assert.equal(a.at(-2), '--');
    assert.ok(prompts.includes(a.at(-1)));
    assert.equal(a.indexOf('--'), a.length - 2);
    assert.ok(!a.slice(0, -1).includes(a.at(-1)), 'the prompt text must not appear before `--`');
  }
  assert.deepEqual(new Set(f.calls.claude.map((c) => c.args.at(-1))), new Set(prompts));
});

await ta('--strict-mcp-config is passed, before `--`', async () => {
  const { f } = await run();
  for (const c of f.calls.claude) {
    assert.ok(c.args.includes('--strict-mcp-config'));
    assert.ok(c.args.indexOf('--strict-mcp-config') < c.args.indexOf('--'));
  }
});

await ta('claude and hook spawns use killSignal SIGKILL', async () => {
  const { f } = await run();
  assert.ok(f.calls.claude.every((c) => c.opts.killSignal === 'SIGKILL'));
  assert.ok(f.calls.hook.length === 12 && f.calls.hook.every((c) => c.opts.killSignal === 'SIGKILL'));
});

// ---- scratch isolation --------------------------------------------------------------------

await ta('scratch settings register exactly one UserPromptSubmit command pointing into the copy', async () => {
  const { f } = await run();
  const c = f.calls.claude[0];
  assert.deepEqual(Object.keys(c.settings), ['hooks']);
  assert.deepEqual(Object.keys(c.settings.hooks), ['UserPromptSubmit']);
  assert.equal(c.settings.hooks.UserPromptSubmit.length, 1);
  assert.equal(c.settings.hooks.UserPromptSubmit[0].hooks.length, 1);
  assert.equal(c.settings.hooks.UserPromptSubmit[0].hooks[0].type, 'command');
  const realHook = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'adapter', 'claude-code', 'user-prompt-submit.mjs');
  const copyHook = path.join(c.rootDir, 'es', 'adapter', 'claude-code', 'user-prompt-submit.mjs');
  assert.ok(c.command.includes(copyHook));
  assert.ok(!c.command.includes(realHook));
  assert.ok(c.rootDir.startsWith(realpathSync(os.tmpdir())));
  assert.ok(c.copyHasTable && c.copyHasBin);
});

await ta('the scratch hook command survives a path with a space, a quote and a dollar sign', async () => {
  const base = path.join(tmp(), "my dir's $x");
  mkdirSync(base, { recursive: true });
  const { f } = await run({}, { execHook: true }, { tmpDir: base });
  assert.ok(f.calls.claude[0].rootDir.startsWith(base));
  assert.ok(f.calls.claude.every((c) => c.hookStatus === 0), `hook statuses: ${f.calls.claude.map((c) => c.hookStatus)}`);
});

await ta('the copy holds exactly the one rule, high for shallow', async () => {
  const { f } = await run({ steerLevel: 'shallow', direction: 'down' });
  assert.deepEqual(f.calls.claude[0].rules, { version: 1, rules: [{ id: 's4-all', level: 'shallow', confidence: 'high', reason: 's4', when: { minChars: 0 } }] });
});

await ta('the copy holds exactly the one rule, medium for deep', async () => {
  const { f } = await run({ steerLevel: 'deep', direction: 'up' });
  assert.deepEqual(f.calls.claude[0].rules, { version: 1, rules: [{ id: 's4-all', level: 'deep', confidence: 'medium', reason: 's4', when: { minChars: 0 } }] });
});

await ta('child env carries the holdout rate and a temp XDG_STATE_HOME, not the real state dir; temp root is removed', async () => {
  const { f } = await run({ holdoutRate: 0.25 });
  const c = f.calls.claude[0];
  assert.equal(c.opts.env.EFFORT_STEERING_HOLDOUT_RATE, '0.25');
  const xdg = c.opts.env.XDG_STATE_HOME;
  assert.ok(xdg.startsWith(realpathSync(os.tmpdir())));
  assert.notEqual(xdg, process.env.XDG_STATE_HOME);
  assert.ok(!xdg.includes('.local/state'));
  assert.ok(c.opts.cwd.startsWith(realpathSync(os.tmpdir())));
  assert.ok(!existsSync(c.rootDir));
  assert.ok(!existsSync(xdg));
  assert.ok(!existsSync(c.opts.cwd));
});

await ta('a relative TMPDIR still yields an absolute XDG_STATE_HOME, and nothing lands under HOME', async () => {
  const home = tmp();
  const base = tmp();
  mkdirSync(path.join(base, 'rel'));
  const configDir = tmp();
  const file = put(prereg());
  const f = fakeEnv({ configDir });
  const saved = { cwd: process.cwd(), TMPDIR: process.env.TMPDIR, HOME: process.env.HOME };
  try {
    process.chdir(base);
    process.env.TMPDIR = 'rel';
    process.env.HOME = home;
    const result = await runExperiment(file, { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent });
    assert.ok(path.isAbsolute(f.calls.claude[0].opts.env.XDG_STATE_HOME));
    assert.ok(path.isAbsolute(f.calls.claude[0].opts.cwd));
    assert.equal(result.excluded, 0);
    assert.ok(!existsSync(path.join(home, '.local')), 'a record landed under HOME/.local');
  } finally {
    process.chdir(saved.cwd);
    if (saved.TMPDIR === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved.TMPDIR;
    process.env.HOME = saved.HOME;
  }
});

// ---- rows and exclusions ------------------------------------------------------------------

await ta('rows join arm with deduped transcript tokens (R3)', async () => {
  const { result } = await run();
  const a = result.analysis;
  assert.equal(a.nTreated, 6);
  assert.equal(a.nHoldout, 6);
  assert.equal(a.medianTreated, 80); // 50 + 30; an un-deduped A would give 130
  assert.equal(a.medianHoldout, 400);
  assert.equal(a.cacheShareTreated, 20 / 165); // cache_creation 20 over input_total 60 + 105
  assert.equal(result.excluded, 0);
  assert.deepEqual(result.excludedByReason, { no_log: 0, no_transcript: 0, ambiguous_transcript: 0, spawn_failed: 0, api_error: 0 });
});

const reasons = (over) => ({ no_log: 0, no_transcript: 0, ambiguous_transcript: 0, spawn_failed: 0, api_error: 0, ...over });

await ta('runs with no log file are excluded and counted, never treated as holdout; stop has runs_excluded', async () => {
  const { result } = await run({}, { plan: (i) => (i < 6 && i % 2 === 0 ? { nolog: true, arm: 'treated' } : std(i)) });
  assert.equal(result.excluded, 3);
  assert.deepEqual(result.excludedByReason, reasons({ no_log: 3 }));
  assert.equal(result.analysis.nTreated, 3);
  assert.equal(result.analysis.nHoldout, 6);
  assert.deepEqual(result.stop, ['runs_excluded']);
});

await ta('runs with no transcript are excluded and counted', async () => {
  const { result } = await run({}, { plan: (i) => ({ ...std(i), notranscript: i === 1 || i === 3 }) });
  assert.equal(result.excluded, 2);
  assert.deepEqual(result.excludedByReason, reasons({ no_transcript: 2 }));
  assert.equal(result.analysis.nTreated, 6);
  assert.equal(result.analysis.nHoldout, 4);
});

await ta('a transcript found in two project dirs is excluded as ambiguous_transcript', async () => {
  const { result } = await run({}, { plan: (i) => ({ ...std(i), dup: i === 1 || i === 3 }) });
  assert.deepEqual(result.excludedByReason, reasons({ ambiguous_transcript: 2 }));
  assert.equal(result.analysis.nHoldout, 4);
});

await ta('a failed claude run (error, signal or non-zero status) is excluded as spawn_failed even with a log and transcript', async () => {
  const kinds = { 1: 'status', 3: 'signal', 5: 'error' };
  const { result } = await run({}, { plan: (i) => ({ ...std(i), spawn: kinds[i] }) });
  assert.deepEqual(result.excludedByReason, reasons({ spawn_failed: 3 }));
  assert.equal(result.analysis.nHoldout, 3);
  assert.equal(result.analysis.nTreated, 6);
  assert.ok(result.stop.includes('runs_excluded'));
});

await ta('API-error transcripts (flag only, or synthetic model only) are excluded as api_error', async () => {
  const { result } = await run({}, { plan: (i) => ({ ...std(i), apierr: i === 1 ? 'flag' : i === 3 ? 'model' : undefined }) });
  assert.deepEqual(result.excludedByReason, reasons({ api_error: 2 }));
  assert.equal(result.analysis.nHoldout, 4);
});

await ta('FALSE-GO scenario: 4 of 6 treated runs fail with API-error records -> excluded, insufficient_data, runs_excluded', async () => {
  const { result } = await run({}, { plan: (i) => (i % 2 === 0 && i < 8 ? { arm: 'treated', apierr: 'model', spawn: 'status' } : std(i)) });
  assert.equal(result.excluded, 4);
  assert.equal(result.analysis.nTreated, 2);
  assert.equal(result.verdict, 'insufficient_data');
  assert.ok(result.stop.includes('insufficient_data'));
  assert.ok(result.stop.includes('runs_excluded'));
  // the same failures with a successful exit code still never become zero-thinking rows
  const again = await run({}, { plan: (i) => (i % 2 === 0 && i < 8 ? { arm: 'treated', apierr: 'model' } : std(i)) });
  assert.equal(again.result.excludedByReason.api_error, 4);
  assert.equal(again.result.verdict, 'insufficient_data');
});

// ---- confirm gate -------------------------------------------------------------------------

await ta('without confirm: prints the call count and spawns nothing (not even the hook)', async () => {
  const f = fakeEnv({ configDir: tmp() });
  const lines = [];
  const file = put(prereg());
  const result = await runExperiment(file, { spawn: f.spawn, out: (s) => lines.push(s) });
  assert.equal(total(f), 0);
  assert.equal(result.verdict, 'not_run');
  assert.equal(result.calls, 12);
  assert.ok(result.stop.length > 0);
  assert.match(lines.join('\n'), /12 model calls/);
  for (const bad of [undefined, false, 'true', 1]) {
    await runExperiment(file, { spawn: f.spawn, confirm: bad, out: silent });
  }
  assert.equal(total(f), 0);
});

await ta('latency is measured FIRST: a slow hook means ZERO claude calls and stop is [latency_not_ok]', async () => {
  const { result, f } = await run({ latencyBudgetMs: 5 }, { durations: [10] });
  assert.equal(f.calls.claude.length, 0);
  assert.equal(f.calls.hook.length, 12);
  assert.deepEqual(result.stop, ['latency_not_ok']);
  assert.equal(result.latency.p95Ms, 10);
});

await ta('a hook that exits non-zero stops the run before any claude call', async () => {
  const { result, f } = await run({}, { hookResult: (i) => (i === 4 ? { status: 1 } : { status: 0 }) });
  assert.equal(f.calls.claude.length, 0);
  assert.deepEqual(result.stop, ['latency_not_ok']);
});

// ---- main: exact --confirm ----------------------------------------------------------------

const mainWith = async (argv, deps = {}) => {
  const configDir = tmp();
  const f = fakeEnv({ configDir });
  const file = put(prereg());
  const result = await main(argv, { spawn: f.spawn, preregFile: file, out: silent, configDir, now: f.now, ...deps });
  return { f, result };
};

await ta('main spawns nothing unless argv holds exactly "--confirm"', async () => {
  const cases = [['--confirm=false'], ['--confirm=0'], ['--no-confirm'], ['--CONFIRM'], ['--confirmx'], ['-confirm'], [' --confirm'], ['confirm'], []];
  for (const argv of cases) {
    const { f, result } = await mainWith(argv);
    assert.equal(total(f), 0, JSON.stringify(argv));
    assert.equal(result.verdict, 'not_run', JSON.stringify(argv));
  }
  const { f } = await mainWith([], { confirm: true });
  assert.equal(total(f), 0, 'deps.confirm must not enable a run');
});

await ta('main runs for --confirm and for a repeated --confirm; a non-array argv throws', async () => {
  for (const argv of [['--confirm'], ['--confirm', '--confirm']]) {
    const { f, result } = await mainWith(argv);
    assert.equal(f.calls.claude.length, 12, JSON.stringify(argv));
    assert.equal(result.verdict, 'mechanism_pass');
  }
  for (const bad of ['--confirm', undefined, null, { includes: () => true }]) {
    await assert.rejects(main(bad, { spawn: fakeEnv({ configDir: tmp() }).spawn, preregFile: put(prereg()), out: silent }), TypeError);
  }
});

await ta('main with an uncommitted prereg throws before any spawn', async () => {
  const f = fakeEnv({ configDir: tmp() });
  await assert.rejects(main(['--confirm'], { spawn: f.spawn, preregFile: put(prereg(), { commit: false }), out: silent }), /prereg/);
  assert.equal(total(f), 0);
});

// ---- the stop list ------------------------------------------------------------------------

const A = (over) => ({ verdict: 'mechanism_pass', cacheOk: true, ...over });
const L = (over) => ({ ok: true, ...over });

t('stop is empty only for mechanism_pass + cacheOk true + latency ok + nothing excluded', () => {
  assert.deepEqual(stopReasons(A(), L()), []);
  assert.deepEqual(stopReasons(A(), L(), 0), []);
});
t('stop: mechanism_fail', () => {
  assert.deepEqual(stopReasons(A({ verdict: 'mechanism_fail' }), L()), ['mechanism_fail']);
});
t('stop: insufficient_data (cacheOk null counts as not ok too)', () => {
  assert.deepEqual(stopReasons(A({ verdict: 'insufficient_data', cacheOk: null }), L()), ['insufficient_data', 'cache_not_ok']);
});
t('stop: an unknown or missing verdict is verdict_unknown, never a pass', () => {
  assert.deepEqual(stopReasons(A({ verdict: 'weird' }), L()), ['verdict_unknown']);
  assert.deepEqual(stopReasons(A({ verdict: undefined }), L()), ['verdict_unknown']);
  assert.deepEqual(stopReasons({ cacheOk: true }, L()), ['verdict_unknown']);
});
t('stop: mechanism_pass with cacheOk false contains cache_not_ok', () => {
  assert.deepEqual(stopReasons(A({ cacheOk: false }), L()), ['cache_not_ok']);
});
t('stop: cacheOk null alone is not ok', () => {
  assert.deepEqual(stopReasons(A({ cacheOk: null }), L()), ['cache_not_ok']);
});
t('stop: latency not ok', () => {
  assert.deepEqual(stopReasons(A(), L({ ok: false })), ['latency_not_ok']);
  assert.deepEqual(stopReasons(A(), {}), ['latency_not_ok']);
});
t('stop: any exclusion adds runs_excluded', () => {
  assert.deepEqual(stopReasons(A(), L(), 1), ['runs_excluded']);
  assert.deepEqual(stopReasons(A(), L(), 7), ['runs_excluded']);
});

await ta('end to end: pass + cache ok + latency ok gives an empty stop', async () => {
  const { result } = await run();
  assert.equal(result.verdict, 'mechanism_pass');
  assert.deepEqual(result.stop, []);
  assert.equal(result.latency.ok, true);
});

await ta('end to end: cache_creation higher on treated gives cache_not_ok', async () => {
  const { result } = await run({}, { plan: (i) => ({ ...std(i), cc: i % 2 === 0 ? 90 : 5 }) });
  assert.equal(result.verdict, 'mechanism_pass');
  assert.equal(result.analysis.cacheOk, false);
  assert.deepEqual(result.stop, ['cache_not_ok']);
});

await ta('end to end: short arms give insufficient_data', async () => {
  const { result } = await run({}, { plan: (i) => ({ arm: i === 0 ? 'holdout' : 'treated', thinking: 80 }) });
  assert.equal(result.verdict, 'insufficient_data');
  assert.ok(result.stop.includes('insufficient_data'));
});

await ta('end to end: no effect gives mechanism_fail', async () => {
  const { result } = await run({}, { plan: (i) => ({ arm: i % 2 === 0 ? 'treated' : 'holdout', thinking: 100 }) });
  assert.equal(result.verdict, 'mechanism_fail');
  assert.ok(result.stop.includes('mechanism_fail'));
});

// ---- measureHookLatency -------------------------------------------------------------------

function clockOf(durs) {
  let n = 0;
  let t0 = 0;
  return () => {
    if (n % 2 === 0) {
      n++;
      return t0;
    }
    t0 += durs[(n - 1) / 2];
    n++;
    return t0;
  };
}

t('measureHookLatency: n=20 takes sorted index 18 (nearest rank), not 17 or 19', () => {
  const p = prereg({ prompts: ['a', 'b', 'c', 'd'], repeats: 5, latencyBudgetMs: 19 });
  const durs = Array.from({ length: 20 }, (_, i) => i + 1).reverse(); // unsorted on purpose
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: 0 };
  };
  const r = measureHookLatency(p, { spawn, now: clockOf(durs) });
  assert.deepEqual(r, { n: 20, p95Ms: 19, failures: 0, ok: true });
  assert.equal(measureHookLatency({ ...p, latencyBudgetMs: 18.99 }, { spawn, now: clockOf(durs) }).ok, false);
  assert.equal(calls.length, 40);
});

t('measureHookLatency: n=12 rounds the rank UP (ceil 11.4 = 12, index 11), not down', () => {
  const durs = Array.from({ length: 12 }, (_, i) => ((i * 5) % 12) + 1); // a permutation of 1..12
  const spawn = () => ({ status: 0 });
  const r = measureHookLatency(prereg({ latencyBudgetMs: 12 }), { spawn, now: clockOf(durs) });
  assert.equal(r.p95Ms, 12);
  assert.equal(r.ok, true);
});

t('measureHookLatency: a hook run that exits non-zero, is killed or errors fails the gate even when fast', () => {
  for (const bad of [{ status: 1 }, { status: 0, signal: 'SIGKILL' }, { status: 0, error: new Error('ETIMEDOUT') }, undefined]) {
    let i = 0;
    const spawn = () => (i++ === 5 ? bad : { status: 0 });
    const r = measureHookLatency(prereg(), { spawn, now: clockOf(new Array(12).fill(1)) });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.failures, 1);
    assert.equal(r.p95Ms, 1);
  }
});

t('measureHookLatency runs the hook script once per (prompt, repeat) with hook JSON on stdin and a temp state dir; the root is removed', () => {
  const p = prereg();
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: 0 };
  };
  measureHookLatency(p, { spawn, now: clockOf(new Array(12).fill(1)) });
  assert.equal(calls.length, 12);
  assert.ok(calls.every((c) => c.cmd === process.execPath && c.args[0].endsWith(path.join('adapter', 'claude-code', 'user-prompt-submit.mjs'))));
  assert.ok(calls.every((c) => c.opts.killSignal === 'SIGKILL'));
  for (const prompt of p.prompts) assert.equal(calls.filter((c) => JSON.parse(c.opts.input).prompt === prompt).length, 3);
  const input = JSON.parse(calls[0].opts.input);
  assert.deepEqual(Object.keys(input).sort(), ['cwd', 'hook_event_name', 'permission_mode', 'prompt', 'prompt_id', 'session_id', 'transcript_path']);
  assert.equal(input.hook_event_name, 'UserPromptSubmit');
  assert.equal(input.permission_mode, 'default');
  assert.equal(input.transcript_path, '');
  assert.equal(new Set(calls.map((c) => JSON.parse(c.opts.input).session_id)).size, 12);
  const xdg = calls[0].opts.env.XDG_STATE_HOME;
  assert.ok(path.isAbsolute(xdg));
  assert.ok(xdg.startsWith(realpathSync(os.tmpdir())));
  // the ROOT (the cwd the runs used) is gone, not just a state subdirectory a fake never made
  assert.ok(existsSync(os.tmpdir()));
  assert.ok(!existsSync(calls[0].opts.cwd));
  assert.equal(path.dirname(xdg), calls[0].opts.cwd);
});
