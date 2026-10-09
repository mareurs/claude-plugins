// run.test.mjs — the S5 batch runner: planRunsS5 (Task 10a, rulings R2, R59, R84, R86).
//
// Every plan is compared with an ORACLE written here from makeRng alone (a Fisher-Yates written out, a plan built by
// sorting instead of by looping), and one vector is pinned as literal run ids, computed once from the same definition
// with a stand-alone script. A decision of R84 that flips (the stream, the offset of taskIndex, the Fisher-Yates index,
// the arm order before the shuffle, the round, the runId, the filter, a mode's refusal) must fail a test below.
//
// The preregistration objects are plain data of the loaders' shape and frozen at every depth, as the loaders return
// them: a planner that wrote to one would throw here. One test builds its object with the real loadS5Config.
// Fixtures live under one mkdtemp directory in os.tmpdir(), removed on process exit.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from '../../core/testkit.mjs';
import { makeRng } from '../s4-prng.mjs';
import { RUN_ID_RE } from './grade.mjs';
import { loadS5Config } from './prereg.mjs';
import { planRunsS5 } from './run.mjs';
import { TASK_ID_RE } from './task-def.mjs';

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
