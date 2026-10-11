// s4-run.test.mjs — vectors for the S4 runner. EVERY test injects a fake `spawn` for the
// `claude` runs; nothing here (or in the module under these tests) ever executes the real
// `claude` binary. Real child processes: `git` (temp repos, so the REAL loadPrereg and the
// REAL dirty-tree check decide), the copied effort-policy CLI (the steerability preflight
// runs it through runPolicy, as in production), `sh -c <hook command>` in one test, and
// the real copied hook in the latency tests that pass no `spawn`.
//
// The scratch copy and the dirty-tree check read a committed COPY of effort-steering/ in a
// temp repo (`esRoot`), never this checkout, which is dirty while it is being edited.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDirFor } from '../core/log.mjs';
import { t } from '../core/testkit.mjs';
import { holdoutCountFor, main, measureHookLatency, planRuns, runExperiment, stopReasons } from './s4-run.mjs';
import { holdoutCountFor as loadedHoldoutCountFor } from './s4-prereg.mjs';

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

// A committed copy of effort-steering/{bin,core,adapter} in its own temp repo; `edit` runs
// on the copy AFTER the commit (to dirty it or to break its CLI).
const ES_REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let treeN = 0;
const makeTree = (edit) => {
  const repo = path.join(ROOT, `tree-${treeN++}`);
  const es = path.join(repo, 'effort-steering');
  for (const dir of ['bin', 'core', 'adapter']) {
    cpSync(path.join(ES_REAL, dir), path.join(es, dir), { recursive: true, filter: (src) => !src.endsWith('.test.mjs') });
  }
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'tree');
  if (edit) edit(es, repo);
  return es;
};
const CLEAN_ES = makeTree();
const treeHead = (es) => git(path.dirname(es), 'rev-parse', 'HEAD').trim();
// The fake hook's log line, where the real one would put it.
const writeHookLog = (opts, fields = {}) => {
  const sid = JSON.parse(opts.input).session_id;
  const dir = stateDirFor(opts.env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${sid}.jsonl`), `${JSON.stringify({ session_id: sid, arm: 'treated', steered: true, ...fields })}\n`);
};
const okHook = (cmd, args, opts) => {
  writeHookLog(opts);
  return { status: 0, stdout: '', stderr: '' };
};

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
  effort: 'high',
  prompts: ['p one', 'p two', 'p three', 'p four'],
  steerLevel: 'shallow',
  // alpha 0.2: the end-to-end vectors here (1 treated + 2 holdout per prompt) have an exact
  // p of 1/81 when nothing is excluded and about 1/36 with two holdout runs excluded; the
  // statistic's own calibration lives in s4-analyze.test.mjs.
  alpha: 0.2,
  permutations: 500,
  seed: 7,
  ...over,
});
const silent = () => {};
const sidOf = (args) => args[args.indexOf('--session-id') + 1];

const tline = (id, input, cc, cr, thinking, effort) =>
  JSON.stringify({ type: 'assistant', effort, message: { id, role: 'assistant', usage: { input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens_details: { thinking_tokens: thinking } } } });
// Message A is streamed twice: deduped, thinking 80 total and cache_creation 20, input_total 165.
// `effort` is what Claude Code records on each assistant record: the level the child was started at.
const transcript = (thinking, cc = 20, effort = 'high') => `${tline('A', 10, cc, 30, thinking - 30, effort)}\n${tline('A', 10, cc, 30, thinking - 30, effort)}\n${tline('B', 5, 0, 100, 30, effort)}\n`;
const ZERO_USAGE = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens_details: { thinking_tokens: 0 } };
const apiErrorTranscript = (kind) =>
  `${JSON.stringify(
    kind === 'flag'
      ? { type: 'assistant', isApiErrorMessage: true, message: { id: 'E', role: 'assistant', model: 'real-model', usage: ZERO_USAGE } }
      : { type: 'assistant', message: { id: 'E', role: 'assistant', model: '<synthetic>', usage: ZERO_USAGE } },
  )}\n`;

// A fake that stands in for `claude` and for the hook. Never touches a real binary.
// plan(index) -> { arm, thinking, cc, nolog, notranscript, spawn: 'status'|'signal'|'error', apierr: 'flag'|'model', dup }
// A fake that stands in for `claude` and for the hook. Never touches a real binary.
// (R-PL6: a plan can also set `stdout` and `stderr`, the text the fake CLI printed.)
// Like the real hook, it reads the arm from the run's EFFORT_STEERING_HOLDOUT_RATE ('1' is
// holdout, '0' treated) and logs steered = (arm === 'treated'). A test's plan(index, ctx)
// can override any of: { arm, steered, thinking, cc, nolog, notranscript,
// spawn: 'status'|'signal'|'error', apierr: 'flag'|'model', dup, effort }; `effort` is what the
// child's transcript records (by default the `--effort` it was started with; null records none);
// ctx is
// { planned, prompt, sid }. index counts claude calls from 0.
function fakeEnv({ plan, configDir, durations, hookResult, execHook } = {}) {
  const calls = { claude: [], hook: [] };
  let claudeIndex = 0;
  let hookIndex = 0;
  const spawn = (cmd, args, opts) => {
    if (cmd !== 'claude') {
      calls.hook.push({ cmd, args, opts });
      // hookResult(i) -> { status, signal, error, stderr, nolog }; by default the hook logs and exits 0.
      const r = hookResult ? hookResult(hookIndex++) ?? {} : {};
      if (!r.nolog) writeHookLog(opts);
      const { nolog, ...res } = r;
      return { status: 0, stdout: '', stderr: '', ...res };
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
    const sid = sidOf(args);
    const planned = opts.env.EFFORT_STEERING_HOLDOUT_RATE === '1' ? 'holdout' : 'treated';
    const base = { arm: planned, thinking: planned === 'treated' ? 80 : 400 };
    const p = { ...base, ...(plan ? plan(claudeIndex, { planned, prompt: args.at(-1), sid }) : {}) };
    if (p.steered === undefined) p.steered = p.arm === 'treated';
    claudeIndex++;
    if (!p.nolog) {
      // Where log.mjs would put it: a relative or unset XDG_STATE_HOME falls back to ~/.local/state.
      const dir = stateDirFor(opts.env);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${sid}.jsonl`), `${JSON.stringify({ session_id: sid, arm: p.arm, steered: p.steered })}\n`);
    }
    if (!p.notranscript) {
      const text = p.apierr ? apiErrorTranscript(p.apierr) : transcript(p.thinking, p.cc ?? 20, 'effort' in p ? p.effort : args[args.indexOf('--effort') + 1]);
      for (const slug of p.dup ? ['slug', 'slug2'] : ['slug']) {
        mkdirSync(path.join(configDir, 'projects', slug), { recursive: true });
        writeFileSync(path.join(configDir, 'projects', slug, `${sid}.jsonl`), text);
      }
    }
    // `stdout` / `stderr` (R-PL6 vectors): what the fake CLI printed. The default is silence, as before.
    const printed = { stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    if (p.spawn === 'status') return { status: 1, ...printed };
    if (p.spawn === 'signal') return { status: 0, signal: 'SIGKILL' }; // status 0 on purpose: the signal check must stand alone
    if (p.spawn === 'error') return { status: 0, error: new Error('spawn failed') }; // status 0 on purpose: the error check must stand alone
    return { status: 0, ...printed };
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
  return runExperiment(put(p), { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent, esRoot: CLEAN_ES, ...extra }).then((result) => ({ result, f, p }));
};
const total = (f) => f.calls.claude.length + f.calls.hook.length;
// The planned arm of a call, as the hook would read it from the child env.
const plannedOf = (c) => (c.opts.env.EFFORT_STEERING_HOLDOUT_RATE === '1' ? 'holdout' : 'treated');
// Give the first `n` planned-`arm` MAIN runs the given plan fields (call 0 is the canary).
const firstOf = (arm, n, fields) => {
  let seen = 0;
  return (i, c) => (i > 0 && c.planned === arm && seen++ < n ? fields : {});
};
// (promptIndex, arm) of a plan, without the random session ids.
const shape = (runs) => runs.map((r) => [r.promptIndex, r.arm]);
const reasons = (over) => ({ no_log: 0, arm_mismatch: 0, not_steered: 0, steered_holdout: 0, no_transcript: 0, ambiguous_transcript: 0, spawn_failed: 0, api_error: 0, no_thinking_field: 0, effort_mismatch: 0, ...over });

t('planRuns: prompts x repeats entries, distinct UUID session ids, each prompt repeated, promptIndex matches', () => {
  const p = prereg();
  const runs = planRuns(p);
  assert.equal(runs.length, 12);
  assert.equal(new Set(runs.map((r) => r.sessionId)).size, 12);
  assert.ok(runs.every((r) => UUID.test(r.sessionId)));
  for (const prompt of p.prompts) assert.equal(runs.filter((r) => r.prompt === prompt).length, 3);
  assert.ok(runs.every((r) => p.prompts[r.promptIndex] === r.prompt));
  assert.deepEqual(Object.keys(runs[0]).sort(), ['arm', 'prompt', 'promptIndex', 'sessionId']);
});

t('holdoutCountFor: round(repeats x rate), clamped to [1, repeats - 1]', () => {
  const cases = [[3, 0.5, 2], [3, 0.9, 2], [3, 0.1, 1], [3, 0.34, 1], [4, 0.5, 2], [5, 0.4, 2], [5, 0.5, 3], [7, 0.3, 2], [10, 0.25, 3], [10, 0.95, 9], [10, 0.01, 1]];
  for (const [repeats, rate, want] of cases) assert.equal(holdoutCountFor(repeats, rate), want, `${repeats} x ${rate}`);
});

t('the runner and the loader share one holdoutCountFor, not two copies', () => {
  assert.equal(holdoutCountFor, loadedHoldoutCountFor);
});

t('planRuns balances the arms WITHIN every prompt, for several (repeats, holdoutRate) pairs', () => {
  const cases = [[3, 0.5, 2], [3, 0.9, 2], [3, 0.1, 1], [5, 0.4, 2], [10, 0.25, 3], [6, 0.5, 3]];
  for (const [repeats, holdoutRate, want] of cases) {
    for (const seed of [1, 2, 3]) {
      const p = prereg({ repeats, holdoutRate, seed, prompts: ['w a', 'w b', 'w c', 'w d', 'w e'] });
      const runs = planRuns(p);
      assert.equal(runs.length, 5 * repeats);
      for (let i = 0; i < 5; i++) {
        const mine = runs.filter((r) => r.promptIndex === i);
        assert.equal(mine.length, repeats, `prompt ${i}`);
        assert.equal(mine.filter((r) => r.arm === 'holdout').length, want, `${repeats} x ${holdoutRate} seed ${seed} prompt ${i}`);
        assert.equal(mine.filter((r) => r.arm === 'treated').length, repeats - want);
      }
    }
  }
});

t('planRuns: the same seed gives the same plan, other seeds give other plans', () => {
  const p = prereg({ repeats: 5, holdoutRate: 0.4 });
  assert.deepEqual(shape(planRuns(p)), shape(planRuns(p)));
  assert.deepEqual(shape(planRuns({ ...p })), shape(planRuns(p)));
  const shapes = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(shape(planRuns({ ...p, seed })))));
  assert.equal(shapes.size, 6);
  // the arms alone (which repeats are held out) also follow the seed, not only the order
  const armsOf = (seed) => JSON.stringify([0, 1, 2, 3].map((i) => planRuns({ ...p, seed }).filter((r) => r.promptIndex === i).map((r) => r.arm)));
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(armsOf)).size > 1);
});

t('planRuns interleaves prompts and arms instead of running prompt by prompt', () => {
  const order = planRuns(prereg({ repeats: 5, holdoutRate: 0.4 })).map((r) => r.promptIndex);
  assert.notDeepEqual(order, [...order].sort((a, b) => a - b));
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
      await assert.rejects(runExperiment(file, { spawn: f.spawn, confirm, out: silent, now: f.now, esRoot: CLEAN_ES }), /prereg/, `${file} confirm=${confirm}`);
      assert.equal(total(f), 0, `${file} confirm=${confirm}`);
    }
  }
});

await ta('runExperiment records treeCommit (HEAD of the copied tree) and preregCommit (last commit of the prereg file), with GIT_* env vars scrubbed', async () => {
  const other = tmp();
  git(other, 'init', '-q');
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(other, '.git');
  try {
    const file = put(prereg());
    const registering = head();
    git(REPO, 'commit', '-q', '--allow-empty', '-m', 'a later, unrelated commit');
    assert.notEqual(head(), registering);
    const configDir = tmp();
    const f = fakeEnv({ configDir });
    const result = await runExperiment(file, { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent, esRoot: CLEAN_ES });
    assert.equal(result.preregCommit, registering, 'the registering commit, not the repo HEAD');
    assert.equal(result.treeCommit, treeHead(CLEAN_ES));
    assert.match(result.treeCommit, /^[0-9a-f]{40}$/);
    assert.ok(!('gitCommit' in result));
    const dry = await runExperiment(file, { spawn: f.spawn, out: silent, esRoot: CLEAN_ES });
    assert.equal(dry.preregCommit, registering);
    assert.equal(dry.treeCommit, treeHead(CLEAN_ES));
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }
});

// ---- the claude argv ---------------------------------------------------------------------

await ta('each claude call carries the registered args and never --no-session-persistence', async () => {
  const { f, p } = await run();
  assert.equal(f.calls.claude.length, 13); // 1 canary + 12 planned runs
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
  assert.equal(sids.size, 13);
});

await ta('the prompt is the LAST argv element, after `--`', async () => {
  const { f, p } = await run();
  assert.equal(f.calls.claude.length, 13);
  for (const c of f.calls.claude) {
    const a = c.args;
    assert.equal(a.at(-2), '--');
    assert.ok(p.prompts.includes(a.at(-1)));
    assert.equal(a.indexOf('--'), a.length - 2);
    assert.ok(!a.slice(0, -1).includes(a.at(-1)), 'the prompt text must not appear before `--`');
  }
  assert.deepEqual(new Set(f.calls.claude.map((c) => c.args.at(-1))), new Set(p.prompts));
});

await ta('a dash-led, slash-led or one-word prompt is refused by loadPrereg with ZERO spawns', async () => {
  for (const bad of ['--settings x', '-c', '--help', '/ultrareview now', 'update']) {
    const f = fakeEnv({ configDir: tmp() });
    const file = put(prereg({ prompts: ['p one', 'p two', 'p three', bad] }));
    await assert.rejects(runExperiment(file, { spawn: f.spawn, confirm: true, out: silent, now: f.now, esRoot: CLEAN_ES }), /prompts\[3\]/, bad);
    assert.equal(total(f), 0, bad);
  }
});

await ta('--strict-mcp-config is passed, before `--`', async () => {
  const { f } = await run();
  for (const c of f.calls.claude) {
    assert.ok(c.args.includes('--strict-mcp-config'));
    assert.ok(c.args.indexOf('--strict-mcp-config') < c.args.indexOf('--'));
  }
});

await ta('`--thinking-display summarized` is passed once, before `--`, on every call (canary and both arms)', async () => {
  const { f } = await run();
  assert.equal(f.calls.claude.length, 13);
  for (const c of f.calls.claude) {
    const a = c.args;
    assert.equal(a.filter((x) => x === '--thinking-display').length, 1);
    const i = a.indexOf('--thinking-display');
    assert.equal(a[i + 1], 'summarized');
    assert.ok(i + 1 < a.indexOf('--'), 'the flag and its value must come before `--`');
  }
});

await ta('`--effort <registered level>` is passed once, before `--`, on every call (canary and both arms)', async () => {
  const { f } = await run();
  assert.equal(f.calls.claude.length, 13);
  for (const c of f.calls.claude) {
    const a = c.args;
    assert.equal(a.filter((x) => x === '--effort').length, 1);
    const i = a.indexOf('--effort');
    assert.equal(a[i + 1], 'high', 'the value must be the registered effort, not a default');
    assert.ok(i + 1 < a.indexOf('--'), 'the flag and its value must come before `--`');
  }
});

await ta('the registered effort is what reaches the argv: another registered level changes it', async () => {
  const { f } = await run({ effort: 'xhigh' });
  for (const c of f.calls.claude) assert.equal(c.args[c.args.indexOf('--effort') + 1], 'xhigh');
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

await ta('each run reaches the hook as rate "1" (holdout) or "0" (treated), in the seeded plan order; temp root is removed', async () => {
  const { f, p } = await run({ holdoutRate: 0.25, repeats: 4 });
  const calls = f.calls.claude.slice(1); // call 0 is the canary
  assert.ok(f.calls.claude.every((c) => ['0', '1'].includes(c.opts.env.EFFORT_STEERING_HOLDOUT_RATE)));
  // the calls follow planRuns(prereg) exactly: same prompts, same arms, same order
  assert.deepEqual(calls.map((c) => [p.prompts.indexOf(c.args.at(-1)), plannedOf(c)]), shape(planRuns(p)));
  for (let i = 0; i < 4; i++) assert.equal(calls.filter((c) => c.args.at(-1) === p.prompts[i] && plannedOf(c) === 'holdout').length, 1);
  const c = calls[0];
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
    const result = await runExperiment(file, { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent, esRoot: CLEAN_ES });
    assert.ok(path.isAbsolute(f.calls.claude[0].opts.env.XDG_STATE_HOME));
    assert.ok(path.isAbsolute(f.calls.claude[0].opts.cwd));
    assert.ok(path.isAbsolute(f.calls.claude[0].opts.env.TMPDIR), 'the child TMPDIR is resolved');
    assert.equal(f.calls.claude[0].opts.env.TMPDIR, path.join(base, 'rel'));
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

await ta('rows join arm with deduped transcript tokens (R3) and carry the prompt index', async () => {
  const { result } = await run();
  const a = result.analysis;
  assert.equal(a.nTreated, 4); // 1 treated + 2 holdout per prompt (holdoutRate 0.5 of 3)
  assert.equal(a.nHoldout, 8);
  assert.equal(a.nPrompts, 4);
  assert.deepEqual(a.perPrompt.map((g) => [g.promptIndex, g.nTreated, g.nHoldout]), [[0, 1, 2], [1, 1, 2], [2, 1, 2], [3, 1, 2]]);
  assert.equal(a.medianTreated, 80); // 50 + 30; an un-deduped A would give 130
  assert.equal(a.medianHoldout, 400);
  assert.equal(a.signedDelta, 320);
  assert.equal(a.cacheShareTreated, 20 / 165); // cache_creation 20 over input_total 60 + 105
  assert.equal(result.excluded, 0);
  assert.deepEqual(result.excludedByReason, reasons());
});

await ta('runs with no log file are excluded and counted, never treated as holdout; stop has runs_excluded', async () => {
  const { result } = await run({}, { plan: firstOf('holdout', 2, { nolog: true }) });
  assert.equal(result.excluded, 2);
  assert.deepEqual(result.excludedByReason, reasons({ no_log: 2 }));
  assert.equal(result.analysis.nTreated, 4);
  assert.equal(result.analysis.nHoldout, 6);
  assert.equal(result.verdict, 'mechanism_pass');
  assert.deepEqual(result.stop, ['runs_excluded']);
});

await ta('runs with no transcript are excluded and counted', async () => {
  const { result } = await run({}, { plan: firstOf('holdout', 2, { notranscript: true }) });
  assert.equal(result.excluded, 2);
  assert.deepEqual(result.excludedByReason, reasons({ no_transcript: 2 }));
  assert.equal(result.analysis.nTreated, 4);
  assert.equal(result.analysis.nHoldout, 6);
});

await ta('a transcript found in two project dirs is excluded as ambiguous_transcript', async () => {
  const { result } = await run({}, { plan: firstOf('holdout', 2, { dup: true }) });
  assert.deepEqual(result.excludedByReason, reasons({ ambiguous_transcript: 2 }));
  assert.equal(result.analysis.nHoldout, 6);
});

await ta('runs recorded at another effort than the registered one are excluded as effort_mismatch and counted; stop has runs_excluded', async () => {
  const { result } = await run({}, { plan: firstOf('holdout', 2, { effort: 'medium' }) });
  assert.equal(result.excluded, 2);
  assert.deepEqual(result.excludedByReason, reasons({ effort_mismatch: 2 }));
  assert.equal(result.analysis.nTreated, 4);
  assert.equal(result.analysis.nHoldout, 6);
  assert.deepEqual(result.stop, ['runs_excluded']);
});

await ta('a failed claude run (error, signal or non-zero status) is excluded as spawn_failed even with a log and transcript', async () => {
  const kinds = ['status', 'signal', 'error'];
  let n = 0;
  const { result } = await run({}, { plan: (i, c) => (c.planned === 'holdout' && n < 3 ? { spawn: kinds[n++] } : {}) });
  assert.deepEqual(result.excludedByReason, reasons({ spawn_failed: 3 }));
  assert.equal(result.analysis.nHoldout, 5);
  assert.equal(result.analysis.nTreated, 4);
  assert.ok(result.stop.includes('runs_excluded'));
});

await ta('API-error transcripts (flag only, or synthetic model only) are excluded as api_error', async () => {
  const kinds = ['flag', 'model'];
  let n = 0;
  const { result } = await run({}, { plan: (i, c) => (c.planned === 'holdout' && n < 2 ? { apierr: kinds[n++] } : {}) });
  assert.deepEqual(result.excludedByReason, reasons({ api_error: 2 }));
  assert.equal(result.analysis.nHoldout, 6);
});

await ta('FALSE-GO scenario: 3 of 4 treated runs fail with API-error records -> excluded, insufficient_data, runs_excluded', async () => {
  const { result } = await run({}, { plan: firstOf('treated', 3, { apierr: 'model', spawn: 'status' }) });
  assert.equal(result.excluded, 3);
  assert.equal(result.analysis.nTreated, 1);
  assert.equal(result.verdict, 'insufficient_data');
  assert.ok(result.stop.includes('insufficient_data'));
  assert.ok(result.stop.includes('runs_excluded'));
  // the same failures with a successful exit code still never become zero-thinking rows
  const again = await run({}, { plan: firstOf('treated', 3, { apierr: 'model' }) });
  assert.equal(again.result.excludedByReason.api_error, 3);
  assert.equal(again.result.verdict, 'insufficient_data');
});

// ---- R24 / I-1: the logged arm and steering must match the plan ---------------------------

await ta('a run whose logged arm differs from the planned arm is excluded as arm_mismatch', async () => {
  const { result } = await run({}, { plan: firstOf('holdout', 2, { arm: 'treated' }) });
  assert.deepEqual(result.excludedByReason, reasons({ arm_mismatch: 2 }));
  assert.equal(result.analysis.nTreated, 4, 'a mislabelled run must not join the treated arm');
  assert.equal(result.analysis.nHoldout, 6);
  assert.ok(result.stop.includes('runs_excluded'));
});

await ta('a treated run that was not steered is excluded as not_steered; a steered holdout as steered_holdout', async () => {
  const a = await run({}, { plan: firstOf('treated', 1, { steered: false }) });
  assert.deepEqual(a.result.excludedByReason, reasons({ not_steered: 1 }));
  assert.equal(a.result.analysis.nTreated, 3);
  const b = await run({}, { plan: firstOf('holdout', 1, { steered: true }) });
  assert.deepEqual(b.result.excludedByReason, reasons({ steered_holdout: 1 }));
  assert.equal(b.result.analysis.nHoldout, 7);
});

// ---- confirm gate -------------------------------------------------------------------------

await ta('without confirm: prints the call count (runs + canary) and spawns no hook and no claude', async () => {
  const f = fakeEnv({ configDir: tmp() });
  const lines = [];
  const file = put(prereg());
  const result = await runExperiment(file, { spawn: f.spawn, out: (s) => lines.push(s), esRoot: CLEAN_ES });
  assert.equal(total(f), 0);
  assert.equal(result.verdict, 'not_run');
  assert.deepEqual(result.stop, ['not_confirmed']);
  assert.equal(result.plannedCalls, 13);
  assert.equal(result.claudeCalls, 0);
  assert.match(lines.join('\n'), /13 model calls \(12 runs \+ 1 canary/);
  for (const bad of [undefined, false, 'true', 1]) {
    await runExperiment(file, { spawn: f.spawn, confirm: bad, out: silent, esRoot: CLEAN_ES });
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

// ---- I-3c: the latency gate sees a hook that falls back or does not log -----------------

await ta('a hook that alerts on stderr (falls back on every call) fails the latency gate: ZERO claude calls', async () => {
  const { result, f } = await run({}, { hookResult: () => ({ status: 0, stderr: 'effort-steering: adapter_cli_failed\n' }) });
  assert.equal(f.calls.claude.length, 0);
  assert.deepEqual(result.stop, ['latency_not_ok']);
  assert.equal(result.latency.failures, 12);
  // one alert among quiet runs is enough
  const one = await run({}, { hookResult: (i) => (i === 7 ? { stderr: 'x\neffort-steering: adapter_timeout\n' } : {}) });
  assert.equal(one.result.latency.failures, 1);
  assert.deepEqual(one.result.stop, ['latency_not_ok']);
});

await ta('a hook that writes no log line for its session fails the latency gate: ZERO claude calls', async () => {
  const { result, f } = await run({}, { hookResult: (i) => (i === 3 ? { nolog: true } : {}) });
  assert.equal(f.calls.claude.length, 0);
  assert.equal(result.latency.failures, 1);
  assert.deepEqual(result.stop, ['latency_not_ok']);
});

t('measureHookLatency: a log line for ANOTHER session does not count as this run logging', () => {
  // in another session's file
  const elsewhere = (cmd, args, opts) => {
    writeHookLog({ ...opts, input: JSON.stringify({ session_id: 'someone-else' }) });
    return { status: 0, stdout: '', stderr: '' };
  };
  // in this session's file, but naming another session
  const misnamed = (cmd, args, opts) => {
    const sid = JSON.parse(opts.input).session_id;
    const dir = stateDirFor(opts.env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${sid}.jsonl`), `not json\n${JSON.stringify({ session_id: 'someone-else', arm: 'treated' })}\n`);
    return { status: 0, stdout: '', stderr: '' };
  };
  for (const spawn of [elsewhere, misnamed]) {
    const r = measureHookLatency(prereg(), { spawn, now: clockOf(new Array(12).fill(1)) });
    assert.equal(r.failures, 12);
    assert.equal(r.ok, false);
  }
});

t('measureHookLatency with the REAL copied hook and CLI: every run logs, nothing alerts, the gate holds', () => {
  const r = measureHookLatency(prereg({ latencyBudgetMs: 20000 }), { esRoot: CLEAN_ES });
  assert.equal(r.n, 12);
  assert.equal(r.failures, 0);
  assert.equal(r.ok, true);
});

t('measureHookLatency with a REAL hook whose CLI always fails: the hook still exits 0, but the gate fails', () => {
  const broken = makeTree((es) => writeFileSync(path.join(es, 'bin', 'effort-policy.mjs'), 'process.exit(1);\n'));
  const r = measureHookLatency(prereg({ latencyBudgetMs: 20000 }), { esRoot: broken });
  assert.equal(r.failures, 12);
  assert.equal(r.ok, false);
});

// ---- I-1: steerability preflight ---------------------------------------------------------

await ta('a prompt that does not steer (ultrathink: user_override) refuses with its INDEX and ZERO hook or claude calls', async () => {
  for (const confirm of [true, false]) {
    const configDir = tmp();
    const f = fakeEnv({ configDir });
    const lines = [];
    const file = put(prereg({ prompts: ['p one', 'p two', 'please ultrathink this', 'p four'] }));
    const result = await runExperiment(file, { spawn: f.spawn, confirm, configDir, now: f.now, out: (s) => lines.push(s), esRoot: CLEAN_ES });
    assert.equal(total(f), 0, `confirm ${confirm}`);
    assert.equal(result.verdict, 'not_run');
    assert.deepEqual(result.stop, ['prompt_not_steerable']);
    assert.deepEqual(result.notSteerable, [2]);
    assert.equal(result.claudeCalls, 0);
    assert.ok(!JSON.stringify(result).includes('ultrathink'), 'prompt text must not reach the result');
    assert.ok(!lines.join('\n').includes('ultrathink'), 'prompt text must not be printed');
  }
});

await ta('the preflight runs the COPY: a copy whose table is unreadable steers nothing and is refused', async () => {
  const noTable = makeTree((es, repo) => {
    rmSync(path.join(es, 'core', 'steer.table.json'));
    git(repo, 'commit', '-q', '-a', '-m', 'drop the table');
  });
  const configDir = tmp();
  const f = fakeEnv({ configDir });
  const result = await runExperiment(put(prereg()), { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent, esRoot: noTable });
  assert.deepEqual(result.stop, ['prompt_not_steerable']);
  assert.deepEqual(result.notSteerable, [0, 1, 2, 3]);
  assert.equal(total(f), 0);
});

await ta('the preflight refuses an empty steer too (the hook treats "" as no steering)', async () => {
  const emptySteer = makeTree((es, repo) => {
    writeFileSync(path.join(es, 'bin', 'effort-policy.mjs'), `process.stdout.write(${JSON.stringify(`${JSON.stringify({ level: 'shallow', confidence: 'high', reasons: ['s4-all'], steer: '', arm: 'treated' })}\n`)});\n`);
    git(repo, 'commit', '-q', '-a', '-m', 'empty steer');
  });
  const configDir = tmp();
  const f = fakeEnv({ configDir });
  const result = await runExperiment(put(prereg()), { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent, esRoot: emptySteer });
  assert.deepEqual(result.stop, ['prompt_not_steerable']);
  assert.deepEqual(result.notSteerable, [0, 1, 2, 3]);
  assert.equal(total(f), 0);
});

// ---- M-1: the copied tree must equal its commit -------------------------------------------

await ta('a dirty tree (modified, untracked or ignored file) refuses with dirty_tree and ZERO spawns, with or without confirm', async () => {
  const dirty = [
    makeTree((es) => appendFileSync(path.join(es, 'core', 'rules.json'), ' ')),
    makeTree((es) => writeFileSync(path.join(es, 'adapter', 'new.mjs'), '')),
    makeTree((es, repo) => {
      writeFileSync(path.join(repo, '.gitignore'), '*.local\n');
      git(repo, 'add', '.gitignore');
      git(repo, 'commit', '-q', '-m', 'ignore');
      writeFileSync(path.join(es, 'core', 'x.local'), '');
    }),
  ];
  for (const es of dirty) {
    for (const confirm of [true, false]) {
      const configDir = tmp();
      const f = fakeEnv({ configDir });
      const result = await runExperiment(put(prereg()), { spawn: f.spawn, confirm, configDir, now: f.now, out: silent, esRoot: es });
      assert.deepEqual(result.stop, ['dirty_tree'], `${es} confirm ${confirm}`);
      assert.equal(result.verdict, 'not_run');
      assert.equal(total(f), 0);
      assert.equal(result.treeCommit, treeHead(es));
    }
  }
  // a change OUTSIDE effort-steering/ does not count
  const outside = makeTree((es, repo) => writeFileSync(path.join(repo, 'unrelated.txt'), 'x'));
  const { result } = await run({}, {}, { esRoot: outside });
  assert.notDeepEqual(result.stop, ['dirty_tree']);
  assert.equal(result.verdict, 'mechanism_pass');
});

await ta('an inherited GIT_DIR cannot vouch for a dirty tree (the status runs with the GIT_* scrub)', async () => {
  // A second repo whose committed effort-steering/ equals the DIRTY content: an unscrubbed
  // `git status` pointed at it by GIT_DIR would call the dirty tree clean.
  const dirtyEs = makeTree((es) => appendFileSync(path.join(es, 'core', 'rules.json'), ' '));
  const forger = path.join(ROOT, 'forger');
  cpSync(dirtyEs, path.join(forger, 'effort-steering'), { recursive: true });
  git(forger, 'init', '-q');
  git(forger, 'add', '-A');
  git(forger, 'commit', '-q', '-m', 'forged');
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(forger, '.git');
  try {
    const configDir = tmp();
    const f = fakeEnv({ configDir });
    const result = await runExperiment(put(prereg()), { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent, esRoot: dirtyEs });
    assert.deepEqual(result.stop, ['dirty_tree']);
    assert.equal(total(f), 0);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }
});

await ta('a tree that is not in a git repository refuses with dirty_tree', async () => {
  const loose = path.join(tmp(), 'effort-steering');
  for (const dir of ['bin', 'core', 'adapter']) cpSync(path.join(CLEAN_ES, dir), path.join(loose, dir), { recursive: true });
  const configDir = tmp();
  const f = fakeEnv({ configDir });
  const result = await runExperiment(put(prereg()), { spawn: f.spawn, confirm: true, configDir, now: f.now, out: silent, esRoot: loose });
  assert.deepEqual(result.stop, ['dirty_tree']);
  assert.equal(result.treeCommit, null);
  assert.equal(total(f), 0);
});

// ---- E (I-4): one excluded canary run before the planned runs ----------------------------

await ta('the canary is the FIRST claude call: prompt 0, treated, a fresh session id; it is not a row', async () => {
  const { result, f, p } = await run();
  const [canary, ...rest] = f.calls.claude;
  assert.equal(canary.args.at(-1), p.prompts[0]);
  assert.equal(canary.opts.env.EFFORT_STEERING_HOLDOUT_RATE, '0');
  assert.ok(!rest.some((c) => sidOf(c.args) === sidOf(canary.args)));
  assert.equal(rest.length, 12);
  assert.deepEqual(result.canary, { ok: true });
  assert.equal(result.claudeCalls, 13);
  // the planned plan has 4 treated runs; the canary would make it 5
  assert.equal(result.analysis.nTreated, 4);
  assert.equal(result.analysis.perPrompt[0].nTreated, 1);
});

await ta('a failed canary stops after exactly ONE claude call, whatever failed', async () => {
  const kinds = [
    [{ nolog: true }, 'no_log'],
    [{ spawn: 'status' }, 'spawn_failed'],
    [{ spawn: 'signal' }, 'spawn_failed'],
    [{ notranscript: true }, 'no_transcript'],
    [{ apierr: 'model' }, 'api_error'],
    [{ steered: false }, 'not_steered'],
    [{ arm: 'holdout', steered: false }, 'arm_mismatch'],
    [{ dup: true }, 'ambiguous_transcript'],
    [{ effort: 'medium' }, 'effort_mismatch'],
    [{ effort: null }, 'effort_mismatch'],
  ];
  for (const [fields, reason] of kinds) {
    const { result, f } = await run({}, { plan: (i) => (i === 0 ? fields : {}) });
    assert.equal(f.calls.claude.length, 1, reason);
    assert.equal(result.verdict, 'not_run');
    assert.deepEqual(result.stop, ['canary_failed']);
    assert.deepEqual(result.canary, { ok: false, reason });
    assert.equal(result.claudeCalls, 1);
    assert.equal(result.latency.ok, true);
  }
});

// ---- R-PL6: a plan-limit refusal aborts the experiment as not_run [plan_limit] ----------------
// The refusal is the verbatim CLI text of the brief's fact 1 (a message `claude -p` prints when the
// subscription is spent). That a plain `-p` run prints it on stdout and not on stderr is NOT verified,
// so the detector reads both and so do these vectors. The fake `spawn` is the only thing that runs.

const REFUSAL = "You've hit your limit · resets 3pm";
const HIT_STDOUT = { source: 'stdout', matched: REFUSAL, resetHint: 'resets 3pm', rateLimitType: null, resetsAt: null };
const HIT_STDERR = { ...HIT_STDOUT, source: 'stderr' };
// The plan for call `k` (call 0 is the canary): print `fields` there, behave normally elsewhere.
const atCall = (k, fields) => (i) => (i === k ? fields : {});

await ta('R-PL6: a refusal on the CANARY aborts as not_run [plan_limit] after exactly ONE claude call, with the hit and the call count', async () => {
  const { result, f } = await run({}, { plan: atCall(0, { stdout: REFUSAL }) });
  assert.equal(f.calls.claude.length, 1);
  assert.equal(result.verdict, 'not_run');
  assert.deepEqual(result.stop, ['plan_limit']);
  assert.deepEqual(result.canary, { ok: false, reason: 'plan_limit' });
  assert.deepEqual(result.planLimit, HIT_STDOUT);
  assert.equal(result.claudeCalls, 1);
  assert.equal(result.analysis, null);
  assert.equal(result.latency.ok, true);
  // an abort produces no excluded run: REASONS (the excluded-run reasons) is untouched
  assert.equal(result.excluded, 0);
  assert.deepEqual(result.excludedByReason, reasons());
  assert.ok(!('plan_limit' in result.excludedByReason));
});

await ta('R-PL6: the canary is checked BEFORE the row is built: a refusal beats canary_failed whatever else went wrong', async () => {
  const kinds = [
    { nolog: true },
    { spawn: 'status' },
    { notranscript: true },
    { apierr: 'model' },
    { steered: false },
    { dup: true },
    { effort: 'medium' },
  ];
  for (const fields of kinds) {
    const { result, f } = await run({}, { plan: atCall(0, { stdout: REFUSAL, ...fields }) });
    assert.equal(f.calls.claude.length, 1, JSON.stringify(fields));
    assert.deepEqual(result.stop, ['plan_limit'], JSON.stringify(fields));
    assert.deepEqual(result.canary, { ok: false, reason: 'plan_limit' }, JSON.stringify(fields));
  }
});

await ta('R-PL6: stderr is read too: a refusal ONLY on stderr aborts the canary, and a refusal only on stdout is not lost to an empty stderr', async () => {
  const a = await run({}, { plan: atCall(0, { stderr: REFUSAL }) });
  assert.equal(a.f.calls.claude.length, 1);
  assert.deepEqual(a.result.stop, ['plan_limit']);
  assert.deepEqual(a.result.planLimit, HIT_STDERR);
  const b = await run({}, { plan: atCall(0, { stdout: REFUSAL, stderr: '' }) });
  assert.deepEqual(b.result.planLimit, HIT_STDOUT);
});

await ta('R-PL6: a refusal at run k aborts there: NO claude call after it (pinned for the first, a middle and the last planned run)', async () => {
  // call 0 is the canary; calls 1..12 are the planned runs (4 prompts x 3 repeats)
  for (const k of [1, 5, 12]) {
    const { result, f } = await run({}, { plan: atCall(k, { stdout: REFUSAL }) });
    assert.equal(f.calls.claude.length, k + 1, `k=${k}`);
    assert.equal(result.claudeCalls, k + 1, `k=${k}`);
    assert.equal(result.verdict, 'not_run');
    assert.deepEqual(result.stop, ['plan_limit']);
    assert.deepEqual(result.canary, { ok: true });
    assert.deepEqual(result.planLimit, HIT_STDOUT);
    assert.equal(result.latency.ok, true);
    // partial results are discarded: no analysis, no rows counted as excluded
    assert.equal(result.analysis, null);
    assert.equal(result.excluded, 0);
    assert.deepEqual(result.excludedByReason, reasons());
  }
});

await ta('R-PL6: the loop reads stderr too, and a refusal beats a failed process (a non-zero exit is not a spawn_failed exclusion)', async () => {
  const a = await run({}, { plan: atCall(4, { stderr: REFUSAL }) });
  assert.equal(a.f.calls.claude.length, 5);
  assert.deepEqual(a.result.stop, ['plan_limit']);
  assert.deepEqual(a.result.planLimit, HIT_STDERR);
  const b = await run({}, { plan: atCall(3, { spawn: 'status', stdout: REFUSAL }) });
  assert.equal(b.f.calls.claude.length, 4);
  assert.deepEqual(b.result.stop, ['plan_limit']);
  assert.equal(b.result.excluded, 0);
});

await ta('R-PL6: only the first hit counts: a run before it that printed ordinary text does not stop, and the hit carries the typed hit fields', async () => {
  const { result, f } = await run({}, { plan: (i) => (i === 2 ? { stdout: `${REFUSAL}\nthe plan resets at 3pm` } : { stdout: `answer ${i}\n` }) });
  assert.equal(f.calls.claude.length, 3);
  assert.deepEqual(Object.keys(result.planLimit).sort(), ['matched', 'rateLimitType', 'resetHint', 'resetsAt', 'source']);
  assert.equal(result.planLimit.source, 'stdout');
});

await ta('R-PL6: a clean experiment is unchanged: ordinary stdout and stderr on every call, 13 claude calls, no planLimit', async () => {
  const { result, f } = await run({}, { plan: (i) => ({ stdout: `answer ${i}\n`, stderr: 'warning: slow network\n' }) });
  assert.equal(f.calls.claude.length, 13);
  assert.equal(result.claudeCalls, 13);
  assert.equal(result.verdict, 'mechanism_pass');
  assert.deepEqual(result.stop, []);
  assert.deepEqual(result.canary, { ok: true });
  assert.equal(result.planLimit, undefined);
});

await ta('R-PL2/R-PL6: a refusal-looking sentence that is NOT at the start of the output does not stop (canary and loop, stdout and stderr)', async () => {
  const prose = [
    `Done. ${REFUSAL}`,
    `I fixed the limiter. ${REFUSAL}`,
    `The CLI prints "${REFUSAL}" when the plan is spent.`,
    `line one\n${REFUSAL}\nline three`,
    ` x${REFUSAL}`,
  ];
  for (const text of prose) {
    const { result, f } = await run({}, { plan: () => ({ stdout: text, stderr: text }) });
    assert.equal(f.calls.claude.length, 13, text);
    assert.deepEqual(result.stop, [], text);
    assert.equal(result.planLimit, undefined, text);
  }
});

await ta('R-PL6: leading whitespace before the refusal is still a hit (the detector trims it), so a CLI that pads its output cannot slip through', async () => {
  const { result, f } = await run({}, { plan: atCall(2, { stdout: `\n  ${REFUSAL}\n` }) });
  assert.equal(f.calls.claude.length, 3);
  assert.deepEqual(result.stop, ['plan_limit']);
});

await ta('R-PL6/A4: the abort result holds the 200-char refusal line and nothing else the child printed (no stdout, no stderr)', async () => {
  const tail = 'TAILMARK-model-text';
  const stdout = `${REFUSAL}\n${'x'.repeat(250)}${tail}`;
  const { result } = await run({}, { plan: atCall(1, { stdout, stderr: 'STDERRMARK' }) });
  assert.deepEqual(result.stop, ['plan_limit']);
  assert.equal(result.planLimit.matched.length, 200);
  const json = JSON.stringify(result);
  assert.ok(!json.includes(tail));
  assert.ok(!json.includes('STDERRMARK'));
  assert.ok(!('stdout' in result) && !('stderr' in result));
});

await ta('R-PL6: the operator is told, on out, which source matched and what it said; nothing is printed for a clean run', async () => {
  const lines = [];
  await run({}, { plan: atCall(2, { stdout: REFUSAL }) }, { out: (s) => lines.push(String(s)) });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(REFUSAL), lines[0]);
  assert.ok(lines[0].includes('stdout'), lines[0]);
  assert.match(lines[0], /plan limit/i);
  const quiet = [];
  await run({}, {}, { out: (s) => quiet.push(String(s)) });
  assert.deepEqual(quiet, []);
});

await ta('R-PL6: the header lists plan_limit among the STOP REASONS of a not_run result', async () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 's4-run.mjs'), 'utf8');
  const para = src.match(/STOP REASONS\.[^]*?\n\/\/\n/);
  assert.ok(para, 'STOP REASONS paragraph found');
  assert.match(para[0], /A not_run result holds one of:[^]*\bplan_limit\b/);
  assert.ok(para[0].indexOf('plan_limit') < para[0].indexOf('A completed run holds any of'), 'plan_limit is in the not_run list, not the completed list');
});

// ---- C (I-2): the claude children get a whitelisted environment ---------------------------

const withParentEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};
const LEAKY = {
  ANTHROPIC_BASE_URL: 'http://localhost:8082',
  ANTHROPIC_API_KEY: 'sk-test-not-real',
  ANTHROPIC_MODEL: 'x',
  CLAUDECODE: '1',
  CLAUDE_CODE_SESSION_ID: 'parent-session',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_PROJECT_DIR: '/work',
  NODE_OPTIONS: '--require /tmp/x.js',
  OTHER_SECRET: 'y',
};
const KEPT = { USER: 'u', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', LC_CTYPE: 'C.UTF-8', TERM: 'dumb', SHELL: '/bin/sh', CLAUDE_CONFIG_DIR: '/cfg/profile' };

await ta('the claude child env is a whitelist: no ANTHROPIC_*, CLAUDECODE, CLAUDE_CODE_*, CLAUDE_PROJECT_DIR or anything else', async () => {
  await withParentEnv({ ...LEAKY, ...KEPT }, async () => {
    const { result, f } = await run();
    const want = ['CLAUDE_CONFIG_DIR', 'EFFORT_STEERING_HOLDOUT_RATE', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PATH', 'SHELL', 'TERM', 'TMPDIR', 'USER', 'XDG_STATE_HOME'];
    assert.equal(f.calls.claude.length, 13);
    for (const c of f.calls.claude) {
      assert.deepEqual(Object.keys(c.opts.env).sort(), want);
      for (const k of Object.keys(LEAKY)) assert.ok(!(k in c.opts.env), k);
      for (const [k, v] of Object.entries(KEPT)) assert.equal(c.opts.env[k], v, k);
      assert.equal(c.opts.env.PATH, process.env.PATH);
      assert.equal(c.opts.env.HOME, process.env.HOME);
    }
    assert.deepEqual(result.childEnvKeys, want);
    assert.equal(result.endpoint, 'default');
    assert.ok(!JSON.stringify(result).includes('sk-test-not-real') && !JSON.stringify(result).includes('/cfg/profile'), 'names only, never values');
  });
});

await ta('CLAUDE_CONFIG_DIR is passed only when set and non-empty', async () => {
  for (const value of [undefined, '']) {
    await withParentEnv({ CLAUDE_CONFIG_DIR: value }, async () => {
      const { result, f } = await run();
      assert.ok(f.calls.claude.every((c) => !('CLAUDE_CONFIG_DIR' in c.opts.env)), JSON.stringify(value));
      assert.ok(!result.childEnvKeys.includes('CLAUDE_CONFIG_DIR'));
    });
  }
});

await ta('the latency hook env is PATH, HOME, the temp XDG_STATE_HOME and rate 0, nothing else', async () => {
  await withParentEnv(LEAKY, async () => {
    const { f } = await run();
    assert.equal(f.calls.hook.length, 12);
    for (const c of f.calls.hook) {
      assert.deepEqual(Object.keys(c.opts.env).sort(), ['EFFORT_STEERING_HOLDOUT_RATE', 'HOME', 'PATH', 'XDG_STATE_HOME']);
      assert.equal(c.opts.env.EFFORT_STEERING_HOLDOUT_RATE, '0');
    }
  });
});

await ta('every not_run result still names the endpoint and the env keys, and the commits', async () => {
  const dry = await runExperiment(put(prereg()), { spawn: fakeEnv({ configDir: tmp() }).spawn, out: silent, esRoot: CLEAN_ES });
  assert.equal(dry.endpoint, 'default');
  assert.ok(Array.isArray(dry.childEnvKeys) && dry.childEnvKeys.includes('PATH'));
  assert.ok(!dry.childEnvKeys.some((k) => k.startsWith('ANTHROPIC_')));
  assert.match(dry.preregCommit, /^[0-9a-f]{40}$/);
});

// ---- main: exact --confirm ----------------------------------------------------------------

const mainWith = async (argv, deps = {}) => {
  const configDir = tmp();
  const f = fakeEnv({ configDir });
  const file = put(prereg());
  const result = await main(argv, { spawn: f.spawn, preregFile: file, out: silent, configDir, now: f.now, esRoot: CLEAN_ES, ...deps });
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
    assert.equal(f.calls.claude.length, 13, JSON.stringify(argv));
    assert.equal(result.verdict, 'mechanism_pass');
  }
  for (const bad of ['--confirm', undefined, null, { includes: () => true }]) {
    await assert.rejects(main(bad, { spawn: fakeEnv({ configDir: tmp() }).spawn, preregFile: put(prereg()), out: silent, esRoot: CLEAN_ES }), TypeError);
  }
});

await ta('main with an uncommitted prereg throws before any spawn', async () => {
  const f = fakeEnv({ configDir: tmp() });
  await assert.rejects(main(['--confirm'], { spawn: f.spawn, preregFile: put(prereg(), { commit: false }), out: silent, esRoot: CLEAN_ES }), /prereg/);
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
  const { result } = await run({}, { plan: (i, c) => ({ cc: c.planned === 'treated' ? 90 : 5 }) });
  assert.equal(result.verdict, 'mechanism_pass');
  assert.equal(result.analysis.cacheOk, false);
  assert.deepEqual(result.stop, ['cache_not_ok']);
});

await ta('end to end: short arms give insufficient_data (one treated run excluded against minPerArm 4)', async () => {
  // minPerArm 5 would not load: the plan holds only 4 treated runs (R25). The shortfall comes from an exclusion.
  const { result } = await run({ minPerArm: 4 }, { plan: firstOf('treated', 1, { spawn: 'status' }) });
  assert.equal(result.excluded, 1);
  assert.equal(result.analysis.nTreated, 3);
  assert.equal(result.verdict, 'insufficient_data');
  assert.ok(result.stop.includes('insufficient_data'));
});

await ta('end to end: no effect gives mechanism_fail', async () => {
  const { result } = await run({}, { plan: () => ({ thinking: 100 }) });
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
    return okHook(cmd, args, opts);
  };
  const r = measureHookLatency(p, { spawn, now: clockOf(durs) });
  assert.deepEqual(r, { n: 20, p95Ms: 19, failures: 0, ok: true });
  assert.equal(measureHookLatency({ ...p, latencyBudgetMs: 18.99 }, { spawn, now: clockOf(durs) }).ok, false);
  assert.equal(calls.length, 40);
});

t('measureHookLatency: n=12 rounds the rank UP (ceil 11.4 = 12, index 11), not down', () => {
  const durs = Array.from({ length: 12 }, (_, i) => ((i * 5) % 12) + 1); // a permutation of 1..12
  const r = measureHookLatency(prereg({ latencyBudgetMs: 12 }), { spawn: okHook, now: clockOf(durs) });
  assert.equal(r.p95Ms, 12);
  assert.equal(r.ok, true);
});

t('measureHookLatency: a hook run that exits non-zero, is killed or errors fails the gate even when fast', () => {
  for (const bad of [{ status: 1 }, { status: 0, signal: 'SIGKILL' }, { status: 0, error: new Error('ETIMEDOUT') }, undefined]) {
    let i = 0;
    const spawn = (cmd, args, opts) => (i++ === 5 ? bad : okHook(cmd, args, opts));
    const r = measureHookLatency(prereg(), { spawn, now: clockOf(new Array(12).fill(1)) });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.failures, 1);
    assert.equal(r.p95Ms, 1);
  }
});

t('measureHookLatency runs the COPIED steering hook once per (prompt, repeat) with hook JSON on stdin and a temp state dir; the root is removed', () => {
  const p = prereg();
  const calls = [];
  const spawn = (cmd, args, opts) => {
    // read the copy's rules while it still exists (M-5: the measured path is the steering path)
    calls.push({ cmd, args, opts, rules: JSON.parse(readFileSync(path.join(path.dirname(args[0]), '..', '..', 'core', 'rules.json'), 'utf8')) });
    return okHook(cmd, args, opts);
  };
  measureHookLatency(p, { spawn, now: clockOf(new Array(12).fill(1)) });
  assert.equal(calls.length, 12);
  assert.ok(calls.every((c) => c.cmd === process.execPath && c.args[0].endsWith(path.join('adapter', 'claude-code', 'user-prompt-submit.mjs'))));
  assert.ok(calls.every((c) => !c.args[0].startsWith(ES_REAL) && c.args[0].startsWith(realpathSync(os.tmpdir()))), 'the hook is the scratch copy');
  assert.ok(calls.every((c) => c.rules.rules.length === 1 && c.rules.rules[0].id === 's4-all'));
  assert.ok(calls.every((c) => c.opts.env.EFFORT_STEERING_HOLDOUT_RATE === '0'));
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
