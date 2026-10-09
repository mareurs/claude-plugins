// run.test.mjs — the S5 batch runner: planRunsS5 (Task 10a, rulings R2, R59, R84, R86) and runOne (Task 10b, rulings R74, R75, R87-R90,
// R93, R98, R99, R100-R103).
//
// Every plan is compared with an ORACLE written here from makeRng alone (a Fisher-Yates written out, a plan built by
// sorting instead of by looping), and one vector is pinned as literal run ids, computed once from the same definition
// with a stand-alone script. A decision of R84 that flips (the stream, the offset of taskIndex, the Fisher-Yates index,
// the arm order before the shuffle, the round, the runId, the filter, a mode's refusal) must fail a test below.
//
// The preregistration objects are plain data of the loaders' shape and frozen at every depth, as the loaders return
// them: a planner that wrote to one would throw here. One test builds its object with the real loadS5Config.
// Fixtures live under one mkdtemp directory in os.tmpdir(), removed on process exit.
//
// runOne runs against the FAKE docker (fixtures/fake-docker.mjs, with its test-only `run.exec`) and the FAKE claude
// (fixtures/fake-claude.mjs), on tasks built by the real buildTask; the grade is a scripted seam, except in one test that
// runs the real gradeTree against the fake docker. Those tests need a reflink filesystem (runOne copies the task's tree with
// reflinkCopy), so their directories live under ~/work/claude/s5-work/tmp-tests-t10b/ and are removed afterwards. The last
// test runs the real thing against real Docker with S5_DOCKER_TESTS=1. No test starts a model: the token is a sentinel.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { makeRng } from '../s4-prng.mjs';
import { buildTask, hashBuiltTask } from './build-task.mjs';
import { dockerRun } from './docker.mjs';
import { makeRepo } from './fixtures/make-repo.mjs';
import { ta } from './fixtures/testkit-async.mjs';
import { RUN_ID_RE } from './grade.mjs';
import { writeHookCopy } from './hook-copy.mjs';
import { loadS5Config } from './prereg.mjs';
import { NETWORK, PROXY_URL } from './proxy.mjs';
import { planRunsS5, runOne, scrubRunDirs } from './run.mjs';
import { IMAGE_FOR_REPO, TASK_ID_RE } from './task-def.mjs';
import { readRunUsage } from './usage.mjs';

const ROOT = mkdtempSync(path.join(os.tmpdir(), 's5-run-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

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

const EFFORT = { A: 'xhigh', B: 'xhigh', C: 'low' };
const STEER = { A: false, B: true, C: false };
const ids = (n) => Array.from({ length: n }, (_, i) => `task-${i + 1}`);

// No `registered` key at all, as a file holds it (both loaders refuse the key in a file).
const NO_MARKER = Symbol('no marker');

// The prereg of the measured run's shape (the one prereg.test.mjs loads), as a loader returns it: frozen, with the `registered` marker.
// `runs` is { A, B, C }; `taskIds` the registered ids, in order.
function prereg({ runs = { A: 3, B: 3, C: 2 }, taskIds = ids(8), orderSeed = 11, registered = true } = {}) {
  const object = {
    model: 'claude-sonnet-5-5',
    cli: { version: '2.1.292', sha256: digest(0xc11) },
    arms: {
      A: { effort: EFFORT.A, steer: STEER.A, runs: runs.A },
      B: { effort: EFFORT.B, steer: STEER.B, runs: runs.B },
      C: { effort: EFFORT.C, steer: STEER.C, runs: runs.C },
    },
    tasks: taskIds.map((id, i) => ({ id, treeHash: hex(0x100 + i), hiddenHash: hex(0x200 + i), promptHash: hex(0x300 + i) })),
    margin: 0.15,
    alpha: 0.05,
    bound: { method: 'percentile', resamples: 10000, seed: 7 },
    orderSeed,
    mechanism: { alpha: 0.05, permutations: 1000, seed: 13, effectSizeThinkingTokens: 500 },
    limits: { timeoutMinutes: 90, cpus: 4, memoryGb: 16, concurrency: 2, infraRetries: 2 },
    images: { codescout: digest(0x1), 'claude-plugins': digest(0x2), proxy: digest(0x3) },
    proxyAllowlist: ['api.anthropic.com', 'statsig.anthropic.com'],
    stopAtCostUsd: 100,
  };
  return registered === NO_MARKER ? deepFreeze(object) : deepFreeze({ ...object, registered });
}

// ---- the oracle ----

const ARMS = ['A', 'B', 'C'];
// The plan R84 defines, built from makeRng alone. `only`: the ids planned (default all); `cap`: at most this many reps of an arm.
function oracle(p, { only = p.tasks.map((task) => task.id), cap = Infinity } = {}) {
  const entries = [];
  p.tasks.forEach((task, taskIndex) => {
    if (!only.includes(task.id)) return;
    const items = [];
    for (const arm of ARMS) for (let rep = 0; rep < Math.min(p.arms[arm].runs, cap); rep++) items.push({ arm, rep });
    const rng = makeRng(p.orderSeed, 11 + taskIndex);
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    items.forEach(({ arm, rep }, round) => {
      const run = { runId: `${task.id}.${arm}.${rep}`, taskId: task.id, taskIndex, arm, effort: p.arms[arm].effort, steer: p.arms[arm].steer, rep, round };
      entries.push({ round, taskIndex, run });
    });
  });
  return entries.sort((x, y) => x.round - y.round || x.taskIndex - y.taskIndex).map((e) => e.run);
}

const planIds = (plan) => plan.map((r) => r.runId);
const forTask = (plan, taskId) => plan.filter((r) => r.taskId === taskId);

t("the order is deterministic for a seed, differs for another seed, and contains each task's arm-reps exactly once", () => {
  const p = prereg();
  const plan = planRunsS5(p, { mode: 'measure' });
  assert.deepEqual(planRunsS5(p, { mode: 'measure' }), plan, 'the same registration plans the same order');
  assert.deepEqual(planRunsS5(prereg(), { mode: 'measure' }), plan, 'an equal registration, built again, plans it too');

  const other = planRunsS5(prereg({ orderSeed: 12 }), { mode: 'measure' });
  assert.notDeepEqual(planIds(other), planIds(plan), 'another orderSeed gives another order');
  assert.ok(ids(8).some((id) => forTask(other, id).map((r) => r.runId).join() !== forTask(plan, id).map((r) => r.runId).join()), 'some task is ordered differently');

  for (const [label, run] of [['seed 11', plan], ['seed 12', other]]) {
    assert.equal(run.length, 8 * 8, `${label}: 8 tasks x (3 + 3 + 2) runs`);
    assert.equal(new Set(planIds(run)).size, run.length, `${label}: no run id twice`);
    for (const id of ids(8)) {
      const expected = [0, 1, 2].flatMap((rep) => [`${id}.A.${rep}`, `${id}.B.${rep}`]).concat([0, 1].map((rep) => `${id}.C.${rep}`));
      assert.deepEqual(planIds(forTask(run, id)).sort(), expected.sort(), `${label}: ${id} holds each arm-rep exactly once`);
    }
  }
});

t('the order is the one R84 defines: A reps, then B, then C, Fisher-Yates from the end with makeRng(orderSeed, 11 + taskIndex), against an independent oracle', () => {
  for (const [label, p] of [
    ['3/3/2 on 8 tasks', prereg()],
    ['seed 0', prereg({ orderSeed: 0 })],
    ['a negative seed', prereg({ orderSeed: -5 })],
    ['a seed past 2^32', prereg({ orderSeed: 2 ** 40 + 3 })],
    ['2/2/1 on 3 tasks', prereg({ runs: { A: 2, B: 2, C: 1 }, taskIds: ids(3) })],
    ['5/1/4 on 4 tasks', prereg({ runs: { A: 5, B: 1, C: 4 }, taskIds: ids(4) })],
  ]) {
    assert.deepEqual(planRunsS5(p, { mode: 'measure' }), oracle(p), label);
  }
});

t('a pinned vector: orderSeed 7, three tasks, A 2 / B 1 / C 1 give exactly these twelve runs in this order', () => {
  const p = prereg({ runs: { A: 2, B: 1, C: 1 }, taskIds: ['alpha', 'beta', 'gamma'], orderSeed: 7 });
  const literal = [
    'alpha.A.1', 'beta.C.0', 'gamma.B.0', // round 0
    'alpha.A.0', 'beta.A.1', 'gamma.C.0', // round 1
    'alpha.B.0', 'beta.B.0', 'gamma.A.1', // round 2
    'alpha.C.0', 'beta.A.0', 'gamma.A.0', // round 3
  ];
  const expected = literal.map((runId, i) => {
    const [taskId, arm, rep] = runId.split('.');
    return { runId, taskId, taskIndex: ['alpha', 'beta', 'gamma'].indexOf(taskId), arm, effort: EFFORT[arm], steer: STEER[arm], rep: Number(rep), round: Math.floor(i / 3) };
  });
  assert.deepEqual(planRunsS5(p, { mode: 'measure' }), expected);
});

t("a Run is exactly { runId, taskId, taskIndex, arm, effort, steer, rep, round }: the effort and the steer come from the arm's registration", () => {
  const p = deepFreeze({
    ...prereg({ taskIds: ['x1', 'x2'], runs: { A: 1, B: 1, C: 1 } }),
    arms: { A: { effort: 'high', steer: false, runs: 1 }, B: { effort: 'high', steer: true, runs: 1 }, C: { effort: 'medium', steer: false, runs: 1 } },
  });
  const plan = planRunsS5(p, { mode: 'pilot' });
  assert.equal(plan.length, 6);
  for (const run of plan) {
    assert.deepEqual(Object.keys(run).sort(), ['arm', 'effort', 'steer', 'rep', 'round', 'runId', 'taskId', 'taskIndex'].sort());
    assert.equal(run.effort, { A: 'high', B: 'high', C: 'medium' }[run.arm], run.runId);
    assert.equal(run.steer, run.arm === 'B', run.runId);
    assert.equal(run.runId, `${run.taskId}.${run.arm}.${run.rep}`);
  }
});

t('round k holds the k-th entry of every task, tasks in registered order; round and rep are 0-based', () => {
  const plan = planRunsS5(prereg(), { mode: 'measure' });
  assert.deepEqual(
    plan.map((r) => [r.round, r.taskIndex]),
    Array.from({ length: 8 }, (_, round) => Array.from({ length: 8 }, (_, taskIndex) => [round, taskIndex])).flat(),
  );
  for (const id of ids(8)) {
    const own = forTask(plan, id);
    assert.deepEqual(own.map((r) => r.round), [0, 1, 2, 3, 4, 5, 6, 7], `${id}: its runs fill rounds 0..7 in order`);
    for (const arm of ARMS) assert.deepEqual(own.filter((r) => r.arm === arm).map((r) => r.rep).sort(), arm === 'C' ? [0, 1] : [0, 1, 2], `${id} ${arm}`);
  }
  plan.forEach((r, i) => assert.equal(r.taskIndex, ids(8).indexOf(r.taskId), `run ${i}`));
});

t('an arm with runs 0 is skipped, whichever arm it is, and the others keep their reps', () => {
  for (const [zero, runs] of [
    ['A', { A: 0, B: 2, C: 1 }],
    ['B', { A: 2, B: 0, C: 1 }],
    ['C', { A: 2, B: 2, C: 0 }],
  ]) {
    const p = prereg({ runs, taskIds: ids(3), registered: false });
    const plan = planRunsS5(p, { mode: 'calibrate' });
    assert.deepEqual(plan, oracle(p), `${zero} = 0`);
    assert.equal(plan.filter((r) => r.arm === zero).length, 0, `no ${zero} run`);
    assert.equal(plan.length, 3 * (runs.A + runs.B + runs.C), `${zero} = 0: the rest is planned`);
    for (const id of ids(3)) assert.deepEqual(forTask(plan, id).map((r) => r.round), Array.from({ length: runs.A + runs.B + runs.C }, (_, i) => i));
  }
  // The calibration shape (R2): no B arm at all.
  const plan = planRunsS5(prereg({ runs: { A: 2, B: 0, C: 1 }, taskIds: ids(2), registered: false }), { mode: 'calibrate' });
  assert.deepEqual(plan.map((r) => r.arm).sort(), ['A', 'A', 'A', 'A', 'C', 'C']);
  assert.deepEqual(planRunsS5(prereg({ runs: { A: 0, B: 0, C: 0 }, taskIds: ids(2), registered: false }), { mode: 'pilot' }), [], 'no arm has runs: nothing to plan');
});

t('taskIds keeps the registered taskIndex, stream, round and order: the filtered plan is the full plan restricted to those tasks', () => {
  const p = prereg({ registered: false });
  const full = planRunsS5(p, { mode: 'pilot' });
  for (const wanted of [['task-5', 'task-2'], ['task-5'], ['task-8', 'task-1', 'task-4'], ids(8)]) {
    const plan = planRunsS5(p, { mode: 'pilot', taskIds: wanted });
    assert.deepEqual(plan, full.filter((r) => wanted.includes(r.taskId)), wanted.join());
    assert.deepEqual(plan, oracle(p, { only: wanted }), `${wanted.join()} against the oracle`);
  }
  const one = planRunsS5(p, { mode: 'calibrate', taskIds: ['task-5'] });
  assert.ok(one.every((r) => r.taskIndex === 4 && r.taskId === 'task-5'), 'task-5 is index 4, not 0');
  assert.deepEqual(one.map((r) => r.round), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(planRunsS5(p, { mode: 'pilot', taskIds: ['task-2', 'task-2', 'task-2'] }), planRunsS5(p, { mode: 'pilot', taskIds: ['task-2'] }), 'a repeated id is one task');
  // The order inside a round follows the registration, not the order the ids were given in.
  const rounds = planRunsS5(p, { mode: 'pilot', taskIds: ['task-7', 'task-3'] });
  assert.deepEqual(rounds.slice(0, 2).map((r) => r.taskId), ['task-3', 'task-7']);
});

t('pilot, calibrate and measure plan the same order for the same registration: the mode never changes the shuffle', () => {
  const p = prereg();
  const measure = planRunsS5(p, { mode: 'measure' });
  assert.deepEqual(planRunsS5(p, { mode: 'pilot' }), measure);
  assert.deepEqual(planRunsS5(p, { mode: 'calibrate' }), measure);
  assert.deepEqual(planRunsS5(prereg({ registered: false }), { mode: 'pilot' }), measure, 'and the marker does not enter the order');
});

t('measure refuses an object that is not a registration (registered must be true), and refuses taskIds', () => {
  for (const marker of [false, NO_MARKER, 1, 'true', null, {}]) {
    const p = prereg({ registered: marker });
    assert.throws(() => planRunsS5(p, { mode: 'measure' }), (e) => e instanceof Error && /registered/.test(e.message) && /loadS5Prereg/.test(e.message), `registered ${String(marker)}`);
  }
  const p = prereg();
  assert.ok(planRunsS5(p, { mode: 'measure' }).length > 0, 'the same object with registered true plans');
  for (const taskIds of [['task-1'], ids(8), []]) {
    assert.throws(() => planRunsS5(p, { mode: 'measure', taskIds }), (e) => e instanceof Error && /taskIds/.test(e.message), JSON.stringify(taskIds));
  }
  assert.throws(() => planRunsS5(p, { mode: 'measure', taskIds: ['not-a-task'] }), (e) => e instanceof Error && /taskIds/.test(e.message));
});

t('smoke plans one run, rep 0, per arm with runs, on one task: the first registered one, or the one taskId given', () => {
  const p = prereg();
  const first = planRunsS5(p, { mode: 'smoke' });
  assert.deepEqual(first, oracle(p, { only: ['task-1'], cap: 1 }));
  assert.deepEqual(first.map((r) => r.arm).sort(), ['A', 'B', 'C']);
  assert.ok(first.every((r) => r.taskId === 'task-1' && r.taskIndex === 0 && r.rep === 0));
  assert.deepEqual(first.map((r) => r.round), [0, 1, 2]);

  const chosen = planRunsS5(p, { mode: 'smoke', taskIds: ['task-4'] });
  assert.deepEqual(chosen, oracle(p, { only: ['task-4'], cap: 1 }));
  assert.ok(chosen.every((r) => r.taskId === 'task-4' && r.taskIndex === 3 && r.rep === 0));
  assert.deepEqual(planRunsS5(p, { mode: 'smoke', taskIds: ['task-4', 'task-4'] }), chosen, 'a repeated id is still one task');
  assert.deepEqual(planRunsS5(p, { mode: 'smoke', taskIds: ['task-2'] }), oracle(p, { only: ['task-2'], cap: 1 }), 'the task given, not the registered first');

  // An arm without runs has no smoke run; an arm with many runs has one.
  const calib = prereg({ runs: { A: 4, B: 0, C: 1 }, taskIds: ids(3), registered: false });
  assert.deepEqual(planRunsS5(calib, { mode: 'smoke' }), oracle(calib, { only: ['task-1'], cap: 1 }));
  assert.deepEqual(planRunsS5(calib, { mode: 'smoke' }).map((r) => r.arm).sort(), ['A', 'C']);
  assert.deepEqual(planRunsS5(prereg({ runs: { A: 0, B: 3, C: 0 }, taskIds: ids(2), registered: false }), { mode: 'smoke' }).map((r) => r.runId), ['task-1.B.0']);
});

t('smoke refuses more than one taskId, naming every one of them (R94); pilot and calibrate take several', () => {
  const p = prereg();
  for (const taskIds of [['task-4', 'task-2'], ['task-2', 'task-4'], ['task-1', 'task-2', 'task-3'], ids(8)]) {
    assert.throws(
      () => planRunsS5(p, { mode: 'smoke', taskIds }),
      (e) => e instanceof Error && /smoke/.test(e.message) && taskIds.every((id) => e.message.includes(JSON.stringify(id))),
      taskIds.join(),
    );
  }
  // The refusal is smoke's alone: the other modes plan several tasks from the same list.
  for (const mode of ['pilot', 'calibrate']) assert.deepEqual(planRunsS5(p, { mode, taskIds: ['task-4', 'task-2'] }), oracle(p, { only: ['task-4', 'task-2'] }), mode);
});

t('an unknown taskId is refused by name in every mode that takes ids, wherever it sits in the list', () => {
  const p = prereg();
  const named = (...gone) => (e) => e instanceof Error && gone.every((id) => e.message.includes(id));
  for (const mode of ['smoke', 'pilot', 'calibrate']) {
    assert.throws(() => planRunsS5(p, { mode, taskIds: ['no-such-task'] }), named('no-such-task'), `${mode} alone`);
  }
  // Several ids: smoke refuses those (R94) before it can look for an unknown one.
  for (const mode of ['pilot', 'calibrate']) {
    assert.throws(() => planRunsS5(p, { mode, taskIds: ['task-1', 'no-such-task'] }), named('no-such-task'), `${mode} second`);
    assert.throws(() => planRunsS5(p, { mode, taskIds: ['gone-a', 'task-2', 'gone-b'] }), named('gone-a', 'gone-b'), `${mode} two`);
  }
  // A task id is matched exactly: a prefix, another case and a padded id are other ids.
  for (const mode of ['smoke', 'pilot']) {
    for (const id of ['task-', 'TASK-1', ' task-1', 'task-1 ', 'task-10']) {
      assert.throws(() => planRunsS5(p, { mode, taskIds: [id] }), (e) => e instanceof Error && e.message.includes(JSON.stringify(id)), `${mode} ${JSON.stringify(id)}`);
    }
  }
});

t('taskIds must be a non-empty array of strings; a mode must be one of the four; the prereg must be an object', () => {
  const p = prereg({ registered: false });
  for (const taskIds of [[], 'task-1', null, 7, {}, [1], ['task-1', 2], [null]]) {
    assert.throws(() => planRunsS5(p, { mode: 'pilot', taskIds }), (e) => e instanceof TypeError && /taskIds/.test(e.message), JSON.stringify(taskIds));
  }
  for (const mode of [undefined, null, '', 'Measure', 'smoke ', 'full', 'run', 7]) {
    assert.throws(() => planRunsS5(p, { mode }), (e) => e instanceof TypeError && ['measure', 'calibrate', 'pilot', 'smoke'].every((m) => e.message.includes(m)), String(mode));
  }
  assert.throws(() => planRunsS5(p), TypeError);
  assert.throws(() => planRunsS5(p, {}), TypeError);
  for (const bad of [null, undefined, 'prereg', 7, [], () => {}]) {
    assert.throws(() => planRunsS5(bad, { mode: 'pilot' }), (e) => e instanceof TypeError && /prereg/.test(e.message), String(bad));
  }
});

t('planRunsS5 plans what loadS5Config returns, a frozen object with registered false and an arm without runs', () => {
  const p = prereg({ runs: { A: 2, B: 0, C: 1 }, taskIds: ids(3), registered: NO_MARKER });
  const file = path.join(ROOT, 'config.json');
  writeFileSync(file, `${JSON.stringify(p, null, 2)}\n`);
  const config = loadS5Config(file, { mode: 'calibrate' });
  assert.equal(config.registered, false);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.arms.A) && Object.isFrozen(config.tasks[0]));
  const plan = planRunsS5(config, { mode: 'calibrate' });
  assert.deepEqual(plan, oracle(config));
  assert.equal(plan.length, 3 * 3);
  assert.ok(plan.every((r) => r.arm !== 'B'));
  assert.deepEqual(planRunsS5(config, { mode: 'smoke', taskIds: ['task-3'] }), oracle(config, { only: ['task-3'], cap: 1 }));
  assert.throws(() => planRunsS5(config, { mode: 'measure' }), /registered/, 'a config is never a registration');
});

// ---- R92: the longest legal task id still plans run ids the rest of the harness accepts ----

// docker.mjs's NAME_RE is private, so the test reads its regex literal out of that module's source: it follows it when it changes
// and fails (not passes) if the line moves away. grade.mjs's RUN_ID_RE is exported (R96) and imported above.
function regexIn(file, name) {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8');
  const m = text.match(new RegExp(`^const ${name} = /(.+)/([a-z]*);$`, 'm'));
  assert.ok(m, `${file} must define ${name} as a regex literal on one line`);
  return new RegExp(m[1], m[2]);
}

t('the longest legal task id plans run ids that gradeTree and docker accept, with an attempt suffix (R92)', () => {
  const NAME_RE = regexIn('./docker.mjs', 'NAME_RE');
  assert.ok(RUN_ID_RE.test('a'.repeat(64)) && !RUN_ID_RE.test('a'.repeat(65)), 'the regex imported is the 64-character one');
  assert.ok(NAME_RE.test('s5-a.b_c-1') && !NAME_RE.test('a-s5-x'), 'the regex read is the s5- container name one');

  const longest = 'a1b2'.repeat(12);
  assert.equal(longest.length, 48);
  assert.ok(TASK_ID_RE.test(longest) && !TASK_ID_RE.test(`${longest}c`), '48 characters is the longest legal id');

  // Two-digit reps: the longest run id is 48 + '.A.' + 2 digits.
  const file = path.join(ROOT, 'longest.json');
  writeFileSync(file, `${JSON.stringify(prereg({ runs: { A: 12, B: 3, C: 2 }, taskIds: [longest, 'x-y'], registered: NO_MARKER }), null, 2)}\n`);
  const config = loadS5Config(file, { mode: 'pilot' });
  const plan = planRunsS5(config, { mode: 'pilot' });
  assert.equal(plan.length, 2 * 17);
  assert.equal(Math.max(...plan.map((r) => r.runId.length)), 48 + 3 + 2);
  for (const { runId } of plan) {
    assert.match(runId, RUN_ID_RE);
    assert.match(`${runId}-a9`, RUN_ID_RE, 'with an attempt suffix');
    assert.match(`s5-${runId}-a9`, NAME_RE, 'the run container');
    assert.match(`s5-grade-${runId}`, NAME_RE, "gradeTree's container");
  }

  // A 49-character id never reaches the planner: the loader refuses it, naming the field.
  writeFileSync(file, `${JSON.stringify(prereg({ taskIds: [`${longest}c`], registered: NO_MARKER }), null, 2)}\n`);
  assert.throws(() => loadS5Config(file, { mode: 'pilot' }), /tasks\[0\]\.id/);
});

// =====================================================================================================================
// runOne (Task 10b)
//
//   the fake docker runs the fake claude against the real run directories (fake-docker.mjs `run.exec`), on tasks built by the
//   real buildTask; the grade is a scripted seam (`ctx.grade`) in every test but one.
// =====================================================================================================================

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_DOCKER = path.join(HERE, 'fixtures', 'fake-docker.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures', 'fake-claude.mjs');
const ES_ROOT = path.resolve(HERE, '..', '..');
const WORK = path.join(os.homedir(), 'work', 'claude', 's5-work');
const TMP_BASE = path.join(WORK, 'tmp-tests-t10b');
const fsType = (p) => spawnSync('stat', ['-f', '-c', '%T', p], { encoding: 'utf8' }).stdout.trim();
const NO_REFLINK_HERE = !existsSync(WORK) ? `${WORK} does not exist` : !['btrfs', 'xfs'].includes(fsType(WORK)) ? `${WORK} is on ${fsType(WORK)}, which cannot reflink` : '';
// A skip is printed as a skip, never as a pass.
async function taIf(name, skipReason, fn) {
  if (skipReason) console.log(`ok - ${name} # SKIP ${skipReason}`);
  else await ta(name, fn);
}

const fixtureDirs = [];
const sceneDirs = [];
const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
process.on('exit', () => {
  for (const d of [...fixtureDirs, ...sceneDirs]) rmSync(d, { recursive: true, force: true });
  try {
    rmdirSync(TMP_BASE);
  } catch {
    // another run's directories are in it, or it is gone
  }
});

// The token of every test: a sentinel, never a real value. It is exported once for the whole process; the tests that need it
// missing or different use withEnv, one at a time.
const SENTINEL = 'sk-ant-oat01-SENTINEL-this-is-not-a-real-token-0123456789';
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

// ---- the tasks: built by the real buildTask from a tiny fixture repository ----

// CRLF in the middle, multibyte characters, a trailing newline: bytes a careless read or a careless comparison would change.
const PROMPT = 'Fix `add` so that it adds.\r\nThe tests are in tests/ éè \u{1F600}\n';
const NODE_HEAD = "import assert from 'node:assert/strict';\nconst t = (name, fn) => {\n  try { fn(); console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); console.log(String(e.stack)); process.exitCode = 1; }\n};\n";
const SCENES = {
  node: {
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
  },
  cargo: {
    parent: {
      'Cargo.toml': '[package]\nname = "tiny"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 {\n    a - b\n}\n',
      'tests/visible.rs': 'use tiny::add;\n\n#[test]\nfn existing_passes() {\n    assert_eq!(add(0, 0), 0);\n}\n',
    },
    fix: {
      'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
      'tests/hidden.rs': 'use tiny::add;\n\n#[test]\nfn add_works() {\n    assert_eq!(add(2, 3), 5);\n}\n',
    },
    def: {
      id: 'fix-add',
      repo: 'codescout',
      subsystem: 'math',
      testRunner: 'cargo',
      hidden: { files: ['tests/hidden.rs'] },
      buildCommand: ['cargo', 'test', '--no-run'],
      f2p: { command: ['cargo', 'test', '--no-fail-fast', '--test', 'hidden'], names: ['add_works'] },
      p2p: { command: ['cargo', 'test', '--no-fail-fast', '--test', 'visible'], names: ['existing_passes'] },
      testPatterns: ['cargo test'],
      scrub: { removePaths: [], terms: [] },
      timeoutsSec: { build: 300, test: 120 },
    },
  },
};

// A built task and everything around it. `cargo` also has a warm target and a cargo home, as warmTask leaves them; `node` has neither.
function buildScene(kind, { id } = {}) {
  const s = SCENES[kind];
  const { dir, shas } = makeRepo([
    { label: 'parent', subject: 'chore: parent', date: '2026-10-02T10:00:00+00:00', files: s.parent },
    { label: 'fix', subject: 'fix: it', date: '2026-10-03T10:00:00+00:00', files: s.fix },
  ]);
  fixtureDirs.push(dir);
  const taskSrc = mkdtempSync(path.join(ROOT, 'taskdef-'));
  writeFileSync(path.join(taskSrc, 'task.json'), JSON.stringify({ ...s.def, ...(id === undefined ? {} : { id }), repoPath: dir, fix: shas.fix, parent: shas.parent }));
  writeFileSync(path.join(taskSrc, 'TASK.md'), '# Task\n\nadd must add.\n');
  writeFileSync(path.join(taskSrc, 'prompt.txt'), PROMPT);
  mkdirSync(TMP_BASE, { recursive: true });
  const workRoot = mkdtempSync(path.join(TMP_BASE, `${kind}-`));
  sceneDirs.push(workRoot);
  const manifest = buildTask(taskSrc, { workRoot });
  const taskDir = path.join(workRoot, 'tasks', manifest.id);
  const hook = writeHookCopy(path.join(workRoot, 'hook'), ES_ROOT);
  if (kind === 'cargo') {
    mkdirSync(path.join(taskDir, 'target', 'debug'), { recursive: true });
    writeFileSync(path.join(taskDir, 'target', 'debug', 'warm.o'), 'warm artifact\n');
    mkdirSync(path.join(workRoot, 'cargo-home'));
    writeFileSync(path.join(workRoot, 'cargo-home', 'config.toml'), '# offline\n');
  }
  return { kind, workRoot, manifest, taskDir, hook, image: IMAGE_FOR_REPO[manifest.repo], runsDir: path.join(workRoot, 'runs') };
}
const node = NO_REFLINK_HERE ? null : buildScene('node');
const cargo = NO_REFLINK_HERE ? null : buildScene('cargo');

// path, size, mtime and content hash (a link: its target) of everything under root, directories included.
function snapshot(root) {
  const out = [];
  const rec = (rel) => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      const st = lstatSync(path.join(root, r));
      const body = st.isSymbolicLink() ? `-> ${readlinkSync(path.join(root, r))}` : st.isDirectory() ? 'dir' : createHash('sha256').update(readFileSync(path.join(root, r))).digest('hex');
      out.push(`${r} ${st.mode} ${st.size} ${st.mtimeMs} ${body}`);
      if (st.isDirectory()) rec(r);
    }
  };
  rec('');
  return out;
}

// ---- the double the runOne tests stand on: fake-docker's run.exec ----

await ta('fixtures/fake-docker.mjs run.exec runs the mounted program on the host as a container would see it: paths mapped through the mounts, only -e variables and exec.env in its environment, its output and exit status the run\'s', async () => {
  const dir = mkdtempSync(path.join(ROOT, 'exec-'));
  const prog = path.join(dir, 'prog.mjs');
  writeFileSync(prog, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), env: process.env }));\nprocess.stderr.write("to stderr");\nprocess.exit(Number(process.env.EXIT ?? 0));\n');
  chmodSync(prog, 0o755);
  const work = path.join(dir, 'work');
  const cfg = path.join(dir, 'cfg');
  mkdirSync(work);
  mkdirSync(cfg);
  const options = (over = {}) => ({
    image: 'img',
    name: 's5-exec-1',
    mounts: [{ host: work, container: '/work' }, { host: cfg, container: '/run/config' }, { host: prog, container: '/opt/prog/prog', readOnly: true }],
    env: { CLAUDE_CONFIG_DIR: '/run/config', MY_VAR: 'v', OTHER: '/not/a/mount' },
    workdir: '/work',
    cmd: ['/opt/prog/prog', 'a b', '--', '-x'],
    timeoutMs: 20_000,
    stdin: 'null',
    ...over,
  });
  const f = fakeDocker({ run: { exec: { env: { EXTRA: 'x', EXIT: '3' } } } });
  const r = await dockerRun(options(), { dockerBin: f.bin });
  const seen = JSON.parse(r.stdout);
  assert.equal(seen.cwd, work, 'the working directory is the host directory bound at --workdir');
  assert.deepEqual(seen.argv, ['a b', '--', '-x'], 'its argv is the command\'s remaining words, untouched');
  assert.deepEqual(Object.keys(seen.env).sort(), ['CLAUDE_CONFIG_DIR', 'EXIT', 'EXTRA', 'MY_VAR', 'OTHER', 'PATH'], 'PATH, the -e variables and exec.env; no FAKE_DOCKER_*, no HOME');
  assert.equal(seen.env.CLAUDE_CONFIG_DIR, cfg, 'a value that is a mounted container path becomes the host path');
  assert.equal(seen.env.OTHER, '/not/a/mount', 'any other value is left alone');
  assert.equal(seen.env.MY_VAR, 'v');
  assert.equal(r.stderr, 'to stderr');
  assert.equal(r.status, 3, 'the program\'s exit status is the run\'s');
  // run.status wins over the program's; a command that names no mounted file is an error; without exec nothing is executed.
  const over = fakeDocker({ run: { status: 7, exec: {} } });
  assert.equal((await dockerRun(options(), { dockerBin: over.bin })).status, 7);
  const unmapped = await dockerRun(options({ cmd: ['/usr/bin/true'] }), { dockerBin: f.bin });
  assert.equal(unmapped.status, 96);
  assert.match(unmapped.stderr, /mounted file/);
  const plain = await dockerRun(options(), { dockerBin: fakeDocker({ run: {} }).bin });
  assert.deepEqual([plain.status, plain.stdout], [0, ''], 'a run without exec runs nothing');
});



// A model name no other file spells, so a hard-coded `--model` cannot pass. `timeoutMinutes` 90 is the measured run's.
const PREREG = deepFreeze({ ...prereg(), model: 'test-model-x1', limits: { timeoutMinutes: 90, cpus: 4, memoryGb: 16, concurrency: 2, infraRetries: 2 } });
// A 3-second wall clock (the loaders want whole minutes; runOne trusts its prereg): the fake container sleeps past it and is killed.
const SHORT = deepFreeze({ ...PREREG, limits: { ...PREREG.limits, timeoutMinutes: 0.05 } });
// And 6 s, so that the SCALE of timeoutMinutes is pinned by two points: a factor other than 60 000 misses one window of the test below.
const SHORT2 = deepFreeze({ ...PREREG, limits: { ...PREREG.limits, timeoutMinutes: 0.1 } });

let repSeq = 100;
// A Run as planRunsS5 makes it, for `scene`'s task, with a rep no other test uses (a run directory is never reused).
function mkRun(scene, arm = 'B', over = {}) {
  const rep = repSeq++;
  return {
    runId: `${scene.manifest.id}.${arm}.${rep}`, taskId: scene.manifest.id, taskIndex: 3, arm, effort: arm === 'C' ? 'low' : 'xhigh', steer: arm === 'B', rep, round: 5, ...over,
  };
}

// ---- the fake docker, the grade seam, and one function that runs a run ----

// A wrapper that exports the fake's two control variables (dockerRun hands docker a whitelisted environment, so a test cannot set
// them any other way) and execs fixtures/fake-docker.mjs.
function fakeDocker(config = {}) {
  const dir = mkdtempSync(path.join(ROOT, 'fake-docker-'));
  const log = path.join(dir, 'log.jsonl');
  const cfg = path.join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify(config));
  const bin = path.join(dir, 'docker');
  writeFileSync(bin, `#!/bin/sh\nexport FAKE_DOCKER_LOG=${shq(log)}\nexport FAKE_DOCKER_CONFIG=${shq(cfg)}\nexec ${shq(process.execPath)} ${shq(FAKE_DOCKER)} "$@"\n`);
  chmodSync(bin, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { bin, dir, calls };
}
const AGENT_ID = 'ab'.repeat(32);
const GRADE_ID = 'cd'.repeat(32);
const containerOf = (name, over = {}) => ({ id: AGENT_ID, name, labels: { s5: '1', 's5.run': name }, oomKilled: false, ...over });

const flagValue = (argv, flag) => argv[argv.indexOf(flag) + 1];
const mountsOf = (argv) => argv.flatMap((a, i) => {
  if (argv[i - 1] !== '--mount') return [];
  const fields = a.split(',');
  return [{ source: fields.find((x) => x.startsWith('source=')).slice(7), target: fields.find((x) => x.startsWith('target=')).slice(7), readOnly: fields.includes('readonly') }];
});
const envNamesOf = (argv) => argv.flatMap((a, i) => (argv[i - 1] === '-e' ? [a] : [])).sort();
const agentCall = (f) => f.calls().find((c) => c.argv[0] === 'run');
// What the container was told to run: everything after the image.
const commandOf = (call, scene) => call.argv.slice(call.argv.indexOf(scene.image) + 1);

const OK_GRADE = Object.freeze({
  infra: null,
  graft: 'ok',
  build: 'ok',
  f2p: Object.freeze({ passed: ['plus'], failed: [], notRun: [] }),
  p2p: Object.freeze({ passed: ['existing'], failed: [], notRun: [] }),
  nonAssertion: [],
  pass: true,
  diff: Object.freeze({ files: 1, insertions: 1, deletions: 1 }),
  wallMs: 1234,
  detail: null,
  kept: null,
  leftover: null,
});
const gradeWith = (over) => ({ ...OK_GRADE, ...over });
const infraGrade = (infra) => gradeWith({ infra, build: 'not_run', pass: false, detail: `the grade container: ${infra}` });

// Every file below root (relative, sorted), the .git of a tree included.
function walkFiles(root) {
  const out = [];
  const rec = (rel) => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) rec(r);
      else out.push(r);
    }
  };
  rec('');
  return out.sort();
}


// The `grade` seam: answers from a script (an array whose last entry repeats, or a function; an answer that is an Error is thrown)
// and records what it was asked and what the agent's tree and the target copy looked like at that moment.
function gradeSeam(script = [OK_GRADE]) {
  const calls = [];
  const readOr = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  const grade = async (manifest, treeDir, options) => {
    const target = path.join(path.dirname(treeDir), 'target');
    calls.push({
      manifest,
      treeDir,
      options,
      exists: existsSync(treeDir),
      files: existsSync(treeDir) ? walkFiles(treeDir) : null,
      lib: readOr(path.join(treeDir, 'lib.mjs')),
      edited: readOr(path.join(treeDir, 'edited.txt')),
      targetEdited: readOr(path.join(target, 'debug', 'agent.o')),
      targetWarm: readOr(path.join(target, 'debug', 'warm.o')),
    });
    const answer = typeof script === 'function' ? script(calls.length - 1, calls.at(-1)) : script[Math.min(calls.length - 1, script.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { grade, calls };
}

// Everything a runOne call needs. `o`: attempt; scenario (fake claude); noContainer; container (overrides of the fake container);
// docker (top-level keys of the fake docker's config); runCfg (keys of its `run`); grade (the seam's script); ctx (overrides of ctx);
// prereg; token (the environment value; undefined removes the variable).
function prepare(scene, run, o = {}) {
  const attempt = o.attempt ?? 1;
  const name = `s5-${run.runId}-a${attempt}`;
  const f = fakeDocker({
    containers: o.noContainer ? [] : [containerOf(name, o.container)],
    ...o.docker,
    run: { exec: { env: { FAKE_CLAUDE: JSON.stringify(o.scenario ?? {}) } }, ...o.runCfg },
  });
  const seam = gradeSeam(o.grade);
  const ctx = {
    prereg: o.prereg ?? PREREG, workRoot: scene.workRoot, hookCopy: scene.hook, claudeBin: FAKE_CLAUDE, attempt, dockerBin: f.bin, grade: seam.grade, ...o.ctx,
  };
  const exec = () => (Object.hasOwn(o, 'token') ? withEnv({ [ctx.tokenEnv ?? 'CLAUDE_CODE_OAUTH_TOKEN']: o.token }, () => runOne(run, ctx)) : runOne(run, ctx));
  return { f, seam, ctx, name, exec, runDir: path.join(scene.runsDir, `${run.runId}-a${attempt}`) };
}
// Runs it; a row comes back, and never holds the token.
async function go(scene, run, o = {}) {
  const p = prepare(scene, run, o);
  const row = await p.exec();
  assert.ok(!JSON.stringify(row).includes(SENTINEL), 'a row never holds the token');
  assert.ok(!JSON.stringify(p.f.calls()).includes(SENTINEL), 'nor does the docker log');
  return { ...p, row };
}
// Runs it and expects a refusal (a throw, so no row): no token in the message, no run directory made, no docker call.
async function refused(scene, run, o, pattern, label) {
  const p = prepare(scene, run, o);
  let err;
  try {
    await p.exec();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, `${label}: must throw`);
  assert.match(err.message, pattern, label);
  assert.ok(!err.message.includes(SENTINEL) && !String(err.stack).includes(SENTINEL), `${label}: the error never holds the token`);
  assert.ok(!existsSync(p.runDir), `${label}: no run directory was made`);
  assert.equal(p.f.calls().length, 0, `${label}: docker was never called`);
  assert.equal(p.seam.calls.length, 0, `${label}: nothing was graded`);
  return err;
}
// An infrastructure row: re-run, never scored; nothing was graded.
function assertInfra(r, infra, label = infra) {
  assert.equal(r.row.infra, infra, `${label}: infra`);
  assert.equal(r.row.final, false, `${label}: an infrastructure row is not final`);
  assert.equal(r.row.grade, null, `${label}: an infrastructure row has no grade`);
  assert.equal(r.seam.calls.length, 0, `${label}: nothing was graded`);
  assert.equal(r.row.tokenScrubbed, 0, `${label}: no file held the token`);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROW_KEYS = [
  'runId', 'taskId', 'taskIndex', 'arm', 'effort', 'rep', 'round', 'sessionId', 'startedAt', 'wallMs', 'exit', 'infra', 'final', 'decision', 'usage', 'efforts', 'costUsd', 'numTurns', 'isError', 'tokenScrubbed',
  'firstUserTextOk', 'testsRunBeforeDone', 'finalTextTail', 'grade',
];

// ---- refusals: before anything is made ----

await taIf('runOne refuses before anything is made: no token, a prompt.txt that is not the manifest\'s (R99), an existing run directory, inputs it cannot use', NO_REFLINK_HERE, async () => {
  await refused(node, mkRun(node), { token: undefined }, /CLAUDE_CODE_OAUTH_TOKEN/, 'no token');
  await refused(node, mkRun(node), { token: '' }, /CLAUDE_CODE_OAUTH_TOKEN/, 'an empty token');
  // ctx.tokenEnv names the variable that is read: the default one is set (the sentinel) and does not stand in for it.
  await refused(node, mkRun(node), { ctx: { tokenEnv: 'S5_OTHER_TOKEN_VAR' } }, /S5_OTHER_TOKEN_VAR/, 'the variable named by ctx.tokenEnv');
  await refused(node, mkRun(node), { ctx: { tokenEnv: 'not a name' } }, /tokenEnv/, 'a variable name docker would refuse');
  await refused(node, mkRun(node), { ctx: { tokenEnv: 'XDG_STATE_HOME' } }, /tokenEnv/, 'a variable runOne sets itself');

  // R99: a prompt.txt that is not the one the manifest hashes (a scene of its own: the file is changed and put back).
  const sc = buildScene('node');
  const promptFile = path.join(sc.taskDir, 'prompt.txt');
  const original = readFileSync(promptFile);
  writeFileSync(promptFile, Buffer.concat([original, Buffer.from(' ')]));
  const e = await refused(sc, mkRun(sc), {}, /prompt\.txt/, 'a prompt.txt with one byte more');
  assert.match(e.message, /promptHash/);
  assert.ok(!e.message.includes('Fix `add`'), 'the prompt is not echoed');
  writeFileSync(promptFile, original);
  rmSync(promptFile);
  await refused(sc, mkRun(sc), {}, /prompt\.txt/, 'no prompt.txt');
  writeFileSync(promptFile, original);

  // The manifest is the task's: a manifest of another task, a task id with no built task.
  const manifestFile = path.join(sc.taskDir, 'manifest.json');
  const manifestText = readFileSync(manifestFile, 'utf8');
  assert.ok(manifestText.includes('"id": "fix-plus"'));
  writeFileSync(manifestFile, manifestText.replace('"id": "fix-plus"', '"id": "fix-other"'));
  await refused(sc, mkRun(sc), {}, /manifest\.json/, 'a manifest of another task');
  writeFileSync(manifestFile, manifestText);
  // R111, as a defence: a prompt.txt that is not valid UTF-8 is refused even when its hash is the manifest's (the manifest is rewritten
  // to match here, as a build that predates R111 would have left it). The bytes could not reach the CLI as they are.
  const notUtf8 = Buffer.concat([original, Buffer.from([0xff, 0x0a])]);
  writeFileSync(promptFile, notUtf8);
  writeFileSync(manifestFile, manifestText.replace(/"promptHash": "[0-9a-f]{64}"/, `"promptHash": "${createHash('sha256').update(notUtf8).digest('hex')}"`));
  const utf8Err = await refused(sc, mkRun(sc), {}, /UTF-8/, 'a prompt.txt that is not UTF-8 although it hashes right');
  assert.match(utf8Err.message, /prompt\.txt/);
  writeFileSync(promptFile, original);
  writeFileSync(manifestFile, manifestText);
  // R118: a prompt with a NUL byte is valid UTF-8 but cannot be ONE argv element (spawn throws after the copies exist): refused at step 0,
  // by name, without printing the prompt.
  const withNul = Buffer.concat([original, Buffer.from([0x00, 0x0a])]);
  writeFileSync(promptFile, withNul);
  writeFileSync(manifestFile, manifestText.replace(/"promptHash": "[0-9a-f]{64}"/, `"promptHash": "${createHash('sha256').update(withNul).digest('hex')}"`));
  const nulErr = await refused(sc, mkRun(sc), {}, /NUL/, 'a prompt.txt with a NUL byte although it hashes right');
  assert.match(nulErr.message, /prompt\.txt/);
  assert.ok(!nulErr.message.includes('Fix `add`'), 'the prompt is not printed');
  writeFileSync(promptFile, original);
  writeFileSync(manifestFile, manifestText);
  await refused(node, mkRun(node, 'B', { taskId: 'no-such-task' }), {}, /manifest\.json/, 'no manifest');
  const other = mkRun(node, 'B', { taskId: 'fix-add' });
  await refused(node, other, {}, /manifest\.json/, 'a task id of another work root');

  // An existing run directory is refused and left alone.
  const run = mkRun(node);
  const p = prepare(node, run, {});
  mkdirSync(p.runDir, { recursive: true });
  writeFileSync(path.join(p.runDir, 'earlier.txt'), 'a previous attempt\n');
  const before = snapshot(p.runDir);
  await assert.rejects(p.exec(), /already exists/);
  assert.deepEqual(snapshot(p.runDir), before, 'the existing run directory is untouched');
  assert.equal(p.f.calls().length, 0);

  // Inputs: a run it cannot name, an attempt that is not a positive integer, an arm and a steer that disagree.
  await refused(node, mkRun(node, 'B', { arm: 'D', steer: false }), {}, /run\.arm/, 'an arm that is not A, B or C');
  await refused(node, mkRun(node, 'A', { steer: true }), {}, /run\.steer/, 'arm A with steer true');
  await refused(node, mkRun(node, 'B', { steer: false }), {}, /run\.steer/, 'arm B with steer false');
  await refused(node, mkRun(node, 'B', { effort: '' }), {}, /effort/, 'no effort');
  await refused(node, mkRun(node, 'B', { taskId: '../x' }), {}, /taskId/, 'a task id that is a path');
  await refused(node, mkRun(node, 'B', { runId: 'x'.repeat(62) }), {}, /runId/, 'a run id whose grade ids no longer fit');
  for (const attempt of [0, 1.5, '1', -1, undefined]) await refused(node, mkRun(node), { attempt, ctx: { attempt } }, /attempt/, `attempt ${String(attempt)}`);
  await refused(node, mkRun(node), { ctx: { grade: 'x' } }, /grade/, 'a grade that is not a function');
  await refused(node, mkRun(node), { ctx: { prereg: undefined } }, /prereg/, 'no prereg');
  const withPrereg = (over) => deepFreeze({ ...PREREG, ...over });
  await refused(node, mkRun(node), { prereg: withPrereg({ model: undefined }) }, /ctx\.prereg must be/, 'no model');
  await refused(node, mkRun(node), { prereg: withPrereg({ model: '' }) }, /ctx\.prereg must be/, 'an empty model');
  await refused(node, mkRun(node), { prereg: withPrereg({ limits: undefined }) }, /ctx\.prereg must be/, 'no limits');
  for (const [what, bad] of [['timeoutMinutes', 0], ['timeoutMinutes', '90'], ['cpus', -1], ['cpus', null], ['memoryGb', Infinity], ['memoryGb', '16']]) {
    await refused(node, mkRun(node), { prereg: withPrereg({ limits: { ...PREREG.limits, [what]: bad } }) }, new RegExp(`limits\\.${what}`), `limits.${what} ${String(bad)}`);
  }
  await refused(node, mkRun(node), { ctx: { claudeBin: path.join(node.workRoot, 'no-such-claude') } }, /claudeBin|claude/, 'a Claude binary that is not there');
  await refused(node, mkRun(node), { ctx: { hookCopy: { copyDir: path.join(node.workRoot, 'no-such-copy'), settingsFile: 'x' } } }, /hookCopy|copyDir/, 'a hook copy that is not there');
  await refused(node, mkRun(node), { ctx: { images: { 'claude-plugins': 5 } } }, /image/, 'an image that is not a string');
  // R112: a ctx.images that is given must name the task's repo; there is no silent fall back to IMAGE_FOR_REPO for a missing key.
  for (const [label, images] of [['another repo only', { codescout: 's5/codescout' }], ['empty', {}]]) {
    const e = await refused(node, mkRun(node), { ctx: { images } }, /claude-plugins/, `ctx.images ${label}`);
    assert.ok(e instanceof TypeError, `ctx.images ${label}: a TypeError`);
  }
  // The task's tree is a directory, not a link; its warm target (when it has one) too.
  const linked = buildScene('node');
  rmSync(path.join(linked.taskDir, 'tree'), { recursive: true });
  symlinkSync(node.taskDir, path.join(linked.taskDir, 'tree'));
  await refused(linked, mkRun(linked), {}, /tree/, 'a tree that is a link');
  const target = buildScene('node');
  symlinkSync(node.taskDir, path.join(target.taskDir, 'target'));
  await refused(target, mkRun(target), {}, /target/, 'a warm target that is a link');
});

// ---- a run that goes well: the Row ----

await taIf('runOne, a B run that goes well: every field of the Row holds the value the brief and R87-R90 give it, and the grade is asked about the agent\'s tree', NO_REFLINK_HERE, async () => {
  const before = Date.now();
  const run = mkRun(node, 'B');
  const tail = `${'x'.repeat(400)}END`;
  const r = await go(node, run, { scenario: { bash: ['node tests/visible.test.mjs'], finalText: tail, edit: { 'edited.txt': 'agent edit\n' }, subagents: [{}] } });
  const { row, f, seam, runDir } = r;
  assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort());
  for (const k of ['runId', 'taskId', 'taskIndex', 'arm', 'effort', 'rep', 'round']) assert.equal(row[k], run[k], k);
  assert.match(row.sessionId, UUID_RE, 'a fresh UUID');
  const cmd = commandOf(agentCall(f), node);
  assert.equal(flagValue(cmd, '--session-id'), row.sessionId, 'the row names the session the container was given');
  assert.equal(row.startedAt, new Date(row.startedAt).toISOString());
  assert.ok(Date.parse(row.startedAt) >= before - 1000 && Date.parse(row.startedAt) <= Date.now(), 'startedAt is the start of this run');
  assert.ok(Number.isInteger(row.wallMs) && row.wallMs > 0, 'dockerRun\'s wall time');
  assert.deepEqual(row.exit, { code: 0, timedOut: false, oomKilled: false });
  assert.equal(row.infra, null);
  assert.equal(row.final, true);
  assert.deepEqual(row.decision, { arm: 'treated', steered: true });
  assert.deepEqual(row.efforts, ['xhigh']);
  assert.deepEqual(row.efforts, row.usage.efforts);
  assert.equal(row.costUsd, 0.4321);
  assert.equal(row.numTurns, 7);
  assert.equal(row.isError, false);
  assert.equal(row.firstUserTextOk, true);
  assert.equal(row.testsRunBeforeDone, true);
  assert.equal(row.finalTextTail, tail.slice(-300), 'the last 300 characters of the final text');
  assert.deepEqual(row.grade, OK_GRADE);
  assert.ok(!('leftover' in row), 'no leftover key when nothing is left over');
  assert.equal(row.tokenScrubbed, 0, 'no file of the run held the token (R108)');
  assert.ok(!('infraDetail' in row), 'no infraDetail on a row no caught error made infrastructure (R110)');

  // usage is what readRunUsage returns, with the paths relative to the run directory.
  const u = readRunUsage(path.join(runDir, 'config'), row.sessionId);
  assert.deepEqual(row.usage, { ...u, transcriptPath: path.relative(runDir, u.transcriptPath), subagentFiles: u.subagentFiles.map((p) => path.relative(runDir, p)) });
  assert.equal(row.usage.transcriptPath, `config/projects/-work/${row.sessionId}.jsonl`);
  assert.deepEqual(row.usage.subagentFiles, [`config/projects/-work/${row.sessionId}/subagents/agent-1.jsonl`]);
  assert.equal(row.usage.main.messages, 2);
  assert.equal(row.usage.subagents.messages, 1);
  assert.ok(!JSON.stringify(row).includes(node.workRoot), 'no absolute host path in the row');

  // The grade is asked once, about the agent's tree (the copy the agent edited), with the manifest, the image and the limits.
  assert.equal(seam.calls.length, 1);
  const [g] = seam.calls;
  assert.deepEqual(g.manifest, node.manifest);
  assert.equal(g.treeDir, path.join(runDir, 'work'));
  assert.equal(g.exists, true);
  assert.equal(g.edited, 'agent edit\n', 'the agent\'s edit is in the tree that is graded');
  // ...and the rest of the tree is the task's: work was copied from tasks/<id>/tree (.git and all) before the container ran.
  assert.deepEqual(g.files, [...walkFiles(path.join(node.taskDir, 'tree')), 'edited.txt'].sort());
  assert.equal(g.lib, readFileSync(path.join(node.taskDir, 'tree', 'lib.mjs'), 'utf8'));
  assert.deepEqual(g.options, { workRoot: node.workRoot, image: 's5/plugins', dockerBin: f.bin, runId: `${run.runId}-a1-g1`, cpus: 4, memoryGb: 16 });
});

await taIf('runOne\'s Row for arms A and C: the effort is the run\'s, the decision is the holdout, and nothing else changes', NO_REFLINK_HERE, async () => {
  for (const arm of ['A', 'C']) {
    const run = mkRun(node, arm);
    const { row, f } = await go(node, run, {});
    assert.equal(row.infra, null, arm);
    assert.equal(row.final, true);
    assert.equal(row.arm, arm);
    assert.equal(row.effort, arm === 'C' ? 'low' : 'xhigh');
    assert.deepEqual(row.efforts, [row.effort]);
    assert.deepEqual(row.decision, { arm: 'holdout', steered: false });
    const cmd = commandOf(agentCall(f), node);
    assert.equal(flagValue(cmd, '--effort'), row.effort);
    assert.ok(agentCall(f).argv.includes(`s5.arm=${arm}`));
  }
});

// ---- the invocation: the container, its mounts and its environment ----

await taIf('runOne asks docker for exactly this container: name, labels, limits, network, user, workdir, the 7 mounts in order, stdin from /dev/null, and the invocation of the brief with the prompt as ONE argv element', NO_REFLINK_HERE, async () => {
  const run = mkRun(cargo, 'B');
  const { f, row, runDir } = await go(cargo, run, { attempt: 2 });
  assert.equal(row.infra, null);
  const call = agentCall(f);
  const name = `s5-${run.runId}-a2`;
  const rd = (d) => path.join(runDir, d);
  assert.equal(runDir, path.join(cargo.workRoot, 'runs', `${run.runId}-a2`));
  assert.deepEqual(call.argv.slice(0, call.argv.indexOf('-e')), [
    'run', '--pull=never', '--name', name, '--label', 's5=1', '--label', `s5.run=${name}`, '--label', `s5.task=${run.taskId}`, '--label', 's5.arm=B',
    '--cpus', '4', '--memory', '16g', '--network', NETWORK, '--user', 'agent', '--workdir', '/work',
    '--mount', `type=bind,source=${rd('work')},target=/work`,
    '--mount', `type=bind,source=${rd('target')},target=/target`,
    '--mount', `type=bind,source=${path.join(cargo.workRoot, 'cargo-home')},target=/cargo,readonly`,
    '--mount', `type=bind,source=${rd('config')},target=/run/config`,
    '--mount', `type=bind,source=${rd('state')},target=/run/state`,
    '--mount', `type=bind,source=${cargo.hook.copyDir},target=/opt/es,readonly`,
    '--mount', `type=bind,source=${FAKE_CLAUDE},target=/opt/claude/claude,readonly`,
  ]);
  assert.deepEqual(call.argv.slice(call.argv.indexOf(cargo.image)), [
    cargo.image,
    '/opt/claude/claude', '-p', '--model', 'test-model-x1', '--effort', 'xhigh', '--session-id', row.sessionId, '--setting-sources', 'local', '--settings', '/opt/es/settings.json',
    '--strict-mcp-config', '--thinking-display', 'summarized', '--dangerously-skip-permissions', '--disallowedTools', 'WebFetch', 'WebSearch', '--output-format', 'json', '--', PROMPT,
  ]);
  assert.equal(call.stdinKind, 'null', 'stdin is /dev/null');
  assert.equal(cargo.image, 's5/codescout', 'the codescout task runs in the codescout image');
});

await taIf('runOne\'s mounts: the copies of the tree and the warm target read-write, the cargo home, the hook copy and the Claude binary read-only, the two state directories read-write; a task with no warm target or no cargo home gets neither mount; nothing is mounted from under tasks/<id>/', NO_REFLINK_HERE, async () => {
  const withAll = await go(cargo, mkRun(cargo), {});
  const rd = (d) => path.join(withAll.runDir, d);
  assert.deepEqual(mountsOf(agentCall(withAll.f).argv), [
    { source: rd('work'), target: '/work', readOnly: false },
    { source: rd('target'), target: '/target', readOnly: false },
    { source: path.join(cargo.workRoot, 'cargo-home'), target: '/cargo', readOnly: true },
    { source: rd('config'), target: '/run/config', readOnly: false },
    { source: rd('state'), target: '/run/state', readOnly: false },
    { source: cargo.hook.copyDir, target: '/opt/es', readOnly: true },
    { source: FAKE_CLAUDE, target: '/opt/claude/claude', readOnly: true },
  ]);

  const plain = await go(node, mkRun(node), {});
  const prd = (d) => path.join(plain.runDir, d);
  assert.deepEqual(mountsOf(agentCall(plain.f).argv), [
    { source: prd('work'), target: '/work', readOnly: false },
    { source: prd('config'), target: '/run/config', readOnly: false },
    { source: prd('state'), target: '/run/state', readOnly: false },
    { source: node.hook.copyDir, target: '/opt/es', readOnly: true },
    { source: FAKE_CLAUDE, target: '/opt/claude/claude', readOnly: true },
  ]);

  // Task 8 carry: the container sees copies only. Nothing under <workRoot>/tasks/ is a mount source, read-only or not.
  for (const [scene, r] of [[cargo, withAll], [node, plain]]) {
    for (const m of mountsOf(agentCall(r.f).argv)) {
      assert.ok(!(m.source + path.sep).startsWith(path.join(scene.workRoot, 'tasks') + path.sep), `${m.target} is mounted from under tasks/: ${m.source}`);
    }
  }
});

await taIf('runOne\'s environment, all passed by NAME: the config and state directories are the container\'s, the holdout rate is 0 for B and 1 for A and C, the proxy, the warm target, the token', NO_REFLINK_HERE, async () => {
  for (const [arm, rate] of [['B', '0'], ['A', '1'], ['C', '1']]) {
    const run = mkRun(cargo, arm);
    const expectEnv = {
      CLAUDE_CONFIG_DIR: '/run/config', XDG_STATE_HOME: '/run/state', EFFORT_STEERING_HOLDOUT_RATE: rate, HTTPS_PROXY: PROXY_URL, CARGO_TARGET_DIR: '/target', CLAUDE_CODE_OAUTH_TOKEN: SENTINEL,
    };
    const { f, row } = await go(cargo, run, { docker: { expectEnv } });
    const call = agentCall(f);
    assert.deepEqual(call.envMatches, Object.fromEntries(Object.keys(expectEnv).map((k) => [k, true])), `${arm}: every variable has the value it must have`);
    assert.deepEqual(envNamesOf(call.argv), Object.keys(expectEnv).sort(), `${arm}: and these are all the variables`);
    assert.ok(call.argv.every((a) => !/^[A-Z][A-Z0-9_]*=/.test(a)), 'no -e NAME=value anywhere: a value never rides in argv');
    // The rate reaches the hook: the fake claude derives its decision from it, as the hook does, so a wrong rate is an arm_mismatch.
    assert.equal(row.infra, null, arm);
    assert.deepEqual(row.decision, rate === '0' ? { arm: 'treated', steered: true } : { arm: 'holdout', steered: false });
  }

  // No warm target: no CARGO_TARGET_DIR. The proxy and the network are ctx's, and null is no proxy variable at all.
  const noTarget = await go(node, mkRun(node), {});
  assert.ok(!envNamesOf(agentCall(noTarget.f).argv).includes('CARGO_TARGET_DIR'));
  const noProxy = await go(node, mkRun(node), { ctx: { proxyUrl: null, network: 'bridge' } });
  assert.ok(!envNamesOf(agentCall(noProxy.f).argv).includes('HTTPS_PROXY'), 'proxyUrl null means no HTTPS_PROXY at all');
  assert.equal(flagValue(agentCall(noProxy.f).argv, '--network'), 'bridge');
  const own = await go(node, mkRun(node), { ctx: { proxyUrl: 'http://proxy.example:3128' }, docker: { expectEnv: { HTTPS_PROXY: 'http://proxy.example:3128' } } });
  assert.deepEqual(agentCall(own.f).envMatches, { HTTPS_PROXY: true });
  assert.equal(flagValue(agentCall(noTarget.f).argv, '--network'), NETWORK, 'the default network is the proxy network');

  // R108: the container NEVER gets CLAUDE_CODE_SUBPROCESS_ENV_SCRUB (the CLI's opt-in scrub of its subprocess environment: it switches
  // off --dangerously-skip-permissions and needs bubblewrap in the image, a different instrument) nor GITHUB_ACTIONS (which the CLI also
  // reads). Not even when this process has them set: runOne passes the names it lists and nothing from its own environment.
  const ambient = await withEnv({ CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', GITHUB_ACTIONS: 'true' }, () => go(cargo, mkRun(cargo), {}));
  const ambientCall = agentCall(ambient.f);
  for (const name of ['CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', 'GITHUB_ACTIONS']) {
    assert.ok(!envNamesOf(ambientCall.argv).includes(name), `${name} is not an -e variable of the container`);
    assert.ok(!ambientCall.envNames.includes(name), `${name} is not even in the environment of the docker process`);
  }
  assert.deepEqual(envNamesOf(ambientCall.argv), ['CARGO_TARGET_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'EFFORT_STEERING_HOLDOUT_RATE', 'HTTPS_PROXY', 'XDG_STATE_HOME']);
});

await taIf('the token value appears in neither argv nor any row; ctx.tokenEnv renames the variable; a token in the agent\'s final text is redacted, and a row that would still hold it is never returned', NO_REFLINK_HERE, async () => {
  const { f, row } = await go(node, mkRun(node), { docker: { expectEnv: { CLAUDE_CODE_OAUTH_TOKEN: SENTINEL } } });
  const call = agentCall(f);
  assert.equal(call.envMatches.CLAUDE_CODE_OAUTH_TOKEN, true, 'the token reached the container\'s environment...');
  assert.ok(call.argv.includes('CLAUDE_CODE_OAUTH_TOKEN') && call.argv[call.argv.indexOf('CLAUDE_CODE_OAUTH_TOKEN') - 1] === '-e', '...as -e NAME');
  assert.ok(call.argv.every((a) => !a.includes(SENTINEL)), '...and not in argv');
  assert.ok(!JSON.stringify(row).includes(SENTINEL));

  // Another variable name: only that one is passed.
  const renamed = await withEnv({ S5_RENAMED_TOKEN: `${SENTINEL}-2` }, () => go(node, mkRun(node), {
    ctx: { tokenEnv: 'S5_RENAMED_TOKEN' }, docker: { expectEnv: { S5_RENAMED_TOKEN: `${SENTINEL}-2` } },
  }));
  const rc = agentCall(renamed.f);
  assert.equal(rc.envMatches.S5_RENAMED_TOKEN, true);
  assert.ok(envNamesOf(rc.argv).includes('S5_RENAMED_TOKEN') && !envNamesOf(rc.argv).includes('CLAUDE_CODE_OAUTH_TOKEN'));

  // The agent's final text can hold anything it printed. The token never reaches the row through it.
  const leaky = await go(node, mkRun(node), { scenario: { finalText: `the token is ${SENTINEL}` } });
  assert.equal(leaky.row.infra, null);
  assert.match(leaky.row.finalTextTail, /the token is \[REDACTED\]$/);

  // Defence in depth: a token anywhere else in the row (here in the name of a subagent transcript) stops the row. runOne throws, the
  // message does not hold the token, and the large directories are gone while the evidence stays.
  const run = mkRun(node);
  const p = prepare(node, run, { scenario: { subagents: [{ name: `agent-${SENTINEL}` }] } });
  const err = await p.exec().then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.match(err.message, /token/);
  assert.ok(!err.message.includes(SENTINEL) && !String(err.stack).includes(SENTINEL));
  assert.deepEqual(readdirSync(p.runDir).sort(), ['config', 'state'], 'work is gone, the transcripts stay');
});

// ---- R108: the kept evidence is scrubbed of the token ----

// The regular files under dir (links are not followed, not listed) whose bytes hold `needle`.
const filesHolding = (dir, needle) => {
  const found = [];
  const rec = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) rec(r);
      else if (e.isFile() && readFileSync(path.join(dir, r)).includes(needle)) found.push(r);
    }
  };
  rec('');
  return found;
};
const OLD_DATE = '2020-01-02T03:04:05.000Z';

await taIf('R108: after the container exits, config/ and state/ are scrubbed in place: every occurrence of the token becomes [REDACTED] in every regular file, a file without it is not rewritten, links are not followed, and the row counts the files that held it', NO_REFLINK_HERE, async () => {
  const outside = mkdtempSync(path.join(ROOT, 'outside-'));
  const outsideFile = path.join(outside, 'secret.txt');
  writeFileSync(outsideFile, `outside ${SENTINEL}\n`);
  mkdirSync(path.join(outside, 'sub'));
  writeFileSync(path.join(outside, 'sub', 'deep.txt'), SENTINEL);

  // The control: the same run with nothing leaked.
  const control = await go(node, mkRun(node), { scenario: { subagents: [{}] } });
  assert.equal(control.row.tokenScrubbed, 0);

  const scenario = {
    leak: true, // the transcript holds an `env` printout, as the CLI would write it if it exposed the token to its tools
    subagents: [{}],
    configFiles: { 'extra/notes.txt': 'a {{TOKEN}} b {{TOKEN}} c\n', 'clean.txt': { text: 'nothing secret here\n', mtime: OLD_DATE } },
    stateFiles: { 'dump.txt': 'x{{TOKEN}}', 'quiet.txt': { text: 'quiet\n', mtime: OLD_DATE } },
    configLinks: { 'link-to-file.txt': outsideFile, 'link-to-dir': path.join(outside, 'sub') },
  };
  const r = await go(node, mkRun(node), { scenario });
  const cfg = path.join(r.runDir, 'config');
  const st = path.join(r.runDir, 'state');
  assert.equal(r.row.infra, null);
  assert.equal(r.row.tokenScrubbed, 3, 'the transcript, notes.txt and dump.txt held it; the links and the clean files did not count');
  assert.deepEqual([...filesHolding(cfg, SENTINEL), ...filesHolding(st, SENTINEL)], [], 'no regular file under config/ or state/ holds the token any more');
  assert.equal(readFileSync(path.join(cfg, 'extra', 'notes.txt'), 'utf8'), 'a [REDACTED] b [REDACTED] c\n', 'every occurrence, not the first');
  assert.equal(readFileSync(path.join(st, 'dump.txt'), 'utf8'), 'x[REDACTED]');
  const transcript = readFileSync(path.join(cfg, 'projects', '-work', `${r.row.sessionId}.jsonl`), 'utf8');
  assert.ok(transcript.includes('CLAUDE_CODE_OAUTH_TOKEN=[REDACTED]'));
  for (const line of transcript.trim().split('\n')) JSON.parse(line); // still a transcript

  // A file without the token is not rewritten: its time is the one it was given.
  assert.equal(statSync(path.join(cfg, 'clean.txt')).mtime.toISOString(), OLD_DATE);
  assert.equal(statSync(path.join(st, 'quiet.txt')).mtime.toISOString(), OLD_DATE);
  assert.equal(readFileSync(path.join(cfg, 'clean.txt'), 'utf8'), 'nothing secret here\n');

  // Links are never followed: they are still links, and what they point to is as it was.
  assert.ok(lstatSync(path.join(cfg, 'link-to-file.txt')).isSymbolicLink() && lstatSync(path.join(cfg, 'link-to-dir')).isSymbolicLink());
  assert.equal(readFileSync(outsideFile, 'utf8'), `outside ${SENTINEL}\n`, 'the file a link pointed at was not scrubbed');
  assert.equal(readFileSync(path.join(outside, 'sub', 'deep.txt'), 'utf8'), SENTINEL, 'nor the directory a link pointed at');

  // The numbers in the row were read before the scrub and the scrub does not change them: the leaky run and the control agree, and
  // the scrubbed transcript still reads as the row says.
  for (const k of ['main', 'subagents', 'total']) assert.deepEqual(r.row.usage[k], control.row.usage[k], k);
  const again = readRunUsage(cfg, r.row.sessionId);
  for (const k of ['main', 'subagents', 'total', 'efforts']) assert.deepEqual(again[k], r.row.usage[k], `after the scrub: ${k}`);
});

await taIf('R108: the scrub also runs when runOne throws after the container, and a file it cannot rewrite stops the row instead of leaving the token behind', NO_REFLINK_HERE, async () => {
  const scenario = { leak: true, configFiles: { 'extra/notes.txt': 'a {{TOKEN}}\n' }, stateFiles: { 'dump.txt': '{{TOKEN}}' } };
  // A grade result that throws when it is read: the one way to make runOne throw after the container without a bug in runOne.
  const exploding = { get infra() { throw new Error('the grade result exploded'); }, pass: true };
  const p = prepare(node, mkRun(node), { scenario, grade: [exploding] });
  const err = await p.exec().then(() => null, (e) => e);
  assert.ok(err instanceof Error && /exploded/.test(err.message), 'runOne threw');
  assert.deepEqual(readdirSync(p.runDir).sort(), ['config', 'state'], 'the cleanup ran');
  assert.deepEqual([...filesHolding(path.join(p.runDir, 'config'), SENTINEL), ...filesHolding(path.join(p.runDir, 'state'), SENTINEL)], [], 'and so did the scrub');

  // The guard throw (the token in a file NAME, which a scrub of contents cannot fix) scrubs the contents all the same.
  const q = prepare(node, mkRun(node), { scenario: { ...scenario, subagents: [{ name: `agent-${SENTINEL}` }] } });
  const guarded = await q.exec().then(() => null, (e) => e);
  assert.match(guarded.message, /token/);
  assert.deepEqual(filesHolding(path.join(q.runDir, 'config'), SENTINEL), [], 'the contents are clean although the row was refused');

  // A file the scrub cannot rewrite (read-only): the token would stay in the kept evidence, so there is no row. Its NAME holds the
  // token here, and the error message that names the file must not.
  const locked = prepare(node, mkRun(node), { scenario: { configFiles: { 'locked-{{TOKEN}}.txt': { text: '{{TOKEN}}', mode: 0o400 } } } });
  const stuck = await locked.exec().then(() => null, (e) => e);
  assert.ok(stuck instanceof Error);
  assert.match(stuck.message, /scrub/);
  assert.match(stuck.message, /locked-\[REDACTED\]\.txt/, 'the file is named, with the token in its name redacted');
  assert.ok(!stuck.message.includes(SENTINEL) && !String(stuck.stack).includes(SENTINEL));
  assert.deepEqual(readdirSync(locked.runDir).sort(), ['config', 'state'], 'work is removed all the same');

  // R116: a file that kept the token is named in the error that is thrown even when ANOTHER failure was already set (here the grade
  // result that explodes): the count and the first path (token-redacted), after the failure that came first. Two such files: count 2.
  const both = prepare(node, mkRun(node), {
    scenario: { configFiles: { 'also-locked-{{TOKEN}}.txt': { text: '{{TOKEN}}', mode: 0o400 } }, stateFiles: { 'second-locked.txt': { text: '{{TOKEN}}', mode: 0o400 } } },
    grade: [exploding],
  });
  const bothErr = await both.exec().then(() => null, (e) => e);
  assert.ok(bothErr instanceof Error);
  assert.match(bothErr.message, /exploded/, 'the failure that was already set is still said');
  assert.match(bothErr.message, /could not scrub the token from 2 file\(s\)/, 'and the number of files that kept the token');
  assert.match(bothErr.message, /\[REDACTED\]/, 'with the first path, the token in its name redacted');
  assert.ok(!bothErr.message.includes(SENTINEL) && !String(bothErr.stack).includes(SENTINEL));
  assert.match(bothErr.cause?.message ?? '', /exploded/, 'the failure that was already set is the cause');
  assert.deepEqual(readdirSync(both.runDir).sort(), ['config', 'state'], 'work is removed all the same');
});

// ---- R117: scrubRunDirs, the same scrub over the run directories an interrupted batch left behind ----

await ta('R117: scrubRunDirs(runsRoot, token) scrubs config/ and state/ of every run directory directly under runsRoot, with the scrub runOne uses, and returns { dirs, files, failed } without throwing', async () => {
  const runsRoot = mkdtempSync(path.join(ROOT, 'runs-'));
  const put = (rel, text, mtime) => {
    const f = path.join(runsRoot, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
    if (mtime !== undefined) utimesSync(f, new Date(mtime), new Date(mtime));
  };
  // Three run directories hold the token, in four files (nested ones included, and only state/ in one).
  put('t.A.0-a1/config/projects/-work/s.jsonl', `x ${SENTINEL} y ${SENTINEL}\n`);
  put('t.A.0-a1/config/clean.txt', 'nothing here\n', OLD_DATE);
  put('t.A.0-a1/state/effort-steering/s.jsonl', SENTINEL);
  put('t.B.0-a1/state/dump.txt', `before${SENTINEL}after`);
  put('t.C.0-a2/config/deep/er/file.txt', `a${SENTINEL}b`);
  // One with nothing to scrub; one whose work/ and target/ hold the token (a keepRunDirs run: the operator's own copies, left alone).
  put('t.E.0-a1/config/ok.txt', 'ok\n', OLD_DATE);
  put('t.D.0-a1/work/lib.mjs', SENTINEL);
  put('t.D.0-a1/target/debug/x.o', SENTINEL);
  put('t.D.0-a1/config/quiet.txt', 'quiet\n', OLD_DATE);
  // A non-directory entry in runsRoot is no run directory.
  put('stray.txt', SENTINEL);
  // Links are never followed: a link to a run directory, a state/ that is a link, and a link inside config/.
  const outside = mkdtempSync(path.join(ROOT, 'outside-'));
  for (const rel of ['run/config/a.txt', 'run/state/b.txt', 'state-target/c.txt', 'file-target.txt']) {
    mkdirSync(path.dirname(path.join(outside, rel)), { recursive: true });
    writeFileSync(path.join(outside, rel), `outside ${SENTINEL}\n`);
  }
  symlinkSync(path.join(outside, 'run'), path.join(runsRoot, 'linked-run-a1'));
  mkdirSync(path.join(runsRoot, 't.F.0-a1', 'config'), { recursive: true });
  symlinkSync(path.join(outside, 'state-target'), path.join(runsRoot, 't.F.0-a1', 'state'));
  symlinkSync(path.join(outside, 'file-target.txt'), path.join(runsRoot, 't.F.0-a1', 'config', 'link.txt'));

  const r = scrubRunDirs(runsRoot, SENTINEL);
  assert.deepEqual(r, { dirs: 3, files: 4, failed: [] }, 'three directories and four files held the token');
  assert.deepEqual([...filesHolding(path.join(runsRoot, 't.A.0-a1', 'config'), SENTINEL), ...filesHolding(path.join(runsRoot, 't.A.0-a1', 'state'), SENTINEL)], []);
  assert.equal(readFileSync(path.join(runsRoot, 't.A.0-a1', 'config', 'projects', '-work', 's.jsonl'), 'utf8'), 'x [REDACTED] y [REDACTED]\n', 'every occurrence');
  assert.equal(readFileSync(path.join(runsRoot, 't.A.0-a1', 'state', 'effort-steering', 's.jsonl'), 'utf8'), '[REDACTED]', 'state/ too');
  assert.equal(readFileSync(path.join(runsRoot, 't.B.0-a1', 'state', 'dump.txt'), 'utf8'), 'before[REDACTED]after', 'a directory with state/ only');
  assert.equal(readFileSync(path.join(runsRoot, 't.C.0-a2', 'config', 'deep', 'er', 'file.txt'), 'utf8'), 'a[REDACTED]b', 'nested');
  // Left alone: files without the token (not rewritten: their time is the one they had), work/ and target/, a stray file.
  for (const rel of ['t.A.0-a1/config/clean.txt', 't.E.0-a1/config/ok.txt', 't.D.0-a1/config/quiet.txt']) assert.equal(statSync(path.join(runsRoot, rel)).mtime.toISOString(), OLD_DATE, rel);
  for (const rel of ['t.D.0-a1/work/lib.mjs', 't.D.0-a1/target/debug/x.o', 'stray.txt']) assert.equal(readFileSync(path.join(runsRoot, rel), 'utf8'), SENTINEL, `${rel} is not touched`);
  // Links: untouched, and still links.
  for (const rel of ['run/config/a.txt', 'run/state/b.txt', 'state-target/c.txt', 'file-target.txt']) assert.equal(readFileSync(path.join(outside, rel), 'utf8'), `outside ${SENTINEL}\n`, `${rel} was not followed`);
  assert.ok(lstatSync(path.join(runsRoot, 'linked-run-a1')).isSymbolicLink() && lstatSync(path.join(runsRoot, 't.F.0-a1', 'state')).isSymbolicLink());
  // Idempotent: a second pass finds nothing.
  assert.deepEqual(scrubRunDirs(runsRoot, SENTINEL), { dirs: 0, files: 0, failed: [] });

  // A file it cannot rewrite is returned in `failed`, not thrown, and the others are still scrubbed.
  put('t.G.0-a1/config/locked.txt', SENTINEL);
  chmodSync(path.join(runsRoot, 't.G.0-a1', 'config', 'locked.txt'), 0o400);
  put('t.G.0-a1/state/fine.txt', `x${SENTINEL}`);
  const stuck = scrubRunDirs(runsRoot, SENTINEL);
  assert.deepEqual(stuck, { dirs: 1, files: 1, failed: [path.join(runsRoot, 't.G.0-a1', 'config', 'locked.txt')] }, 'the unrewritable file is reported');
  assert.equal(readFileSync(path.join(runsRoot, 't.G.0-a1', 'state', 'fine.txt'), 'utf8'), 'x[REDACTED]');

  // No runs directory at all is nothing to scrub; so is one that is empty or is not a directory.
  assert.deepEqual(scrubRunDirs(path.join(runsRoot, 'no-such-dir'), SENTINEL), { dirs: 0, files: 0, failed: [] });
  assert.deepEqual(scrubRunDirs(path.join(runsRoot, 'stray.txt'), SENTINEL), { dirs: 0, files: 0, failed: [] });
  assert.deepEqual(scrubRunDirs(mkdtempSync(path.join(ROOT, 'empty-runs-')), SENTINEL), { dirs: 0, files: 0, failed: [] });
  // Its inputs: an empty token would match everywhere, so it is refused.
  assert.throws(() => scrubRunDirs(runsRoot, ''), TypeError);
  assert.throws(() => scrubRunDirs('', SENTINEL), TypeError);
});

// ---- R87: the classification, in its fixed order, first match wins ----

async function inChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}
// After any classified row the large directories are gone and the evidence stays (the transcript is how the row can be checked).
function assertCleaned(r, label) {
  assert.deepEqual(readdirSync(r.runDir).sort(), ['config', 'state'], `${label}: work and target are removed, config and state are kept`);
}
const noTranscript = (reason) => (r) => {
  assert.equal(r.row.usage?.reason ?? null, reason);
  assert.deepEqual(r.row.efforts, []);
  assert.equal(r.row.firstUserTextOk, null, 'no transcript: null');
  assert.equal(r.row.testsRunBeforeDone, null, 'no transcript: null');
  assert.equal(r.row.finalTextTail, '', 'no transcript: empty');
};
const holdout = { arm: 'holdout', steered: false };
const treated = { arm: 'treated', steered: true };

// [label, run options (arm among them), expected infra, extra checks]. Every default is a good run, so the one thing a case changes is
// the one thing it is about; the cases whose label says "before" hold two failures at once and pin which one wins.
const CASES = [
  ['(1) create_failed: docker made no container, however good the rest of the run looks', { noContainer: true }, 'create_failed', (r) => assert.equal(r.row.exit.oomKilled, null)],
  ['(1) inspect_failed: docker could not inspect the container', { docker: { inspect: { status: 1 } } }, 'inspect_failed', (r) => assert.equal(r.row.exit.oomKilled, null)],
  ['(1) rm_failed: docker could not remove the container', { docker: { rm: { status: 1 } } }, 'rm_failed'],
  ['(1) inspect_failed before rm_failed', { docker: { inspect: { status: 1 }, rm: { status: 1 } } }, 'inspect_failed'],
  ['(2) oom: OOM-killed although the run ended with status 0', { container: { oomKilled: true } }, 'oom', (r) => assert.deepEqual(r.row.exit, { code: 0, timedOut: false, oomKilled: true })],
  ['(2) oom whatever the exit status', { container: { oomKilled: true }, scenario: { exit: 3 } }, 'oom', (r) => assert.equal(r.row.exit.code, 3)],
  ['(1)/(2) R105: oom before rm_failed (a failed removal never hides an OOM kill)', { container: { oomKilled: true }, docker: { rm: { status: 1 } } }, 'oom', (r) => assert.equal(r.row.exit.oomKilled, true)],
  ['(1)/(2) R105: oom before rm_failed, with a non-zero exit too', { container: { oomKilled: true }, docker: { rm: { status: 1 } }, scenario: { exit: 137 } }, 'oom'],
  ['(1)/(2) R105: create_failed before everything (no container, nothing to inspect)', { noContainer: true, docker: { rm: { status: 1 } } }, 'create_failed'],
  ['(1)/(2) R105: an OOM kill docker could not report is inspect_failed (unknown is never "no OOM", and never "oom")', { container: { oomKilled: true }, docker: { inspect: { status: 1 } } }, 'inspect_failed', (r) => assert.equal(r.row.exit.oomKilled, null)],
  ['(2) before (3): oom before a missing transcript', { container: { oomKilled: true }, scenario: { transcript: false } }, 'oom'],
  ['(2) before (3): oom before an unreadable transcript', { container: { oomKilled: true }, scenario: { transcript: 'directory' } }, 'oom'],
  ['(2) before (3): oom before two transcripts', { container: { oomKilled: true }, scenario: { transcript: 'twice' } }, 'oom'],
  ['(3) transcript_unreadable: readRunUsage throws', { scenario: { transcript: 'directory' } }, 'transcript_unreadable', (r) => {
    assert.equal(r.row.usage, null, 'it returned nothing');
    noTranscript(null)(r);
    // R110: the cause of a caught error is kept, short, so that a deterministic bug does not show as the same bare label on every run.
    assert.equal(typeof r.row.infraDetail, 'string');
    assert.match(r.row.infraDetail, /EISDIR/);
    assert.ok(r.row.infraDetail.length <= 300);
  }],
  ['(3) no_transcript', { scenario: { transcript: false } }, 'no_transcript', noTranscript('no_transcript')],
  ['(3) ambiguous_transcript: two transcripts of one session', { scenario: { transcript: 'twice' } }, 'ambiguous_transcript', noTranscript('ambiguous_transcript')],
  // The review's P1: a claude that dies at startup writes neither a transcript nor a decision log, and the label that names the
  // cause is the transcript's (step 3), not the log's (step 5). Moving step 3 after step 5 must fail here.
  ['(3) before (5): no_transcript before no_log', { scenario: { transcript: false, decision: null } }, 'no_transcript', noTranscript('no_transcript')],
  ['(3) before (5): transcript_unreadable before no_log', { scenario: { transcript: 'directory', decision: null } }, 'transcript_unreadable'],
  ['(3) before (5): ambiguous_transcript before no_log', { scenario: { transcript: 'twice', decision: null } }, 'ambiguous_transcript'],
  ['(3) before (5): no_transcript before arm_mismatch', { scenario: { transcript: false, decision: holdout } }, 'no_transcript'],
  ['(3) before (5): transcript_unreadable before arm_mismatch', { scenario: { transcript: 'directory', decision: holdout } }, 'transcript_unreadable'],
  ['(4) api_error: an API-error record in the main transcript', { scenario: { apiError: true } }, 'api_error', (r) => assert.equal(r.row.usage.apiError, true)],
  ['(4) before (5): api_error before no_log', { scenario: { apiError: true, decision: null } }, 'api_error'],
  ['(5) no_log: the hook left no decision log', { scenario: { decision: null } }, 'no_log', (r) => assert.equal(r.row.decision, null)],
  ['(5) no_log: the log is named after another session', { scenario: { decisionSession: 'another-session' } }, 'no_log'],
  ['(5) no_log: the log is a symlink (never followed)', { scenario: { decisionLink: true } }, 'no_log'],
  ['(5) no_log: nothing in the log parses', { scenario: { decision: ['not json {', '{"turn_id":"t1"}'] } }, 'no_log'],
  ['(5) no_log: the only line has an arm that is neither treated nor holdout', { scenario: { decision: [{ arm: 'bogus', steered: true }] } }, 'no_log'],
  ['(5) arm_mismatch: B was held out', { scenario: { decision: holdout } }, 'arm_mismatch', (r) => assert.deepEqual(r.row.decision, holdout)],
  ['(5) arm_mismatch: B held out, steered true (the arm alone is wrong)', { scenario: { decision: { arm: 'holdout', steered: true } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: B treated, steered the number 1 (strictly true)', { scenario: { decision: { arm: 'treated', steered: 1 } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: A treated, steered false (the arm alone is wrong)', { arm: 'A', scenario: { decision: { arm: 'treated', steered: false } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: C treated, steered false (the arm alone is wrong)', { arm: 'C', scenario: { decision: { arm: 'treated', steered: false } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: A held out, steered the number 0 (strictly false)', { arm: 'A', scenario: { decision: { arm: 'holdout', steered: 0 } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: C held out, steered null', { arm: 'C', scenario: { decision: { arm: 'holdout', steered: null } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: B was treated but not steered (the hook said nothing)', { scenario: { decision: { arm: 'treated', steered: false } } }, 'arm_mismatch', (r) => assert.deepEqual(r.row.decision, { arm: 'treated', steered: false })],
  ['(5) arm_mismatch: B treated, steered missing', { scenario: { decision: { arm: 'treated' } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: B treated, steered the string "true"', { scenario: { decision: { arm: 'treated', steered: 'true' } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: A was treated', { arm: 'A', scenario: { decision: treated } }, 'arm_mismatch'],
  ['(5) arm_mismatch: A held out but steered', { arm: 'A', scenario: { decision: { arm: 'holdout', steered: true } } }, 'arm_mismatch'],
  ['(5) arm_mismatch: C was treated', { arm: 'C', scenario: { decision: treated } }, 'arm_mismatch'],
  ['(5) arm_mismatch: C held out, steered missing', { arm: 'C', scenario: { decision: { arm: 'holdout' } } }, 'arm_mismatch'],
  ['(5) the first line with a valid arm decides: a torn line and an unknown arm before it are skipped', { scenario: { decision: ['{"arm":', { arm: 'bogus' }, treated, holdout] } }, null, (r) => assert.deepEqual(r.row.decision, treated)],
  ['(6) effort_mismatch: the transcript records another effort', { scenario: { effort: 'medium' } }, 'effort_mismatch', (r) => assert.deepEqual(r.row.efforts, ['medium'])],
  ['(6) effort_mismatch: one record records none', { scenario: { bash: ['ls'], efforts: ['xhigh', null] } }, 'effort_mismatch', (r) => assert.deepEqual(r.row.efforts, ['xhigh', null])],
  ['(6) effort_mismatch: no record records an effort', { scenario: { effort: null } }, 'effort_mismatch', (r) => assert.deepEqual(r.row.efforts, [null])],
  ['(6) effort_mismatch: two efforts', { scenario: { bash: ['ls'], efforts: ['xhigh', 'high'] } }, 'effort_mismatch', (r) => assert.deepEqual(r.row.efforts, ['xhigh', 'high'])],
  ['(6) effort_mismatch: arm C ran at the effort of A', { arm: 'C', scenario: { effort: 'xhigh' } }, 'effort_mismatch'],
  ['(5) before (6): no_log before effort_mismatch', { scenario: { decision: null, effort: 'medium' } }, 'no_log'],
  ['(5) before (6): arm_mismatch before effort_mismatch', { scenario: { decision: holdout, effort: 'medium' } }, 'arm_mismatch'],
  ['(4) before (6): api_error before effort_mismatch', { scenario: { apiError: true, effort: 'medium' } }, 'api_error'],
  ['a subagent\'s API error is recorded, not infrastructure (the main agent saw it and went on)', { scenario: { subagents: [{ apiError: true }, {}] } }, null, (r) => {
    assert.equal(r.row.usage.subagentApiErrors, 1);
    assert.equal(r.row.usage.apiError, false);
  }],
  ['a subagent\'s effort is recorded, not guarded', { scenario: { subagents: [{ effort: 'low' }] } }, null, (r) => assert.deepEqual(r.row.usage.subagentEfforts, ['low'])],
];

await taIf('R87: runOne classifies in a fixed order, first match wins; every infrastructure value is a non-final row without a grade, and a good run after all of them is final and graded', NO_REFLINK_HERE, async () => {
  await inChunks(CASES, 8, async ([label, opts, infra, check]) => {
    const r = await go(node, mkRun(node, opts.arm ?? 'B'), opts);
    if (infra === null) {
      assert.equal(r.row.infra, null, label);
      assert.equal(r.row.final, true, label);
      assert.equal(r.seam.calls.length, 1, `${label}: graded`);
    } else {
      assertInfra(r, infra, label);
    }
    assertCleaned(r, label);
    // R110: only a row a caught error made infrastructure carries infraDetail (here: the unreadable transcript).
    assert.equal('infraDetail' in r.row, infra === 'transcript_unreadable', `${label}: infraDetail`);
    check?.(r);
  });
});

// ---- R90: a timed-out run is not graded; R87 puts every infrastructure step before the timeout ----

await taIf('R90: a run that hits the wall clock is a FINAL model failure with no grade, whatever its tree would score; every infrastructure step of R87 comes before it', NO_REFLINK_HERE, async () => {
  const cases = [
    ['a timeout and nothing else', {}, null],
    ['timeout and oom', { container: { oomKilled: true } }, 'oom'],
    ['timeout and rm_failed', { docker: { rm: { status: 1 } } }, 'rm_failed'],
    ['timeout and no transcript', { scenario: { transcript: false } }, 'no_transcript'],
    ['timeout and an API error', { scenario: { apiError: true } }, 'api_error'],
    ['timeout and no decision log', { scenario: { decision: null } }, 'no_log'],
    ['timeout and an arm mismatch', { scenario: { decision: holdout } }, 'arm_mismatch'],
    ['timeout and an effort mismatch', { scenario: { effort: 'medium' } }, 'effort_mismatch'],
  ];
  await inChunks(cases, 8, async ([label, extra, infra]) => {
    // The fake container sleeps for 20 s after the fake claude is done; SHORT gives it 3 s, and docker kills it.
    const r = await go(node, mkRun(node), { prereg: SHORT, runCfg: { sleepMs: 20_000 }, ...extra });
    assert.equal(r.row.exit.timedOut, true, label);
    assert.equal(r.row.exit.code, 137, `${label}: killed`);
    assert.ok(r.f.calls().some((c) => c.argv[0] === 'kill'), `${label}: our container was killed by docker`);
    assert.ok(r.row.wallMs >= 2900 && r.row.wallMs < 4200, `${label}: it took the 3 s of the limit (within 1.2 s after it), not the 20 s of the sleep: ${r.row.wallMs}`);
    assertCleaned(r, label);
    if (infra !== null) {
      assertInfra(r, infra, label);
      return;
    }
    assert.equal(r.row.infra, null, label);
    assert.equal(r.row.final, true, label);
    assert.equal(r.row.grade, null, `${label}: a timed-out run is not graded...`);
    assert.equal(r.seam.calls.length, 0, `${label}: ...although the seam would have passed it`);
    assert.deepEqual(r.row.exit, { code: 137, timedOut: true, oomKilled: false });
    assert.deepEqual(r.row.decision, treated, 'the evidence is still recorded');
    assert.equal(r.row.usage.main.messages, 1);
    assert.equal(r.row.firstUserTextOk, true);
  });
});

await taIf('R90: the agent container\'s wall clock is prereg.limits.timeoutMinutes * 60 000 ms, pinned at two limits (3 s and 6 s): it is killed within 1.2 s after each, so no other scale passes', NO_REFLINK_HERE, async () => {
  const points = [[SHORT, 3000], [SHORT2, 6000]];
  const runs = await Promise.all(points.map(([prereg, limitMs]) => go(node, mkRun(node), { prereg, runCfg: { sleepMs: 40_000 } }).then((r) => [r, limitMs])));
  for (const [r, limitMs] of runs) {
    assert.equal(r.row.exit.timedOut, true, `${limitMs} ms`);
    // The container is killed when the limit is up (a run took limit + 0.1 s, measured), not before, and not a 1.5x limit later.
    assert.ok(r.row.wallMs >= limitMs - 100 && r.row.wallMs < limitMs + 1200, `limit ${limitMs} ms: the run took ${r.row.wallMs} ms`);
  }
  assert.ok(runs[1][0].row.wallMs - runs[0][0].row.wallMs > 2000, 'doubling the limit doubles the wait');
});

await taIf('a fresh session id per attempt: two runs, and attempts 1 and 2 of one run, have different ids, each the --session-id its own container was given', NO_REFLINK_HERE, async () => {
  const run = mkRun(node);
  const first = await go(node, run, { attempt: 1 });
  const second = await go(node, run, { attempt: 2 });
  const other = await go(node, mkRun(node), {});
  const ids = [first, second, other].map((r) => r.row.sessionId);
  assert.equal(new Set(ids).size, 3, `three runs, three session ids: ${ids.join(' ')}`);
  for (const r of [first, second, other]) {
    assert.match(r.row.sessionId, UUID_RE);
    assert.equal(flagValue(commandOf(agentCall(r.f), node), '--session-id'), r.row.sessionId, 'the row names the session its own container ran');
    assert.ok(existsSync(path.join(r.runDir, 'config', 'projects', '-work', `${r.row.sessionId}.jsonl`)), 'and that is the transcript on disk');
  }
  assert.notEqual(first.runDir, second.runDir);
  assert.equal(first.row.runId, second.row.runId);
});

await taIf('R90 with R101: a timed-out run does not reach the hidden check (it is not graded), and a run that did reach it with a changed hidden dir is hidden_changed', NO_REFLINK_HERE, async () => {
  const sc = buildScene('node');
  const hiddenFile = path.join(sc.taskDir, 'hidden', 'tests', 'hidden.test.mjs');
  const original = readFileSync(hiddenFile);
  writeFileSync(hiddenFile, Buffer.concat([original, Buffer.from('// changed\n')]));
  const timedOut = await go(sc, mkRun(sc), { prereg: SHORT, runCfg: { sleepMs: 20_000 } });
  assert.equal(timedOut.row.infra, null, 'the timeout wins over the hidden check');
  assert.equal(timedOut.row.final, true);
  assert.equal(timedOut.row.grade, null);

  const changed = await go(sc, mkRun(sc), {});
  assertInfra(changed, 'hidden_changed');
  assert.ok(!('infraDetail' in changed.row), 'a hash that differs is no caught error: no infraDetail (R110)');
  assert.ok(agentCall(changed.f), 'the container did run: the check is after it, before the grade');
  assertCleaned(changed, 'hidden_changed');
  // A hidden dir that has an extra file, a missing file or is gone is changed too.
  writeFileSync(hiddenFile, original);
  writeFileSync(path.join(sc.taskDir, 'hidden', 'extra.txt'), 'x');
  assertInfra(await go(sc, mkRun(sc), {}), 'hidden_changed', 'an extra file');
  rmSync(path.join(sc.taskDir, 'hidden', 'extra.txt'));
  rmSync(hiddenFile);
  assertInfra(await go(sc, mkRun(sc), {}), 'hidden_changed', 'a missing file');
  rmSync(path.join(sc.taskDir, 'hidden'), { recursive: true });
  const gone = await go(sc, mkRun(sc), {});
  assertInfra(gone, 'hidden_changed', 'no hidden dir');
  assert.match(gone.row.infraDetail, /ENOENT/, 'a hidden dir that cannot be hashed says why (R110)');
  // Restored, it is graded again.
  mkdirSync(path.dirname(hiddenFile), { recursive: true });
  writeFileSync(hiddenFile, original);
  const ok = await go(sc, mkRun(sc), {});
  assert.equal(ok.row.infra, null);
  assert.equal(ok.seam.calls.length, 1);

  // R109: the per-run check reads hidden/ and nothing else. A byte of tasks/<id>/tree changed after the build, and an entry in it that
  // hashBuiltTask could not even walk (a FIFO), are the preflight's business, not a changed hidden dir.
  const treeFile = path.join(sc.taskDir, 'tree', 'lib.mjs');
  const treeBytes = readFileSync(treeFile);
  writeFileSync(treeFile, Buffer.concat([treeBytes, Buffer.from('// changed after the build\n')]));
  const treeChanged = await go(sc, mkRun(sc), {});
  assert.equal(treeChanged.row.infra, null, 'one byte of tree/ is no hidden_changed');
  assert.equal(treeChanged.seam.calls.length, 1);
  writeFileSync(treeFile, treeBytes);
  const fifo = path.join(sc.taskDir, 'tree', 'a-fifo');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  const withFifo = await go(sc, mkRun(sc), {});
  assert.equal(withFifo.row.infra, null, 'a tree/ that hashBuiltTask cannot walk is no hidden_changed either');
  assert.equal(withFifo.seam.calls.length, 1);
  rmSync(fifo);

  // The effort mismatch comes before the hidden check (R87: 6 before 8).
  writeFileSync(hiddenFile, Buffer.concat([original, Buffer.from('x')]));
  assertInfra(await go(sc, mkRun(sc), { scenario: { effort: 'medium' } }), 'effort_mismatch');
});

// ---- the grade: R87 step 8 ----

await taIf('R87 step 8: a run is graded once on its own tree; a grade with an infra of its own is re-graded on the SAME tree at most twice; a throw or a result that is no grade is grade_failed; a model failure is a final row', NO_REFLINK_HERE, async () => {
  const scenario = { edit: { 'edited.txt': 'agent edit\n' } };
  const failing = gradeWith({ pass: false, f2p: { passed: [], failed: ['plus'], notRun: [] } });
  const f = await go(node, mkRun(node), { scenario, grade: [failing] });
  assert.equal(f.row.infra, null, 'a failing grade is the model\'s');
  assert.equal(f.row.final, true);
  assert.deepEqual(f.row.grade, failing);
  assert.equal(f.seam.calls.length, 1);

  // infra, then a grade: two calls, the second one stands; the same tree each time, and a grade id per call.
  const second = await go(node, mkRun(node), { scenario, grade: [infraGrade('oom'), OK_GRADE] });
  assert.equal(second.row.infra, null);
  assert.equal(second.row.final, true);
  assert.deepEqual(second.row.grade, OK_GRADE, 'the grade that stood');
  assert.equal(second.seam.calls.length, 2);
  assert.deepEqual(second.seam.calls.map((c) => c.options.runId), [`${second.row.runId}-a1-g1`, `${second.row.runId}-a1-g2`]);
  assert.ok(second.seam.calls.every((c) => c.treeDir === path.join(second.runDir, 'work') && c.exists && c.edited === 'agent edit\n'), 'the same agent tree, intact');

  // infra every time: the original grade and two re-grades, then the row is infra grade_<the last infra>.
  const never = await go(node, mkRun(node), { scenario, grade: [infraGrade('oom'), infraGrade('inspect_failed'), infraGrade('rm_failed'), OK_GRADE] });
  assertInfra({ ...never, seam: { calls: [] } }, 'grade_rm_failed');
  assert.equal(never.seam.calls.length, 3, 'a grade and at most two re-grades; the fourth answer is never asked for');
  assert.deepEqual(never.seam.calls.map((c) => c.options.runId), [`${never.row.runId}-a1-g1`, `${never.row.runId}-a1-g2`, `${never.row.runId}-a1-g3`]);
  assertCleaned(never, 'grade infra');

  // a gradeTree rejection is infrastructure and is not re-run here; nor is anything else that is not a grade.
  const thrown = await go(node, mkRun(node), { grade: [new Error('the grade directory already exists')] });
  assertInfra({ ...thrown, seam: { calls: [] } }, 'grade_failed');
  assert.equal(thrown.seam.calls.length, 1, 'a throw is not re-graded');
  // R110: what a caught error said is kept in infraDetail, redacted and at most 300 characters; no other row has the field.
  assert.equal(thrown.row.infraDetail, 'the grade directory already exists');
  const long = await go(node, mkRun(node), { grade: [new Error(`prefix ${SENTINEL} ${'x'.repeat(600)}`)] });
  assert.equal(long.row.infraDetail.length, 300, 'cut at 300 characters');
  assert.ok(long.row.infraDetail.startsWith('prefix [REDACTED] xxx'), 'the token redacted');
  // The token is redacted BEFORE the cut: a token that straddles character 300 must not leave its first characters behind.
  const straddle = await go(node, mkRun(node), { grade: [new Error(`${'y'.repeat(295)}${SENTINEL}`)] });
  assert.equal(straddle.row.infraDetail, `${'y'.repeat(295)}[REDA`, 'redacted, then cut');
  assert.ok(!straddle.row.infraDetail.includes(SENTINEL.slice(0, 4)), 'no first characters of the token survive the cut');
  const late = await go(node, mkRun(node), { grade: [infraGrade('oom'), new Error('boom')] });
  assert.equal(late.row.infra, 'grade_failed', 'a throw on a re-grade');
  assert.equal(late.row.infraDetail, 'boom');
  assert.equal(late.seam.calls.length, 2);
  const noDetail = await go(node, mkRun(node), { grade: [infraGrade('oom')] });
  assert.equal(noDetail.row.infra, 'grade_oom');
  assert.ok(!('infraDetail' in noDetail.row), 'a grade that ended in infrastructure of its own is no caught error');
  for (const [label, bad] of [['undefined', undefined], ['a string', 'pass'], ['null', null], ['no infra key', { pass: true }], ['pass not a boolean', gradeWith({ pass: 'yes' })], ['infra undefined', gradeWith({ infra: undefined })], ['infra an empty string', gradeWith({ infra: '' })], ['infra a number', gradeWith({ infra: 3 })]]) {
    const r = await go(node, mkRun(node), { grade: [bad] });
    assert.equal(r.row.infra, 'grade_failed', label);
    assert.equal(typeof r.row.infraDetail, 'string', `${label}: a result that is no grade says so`);
    assert.equal(r.row.final, false, label);
    assert.equal(r.row.grade, null, label);
    assert.equal(r.seam.calls.length, 1, label);
  }
});

// ---- R88: cost and turns from the JSON on stdout ----

await taIf('R88: costUsd and numTurns come from the JSON object on stdout, is_error is recorded, and anything else is null and never infrastructure', NO_REFLINK_HERE, async () => {
  const cases = [
    ['a result object', '{"type":"result","total_cost_usd":1.5,"num_turns":4,"is_error":true}\n', { costUsd: 1.5, numTurns: 4, isError: true }],
    ['zeros are values, not missing', ' \n{"total_cost_usd":0,"num_turns":0,"is_error":false}  ', { costUsd: 0, numTurns: 0, isError: false }],
    ['fields missing', '{"type":"result"}', { costUsd: null, numTurns: null, isError: null }],
    ['not JSON', 'Claude Code crashed: out of memory', { costUsd: null, numTurns: null, isError: null }],
    ['empty', '', { costUsd: null, numTurns: null, isError: null }],
    ['an array', '[{"total_cost_usd":1,"num_turns":2}]', { costUsd: null, numTurns: null, isError: null }],
    ['null', 'null', { costUsd: null, numTurns: null, isError: null }],
    ['a number', '12', { costUsd: null, numTurns: null, isError: null }],
    ['two objects', '{"total_cost_usd":1,"num_turns":2}\n{"total_cost_usd":1,"num_turns":2}', { costUsd: null, numTurns: null, isError: null }],
    ['an object and trailing text', '{"total_cost_usd":1,"num_turns":2}\nwarning: x', { costUsd: null, numTurns: null, isError: null }],
    ['strings are not numbers', '{"total_cost_usd":"1.5","num_turns":"4","is_error":"true"}', { costUsd: null, numTurns: null, isError: null }],
    ['a negative cost and a fractional turn count', '{"total_cost_usd":-1,"num_turns":2.5}', { costUsd: null, numTurns: null, isError: null }],
    ['a cost that is not finite', '{"total_cost_usd":1e999,"num_turns":3}', { costUsd: null, numTurns: 3, isError: null }],
  ];
  await inChunks(cases, 8, async ([label, stdoutRaw, expected]) => {
    const r = await go(node, mkRun(node), { scenario: { stdoutRaw } });
    assert.equal(r.row.infra, null, `${label}: never infrastructure`);
    assert.equal(r.row.final, true, label);
    assert.equal(r.seam.calls.length, 1, `${label}: graded all the same`);
    assert.deepEqual({ costUsd: r.row.costUsd, numTurns: r.row.numTurns, isError: r.row.isError }, expected, label);
  });
});

// ---- R99: the first user message is the prompt ----

await taIf('R99: firstUserTextOk compares the transcript\'s first user message with the prompt after trimEnd on both sides; null without a transcript', NO_REFLINK_HERE, async () => {
  const cases = [
    ['the prompt itself', undefined, true],
    ['without its trailing newline', PROMPT.trimEnd(), true],
    ['with more trailing whitespace', `${PROMPT}\n\n \t`, true],
    ['another prompt', 'Fix add.', false],
    ['a leading space: only the end is trimmed', ` ${PROMPT}`, false],
    ['LF where the prompt has CRLF', PROMPT.replace('\r\n', '\n'), false],
    ['one character off', PROMPT.replace('add', 'ad'), false],
    ['no first user message at all', null, false],
  ];
  await inChunks(cases, 8, async ([label, firstUser, expected]) => {
    const r = await go(node, mkRun(node), { scenario: firstUser === undefined ? {} : { firstUser } });
    assert.equal(r.row.firstUserTextOk, expected, label);
    assert.equal(r.row.infra, null, `${label}: a different first message is recorded, not infrastructure`);
  });
});

await taIf('testsRunBeforeDone uses the task definition\'s testPatterns, finalTextTail the last 300 characters of the final text; a transcript that is missing gives null and an empty string', NO_REFLINK_HERE, async () => {
  const flag = async (scene, bash) => (await go(scene, mkRun(scene), { scenario: { bash } })).row.testsRunBeforeDone;
  assert.equal(await flag(node, ['node tests/visible.test.mjs']), true);
  assert.equal(await flag(node, ['ls -la']), false, 'a Bash call that is no test run');
  assert.equal(await flag(node, []), false, 'no Bash call');
  assert.equal(await flag(cargo, ['node tests/visible.test.mjs']), false, 'the patterns are this task\'s: cargo test, not node tests/');
  assert.equal(await flag(cargo, ['cargo test --no-fail-fast']), true);
  const short = await go(node, mkRun(node), { scenario: { finalText: 'All done.' } });
  assert.equal(short.row.finalTextTail, 'All done.');
  const none = await go(node, mkRun(node), { scenario: { transcript: false } });
  assert.equal(none.row.testsRunBeforeDone, null);
  assert.equal(none.row.finalTextTail, '');
});

// ---- the run directory: what is kept, what is removed, and on which path ----

await taIf('the run directory: work and target are removed after every run (config and state kept), keepRunDirs keeps all four, and the tasks/<id>/ directory is never written: the agent edited copies', NO_REFLINK_HERE, async () => {
  const before = snapshot(cargo.taskDir);
  const scenario = { edit: { 'edited.txt': 'agent edit\n', 'src/lib.rs': 'pub fn add() {}\n' }, editTarget: { 'debug/agent.o': 'obj\n' } };
  const r = await go(cargo, mkRun(cargo), { scenario });
  assert.equal(r.row.infra, null);
  assertCleaned(r, 'a good run');
  assert.ok(existsSync(path.join(r.runDir, 'config', 'projects', '-work', `${r.row.sessionId}.jsonl`)), 'the transcript is the evidence and stays');
  assert.ok(existsSync(path.join(r.runDir, 'state', 'effort-steering', `${r.row.sessionId}.jsonl`)), 'so does the decision log');
  // While the grade ran, the work tree was the agent's, the target the warm one plus the agent's build, both copies.
  const [g] = r.seam.calls;
  assert.equal(g.edited, 'agent edit\n');
  assert.equal(g.targetEdited, 'obj\n');
  assert.equal(g.targetWarm, 'warm artifact\n', 'the copy of the warm target');
  // And nothing under tasks/<id>/ changed: not a byte, not a mode, not a time.
  assert.deepEqual(snapshot(cargo.taskDir), before);
  assert.deepEqual(hashBuiltTask(cargo.taskDir), { treeHash: cargo.manifest.treeHash, hiddenHash: cargo.manifest.hiddenHash, promptHash: cargo.manifest.promptHash });
  assert.ok(!existsSync(path.join(cargo.taskDir, 'tree', 'edited.txt')) && !existsSync(path.join(cargo.taskDir, 'target', 'debug', 'agent.o')));

  const kept = await go(cargo, mkRun(cargo), { scenario, ctx: { keepRunDirs: true } });
  assert.deepEqual(readdirSync(kept.runDir).sort(), ['config', 'state', 'target', 'work']);
  assert.equal(readFileSync(path.join(kept.runDir, 'work', 'edited.txt'), 'utf8'), 'agent edit\n');
  assert.equal(readFileSync(path.join(kept.runDir, 'target', 'debug', 'agent.o'), 'utf8'), 'obj\n');
  assert.equal(readFileSync(path.join(kept.runDir, 'target', 'debug', 'warm.o'), 'utf8'), 'warm artifact\n', 'the target is a copy of the warm one');
  assert.deepEqual(walkFiles(path.join(kept.runDir, 'work')), [...walkFiles(path.join(cargo.taskDir, 'tree')), 'edited.txt'].sort(), 'the work is a copy of the tree');
  assert.deepEqual(snapshot(cargo.taskDir), before, 'still nothing under tasks/<id>/');
  const notKept = await go(cargo, mkRun(cargo), { scenario, ctx: { keepRunDirs: false } });
  assertCleaned(notKept, 'keepRunDirs false');
});

await taIf('a throw cleans up too: when docker cannot start, the copies and the run directory are gone (the container never ran, so there is no evidence), and keepRunDirs keeps them', NO_REFLINK_HERE, async () => {
  for (const scene of [node, cargo]) {
    const p = prepare(scene, mkRun(scene), { ctx: { dockerBin: path.join(ROOT, 'no-such-docker') } });
    const err = await p.exec().then(() => null, (e) => e);
    assert.ok(err instanceof Error, 'it throws: there is no row for a run that never started');
    assert.match(err.message, /could not start/);
    assert.ok(!existsSync(p.runDir), `${scene.kind}: no run directory is left`);
    assert.ok(!existsSync(scene.runsDir) || !readdirSync(scene.runsDir).includes(path.basename(p.runDir)));
  }
  const p = prepare(cargo, mkRun(cargo), { ctx: { dockerBin: path.join(ROOT, 'no-such-docker'), keepRunDirs: true } });
  await assert.rejects(p.exec(), /could not start/);
  assert.deepEqual(readdirSync(p.runDir).sort(), ['config', 'state', 'target', 'work'], 'keepRunDirs keeps what there is');
  // A retry of the same attempt after the throw is possible: the run directory is free again.
  const q = prepare(cargo, mkRun(cargo), { ctx: { dockerBin: path.join(ROOT, 'no-such-docker') } });
  await assert.rejects(q.exec(), /could not start/);
  await assert.rejects(q.exec(), /could not start/, 'not "already exists"');
});

await taIf('a directory that cannot be removed is reported as the Row\'s leftover, and the row is still returned', NO_REFLINK_HERE, async () => {
  const run = mkRun(cargo);
  const runDir = path.join(cargo.runsDir, `${run.runId}-a1`);
  let r;
  try {
    // While the grade runs the run directory becomes read-only: neither copy can be unlinked from it, chmod -R of the copy does not help.
    r = await go(cargo, run, { grade: () => { chmodSync(runDir, 0o555); return OK_GRADE; } });
  } finally {
    if (existsSync(runDir)) chmodSync(runDir, 0o755);
  }
  assert.equal(r.row.infra, null, 'the result stands');
  assert.deepEqual(r.row.leftover, [path.join(runDir, 'work'), path.join(runDir, 'target')]);
  assert.ok(existsSync(path.join(runDir, 'work')) && existsSync(path.join(runDir, 'target')));
  rmSync(runDir, { recursive: true });
});

// ---- the defaults of ctx, and the real grader behind the fake docker ----

await taIf('ctx defaults: the Claude binary is <HOME>/.local/share/claude/versions/<prereg.cli.version> (R75), the image is IMAGE_FOR_REPO[repo] and ctx.images overrides it', NO_REFLINK_HERE, async () => {
  const home = mkdtempSync(path.join(ROOT, 'home-'));
  const bin = path.join(home, '.local', 'share', 'claude', 'versions', '2.1.292');
  mkdirSync(path.dirname(bin), { recursive: true });
  symlinkSync(FAKE_CLAUDE, bin);
  const r = await withEnv({ HOME: home }, () => go(node, mkRun(node), { ctx: { claudeBin: undefined } }));
  assert.equal(r.row.infra, null);
  assert.deepEqual(mountsOf(agentCall(r.f).argv).at(-1), { source: bin, target: '/opt/claude/claude', readOnly: true });
  // Another version in the registration is another file.
  const other = deepFreeze({ ...PREREG, cli: { ...PREREG.cli, version: '9.9.9' } });
  await refused(node, mkRun(node), { prereg: other, ctx: { claudeBin: undefined } }, /9\.9\.9|claudeBin/, 'the version of the registration names the file');

  assert.equal(agentCall(r.f).argv.includes('s5/plugins'), true, 'IMAGE_FOR_REPO[claude-plugins]');
  assert.deepEqual(r.seam.calls[0].options.image, 's5/plugins');
  const own = await go(node, mkRun(node), { ctx: { images: { 'claude-plugins': 'my/own-image:1' } } });
  assert.ok(agentCall(own.f).argv.includes('my/own-image:1') && !agentCall(own.f).argv.includes('s5/plugins'));
  assert.equal(own.seam.calls[0].options.image, 'my/own-image:1', 'the grade runs in the same image');
});

// The real gradeTree behind the fake docker: it is handed the agent's tree, the image, the limits and its own run id, and its own
// container is a second `docker run`.
await taIf('runOne\'s default grade is gradeTree: it grades the agent\'s tree in its own container, with the run\'s limits and a grade id of its own', NO_REFLINK_HERE, async () => {
  const run = mkRun(cargo);
  const gradeName = `s5-grade-${run.runId}-a1-g1`;
  const GRADE_FILES = {
    'diff.status': '0\n',
    'diff.txt': ' 1 file changed, 1 insertion(+), 1 deletion(-)\n',
    'graft.status': '0\n',
    'build.status': '0\n',
    'build.out': '    Finished `test` profile\n',
    'f2p.status': '0\n',
    'f2p.out': 'running 1 test\ntest add_works ... ok\n',
    'p2p.status': '0\n',
    'p2p.out': 'running 1 test\ntest existing_passes ... ok\n',
    done: 'done\n',
  };
  const p = prepare(cargo, run, {
    docker: { containers: [containerOf(`s5-${run.runId}-a1`), { id: GRADE_ID, name: gradeName, labels: { s5: '1', 's5.run': gradeName }, oomKilled: false }] },
    runCfg: { exec: undefined, calls: [{ exec: { env: { FAKE_CLAUDE: '{}' } } }, { results: GRADE_FILES }] },
    ctx: {},
  });
  delete p.ctx.grade; // the default: gradeTree
  const row = await runOne(run, p.ctx);
  assert.equal(row.infra, null, JSON.stringify(row.grade));
  assert.equal(row.grade.pass, true);
  assert.equal(row.grade.infra, null);
  assert.deepEqual(row.grade.diff, { files: 1, insertions: 1, deletions: 1 });
  const runs = p.f.calls().filter((c) => c.argv[0] === 'run');
  assert.equal(runs.length, 2, 'the agent\'s container and the grade\'s');
  const grade = runs[1].argv;
  assert.equal(flagValue(grade, '--name'), gradeName);
  assert.equal(flagValue(grade, '--network'), 'none');
  assert.equal(flagValue(grade, '--cpus'), '4');
  assert.equal(flagValue(grade, '--memory'), '16g');
  assert.equal(flagValue(grade, '--user'), 'agent');
  assert.ok(grade.includes('s5/codescout'));
  assert.deepEqual(mountsOf(grade).find((m) => m.target === '/hidden'), { source: path.join(cargo.taskDir, 'hidden'), target: '/hidden', readOnly: true });
  assert.ok(!existsSync(path.join(cargo.workRoot, 'grades')) || readdirSync(path.join(cargo.workRoot, 'grades')).length === 0, 'the grade directory is gone');
  assert.deepEqual(readdirSync(path.join(cargo.runsDir, `${run.runId}-a1`)).sort(), ['config', 'state']);
});

// =====================================================================================================================
// real Docker (S5_DOCKER_TESTS=1): the real agent container and the real grade container, with a shell script for the Claude binary
// =====================================================================================================================

if (process.env.S5_DOCKER_TESTS !== '1') {
  console.log('skip - the runOne test against real Docker needs S5_DOCKER_TESTS=1');
} else if (NO_REFLINK_HERE) {
  console.log(`not ok - the runOne test against real Docker needs a reflink filesystem: ${NO_REFLINK_HERE}`);
  process.exitCode = 1;
} else {
  await dockerTest();
}

async function dockerTest() {
  // What the "claude binary" does, as the real `agent` user in the real container: it writes what claude writes (a transcript, the
  // hook's decision log, a JSON result), edits a file in /work, and records what it can see (user, directory, which mounts are
  // writable, which variables are set) in $XDG_STATE_HOME/probe.txt. It starts no model.
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
{
  echo "user=$(id -un)"
  echo "pwd=$(pwd)"
  echo "rate=$EFFORT_STEERING_HOLDOUT_RATE"
  echo "config=$CLAUDE_CONFIG_DIR"
  echo "state=$XDG_STATE_HOME"
  (echo x > /work/probe-rw) 2>/dev/null && echo work=rw || echo work=ro
  rm -f /work/probe-rw
  (touch /opt/es/probe) 2>/dev/null && echo es=rw || echo es=ro
  (echo x >> /opt/claude/claude) 2>/dev/null && echo claude=rw || echo claude=ro
  if [ -d /cargo ]; then (touch /cargo/probe) 2>/dev/null && echo cargo=rw || echo cargo=ro; else echo cargo=absent; fi
  if [ -e /target ]; then echo target=present; else echo target=absent; fi
  echo "settings=$(grep -c UserPromptSubmit /opt/es/settings.json)"
  echo "hook=$(ls /opt/es | tr '\n' ' ' | sed 's/ *$//')"
  if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then echo token=set; else echo token=unset; fi
  if [ -n "$HTTPS_PROXY" ]; then echo proxy=set; else echo proxy=unset; fi
} > "$XDG_STATE_HOME/probe.txt"
# What the env command would have printed: a file the host must find scrubbed afterwards (R108).
printf '%s\n' "$CLAUDE_CODE_OAUTH_TOKEN" > "$XDG_STATE_HOME/leak.txt"
printf '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.25,"session_id":"%s","result":"Fixed it."}\n' "$sid"
`;
  const id = `t10b-${process.pid}-plus`;
  const sc = buildScene('node', { id });
  mkdirSync(path.join(sc.workRoot, 'cargo-home')); // mounted read-only at /cargo
  const script = path.join(sc.workRoot, 'claude.sh');
  writeFileSync(script, CLAUDE_SH);
  chmodSync(script, 0o755);
  const containersOfTask = () => {
    const r = spawnSync('docker', ['ps', '-aq', '--filter', `label=s5.task=${id}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const probeOf = (runDir) => Object.fromEntries(readFileSync(path.join(runDir, 'state', 'probe.txt'), 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const ctx = { prereg: PREREG, workRoot: sc.workRoot, hookCopy: sc.hook, claudeBin: script, attempt: 1, network: 'none', proxyUrl: null };
  const before = snapshot(sc.taskDir);

  await ta('docker: a B run and an A run through the real agent container and the real grade container: container paths, the agent user\'s write access, the read-only mounts, the env, and a grade that passes', async () => {
    for (const arm of ['B', 'A']) {
      const run = mkRun(sc, arm);
      const row = await runOne(run, ctx);
      assert.ok(!JSON.stringify(row).includes(SENTINEL));
      assert.equal(row.infra, null, JSON.stringify(row, null, 1));
      assert.equal(row.final, true);
      assert.deepEqual(row.exit, { code: 0, timedOut: false, oomKilled: false });
      assert.deepEqual(row.decision, arm === 'B' ? treated : holdout, 'the env reached the container: the rate decided the arm');
      assert.deepEqual(row.efforts, ['xhigh']);
      assert.equal(row.costUsd, 0.25);
      assert.equal(row.numTurns, 3);
      assert.equal(row.isError, false);
      assert.equal(row.firstUserTextOk, true, 'the prompt arrived as one argument, byte for byte');
      assert.equal(row.finalTextTail, 'Fixed it.');
      assert.equal(row.usage.transcriptPath, `config/projects/-work/${row.sessionId}.jsonl`);
      assert.equal(row.usage.main.thinking, 7);
      assert.equal(row.grade.infra, null, JSON.stringify(row.grade));
      assert.equal(row.grade.pass, true, 'the real grader passed the tree the "agent" edited in /work');
      assert.deepEqual(row.grade.f2p, { passed: ['plus'], failed: [], notRun: [] });

      const runDir = path.join(sc.workRoot, 'runs', `${run.runId}-a1`);
      assert.deepEqual(readdirSync(runDir).sort(), ['config', 'state'], 'work is removed');
      assert.equal(row.tokenScrubbed, 1, 'the one file the container made with the token in it was scrubbed on the host');
      assert.equal(readFileSync(path.join(runDir, 'state', 'leak.txt'), 'utf8'), '[REDACTED]\n');
      assert.deepEqual(probeOf(runDir), {
        user: 'agent',
        pwd: '/work',
        rate: arm === 'B' ? '0' : '1',
        config: '/run/config',
        state: '/run/state',
        work: 'rw',
        es: 'ro',
        claude: 'ro',
        cargo: 'ro',
        target: 'absent',
        settings: '1',
        hook: 'adapter bin core settings.json',
        token: 'set',
        proxy: 'unset',
      });
    }
    assert.deepEqual(snapshot(sc.taskDir), before, 'nothing under tasks/<id>/ moved');
    assert.equal(containersOfTask(), '', 'no container of this task is left, the agent\'s or the grader\'s');
    assert.ok(!existsSync(path.join(sc.workRoot, 'grades')) || readdirSync(path.join(sc.workRoot, 'grades')).length === 0, 'no grade directory is left');
  });
}
