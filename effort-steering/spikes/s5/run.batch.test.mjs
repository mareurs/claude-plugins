// run.batch.test.mjs — runBatch (Task 10c): the batch layer of the S5 runner. Rulings R2, R59, R91, R100, R101, R102, R106, R114, R117, R119,
// R121, R122 (the sweep label) and R123 (one batch per work root).
//
// Unit mode: runBatch runs with an injected `ctx.runOne` (a scripted fake that returns Rows, throws, or waits), injected `imageIdOf`,
// `sha256File` and `proxyRunning`, and the FAKE docker (fixtures/fake-docker.mjs) behind `ctx.dockerBin` for the sweep. The built tasks are
// made by hand by fixtures/batch-world.mjs (the same hashes as buildTask: hashBuiltTask), so these tests need neither Docker nor a reflink
// filesystem nor a model. Their directories live under one mkdtemp directory of os.tmpdir(), removed on process exit.
//
// Integration mode (the end of the file): one smoke batch over a task built by the REAL buildTask, with the REAL runOne, the fake docker and
// the fake claude, to prove the wiring; and, with S5_DOCKER_TESTS=1, the same smoke batch against the real s5/plugins image with a shell
// script for the Claude binary. No test starts a model: the token is a sentinel. A test that installs a signal handler removes it on every path.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTask } from './build-task.mjs';
import { makeWorld } from './fixtures/batch-world.mjs';
import { makeRepo } from './fixtures/make-repo.mjs';
import { ta } from './fixtures/testkit-async.mjs';
import { writeHookCopy } from './hook-copy.mjs';
import { PROXY_IMAGE } from './proxy.mjs';
import { planRunsS5, runBatch } from './run.mjs';
import { IMAGE_FOR_REPO } from './task-def.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_DOCKER = path.join(HERE, 'fixtures', 'fake-docker.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures', 'fake-claude.mjs');
const ES_ROOT = path.resolve(HERE, '..', '..');
const WORK = path.join(os.homedir(), 'work', 'claude', 's5-work');
const TMP_BASE = path.join(WORK, 'tmp-tests-t10c');

const ROOT = mkdtempSync(path.join(os.tmpdir(), 's5-batch-'));
const sceneDirs = [];
process.on('exit', () => {
  rmSync(ROOT, { recursive: true, force: true });
  for (const d of sceneDirs) rmSync(d, { recursive: true, force: true });
  try {
    rmdirSync(TMP_BASE);
  } catch {
    // another run's directories are in it, or it is gone
  }
});

// The token of every test: a sentinel, never a real value.
const SENTINEL = 'sk-ant-oat01-BATCH-SENTINEL-this-is-not-a-real-token-9876543210';
process.env.CLAUDE_CODE_OAUTH_TOKEN = SENTINEL;
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
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
}

const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(cond, what, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let dirSeq = 0;
const fresh = (name = 'b') => {
  const dir = path.join(ROOT, `${name}-${dirSeq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
// A mode (chmod) does not stop root; the tests that rely on one are skipped for root. A skip is printed as a skip, never as a pass.
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const taIf = async (name, skipReason, fn) => {
  if (skipReason) console.log(`ok - ${name} # SKIP ${skipReason}`);
  else await ta(name, fn);
};
// How many SIGINT and SIGTERM listeners the process has: a batch installs one of each while it runs and removes both on every path.
const listeners = () => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];

// ---- the registrations under test ----

const hex = (n) => n.toString(16).padStart(64, '0');
const digest = (n) => `sha256:${hex(n)}`;
const deepFreeze = (v) => {
  if (v !== null && typeof v === 'object') {
    for (const inner of Object.values(v)) deepFreeze(inner);
    Object.freeze(v);
  }
  return v;
};
const NO_MARKER = Symbol('no marker');
const IMAGES = { codescout: digest(0x1), 'claude-plugins': digest(0x2), proxy: digest(0x3) };
const IMAGE_ID_OF_REF = { [IMAGE_FOR_REPO.codescout]: IMAGES.codescout, [IMAGE_FOR_REPO['claude-plugins']]: IMAGES['claude-plugins'], [PROXY_IMAGE]: IMAGES.proxy };
const CLI_HEX = 'c1'.repeat(32);
const CLI_SHA = `sha256:${CLI_HEX}`;

function makePrereg(world, { runs, limits = {}, stopAtCostUsd = 100, registered = true, images = IMAGES, cli = CLI_SHA, orderSeed = 7 }) {
  const object = {
    model: 'claude-sonnet-5-5',
    cli: { version: '2.1.292', sha256: cli },
    arms: {
      A: { effort: 'xhigh', steer: false, runs: runs.A },
      B: { effort: 'xhigh', steer: true, runs: runs.B },
      C: { effort: 'low', steer: false, runs: runs.C },
    },
    tasks: world.tasks.map(({ id, treeHash, hiddenHash, promptHash }) => ({ id, treeHash, hiddenHash, promptHash })),
    margin: 0.15,
    alpha: 0.05,
    bound: { method: 'percentile', resamples: 10000, seed: 7 },
    orderSeed,
    mechanism: { alpha: 0.05, permutations: 1000, seed: 13, effectSizeThinkingTokens: 500 },
    limits: { timeoutMinutes: 90, cpus: 4, memoryGb: 16, concurrency: 2, infraRetries: 2, ...limits },
    images,
    proxyAllowlist: ['api.anthropic.com'],
    stopAtCostUsd,
  };
  return deepFreeze(registered === NO_MARKER ? object : { ...object, registered });
}

// ---- Rows ----

const ROW_KEYS = [
  'runId', 'taskId', 'taskIndex', 'arm', 'effort', 'rep', 'round', 'sessionId', 'startedAt', 'wallMs', 'exit', 'infra', 'final', 'decision', 'usage', 'efforts', 'costUsd', 'numTurns', 'isError', 'tokenScrubbed',
  'firstUserTextOk', 'testsRunBeforeDone', 'finalTextTail', 'grade',
];
let sessionSeq = 0;
// A counted Row as runOne returns it: infra null, final true.
function okRow(run, over = {}) {
  return {
    runId: run.runId,
    taskId: run.taskId,
    taskIndex: run.taskIndex,
    arm: run.arm,
    effort: run.effort,
    rep: run.rep,
    round: run.round,
    sessionId: `00000000-0000-4000-8000-${String(++sessionSeq).padStart(12, '0')}`,
    startedAt: '2026-10-09T10:00:00.000Z',
    wallMs: 100,
    exit: { code: 0, timedOut: false, oomKilled: false },
    infra: null,
    final: true,
    decision: run.arm === 'B' ? { arm: 'treated', steered: true } : { arm: 'holdout', steered: false },
    usage: null,
    efforts: [run.effort],
    costUsd: 1,
    numTurns: 3,
    isError: false,
    tokenScrubbed: 0,
    firstUserTextOk: true,
    testsRunBeforeDone: true,
    finalTextTail: 'Done.',
    grade: { infra: null, pass: true },
    ...over,
  };
}
// An infrastructure Row as runOne returns it: non-final, no grade.
const infraRow = (run, infra, over = {}) => okRow(run, { infra, final: false, grade: null, ...over });

const readLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const isTyped = (o) => Object.hasOwn(o, 'type');
const rowsIn = (file) => readLines(file).filter((o) => !isTyped(o));
const stoppedIn = (file) => readLines(file).filter((o) => o.type === 'stopped');

// ---- the fake docker (a copy of run.test.mjs's wrapper: it exports the two control variables), optionally probing the lock ----

function fakeDocker(config = {}, lockFile = null) {
  const dir = mkdtempSync(path.join(ROOT, 'fake-docker-'));
  const log = path.join(dir, 'log.jsonl');
  const cfg = path.join(dir, 'config.json');
  const probe = path.join(dir, 'lock-probe.txt');
  writeFileSync(cfg, JSON.stringify(config));
  const bin = path.join(dir, 'docker');
  // Every call first notes whether the batch's lock file exists at that moment (the sweep is a docker call).
  const probeLines = lockFile === null ? '' : `if [ -e ${shq(lockFile)} ]; then echo locked >> ${shq(probe)}; else echo unlocked >> ${shq(probe)}; fi\n`;
  writeFileSync(bin, `#!/bin/sh\n${probeLines}export FAKE_DOCKER_LOG=${shq(log)}\nexport FAKE_DOCKER_CONFIG=${shq(cfg)}\nexec ${shq(process.execPath)} ${shq(FAKE_DOCKER)} "$@"\n`);
  chmodSync(bin, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const probes = () => (existsSync(probe) ? readFileSync(probe, 'utf8').split('\n').filter(Boolean) : []);
  return { bin, dir, calls, probes };
}

// ---- the bench: a world, a prereg, a scripted runOne and every seam ----

// o.script(call) -> a Row, a promise of one, or throws. call = { run, ctx, attempt, n, hookMark }. The attempt directory is made as the real
// runOne makes it (and refused when it exists).
function bench(o = {}) {
  const {
    specs = [{ id: 'ta' }], runs = { A: 1, B: 1, C: 1 }, limits, stopAtCostUsd, registered = true, mode = 'pilot', dockerConfig = {}, options = {}, ctx = {},
    script, images = IMAGES, cli = CLI_SHA, orderSeed = 7, makeAttemptDir = true,
  } = o;
  const dir = fresh('bench');
  const world = makeWorld(dir, specs);
  const prereg = makePrereg(world, { runs, limits, stopAtCostUsd, registered, images, cli, orderSeed });
  const lockFile = path.join(world.workRoot, 'batch.lock');
  const docker = fakeDocker(dockerConfig, lockFile);
  const rowsFile = path.join(dir, 'rows.jsonl');
  const claudeBin = path.join(dir, 'claude-bin');
  const b = {
    dir, world, prereg, docker, rowsFile, lockFile, claudeBin, calls: [], kills: [], imageAsked: [], shaAsked: [], proxyAsked: 0, proxyUp: true, inFlight: 0, maxInFlight: 0, script: script ?? (({ run }) => okRow(run)),
  };
  const runOne = async (run, runCtx) => {
    const copyDir = runCtx.hookCopy?.copyDir;
    const call = { run, ctx: runCtx, attempt: runCtx.attempt, n: b.calls.length, hookMark: copyDir === undefined ? null : existsSync(path.join(copyDir, 'MARK')), lockHeld: existsSync(lockFile) };
    if (call.n === 0 && copyDir !== undefined && existsSync(copyDir)) writeFileSync(path.join(copyDir, 'MARK'), 'first call\n');
    b.calls.push(call);
    b.inFlight += 1;
    b.maxInFlight = Math.max(b.maxInFlight, b.inFlight);
    try {
      if (makeAttemptDir) {
        mkdirSync(path.join(world.workRoot, 'runs'), { recursive: true });
        mkdirSync(path.join(world.workRoot, 'runs', `${run.runId}-a${runCtx.attempt}`)); // as runOne: an existing attempt directory is refused
        mkdirSync(path.join(world.workRoot, 'runs', `${run.runId}-a${runCtx.attempt}`, 'config'));
        mkdirSync(path.join(world.workRoot, 'runs', `${run.runId}-a${runCtx.attempt}`, 'state'));
      }
      const row = await b.script(call);
      call.row = row;
      return row;
    } finally {
      b.inFlight -= 1;
    }
  };
  const seams = {
    runOne,
    imageIdOf: async (ref) => {
      b.imageAsked.push(ref);
      if (!Object.hasOwn(IMAGE_ID_OF_REF, ref)) throw new Error(`No such image: ${ref}`);
      return IMAGE_ID_OF_REF[ref];
    },
    sha256File: async (file) => {
      b.shaAsked.push(file);
      return CLI_HEX;
    },
    proxyRunning: async () => {
      b.proxyAsked += 1;
      return b.proxyUp;
    },
    kill: (pid, signal) => {
      b.kills.push({ pid, signal, sigintListeners: process.listenerCount('SIGINT'), sigtermListeners: process.listenerCount('SIGTERM') });
    },
    esRoot: ES_ROOT,
    claudeBin,
    dockerBin: docker.bin,
  };
  b.options = (over = {}) => ({ mode, workRoot: world.workRoot, rowsFile, ...options, ...over, ctx: { ...seams, ...ctx, ...(over.ctx ?? {}) } });
  b.run = (over) => runBatch(prereg, b.options(over));
  b.runWith = (otherPrereg, over) => runBatch(otherPrereg, b.options(over));
  b.rows = () => rowsIn(rowsFile);
  b.lines = () => readLines(rowsFile);
  b.starts = () => b.calls.map((c) => c.run.runId);
  b.plan = (over = {}) => planRunsS5(prereg, { mode, ...over });
  return b;
}

// A refusal: the promise rejects with a message that matches, holds no token, and NOTHING was written or started: the rows file is as it was,
// no runs/, hook/ or lock, no docker call (the sweep never ran), no run.
async function refuses(b, pattern, label, over, prereg = b.prereg) {
  const rowsBefore = existsSync(b.rowsFile) ? readFileSync(b.rowsFile) : null;
  const dockerBefore = b.docker.calls().length;
  const runsDir = path.join(b.world.workRoot, 'runs');
  const hadRuns = existsSync(runsDir);
  let err;
  try {
    await b.runWith(prereg, over);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, `${label}: must throw`);
  assert.match(err.message, pattern, label);
  assert.ok(!err.message.includes(SENTINEL) && !String(err.stack).includes(SENTINEL), `${label}: the error never holds the token`);
  assert.deepEqual(existsSync(b.rowsFile) ? readFileSync(b.rowsFile) : null, rowsBefore, `${label}: the rows file is as it was`);
  assert.equal(b.calls.length, 0, `${label}: no run started`);
  assert.equal(b.docker.calls().length, dockerBefore, `${label}: the sweep never ran`);
  for (const rel of ['hook', 'batch.lock']) assert.ok(!existsSync(path.join(b.world.workRoot, rel)), `${label}: no ${rel}`);
  if (!hadRuns) assert.ok(!existsSync(runsDir), `${label}: no runs/`);
  return err;
}

// =====================================================================================================================
// the run loop: order, concurrency, the rows file, resume, retries, the exhausted row, a thrown runOne, attempt numbers
// =====================================================================================================================

await ta('a clean batch: every planned run runs once in the order of planRunsS5, one final line per run is appended, the Summary has the keys of the brief, and the prereg is never mutated', async () => {
  const b = bench({ specs: [{ id: 'ta' }, { id: 'tb' }], runs: { A: 2, B: 2, C: 1 } });
  const plan = b.plan();
  assert.equal(plan.length, 10);
  const before = JSON.stringify(b.prereg);
  const summary = await b.run();
  assert.deepEqual(b.starts(), plan.map((r) => r.runId), 'the runs start in the order of the plan');
  assert.deepEqual(Object.keys(summary).sort(), ['attempts', 'costUsd', 'exhausted', 'infraAttempts', 'mode', 'planned', 'ran', 'rowsFile', 'scrubbed', 'skippedFinal', 'smoke', 'stopped', 'tornLine']);
  assert.deepEqual(summary, {
    mode: 'pilot', planned: 10, skippedFinal: 0, ran: 10, attempts: 10, infraAttempts: 0, exhausted: 0, costUsd: 10, stopped: null, rowsFile: b.rowsFile, smoke: null, scrubbed: { dirs: 0, files: 0 }, tornLine: false,
  });
  const rows = b.rows();
  assert.equal(b.lines().length, 10, 'one line per attempt, nothing else');
  assert.deepEqual(rows.map((r) => r.runId).sort(), plan.map((r) => r.runId).sort());
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), [...ROW_KEYS].sort());
    assert.equal(r.final, true);
    assert.equal(r.infra, null);
  }
  assert.equal(JSON.stringify(b.prereg), before, 'the prereg is as it was (it is frozen: a write would have thrown)');
});

await ta('runOne is called with { ...ctx, prereg, workRoot, hookCopy, claudeBin, attempt, images }: the verified image ids of the planned repos, the hook copy under <workRoot>/hook, no batch seam; ctx options pass through', async () => {
  const b = bench({
    specs: [{ id: 'ta', repo: 'claude-plugins' }, { id: 'tb', repo: 'codescout' }],
    runs: { A: 1, B: 0, C: 0 },
    ctx: { keepRunDirs: true, network: 'none', proxyUrl: null, tokenEnv: 'CLAUDE_CODE_OAUTH_TOKEN', grade: async () => ({ infra: null, pass: true }) },
  });
  await b.run();
  assert.equal(b.calls.length, 2);
  const { ctx } = b.calls[0];
  assert.equal(ctx.prereg, b.prereg, 'the very object (it is never copied or changed)');
  assert.equal(ctx.workRoot, b.world.workRoot);
  assert.equal(ctx.attempt, 1);
  assert.equal(ctx.claudeBin, b.claudeBin);
  assert.equal(ctx.hookCopy.copyDir, path.join(b.world.workRoot, 'hook', 'es'));
  assert.equal(ctx.hookCopy.settingsFile, path.join(b.world.workRoot, 'hook', 'es', 'settings.json'));
  assert.deepEqual(ctx.images, { codescout: IMAGES.codescout, 'claude-plugins': IMAGES['claude-plugins'] }, 'the ids the preflight verified, so a retag during the batch changes nothing');
  assert.deepEqual([ctx.keepRunDirs, ctx.network, ctx.proxyUrl, typeof ctx.grade, ctx.tokenEnv], [true, 'none', null, 'function', 'CLAUDE_CODE_OAUTH_TOKEN'], 'runOne\'s own options pass through');
  for (const seam of ['runOne', 'imageIdOf', 'sha256File', 'proxyRunning', 'esRoot', 'kill']) assert.ok(!Object.hasOwn(ctx, seam), `the batch seam ${seam} is not passed on`);
  // Only the repos of planned tasks are named: a pilot on one task of one repo names that repo's image alone.
  const one = bench({ specs: [{ id: 'ta', repo: 'claude-plugins' }, { id: 'tb', repo: 'codescout' }], runs: { A: 1, B: 0, C: 0 } });
  await one.run({ taskIds: ['tb'] });
  assert.deepEqual(one.calls[0].ctx.images, { codescout: IMAGES.codescout });
  // A relative workRoot or rowsFile is resolved once: runOne and the Summary get the absolute paths.
  const rel = bench({ runs: { A: 1, B: 0, C: 0 } });
  const summary = await rel.run({ workRoot: path.relative(process.cwd(), rel.world.workRoot), rowsFile: path.relative(process.cwd(), rel.rowsFile) });
  assert.equal(summary.rowsFile, rel.rowsFile);
  assert.equal(rel.calls[0].ctx.workRoot, rel.world.workRoot);
  assert.equal(rel.lines().length, 1);
});

await ta('at most `concurrency` runs are in flight, never more and (with enough runs) exactly that many; the default is prereg.limits.concurrency and the option wins; starts keep the order of the plan', async () => {
  for (const [limit, option, want] of [[3, undefined, 3], [3, 1, 1], [2, 4, 4], [1, undefined, 1]]) {
    const b = bench({
      specs: [{ id: 'ta' }, { id: 'tb' }],
      runs: { A: 2, B: 2, C: 2 },
      limits: { concurrency: limit },
      script: async ({ run }) => {
        await sleep(10 + run.rep * 3 + (run.arm === 'B' ? 5 : 0));
        return okRow(run);
      },
    });
    await b.run(option === undefined ? {} : { concurrency: option });
    assert.equal(b.calls.length, 12);
    assert.equal(b.maxInFlight, want, `limit ${limit}, option ${option}: the maximum in flight`);
    assert.deepEqual(b.starts(), b.plan().map((r) => r.runId), 'the starts are in the order of the plan');
  }
});

await ta('the rows file is only ever appended to: what was there stays, byte for byte and in the same file; the summed cost covers the old rows and not the stopped line', async () => {
  const b = bench();
  const old = `${JSON.stringify(okRow({ runId: 'other.A.0', taskId: 'other', taskIndex: 9, arm: 'A', effort: 'xhigh', rep: 0, round: 0 }, { costUsd: 2.5 }))}\n${JSON.stringify({ type: 'stopped', at: '2026-10-08T00:00:00.000Z', reason: 'cost', costUsd: 3, limit: 3 })}\n`;
  writeFileSync(b.rowsFile, old);
  const ino = statSync(b.rowsFile).ino;
  const summary = await b.run();
  const now = readFileSync(b.rowsFile, 'utf8');
  assert.ok(now.startsWith(old), 'the old bytes are a prefix of the new file');
  assert.equal(statSync(b.rowsFile).ino, ino, 'the same file (not replaced by a rewrite)');
  assert.ok(now.endsWith('\n') && !now.endsWith('\n\n'));
  assert.equal(b.lines().length, 2 + 3);
  assert.equal(summary.costUsd, 2.5 + 3, 'the old row\'s cost counts, the stopped line\'s costUsd does not');
});

await ta('resume (R100): a run with a final row is skipped; an interrupted run (no row) starts again; retries are counted from the file across a resume', async () => {
  const b = bench({ limits: { infraRetries: 2 } });
  const [r0, r1, r2] = b.plan();
  writeFileSync(b.rowsFile, `${JSON.stringify(okRow(r0))}\n${JSON.stringify(infraRow(r1, 'api_error'))}\n`);
  mkdirSync(path.join(b.world.workRoot, 'runs', `${r2.runId}-a1`), { recursive: true }); // the directory an interrupted attempt left, and no row
  b.script = ({ run }) => (run.runId === r1.runId ? infraRow(run, 'api_error') : okRow(run));
  const summary = await b.run();
  const callsOf = (run) => b.calls.filter((c) => c.run.runId === run.runId);
  assert.equal(callsOf(r0).length, 0, 'the run with a final row is not started');
  assert.equal(callsOf(r1).length, 2, 'one non-final row in the file: two attempts are left of three');
  assert.deepEqual(callsOf(r2).map((c) => c.attempt), [2], 'the interrupted run starts again, past its stale directory');
  assert.deepEqual({ skippedFinal: summary.skippedFinal, ran: summary.ran, attempts: summary.attempts, infraAttempts: summary.infraAttempts, exhausted: summary.exhausted }, { skippedFinal: 1, ran: 2, attempts: 3, infraAttempts: 2, exhausted: 1 });
  const r1Rows = b.rows().filter((r) => r.runId === r1.runId);
  assert.deepEqual(r1Rows.map((r) => [r.final, r.infra]), [[false, 'api_error'], [false, 'api_error'], [true, 'infra_exhausted']], 'the file\'s row plus two new ones, the last exhausted');
  // A second resume finds every run final and starts nothing.
  const again = await b.run();
  assert.equal(b.calls.length, 3);
  assert.deepEqual({ skippedFinal: again.skippedFinal, ran: again.ran, attempts: again.attempts }, { skippedFinal: 3, ran: 0, attempts: 0 });
});

await ta('an infrastructure row is re-run at once up to infraRetries times: 1 + infraRetries attempts in all, the last written as ONE infra_exhausted line of the exact shape (R100)', async () => {
  for (const retries of [0, 1, 2, 3]) {
    const b = bench({ runs: { A: 1, B: 0, C: 0 }, limits: { infraRetries: retries }, script: ({ run }) => infraRow(run, 'api_error', { costUsd: 0.5, infraDetail: 'the API said no' }) });
    const summary = await b.run();
    assert.equal(b.calls.length, 1 + retries, `infraRetries ${retries}: attempts`);
    assert.deepEqual(b.calls.map((c) => c.attempt), Array.from({ length: 1 + retries }, (_, i) => i + 1), 'the attempt numbers count up');
    const rows = b.rows();
    assert.equal(b.lines().length, 1 + retries, 'one line per attempt: the exhausted row is the last attempt\'s own line, not a second one');
    for (const r of rows.slice(0, -1)) {
      assert.deepEqual([r.final, r.infra, Object.hasOwn(r, 'lastInfra')], [false, 'api_error', false]);
    }
    const last = rows.at(-1);
    assert.deepEqual(last, { ...b.calls.at(-1).row, final: true, infra: 'infra_exhausted', lastInfra: 'api_error' }, 'the last attempt\'s own row, exhausted, with the reason it ended in');
    assert.deepEqual({ attempts: summary.attempts, infraAttempts: summary.infraAttempts, exhausted: summary.exhausted, ran: summary.ran, costUsd: summary.costUsd }, { attempts: 1 + retries, infraAttempts: 1 + retries, exhausted: 1, ran: 1, costUsd: 0.5 * (1 + retries) });
  }
  // Infrastructure and then a good run: the retry is made at once, the second row is final and the first stays non-final.
  let n = 0;
  const b = bench({ runs: { A: 1, B: 0, C: 0 }, script: ({ run }) => (n++ === 0 ? infraRow(run, 'oom') : okRow(run)) });
  const summary = await b.run();
  assert.deepEqual(b.rows().map((r) => [r.final, r.infra]), [[false, 'oom'], [true, null]]);
  assert.deepEqual({ attempts: summary.attempts, infraAttempts: summary.infraAttempts, exhausted: summary.exhausted, ran: summary.ran }, { attempts: 2, infraAttempts: 1, exhausted: 0, ran: 1 });
});

await ta('a run whose earlier attempts already used up the allowance gets the exhausted line without a new attempt, and the line adds no cost to the sum', async () => {
  const b = bench({ runs: { A: 1, B: 0, C: 0 }, limits: { infraRetries: 2 }, stopAtCostUsd: 1000 });
  const [run] = b.plan();
  const earlier = [1, 2, 3].map((i) => infraRow(run, 'oom', { costUsd: 2, sessionId: `S-${i}` }));
  writeFileSync(b.rowsFile, `${earlier.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const summary = await b.run();
  assert.equal(b.calls.length, 0, 'no new attempt');
  const lines = b.rows();
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[3], { ...earlier[2], final: true, infra: 'infra_exhausted', lastInfra: 'oom', costUsd: null }, 'the last attempt\'s row, exhausted, its cost left to its own line');
  assert.deepEqual({ attempts: summary.attempts, exhausted: summary.exhausted, ran: summary.ran, costUsd: summary.costUsd }, { attempts: 0, exhausted: 1, ran: 1, costUsd: 6 });
  const again = await b.run();
  assert.equal(again.skippedFinal, 1);
  assert.equal(b.lines().length, 4, 'the exhausted line is final: the next resume skips the run');
});

await ta('a runOne that throws is an infrastructure attempt run_failed (R114): infraDetail is the message with the token redacted before it is cut to 300 characters, the Row has the Row\'s keys, and it counts toward the retries', async () => {
  const b = bench({
    runs: { A: 1, B: 1, C: 0 },
    limits: { infraRetries: 1 },
    script: ({ run }) => {
      if (run.arm === 'A') throw new Error(`${'y'.repeat(290)}${SENTINEL} and more after the token ${'z'.repeat(100)}`);
      return okRow(run);
    },
  });
  const summary = await b.run();
  const aRows = b.rows().filter((r) => r.arm === 'A');
  assert.equal(aRows.length, 2, '1 + infraRetries attempts');
  const [first, last] = aRows;
  assert.deepEqual(Object.keys(first).sort(), [...ROW_KEYS, 'infraDetail'].sort());
  assert.equal(first.infraDetail, `${'y'.repeat(290)}[REDACTED]`, 'redacted, THEN cut to 300 characters (a cut first would leave a fragment of the token)');
  assert.deepEqual(
    { ...first, startedAt: null },
    {
      runId: 'ta.A.0', taskId: 'ta', taskIndex: 0, arm: 'A', effort: 'xhigh', rep: 0, round: first.round, sessionId: null, startedAt: null, wallMs: null, exit: null, infra: 'run_failed', final: false,
      infraDetail: first.infraDetail, decision: null, usage: null, efforts: [], costUsd: null, numTurns: null, isError: null, tokenScrubbed: null, firstUserTextOk: null, testsRunBeforeDone: null, finalTextTail: '', grade: null,
    },
  );
  assert.match(first.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual([last.final, last.infra, last.lastInfra], [true, 'infra_exhausted', 'run_failed']);
  assert.equal(b.rows().filter((r) => r.arm === 'B')[0].infra, null, 'the other run is not affected');
  assert.deepEqual({ attempts: summary.attempts, infraAttempts: summary.infraAttempts, exhausted: summary.exhausted, ran: summary.ran }, { attempts: 3, infraAttempts: 2, exhausted: 1, ran: 2 });
  assert.ok(!readFileSync(b.rowsFile, 'utf8').includes(SENTINEL), 'the rows file never holds the token');

  // A thrown string, and a runOne that returns something that is no Row, or a Row of another run, or a Row that holds the token.
  const odd = bench({
    runs: { A: 1, B: 1, C: 1 },
    limits: { infraRetries: 0 },
    script: ({ run }) => {
      if (run.arm === 'A') throw 'plain string';
      if (run.arm === 'B') return { runId: 'someone.else.0', infra: null, final: true };
      return okRow(run, { finalTextTail: `the token is ${SENTINEL}` });
    },
  });
  await odd.run();
  const byArm = Object.fromEntries(odd.rows().map((r) => [r.arm, r]));
  assert.deepEqual([byArm.A.infra, byArm.A.infraDetail, byArm.A.lastInfra], ['infra_exhausted', 'plain string', 'run_failed']);
  assert.deepEqual([byArm.B.infra, byArm.B.lastInfra], ['infra_exhausted', 'run_failed']);
  assert.match(byArm.B.infraDetail, /no Row/);
  assert.deepEqual([byArm.C.infra, byArm.C.lastInfra], ['infra_exhausted', 'run_failed']);
  assert.match(byArm.C.infraDetail, /token/);
  assert.ok(!readFileSync(odd.rowsFile, 'utf8').includes(SENTINEL), 'a Row that holds the token is never stored');
});

await ta('the attempt number is 1 + the highest N among the existing runs/<runId>-aN entries (0 when none), never reused (R106a); other runs\' entries do not count', async () => {
  const b = bench({ runs: { A: 1, B: 1, C: 0 }, limits: { infraRetries: 1 }, script: ({ run }) => (run.arm === 'A' ? infraRow(run, 'api_error') : okRow(run)) });
  const [a, bb] = b.plan().sort((x, y) => (x.arm < y.arm ? -1 : 1));
  const runs = path.join(b.world.workRoot, 'runs');
  for (const name of [`${a.runId}-a1`, `${a.runId}-a4`, `${a.runId}-a9x`, `x${a.runId}-a7`, `${bb.runId}0-a9`, `${a.runId}-a`, 'unrelated']) mkdirSync(path.join(runs, name), { recursive: true });
  await b.run();
  assert.deepEqual(b.calls.filter((c) => c.run.arm === 'A').map((c) => c.attempt), [5, 6], 'past a4; entries that are not exactly <runId>-a<digits> (a9x, x<runId>-a7, a longer run id) do not count');
  assert.deepEqual(b.calls.filter((c) => c.run.arm === 'B').map((c) => c.attempt), [1], 'the directory of another run id (B0 with a 0 more) does not push the attempt of B');
});

// =====================================================================================================================
// the stop rule (R100) and hidden_changed (R101)
// =====================================================================================================================

const oldRow = (id, costUsd) => okRow({ runId: `old.${id}.0`, taskId: 'old', taskIndex: 9, arm: 'A', effort: 'xhigh', rep: 0, round: 0 }, { costUsd });

await ta('the stop rule: when the sum of EVERY row in the file is >= the limit nothing starts and one stopped line is appended; equal stops, just below does not; a null cost adds 0', async () => {
  const rows = [oldRow('x', 4), oldRow('y', 6), oldRow('z', null)];
  const seed = (b) => writeFileSync(b.rowsFile, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);

  const stops = bench({ runs: { A: 1, B: 1, C: 0 } });
  seed(stops);
  const summary = await stops.run({ stopAtCostUsd: 10 });
  assert.equal(stops.calls.length, 0, 'the sum is exactly the limit: nothing starts');
  const lines = stoppedIn(stops.rowsFile);
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]).sort(), ['at', 'costUsd', 'limit', 'reason', 'type']);
  assert.deepEqual({ ...lines[0], at: null }, { type: 'stopped', at: null, reason: 'cost', costUsd: 10, limit: 10 });
  assert.match(lines[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(summary.stopped, { reason: 'cost', costUsd: 10, limit: 10 });
  assert.deepEqual({ planned: summary.planned, ran: summary.ran, attempts: summary.attempts, costUsd: summary.costUsd }, { planned: 2, ran: 0, attempts: 0, costUsd: 10 });
  assert.equal(stops.lines().length, 4, 'three rows and one stopped line');

  const below = bench({ runs: { A: 1, B: 1, C: 0 } });
  seed(below);
  const ok = await below.run({ stopAtCostUsd: 10.01, concurrency: 1 });
  assert.equal(below.calls.length, 1, 'a sum just below the limit starts a run; its cost (1) then reaches the limit, so the second does not start');
  assert.deepEqual(ok.stopped, { reason: 'cost', costUsd: 11, limit: 10.01 });
  assert.equal(stoppedIn(below.rowsFile).length, 1);
});

await ta('the stop rule: in-flight runs finish and are recorded, nothing new starts, exactly one stopped line is written after them; the default limit is prereg.stopAtCostUsd', async () => {
  const b = bench({
    runs: { A: 2, B: 2, C: 1 },
    stopAtCostUsd: 10,
    script: async ({ run, n }) => {
      if (n === 0) return okRow(run, { costUsd: 10 }); // the first run alone reaches the limit
      await sleep(60);
      return okRow(run, { costUsd: 1 });
    },
  });
  const summary = await b.run({ concurrency: 2 });
  assert.equal(b.calls.length, 2, 'the second run was already in flight when the limit was reached; the third never starts');
  const lines = b.lines();
  assert.deepEqual(lines.map((l) => l.type ?? 'row'), ['row', 'row', 'stopped'], 'both rows are recorded, then the single stopped line');
  assert.deepEqual({ reason: lines[2].reason, costUsd: lines[2].costUsd, limit: lines[2].limit }, { reason: 'cost', costUsd: 11, limit: 10 });
  assert.deepEqual(summary.stopped, { reason: 'cost', costUsd: 11, limit: 10 });
  assert.deepEqual({ ran: summary.ran, attempts: summary.attempts, planned: summary.planned }, { ran: 2, attempts: 2, planned: 5 });
});

await ta('the stop rule also blocks a retry: an infrastructure row that reaches the limit is not re-run (its cost counts), and the run stays non-final for the next resume', async () => {
  const b = bench({ runs: { A: 1, B: 1, C: 0 }, stopAtCostUsd: 5, script: ({ run }) => infraRow(run, 'api_error', { costUsd: 5 }) });
  const summary = await b.run({ concurrency: 1 });
  assert.equal(b.calls.length, 1, 'no retry and no second run');
  assert.deepEqual(b.rows().map((r) => [r.final, r.infra]), [[false, 'api_error']]);
  assert.deepEqual(summary.stopped, { reason: 'cost', costUsd: 5, limit: 5 });
  assert.deepEqual({ ran: summary.ran, exhausted: summary.exhausted, infraAttempts: summary.infraAttempts }, { ran: 0, exhausted: 0, infraAttempts: 1 });
});

await ta('the stop rule survives a resume: the sum is read from the file; a batch with the limit already reached starts nothing and appends a stopped line; the stopped lines\' costUsd is never summed', async () => {
  const b = bench({ runs: { A: 2, B: 0, C: 0 }, script: ({ run }) => okRow(run, { costUsd: 5 }) });
  const first = await b.run({ stopAtCostUsd: 5, concurrency: 1 });
  assert.equal(b.calls.length, 1);
  assert.equal(first.stopped.reason, 'cost');
  const second = await b.run({ stopAtCostUsd: 5, concurrency: 1 });
  assert.equal(b.calls.length, 1, 'a resumed batch with the limit reached starts nothing');
  assert.deepEqual(second.stopped, { reason: 'cost', costUsd: 5, limit: 5 });
  assert.equal(stoppedIn(b.rowsFile).length, 2, 'and appends its own stopped line');
  const third = await b.run({ stopAtCostUsd: 12, concurrency: 1 });
  assert.equal(b.calls.length, 2, 'the sum is 5 (two stopped lines of costUsd 5 must not make it 15), so the second run starts');
  assert.equal(third.stopped, null);
  assert.equal(third.costUsd, 10);
});

await ta('a complete study over the limit is not "stopped": with nothing left to start there is no stopped line', async () => {
  const b = bench({ runs: { A: 1, B: 0, C: 0 }, script: ({ run }) => okRow(run, { costUsd: 50 }) });
  await b.run({ stopAtCostUsd: 100 });
  const linesBefore = b.lines().length;
  const summary = await b.run({ stopAtCostUsd: 10 });
  assert.equal(summary.stopped, null);
  assert.equal(summary.skippedFinal, 1);
  assert.equal(b.lines().length, linesBefore, 'nothing appended');
});

await ta('hidden_changed (R101) is not retried and stops the batch: the row is appended final false, in-flight runs finish, nothing new starts, one stopped line with reason hidden_changed', async () => {
  for (const retries of [2, 0]) {
    const b = bench({
      runs: { A: 2, B: 2, C: 1 },
      limits: { infraRetries: retries },
      script: async ({ run, n }) => {
        if (n === 0) return infraRow(run, 'hidden_changed', { costUsd: 0.25 });
        await sleep(60);
        return okRow(run);
      },
    });
    const summary = await b.run({ concurrency: 2 });
    assert.equal(b.calls.length, 2, `infraRetries ${retries}: the changed run is not retried and no third run starts`);
    const lines = b.lines();
    assert.deepEqual(lines.map((l) => l.type ?? `${l.infra}/${l.final}`), ['hidden_changed/false', 'null/true', 'stopped'], 'the row final false (never exhausted), the in-flight run\'s row, the stopped line');
    assert.deepEqual({ reason: lines[2].reason, costUsd: lines[2].costUsd, limit: lines[2].limit }, { reason: 'hidden_changed', costUsd: 1.25, limit: 100 });
    assert.deepEqual(summary.stopped, { reason: 'hidden_changed', costUsd: 1.25, limit: 100 });
    assert.equal(summary.exhausted, 0);
    assert.equal(summary.infraAttempts, 1);
  }
});

// =====================================================================================================================
// the preflight (R2, R59, R91, R101, R106b, Task 8 carry, R49, R75): every failure throws, names the item or the task, writes NOTHING
// =====================================================================================================================

const editJson = (file, edit) => writeFileSync(file, `${JSON.stringify(edit(JSON.parse(readFileSync(file, 'utf8'))), null, 2)}\n`);

await ta('preflight 1 (R2, R59): measure needs a registration and refuses taskIds; a mode the planner does not know, and a task it does not list, are refused; nothing is written', async () => {
  await refuses(bench({ mode: 'measure', registered: false }), /mode measure needs a registration/, 'measure on an unregistered object');
  await refuses(bench({ mode: 'measure', registered: NO_MARKER }), /mode measure needs a registration/, 'measure on an object with no marker');
  await refuses(bench({ mode: 'measure' }), /taskIds is refused/, 'measure with taskIds', { taskIds: ['ta'] });
  await refuses(bench(), /mode must be one of/, 'an unknown mode', { mode: 'nonsense' });
  await refuses(bench(), /does not list/, 'a task id the prereg does not list', { taskIds: ['nope'] });
  // The control: a registered measure over a good world runs the whole registration.
  const ok = bench({ mode: 'measure', specs: [{ id: 'ta' }, { id: 'tb' }], runs: { A: 1, B: 1, C: 1 } });
  const summary = await ok.run();
  assert.equal(summary.planned, 6);
  assert.equal(ok.calls.length, 6);
});

await ta('preflight 2 (R91, R35): a planned task needs a gate.json that is ok and carries the manifest\'s tree and hidden hashes; each failure alone refuses and names the task; an unplanned task is not looked at', async () => {
  const two = (spec) => bench({ specs: [{ id: 'ta' }, { id: 'tb', ...spec }] });
  await refuses(two({ gate: 'missing' }), /preflight item 2: task tb: gate\.json is missing/, 'no gate.json');
  await refuses(two({ gate: 'not-ok' }), /preflight item 2: task tb: gate\.json is not ok/, 'a gate.json with ok false');
  const edited = async (label, edit, pattern) => {
    const b = two({});
    editJson(path.join(b.world.tasks[1].dir, 'gate.json'), edit);
    const err = await refuses(b, pattern, label);
    assert.ok(!/task ta/.test(err.message), `${label}: only the failing task is named`);
  };
  await edited('ok is the string "true"', (g) => ({ ...g, ok: 'true' }), /task tb: gate\.json is not ok/);
  await edited('ok is missing', ({ ok, ...g }) => g, /task tb: gate\.json is not ok/);
  await edited('a gate.json for another tree', (g) => ({ ...g, treeHash: hex(0xbad) }), /task tb: gate\.json .*treeHash/);
  await edited('a gate.json for another hidden dir', (g) => ({ ...g, hiddenHash: hex(0xbad) }), /task tb: gate\.json .*hiddenHash/);
  const unreadable = two({});
  writeFileSync(path.join(unreadable.world.tasks[1].dir, 'gate.json'), '{ not json');
  await refuses(unreadable, /task tb: gate\.json .*(unreadable|cannot be read)/, 'a gate.json that is not JSON');
  const noManifest = two({});
  rmSync(path.join(noManifest.world.tasks[1].dir, 'manifest.json'));
  await refuses(noManifest, /preflight item 2: task tb: .*manifest\.json/, 'no manifest.json');

  // R101: a tampered tree/, hidden/ or prompt.txt, each alone (the manifest and gate.json still carry the built hashes).
  for (const [part, pattern] of [['tree', /task tb: tree\/ .*treeHash/], ['hidden', /task tb: hidden\/ .*hiddenHash/], ['prompt', /task tb: prompt\.txt .*promptHash/]]) {
    const b = two({});
    b.world.tamper('tb', part);
    const err = await refuses(b, pattern, `a tampered ${part}`);
    assert.match(err.message, /preflight item 2/);
    const label = { tree: 'tree/', hidden: 'hidden/', prompt: 'prompt.txt' };
    for (const [other, name] of Object.entries(label)) {
      assert.equal(err.message.includes(`task tb: ${name} `), other === part, `a tampered ${part}: ${other === part ? 'it is named' : `${name} is not named`}`);
    }
  }

  // An unplanned task is not looked at (a pilot on ta alone), a planned one always is.
  const pilot = two({ gate: 'missing' });
  pilot.world.tamper('tb', 'tree');
  const summary = await pilot.run({ taskIds: ['ta'] });
  assert.equal(summary.planned, 3);
  assert.equal(pilot.calls.length, 3);
});

await ta('preflight 3a: checkTasksMatch is empty for the planned tasks (measure and pilot alike); a mismatch of an unplanned task does not matter', async () => {
  const mismatched = (b, id, key) => deepFreeze({ ...b.prereg, tasks: b.prereg.tasks.map((t) => (t.id === id ? { ...t, [key]: hex(0xdead) } : t)) });
  for (const mode of ['measure', 'pilot']) {
    for (const key of ['treeHash', 'hiddenHash', 'promptHash']) {
      const b = bench({ mode, specs: [{ id: 'ta' }, { id: 'tb' }] });
      const err = await refuses(b, /preflight item 3: .*\btb\b/, `${mode}: ${key} of tb differs from the registration`, undefined, mismatched(b, 'tb', key));
      assert.ok(!/\bta\b/.test(err.message), 'only the mismatching task is named');
    }
  }
  const b = bench({ specs: [{ id: 'ta' }, { id: 'tb' }] });
  const summary = await b.runWith(mismatched(b, 'tb', 'treeHash'), { taskIds: ['ta'] });
  assert.equal(summary.ran, 3, 'tb is not planned, so its mismatch is not this batch\'s business');
});

await ta('preflight 3b: the image ids of the planned tasks\' repos (and of the proxy on the default network) equal the registration\'s; the CLI\'s sha256 too, hashed once per batch (R49, R75)', async () => {
  // A planned repo whose id differs, named.
  await refuses(bench({ images: { ...IMAGES, 'claude-plugins': digest(0x99) } }), /preflight item 3: .*claude-plugins/, 'the plugins image differs');
  await refuses(bench({ specs: [{ id: 'ta', repo: 'codescout' }], images: { ...IMAGES, codescout: digest(0x99) } }), /preflight item 3: .*codescout/, 'the codescout image differs');
  // A repo no planned task uses is not looked at.
  const unused = bench({ specs: [{ id: 'ta', repo: 'claude-plugins' }], images: { ...IMAGES, codescout: digest(0x99) } });
  await unused.run();
  assert.deepEqual(unused.imageAsked.sort(), [PROXY_IMAGE, IMAGE_FOR_REPO['claude-plugins']].sort(), 'the codescout image was never asked for');
  // docker cannot tell: the failure is the preflight\'s and names the image.
  await refuses(bench({ ctx: { imageIdOf: async () => { throw new Error('No such image: s5/plugins'); } } }), /preflight item 3: .*s5\/plugins.*No such image/, 'an image docker does not know');
  // The proxy image: compared on the default proxy network only.
  await refuses(bench({ images: { ...IMAGES, proxy: digest(0x99) } }), /preflight item 3: .*proxy/, 'the proxy image differs');
  for (const ctx of [{ network: 'bridge' }, { proxyUrl: null }]) {
    const b = bench({ images: { ...IMAGES, proxy: digest(0x99) }, ctx });
    await b.run();
    assert.ok(!b.imageAsked.includes(PROXY_IMAGE), `${JSON.stringify(ctx)}: the proxy image is not asked for`);
  }

  // The CLI: an exact string comparison of 'sha256:' + hex with the registration, once per batch, of the file runOne mounts.
  await refuses(bench({ cli: `sha256:${'d2'.repeat(32)}` }), /preflight item 3: .*cli.*sha256/i, 'the CLI hash differs');
  await refuses(bench({ ctx: { sha256File: async () => CLI_HEX.toUpperCase() } }), /preflight item 3: .*cli/i, 'upper-case hex is a different string');
  await refuses(bench({ ctx: { sha256File: async () => { throw new Error('ENOENT: no such file'); } } }), /preflight item 3: .*ENOENT/, 'a Claude binary that cannot be read');
  const once = bench({ runs: { A: 2, B: 2, C: 2 } });
  await once.run();
  assert.deepEqual(once.shaAsked, [once.claudeBin], 'hashed once for the whole batch, and it is the file runOne gets');
  const dflt = bench({ ctx: { claudeBin: undefined } });
  await dflt.run();
  const expected = path.join(os.homedir(), '.local', 'share', 'claude', 'versions', '2.1.292');
  assert.deepEqual(dflt.shaAsked, [expected], 'R75: <HOME>/.local/share/claude/versions/<prereg.cli.version>');
  assert.equal(dflt.calls[0].ctx.claudeBin, expected, 'and that is what runOne mounts');
});

await ta('preflight 4 (R106b): <workRoot>/cargo-home exists when any planned task is a cargo task, and is not needed for a node task', async () => {
  await refuses(bench({ specs: [{ id: 'ta' }, { id: 'tc', testRunner: 'cargo' }] }), /preflight item 4: .*cargo-home/, 'a cargo task and no cargo-home');
  const asFile = bench({ specs: [{ id: 'tc', testRunner: 'cargo' }] });
  writeFileSync(path.join(asFile.world.workRoot, 'cargo-home'), 'not a directory');
  await refuses(asFile, /preflight item 4: .*cargo-home/, 'a cargo-home that is a file');
  const node = bench({ specs: [{ id: 'ta' }, { id: 'tb' }] });
  assert.ok(!existsSync(path.join(node.world.workRoot, 'cargo-home')));
  await node.run();
  assert.equal(node.calls.length, 6, 'node tasks run without a cargo-home');
  const cargo = bench({ specs: [{ id: 'tc', testRunner: 'cargo', cargoHome: true }] });
  await cargo.run();
  assert.equal(cargo.calls.length, 3);
  // A cargo task that is not planned does not need it.
  const unplanned = bench({ specs: [{ id: 'ta' }, { id: 'tc', testRunner: 'cargo' }] });
  await unplanned.run({ taskIds: ['ta'] });
  assert.equal(unplanned.calls.length, 3);
});

await ta('preflight 5: the proxy container must be running, but only when the default proxy network (and a proxy URL) is used', async () => {
  const down = bench();
  down.proxyUp = false;
  await refuses(down, /preflight item 5: .*proxy/, 'the proxy is not running');
  assert.equal(down.proxyAsked, 1);
  for (const ctx of [{ network: 'bridge' }, { proxyUrl: null }, { network: 'none', proxyUrl: null }]) {
    const b = bench({ ctx });
    b.proxyUp = false;
    await b.run();
    assert.equal(b.proxyAsked, 0, `${JSON.stringify(ctx)}: no proxy is needed, so none is asked for`);
    assert.equal(b.calls.length, 3);
  }
  const up = bench();
  await up.run();
  assert.equal(up.proxyAsked, 1, 'asked once per batch');
});

await ta('preflight 6: the token variable is set and non-empty; the message names the variable and never a value; a variable runOne sets itself is refused', async () => {
  for (const value of [undefined, '']) {
    const err = await withEnv({ CLAUDE_CODE_OAUTH_TOKEN: value }, () => refuses(bench(), /preflight item 6: .*CLAUDE_CODE_OAUTH_TOKEN/, `token ${value === undefined ? 'unset' : 'empty'}`));
    assert.ok(!err.message.includes(SENTINEL));
  }
  const other = bench({ ctx: { tokenEnv: 'S5_BATCH_OTHER_TOKEN' } });
  await refuses(other, /preflight item 6: .*S5_BATCH_OTHER_TOKEN/, 'the variable ctx.tokenEnv names is the one read (the default one is set and does not stand in)');
  await withEnv({ S5_BATCH_OTHER_TOKEN: 'sk-other-sentinel-value' }, async () => {
    const ok = bench({ ctx: { tokenEnv: 'S5_BATCH_OTHER_TOKEN' } });
    await ok.run();
    assert.equal(ok.calls[0].ctx.tokenEnv, 'S5_BATCH_OTHER_TOKEN');
  });
  const own = bench({ ctx: { tokenEnv: 'XDG_STATE_HOME' } });
  await assert.rejects(own.run(), (e) => e instanceof TypeError && /tokenEnv/.test(e.message));
  await assert.rejects(bench({ ctx: { tokenEnv: 'not a name' } }).run(), (e) => e instanceof TypeError && /tokenEnv/.test(e.message));
});

await ta('the arguments: a TypeError, before anything is read or written, for an option that cannot be used', async () => {
  const b = bench();
  const bad = [
    [{ concurrency: 0 }, /concurrency/], [{ concurrency: 1.5 }, /concurrency/], [{ concurrency: '2' }, /concurrency/],
    [{ stopAtCostUsd: 0 }, /stopAtCostUsd/], [{ stopAtCostUsd: -1 }, /stopAtCostUsd/], [{ stopAtCostUsd: NaN }, /stopAtCostUsd/], [{ stopAtCostUsd: '5' }, /stopAtCostUsd/],
    [{ rowsFile: '' }, /rowsFile/], [{ rowsFile: undefined }, /rowsFile/], [{ workRoot: '' }, /workRoot/], [{ workRoot: undefined }, /workRoot/],
    [{ ctx: { runOne: 'x' } }, /runOne/], [{ ctx: { imageIdOf: 5 } }, /imageIdOf/], [{ ctx: { sha256File: 5 } }, /sha256File/], [{ ctx: { proxyRunning: 5 } }, /proxyRunning/], [{ ctx: { esRoot: 5 } }, /esRoot/], [{ ctx: { kill: 5 } }, /kill/],
  ];
  for (const [over, pattern] of bad) {
    await assert.rejects(b.run(over), (e) => e instanceof TypeError && pattern.test(e.message), JSON.stringify(over));
  }
  await assert.rejects(runBatch(b.prereg, { ...b.options(), ctx: 'x' }), (e) => e instanceof TypeError && /ctx/.test(e.message));
  await assert.rejects(runBatch(null, b.options()), TypeError);
  await assert.rejects(runBatch(b.prereg, null), TypeError);
  assert.equal(b.calls.length, 0);
  assert.ok(!existsSync(b.rowsFile) && !existsSync(path.join(b.world.workRoot, 'hook')) && b.docker.calls().length === 0);
});

await ta('a ctx the real runOne cannot use is refused once, before the first start, instead of turning every run into an infra_exhausted line (R114); an injected runOne is the caller\'s own business', async () => {
  const before = listeners();
  for (const [label, ctx, pattern] of [
    ['an empty network name', { network: '' }, /ctx\.network/],
    ['a grade that is not a function', { grade: 'x' }, /ctx\.grade/],
    ['a Claude binary that is not a file', {}, /Claude binary/],
  ]) {
    const b = bench({ ctx: { runOne: undefined, ...ctx } });
    const err = await b.run().then(() => null, (e) => e);
    assert.ok(err instanceof TypeError && pattern.test(err.message), `${label}: ${err?.message}`);
    assert.equal(b.lines().length, 0, `${label}: no row at all, not even a run_failed`);
    assert.ok(!existsSync(b.lockFile), `${label}: the lock is released`);
    assert.deepEqual(listeners(), before);
  }
  const injected = bench({ ctx: { network: '' } });
  await injected.run();
  assert.equal(injected.calls.length, 3, 'the injected runOne is not asked to validate anything');
});

// ---- the default seams: imageIdOf, proxyRunning, sha256File, through a docker stub that only answers `image inspect` and `ps` ----

const stubDocker = (opts) => {
  const dir = mkdtempSync(path.join(ROOT, 'stub-docker-'));
  const log = path.join(dir, 'argv.log');
  const bin = path.join(dir, 'docker');
  const imageCases = Object.entries(opts.images ?? {}).map(([ref, id]) => `      ${shq(ref)}) echo ${shq(id)} ;;`).join('\n');
  writeFileSync(bin, `#!/bin/sh
printf '%s\\n' "$*" >> ${shq(log)}
case "$1" in
  image)
    case "$5" in
${imageCases}
      *) echo "Error: No such image: $5" >&2; exit 1 ;;
    esac ;;
  ps)
    case "$*" in
      *label=s5.run=s5-proxy*) ${opts.proxy ? 'echo 0123456789ab' : ':'} ;;
      *) : ;;
    esac ;;
  *) echo "stub docker: unexpected $*" >&2; exit 9 ;;
esac
`);
  chmodSync(bin, 0o755);
  return { bin, argvs: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
};

await ta('the default seams: imageIdOf is `docker image inspect --format {{.Id}} <ref>`, proxyRunning is a running container labelled s5=1 and s5.run=s5-proxy, sha256File hashes the file; all through ctx.dockerBin', async () => {
  const dir = fresh('seams');
  const claudeBin = path.join(dir, 'claude-bin');
  const bytes = Buffer.from('not a real claude binary, only bytes to hash\n');
  writeFileSync(claudeBin, bytes);
  const sha = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const images = IMAGE_ID_OF_REF;
  // runOne stays the bench's; the three default seams are the ones under test (a key set to undefined removes the bench's stand-in).
  const real = (stub, over = {}) => bench({ cli: sha, ctx: { dockerBin: stub.bin, claudeBin, imageIdOf: undefined, sha256File: undefined, proxyRunning: undefined }, ...over });
  const ok = stubDocker({ images, proxy: true });
  const b = real(ok);
  const summary = await b.run();
  assert.equal(summary.ran, 3);
  const argvs = ok.argvs();
  assert.ok(argvs.includes(`image inspect --format {{.Id}} ${IMAGE_FOR_REPO['claude-plugins']}`), argvs.join(' | '));
  assert.ok(argvs.includes(`image inspect --format {{.Id}} ${PROXY_IMAGE}`));
  const psProxy = argvs.filter((a) => a.startsWith('ps') && a.includes('s5.run=s5-proxy'));
  assert.equal(psProxy.length, 1);
  assert.ok(psProxy[0].includes('label=s5=1') && psProxy[0].includes('label=s5.run=s5-proxy'), psProxy[0]);
  assert.ok(!psProxy[0].split(' ').some((word) => /^-[A-Za-z]*a[A-Za-z]*$/.test(word)), `running containers only (no -a): ${psProxy[0]}`);
  // The sweep went through the same dockerBin: a `ps` for label s5.task.
  assert.ok(argvs.some((a) => a.startsWith('ps') && a.includes('label=s5.task')));

  // Not running, an unknown image, a different file: each refuses.
  await refuses(real(stubDocker({ images, proxy: false })), /preflight item 5/, 'the stub proxy is not running');
  await refuses(real(stubDocker({ images: {}, proxy: true })), /preflight item 3: .*s5\/plugins/, 'the stub knows no image');
  await refuses(real(ok, { cli: `sha256:${'ab'.repeat(32)}` }), /preflight item 3: .*cli/i, 'the file hashes to something else');
});

// =====================================================================================================================
// the rows file at start: a torn last line, a bad line anywhere else, lines that are not Rows
// =====================================================================================================================

await ta('a bad line that is not the last refuses the batch, naming the line number, and writes nothing', async () => {
  const b = bench();
  const [r0] = b.plan();
  const text = `${JSON.stringify(oldRow('a', 1))}\n{ this is not json\n${JSON.stringify(okRow(r0))}\n`;
  writeFileSync(b.rowsFile, text);
  await refuses(b, /rows file .* line 2\b/, 'an unparsable middle line');
  assert.equal(readFileSync(b.rowsFile, 'utf8'), text);
  // A line that is JSON but not an object is the same.
  writeFileSync(b.rowsFile, `${JSON.stringify(oldRow('a', 1))}\n[1,2]\n${JSON.stringify(okRow(r0))}\n`);
  await refuses(b, /rows file .* line 2\b/, 'a JSON line that is not an object');
});

await ta('a damaged rows file refuses before the lock is touched: the stale lock of a dead holder is neither replaced nor removed', async () => {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const b = bench();
  const stale = `${JSON.stringify({ pid: Number(child.stdout), startedAt: '2026-10-09T00:00:00.000Z', mode: 'measure', rowsFile: '/gone/rows.jsonl' })}\n`;
  writeFileSync(b.lockFile, stale);
  writeFileSync(b.rowsFile, '{ garbage\n{"runId":"x"}\n');
  await assert.rejects(b.run(), /rows file .* line 1\b/);
  assert.equal(readFileSync(b.lockFile, 'utf8'), stale, 'the refusal came before the lock, so the stale lock is as it was');
  assert.equal(b.docker.calls().length, 0, 'and before the sweep');
});

await ta('an unparsable LAST line is a torn write: it is ignored (tornLine true), cut off before the first append, and the file parses completely afterwards; a second batch accepts it', async () => {
  for (const terminated of [false, true]) {
    const b = bench({ runs: { A: 1, B: 1, C: 0 } });
    const [r0, r1] = b.plan();
    const good = `${JSON.stringify(okRow(r0))}\n`;
    writeFileSync(b.rowsFile, `${good}{"runId":"${r1.runId}","torn-marker":tr${terminated ? '\n' : ''}`);
    const summary = await b.run();
    assert.equal(summary.tornLine, true, `terminated ${terminated}`);
    assert.deepEqual(b.calls.map((c) => c.run.runId), [r1.runId], 'the run of the torn line starts again; the good line before it is a final row');
    const text = readFileSync(b.rowsFile, 'utf8');
    assert.ok(text.startsWith(good) && !text.includes('torn-marker'), 'the torn fragment is gone and the good line is untouched');
    assert.equal(b.lines().length, 2, 'every line parses');
    const second = await b.run();
    assert.equal(second.tornLine, false, 'the next resume has nothing torn to ignore');
    assert.equal(second.skippedFinal, 2);
  }
  // A torn line and nothing appended (nothing to run): the file is left as it was.
  const idle = bench({ runs: { A: 1, B: 0, C: 0 } });
  const [only] = idle.plan();
  const before = `${JSON.stringify(okRow(only))}\n{"runId":"x`;
  writeFileSync(idle.rowsFile, before);
  const s = await idle.run();
  assert.equal(s.tornLine, true);
  assert.equal(readFileSync(idle.rowsFile, 'utf8'), before, 'no append, no cut');
});

await ta('a last line that parses but has no final newline gets one before the next line, so two lines never run together', async () => {
  const b = bench({ runs: { A: 1, B: 1, C: 0 } });
  const [r0] = b.plan();
  writeFileSync(b.rowsFile, JSON.stringify(okRow(r0)));
  await b.run();
  assert.equal(b.lines().length, 2);
  assert.equal(b.calls.length, 1);
});

await ta('a line with a `type` key is not a Row: it counts for nothing, not as a final row and not in the cost; a line with no runId is no Row either', async () => {
  const b = bench({ runs: { A: 1, B: 0, C: 0 } });
  const [r0] = b.plan();
  writeFileSync(b.rowsFile, `${JSON.stringify({ type: 'stopped', runId: r0.runId, final: true, costUsd: 999, at: 'x', reason: 'cost', limit: 1 })}\n${JSON.stringify({ final: true, costUsd: 999 })}\n`);
  const summary = await b.run();
  assert.equal(b.calls.length, 1, 'neither line makes the run final or stops the batch');
  assert.deepEqual({ skippedFinal: summary.skippedFinal, stopped: summary.stopped, costUsd: summary.costUsd }, { skippedFinal: 0, stopped: null, costUsd: 1 });
});

// =====================================================================================================================
// R123: one batch at a time per work root (batch.lock), taken after the read-only preflight and before the sweep and the scrub
// =====================================================================================================================

const lockOf = (b) => JSON.parse(readFileSync(b.lockFile, 'utf8'));

await ta('R123: the lock is taken before the sweep and held while runs go; it holds { pid, startedAt, mode, rowsFile } and no token; it is gone after the batch', async () => {
  const b = bench();
  let during = null;
  b.script = ({ run }) => {
    during ??= { text: readFileSync(b.lockFile, 'utf8'), lock: lockOf(b) };
    return okRow(run);
  };
  await b.run();
  assert.deepEqual(Object.keys(during.lock).sort(), ['mode', 'pid', 'rowsFile', 'startedAt']);
  assert.deepEqual({ pid: during.lock.pid, mode: during.lock.mode, rowsFile: during.lock.rowsFile }, { pid: process.pid, mode: 'pilot', rowsFile: b.rowsFile });
  assert.match(during.lock.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!during.text.includes(SENTINEL));
  assert.ok(b.calls.every((c) => c.lockHeld), 'every run started under the lock');
  const probes = b.docker.probes();
  assert.ok(probes.length >= 1 && probes.every((p) => p === 'locked'), `the sweep (a docker call) ran with the lock held: ${probes.join(',')}`);
  assert.ok(!existsSync(b.lockFile), 'released');
  // And every refusal of the preflight leaves none (refuses() asserts it for each of them above).
});

await ta('R123: a second batch on the same work root is refused while the first runs, naming the pid, the mode and the rows file; the refused batch touches nothing and does not release the first\'s lock', async () => {
  const gate = deferred();
  const b = bench({ script: async ({ run }) => { await gate.promise; return okRow(run); } });
  const first = b.run();
  await until(() => b.calls.length >= 1, 'the first batch to start a run');
  const dockerCalls = b.docker.calls().length;
  const other = path.join(b.dir, 'other-rows.jsonl');
  const err = await b.run({ rowsFile: other, mode: 'smoke' }).then(() => null, (e) => e);
  assert.ok(err instanceof Error, 'refused');
  assert.match(err.message, /batch\.lock/);
  assert.ok(err.message.includes(String(process.pid)) && err.message.includes('pilot') && err.message.includes(b.rowsFile), `names the pid, the mode and the rows file of the holder: ${err.message}`);
  assert.ok(!err.message.includes(SENTINEL));
  assert.ok(!existsSync(other), 'the refused batch wrote no rows file');
  assert.equal(b.docker.calls().length, dockerCalls, 'and did not sweep');
  assert.ok(existsSync(b.lockFile) && lockOf(b).rowsFile === b.rowsFile, 'the first batch\'s lock is still there, unchanged');
  gate.resolve();
  await first;
  assert.ok(!existsSync(b.lockFile));
});

await ta('R123: a lock whose pid is dead is stale and replaced by ours', async () => {
  // A real process that has already exited: its pid is dead.
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const deadPid = Number(child.stdout);
  assert.ok(Number.isSafeInteger(deadPid) && deadPid > 1);
  assert.throws(() => process.kill(deadPid, 0), (e) => e.code === 'ESRCH', 'the pid is really gone');
  const stale = bench();
  writeFileSync(stale.lockFile, `${JSON.stringify({ pid: deadPid, startedAt: '2026-10-09T00:00:00.000Z', mode: 'measure', rowsFile: '/gone/rows.jsonl' })}\n`);
  let seen = null;
  stale.script = ({ run }) => { seen ??= lockOf(stale); return okRow(run); };
  await stale.run();
  assert.equal(seen.pid, process.pid, 'replaced by ours');
  assert.equal(seen.rowsFile, stale.rowsFile);
  assert.ok(!existsSync(stale.lockFile));
});

await ta('R123: a lock whose pid is alive refuses (pid 1 exists and a user may not signal it: EPERM is alive), naming the holder, and is left alone; an unreadable lock refuses, naming the file', async () => {
  const alive = bench();
  const text = `${JSON.stringify({ pid: 1, startedAt: '2026-10-09T00:00:00.000Z', mode: 'measure', rowsFile: '/other/rows.jsonl' })}\n`;
  writeFileSync(alive.lockFile, text);
  const err = await alive.run().then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.ok(err.message.includes('1') && err.message.includes('measure') && err.message.includes('/other/rows.jsonl'), err.message);
  assert.equal(readFileSync(alive.lockFile, 'utf8'), text, 'a live holder\'s lock is left alone');
  assert.equal(alive.calls.length, 0);
  assert.equal(alive.docker.calls().length, 0, 'no sweep');

  for (const garbage of ['', '{ torn', '[1]', JSON.stringify({ pid: 'x' }), JSON.stringify({ pid: 0 })]) {
    const b = bench();
    writeFileSync(b.lockFile, garbage);
    const e = await b.run().then(() => null, (x) => x);
    assert.ok(e instanceof Error, `lock ${JSON.stringify(garbage)}`);
    assert.ok(e.message.includes('batch.lock'), e.message);
    assert.equal(readFileSync(b.lockFile, 'utf8'), garbage, 'left for the operator');
    assert.equal(b.calls.length + b.docker.calls().length, 0);
  }
});

await ta('R123: the lock is released on every path: after a throw (the sweep fails), and only if it still holds our pid; the signal handlers are gone too', async () => {
  const before = listeners();
  const b = bench({ dockerConfig: { ps: { status: 1, stderr: 'Cannot connect to the Docker daemon' } } });
  const err = await b.run().then(() => null, (e) => e);
  assert.ok(err instanceof Error, 'the sweep failed, so the batch threw');
  assert.match(err.message, /Cannot connect|ps/);
  assert.ok(!existsSync(b.lockFile), 'the lock is released after the throw');
  assert.deepEqual(listeners(), before, 'the handlers are removed after the throw');
  assert.equal(b.calls.length, 0);
  assert.ok(!existsSync(path.join(b.world.workRoot, 'hook')), 'the sweep comes before the hook copy');

  // A lock that is no longer ours (another batch replaced it while we ran) is not deleted by us.
  const c = bench();
  const theirs = { pid: 1, startedAt: '2026-10-09T01:02:03.000Z', mode: 'smoke', rowsFile: '/x/rows.jsonl' };
  c.script = ({ run }) => { writeFileSync(c.lockFile, `${JSON.stringify(theirs)}\n`); return okRow(run); };
  await c.run();
  assert.deepEqual(lockOf(c), theirs, 'the lock of another holder stays');
});

// =====================================================================================================================
// after the lock: the container sweep (R122), the start-of-batch scrub (R117), the hook copy (R93), each done once and before the first run
// =====================================================================================================================

const STALE = 'a1'.repeat(32);
const WARM = 'd4'.repeat(32);
const PROXY_CONTAINER = 'b2'.repeat(32);
const FOREIGN = 'c3'.repeat(32);

await ta('R122: the sweep removes the containers that carry s5.task (stale runs, grades, warm builds) once before the first run, and leaves the s5-proxy container and foreign containers alone', async () => {
  const containers = [
    { id: STALE, name: 's5-old.A.0-a1', labels: { s5: '1', 's5.run': 's5-old.A.0-a1', 's5.task': 'old', 's5.arm': 'A' } },
    { id: WARM, name: 's5-warm-build-old', labels: { s5: '1', 's5.run': 's5-warm-build-old', 's5.task': 'old' } },
    { id: PROXY_CONTAINER, name: 's5-proxy', labels: { s5: '1', 's5.run': 's5-proxy' } },
    { id: FOREIGN, name: 'someone-elses', labels: {} },
  ];
  let seenAtFirst = null;
  const b = bench({ runs: { A: 2, B: 1, C: 0 }, dockerConfig: { containers }, script: ({ run, n }) => { if (n === 0) seenAtFirst = b.docker.calls().map((c) => c.argv[0]); return okRow(run); } });
  await b.run();
  const calls = b.docker.calls();
  const ps = calls.filter((c) => c.argv[0] === 'ps');
  const rm = calls.filter((c) => c.argv[0] === 'rm');
  assert.equal(ps.length, 1, 'one sweep for the whole batch, not one per run');
  assert.ok(ps[0].argv.includes('label=s5.task') && !ps[0].argv.includes('label=s5=1'), `the sweep label is s5.task: ${ps[0].argv.join(' ')}`);
  assert.equal(rm.length, 1);
  assert.deepEqual(rm[0].touched.sort(), [STALE, WARM].sort(), 'only the stale run and the warm container were removed');
  assert.ok(!calls.some((c) => (c.touched ?? []).some((id) => id === PROXY_CONTAINER || id === FOREIGN)), 'the proxy and the foreign container were never touched');
  assert.deepEqual(seenAtFirst, ['ps', 'rm'], 'the sweep was finished before the first run started');
  // Nothing stale: only the listing, no rm.
  const clean = bench({ dockerConfig: { containers: containers.filter((c) => !c.labels['s5.task']) } });
  await clean.run();
  assert.deepEqual(clean.docker.calls().map((c) => c.argv[0]), ['ps']);
});

await ta('R117: the start-of-batch scrub removes the token from every earlier run directory\'s config/ and state/ before the first run, leaves work/ and target/ alone, and reports { dirs, files }', async () => {
  const b = bench({ runs: { A: 1, B: 0, C: 0 } });
  const put = (rel, text) => {
    const f = path.join(b.world.workRoot, 'runs', rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
    return f;
  };
  put('old.A.0-a1/config/projects/-work/s.jsonl', `x ${SENTINEL} y ${SENTINEL}\n`);
  put('old.A.0-a1/state/dump.txt', SENTINEL);
  put('old.B.0-a2/state/dump.txt', `a${SENTINEL}b`);
  put('old.C.0-a1/config/clean.txt', 'nothing here\n');
  const work = put('old.A.0-a1/work/lib.mjs', `keep ${SENTINEL}\n`);
  const target = put('old.A.0-a1/target/debug/x.o', SENTINEL);
  let atFirst = null;
  b.script = ({ run, n }) => {
    if (n === 0) {
      atFirst = [readFileSync(path.join(b.world.workRoot, 'runs', 'old.A.0-a1/config/projects/-work/s.jsonl'), 'utf8'), readFileSync(path.join(b.world.workRoot, 'runs', 'old.B.0-a2/state/dump.txt'), 'utf8')];
    }
    return okRow(run);
  };
  const summary = await b.run();
  assert.deepEqual(atFirst, ['x [REDACTED] y [REDACTED]\n', 'a[REDACTED]b'], 'already scrubbed when the first run starts');
  assert.deepEqual(summary.scrubbed, { dirs: 2, files: 3 });
  assert.equal(readFileSync(work, 'utf8'), `keep ${SENTINEL}\n`, 'work/ is the operator\'s debugging copy: not touched');
  assert.equal(readFileSync(target, 'utf8'), SENTINEL, 'nor target/');
});

await taIf('R117: a file the scrub cannot rewrite refuses the batch, naming the count and the first path with the token redacted; no run starts; the lock is released; the hook copy is not written', IS_ROOT ? 'running as root: a mode does not stop root' : '', async () => {
  const b = bench();
  const config = path.join(b.world.workRoot, 'runs', 'old.A.0-a1', 'config');
  mkdirSync(config, { recursive: true });
  const locked = path.join(config, `locked-${SENTINEL}.txt`); // the NAME holds the token too
  const second = path.join(b.world.workRoot, 'runs', 'old.B.0-a1', 'state', 'also-locked.txt');
  mkdirSync(path.dirname(second), { recursive: true });
  for (const f of [locked, second]) {
    writeFileSync(f, SENTINEL);
    chmodSync(f, 0o400);
  }
  const err = await b.run().then(() => null, (e) => e);
  assert.ok(err instanceof Error, 'refused');
  assert.match(err.message, /scrub/);
  assert.match(err.message, /2 /, 'the count');
  assert.match(err.message, /locked-\[REDACTED\]\.txt|also-locked\.txt/, 'the first path');
  assert.ok(!err.message.includes(SENTINEL) && !String(err.stack).includes(SENTINEL), 'with the token redacted from the path');
  assert.equal(b.calls.length, 0, 'no run starts');
  assert.equal(b.lines().length, 0);
  assert.ok(!existsSync(b.lockFile), 'the lock is released');
  assert.ok(!existsSync(path.join(b.world.workRoot, 'hook')), 'the hook copy comes after the scrub');
  assert.equal(readFileSync(locked, 'utf8'), SENTINEL, 'what it could not rewrite is as it was');
  // An unreadable run directory is the same: its config/ and state/ cannot be listed, so the token may be there.
  chmodSync(locked, 0o600);
  chmodSync(second, 0o600);
  rmSync(path.join(b.world.workRoot, 'runs', 'old.A.0-a1'), { recursive: true });
  const closed = path.join(b.world.workRoot, 'runs', 'old.B.0-a1');
  try {
    chmodSync(closed, 0o000);
    const e2 = await b.run().then(() => null, (e) => e);
    assert.ok(e2 instanceof Error && /scrub/.test(e2.message), 'a run directory the scrub cannot enter refuses the batch');
    assert.equal(b.calls.length, 0);
  } finally {
    chmodSync(closed, 0o755);
  }
});

await ta('the hook copy is built once, from nothing, before the first run: a stale file in it is gone, and it is not rebuilt per run', async () => {
  const b = bench({ runs: { A: 2, B: 1, C: 0 } });
  const stale = path.join(b.world.workRoot, 'hook', 'es', 'stale.txt');
  mkdirSync(path.dirname(stale), { recursive: true });
  writeFileSync(stale, 'left by an earlier copy\n');
  await b.run();
  assert.equal(b.calls.length, 3);
  assert.deepEqual(b.calls.map((c) => c.hookMark), [false, true, true], 'the copy made before the first run is the one every run sees (a marker the first run left survives)');
  assert.ok(!existsSync(stale), 'rebuilt from nothing');
  const copy = b.calls[0].ctx.hookCopy;
  assert.ok(existsSync(path.join(copy.copyDir, 'core', 'rules.json')) && existsSync(copy.settingsFile));
});

// =====================================================================================================================
// R119: signals
// =====================================================================================================================

await ta('R119: the first SIGINT or SIGTERM is a stop: nothing new starts, in-flight runs finish, one stopped line with reason signal, Summary.stopped set; the handlers exist only while the batch runs', async () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const before = listeners();
    const gate = deferred();
    const b = bench({ runs: { A: 2, B: 2, C: 2 }, script: async ({ run }) => { await gate.promise; return okRow(run); } });
    const done = b.run({ concurrency: 2 });
    await until(() => b.calls.length >= 2, 'two runs in flight');
    assert.deepEqual(listeners().map((n, i) => n - before[i]), [1, 1], `${signal}: one handler per signal while the batch runs`);
    process.emit(signal);
    await sleep(30);
    assert.equal(b.kills.length, 0, 'the first signal does not kill');
    gate.resolve();
    const summary = await done;
    assert.equal(b.calls.length, 2, `${signal}: nothing new started after the signal, though 4 runs were left`);
    assert.deepEqual(b.lines().map((l) => l.type ?? 'row'), ['row', 'row', 'stopped'], 'the in-flight runs finished and were recorded; then exactly one stopped line');
    const line = stoppedIn(b.rowsFile)[0];
    assert.deepEqual({ ...line, at: null }, { type: 'stopped', at: null, reason: 'signal', costUsd: 2, limit: 100 });
    assert.deepEqual(summary.stopped, { reason: 'signal', costUsd: 2, limit: 100 });
    assert.deepEqual({ planned: summary.planned, ran: summary.ran }, { planned: 6, ran: 2 });
    assert.deepEqual(listeners(), before, `${signal}: the handlers are gone after the batch`);
    assert.ok(!existsSync(b.lockFile), 'and so is the lock');
  }
});

await ta('R119: the second signal removes the handlers and re-raises that signal on the process, so the default action ends it; before and after a batch a signal is nobody\'s business of ours', async () => {
  const before = listeners();
  process.emit('SIGINT'); // no batch is running: nothing happens (and nothing was installed)
  assert.deepEqual(listeners(), before);
  const gate = deferred();
  const b = bench({ runs: { A: 2, B: 2, C: 2 }, script: async ({ run }) => { await gate.promise; return okRow(run); } });
  const done = b.run({ concurrency: 2 });
  await until(() => b.calls.length >= 2, 'two runs in flight');
  process.emit('SIGTERM');
  assert.equal(b.kills.length, 0, 'the first signal only stops');
  process.emit('SIGINT');
  assert.equal(b.kills.length, 1, 'the second signal is re-raised');
  assert.deepEqual({ pid: b.kills[0].pid, signal: b.kills[0].signal }, { pid: process.pid, signal: 'SIGINT' }, 'that signal, on this process');
  assert.deepEqual([b.kills[0].sigintListeners, b.kills[0].sigtermListeners], before, 'the handlers were removed BEFORE it was raised, or the default action would not run');
  assert.deepEqual(listeners(), before);
  process.emit('SIGINT'); // a third: no handler, so nothing
  assert.equal(b.kills.length, 1);
  gate.resolve();
  const summary = await done; // the seam did not really kill: the in-flight runs finish
  assert.equal(summary.stopped.reason, 'signal');
  assert.equal(stoppedIn(b.rowsFile).length, 1);
  assert.deepEqual(listeners(), before);
  process.emit('SIGTERM'); // after the batch
  assert.equal(b.kills.length, 1);
});

await ta('R119, for real: a child process running a batch survives the first SIGINT (it stops starting runs), and the second SIGINT ends it at once with the signal, mid-run; the next batch replaces the dead holder\'s lock', async () => {
  const b = bench({ runs: { A: 2, B: 2, C: 2 } });
  const preregFile = path.join(b.dir, 'prereg.json');
  writeFileSync(preregFile, JSON.stringify(b.prereg));
  const cfg = { preregFile, workRoot: b.world.workRoot, rowsFile: b.rowsFile, dockerBin: b.docker.bin, esRoot: ES_ROOT, claudeBin: b.claudeBin, ids: IMAGE_ID_OF_REF, cliHex: CLI_HEX };
  const childFile = path.join(b.dir, 'child.mjs');
  writeFileSync(childFile, `import { readFileSync } from 'node:fs';
import { runBatch } from ${JSON.stringify(path.join(HERE, 'run.mjs'))};
const cfg = JSON.parse(process.argv[2]);
const prereg = JSON.parse(readFileSync(cfg.preregFile, 'utf8'));
const ctx = {
  runOne: async () => { process.stdout.write('STARTED\\n'); await new Promise((resolve) => setTimeout(resolve, 60000)); },
  imageIdOf: async (ref) => cfg.ids[ref], sha256File: async () => cfg.cliHex, proxyRunning: async () => true,
  dockerBin: cfg.dockerBin, esRoot: cfg.esRoot, claudeBin: cfg.claudeBin,
};
const summary = await runBatch(prereg, { mode: 'pilot', workRoot: cfg.workRoot, rowsFile: cfg.rowsFile, concurrency: 1, ctx });
process.stdout.write('DONE ' + JSON.stringify(summary.stopped) + '\\n');
`);
  const child = spawn(process.execPath, [childFile, JSON.stringify(cfg)], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  const closed = new Promise((resolve) => { child.once('close', (code, signal) => resolve({ code, signal })); });
  try {
    await until(() => out.includes('STARTED'), `the child to start its run (stderr: ${err})`);
    child.kill('SIGINT');
    await sleep(400);
    assert.equal(child.exitCode, null, `the first SIGINT does not end the child (${err})`);
    assert.equal(child.signalCode, null);
    assert.ok(!out.includes('DONE'), 'the in-flight run is still running');
    child.kill('SIGINT');
    const end = await Promise.race([closed, sleep(5000).then(() => 'timeout')]);
    assert.notEqual(end, 'timeout', 'the second SIGINT ends the child at once');
    assert.equal(end.signal, 'SIGINT', `it died of the signal it was sent (code ${end.code}, stderr ${err})`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  assert.deepEqual(b.lines(), [], 'a hard kill mid-run loses that run: no row, and no stopped line either');
  assert.ok(existsSync(b.lockFile) && lockOf(b).pid === child.pid, 'the dead process left its lock');
  const next = await b.run({ concurrency: 3 });
  assert.equal(next.ran, 6, 'the dead holder\'s lock is stale: the next batch takes over and runs everything');
  assert.ok(!existsSync(b.lockFile));
});

// =====================================================================================================================
// smoke mode (R94): one run per arm on one task, then { ok, checks, rows } from the FINAL rows
// =====================================================================================================================

const smokeBench = (over = {}) => bench({ mode: 'smoke', specs: [{ id: 'ta' }, { id: 'tb' }], runs: { A: 3, B: 3, C: 3 }, ...over });

await ta('smoke: one rep-0 run per arm on one task, the same retry and stop machinery, and Summary.smoke = { ok, checks: { firstUserText, decisionLogs, bSteered }, rows } from the final rows', async () => {
  const b = smokeBench();
  const summary = await b.run();
  assert.equal(summary.mode, 'smoke');
  assert.deepEqual([summary.planned, b.calls.length], [3, 3], 'three runs although the registration has nine per task and two tasks');
  assert.deepEqual(b.calls.map((c) => [c.run.taskId, c.run.rep]).sort(), [['ta', 0], ['ta', 0], ['ta', 0]]);
  assert.deepEqual(b.calls.map((c) => c.run.arm).sort(), ['A', 'B', 'C']);
  assert.deepEqual(summary.smoke, { ok: true, checks: { firstUserText: true, decisionLogs: true, bSteered: true }, rows: 3 });
  // The same retry machinery: an infrastructure row is re-run.
  let n = 0;
  const retry = smokeBench({ script: ({ run }) => (run.arm === 'B' && n++ === 0 ? infraRow(run, 'api_error') : okRow(run)) });
  const r = await retry.run();
  assert.deepEqual([r.attempts, r.infraAttempts, r.smoke.ok, r.smoke.rows], [4, 1, true, 3]);
  // A pilot or measure has no smoke summary.
  const pilot = bench();
  assert.equal((await pilot.run()).smoke, null);
});

await ta('smoke: each of the three checks fails alone, and a run that ended infra_exhausted makes ok false although the checks hold', async () => {
  const cases = [
    ['arm C: the first user text is not the prompt', (run) => (run.arm === 'C' ? { firstUserTextOk: false } : {}), { firstUserText: false, decisionLogs: true, bSteered: true }],
    ['arm A: no transcript, so firstUserTextOk is null', (run) => (run.arm === 'A' ? { firstUserTextOk: null } : {}), { firstUserText: false, decisionLogs: true, bSteered: true }],
    ['arm A: no decision-log line', (run) => (run.arm === 'A' ? { decision: null } : {}), { firstUserText: true, decisionLogs: false, bSteered: true }],
    ['arm B: no decision-log line', (run) => (run.arm === 'B' ? { decision: null } : {}), { firstUserText: true, decisionLogs: false, bSteered: true }],
    ['arm B is not steered', (run) => (run.arm === 'B' ? { decision: { arm: 'holdout', steered: false } } : {}), { firstUserText: true, decisionLogs: true, bSteered: false }],
    ['arm A is steered', (run) => (run.arm === 'A' ? { decision: { arm: 'treated', steered: true } } : {}), { firstUserText: true, decisionLogs: true, bSteered: false }],
    ['arm C is steered', (run) => (run.arm === 'C' ? { decision: { arm: 'treated', steered: true } } : {}), { firstUserText: true, decisionLogs: true, bSteered: false }],
  ];
  for (const [label, over, checks] of cases) {
    const b = smokeBench({ script: ({ run }) => okRow(run, over(run)) });
    const summary = await b.run();
    assert.deepEqual(summary.smoke, { ok: false, checks, rows: 3 }, label);
  }
  // Exhausted: arm C never gets a good attempt. Its last row still carries a decision and a good first user text, so only the clause "no run ended infra_exhausted" fails.
  const exhausted = smokeBench({ limits: { infraRetries: 1 }, script: ({ run }) => (run.arm === 'C' ? infraRow(run, 'api_error') : okRow(run)) });
  const summary = await exhausted.run();
  assert.deepEqual(summary.smoke, { ok: false, checks: { firstUserText: true, decisionLogs: true, bSteered: true }, rows: 3 });
  assert.equal(summary.exhausted, 1);
});

await ta('smoke: the checks come from the FINAL rows of the planned runs, across a resume; a stopped smoke batch is not ok (rows 0, every check false)', async () => {
  // First batch: the cost limit stops it after one run; second batch: finishes the other two, and the summary covers all three.
  const b = smokeBench({ script: ({ run }) => okRow(run, { costUsd: 5 }) });
  const first = await b.run({ stopAtCostUsd: 5, concurrency: 1 });
  assert.deepEqual(first.smoke, { ok: false, checks: { firstUserText: false, decisionLogs: false, bSteered: false }, rows: 1 }, 'a run is missing, so nothing is verified');
  const second = await b.run({ stopAtCostUsd: 100, concurrency: 1 });
  assert.deepEqual(second.smoke, { ok: true, checks: { firstUserText: true, decisionLogs: true, bSteered: true }, rows: 3 });
  assert.equal(second.skippedFinal, 1);
  const stopped = smokeBench();
  writeFileSync(stopped.rowsFile, `${JSON.stringify(oldRow('z', 9))}\n`);
  assert.deepEqual((await stopped.run({ stopAtCostUsd: 9 })).smoke, { ok: false, checks: { firstUserText: false, decisionLogs: false, bSteered: false }, rows: 0 });
});

// =====================================================================================================================
// integration, unit mode: a smoke batch over a task built by the REAL buildTask, with the REAL runOne, the fake docker and the fake claude
// =====================================================================================================================

const fsType = (p) => spawnSync('stat', ['-f', '-c', '%T', p], { encoding: 'utf8' }).stdout.trim();
const NO_REFLINK_HERE = !existsSync(WORK) ? `${WORK} does not exist` : !['btrfs', 'xfs'].includes(fsType(WORK)) ? `${WORK} is on ${fsType(WORK)}, which cannot reflink` : '';
const PROMPT = 'Fix `add` so that it adds.\r\nThe tests are in tests/ éè \u{1F600}\n';
const NODE_HEAD = "import assert from 'node:assert/strict';\nconst t = (name, fn) => {\n  try { fn(); console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); console.log(String(e.stack)); process.exitCode = 1; }\n};\n";
const NODE_SCENE = {
  parent: {
    'lib.mjs': 'export const add = (a, b) => a - b;\nexport const plus = add;\n',
    'tests/visible.test.mjs': `${NODE_HEAD}import { add } from '../lib.mjs';\nt('existing', () => assert.equal(add(0, 0), 0));\n`,
  },
  fix: {
    'lib.mjs': 'export const add = (a, b) => a + b;\nexport const plus = add;\n',
    'tests/hidden.test.mjs': `${NODE_HEAD}import { plus } from '../lib.mjs';\nt('plus', () => assert.equal(plus(2, 3), 5));\n`,
  },
  def: {
    id: 'fix-plus',
    repo: 'claude-plugins',
    subsystem: 'math',
    testRunner: 'node',
    hidden: { files: ['tests/hidden.test.mjs'] },
    buildCommand: ['node', '--check', 'lib.mjs'],
    f2p: { command: ['node', 'tests/hidden.test.mjs'], names: ['plus'] },
    p2p: { command: ['node', 'tests/visible.test.mjs'], names: ['existing'] },
    testPatterns: ['node tests/'],
    scrub: { removePaths: [], terms: [] },
    timeoutsSec: { build: 60, test: 60 },
  },
};

// A task built by the real buildTask under the reflink filesystem, and its gate.json written the way gateTask writes it (the gate itself
// needs the real grader, which these tests replace by a seam).
const buildNodeScene = (id) => {
  const { dir, shas } = makeRepo([
    { label: 'parent', subject: 'chore: parent', date: '2026-10-02T10:00:00+00:00', files: NODE_SCENE.parent },
    { label: 'fix', subject: 'fix: it', date: '2026-10-03T10:00:00+00:00', files: NODE_SCENE.fix },
  ]);
  sceneDirs.push(dir);
  const taskSrc = mkdtempSync(path.join(ROOT, 'taskdef-'));
  writeFileSync(path.join(taskSrc, 'task.json'), JSON.stringify({ ...NODE_SCENE.def, id, repoPath: dir, fix: shas.fix, parent: shas.parent }));
  writeFileSync(path.join(taskSrc, 'TASK.md'), '# Task\n\nadd must add.\n');
  writeFileSync(path.join(taskSrc, 'prompt.txt'), PROMPT);
  mkdirSync(TMP_BASE, { recursive: true });
  const workRoot = mkdtempSync(path.join(TMP_BASE, 'node-'));
  sceneDirs.push(workRoot);
  const manifest = buildTask(taskSrc, { workRoot });
  const taskDir = path.join(workRoot, 'tasks', manifest.id);
  writeFileSync(path.join(taskDir, 'gate.json'), `${JSON.stringify({ ok: true, reasons: [], atParent: null, atFix: [], treeHash: manifest.treeHash, hiddenHash: manifest.hiddenHash, gatedAt: '2026-10-09T00:00:00.000Z', leftover: null }, null, 2)}\n`);
  return { workRoot, manifest, taskDir };
};
const smokePrereg = (scene, over = {}) => deepFreeze({
  model: 'test-model-x1',
  cli: { version: '2.1.292', sha256: CLI_SHA },
  arms: { A: { effort: 'xhigh', steer: false, runs: 1 }, B: { effort: 'xhigh', steer: true, runs: 1 }, C: { effort: 'low', steer: false, runs: 1 } },
  tasks: [{ id: scene.manifest.id, treeHash: scene.manifest.treeHash, hiddenHash: scene.manifest.hiddenHash, promptHash: scene.manifest.promptHash }],
  margin: 0.15,
  alpha: 0.05,
  bound: { method: 'percentile', resamples: 10000, seed: 7 },
  orderSeed: 3,
  mechanism: { alpha: 0.05, permutations: 1000, seed: 13, effectSizeThinkingTokens: 500 },
  limits: { timeoutMinutes: 90, cpus: 4, memoryGb: 16, concurrency: 2, infraRetries: 2 },
  images: IMAGES,
  proxyAllowlist: ['api.anthropic.com'],
  stopAtCostUsd: 100,
  registered: false,
  ...over,
});
const OK_GRADE = Object.freeze({
  infra: null, graft: 'ok', build: 'ok', f2p: { passed: ['plus'], failed: [], notRun: [] }, p2p: { passed: ['existing'], failed: [], notRun: [] }, nonAssertion: [], pass: true, diff: { files: 1, insertions: 1, deletions: 1 }, wallMs: 5, detail: null, kept: null, leftover: null,
});

await (NO_REFLINK_HERE ? Promise.resolve(console.log(`ok - integration (unit mode): a smoke batch with the real runOne # SKIP ${NO_REFLINK_HERE}`)) : ta('integration (unit mode): a smoke batch over a built task with the REAL runOne, the fake docker and the fake claude: the ctx, the attempt directories, the rows file and its lines parse as Rows', async () => {
  const scene = buildNodeScene(`t10c-${process.pid}-plus`);
  const prereg = smokePrereg(scene);
  const plan = planRunsS5(prereg, { mode: 'smoke' });
  assert.equal(plan.length, 3);
  const names = plan.map((r) => `s5-${r.runId}-a1`);
  const docker = fakeDocker({
    containers: names.map((name) => ({ id: createHash('sha256').update(name).digest('hex'), name, labels: { s5: '1', 's5.run': name }, oomKilled: false })),
    run: { exec: { env: { FAKE_CLAUDE: '{}' } } },
  });
  const rowsFile = path.join(scene.workRoot, '..', `rows-${process.pid}.jsonl`);
  sceneDirs.push(rowsFile);
  const summary = await runBatch(prereg, {
    mode: 'smoke',
    workRoot: scene.workRoot,
    rowsFile,
    ctx: {
      dockerBin: docker.bin,
      claudeBin: FAKE_CLAUDE,
      esRoot: ES_ROOT,
      imageIdOf: async (ref) => IMAGE_ID_OF_REF[ref],
      sha256File: async () => CLI_HEX,
      proxyRunning: async () => true,
      grade: async () => OK_GRADE,
    },
  });
  assert.deepEqual(summary.smoke, { ok: true, checks: { firstUserText: true, decisionLogs: true, bSteered: true }, rows: 3 });
  assert.deepEqual({ planned: summary.planned, ran: summary.ran, attempts: summary.attempts, exhausted: summary.exhausted, stopped: summary.stopped }, { planned: 3, ran: 3, attempts: 3, exhausted: 0, stopped: null });
  const rows = rowsIn(rowsFile);
  assert.equal(readLines(rowsFile).length, 3);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).filter((k) => ROW_KEYS.includes(k)).sort(), [...ROW_KEYS].sort(), 'every key of a Row');
    assert.deepEqual([r.infra, r.final, r.grade.pass], [null, true, true]);
    assert.deepEqual([r.decision.steered, r.firstUserTextOk], [r.arm === 'B', true]);
    assert.ok(!JSON.stringify(r).includes(SENTINEL));
  }
  assert.deepEqual(rows.map((r) => r.runId).sort(), plan.map((r) => r.runId).sort());
  // The attempt directories: <runId>-a1 with config and state kept, work and target gone; the hook copy; no lock.
  for (const run of plan) assert.deepEqual(readdirSync(path.join(scene.workRoot, 'runs', `${run.runId}-a1`)).sort(), ['config', 'state']);
  assert.ok(existsSync(path.join(scene.workRoot, 'hook', 'es', 'settings.json')));
  assert.ok(!existsSync(path.join(scene.workRoot, 'batch.lock')));
  // Docker: the sweep first, then the three agent containers, each on the image id the preflight verified.
  const calls = docker.calls();
  assert.equal(calls[0].argv[0], 'ps');
  assert.ok(calls[0].argv.includes('label=s5.task'));
  const agentRuns = calls.filter((c) => c.argv[0] === 'run');
  assert.equal(agentRuns.length, 3);
  for (const call of agentRuns) assert.ok(call.argv.includes(IMAGES['claude-plugins']), 'the image id the registration pins, not the tag');
  assert.ok(!JSON.stringify(calls).includes(SENTINEL), 'the token is in no docker argv');
}));

// =====================================================================================================================
// real Docker (S5_DOCKER_TESTS=1): the same smoke batch against the real s5/plugins image with a shell script for the Claude binary
// =====================================================================================================================

// What the "claude binary" does, as the real `agent` user in the real container: it writes what claude writes (a transcript, the hook's
// decision log, a JSON result), edits a file in /work, and leaves the token in a file the host must find scrubbed. It starts no model.
const CLAUDE_SH = String.raw`#!/bin/bash
sid=''; effort=''; prompt=''
while [ $# -gt 0 ]; do
  case "$1" in
    --session-id) sid="$2"; shift 2 ;;
    --effort) effort="$2"; shift 2 ;;
    --) prompt="$2"; break ;;
    *) shift ;;
  esac
done
proj="$CLAUDE_CONFIG_DIR/projects/-work"
log="$XDG_STATE_HOME/effort-steering"
mkdir -p "$proj" "$log" || exit 70
jq -cn --arg p "$prompt" --arg s "$sid" '{type:"user",message:{role:"user",content:$p},sessionId:$s}' > "$proj/$sid.jsonl"
jq -cn --arg s "$sid" --arg e "$effort" '{type:"assistant",effort:$e,message:{id:"msg_1",role:"assistant",model:"fake",content:[{type:"text",text:"Fixed it."}],usage:{input_tokens:10,output_tokens:50,cache_creation_input_tokens:0,cache_read_input_tokens:100,output_tokens_details:{thinking_tokens:7}}},sessionId:$s}' >> "$proj/$sid.jsonl"
if [ "$EFFORT_STEERING_HOLDOUT_RATE" = "0" ]; then arm=treated; steered=true; else arm=holdout; steered=false; fi
printf '{"session_id":"%s","turn_id":"t1","arm":"%s","steered":%s}\n' "$sid" "$arm" "$steered" > "$log/$sid.jsonl"
printf 'export const add = (a, b) => a + b;\nexport const plus = add;\n' > /work/lib.mjs
printf '%s\n' "$CLAUDE_CODE_OAUTH_TOKEN" > "$XDG_STATE_HOME/leak.txt"
printf '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.25,"session_id":"%s","result":"Fixed it."}\n' "$sid"
`;

const dockerTest = async () => {
  const docker = (...args) => {
    const r = spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    assert.equal(r.status, 0, `docker ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const imageRef = IMAGE_FOR_REPO['claude-plugins'];
  const imageId = docker('image', 'inspect', '--format', '{{.Id}}', imageRef);
  const id = `t10c-${process.pid}-plus`;
  const scene = buildNodeScene(id);
  mkdirSync(path.join(scene.workRoot, 'cargo-home')); // mounted read-only at /cargo
  const script = path.join(scene.workRoot, 'claude.sh');
  writeFileSync(script, CLAUDE_SH);
  chmodSync(script, 0o755);
  const prereg = smokePrereg(scene, { cli: { version: '2.1.292', sha256: `sha256:${createHash('sha256').update(CLAUDE_SH).digest('hex')}` }, images: { ...IMAGES, 'claude-plugins': imageId } });
  const keep = `s5-ctl-keep-${process.pid}`;
  const sweep = `s5-ctl-sweep-${process.pid}`;
  const exists = (name) => docker('ps', '-aq', '--filter', `name=^/${name}$`) !== '';
  try {
    // R122's control: two stopped containers of ours, one with s5=1 only (the proxy looks like this), one that also carries s5.task.
    docker('create', '--name', keep, '--label', 's5=1', imageRef, 'true');
    docker('create', '--name', sweep, '--label', 's5=1', '--label', `s5.task=ctl-${process.pid}`, imageRef, 'true');
    assert.ok(exists(keep) && exists(sweep));

    await ta('docker: a smoke batch through the real agent and grade containers, on the pinned image id, with every default seam real; the sweep removes the s5.task container and keeps the s5=1-only one', async () => {
      const rowsFile = path.join(scene.workRoot, '..', `rows-docker-${process.pid}.jsonl`);
      sceneDirs.push(rowsFile);
      const summary = await runBatch(prereg, { mode: 'smoke', workRoot: scene.workRoot, rowsFile, ctx: { claudeBin: script, esRoot: ES_ROOT, network: 'none', proxyUrl: null } });
      assert.deepEqual(summary.smoke, { ok: true, checks: { firstUserText: true, decisionLogs: true, bSteered: true }, rows: 3 }, JSON.stringify(rowsIn(rowsFile).map((r) => [r.arm, r.infra, r.infraDetail])));
      assert.deepEqual({ ran: summary.ran, attempts: summary.attempts, exhausted: summary.exhausted, stopped: summary.stopped }, { ran: 3, attempts: 3, exhausted: 0, stopped: null });
      for (const r of rowsIn(rowsFile)) {
        assert.deepEqual([r.infra, r.final, r.grade.pass, r.costUsd, r.tokenScrubbed], [null, true, true, 0.25, 1], `${r.runId}: ${JSON.stringify(r.grade)}`);
        assert.ok(!JSON.stringify(r).includes(SENTINEL));
      }
      assert.ok(!readFileSync(rowsFile, 'utf8').includes(SENTINEL));
      assert.equal(exists(sweep), false, 'the stale s5.task container was swept');
      assert.equal(exists(keep), true, 'a container with s5=1 only (like the proxy) was not');
      assert.equal(docker('ps', '-aq', '--filter', `label=s5.task=${id}`), '', 'no container of this task is left, the agent\'s or the grader\'s');
      assert.ok(!existsSync(path.join(scene.workRoot, 'batch.lock')));
    });
  } finally {
    for (const name of [keep, sweep]) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 120_000 });
  }
};

if (process.env.S5_DOCKER_TESTS !== '1') {
  console.log('skip - the runBatch test against real Docker needs S5_DOCKER_TESTS=1');
} else if (NO_REFLINK_HERE) {
  console.log(`not ok - the runBatch test against real Docker needs a reflink filesystem: ${NO_REFLINK_HERE}`);
  process.exitCode = 1;
} else {
  await dockerTest();
}
