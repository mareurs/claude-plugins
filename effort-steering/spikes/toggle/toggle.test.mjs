// toggle.test.mjs — the effort-toggle CLI (toggle.mjs) and the registration format (registration.mjs), on fixtures built in a temporary
// directory: a temp git repo for the committed-registration check, a fake work root for check-runs, a tiny runs directory for check-known.
//
//   TMPDIR=/home/marius/.cache/sdd-effort-toggle-tmp node --test effort-steering/spikes/toggle/toggle.test.mjs
//
// Never calls a model, runs Docker or touches a real run directory.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadS5Config } from '../s5/prereg.mjs';
import { ta } from '../s5/fixtures/testkit-async.mjs';
import { TOOL_TEXT_SHA256, loadRegistration, stageArmConfig } from './registration.mjs';
import { TOOL_DESCRIPTION } from './mod/hooks/register.ts';
import { main, parseFlags } from './toggle.mjs';

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
    T: arm('C', 4, TASKS, { mode: 'toggle' }),
    P: arm('C', 4, TASKS, { mode: 'placebo' }),
    R: arm('C', 4, ['cs-p20'], { mode: 'random', random: { pUp: 0.1, pDown: 0.2, seed: 7 } }),
  },
  toolTextSha256: TOOL_TEXT_SHA256,
  verdict: { qualityTask: 'cs-p20', qualityRuns: 8, otherRuns: 2, costEstimator: 'run' },
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
  const reg = committed(STEP1);
  for (const name of ['T', 'X', 'R']) {
    const plain = outPath(`plain-${name}.json`);
    const more = outPath(`more-${name}.json`);
    assert.equal(await main(['stage-config', '--registration', reg, '--arm', name, '--out', plain], cliIo()), 0);
    assert.equal(await main(['stage-config', '--registration', reg, '--arm', name, '--runs', '6', '--out', more], cliIo()), 0);
    const a = JSON.parse(readFileSync(plain, 'utf8'));
    const b = JSON.parse(readFileSync(more, 'utf8'));
    const s5Arm = STEP1.arms[name].s5Arm;
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
  const noR = clone(STEP1);
  delete noR.arms.R;
  assert.deepEqual(loadRegistration(committed(noR)), noR);
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
    ['verdict.qualityTask', mutate((r) => { r.verdict.qualityTask = 'cs-p01'; r.arms.T.tasks = ['cs-p20']; })],
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
    ['cs-nope', mutate((r) => { r.arms.T.tasks = ['cs-nope']; r.verdict.qualityTask = 'cs-nope'; })],
    ['mod.random.seed', mutate((r) => { r.arms.R.mod.random.seed = 4294967296; })],
    ['mod', mutate((r) => { r.arms.T.mod.extra = 1; })],
    ['model', mutate((r) => { delete r.base.model; })],
    ['switchAt', mutate((r) => { r.switchAt = 0; }, STEP0)],
    ['extension', mutate((r) => { r.extension = -1; }, STEP0)],
  ];
  for (const [field, reg] of cases) {
    assert.throws(() => loadRegistration(committed(reg)), (err) => err.message.includes(field), `${field}: ${JSON.stringify(reg).slice(0, 80)}`);
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
await ta('check-runs over a fixture work root writes the expected Run objects', async () => {
  const work = join(ROOT, 'work-cr');
  const runs = join(work, 'runs');
  const good = [{ effort: 'low', tools: [NARROW] }, { effort: 'low', tools: [EDIT] }, { effort: 'xhigh', tools: [BROAD] }, { effort: 'xhigh' }];
  makeRun(runs, 'cs-p20.C.0-a1', 'sess-0', transcript(good), agreeing(good));
  // Run 1: the first attempt (a1) had no transcript and was retried (a2): the directory of the row is the one that holds its session.
  makeRun(runs, 'cs-p20.C.1-a1', 'sess-gone', null);
  const disagree = [{ effort: 'low' }, { effort: 'xhigh' }];
  makeRun(runs, 'cs-p20.C.1-a2', 'sess-1', transcript(disagree), agreeing([{ effort: 'low' }, { effort: 'low' }]));
  // Run 2: an audit hit and a mod error: audit wins (ruling P10).
  const peek = [{ effort: 'low', tools: [bash('cat /run/state/effort-toggle/log.jsonl')] }];
  makeRun(runs, 'cs-p20.C.2-a1', 'sess-2', transcript(peek), `${agreeing(peek)}${JSON.stringify({ type: 'error', message: 'x' })}\n`);
  // Run 3: no mod log. Run 4: a failed grade-less final row (infra_exhausted) with no directory at all.
  makeRun(runs, 'cs-p01.C.0-a1', 'sess-3', transcript(good));
  const rows = [
    { runId: 'cs-p20.C.1', taskId: 'cs-p20', rep: 1, sessionId: 'sess-gone', infra: 'container_failed', final: false, costUsd: 0.1, grade: null },
    { runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, sessionId: 'sess-0', infra: null, final: true, costUsd: 0.5, grade: { infra: null, pass: true } },
    { runId: 'cs-p20.C.1', taskId: 'cs-p20', rep: 1, sessionId: 'sess-1', infra: null, final: true, costUsd: 0.25, grade: { infra: null, pass: false } },
    { type: 'stopped', at: 'x', reason: 'cost' },
    { runId: 'cs-p20.C.2', taskId: 'cs-p20', rep: 2, sessionId: 'sess-2', infra: null, final: true, costUsd: null, grade: { infra: null, pass: true } },
    { runId: 'cs-p01.C.0', taskId: 'cs-p01', rep: 0, sessionId: 'sess-3', infra: null, final: true, costUsd: 1, grade: { infra: null, pass: true } },
    { runId: 'cs-p05.C.0', taskId: 'cs-p05', rep: 0, sessionId: null, infra: 'infra_exhausted', final: true, costUsd: null, grade: null },
  ];
  const rowsFile = join(ROOT, 'rows-cr.jsonl');
  writeFileSync(rowsFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n\n`);
  const out = outPath('runs-cr.json');
  const io = cliIo();
  assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--mode', 'toggle', '--out', out], io), 0, io.errs.join('\n'));
  const got = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(got, [
    {
      runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, pass: true, costUsd: 0.5, excludedFor: null, secondTurn: false, broadAt: [2], requests: 4, shareXhigh: 0.5, upSwitches: 1,
    },
    {
      runId: 'cs-p20.C.1', taskId: 'cs-p20', rep: 1, pass: false, costUsd: 0.25, excludedFor: 'log_transcript_mismatch', secondTurn: false, broadAt: [], requests: 2, shareXhigh: 0.5, upSwitches: 1,
    },
    {
      runId: 'cs-p20.C.2', taskId: 'cs-p20', rep: 2, pass: true, costUsd: null, excludedFor: 'audit', secondTurn: false, broadAt: [], requests: 1, shareXhigh: 0, upSwitches: 0,
    },
    {
      runId: 'cs-p01.C.0', taskId: 'cs-p01', rep: 0, pass: true, costUsd: 1, excludedFor: 'no_mod_log', secondTurn: false, broadAt: [2], requests: 4, shareXhigh: 0.5, upSwitches: 1,
    },
    {
      runId: 'cs-p05.C.0', taskId: 'cs-p05', rep: 0, pass: null, costUsd: null, excludedFor: 'no_transcript', secondTurn: false, broadAt: [], requests: 0, shareXhigh: 0, upSwitches: 0,
    },
  ]);
});

await ta('check-runs: a second final row of a run replaces the first; --mode must be an S5 mod mode; flags are required', async () => {
  const work = join(ROOT, 'work-cr2');
  const reqs = [{ effort: 'low' }];
  makeRun(join(work, 'runs'), 'cs-p20.C.0-a2', 'sess-b', transcript(reqs), agreeing(reqs));
  const rowsFile = join(ROOT, 'rows-cr2.jsonl');
  writeFileSync(rowsFile, jsonl([
    { runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, sessionId: 'sess-a', infra: 'infra_exhausted', final: true, costUsd: null, grade: null },
    { runId: 'cs-p20.C.0', taskId: 'cs-p20', rep: 0, sessionId: 'sess-b', infra: null, final: true, costUsd: 0.3, grade: { infra: null, pass: true } },
  ]));
  const out = outPath('runs-cr2.json');
  assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--mode', 'toggle', '--out', out], cliIo()), 0);
  const got = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(got.length, 1);
  assert.equal(got[0].pass, true);
  assert.equal(got[0].excludedFor, null);
  const bad = cliIo();
  assert.equal(await main(['check-runs', '--work-root', work, '--rows', rowsFile, '--mode', 'nope', '--out', out], bad), 64);
  assert.equal(await main(['check-runs', '--work-root', work, '--mode', 'toggle', '--out', out], cliIo()), 64);
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
const R = (over) => ({
  runId: 'x', taskId: 'cs-p20', rep: 0, pass: true, costUsd: 1, excludedFor: null, secondTurn: false, broadAt: [], requests: 20, shareXhigh: 0, upSwitches: 0, ...over,
});
const evFile = (name, runs) => {
  const file = join(ROOT, 'ev', `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(runs));
  return file;
};
const evArgs = (map) => Object.entries(map).flatMap(([arm, runs]) => ['--evidence', `${arm}=${evFile(arm, runs)}`]);

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

await ta('random-params passes randomParams only counted runs with finite shareXhigh, upSwitches and requests', async () => {
  const runs = [
    R({ shareXhigh: 0.5, upSwitches: 2, requests: 100 }),
    R({ shareXhigh: 0.3, upSwitches: 4, requests: 100 }),
    R({ shareXhigh: 0.9, upSwitches: 9, requests: 9, excludedFor: 'audit' }),
    R({ shareXhigh: 0.9, upSwitches: 9, requests: 9, pass: null }),
    R({ shareXhigh: Number.NaN, upSwitches: 9, requests: 9 }),
    R({ shareXhigh: 0.9, upSwitches: null, requests: 9 }),
    R({ shareXhigh: 0.9, upSwitches: 9, requests: undefined }),
  ];
  // JSON turns NaN into null, which is not finite either
  const io = cliIo();
  assert.equal(await main(['random-params', '--evidence', evFile('rp', runs)], io), 0, io.errs.join('\n'));
  const got = JSON.parse(io.logs[0]);
  assert.equal(got.s, 0.4);
  assert.equal(got.u, 3);
  assert.equal(got.n, 100);
  assert.equal(got.degenerate, false);
  assert.equal(await main(['random-params'], cliIo()), 64);
  const bad = join(ROOT, 'ev', 'notarray.json');
  writeFileSync(bad, '{}');
  const notArray = cliIo();
  assert.equal(await main(['random-params', '--evidence', bad], notArray), 1);
  assert.match(notArray.errs.join('\n'), /array/);
});

await ta('main: an unknown command and a command that throws', async () => {
  const io = cliIo();
  assert.equal(await main(['nope'], io), 64);
  assert.match(io.errs.join('\n'), /usage: toggle\.mjs/);
  const gone = cliIo();
  assert.equal(await main(['stage-config', '--registration', join(ROOT, 'missing.json'), '--arm', 'T', '--out', outPath('x.json')], gone), 1);
});
