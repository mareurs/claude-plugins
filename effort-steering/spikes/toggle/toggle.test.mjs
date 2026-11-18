// toggle.test.mjs — the effort-toggle CLI (toggle.mjs) and the registration format (registration.mjs), on fixtures built in a temporary
// directory: a temp git repo for the committed-registration check, a fake work root for check-runs, a tiny runs directory for check-known.
//
//   TMPDIR=/home/marius/.cache/sdd-effort-toggle-tmp node --test effort-steering/spikes/toggle/toggle.test.mjs
//
// Never calls a model, runs Docker or touches a real run directory.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadS5Config } from '../s5/prereg.mjs';
import { ta } from '../s5/fixtures/testkit-async.mjs';
import { TOOL_TEXT_SHA256, loadRegistration, stageArmConfig } from './registration.mjs';
import { TOOL_DESCRIPTION } from './mod/hooks/register.ts';
import { GAP_LIMIT, main, parseFlags } from './toggle.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'toggle-cli-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

// ---- a temp git repo for the registrations ----
const ENV = { ...process.env };
for (const k of Object.keys(ENV)) if (k.startsWith('GIT_')) delete ENV[k];
ENV.HOME = ROOT;
ENV.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const REPO = join(ROOT, 'repo');
mkdirSync(REPO);
git(REPO, 'init', '-q');
git(REPO, 'commit', '-q', '--allow-empty', '-m', 'init');
let fileSeq = 0;
// Write `obj` (canonical JSON) into the repo and commit it; returns the path.
function committed(obj) {
  const file = join(REPO, `reg-${(fileSeq += 1)}.json`);
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  git(REPO, 'add', '--', file);
  git(REPO, 'commit', '-q', '-m', 'add', '--', file);
  return file;
}

// ---- the registration under test ----
const hex = (n) => n.toString(16).padStart(64, '0');
const digest = (n) => `sha256:${hex(n)}`;
const TASKS = ['cs-p20', 'cs-p01', 'cs-p05'];
const BASE = {
  model: 'claude-sonnet-5-5',
  cli: { version: '2.1.292', sha256: digest(0xc11) },
  arms: {
    A: { effort: 'xhigh', steer: false, runs: 9 },
    B: { effort: 'xhigh', steer: true, runs: 9 },
    C: { effort: 'low', steer: false, runs: 9 },
  },
  tasks: TASKS.map((id, i) => ({ id, treeHash: hex(0x100 + i), hiddenHash: hex(0x200 + i), promptHash: hex(0x300 + i) })),
  margin: 0.15,
  alpha: 0.05,
  bound: { method: 'paired-t', resamples: 0, seed: 1 },
  orderSeed: 11,
  mechanism: { alpha: 0.05, permutations: 1000, seed: 13, effectSizeThinkingTokens: 500 },
  limits: { timeoutMinutes: 90, cpus: 4, memoryGb: 16, concurrency: 2, infraRetries: 2 },
  images: { codescout: digest(0x1), 'claude-plugins': digest(0x2), proxy: digest(0x3) },
  proxyAllowlist: ['api.anthropic.com'],
  stopAtCostUsd: 100,
};
const arm = (s5Arm, runs, tasks, mod) => ({ s5Arm, runs, tasks, mod });
const STEP1 = {
  step: 1,
  base: BASE,
  arms: {
    L: arm('C', 2, TASKS, { mode: 'schedule', schedule: ['low'] }),
    X: arm('A', 2, TASKS, { mode: 'schedule', schedule: ['xhigh'] }),
    T: arm('C', 2, TASKS, { mode: 'toggle' }),
    P: arm('C', 2, TASKS, { mode: 'placebo' }),
  },
  toolTextSha256: TOOL_TEXT_SHA256,
  verdict: { qualityTask: 'cs-p20', qualityRuns: 8, otherRuns: 2, costEstimator: 'run' },
};
// The second registration commit: the random arm's two strata (ruling P17), parameters computed from T's runs.
const STEP1R = {
  ...STEP1,
  arms: {
    ...STEP1.arms,
    'R-quality': arm('C', 2, ['cs-p20'], { mode: 'random', random: { pUp: 0.1, pDown: 0.2, seed: 7 } }),
    'R-other': arm('C', 2, ['cs-p01', 'cs-p05'], { mode: 'random', random: { pUp: 0.3, pDown: 0.4, seed: 8 } }),
  },
};
const STEP0 = {
  step: 0,
  base: BASE,
  arms: {
    'F-L': arm('C', 4, ['cs-p20'], { mode: 'schedule', schedule: ['low'] }),
    'F-X': arm('A', 4, ['cs-p20'], { mode: 'schedule', schedule: ['xhigh'] }),
    'F-LX': arm('C', 4, ['cs-p20'], { mode: 'schedule', schedule: ['low', 'low', 'low', 'low', 'low', 'xhigh'] }),
    'F-XL': arm('A', 4, ['cs-p20'], { mode: 'schedule', schedule: ['xhigh', 'xhigh', 'xhigh', 'xhigh', 'xhigh', 'low'] }),
  },
  switchAt: 5,
  n: 4,
  extension: 4,
  toolTextSha256: TOOL_TEXT_SHA256,
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const cliIo = () => {
  const io = { logs: [], errs: [], log: (l) => io.logs.push(l), err: (l) => io.errs.push(l) };
  return io;
};
const outPath = (name) => join(ROOT, 'out', name);

// ---- parseFlags ----
await ta('parseFlags: strings, integers, repeating lists; unknown flags, missing values and bad integers are usage errors', async () => {
  const spec = { arm: 'string', runs: 'int', evidence: 'list' };
  assert.deepEqual(parseFlags(['--arm', 'T', '--runs', '6', '--evidence', 'a=1', '--evidence', 'b=2'], spec), { arm: 'T', runs: 6, evidence: ['a=1', 'b=2'] });
  for (const bad of [['--nope', 'x'], ['--arm'], ['--arm', '--runs'], ['--runs', '1.5'], ['--runs', '-1'], ['--runs', 'x'], ['stray']]) {
    assert.throws(() => parseFlags(bad, spec), /./, JSON.stringify(bad));
  }
});

// ---- stage-config ----
await ta('stage-config writes a config loadS5Config accepts, with only s5Arm runs set, the arm tasks and the arm mod', async () => {
  const reg = committed(STEP1);
  for (const [name, s5Arm, other] of [['T', 'C', 'A'], ['X', 'A', 'C'], ['P', 'C', 'A']]) {
    const out = outPath(`stage-${name}.json`);
    const io = cliIo();
    assert.equal(await main(['stage-config', '--registration', reg, '--arm', name, '--out', out], io), 0, io.errs.join('\n'));
    const cfg = loadS5Config(out, { mode: 'calibrate' });
    assert.equal(cfg.arms[s5Arm].runs, STEP1.arms[name].runs, name);
    assert.equal(cfg.arms[other].runs, 0, name);
    assert.equal(cfg.arms.B.runs, 0, name);
    assert.deepEqual(cfg.tasks.map((t) => t.id), STEP1.arms[name].tasks, name);
    assert.deepEqual(cfg.mod, STEP1.arms[name].mod, name);
    assert.equal(readFileSync(out, 'utf8'), `${JSON.stringify(JSON.parse(readFileSync(out, 'utf8')), null, 2)}\n`, 'canonical text');
  }
});

await ta('stage-config --runs 6 changes only arms.<s5Arm>.runs (not the mod, the tasks or anything else of the base)', async () => {
  const reg = committed(STEP1R);
  for (const name of ['T', 'X', 'R-quality']) {
    const plain = outPath(`plain-${name}.json`);
    const more = outPath(`more-${name}.json`);
    assert.equal(await main(['stage-config', '--registration', reg, '--arm', name, '--out', plain], cliIo()), 0);
    assert.equal(await main(['stage-config', '--registration', reg, '--arm', name, '--runs', '6', '--out', more], cliIo()), 0);
    const a = JSON.parse(readFileSync(plain, 'utf8'));
    const b = JSON.parse(readFileSync(more, 'utf8'));
    const s5Arm = STEP1R.arms[name].s5Arm;
    assert.equal(b.arms[s5Arm].runs, 6, name);
    b.arms[s5Arm].runs = a.arms[s5Arm].runs;
    assert.deepEqual(b, a, name);
  }
  const bad = cliIo();
  assert.equal(await main(['stage-config', '--registration', reg, '--arm', 'T', '--runs', '0', '--out', outPath('zero.json')], bad), 64);
});

await ta('stageArmConfig: a task the base lacks, an unknown arm and a bad run count are refused', async () => {
  const reg = clone(STEP1);
  reg.arms.T.tasks = ['cs-p20', 'cs-nope'];
  assert.throws(() => stageArmConfig(reg, 'T'), /cs-nope/);
  assert.throws(() => stageArmConfig(STEP1, 'Z'), /no arm "Z"/);
  assert.throws(() => stageArmConfig(STEP1, 'T', -1), /runs/);
  assert.throws(() => stageArmConfig(STEP1, 'T', 1.5), /runs/);
});

// ---- loadRegistration ----
await ta('loadRegistration accepts committed step 0 and step 1 registrations and returns them', async () => {
  assert.deepEqual(loadRegistration(committed(STEP1)), STEP1);
  assert.deepEqual(loadRegistration(committed(STEP0)), STEP0);
  assert.deepEqual(loadRegistration(committed(STEP1R)), STEP1R);
  const oneTask = clone(STEP1);
  oneTask.arms = Object.fromEntries(Object.entries(oneTask.arms).map(([k, a]) => [k, { ...a, tasks: ['cs-p20'] }]));
  assert.deepEqual(loadRegistration(committed(oneTask)), oneTask);
  oneTask.arms['R-quality'] = STEP1R.arms['R-quality'];
  assert.deepEqual(loadRegistration(committed(oneTask)), oneTask, 'R-quality alone when T has no other task');
});

await ta('loadRegistration refuses an untracked file, a modified file and a staged-only change', async () => {
  const loose = join(REPO, 'loose.json');
  writeFileSync(loose, `${JSON.stringify(STEP1, null, 2)}\n`);
  assert.throws(() => loadRegistration(loose), /not committed/);
  const reg = committed(STEP1);
  writeFileSync(reg, `${JSON.stringify({ ...STEP1, verdict: { ...STEP1.verdict, qualityRuns: 9 } }, null, 2)}\n`);
  assert.throws(() => loadRegistration(reg), /differs from HEAD/);
  git(REPO, 'add', '--', reg);
  assert.throws(() => loadRegistration(reg), /differs from HEAD/);
  // outside any repo
  const plain = join(ROOT, 'plain.json');
  writeFileSync(plain, `${JSON.stringify(STEP1, null, 2)}\n`);
  assert.throws(() => loadRegistration(plain), /not committed/);
});

await ta('loadRegistration refuses a toolTextSha256 that does not match TOOL_DESCRIPTION', async () => {
  assert.equal(TOOL_TEXT_SHA256.length, 64);
  assert.notEqual(TOOL_DESCRIPTION, '');
  for (const sha of [hex(1), TOOL_TEXT_SHA256.toUpperCase(), `sha256:${TOOL_TEXT_SHA256}`, TOOL_TEXT_SHA256.slice(1)]) {
    assert.throws(() => loadRegistration(committed({ ...STEP1, toolTextSha256: sha })), /toolTextSha256/, sha);
  }
});

await ta('loadRegistration refuses a malformed registration, naming the field', async () => {
  const mutate = (fn, base = STEP1) => {
    const r = clone(base);
    fn(r);
    return r;
  };
  const cases = [
    ['step', mutate((r) => { r.step = 2; })],
    ['extra', mutate((r) => { r.extra = 1; })],
    ['switchAt', mutate((r) => { r.switchAt = 5; })],
    ['verdict', mutate((r) => { r.verdict = STEP1.verdict; }, STEP0)],
    ['verdict.costEstimator', mutate((r) => { r.verdict.costEstimator = 'mean'; })],
    ['verdict.costEstimator', mutate((r) => { delete r.verdict.costEstimator; })],
    ['verdict.qualityRuns', mutate((r) => { r.verdict.qualityRuns = 0; })],
    ['arms.T.tasks', mutate((r) => { r.verdict.qualityTask = 'cs-p01'; r.arms.T.tasks = ['cs-p20']; })],
    ['arms.Z', mutate((r) => { r.arms.Z = r.arms.T; })],
    ['arms.F-L', mutate((r) => { r.arms['F-L'] = r.arms.L; })],
    ['arms.P', mutate((r) => { delete r.arms.P; })],
    ['arms.T.mod.mode', mutate((r) => { r.arms.T.mod = { mode: 'placebo' }; })],
    ['arms.L.mod.schedule', mutate((r) => { r.arms.L.mod.schedule = ['low', 'xhigh']; })],
    ['arms.X.mod.schedule', mutate((r) => { r.arms.X.mod.schedule = ['low']; })],
    ['arms.T.s5Arm', mutate((r) => { r.arms.T.s5Arm = 'B'; })],
    ['arms.T.s5Arm', mutate((r) => { r.arms.T.s5Arm = 'A'; })], // A is xhigh in the base; T starts at low
    ['arms.T.runs', mutate((r) => { r.arms.T.runs = -1; })],
    ['arms.T.tasks', mutate((r) => { r.arms.T.tasks = []; })],
    ['arms.T.tasks', mutate((r) => { r.arms.T.tasks = ['cs-p20', 'cs-p20']; })],
    ['cs-nope', mutate((r) => { for (const n of ['L', 'X', 'T', 'P']) r.arms[n].tasks = ['cs-nope']; r.verdict.qualityTask = 'cs-nope'; })],
    ['mod.random.seed', mutate((r) => { r.arms['R-quality'].mod.random.seed = 4294967296; }, STEP1R)],
    ['mod', mutate((r) => { r.arms.T.mod.extra = 1; })],
    ['model', mutate((r) => { delete r.base.model; })],
    ['switchAt', mutate((r) => { r.switchAt = 0; }, STEP0)],
    ['extension', mutate((r) => { r.extension = -1; }, STEP0)],
  ];
  for (const [field, reg] of cases) {
    assert.throws(() => loadRegistration(committed(reg)), (err) => err.message.includes(field), `${field}: ${JSON.stringify(reg).slice(0, 80)}`);
  }
});

// ---- the design is tied to the numbers of the file (ruling P15, P17) ----
await ta('loadRegistration refuses a step 0 design that is not the spec: swapped, never-switching, switching-back, wrong-switch-point schedules, runs, tasks', async () => {
  const mutate = (fn, base = STEP0) => {
    const r = clone(base);
    fn(r);
    return r;
  };
  const low5 = ['low', 'low', 'low', 'low', 'low'];
  const high5 = ['xhigh', 'xhigh', 'xhigh', 'xhigh', 'xhigh'];
  const cases = [
    ['arms.F-LX.mod.schedule', 'swapped: F-LX with the F-XL schedule', (r) => { r.arms['F-LX'].mod.schedule = [...high5, 'low']; }],
    ['arms.F-XL.mod.schedule', 'swapped: F-XL with the F-LX schedule', (r) => { r.arms['F-XL'].mod.schedule = [...low5, 'xhigh']; }],
    ['arms.F-LX.mod.schedule', 'never switches', (r) => { r.arms['F-LX'].mod.schedule = ['low']; }],
    ['arms.F-LX.mod.schedule', 'never switches (all low)', (r) => { r.arms['F-LX'].mod.schedule = [...low5, 'low']; }],
    ['arms.F-LX.mod.schedule', 'switches back', (r) => { r.arms['F-LX'].mod.schedule = [...low5, 'xhigh', 'low']; }],
    ['arms.F-LX.mod.schedule', 'switch point one early', (r) => { r.arms['F-LX'].mod.schedule = ['low', 'low', 'low', 'low', 'xhigh']; }],
    ['arms.F-LX.mod.schedule', 'switch point one late', (r) => { r.arms['F-LX'].mod.schedule = [...low5, 'low', 'xhigh']; }],
    ['arms.F-XL.mod.schedule', 'F-XL switch point one early', (r) => { r.arms['F-XL'].mod.schedule = ['xhigh', 'xhigh', 'xhigh', 'xhigh', 'low']; }],
    ['arms.F-XL.mod.schedule', 'F-XL switches back', (r) => { r.arms['F-XL'].mod.schedule = [...high5, 'low', 'xhigh']; }],
    ['arms.F-LX.mod.schedule', 'switchAt 3 with the switchAt 5 schedule', (r) => { r.switchAt = 3; }],
    ['switchAt', 'switchAt not an integer', (r) => { r.switchAt = 5.5; }],
    ['switchAt', 'switchAt not a safe integer', (r) => { r.switchAt = 2 ** 60; }],
    ['arms.F-LX.s5Arm must be \'C\'', 'F-LX on A', (r) => { r.arms['F-LX'].s5Arm = 'A'; }],
    ['arms.F-XL.s5Arm must be \'A\'', 'F-XL on C', (r) => { r.arms['F-XL'].s5Arm = 'C'; }],
    ['arms.F-X.s5Arm must be \'A\'', 'F-X on C', (r) => { r.arms['F-X'].s5Arm = 'C'; }],
    ['arms.F-L.s5Arm must be \'C\'', 'F-L on A', (r) => { r.arms['F-L'].s5Arm = 'A'; }],
    ['arms.F-L.mod.schedule', 'F-L with a longer one-level schedule', (r) => { r.arms['F-L'].mod.schedule = ['low', 'low']; }],
    ['arms.F-X.mod.schedule', 'F-X with a longer one-level schedule', (r) => { r.arms['F-X'].mod.schedule = ['xhigh', 'xhigh']; }],
    ['arms.F-LX.mod.schedule', 'xhigh inside the prefix (index 4)', (r) => { r.arms['F-LX'].mod.schedule = ['low', 'low', 'low', 'low', 'xhigh', 'xhigh']; }],
    ['arms.F-LX.mod.schedule', 'xhigh inside the prefix (index 0)', (r) => { r.arms['F-LX'].mod.schedule = ['xhigh', 'low', 'low', 'low', 'low', 'xhigh']; }],
    ['arms.F-XL.mod.schedule', 'low inside the prefix (index 4)', (r) => { r.arms['F-XL'].mod.schedule = ['xhigh', 'xhigh', 'xhigh', 'xhigh', 'low', 'low']; }],
    ['arms.F-LX.runs', 'runs != n', (r) => { r.arms['F-LX'].runs = 3; }],
    ['arms.F-X.runs', 'runs != n (more)', (r) => { r.arms['F-X'].runs = 5; }],
    ['arms.F-L.tasks', 'two tasks', (r) => { r.arms['F-L'].tasks = ['cs-p20', 'cs-p01']; }],
    ['arms.F-LX.tasks', 'F-LX on another task', (r) => { r.arms['F-LX'].tasks = ['cs-p01']; }],
    ['arms.F-XL.tasks', 'F-XL on another task', (r) => { r.arms['F-XL'].tasks = ['cs-p05']; }],
  ];
  for (const [field, label, fn] of cases) {
    assert.throws(() => loadRegistration(committed(mutate(fn))), (err) => err.message.includes(field), `${label}`);
  }
  // other switch points load when the schedules say so
  const three = mutate((r) => {
    r.switchAt = 3;
    r.arms['F-LX'].mod.schedule = ['low', 'low', 'low', 'xhigh'];
    r.arms['F-XL'].mod.schedule = ['xhigh', 'xhigh', 'xhigh', 'low'];
  });
  assert.deepEqual(loadRegistration(committed(three)), three);
});

await ta('loadRegistration refuses a step 1 design that is not the spec: run counts, quality task, T and P tasks, L and X subsets, the random strata', async () => {
  const mutate = (fn, base = STEP1) => {
    const r = clone(base);
    fn(r);
    return r;
  };
  const cases = [
    ['arms.T.runs', 'T runs != otherRuns', (r) => { r.arms.T.runs = 4; }],
    ['arms.L.runs', 'L runs != otherRuns', (r) => { r.arms.L.runs = 1; }],
    ['arms.P.runs', 'P runs != otherRuns', (r) => { r.arms.P.runs = 8; }],
    ['arms.R-quality.runs', 'R-quality runs != otherRuns', (r) => { r.arms['R-quality'].runs = 8; }, STEP1R],
    ['arms.P.tasks', 'T on 3 tasks, P on 1', (r) => { r.arms.P.tasks = ['cs-p20']; }],
    ['arms.P.tasks', 'P has a task T lacks', (r) => { r.arms.T.tasks = ['cs-p20', 'cs-p01']; r.arms.L.tasks = ['cs-p20']; r.arms.X.tasks = ['cs-p20']; }],
    ['arms.P.tasks', 'P lacks the quality task', (r) => { r.arms.P.tasks = ['cs-p01', 'cs-p05']; }],
    ['arms.L.tasks', 'L has a task T lacks', (r) => { r.arms.T.tasks = ['cs-p20', 'cs-p01']; r.arms.P.tasks = ['cs-p20', 'cs-p01']; r.arms.X.tasks = ['cs-p20']; }],
    ['arms.X.tasks', 'X lacks the quality task', (r) => { r.arms.X.tasks = ['cs-p01']; }],
    ['arms.R-quality.tasks', 'R-quality on two tasks', (r) => { r.arms['R-quality'].tasks = ['cs-p20', 'cs-p01']; }, STEP1R],
    ['arms.R-quality.tasks', 'R-quality on another task', (r) => { r.arms['R-quality'].tasks = ['cs-p01']; }, STEP1R],
    ['arms.R-other.tasks', 'R-other holds the quality task', (r) => { r.arms['R-other'].tasks = ['cs-p20', 'cs-p01', 'cs-p05']; }, STEP1R],
    ['arms.R-other.tasks', 'R-other misses a task', (r) => { r.arms['R-other'].tasks = ['cs-p01']; }, STEP1R],
    ['arms.R-other', 'R-quality without R-other', (r) => { delete r.arms['R-other']; }, STEP1R],
    ['arms.R-quality', 'R-other without R-quality', (r) => { delete r.arms['R-quality']; }, STEP1R],
    ['arms.R-other must be absent', 'R-other when T has only the quality task', (r) => { for (const n of ['L', 'X', 'T', 'P']) r.arms[n].tasks = ['cs-p20']; r.arms['R-quality'] = STEP1R.arms['R-quality']; r.arms['R-other'] = STEP1R.arms['R-other']; }],
    ['arms.R', 'the bare R arm', (r) => { r.arms.R = STEP1R.arms['R-quality']; }],
    ['arms.R-quality.mod.mode', 'R-quality not random', (r) => { r.arms['R-quality'].mod = { mode: 'placebo' }; }, STEP1R],
    ['arms.R-other.s5Arm must be \'C\'', 'R-other on A', (r) => { r.arms['R-other'].s5Arm = 'A'; }, STEP1R],
  ];
  for (const [field, label, fn, base] of cases) {
    assert.throws(() => loadRegistration(committed(mutate(fn, base))), (err) => err.message.includes(field), `${label}`);
  }
});

// ---- transcripts, logs, run directories ----
const jsonl = (records) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
let useSeq = 0;
const use = (name, input) => ({ type: 'tool_use', id: `tu_${(useSeq += 1)}`, name, input });
const bash = (command) => use('Bash', { command });
const rec = (id, effort, blocks) => ({
  type: 'assistant', effort, isSidechain: false, message: { id, role: 'assistant', model: 'claude-sonnet-5-5', content: blocks, usage: { output_tokens: 10 } },
});
// A transcript with one request per entry: { effort, tools }.
const transcript = (reqs) => jsonl([{ type: 'user', message: { role: 'user', content: 'do it' } }, ...reqs.map((r, i) => rec(`msg_${i}`, r.effort, r.tools ?? [use('Read', { file_path: '/work/x' })]))]);
const agreeing = (reqs) => jsonl(reqs.map((r, i) => ({ type: 'step', request: i, agentId: null, turnId: 't1', before: r.effort, after: r.effort })));
const BROAD = bash('cargo test --workspace');
const NARROW = bash('cargo test --lib foo');
const EDIT = use('Edit', { file_path: '/work/a.rs', old_string: 'a', new_string: 'b' });

// Writes <runsDir>/<dirName>/config/projects/-work/<sessionId>.jsonl and, when `log` is given, state/effort-toggle/log.jsonl.
function makeRun(runsDir, dirName, sessionId, text, log) {
  const runDir = join(runsDir, dirName);
  mkdirSync(join(runDir, 'config', 'projects', '-work'), { recursive: true });
  if (text !== null) writeFileSync(join(runDir, 'config', 'projects', '-work', `${sessionId}.jsonl`), text);
  if (log !== undefined) {
    mkdirSync(join(runDir, 'state', 'effort-toggle'), { recursive: true });
    writeFileSync(join(runDir, 'state', 'effort-toggle', 'log.jsonl'), log);
  }
  return runDir;
}

// ---- check-runs ----
// The log of a toggle run that sends `reqs` (one { effort } per request, the transcript's efforts) and calls set_effort where `calls` says
// ({ after: request, level }): the level a call sets applies from the next request.
const stepLine = (request, before, after) => ({ type: 'step', request, agentId: null, turnId: 't1', before, after });
const toggleLog = (reqs, calls = [], start = 'low') => jsonl([
  ...reqs.flatMap((r, i) => [
    stepLine(i, start, r.effort),
    ...calls.filter((c) => c.after === i).map((c) => ({ type: 'call', request: i, agentId: null, level: c.level, reason: 'r', text: 'Effort is now xhigh. It applies from your next step.' })),
  ]),
]);
const CHECK_RUNS_REG = committed(STEP1);

await ta('check-runs --registration --arm over a fixture work root writes the expected Run objects (arm, calls, callLog, timeouts, infra)', async () => {
  const work = join(ROOT, 'work-cr');
  const runs = join(work, 'runs');
  const good = [{ effort: 'low', tools: [NARROW] }, { effort: 'low', tools: [EDIT] }, { effort: 'xhigh', tools: [BROAD] }, { effort: 'xhigh' }];
  const goodCalls = [{ after: 1, level: 'xhigh' }];
  makeRun(runs, 'cs-p20.C.0-a1', 'sess-0', transcript(good), toggleLog(good, goodCalls));
  // Run 1: the first attempt (a1) had no transcript and was retried (a2): the directory of the row is the one that holds its session.
  makeRun(runs, 'cs-p20.C.1-a1', 'sess-gone', null);
  const disagree = [{ effort: 'low' }, { effort: 'xhigh' }];
  makeRun(runs, 'cs-p20.C.1-a2', 'sess-1', transcript(disagree), toggleLog([{ effort: 'low' }, { effort: 'low' }]));
  // Run 2: an audit hit and a mod error: audit wins (ruling P10).
  const peek = [{ effort: 'low', tools: [bash('cat /run/state/effort-toggle/log.jsonl')] }];
  makeRun(runs, 'cs-p20.C.2-a1', 'sess-2', transcript(peek), `${toggleLog(peek)}${JSON.stringify({ type: 'error', message: 'x' })}\n`);
  // Run 3: no mod log. Run 4: an infra_exhausted final row with no directory at all.
  makeRun(runs, 'cs-p01.C.0-a1', 'sess-3', transcript(good));
  // Run 5: a timeout (final, infra null, grade null): a counted failure, with an agreeing transcript and log.
  const slow = [{ effort: 'low', tools: [NARROW] }, { effort: 'low' }];
  makeRun(runs, 'cs-p01.C.1-a1', 'sess-4', transcript(slow), toggleLog(slow));
  // Run 6: a final row with an infra reason that still has a transcript: excluded for the infra reason, ahead of anything else.
  makeRun(runs, 'cs-p05.C.1-a1', 'sess-5', transcript(slow), toggleLog(slow));
  const rows = [
    { runId: 'cs-p20.C.1', taskId: 'cs-p20', rep: 1, sessionId: 'sess-gone', infra: 'container_failed', final: false, costUsd: 0.1, grade: null },
    { runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, sessionId: 'sess-0', infra: null, final: true, costUsd: 0.5, grade: { infra: null, pass: true } },
    { runId: 'cs-p20.C.1', taskId: 'cs-p20', rep: 1, sessionId: 'sess-1', infra: null, final: true, costUsd: 0.25, grade: { infra: null, pass: false } },
    { type: 'stopped', at: 'x', reason: 'cost' },
    { runId: 'cs-p20.C.2', taskId: 'cs-p20', rep: 2, sessionId: 'sess-2', infra: null, final: true, costUsd: null, grade: { infra: null, pass: true } },
    { runId: 'cs-p01.C.0', taskId: 'cs-p01', rep: 0, sessionId: 'sess-3', infra: null, final: true, costUsd: 1, grade: { infra: null, pass: true } },
    { runId: 'cs-p05.C.0', taskId: 'cs-p05', rep: 0, sessionId: null, infra: 'infra_exhausted', final: true, costUsd: null, grade: null },
    { runId: 'cs-p01.C.1', taskId: 'cs-p01', rep: 1, sessionId: 'sess-4', infra: null, final: true, costUsd: 2, grade: null },
    { runId: 'cs-p05.C.1', taskId: 'cs-p05', rep: 1, sessionId: 'sess-5', infra: 'infra_exhausted', final: true, costUsd: null, grade: null },
  ];
  const rowsFile = join(ROOT, 'rows-cr.jsonl');
  writeFileSync(rowsFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n\n`);
  const out = outPath('runs-cr.json');
  const io = cliIo();
  assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--registration', CHECK_RUNS_REG, '--arm', 'T', '--out', out], io), 0, io.errs.join('\n'));
  const got = JSON.parse(readFileSync(out, 'utf8'));
  const base = { arm: 'T', secondTurn: false, calls: 0, callLog: [] };
  assert.deepEqual(got, [
    {
      ...base, runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, pass: true, costUsd: 0.5, excludedFor: null, broadAt: [2], requests: 4, shareXhigh: 0.5, upSwitches: 1, calls: 1, callLog: [{ request: 1, level: 'xhigh', reason: 'r' }],
    },
    {
      ...base, runId: 'cs-p20.C.1', taskId: 'cs-p20', rep: 1, pass: false, costUsd: 0.25, excludedFor: 'log_transcript_mismatch', broadAt: [], requests: 2, shareXhigh: 0.5, upSwitches: 1,
    },
    {
      ...base, runId: 'cs-p20.C.2', taskId: 'cs-p20', rep: 2, pass: true, costUsd: null, excludedFor: 'audit', broadAt: [], requests: 1, shareXhigh: 0, upSwitches: 0,
    },
    {
      ...base, runId: 'cs-p01.C.0', taskId: 'cs-p01', rep: 0, pass: true, costUsd: 1, excludedFor: 'no_mod_log', broadAt: [2], requests: 4, shareXhigh: 0.5, upSwitches: 1,
    },
    {
      ...base, runId: 'cs-p05.C.0', taskId: 'cs-p05', rep: 0, pass: null, costUsd: null, excludedFor: 'infra:infra_exhausted', broadAt: [], requests: 0, shareXhigh: 0, upSwitches: 0,
    },
    {
      ...base, runId: 'cs-p01.C.1', taskId: 'cs-p01', rep: 1, pass: false, costUsd: 2, excludedFor: null, broadAt: [], requests: 2, shareXhigh: 0, upSwitches: 0,
    },
    {
      ...base, runId: 'cs-p05.C.1', taskId: 'cs-p05', rep: 1, pass: null, costUsd: null, excludedFor: 'infra:infra_exhausted', broadAt: [], requests: 2, shareXhigh: 0, upSwitches: 0,
    },
  ]);
  // The summary keeps its old prefix and now counts the excluded runs per reason (and the timeouts).
  assert.equal(io.logs.length, 1);
  assert.ok(io.logs[0].startsWith(`wrote ${out}: 7 runs, 5 excluded`), io.logs[0]);
  assert.equal(io.logs[0], `wrote ${out}: 7 runs, 5 excluded (infra:infra_exhausted 2, audit 1, log_transcript_mismatch 1, no_mod_log 1); 1 timed out (counted as failures)`);
});

await ta('check-runs: a timeout that kills a run mid-request is a counted failure, not an exclusion; the summary lists no run twice (ruling P27)', async () => {
  const work = join(ROOT, 'work-p27');
  const runs = join(work, 'runs');
  const slow = [{ effort: 'low', tools: [NARROW] }, { effort: 'low' }];
  // The mod logs request 2 before it is sent; the kill came before the response, so the transcript holds requests 0 and 1 only.
  const inFlight = (reqs) => `${toggleLog(reqs)}${JSON.stringify(stepLine(reqs.length, 'low', 'low'))}\n`;
  const twoInFlight = `${inFlight(slow)}${JSON.stringify(stepLine(3, 'low', 'low'))}\n`;
  makeRun(runs, 'cs-p20.C.0-a1', 'k-0', transcript(slow), inFlight(slow)); // timeout, one trailing step: counted
  makeRun(runs, 'cs-p20.C.1-a1', 'k-1', transcript(slow), inFlight(slow)); // the same log, NOT a timeout: excluded
  const peek = [{ effort: 'low', tools: [bash('cat /run/config/arm.json')] }, { effort: 'low' }];
  makeRun(runs, 'cs-p01.C.0-a1', 'k-2', transcript(peek), inFlight(peek)); // timeout, trailing step and an audit hit: excluded for audit
  makeRun(runs, 'cs-p01.C.1-a1', 'k-3', transcript(slow)); // timeout, no mod log: excluded for no_mod_log
  makeRun(runs, 'cs-p05.C.0-a1', 'k-4', transcript(slow), toggleLog(slow)); // timeout, agreeing log: counted
  makeRun(runs, 'cs-p05.C.1-a1', 'k-5', transcript(slow), twoInFlight); // timeout, two extra steps: excluded
  makeRun(runs, 'cs-p05.C.2-a1', 'k-6', transcript(slow), toggleLog(slow)); // graded, agreeing log: counted, not a timeout
  makeRun(runs, 'cs-p05.C.3-a1', 'k-7', transcript(slow), inFlight(slow)); // graded failure, the in-flight log: NOT a timeout, excluded
  makeRun(runs, 'cs-p05.C.4-a1', 'k-8', transcript(slow), inFlight(slow)); // a final row with no `grade` key at all: NOT a timeout, excluded
  const row = (runId, taskId, rep, sessionId, grade) => ({ runId, taskId, rep, sessionId, infra: null, final: true, costUsd: 1, grade });
  const all = [
    row('cs-p20.C.0', 'cs-p20', 0, 'k-0', null),
    row('cs-p20.C.1', 'cs-p20', 1, 'k-1', { infra: null, pass: true }),
    row('cs-p01.C.0', 'cs-p01', 0, 'k-2', null),
    row('cs-p01.C.1', 'cs-p01', 1, 'k-3', null),
    row('cs-p05.C.0', 'cs-p05', 0, 'k-4', null),
    row('cs-p05.C.1', 'cs-p05', 1, 'k-5', null),
    row('cs-p05.C.2', 'cs-p05', 2, 'k-6', { infra: null, pass: false }),
    row('cs-p05.C.3', 'cs-p05', 3, 'k-7', { pass: false }),
    (({ grade: _omitted, ...noGrade }) => noGrade)(row('cs-p05.C.4', 'cs-p05', 4, 'k-8', null)),
  ];
  const go = async (name, rows) => {
    const rowsFile = join(ROOT, `rows-${name}.jsonl`);
    writeFileSync(rowsFile, jsonl(rows));
    const out = outPath(`runs-${name}.json`);
    const io = cliIo();
    assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--registration', CHECK_RUNS_REG, '--arm', 'T', '--out', out], io), 0, io.errs.join('\n'));
    assert.equal(io.logs.length, 1);
    return { got: JSON.parse(readFileSync(out, 'utf8')), line: io.logs[0], out };
  };
  const { got, line, out } = await go('p27', all);
  const by = Object.fromEntries(got.map((r) => [r.runId, [r.pass, r.excludedFor]]));
  assert.deepEqual(by, {
    'cs-p20.C.0': [false, null],
    'cs-p20.C.1': [true, 'log_transcript_mismatch'],
    'cs-p01.C.0': [false, 'audit'],
    'cs-p01.C.1': [false, 'no_mod_log'],
    'cs-p05.C.0': [false, null],
    'cs-p05.C.1': [false, 'log_transcript_mismatch'],
    'cs-p05.C.2': [false, null],
    'cs-p05.C.3': [false, 'log_transcript_mismatch'],
    'cs-p05.C.4': [null, 'log_transcript_mismatch'],
  });
  assert.equal(got[0].requests, 2, 'the Run counts the transcript requests, not the log steps');
  // No run is both excluded and counted: 6 excluded (two of them timeouts), 2 timeouts counted as failures (a graded failure and a row with no grade are not timeouts).
  assert.equal(line, `wrote ${out}: 9 runs, 6 excluded (log_transcript_mismatch 4, audit 1, no_mod_log 1); 2 timed out (counted as failures)`);
  // One counted timeout and one excluded timeout: the exact text.
  const pair = await go('p27-pair', [all[0], all[3]]);
  assert.equal(pair.line, `wrote ${pair.out}: 2 runs, 1 excluded (no_mod_log 1); 1 timed out (counted as failures)`);
  // Only an excluded timeout: no "timed out" clause at all.
  const lone = await go('p27-lone', [all[3]]);
  assert.equal(lone.line, `wrote ${lone.out}: 1 runs, 1 excluded (no_mod_log 1)`);
});

await ta('check-runs ties the check to the arm: the same toggle run under a placebo or a different schedule arm is excluded for arm_mismatch (ruling P20)', async () => {
  const work = join(ROOT, 'work-arm');
  const runs = join(work, 'runs');
  const reqs = [{ effort: 'low' }, { effort: 'low' }, { effort: 'xhigh' }, { effort: 'xhigh' }];
  makeRun(runs, 'cs-p20.C.0-a1', 'arm-0', transcript(reqs), toggleLog(reqs, [{ after: 1, level: 'xhigh' }]));
  const rowsFile = join(ROOT, 'rows-arm.jsonl');
  writeFileSync(rowsFile, jsonl([{ runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, sessionId: 'arm-0', infra: null, final: true, costUsd: 1, grade: { infra: null, pass: true } }]));
  const run = async (reg, armName) => {
    const out = outPath(`arm-${armName}.json`);
    const io = cliIo();
    assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--registration', reg, '--arm', armName, '--out', out], io), 0, io.errs.join('\n'));
    return JSON.parse(readFileSync(out, 'utf8'))[0];
  };
  const reg = committed(STEP1);
  assert.equal((await run(reg, 'T')).excludedFor, null, 'T: the run did what a toggle arm does');
  assert.equal((await run(reg, 'P')).excludedFor, 'arm_mismatch', 'P: a placebo never rewrites');
  assert.equal((await run(reg, 'P')).arm, 'P');
  assert.equal((await run(reg, 'L')).excludedFor, 'arm_mismatch', 'L: a one-level low schedule');
  assert.equal((await run(reg, 'X')).excludedFor, 'arm_mismatch', 'X starts at xhigh; the run started low');
  // a step 0 registration: F-LX (switchAt 5) fed a run that switches by a call is a mismatch too
  assert.equal((await run(committed(STEP0), 'F-LX')).excludedFor, 'arm_mismatch');
  assert.equal((await run(committed(STEP0), 'F-X')).excludedFor, 'arm_mismatch');
  // the schedule that matches is accepted, with the start effort read from the arm's S5 arm (C: low)
  const sw = [{ effort: 'low' }, { effort: 'low' }, { effort: 'low' }, { effort: 'low' }, { effort: 'low' }, { effort: 'xhigh' }];
  makeRun(runs, 'cs-p20.C.1-a1', 'arm-1', transcript(sw), toggleLog(sw));
  writeFileSync(rowsFile, jsonl([{ runId: 'cs-p20.C.1', taskId: 'cs-p20', rep: 1, sessionId: 'arm-1', infra: null, final: true, costUsd: 1, grade: { infra: null, pass: true } }]));
  assert.equal((await run(committed(STEP0), 'F-LX')).excludedFor, null);
  assert.equal((await run(committed(STEP0), 'F-L')).excludedFor, 'arm_mismatch');
  assert.equal((await run(committed(STEP0), 'F-XL')).excludedFor, 'arm_mismatch');
  // an arm on S5 arm A starts at xhigh (read from base.arms.A.effort): a run that held xhigh throughout fits X and F-X, not L
  const hi = [{ effort: 'xhigh' }, { effort: 'xhigh' }, { effort: 'xhigh' }];
  makeRun(runs, 'cs-p20.A.0-a1', 'arm-2', transcript(hi), toggleLog(hi, [], 'xhigh'));
  writeFileSync(rowsFile, jsonl([{ runId: 'cs-p20.A.0', taskId: 'cs-p20', rep: 0, sessionId: 'arm-2', infra: null, final: true, costUsd: 1, grade: { infra: null, pass: true } }]));
  assert.equal((await run(reg, 'X')).excludedFor, null);
  assert.equal((await run(committed(STEP0), 'F-X')).excludedFor, null);
  assert.equal((await run(reg, 'L')).excludedFor, 'arm_mismatch');
  assert.equal((await run(committed(STEP0), 'F-XL')).excludedFor, null, 'three requests of F-XL are all still xhigh (switchAt 5)');
});

await ta('check-runs --mode none --label (a run without a mod): no log is expected, only the audit excludes; the Runs carry the label', async () => {
  const work = join(ROOT, 'work-none');
  const runs = join(work, 'runs');
  const reqs = [{ effort: 'xhigh', tools: [NARROW] }, { effort: 'xhigh', tools: [BROAD] }];
  makeRun(runs, 'cs-p20.A.0-a1', 'n-0', transcript(reqs)); // no log at all
  makeRun(runs, 'cs-p20.A.1-a1', 'n-1', transcript(reqs), 'not json\n'); // a log that would mismatch: not read
  makeRun(runs, 'cs-p20.A.2-a1', 'n-2', transcript([{ effort: 'xhigh', tools: [bash('ls /opt/es/mod')] }])); // audit
  const rowsFile = join(ROOT, 'rows-none.jsonl');
  const row = (rep, sessionId) => ({ runId: `cs-p20.A.${rep}`, taskId: 'cs-p20', rep, sessionId, infra: null, final: true, costUsd: 0.5, grade: { infra: null, pass: true } });
  writeFileSync(rowsFile, jsonl([row(0, 'n-0'), row(1, 'n-1'), row(2, 'n-2')]));
  const out = outPath('runs-none.json');
  const io = cliIo();
  assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--mode', 'none', '--label', 'X', '--out', out], io), 0, io.errs.join('\n'));
  const got = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(got.map((r) => r.excludedFor), [null, null, 'audit']);
  assert.deepEqual(got[0], {
    runId: 'cs-p20.A.0', taskId: 'cs-p20', rep: 0, arm: 'X', pass: true, costUsd: 0.5, excludedFor: null, secondTurn: false, broadAt: [1], requests: 2, shareXhigh: 1, upSwitches: 0, calls: 0, callLog: [],
  });
  assert.ok(io.logs[0].startsWith(`wrote ${out}: 3 runs, 1 excluded (audit 1)`), io.logs[0]);
  // the same rows under an arm that has a mod: the missing log excludes
  const outMod = outPath('runs-none-mod.json');
  assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--registration', committed(STEP1), '--arm', 'T', '--out', outMod], cliIo()), 0);
  assert.deepEqual(JSON.parse(readFileSync(outMod, 'utf8')).map((r) => r.excludedFor), ['no_mod_log', 'log_transcript_mismatch', 'audit']);
});

await ta('check-runs: the old free --mode toggle is gone (exit 64, the message points to --arm); the arm options are exclusive and --label is needed under none', async () => {
  const work = join(ROOT, 'work-flags');
  mkdirSync(join(work, 'runs'), { recursive: true });
  const rowsFile = join(ROOT, 'rows-flags.jsonl');
  writeFileSync(rowsFile, '');
  const out = outPath('runs-flags.json');
  const reg = committed(STEP1);
  const base = ['check-runs', '--work-root', work, '--rows', rowsFile, '--out', out];
  for (const mode of ['toggle', 'placebo', 'random', 'schedule', 'nope']) {
    const io = cliIo();
    assert.equal(await main([...base, '--mode', mode], io), 64, mode);
    assert.match(io.errs.join('\n'), /--arm/, mode);
  }
  const cases = [
    ['--mode none without --label', ['--mode', 'none']],
    ['--mode none with a blank label', ['--mode', 'none', '--label', ' ']],
    ['--mode none with --arm', ['--mode', 'none', '--label', 'L', '--arm', 'T', '--registration', reg]],
    ['--mode none with --registration', ['--mode', 'none', '--label', 'L', '--registration', reg]],
    ['--arm without --registration', ['--arm', 'T']],
    ['--registration without --arm', ['--registration', reg]],
    ['an arm the registration lacks', ['--registration', reg, '--arm', 'Z']],
    ['--label with --registration', ['--registration', reg, '--arm', 'T', '--label', 'T']],
    ['no mode, no arm', []],
  ];
  for (const [label, extra] of cases) assert.equal(await main([...base, ...extra], cliIo()), 64, label);
  assert.equal(await main(['check-runs', '--work-root', work, '--mode', 'none', '--label', 'L', '--out', out], cliIo()), 64, 'no --rows');
  // a registration that is not committed is refused before any run is read
  const loose = join(REPO, 'loose-cr.json');
  writeFileSync(loose, `${JSON.stringify(STEP1, null, 2)}\n`);
  const un = cliIo();
  assert.equal(await main([...base, '--registration', loose, '--arm', 'T'], un), 1);
  assert.match(un.errs.join('\n'), /not committed/);
});

await ta('check-runs refuses a --work-root without runs/ (exit 1, nothing written); a missing run directory under an existing runs/ is no_transcript', async () => {
  const rowsFile = join(ROOT, 'rows-wrong.jsonl');
  writeFileSync(rowsFile, jsonl([{ runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, sessionId: 's', infra: null, final: true, costUsd: 1, grade: { infra: null, pass: true } }]));
  const out = outPath('runs-wrong.json');
  const bad = cliIo();
  assert.equal(await main(['check-runs', '--work-root', join(ROOT, 'no-such-root'), '--rows', rowsFile, '--registration', CHECK_RUNS_REG, '--arm', 'T', '--out', out], bad), 1);
  assert.match(bad.errs.join('\n'), /no-such-root.*runs/);
  const file = join(ROOT, 'a-file');
  writeFileSync(file, 'x');
  const none = (root) => ['check-runs', '--work-root', root, '--rows', rowsFile, '--mode', 'none', '--label', 'L', '--out', out];
  assert.equal(await main(none(ROOT), cliIo()), 1, 'ROOT has no runs/');
  assert.equal(await main(none(file), cliIo()), 1);
  const empty = join(ROOT, 'work-empty');
  mkdirSync(join(empty, 'runs'), { recursive: true });
  assert.equal(await main(none(empty), cliIo()), 0);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).map((r) => r.excludedFor), ['no_transcript']);
});

await ta('check-runs: a second final row of a run replaces the first; flags are required', async () => {
  const work = join(ROOT, 'work-cr2');
  const reqs = [{ effort: 'low' }];
  makeRun(join(work, 'runs'), 'cs-p20.C.0-a2', 'sess-b', transcript(reqs), toggleLog(reqs));
  const rowsFile = join(ROOT, 'rows-cr2.jsonl');
  writeFileSync(rowsFile, jsonl([
    { runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, sessionId: 'sess-a', infra: 'infra_exhausted', final: true, costUsd: null, grade: null },
    { runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, sessionId: 'sess-b', infra: null, final: true, costUsd: 0.3, grade: { infra: null, pass: true } },
  ]));
  const out = outPath('runs-cr2.json');
  assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--registration', CHECK_RUNS_REG, '--arm', 'T', '--out', out], cliIo()), 0);
  const got = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(got.length, 1);
  assert.equal(got[0].pass, true);
  assert.equal(got[0].excludedFor, null);
  assert.equal(await main(['check-runs', '--work-root', work, '--registration', CHECK_RUNS_REG, '--arm', 'T', '--out', out], cliIo()), 64);
});

// ---- hook-copy (ruling P25) ----
await ta('GAP_LIMIT is the 25% of the spec (ruling P22)', async () => {
  assert.equal(GAP_LIMIT, 0.25);
});

await ta('hook-copy writes the arm hook copy (mod + config.json with the arm mod and the log path) and prints the mod directory', async () => {
  const reg = committed(STEP0);
  const out = join(ROOT, 'hook', 'lx');
  const logPath = join(ROOT, 'hook', 'logs', 'g1a', 'log.jsonl');
  const io = cliIo();
  assert.equal(await main(['hook-copy', '--registration', reg, '--arm', 'F-LX', '--out', out, '--log-path', logPath], io), 0, io.errs.join('\n'));
  assert.deepEqual(io.logs, [join(out, 'es', 'mod')]);
  const cfg = JSON.parse(readFileSync(join(out, 'es', 'mod', 'config.json'), 'utf8'));
  assert.deepEqual(cfg, { ...STEP0.arms['F-LX'].mod, logPath });
  assert.ok(readFileSync(join(out, 'es', 'mod', 'hooks', 'register.ts'), 'utf8').includes('effort-toggle'));
  assert.ok(readFileSync(join(out, 'es', 'settings.json'), 'utf8').includes('UserPromptSubmit'));
  assert.ok(statSync(dirname(logPath)).isDirectory(), 'the log directory exists');
  // another arm of another registration: its own mod
  const reg1 = committed(STEP1);
  for (const [name, mod] of [['T', STEP1.arms.T.mod], ['P', STEP1.arms.P.mod], ['L', STEP1.arms.L.mod]]) {
    const o = join(ROOT, 'hook', name);
    const lp = join(ROOT, 'hook', 'logs', `${name}.jsonl`);
    assert.equal(await main(['hook-copy', '--registration', reg1, '--arm', name, '--out', o, '--log-path', lp], cliIo()), 0, name);
    assert.deepEqual(JSON.parse(readFileSync(join(o, 'es', 'mod', 'config.json'), 'utf8')), { ...mod, logPath: lp }, name);
  }
  // without --log-path: the container path of the batch
  const dflt = join(ROOT, 'hook', 'default');
  assert.equal(await main(['hook-copy', '--registration', reg1, '--arm', 'T', '--out', dflt], cliIo()), 0);
  assert.equal(JSON.parse(readFileSync(join(dflt, 'es', 'mod', 'config.json'), 'utf8')).logPath, '/run/state/effort-toggle/log.jsonl');
});

await ta('hook-copy refuses a relative log path, an unknown arm, missing flags and an uncommitted registration', async () => {
  const reg = committed(STEP1);
  const out = join(ROOT, 'hook', 'refused');
  const rel = cliIo();
  assert.equal(await main(['hook-copy', '--registration', reg, '--arm', 'T', '--out', out, '--log-path', 'log.jsonl'], rel), 64);
  assert.match(rel.errs.join('\n'), /absolute/);
  assert.equal(await main(['hook-copy', '--registration', reg, '--arm', 'Z', '--out', out], cliIo()), 64);
  assert.equal(await main(['hook-copy', '--registration', reg, '--arm', 'T'], cliIo()), 64);
  assert.equal(await main(['hook-copy', '--arm', 'T', '--out', out], cliIo()), 64);
  const loose = join(REPO, 'loose-hc.json');
  writeFileSync(loose, `${JSON.stringify(STEP1, null, 2)}\n`);
  assert.equal(await main(['hook-copy', '--registration', loose, '--arm', 'T', '--out', out], cliIo()), 1);
  assert.throws(() => statSync(join(out, 'es')), /ENOENT/, 'nothing was written');
});

// ---- check-known ----
await ta('check-known over a fixture runs directory prints the per-run lines and exactly the summary lines', async () => {
  const dir = join(ROOT, 'known', 'runs');
  const filler = (n, last) => [...Array.from({ length: n }, () => ({ effort: 'low' })), { effort: 'low', tools: last }];
  makeRun(dir, 'cs-p20.A.0-a1', 's1', transcript(filler(3, [BROAD])));
  makeRun(dir, 'cs-p20.A.1-a1', 's2', transcript(filler(2, [NARROW])));
  makeRun(dir, 'cs-p20.C.0-a1', 's3', transcript([...filler(8, [EDIT]), { effort: 'low' }]));
  makeRun(dir, 'cs-p20.C.1-a1', 's4', transcript([...filler(7, [EDIT]), { effort: 'low', tools: [bash('ls /opt/es/mod')] }, { effort: 'low', tools: [BROAD] }]));
  makeRun(dir, 'cs-p01.A.0-a1', 's5', transcript(filler(1, [BROAD])));
  const io = cliIo();
  assert.equal(await main(['check-known', '--all', dir, '--task', 'cs-p20'], io), 0, io.errs.join('\n'));
  assert.deepEqual(io.logs, [
    'cs-p20.A.0-a1 group=xhigh broad=true audit=0 firstEditIndex=none',
    'cs-p20.A.1-a1 group=xhigh broad=false audit=0 firstEditIndex=none',
    'cs-p20.C.0-a1 group=low broad=false audit=0 firstEditIndex=8',
    'cs-p20.C.1-a1 group=low broad=true audit=1 firstEditIndex=7',
    'xhigh broad: 1 of 2',
    'low broad: 1 of 2',
    'audit hits: 1',
    'switchAt: 5',
  ]);
});

await ta('check-known: --low and --xhigh classify a whole directory, --task is optional, the switchAt floor is 3', async () => {
  const lowDir = join(ROOT, 'known2', 'low');
  const highDir = join(ROOT, 'known2', 'high');
  makeRun(lowDir, 'cs-p20.F.0-a1', 'l1', transcript([{ effort: 'low', tools: [EDIT] }]));
  makeRun(highDir, 'cs-p20.F.0-a1', 'h1', transcript([{ effort: 'xhigh', tools: [BROAD] }]));
  const io = cliIo();
  assert.equal(await main(['check-known', '--low', lowDir, '--xhigh', highDir], io), 0, io.errs.join('\n'));
  assert.deepEqual(io.logs.slice(-4), ['xhigh broad: 1 of 1', 'low broad: 0 of 1', 'audit hits: 0', 'switchAt: 3']);
  // a run directory with no transcript is a failure, not a silent skip
  const empty = join(ROOT, 'known3', 'runs');
  makeRun(empty, 'cs-p20.A.0-a1', 'e1', null);
  const bad = cliIo();
  assert.equal(await main(['check-known', '--all', empty], bad), 1);
  assert.match(bad.errs.join('\n'), /cs-p20\.A\.0-a1/);
  assert.equal(await main(['check-known'], cliIo()), 64);
});

// ---- analyze0 / analyze1 / random-params ----
let runSeq = 0;
// A Run carries its arm (ruling P20); R() gives the placeholder arm '*', which evFile(name, runs, arm) replaces by the arm the file is for.
const ANY_ARM = '*';
const R = (over) => ({
  runId: `run-${(runSeq += 1)}`, taskId: 'cs-p20', rep: 0, arm: ANY_ARM, pass: true, costUsd: 1, excludedFor: null, secondTurn: false, broadAt: [], requests: 20, shareXhigh: 0, upSwitches: 0, calls: 0, callLog: [], ...over,
});
const forArm = (arm, runs) => runs.map((r) => (isObj(r) && r.arm === ANY_ARM ? { ...r, arm } : r));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const evFile = (name, runs, arm) => {
  const file = join(ROOT, 'ev', `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(arm === undefined ? runs : forArm(arm, runs)));
  return file;
};
const evArgs = (map) => Object.entries(map).flatMap(([arm, runs]) => ['--evidence', `${arm}=${evFile(arm, runs, arm)}`]);

await ta('analyze0 prints the step 0 verdict as 2-space JSON and refuses a step 1 registration or an unknown arm', async () => {
  const reg = committed(STEP0);
  const broad = (n) => Array.from({ length: n }, (_, rep) => R({ rep, broadAt: [6] }));
  const narrow = (n) => Array.from({ length: n }, (_, rep) => R({ rep, broadAt: [4] }));
  const io = cliIo();
  const code = await main(['analyze0', '--registration', reg, ...evArgs({ 'F-L': narrow(4), 'F-X': broad(4), 'F-LX': broad(4), 'F-XL': narrow(4) })], io);
  assert.equal(code, 0, io.errs.join('\n'));
  assert.equal(io.logs.length, 1);
  const verdict = JSON.parse(io.logs[0]);
  assert.equal(verdict.positiveControl, 'pass');
  assert.equal(verdict.up, 'delivered');
  assert.equal(verdict.down, 'delivered');
  assert.equal(io.logs[0], JSON.stringify(verdict, null, 2));
  const wrongStep = cliIo();
  assert.equal(await main(['analyze0', '--registration', committed(STEP1), ...evArgs({ L: narrow(1) })], wrongStep), 64);
  const unknown = cliIo();
  assert.equal(await main(['analyze0', '--registration', reg, ...evArgs({ T: narrow(1) })], unknown), 64);
  assert.equal(await main(['analyze0', '--registration', reg, '--evidence', 'F-L'], cliIo()), 64);
  assert.equal(await main(['analyze0', '--registration', reg, ...evArgs({ 'F-L': narrow(1) }), '--evidence', `F-L=${evFile('dup', [])}`], cliIo()), 64);
});

await ta('analyze0 and analyze1 refuse missing, unregistered and malformed evidence, naming the file and the run (ruling P18)', async () => {
  const reg0 = committed(STEP0);
  const four = (over = {}) => ({
    'F-L': [R({ rep: 0 }), R({ rep: 1 })], 'F-X': [R({ rep: 0 })], 'F-LX': [R({ rep: 0 })], 'F-XL': [R({ rep: 0 })], ...over,
  });
  const okIo = cliIo();
  assert.equal(await main(['analyze0', '--registration', reg0, ...evArgs(four())], okIo), 0, okIo.errs.join('\n'));
  // a registered arm without evidence: a usage error naming it (a missing F-XL must not print a verdict)
  for (const gone of ['F-L', 'F-X', 'F-LX', 'F-XL']) {
    const { [gone]: _gone, ...rest } = four();
    const io = cliIo();
    assert.equal(await main(['analyze0', '--registration', reg0, ...evArgs(rest)], io), 64, gone);
    assert.match(io.errs.join('\n'), new RegExp(gone));
    assert.deepEqual(io.logs, []);
  }
  const dup = R({ rep: 0 });
  const { runId: _id, ...noId } = R({});
  const { excludedFor: _ex, ...noExcluded } = R({});
  const bad = [
    ['the same run four times', [dup, dup, dup, dup], 'appears twice', dup.runId],
    ['no excludedFor key', [noExcluded], 'lacks the key excludedFor', noExcluded.runId],
    ['no runId', [noId], 'lacks the key runId', '#0'],
    ['runId a number', [R({ runId: 5 })], 'has a runId that is not a non-empty string', '#0'],
    ['taskId a number', [R({ taskId: 5 })], 'has a taskId that is not a non-empty string', 'RUN'],
    ['an unknown key', [R({ extra: 1 })], 'unknown key', 'RUN'],
    ['a task the arm lacks', [R({ taskId: 'cs-p01' })], 'cs-p01', 'RUN'],
    ['shareXhigh above 1', [R({ shareXhigh: 2 })], 'shareXhigh', 'RUN'],
    ['shareXhigh null', [R({ shareXhigh: null })], 'shareXhigh', 'RUN'],
    ['rep 1.5', [R({ rep: 1.5 })], 'rep', 'RUN'],
    ['rep negative', [R({ rep: -1 })], 'rep', 'RUN'],
    ['costUsd negative', [R({ costUsd: -1 })], 'costUsd', 'RUN'],
    ['costUsd a string', [R({ costUsd: '1' })], 'costUsd', 'RUN'],
    ['pass a string', [R({ pass: 'yes' })], 'pass', 'RUN'],
    ['excludedFor empty', [R({ excludedFor: '' })], 'excludedFor', 'RUN'],
    ['secondTurn null', [R({ secondTurn: null })], 'secondTurn', 'RUN'],
    ['broadAt with a string', [R({ broadAt: ['x'] })], 'broadAt', 'RUN'],
    ['broadAt not an array', [R({ broadAt: 3 })], 'broadAt', 'RUN'],
    ['requests null', [R({ requests: null })], 'requests', 'RUN'],
    ['upSwitches null', [R({ upSwitches: null })], 'upSwitches', 'RUN'],
    ['no arm key', [(({ arm: _a, ...r }) => r)(R({}))], 'lacks the key arm', 'RUN'],
    ['arm a number', [R({ arm: 5 })], 'arm', 'RUN'],
    ['arm empty', [R({ arm: '' })], 'arm', 'RUN'],
    ['no calls key', [(({ calls: _c, ...r }) => r)(R({}))], 'lacks the key calls', 'RUN'],
    ['calls negative', [R({ calls: -1 })], 'calls', 'RUN'],
    ['no callLog key', [(({ callLog: _c, ...r }) => r)(R({}))], 'lacks the key callLog', 'RUN'],
    ['callLog not an array', [R({ callLog: {} })], 'callLog', 'RUN'],
    ['callLog entry with a level that is not allowed', [R({ calls: 1, callLog: [{ request: 0, level: 'high', reason: 'r' }] })], 'callLog', 'RUN'],
    ['callLog entry without a reason', [R({ calls: 1, callLog: [{ request: 0, level: 'low' }] })], 'callLog', 'RUN'],
    ['calls differs from the callLog length', [R({ calls: 2, callLog: [{ request: 0, level: 'low', reason: 'r' }] })], 'callLog', 'RUN'],
    ['an entry that is not an object', [R({}), 3], 'not a Run object', null],
  ];
  for (const [label, runs, needle, runId] of bad) {
    const io = cliIo();
    const file = evFile('F-L', runs, 'F-L');
    const args = ['analyze0', '--registration', reg0, '--evidence', `F-L=${file}`, ...evArgs({ 'F-X': [R({})], 'F-LX': [R({})], 'F-XL': [R({})] })];
    assert.equal(await main(args, io), 1, label);
    const msg = io.errs.join('\n');
    assert.ok(msg.includes(file), `${label}: names the file: ${msg}`);
    assert.ok(msg.includes(needle), `${label}: ${msg}`);
    if (runId === 'RUN') assert.ok(msg.includes(runs[0].runId), `${label}: names the run: ${msg}`);
    else if (runId !== null) assert.ok(msg.includes(runId), `${label}: names the run: ${msg}`);
    assert.deepEqual(io.logs, [], label);
  }
  // not JSON
  const junk = join(ROOT, 'ev', 'junk.json');
  writeFileSync(junk, '{ nope');
  const j = cliIo();
  assert.equal(await main(['analyze0', '--registration', reg0, '--evidence', `F-L=${junk}`, ...evArgs({ 'F-X': [], 'F-LX': [], 'F-XL': [] })], j), 1);
  assert.ok(j.errs.join('\n').includes(junk));
  // the step 1 verdict command applies the same checks
  const reg1 = committed(STEP1);
  const arms1 = (over = {}) => ({ L: [R({})], X: [R({})], T: [R({})], P: [R({})], ...over });
  const dup1 = R({});
  const a = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg1, ...evArgs(arms1({ T: [dup1, dup1] }))], a), 1);
  assert.ok(a.errs.join('\n').includes(dup1.runId));
  const b = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg1, ...evArgs(arms1({ P: [R({ taskId: 'cs-zzz' })] }))], b), 1);
  assert.match(b.errs.join('\n'), /cs-zzz/);
  const { P: _p, ...noP } = arms1();
  const c = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg1, ...evArgs(noP)], c), 64);
  assert.match(c.errs.join('\n'), /\bP\b/);
  // R-quality is unregistered in STEP1: its evidence is refused
  const d = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg1, ...evArgs(arms1({ 'R-quality': [R({})] }))], d), 64);
});

await ta('analyze1 passes the registered verdict block, and a registered T task without counted evidence is incomplete and forces works to null', async () => {
  const reg = committed(STEP1);
  const cell = (n, over = {}) => Array.from({ length: n }, (_, rep) => R({ rep, ...over }));
  const full = (taskId, n, over) => cell(n, { taskId, ...over });
  const arms = (tasksOfT) => ({
    L: TASKS.flatMap((t) => full(t, 2)),
    X: TASKS.flatMap((t) => full(t, 2)),
    T: tasksOfT.flatMap((t) => full(t, t === 'cs-p20' ? 8 : 2, { costUsd: 0.5 })),
    P: TASKS.flatMap((t) => full(t, t === 'cs-p20' ? 8 : 2, { pass: t !== 'cs-p20' })),
  });
  const ok = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg, ...evArgs(arms(TASKS))], ok), 0, ok.errs.join('\n'));
  const good = JSON.parse(ok.logs[0]);
  assert.equal(good.works, true);
  assert.equal(good.detail.cost.used, 'run');
  assert.deepEqual(good.incomplete.filter((s) => s.startsWith('registered-task-missing')), []);

  const missing = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg, ...evArgs(arms(['cs-p20', 'cs-p01']))], missing), 0, missing.errs.join('\n'));
  const v = JSON.parse(missing.logs[0]);
  assert.equal(v.works, null);
  assert.ok(v.incomplete.includes('registered-task-missing:cs-p05'), JSON.stringify(v.incomplete));
  // a T run on that task that is excluded does not count either
  const excluded = { ...arms(TASKS), T: [...arms(['cs-p20', 'cs-p01']).T, R({ taskId: 'cs-p05', excludedFor: 'audit' })] };
  const ex = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg, ...evArgs(excluded)], ex), 0);
  assert.ok(JSON.parse(ex.logs[0]).incomplete.includes('registered-task-missing:cs-p05'));
  // a T run with pass null does not count either
  const ungraded = { ...arms(TASKS), T: [...arms(['cs-p20', 'cs-p01']).T, R({ taskId: 'cs-p05', pass: null })] };
  const un = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg, ...evArgs(ungraded)], un), 0);
  assert.ok(JSON.parse(un.logs[0]).incomplete.includes('registered-task-missing:cs-p05'));
  // refused: a step 0 registration
  assert.equal(await main(['analyze1', '--registration', committed(STEP0), ...evArgs({ 'F-L': [] })], cliIo()), 64);
});

await ta('analyze1 merges the evidence of R-quality and R-other into the one arm R of the verdict (ruling P17)', async () => {
  const regR = committed(STEP1R);
  const cell = (taskId, n, over = {}) => Array.from({ length: n }, (_, rep) => R({ rep, taskId, ...over }));
  const base = () => ({
    L: TASKS.flatMap((t) => cell(t, 2)),
    X: TASKS.flatMap((t) => cell(t, 2)),
    T: [...cell('cs-p20', 8, { costUsd: 0.5 }), ...cell('cs-p01', 2, { costUsd: 0.5 }), ...cell('cs-p05', 2, { costUsd: 0.5 })],
    P: [...cell('cs-p20', 8, { pass: false }), ...cell('cs-p01', 2), ...cell('cs-p05', 2)],
  });
  const withR = (quality, other) => ({ ...base(), 'R-quality': quality, 'R-other': other });
  const otherEv = [...cell('cs-p01', 1), ...cell('cs-p05', 2)];
  const io = cliIo();
  assert.equal(await main(['analyze1', '--registration', regR, ...evArgs(withR(cell('cs-p20', 8, { pass: false }), otherEv))], io), 0, io.errs.join('\n'));
  const v = JSON.parse(io.logs[0]);
  assert.equal(v.detail.qualityPasses.R, 0, 'the R-quality runs reached R');
  assert.ok(v.detail.short.includes('R:cs-p01:1/2'), `the R-other runs reached R: ${JSON.stringify(v.detail.short)}`);
  assert.equal(v.detail.qualityPasses.T, 8);
  assert.equal(v.timing, true);
  // the R-quality runs count as R only through the merge: with two passes among them the timing criterion changes
  const io2 = cliIo();
  assert.equal(await main(['analyze1', '--registration', regR, ...evArgs(withR(cell('cs-p20', 8, { pass: true }), cell('cs-p01', 2)))], io2), 0, io2.errs.join('\n'));
  assert.equal(JSON.parse(io2.logs[0]).detail.qualityPasses.R, 8);
  assert.equal(JSON.parse(io2.logs[0]).timing, false);
  // R-other evidence is required when registered, and each stratum's evidence is held to its own tasks
  const { 'R-other': _o, ...noOther } = withR(cell('cs-p20', 8), []);
  const missing = cliIo();
  assert.equal(await main(['analyze1', '--registration', regR, ...evArgs(noOther)], missing), 64);
  assert.match(missing.errs.join('\n'), /R-other/);
  const wrong = cliIo();
  assert.equal(await main(['analyze1', '--registration', regR, ...evArgs(withR(cell('cs-p01', 2), cell('cs-p05', 2)))], wrong), 1);
  assert.match(wrong.errs.join('\n'), /cs-p01/);
  // without the random arms registered, there is no R and no timing
  const none = cliIo();
  assert.equal(await main(['analyze1', '--registration', committed(STEP1), ...evArgs(base())], none), 0, none.errs.join('\n'));
  assert.equal(JSON.parse(none.logs[0]).timing, null);
});

await ta('random-params takes one stratum of T (quality or other) and only counted runs (ruling P13, P17)', async () => {
  const reg = committed(STEP1);
  const sw = (taskId, shareXhigh, upSwitches, requests, over = {}) => R({ taskId, shareXhigh, upSwitches, requests, ...over });
  const runs = [
    sw('cs-p20', 0.5, 2, 100),
    sw('cs-p20', 0.3, 4, 100),
    sw('cs-p20', 0.9, 9, 9, { excludedFor: 'audit' }),
    sw('cs-p20', 0.9, 9, 9, { pass: null }),
    sw('cs-p01', 0.1, 1, 50),
    sw('cs-p05', 0.3, 3, 50),
    sw('cs-p05', 0.9, 9, 9, { excludedFor: 'no_mod_log' }),
  ];
  const ev = evFile('rp', runs, 'T');
  const params = async (stratum) => {
    const io = cliIo();
    assert.equal(await main(['random-params', '--registration', reg, '--stratum', stratum, '--evidence', ev], io), 0, io.errs.join('\n'));
    assert.equal(io.logs.length, 1);
    assert.equal(io.logs[0], JSON.stringify(JSON.parse(io.logs[0]), null, 2));
    return JSON.parse(io.logs[0]);
  };
  const q = await params('quality');
  assert.deepEqual([q.s, q.u, q.n, q.degenerate], [0.4, 3, 100, false]);
  // ruling P22: the parameters are solved for the real chain, so its expected share and up-switches are the targets
  assert.ok(Math.abs(q.expected.share - 0.4) < 1e-9 && Math.abs(q.expected.upSwitches - 3) < 1e-9, JSON.stringify(q.expected));
  assert.ok(Math.abs(q.gap.share) < 1e-9 && Math.abs(q.gap.upSwitches) < 1e-9);
  const o = await params('other');
  assert.deepEqual([o.s, o.u, o.n, o.degenerate], [0.2, 2, 50, false]);
  // usage errors
  assert.equal(await main(['random-params', '--registration', reg, '--evidence', ev], cliIo()), 64);
  assert.equal(await main(['random-params', '--registration', reg, '--stratum', 'all', '--evidence', ev], cliIo()), 64);
  assert.equal(await main(['random-params', '--stratum', 'quality', '--evidence', ev], cliIo()), 64);
  assert.equal(await main(['random-params', '--registration', committed(STEP0), '--stratum', 'quality', '--evidence', ev], cliIo()), 64);
  assert.equal(await main(['random-params'], cliIo()), 64);
  // the evidence is validated as for the verdicts
  const nonFinite = evFile('rp-bad', [sw('cs-p20', 0.5, null, 100)], 'T');
  const bad = cliIo();
  assert.equal(await main(['random-params', '--registration', reg, '--stratum', 'quality', '--evidence', nonFinite], bad), 1);
  assert.match(bad.errs.join('\n'), /upSwitches/);
  const elsewhere = evFile('rp-task', [sw('cs-zzz', 0.5, 1, 100)], 'T');
  const wrongTask = cliIo();
  assert.equal(await main(['random-params', '--registration', reg, '--stratum', 'other', '--evidence', elsewhere], wrongTask), 1);
  assert.match(wrongTask.errs.join('\n'), /cs-zzz/);
  const notArray = join(ROOT, 'ev', 'notarray.json');
  writeFileSync(notArray, '{}');
  const na = cliIo();
  assert.equal(await main(['random-params', '--registration', reg, '--stratum', 'quality', '--evidence', notArray], na), 1);
  assert.match(na.errs.join('\n'), /array/);
});

await ta('evidence of one arm given under another arm name is refused, naming the file and the run (ruling P20); a valid callLog is accepted', async () => {
  const reg0 = committed(STEP0);
  const mine = (arm, taskId = 'cs-p20') => R({ arm, taskId, calls: 1, callLog: [{ request: 0, level: 'xhigh', reason: 'review' }] });
  const ok = (over = {}) => ({ 'F-L': [mine('F-L')], 'F-X': [mine('F-X')], 'F-LX': [mine('F-LX')], 'F-XL': [mine('F-XL')], ...over });
  const argsFor = (map) => Object.entries(map).flatMap(([name, runs]) => ['--evidence', `${name}=${evFile(`own-${name}`, runs)}`]);
  const good = cliIo();
  assert.equal(await main(['analyze0', '--registration', reg0, ...argsFor(ok())], good), 0, good.errs.join('\n'));
  // F-L's runs given as the F-LX evidence (the review's case): a refusal, no verdict
  const swapped = ok({ 'F-LX': [mine('F-L')] });
  const bad = cliIo();
  assert.equal(await main(['analyze0', '--registration', reg0, ...argsFor(swapped)], bad), 1);
  const msg = bad.errs.join('\n');
  assert.ok(msg.includes('own-F-LX.json'), msg);
  assert.ok(msg.includes(swapped['F-LX'][0].runId), msg);
  assert.match(msg, /arm "F-L".*arm "F-LX"/);
  assert.deepEqual(bad.logs, []);
  // one wrong run among right ones is enough
  const mixed = ok({ 'F-X': [mine('F-X'), mine('F-X'), mine('F-LX')] });
  assert.equal(await main(['analyze0', '--registration', reg0, ...argsFor(mixed)], cliIo()), 1);
  // the placeholder arm (a Run with no arm of its own) matches nothing
  assert.equal(await main(['analyze0', '--registration', reg0, ...argsFor(ok({ 'F-L': [R({})] }))], cliIo()), 1);
  // step 1, including the strata and random-params
  const reg1 = committed(STEP1);
  const arms1 = (over = {}) => ({ L: [mine('L')], X: [mine('X')], T: [mine('T')], P: [mine('P')], ...over });
  assert.equal(await main(['analyze1', '--registration', reg1, ...argsFor(arms1())], cliIo()), 0);
  const p = cliIo();
  assert.equal(await main(['analyze1', '--registration', reg1, ...argsFor(arms1({ P: [mine('T')] }))], p), 1);
  assert.match(p.errs.join('\n'), /arm "T".*arm "P"/);
  const rp = cliIo();
  assert.equal(await main(['random-params', '--registration', reg1, '--stratum', 'quality', '--evidence', evFile('rp-wrong-arm', [mine('P')])], rp), 1);
  assert.match(rp.errs.join('\n'), /arm "P".*arm "T"/);
  const regR = committed(STEP1R);
  const withR = (rq, ro) => arms1({ 'R-quality': rq, 'R-other': ro });
  const rOk = cliIo();
  assert.equal(await main(['analyze1', '--registration', regR, ...argsFor(withR([mine('R-quality')], [mine('R-other', 'cs-p01')]))], rOk), 0, rOk.errs.join('\n'));
  assert.equal(await main(['analyze1', '--registration', regR, ...argsFor(withR([mine('R-other')], [mine('R-other', 'cs-p01')]))], cliIo()), 1);
});

await ta('analyze1 stops on more than 2 audit exclusions in one arm, including a stratum of the random arm (ruling P23)', async () => {
  const regR = committed(STEP1R);
  const cellOf = (arm, task, n, over = {}) => Array.from({ length: n }, (_, rep) => R({ arm, taskId: task, rep, ...over }));
  const armRuns = (arm, tasks) => tasks.flatMap((task) => cellOf(arm, task, task === 'cs-p20' ? 8 : 2));
  const audited = (arm, task, k) => cellOf(arm, task, k, { excludedFor: 'audit', pass: null, rep: 50 });
  const run = async (extra) => {
    const evidence = {
      L: armRuns('L', TASKS), X: armRuns('X', TASKS), T: armRuns('T', TASKS), P: armRuns('P', TASKS),
      'R-quality': armRuns('R-quality', ['cs-p20']), 'R-other': armRuns('R-other', ['cs-p01', 'cs-p05']),
    };
    for (const [arm, runs] of Object.entries(extra)) evidence[arm] = [...evidence[arm], ...runs];
    const io = cliIo();
    assert.equal(await main(['analyze1', '--registration', regR, ...evArgs(evidence)], io), 0, io.errs.join('\n'));
    return JSON.parse(io.logs[0]);
  };
  assert.deepEqual((await run({})).stop, []);
  assert.deepEqual((await run({ T: audited('T', 'cs-p01', 2) })).stop, []);
  assert.deepEqual((await run({ T: audited('T', 'cs-p01', 3) })).stop, ['audit:T']);
  assert.deepEqual((await run({ 'R-other': audited('R-other', 'cs-p01', 3) })).stop, ['audit:R-other']);
  assert.deepEqual((await run({ 'R-quality': audited('R-quality', 'cs-p20', 3), L: audited('L', 'cs-p20', 4) })).stop, ['audit:L', 'audit:R-quality']);
  // 2 in each stratum is within the limit although the merged R holds 4
  assert.deepEqual((await run({ 'R-quality': audited('R-quality', 'cs-p20', 2), 'R-other': audited('R-other', 'cs-p01', 2) })).stop, []);
});

await ta('random-params prints the solved parameters with the expected values and gaps, and refuses (exit 1, no pUp/pDown) beyond 25% (ruling P22)', async () => {
  const reg = committed(STEP1);
  const evidenceOf = (n, s, u) => evFile(`rp-${n}-${s}-${u}`, [R({ taskId: 'cs-p20', shareXhigh: s, upSwitches: u, requests: n })], 'T');
  const call = async (n, s, u) => {
    const io = cliIo();
    const code = await main(['random-params', '--registration', reg, '--stratum', 'quality', '--evidence', evidenceOf(n, s, u)], io);
    return { code, io, out: JSON.parse(io.logs[0]) };
  };
  // a target the chain reaches: parameters, expected values equal to the targets, tiny gaps
  const ok = await call(15, 0.4, 1);
  assert.equal(ok.code, 0, ok.io.errs.join('\n'));
  assert.ok(ok.out.pUp > 0 && ok.out.pUp <= 1 && ok.out.pDown > 0 && ok.out.pDown <= 1);
  assert.ok(Math.abs(ok.out.expected.share - 0.4) < 1e-9 && Math.abs(ok.out.expected.upSwitches - 1) < 1e-9);
  assert.ok(Math.abs(ok.out.gap.share) < 1e-9 && Math.abs(ok.out.gap.upSwitches) < 1e-9);
  assert.equal(ok.out.n, 15);
  // n = 2 can never hold more than half of its requests at xhigh: the share gap is (0.5 - s) / s
  const near = await call(2, 0.65, 1); // gap -0.2308: within the limit
  assert.equal(near.code, 0, near.io.errs.join('\n'));
  assert.ok(near.out.pUp !== undefined && near.out.gap.share < -0.2 && near.out.gap.share > -0.25, JSON.stringify(near.out.gap));
  const over = await call(2, 0.7, 1); // gap -0.2857: refused
  assert.equal(over.code, 1);
  assert.equal('pUp' in over.out, false);
  assert.equal('pDown' in over.out, false);
  assert.ok(over.out.gap.share < -0.25 && typeof over.out.refused === 'string', JSON.stringify(over.out));
  assert.match(over.io.errs.join('\n'), /refused.*25/);
  // the up-switch gap alone refuses too (a 0.1 share cannot hold 5 up-switches over 20 requests: the share overshoots instead)
  const ups = await call(20, 0.1, 5);
  assert.equal(ups.code, 1);
  assert.equal('pUp' in ups.out, false);
  // the up-switch gap alone: over 3 requests a share of 0.5 is reachable, but not with 2 up-switches (at most 1): share exact, ups -50%
  const upsOnly = await call(3, 0.5, 2);
  assert.equal(upsOnly.code, 1);
  assert.ok(Math.abs(upsOnly.out.gap.share) < 1e-9 && upsOnly.out.gap.upSwitches < -0.25, JSON.stringify(upsOnly.out.gap));
  assert.equal('pUp' in upsOnly.out, false);
  // a degenerate target keeps its old output and exit 0
  const flat = await call(20, 0, 3);
  assert.equal(flat.code, 0);
  assert.equal(flat.out.degenerate, true);
  assert.equal(flat.out.pUp, 0);
});

await ta('main: an unknown command and a command that throws', async () => {
  const io = cliIo();
  assert.equal(await main(['nope'], io), 64);
  assert.match(io.errs.join('\n'), /usage: toggle\.mjs/);
  const gone = cliIo();
  assert.equal(await main(['stage-config', '--registration', join(ROOT, 'missing.json'), '--arm', 'T', '--out', outPath('x.json')], gone), 1);
});
