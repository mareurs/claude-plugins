// analyze.test.mjs — the S5 analysis (Task 9, rulings R3, R62, R63, R64, R68, R69, R70, R71, R72).
//
// The verdict this module computes IS the experiment's result, so each decision in it has a test that fails when the
// decision flips (the diff directions, task means against pooled runs, the quantile index, the strict comparisons in
// verdict, the infra/final filter, the t quantile, the RNG stream, the mechanism's field mapping and population,
// pass^3's n >= 3 rule, simulate's clamping). Every flip was tried on a scratch copy; see the task report.
//
// Fixtures follow Task 10's Row verbatim (ruling R3): { runId, taskId, taskIndex, arm, effort, rep, round, sessionId,
// startedAt, wallMs, exit, infra, final, decision, usage, efforts, costUsd, numTurns, firstUserTextOk,
// testsRunBeforeDone, finalTextTail, grade }, with `usage` shaped as usage.mjs returns it and `exit.timedOut` a boolean.
// Expected numbers are written out by hand from the fixture, not read back from the module.

import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { analyzeArms } from '../s4-analyze.mjs';
import { makeRng, shuffle } from '../s4-prng.mjs';
import {
  ARMS,
  DEFAULT_METHOD,
  METHODS,
  analyzeS5,
  isCounted,
  isPass,
  mechanism,
  pairedLowerBound,
  perTaskScores,
  quantile1,
  secondaries,
  selectCalibrated,
  simulate,
  tQuantile,
  verdict,
} from './analyze.mjs';

const closeTo = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} is not within ${tol} of ${expected}`);

// ---- fixtures ----

let seq = 0;
const EFFORT = { A: 'xhigh', B: 'xhigh', C: 'low' };
const ZERO = { input_total: 0, cache_creation: 0, cache_read: 0, output: 0, thinking: 0, messages: 0, thinkingFieldMissing: 0 };
// One usage part as usage.mjs returns it.
const part = (o = {}) => ({
  input_total: o.input ?? 1000,
  cache_creation: o.cc ?? 100,
  cache_read: o.cr ?? 0,
  output: o.out ?? 1000,
  thinking: o.think ?? 500,
  messages: 3,
  thinkingFieldMissing: o.missing ?? 0,
});
const usageOf = (main = {}, total = main) => ({ main: part(main), subagents: { ...ZERO }, total: part(total) });

// One Row. Defaults: a counted passing run.
function row(o) {
  seq += 1;
  const arm = o.arm;
  return {
    runId: o.runId ?? `${o.task}-${arm}-${seq}`,
    taskId: o.task,
    taskIndex: o.index ?? (Number(o.task.slice(1)) || 0),
    arm,
    effort: EFFORT[arm] ?? 'low',
    rep: o.rep ?? 0,
    round: o.round ?? 0,
    sessionId: `session-${seq}`,
    startedAt: '2026-10-08T00:00:00.000Z',
    wallMs: 60000,
    exit: { code: o.timedOut ? null : 0, signal: o.timedOut ? 'SIGKILL' : null, timedOut: o.timedOut ?? false },
    infra: o.infra ?? null,
    final: o.final ?? true,
    decision: { steered: arm === 'B' },
    usage: o.usage ?? usageOf(o.main, o.total),
    efforts: [EFFORT[arm] ?? 'low'],
    costUsd: o.cost === undefined ? 1 : o.cost,
    numTurns: 5,
    firstUserTextOk: true,
    testsRunBeforeDone: o.tests === undefined ? true : o.tests,
    finalTextTail: '',
    grade: o.grade === undefined ? { pass: o.pass ?? true } : o.grade,
  };
}
// '1' passes, '0' fails: runs('t0', 'A', '110') is three counted rows.
const runs = (task, arm, marks, o = {}) => [...marks].map((m) => row({ task, arm, pass: m === '1', ...o }));
// One task's rows: tk('t0', { A: '110', B: '10', C: '0' }).
const tk = (id, spec, o = {}) => ARMS.flatMap((arm) => runs(id, arm, spec[arm] ?? '', o[arm] ?? {}));
const tasksOf = (specs) => Object.entries(specs).flatMap(([id, spec]) => tk(id, spec));

const HASH = '0'.repeat(64);
const prereg = (ids, o = {}) => ({
  model: 'claude-sonnet-5-5',
  margin: o.margin ?? 0.15,
  alpha: o.alpha ?? 0.05,
  bound: o.bound ?? { method: 'paired-t', resamples: 2000, seed: 20261008 },
  mechanism: o.mechanism ?? { alpha: 0.05, permutations: 199, seed: 77, effectSizeThinkingTokens: 500 },
  tasks: ids.map((id) => ({ id, treeHash: HASH, hiddenHash: HASH, promptHash: HASH })),
});
const deepFreeze = (v) => {
  if (v !== null && typeof v === 'object') {
    for (const inner of Object.values(v)) deepFreeze(inner);
    Object.freeze(v);
  }
  return v;
};
const ids8 = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
const sortNum = (xs) => [...xs].sort((a, b) => a - b);

// Eight tasks with varied passes; the scores (A, B, C) per task, written out by hand:
//   t0 (1, 2/3, 1/2)    t1 (2/3, 1, 0)    t2 (2/3, 1/3, 1/2)    t3 (1, 1, 1)
//   t4 (2/3, 1/3, 0)    t5 (2/3, 2/3, 1/2)    t6 (1/3, 2/3, 0)    t7 (1, 2/3, 1/2)
const MIXED = {
  t0: { A: '111', B: '110', C: '10' },
  t1: { A: '110', B: '111', C: '00' },
  t2: { A: '101', B: '100', C: '01' },
  t3: { A: '111', B: '111', C: '11' },
  t4: { A: '011', B: '010', C: '00' },
  t5: { A: '110', B: '110', C: '10' },
  t6: { A: '100', B: '110', C: '00' },
  t7: { A: '111', B: '101', C: '01' },
};
// B - A per task, in task order (by hand: -1/3, +1/3, -1/3, 0, -1/3, 0, +1/3, -1/3; mean -1/12) and A - C per task
// (1/2, 2/3, 1/6, 0, 2/3, 1/6, 1/3, 1/2; mean 3/8).
const NI_DIFFS = [2 / 3 - 1, 1 - 2 / 3, 1 / 3 - 2 / 3, 1 - 1, 1 / 3 - 2 / 3, 2 / 3 - 2 / 3, 2 / 3 - 1 / 3, 2 / 3 - 1];
const GATE_DIFFS = [1 - 1 / 2, 2 / 3 - 0, 2 / 3 - 1 / 2, 1 - 1, 2 / 3 - 0, 2 / 3 - 1 / 2, 1 / 3 - 0, 1 - 1 / 2];

// ---- verdict (the two strict comparisons) ----

t('verdict: a gate lower bound of 0 gives uninformative whatever the NI bound', () => {
  for (const niLower of [-1, -0.149, 0, 0.3, 5]) {
    assert.equal(verdict({ gateLower: 0, niLower, margin: 0.15 }), 'uninformative', `niLower ${niLower}`);
  }
  assert.equal(verdict({ gateLower: -0.2, niLower: 0.5, margin: 0.15 }), 'uninformative');
  // A gate lower bound just above 0 clears the gate: the comparison is strict at 0 and no stricter.
  assert.equal(verdict({ gateLower: 1e-9, niLower: 0, margin: 0.15 }), 'non_inferior');
});

t('verdict: gate ok and NI lower -0.149 gives non_inferior; -0.15 gives not_shown_safe', () => {
  assert.equal(verdict({ gateLower: 0.1, niLower: -0.149, margin: 0.15 }), 'non_inferior');
  assert.equal(verdict({ gateLower: 0.1, niLower: -0.15, margin: 0.15 }), 'not_shown_safe');
  assert.equal(verdict({ gateLower: 0.1, niLower: -0.151, margin: 0.15 }), 'not_shown_safe');
  assert.equal(verdict({ gateLower: 0.1, niLower: 0.2, margin: 0.15 }), 'non_inferior');
  // The margin that is read is the one passed.
  assert.equal(verdict({ gateLower: 0.1, niLower: -0.15, margin: 0.2 }), 'non_inferior');
  assert.equal(verdict({ gateLower: 0.1, niLower: -0.149, margin: 0.1 }), 'not_shown_safe');
});

t('verdict refuses a bound or margin that is not a finite number', () => {
  for (const bad of [{ gateLower: NaN }, { niLower: Infinity }, { gateLower: null }, { niLower: undefined }, { margin: 0 }, { margin: -0.1 }, { margin: NaN }]) {
    assert.throws(() => verdict({ gateLower: 0.1, niLower: 0, margin: 0.15, ...bad }), TypeError, JSON.stringify(bad));
  }
});

// ---- pairedLowerBound ----

// 32 distinct values for the tests that only need some diffs. They sit on a lattice, so two resample means can tie:
// anything that compares order statistics uses DCONT.
const D32 = Array.from({ length: 32 }, (_, i) => ((i * 7) % 32 - 16) / 40);
// Continuous values: no two resample means tie, so a neighbouring order statistic is a different number.
const DCONT = Array.from({ length: 32 }, (_, i) => Math.sin(i + 1) / 3);

t('pairedLowerBound is deterministic for a seed; [0,0,0] gives mean 0 and lower 0', () => {
  for (const method of METHODS) {
    const o = { method, resamples: 2000, seed: 11, alpha: 0.05 };
    assert.deepEqual(pairedLowerBound(DCONT, o), pairedLowerBound(DCONT, o), method);
    assert.deepEqual(pairedLowerBound([0, 0, 0], o), { mean: 0, lower: 0 }, method);
  }
  const p11 = pairedLowerBound(DCONT, { method: 'percentile', resamples: 2000, seed: 11, alpha: 0.05 });
  const p12 = pairedLowerBound(DCONT, { method: 'percentile', resamples: 2000, seed: 12, alpha: 0.05 });
  assert.notEqual(p11.lower, p12.lower, 'the seed reaches the resampling');
  // paired-t does not resample: its bound does not depend on the seed.
  assert.deepEqual(pairedLowerBound(DCONT, { method: 'paired-t', resamples: 0, seed: 11, alpha: 0.05 }), pairedLowerBound(DCONT, { method: 'paired-t', resamples: 0, seed: 12, alpha: 0.05 }));
});

t('pairedLowerBound maps any safe-integer seed, a negative one included, deterministically (carry from Task 8)', () => {
  const o = { method: 'percentile', resamples: 2000, alpha: 0.05 };
  const neg = pairedLowerBound(DCONT, { ...o, seed: -5 });
  assert.deepEqual(neg, pairedLowerBound(DCONT, { ...o, seed: -5 }));
  assert.notEqual(neg.lower, pairedLowerBound(DCONT, { ...o, seed: 5 }).lower, '-5 and 5 are two different seeds');
  assert.throws(() => pairedLowerBound(DCONT, { ...o, seed: 1.5 }), TypeError, 'a seed that is not an integer is refused, not rounded');
});

t('pairedLowerBound defaults to DEFAULT_METHOD, and refuses what it cannot compute', () => {
  const o = { resamples: 2000, seed: 3, alpha: 0.05 };
  assert.deepEqual(pairedLowerBound(D32, o), pairedLowerBound(D32, { ...o, method: DEFAULT_METHOD }));
  assert.ok(METHODS.includes(DEFAULT_METHOD));
  const ok = { method: 'paired-t', resamples: 0, seed: 1, alpha: 0.05 };
  assert.throws(() => pairedLowerBound([0.1], ok), RangeError, 'one diff has no sd and no spread to resample');
  assert.throws(() => pairedLowerBound([], ok), RangeError);
  assert.doesNotThrow(() => pairedLowerBound([0.1, 0.2], ok));
  assert.throws(() => pairedLowerBound([0.1], { ...ok, method: 'percentile', resamples: 2000 }), RangeError);
  assert.throws(() => pairedLowerBound(D32, { ...ok, method: 'bootstrap' }), TypeError);
  assert.throws(() => pairedLowerBound([0.1, NaN], ok), TypeError);
  assert.throws(() => pairedLowerBound('ab', ok), TypeError);
  for (const alpha of [0, 1, -0.1, NaN]) assert.throws(() => pairedLowerBound(D32, { ...ok, alpha }), RangeError, `alpha ${alpha}`);
  for (const resamples of [0, 1.5, -3]) assert.throws(() => pairedLowerBound(D32, { ...ok, method: 'percentile', resamples }), RangeError, `resamples ${resamples}`);
});

t('paired-t lower bound of a fixed vector equals the hand value', () => {
  // 16 diffs of +0.2 and 16 of -0.1: mean 0.05; every deviation is +-0.15, so the sample variance is 32 * 0.0225 / 31
  // and sd = sqrt(0.72 / 31). t(0.95, 31) = 1.6955 (df 30 would be 1.6973, df 32 1.6939, a z of 1.6449).
  const diffs = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 0.2 : -0.1));
  const sd = Math.sqrt(0.72 / 31);
  const hand = 0.05 - (1.6955 * sd) / Math.sqrt(32);
  const got = pairedLowerBound(diffs, { method: 'paired-t', resamples: 0, seed: 0, alpha: 0.05 });
  closeTo(got.mean, 0.05, 1e-12, 'mean');
  closeTo(got.lower, hand, 5e-6, 'lower');
  // Three values: [0, 1, 2] has mean 1 and sd 1; the df-2 quantile has a closed form, (2p - 1) / sqrt(2p(1 - p)).
  const t2 = (2 * 0.95 - 1) / Math.sqrt(2 * 0.95 * 0.05);
  const three = pairedLowerBound([0, 1, 2], { method: 'paired-t', resamples: 0, seed: 0, alpha: 0.05 });
  closeTo(three.lower, 1 - t2 / Math.sqrt(3), 1e-9, 'n = 3');
  assert.equal(three.mean, 1);
  // alpha is the tail, not the confidence: a smaller alpha gives a lower bound that is further below the mean.
  const strict = pairedLowerBound(diffs, { method: 'paired-t', resamples: 0, seed: 0, alpha: 0.01 });
  assert.ok(strict.lower < got.lower);
});

// ---- the t quantile ----

t('tQuantile: t(0.95, 31) = 1.6955 and t(0.95, 30) = 1.6973', () => {
  closeTo(tQuantile(0.95, 31), 1.6955, 1e-4, 'df 31');
  closeTo(tQuantile(0.95, 30), 1.6973, 1e-4, 'df 30');
  closeTo(tQuantile(0.975, 10), 2.2281, 1e-4, 'df 10, 0.975');
  closeTo(tQuantile(0.995, 5), 4.0321, 1e-4, 'df 5, 0.995');
  assert.ok(Math.abs(tQuantile(0.95, 31) - tQuantile(0.95, 30)) > 1e-3, 'one degree of freedom moves the quantile by more than the tolerance');
});

t('tQuantile has the closed forms of df 1 and df 2, is symmetric, and approaches the normal quantile', () => {
  closeTo(tQuantile(0.975, 1), Math.tan(Math.PI * 0.475), 1e-8, 'df 1');
  closeTo(tQuantile(0.9, 1), Math.tan(Math.PI * 0.4), 1e-8, 'df 1, 0.9');
  closeTo(tQuantile(0.95, 2), (2 * 0.95 - 1) / Math.sqrt(2 * 0.95 * 0.05), 1e-9, 'df 2');
  assert.equal(tQuantile(0.5, 7), 0);
  closeTo(tQuantile(0.05, 31), -tQuantile(0.95, 31), 1e-12, 'symmetry');
  closeTo(tQuantile(0.975, 1e6), 1.959964, 1e-3, 'large df');
});

t('tQuantile inverts the t density (Simpson integration, independent of the module)', () => {
  // r(df) = Gamma((df+1)/2) / Gamma(df/2); r(1) = 1/sqrt(pi), r(2) = sqrt(pi)/2, r(df+2) = r(df) * (df+1)/df.
  const ratio = (df) => {
    let d = df % 2 === 1 ? 1 : 2;
    let r = d === 1 ? 1 / Math.sqrt(Math.PI) : Math.sqrt(Math.PI) / 2;
    while (d < df) {
      r *= (d + 1) / d;
      d += 2;
    }
    return r;
  };
  const density = (u, df) => (ratio(df) / Math.sqrt(df * Math.PI)) * (1 + (u * u) / df) ** (-(df + 1) / 2);
  const cdf = (x, df) => {
    const n = 4000;
    const h = x / n;
    let s = density(0, df) + density(x, df);
    for (let i = 1; i < n; i++) s += (i % 2 === 1 ? 4 : 2) * density(i * h, df);
    return 0.5 + (s * h) / 3;
  };
  for (const df of [3, 5, 10, 30, 31, 32]) {
    for (const p of [0.9, 0.95, 0.975]) closeTo(cdf(tQuantile(p, df), df), p, 1e-9, `df ${df}, p ${p}`);
  }
});

t('tQuantile converges and is monotone over the df and p a bound can ask for', () => {
  const dfs = [...Array.from({ length: 60 }, (_, i) => i + 1), 100, 500, 2000];
  for (const p of [0.9, 0.95, 0.975, 0.99, 0.999]) {
    let prev = Infinity;
    for (const df of dfs) {
      const q = tQuantile(p, df);
      assert.ok(Number.isFinite(q) && q > 0 && q < prev, `p ${p} df ${df}: ${q} after ${prev}`);
      prev = q;
    }
  }
  for (const df of [2, 31]) assert.ok(tQuantile(0.99, df) > tQuantile(0.95, df));
  for (const [p, df] of [[0, 5], [1, 5], [0.95, 0], [0.95, -1], [NaN, 5], [0.95, NaN]]) assert.throws(() => tQuantile(p, df), RangeError, `${p}, ${df}`);
});

// ---- the percentile bootstrap ----

t('quantile1 is the type-1 quantile sorted[max(0, ceil(p * n - 1e-9) - 1)]', () => {
  const to = (n) => Array.from({ length: n }, (_, i) => i + 1);
  assert.equal(quantile1(to(100), 0.05), 5);
  assert.equal(quantile1(to(100), 0.07), 7, '0.07 * 100 is 7.000000000000001 in floating point; that must not take the 8th value');
  assert.equal(quantile1(to(100), 0.95), 95);
  assert.equal(quantile1(to(1010), 0.05), 51, '50.5 rounds up to the 51st value, not down to the 50th');
  assert.equal(quantile1([1, 2, 3, 4], 0.5), 2, 'an exact half is the lower value (type 1)');
  assert.equal(quantile1([5, 6, 7], 1e-12), 5, 'the index never goes below 0');
  assert.equal(quantile1([5, 6, 7], 0.999999), 7);
  assert.throws(() => quantile1([1, 2], 0), RangeError);
  assert.throws(() => quantile1([1, 2], 1), RangeError);
  assert.throws(() => quantile1([], 0.5), RangeError);
});

t('percentile lower bound: resamples tasks with makeRng(seed, 7) and takes sorted[ceil(alpha * resamples) - 1]', () => {
  const independent = (diffs, resamples, seed) => {
    const rng = makeRng(seed, 7);
    const n = diffs.length;
    const means = [];
    for (let b = 0; b < resamples; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += diffs[Math.floor(rng() * n)];
      means.push(s / n);
    }
    return sortNum(means);
  };
  const seed = 424242;
  const apart = (xs, i) => Math.abs(xs[i] - xs[i - 1]) > 1e-6 && Math.abs(xs[i] - xs[i + 1]) > 1e-6;
  const sorted = independent(DCONT, 1000, seed);
  const got = pairedLowerBound(DCONT, { method: 'percentile', resamples: 1000, seed, alpha: 0.05 });
  closeTo(got.lower, sorted[49], 1e-12, 'index 49 of 1000');
  assert.ok(apart(sorted, 49), 'neighbouring order statistics differ, so the index is pinned');
  closeTo(got.mean, DCONT.reduce((a, b) => a + b, 0) / 32, 1e-12, 'mean of the given diffs, not of the resamples');
  // 1010 resamples: 0.05 * 1010 = 50.5, so the 51st value, index 50 (a floor would give index 49).
  const sorted1010 = independent(DCONT, 1010, seed);
  closeTo(pairedLowerBound(DCONT, { method: 'percentile', resamples: 1010, seed, alpha: 0.05 }).lower, sorted1010[50], 1e-12, 'index 50 of 1010');
  assert.ok(apart(sorted1010, 50));
  // alpha 0.07 over 100 resamples: 0.07 * 100 = 7.000000000000001, index 6, not 7.
  const sorted100 = independent(DCONT, 100, seed);
  closeTo(pairedLowerBound(DCONT, { method: 'percentile', resamples: 100, seed, alpha: 0.07 }).lower, sorted100[6], 1e-12, 'index 6 of 100');
  assert.ok(apart(sorted100, 6));
  // Stream 7 specifically: the same seed on stream 0, 8 or 9 resamples differently.
  for (const stream of [0, 8, 9]) {
    const rng = makeRng(seed, stream);
    const means = [];
    for (let b = 0; b < 1000; b++) {
      let s = 0;
      for (let i = 0; i < 32; i++) s += DCONT[Math.floor(rng() * 32)];
      means.push(s / 32);
    }
    assert.ok(Math.abs(sortNum(means)[49] - sorted[49]) > 1e-6, `stream ${stream} is not stream 7`);
  }
});

t('percentile bound is the alpha quantile of the resampled means: a larger alpha gives a larger bound', () => {
  const o = { method: 'percentile', resamples: 2000, seed: 9 };
  assert.ok(pairedLowerBound(D32, { ...o, alpha: 0.01 }).lower < pairedLowerBound(D32, { ...o, alpha: 0.05 }).lower);
  assert.ok(pairedLowerBound(D32, { ...o, alpha: 0.05 }).lower < pairedLowerBound(D32, { ...o, alpha: 0.2 }).lower);
  assert.ok(pairedLowerBound(D32, { ...o, alpha: 0.05 }).lower < pairedLowerBound(D32, { ...o, alpha: 0.05 }).mean);
});

// ---- which rows count ----

t('isCounted: a row counts iff final === true and infra === null (ruling R63)', () => {
  const base = row({ task: 't0', arm: 'A' });
  assert.equal(isCounted(base), true);
  assert.equal(isCounted({ ...base, final: false }), false, 'not final');
  assert.equal(isCounted({ ...base, infra: 'effort_mismatch' }), false, 'an infrastructure row');
  assert.equal(isCounted({ ...base, infra: 'infra_exhausted' }), false, 'infra_exhausted, final or not');
  assert.equal(isCounted({ ...base, infra: undefined }), false, 'a row that does not say it is clean is not counted');
  assert.equal(isCounted({ ...base, final: 1 }), false, 'final must be true, not truthy');
  assert.equal(isCounted({ ...base, arm: 'D' }), false, 'an arm the experiment does not have');
  assert.equal(isCounted({ ...base, taskId: 7 }), false);
  assert.equal(isCounted(null), false);
  assert.equal(isCounted('row'), false);
  assert.equal(isCounted({ ...base, grade: null }), true, 'a timeout has no grade and still counts');
});

t('isPass: a row passes iff grade.pass === true; no grade is a counted fail (ruling R63)', () => {
  assert.equal(isPass(row({ task: 't0', arm: 'A', pass: true })), true);
  assert.equal(isPass(row({ task: 't0', arm: 'A', pass: false })), false);
  assert.equal(isPass(row({ task: 't0', arm: 'A', grade: null })), false);
  assert.equal(isPass(row({ task: 't0', arm: 'A', grade: { pass: 1 } })), false);
  assert.equal(isPass(row({ task: 't0', arm: 'A', grade: { pass: 'true' } })), false);
  assert.equal(isPass({ ...row({ task: 't0', arm: 'A' }), grade: undefined }), false);
});

// ---- perTaskScores ----

t('infrastructure rows never count; a task with no counted C run is excluded and listed', () => {
  const infraFinal = (task, arm, o = {}) => row({ task, arm, infra: 'infra_exhausted', final: true, grade: null, ...o });
  const rows = [
    // t0: A passes 2 of 3, B 1 of 3, C 0 of 2; a passing infra_exhausted A row and a passing non-final A row must not count.
    ...runs('t0', 'A', '110'), ...runs('t0', 'B', '100'), ...runs('t0', 'C', '00'),
    infraFinal('t0', 'A', { grade: { pass: true } }),
    row({ task: 't0', arm: 'A', final: false, infra: 'api_error', pass: true }),
    row({ task: 't0', arm: 'A', final: false, pass: true }),
    // t1: no counted C run, only an infra_exhausted row.
    ...runs('t1', 'A', '11'), ...runs('t1', 'B', '10'), infraFinal('t1', 'C'),
    // t2: only infrastructure rows.
    infraFinal('t2', 'A'), infraFinal('t2', 'B'), infraFinal('t2', 'C'),
    // t3: nothing but B and C counted.
    ...runs('t3', 'B', '1'), ...runs('t3', 'C', '1'),
  ];
  const { scores, excluded } = perTaskScores(rows);
  assert.deepEqual([...scores.keys()], ['t0']);
  assert.deepEqual(scores.get('t0'), { A: 2 / 3, B: 1 / 3, C: 0, nA: 3, nB: 3, nC: 2 });
  assert.deepEqual(excluded, [
    { taskId: 't1', reason: 'no_counted_run_in_C' },
    { taskId: 't2', reason: 'no_counted_run_in_A_B_C' },
    { taskId: 't3', reason: 'no_counted_run_in_A' },
  ]);
});

t('perTaskScores: a timeout is a counted failure; the arm score is the mean pass over its counted runs', () => {
  const rows = [
    row({ task: 't0', arm: 'A', pass: true }), row({ task: 't0', arm: 'A', grade: null, timedOut: true }),
    ...runs('t0', 'B', '1'), ...runs('t0', 'C', '0'),
  ];
  assert.deepEqual(perTaskScores(rows).scores.get('t0'), { A: 0.5, B: 1, C: 0, nA: 2, nB: 1, nC: 1 });
});

t('perTaskScores does not depend on the order of the rows, and lists tasks by id', () => {
  const rows = tasksOf(MIXED);
  const a = perTaskScores(rows);
  const b = perTaskScores(shuffle(rows, makeRng(5)));
  assert.deepEqual([...b.scores.entries()], [...a.scores.entries()]);
  assert.deepEqual([...a.scores.keys()], ids8);
  assert.deepEqual(perTaskScores([]), { scores: new Map(), excluded: [] });
  assert.deepEqual(perTaskScores('nonsense'), { scores: new Map(), excluded: [] });
});

// ---- the mutation guards: diff direction, task means ----

const NI_ALL = prereg(ids8);

t('mutation guard: swapping arms A and B flips the sign of the mean difference', () => {
  const rows = tasksOf(MIXED);
  const swap = (r) => (r.arm === 'A' ? { ...r, arm: 'B' } : r.arm === 'B' ? { ...r, arm: 'A' } : r);
  const rep = analyzeS5(rows, NI_ALL);
  const swapped = analyzeS5(rows.map(swap), NI_ALL);
  // By hand: B - A is -1/3 on t0, t2, t4, t7 and +1/3 on t1, t6: the mean is (2 - 4) / 3 / 8 = -1/12.
  closeTo(rep.ni.mean, -1 / 12, 1e-12, 'B - A');
  closeTo(swapped.ni.mean, 1 / 12, 1e-12, 'A - B');
  closeTo(swapped.ni.mean, -rep.ni.mean, 1e-12, 'flipped');
  assert.ok(rep.ni.mean < 0, 'B is worse than A on this data, so B - A is negative');
});

t('mutation guard: the gate difference is A - C, not C - A', () => {
  const rows = tasksOf(MIXED);
  const rep = analyzeS5(rows, NI_ALL);
  // By hand: (1/2 + 2/3 + 1/6 + 0 + 2/3 + 1/6 + 1/3 + 1/2) / 8 = 3/8.
  closeTo(rep.gate.mean, 3 / 8, 1e-12, 'A - C');
  const swapC = (r) => (r.arm === 'A' ? { ...r, arm: 'C' } : r.arm === 'C' ? { ...r, arm: 'A' } : r);
  closeTo(analyzeS5(rows.map(swapC), NI_ALL).gate.mean, -3 / 8, 1e-12, 'C - A');
  assert.ok(rep.gate.lower > 0, 'A is clearly better than C here, so the gate holds');
});

t('mutation guard: pooling runs instead of task means changes the result on a task with 3 runs against one with 1', () => {
  // t0: A 3 of 3 (score 1), B 1 of 2 (0.5). t1: A 0 of 1 (score 0), B 1 of 2 (0.5).
  // Task means: B - A is -0.5 and +0.5, mean 0. Pooled runs: A 3/4, B 2/4, which would give -0.25.
  const rows = [...tk('t0', { A: '111', B: '10', C: '0' }), ...tk('t1', { A: '0', B: '10', C: '0' })];
  const { scores } = perTaskScores(rows);
  assert.deepEqual(scores.get('t0'), { A: 1, B: 0.5, C: 0, nA: 3, nB: 2, nC: 1 });
  assert.deepEqual(scores.get('t1'), { A: 0, B: 0.5, C: 0, nA: 1, nB: 2, nC: 1 });
  const rep = analyzeS5(rows, prereg(['t0', 't1']));
  assert.equal(rep.ni.mean, 0, 'the mean of the two task differences');
  assert.equal(rep.gate.mean, 0.5, 'the gate is a task mean too: (1 - 0 + 0 - 0) / 2');
});

// ---- selectCalibrated ----

t('selectCalibrated drops A 0/2 as never_solved and A 2/2 with C 1/1 as effort_idle, and keeps A 1/2', () => {
  const infra = (task, arm, o = {}) => row({ task, arm, infra: 'infra_exhausted', grade: null, ...o });
  const rows = [
    ...tk('c0', { A: '00', C: '1' }), // never_solved (C does not matter)
    ...tk('c1', { A: '11', C: '1' }), // effort_idle
    ...tk('c2', { A: '10', C: '0' }), // kept
    ...tk('c3', { A: '11', C: '0' }), // kept: the lower effort fails
    ...tk('c4', { A: '10', C: '1' }), // kept: A does not pass every run
    ...tk('c5', { A: '00', C: '0' }), // never_solved
    infra('c6', 'A'), ...runs('c6', 'C', '1'), // no counted A run: not_measured
    ...runs('c7', 'A', '11'), // no C row at all: not_measured
    // c8: the counted rows say effort_idle; an infrastructure C row that failed must not make it effort-sensitive.
    ...tk('c8', { A: '11', C: '1' }), infra('c8', 'C', { grade: { pass: false } }),
    // c9: a B row never matters in calibration.
    ...tk('c9', { A: '11', B: '0', C: '1' }),
    ...tk('c10', { A: '1', C: '1' }), // one run each: A passes every run, C passes every run
  ];
  const { kept, dropped } = selectCalibrated(rows);
  assert.deepEqual(kept, ['c2', 'c3', 'c4']);
  assert.deepEqual(dropped, [
    { taskId: 'c0', reason: 'never_solved' },
    { taskId: 'c1', reason: 'effort_idle' },
    { taskId: 'c10', reason: 'effort_idle' },
    { taskId: 'c5', reason: 'never_solved' },
    { taskId: 'c6', reason: 'not_measured' },
    { taskId: 'c7', reason: 'not_measured' },
    { taskId: 'c8', reason: 'effort_idle' },
    { taskId: 'c9', reason: 'effort_idle' },
  ]);
});

t('selectCalibrated does not depend on row order and tolerates no rows', () => {
  const rows = [...tk('c0', { A: '10', C: '1' }), ...tk('c1', { A: '00', C: '0' }), ...tk('c2', { A: '11', C: '1' })];
  assert.deepEqual(selectCalibrated(shuffle(rows, makeRng(2))), selectCalibrated(rows));
  assert.deepEqual(selectCalibrated([]), { kept: [], dropped: [] });
});

// ---- mechanism ----

// Six tasks; A (holdout) thinks more than B (treated). The three usage parts differ, so the field that was read shows.
//   main.thinking  A 1000  B 400   (T = 600)         main.output  A 5000  B 4200   (800)
//   total.thinking A 1500  B 600   (900)             total.output A 9000  B 7000   (not read)
//   main cache 100/1000 for A, 50/1000 for B; total cache 400/4000 for A, 100/4000 for B.
const MECH_IDS = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'];
const mechUsage = (arm) => {
  if (arm === 'A') return usageOf({ think: 1000, out: 5000, input: 1000, cc: 100 }, { think: 1500, out: 9000, input: 4000, cc: 400 });
  if (arm === 'B') return usageOf({ think: 400, out: 4200, input: 1000, cc: 50 }, { think: 600, out: 7000, input: 4000, cc: 100 });
  return usageOf({ think: 0, out: 0, input: 1000, cc: 0 }, { think: 0, out: 0, input: 1000, cc: 0 });
};
const mechRows = (ids = MECH_IDS) =>
  ids.flatMap((id) => ARMS.flatMap((arm) => runs(id, arm, arm === 'C' ? '00' : '111', { usage: mechUsage(arm) })));

t('mechanism maps B to treated, A to holdout, usage.main.thinking / .output / usage.total.thinking, with the same part\'s cache fields', () => {
  const m = mechanism(mechRows(), prereg(MECH_IDS));
  for (const key of ['thinking', 'output', 'total']) {
    assert.equal(m[key].nIgnored, 0, `${key}: a valid counted row is never ignored (R62)`);
    assert.equal(m[key].nTreated, 18, `${key}: B rows only`);
    assert.equal(m[key].nHoldout, 18, `${key}: A rows only, no C`);
    assert.equal(m[key].nPrompts, 6);
  }
  assert.equal(m.thinking.signedDelta, 600, 'down: -(median B - median A) = -(400 - 1000)');
  assert.equal(m.thinking.medianTreated, 400);
  assert.equal(m.thinking.medianHoldout, 1000);
  assert.equal(m.output.signedDelta, 800);
  assert.equal(m.output.medianTreated, 4200);
  assert.equal(m.total.signedDelta, 900);
  assert.equal(m.total.medianTreated, 600);
  assert.equal(m.total.medianHoldout, 1500);
  // The cache fields come from the same part as the count: main for thinking and output, total for total.
  closeTo(m.thinking.cacheShareTreated, 0.05, 1e-12, 'main B share');
  closeTo(m.thinking.cacheShareHoldout, 0.1, 1e-12, 'main A share');
  closeTo(m.output.cacheShareTreated, 0.05, 1e-12);
  closeTo(m.total.cacheShareTreated, 0.025, 1e-12, 'total B share');
  closeTo(m.total.cacheShareHoldout, 0.1, 1e-12, 'total A share');
  assert.equal(m.thinking.cacheOk, true);
});

t('mechanism: the registered thinking test passes or fails on the registered effect size and alpha', () => {
  const p = (o) => prereg(MECH_IDS, { mechanism: { alpha: 0.05, permutations: 199, seed: 77, effectSizeThinkingTokens: 500, ...o } });
  assert.equal(mechanism(mechRows(), p({})).thinking.verdict, 'mechanism_pass');
  assert.equal(mechanism(mechRows(), p({ effectSizeThinkingTokens: 700 })).thinking.verdict, 'mechanism_fail', 'T = 600 is below an effect of 700');
  assert.equal(mechanism(mechRows(), p({ effectSizeThinkingTokens: 600 })).thinking.verdict, 'mechanism_pass', 'T = 600 meets an effect of 600');
  // The smallest p of 199 permutations is 1/200 = 0.005, so an alpha of 0.001 cannot be met.
  assert.equal(mechanism(mechRows(), p({ alpha: 0.001 })).thinking.verdict, 'mechanism_fail');
  // prereg.alpha (the NI alpha) is not the mechanism's.
  assert.equal(mechanism(mechRows(), { ...p({ alpha: 0.001 }), alpha: 0.5 }).thinking.verdict, 'mechanism_fail');
});

t('mechanism hands analyzeArms the registered seed, permutations and an effect it can test (direction down, minPerArm the included count)', () => {
  // Overlapping values, so the p-value is neither extreme and depends on the seed.
  const ids = ['n0', 'n1', 'n2', 'n3'];
  const a = [300, 500, 700];
  const b = [200, 450, 650];
  const rows = ids.flatMap((id, i) => [
    ...a.map((v) => row({ task: id, arm: 'A', index: i, usage: usageOf({ think: v + 10 * i, input: 900, cc: 90 }) })),
    ...b.map((v) => row({ task: id, arm: 'B', index: i, usage: usageOf({ think: v + 10 * i, input: 900, cc: 90 }) })),
    row({ task: id, arm: 'C', index: i, pass: false }),
  ]);
  const expectedRows = ids.flatMap((_, i) => [
    ...a.map((v) => ({ promptIndex: i, arm: 'holdout', thinking_tokens: v + 10 * i, cache_creation: 90, input_total: 900 })),
    ...b.map((v) => ({ promptIndex: i, arm: 'treated', thinking_tokens: v + 10 * i, cache_creation: 90, input_total: 900 })),
  ]);
  const registered = { alpha: 0.2, permutations: 199, seed: 77, effectSizeThinkingTokens: 10 };
  const direct = (seed) => analyzeArms(expectedRows, { direction: 'down', effectSizeThinkingTokens: 10, minPerArm: 4, alpha: 0.2, permutations: 199, seed });
  assert.notEqual(direct(77).pValue, direct(78).pValue, 'the fixture is sensitive to the seed');
  const got = mechanism(rows, prereg(ids, { mechanism: registered })).thinking;
  assert.deepEqual(got, direct(77));
  assert.equal(got.nIgnored, 0);
  assert.notEqual(got.verdict, 'insufficient_data', 'minPerArm (4 tasks) is met by 12 rows per arm');
  assert.deepEqual(mechanism(rows, prereg(ids, { mechanism: { ...registered, seed: 78 } })).thinking, direct(78));
  assert.notEqual(mechanism(rows, prereg(ids, { mechanism: { ...registered, permutations: 99 } })).thinking.pValue, got.pValue, 'permutations reach the test');
});

t('mechanism counts only counted rows of included tasks, arms A and B', () => {
  const wild = { think: 99999, out: 99999, input: 1000, cc: 0 };
  const rows = [
    ...mechRows(),
    // An infrastructure row, a non-final row, and a C row with wild numbers: none may reach the test.
    row({ task: 'm0', arm: 'A', infra: 'infra_exhausted', grade: null, usage: usageOf(wild) }),
    row({ task: 'm1', arm: 'B', final: false, usage: usageOf(wild) }),
    row({ task: 'm2', arm: 'C', usage: usageOf(wild) }),
    // A task with no counted C run is not included, so its A and B rows are left out.
    ...runs('m9', 'A', '11', { usage: usageOf(wild) }), ...runs('m9', 'B', '11', { usage: usageOf(wild) }),
    row({ task: 'm9', arm: 'C', infra: 'infra_exhausted', grade: null }),
  ];
  const m = mechanism(rows, prereg([...MECH_IDS, 'm9']));
  assert.equal(m.thinking.nTreated, 18);
  assert.equal(m.thinking.nHoldout, 18);
  assert.equal(m.thinking.nPrompts, 6);
  assert.equal(m.thinking.signedDelta, 600);
  assert.deepEqual(m.thinking, mechanism(mechRows(), prereg(MECH_IDS)).thinking);
});

t('mechanism: minPerArm is the included task count, which one counted run per arm and task meets', () => {
  const ids = ['m0', 'm1', 'm2'];
  const rows = ids.flatMap((id) => ARMS.flatMap((arm) => runs(id, arm, '1', { usage: mechUsage(arm) })));
  const m = mechanism(rows, prereg(ids));
  for (const key of ['thinking', 'output', 'total']) {
    assert.equal(m[key].nTreated, 3, key);
    assert.equal(m[key].nHoldout, 3, key);
    assert.notEqual(m[key].verdict, 'insufficient_data', `${key}: 3 rows per arm meet a floor of 3 tasks`);
  }
  assert.equal(m.thinking.signedDelta, 600);
});

t('mechanism with no included task reports insufficient_data instead of throwing', () => {
  const m = mechanism([], prereg(['m0']));
  for (const key of ['thinking', 'output', 'total']) assert.equal(m[key].verdict, 'insufficient_data', key);
  const none = mechanism(tk('m0', { A: '1', B: '1' }), prereg(['m0']));
  assert.equal(none.thinking.verdict, 'insufficient_data', 'no counted C run, so the task is not included');
  assert.equal(none.thinking.nTreated, 0);
});

t('mechanism: a counted row that lacks the usage fields is ignored in the open, never read as zero', () => {
  const rows = mechRows();
  const broken = rows.map((r, i) => (i === 0 ? { ...r, usage: { main: { thinking: 1 }, total: r.usage.total } } : r));
  const m = mechanism(broken, prereg(MECH_IDS));
  assert.equal(m.thinking.nIgnored, 1);
  assert.equal(m.output.nIgnored, 1);
  assert.equal(m.total.nIgnored, 0, 'its total part is intact');
});

// ---- secondaries ----

const SEC_PREREG = prereg(['s0', 's1'], { bound: { method: 'paired-t', resamples: 2000, seed: 31 } });

t('secondaries: cost per resolved task per arm counts failures, not infrastructure rows; null when none pass', () => {
  const rows = [
    row({ task: 's0', arm: 'A', pass: true, cost: 1 }), row({ task: 's0', arm: 'A', pass: false, cost: 2 }), row({ task: 's0', arm: 'A', pass: false, cost: 3 }),
    row({ task: 's0', arm: 'A', infra: 'infra_exhausted', grade: null, cost: 100 }), row({ task: 's0', arm: 'A', final: false, cost: 100 }),
    row({ task: 's0', arm: 'B', pass: true, cost: 4 }), row({ task: 's0', arm: 'B', pass: true, cost: 4 }),
    row({ task: 's0', arm: 'C', pass: false, cost: 1 }), row({ task: 's0', arm: 'C', pass: false, cost: null }),
    row({ task: 's0', arm: 'C', pass: false, cost: -2 }), row({ task: 's0', arm: 'C', pass: false, cost: 'n/a' }),
  ];
  const { cost } = secondaries(rows, SEC_PREREG);
  assert.deepEqual(cost.A, { usd: 6, runs: 3, resolved: 1, missing: 0, perResolved: 6 });
  assert.deepEqual(cost.B, { usd: 8, runs: 2, resolved: 2, missing: 0, perResolved: 4 });
  assert.deepEqual(cost.C, { usd: 1, runs: 4, resolved: 0, missing: 3, perResolved: null }, 'a null, negative or non-number cost is a missing reading');
});

t('secondaries: counts of timeouts, testsRunBeforeDone === false, infrastructure rows and thinkingFieldMissing per arm', () => {
  const rows = [
    row({ task: 's0', arm: 'A', timedOut: true, grade: null, cost: null }),
    row({ task: 's0', arm: 'A', tests: false }),
    row({ task: 's0', arm: 'A', tests: null }), // unknown is not false
    row({ task: 's0', arm: 'A' }),
    row({ task: 's0', arm: 'A', infra: 'effort_mismatch', final: false, grade: null, timedOut: true, tests: false }), // not counted: counts only as an infra row
    row({ task: 's0', arm: 'A', infra: 'infra_exhausted', final: true, grade: null }),
    { ...row({ task: 's0', arm: 'A' }), infra: undefined }, // does not say whether it is clean: neither counted nor an infrastructure row
    row({ task: 's0', arm: 'B', main: { missing: 3 } }), // 3 messages without thinking: one row
    row({ task: 's0', arm: 'B', main: { missing: 1 } }),
    row({ task: 's0', arm: 'B', main: { missing: 0 } }),
    row({ task: 's0', arm: 'B', infra: 'api_error', final: false, grade: null, main: { missing: 5 } }),
    row({ task: 's0', arm: 'C', timedOut: true, grade: null, tests: false }),
    row({ task: 's0', arm: 'C', timedOut: true, grade: null, tests: false }),
  ];
  const { counts } = secondaries(rows, SEC_PREREG);
  assert.deepEqual(counts.A, { counted: 4, timeouts: 1, testsNotRun: 1, infraRows: 2, thinkingFieldMissing: 0 });
  assert.deepEqual(counts.B, { counted: 3, timeouts: 0, testsNotRun: 0, infraRows: 1, thinkingFieldMissing: 2 });
  assert.deepEqual(counts.C, { counted: 2, timeouts: 2, testsNotRun: 2, infraRows: 0, thinkingFieldMissing: 0 });
});

t('pass^3: 2 of 3 gives 0, 3 of 3 gives 1', () => {
  const two = secondaries(tk('s0', { A: '110', B: '110', C: '1' }), SEC_PREREG).pass3;
  assert.equal(two.A.value, 0, '2 of 3: C(2,3) / C(3,3)');
  assert.equal(two.B.value, 0);
  const three = secondaries(tk('s0', { A: '111', B: '111', C: '1' }), SEC_PREREG).pass3;
  assert.equal(three.A.value, 1, '3 of 3');
  assert.equal(three.B.value, 1);
  // C has one run here: below 3, so it is left out and counted, and the arm has no value.
  assert.deepEqual(three.C, { value: null, tasks: 0, skipped: 1 });
  assert.deepEqual(two.A, { value: 0, tasks: 1, skipped: 0 });
});

t('pass^3 is C(c,3) / C(n,3) per task, meaned over tasks with n >= 3; a task with fewer runs is skipped and counted', () => {
  const rows = [
    ...tk('s0', { A: '1110', B: '1', C: '1' }), // n 4, c 3: 1/4
    ...tk('s1', { A: '11111', B: '1', C: '1' }), // n 5, c 5: 1
    ...tk('s2', { A: '11110', B: '1', C: '1' }), // n 5, c 4: 4/10
    ...tk('s3', { A: '11', B: '1', C: '1' }), // n 2: skipped
    ...tk('s4', { A: '000', B: '1', C: '1' }), // n 3, c 0: 0
  ];
  const { pass3 } = secondaries(rows, prereg(['s0', 's1', 's2', 's3', 's4']));
  // (1/4 + 1 + 4/10 + 0) / 4 tasks; a (c/n)^3 would give 0.42 for the first, and pooled c / n a different mean again.
  assert.equal(pass3.A.tasks, 4);
  assert.equal(pass3.A.skipped, 1);
  closeTo(pass3.A.value, (1 / 4 + 1 + 4 / 10 + 0) / 4, 1e-12, 'mean over tasks');
  assert.deepEqual(pass3.B, { value: null, tasks: 0, skipped: 5 });
});

t('pass^3 counts included tasks only: a task with no counted run in another arm is left out', () => {
  const rows = [...tk('s0', { A: '111', B: '111', C: '1' }), ...tk('s1', { A: '000', B: '000' })]; // s1 has no C run
  assert.deepEqual(secondaries(rows, SEC_PREREG).pass3.A, { value: 1, tasks: 1, skipped: 0 });
});

t('secondaries: discordant tasks are the included tasks whose A and B scores differ, sorted by B - A ascending', () => {
  const rows = [
    ...tk('s0', { A: '11', B: '11', C: '0' }), // equal: not discordant
    ...tk('s1', { A: '11', B: '00', C: '0' }), // B - A = -1
    ...tk('s2', { A: '10', B: '11', C: '0' }), // +0.5
    ...tk('s3', { A: '110', B: '100', C: '0' }), // -1/3
    ...tk('s4', { A: '11', B: '11' }), // would differ nowhere; and has no C run, so it is not included
    ...tk('s5', { A: '1', B: '0' }), // discordant but not included (no C run)
    ...tk('s6', { A: '11', B: '00', C: '0' }), // B - A = -1 as well: ties go by task id
  ];
  const { discordant } = secondaries(rows, prereg(['s0', 's1', 's2', 's3', 's4', 's5', 's6']));
  assert.deepEqual(discordant, [
    { taskId: 's1', A: 1, B: 0 },
    { taskId: 's6', A: 1, B: 0 },
    { taskId: 's3', A: 2 / 3, B: 1 / 3 },
    { taskId: 's2', A: 0.5, B: 1 },
  ]);
});

// Eight tasks; per task, the mean of usage.main.output over the counted runs is outA (two runs, outA -+ 10) and outB * 1
// (two runs, outB * 0.9 and * 1.1), and likewise for thinking, so the per-task B / A ratio is r[i] and s[i] by construction.
const LR_IDS = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
const RATIO_OUT = [0.5, 0.8, 1, 1.2, 1.5, 0.9, 2, 1.1];
const RATIO_THINK = [1.5, 1, 0.5, 0.7, 1.3, 2, 0.8, 1.1];
const lrRows = (ids = LR_IDS, twist = () => ({})) =>
  ids.flatMap((id) => {
    const i = Number(id.slice(1));
    const outA = 100 + 40 * i;
    const thinkA = 50 + 25 * i;
    const outB = outA * RATIO_OUT[i];
    const thinkB = thinkA * RATIO_THINK[i];
    const mk = (arm, out, think) => row({ task: id, arm, main: { out, think }, ...twist(id, arm) });
    return [
      mk('A', outA - 10, thinkA - 5), mk('A', outA + 10, thinkA + 5),
      mk('B', outB * 0.9, thinkB * 0.9), mk('B', outB * 1.1, thinkB * 1.1),
      mk('C', 1, 1),
    ];
  });

// The percentile interval of the per-task log ratios, resampled by hand with the stated stream.
function interval(logs, stream, seed, resamples, alpha) {
  const rng = makeRng(seed, stream);
  const n = logs.length;
  const means = [];
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += logs[Math.floor(rng() * n)];
    means.push(s / n);
  }
  const sorted = sortNum(means);
  return [quantile1(sorted, alpha), quantile1(sorted, 1 - alpha)];
}

t('secondaries: log ratio of B over A for output and thinking, with a percentile interval on streams 8 and 9', () => {
  const logsOut = RATIO_OUT.map(Math.log);
  const logsThink = RATIO_THINK.map(Math.log);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const [bound, R] of [[{ method: 'paired-t', resamples: 0, seed: 5 }, 2000], [{ method: 'percentile', resamples: 3000, seed: -7 }, 3000]]) {
    const { logRatio } = secondaries(lrRows(), prereg(LR_IDS, { bound }));
    const [oLo, oHi] = interval(logsOut, 8, bound.seed, R, 0.05);
    const [tLo, tHi] = interval(logsThink, 9, bound.seed, R, 0.05);
    const what = `${bound.method} / ${R}`;
    assert.equal(logRatio.output.n, 8);
    assert.equal(logRatio.output.nSkipped, 0);
    closeTo(logRatio.output.meanLogRatio, mean(logsOut), 1e-12, `${what}: output mean`);
    closeTo(logRatio.output.ratio, Math.exp(mean(logsOut)), 1e-12, `${what}: output ratio`);
    closeTo(logRatio.output.lower, oLo, 1e-9, `${what}: output lower (stream 8)`);
    closeTo(logRatio.output.upper, oHi, 1e-9, `${what}: output upper (stream 8)`);
    closeTo(logRatio.thinking.meanLogRatio, mean(logsThink), 1e-12, `${what}: thinking mean`);
    closeTo(logRatio.thinking.lower, tLo, 1e-9, `${what}: thinking lower (stream 9)`);
    closeTo(logRatio.thinking.upper, tHi, 1e-9, `${what}: thinking upper (stream 9)`);
    assert.ok(logRatio.output.lower < logRatio.output.meanLogRatio && logRatio.output.meanLogRatio < logRatio.output.upper);
  }
  // Direction: B over A. The first task has outputs of B at half of A's: a negative log ratio.
  assert.ok(Math.log(0.5) < 0 && secondaries(lrRows(['l0']), prereg(['l0'])).logRatio.output.meanLogRatio < 0);
  closeTo(secondaries(lrRows(['l0']), prereg(['l0'])).logRatio.output.meanLogRatio, Math.log(0.5), 1e-12, 'B over A');
});

t('secondaries: a task with a zero mean in either arm is left out of that log ratio and counted; fewer than 2 tasks give no interval', () => {
  const rows = lrRows(LR_IDS, (id, arm) => {
    if (id === 'l0' && arm === 'A') return { main: { out: 0, think: 25 } }; // output mean in A is 0: left out of the output ratio only
    if (id === 'l1' && arm === 'B') return { main: { out: 90, think: 0 } }; // thinking mean in B is 0
    return {};
  });
  const { logRatio } = secondaries(rows, prereg(LR_IDS));
  assert.equal(logRatio.output.n, 7);
  assert.equal(logRatio.output.nSkipped, 1);
  assert.equal(logRatio.thinking.n, 7);
  assert.equal(logRatio.thinking.nSkipped, 1);
  const one = secondaries(lrRows(['l3']), prereg(['l3'])).logRatio.output;
  assert.equal(one.n, 1);
  closeTo(one.meanLogRatio, Math.log(1.2), 1e-12);
  assert.equal(one.lower, null);
  assert.equal(one.upper, null);
  const none = secondaries([], prereg(['l3'])).logRatio.output;
  assert.deepEqual(none, { n: 0, nSkipped: 0, meanLogRatio: null, ratio: null, lower: null, upper: null });
});

t('secondaries: a counted row without a usable usage count is left out of the log ratio, not read as 0', () => {
  const rows = lrRows(['l0', 'l1', 'l2']).map((r) => (r.taskId === 'l1' && r.arm === 'B' && r.usage.main.output < 150 ? { ...r, usage: { ...r.usage, main: { ...r.usage.main, output: undefined } } } : r));
  const { logRatio } = secondaries(rows, prereg(['l0', 'l1', 'l2']));
  assert.equal(logRatio.output.n, 2);
  assert.equal(logRatio.output.nSkipped, 1);
});

// ---- analyzeS5 ----

const fill = (ids, spec) => ids.flatMap((id) => tk(id, spec));
const rep8 = (spec, o) => analyzeS5(fill(ids8, spec), prereg(ids8, o));

t('analyzeS5: A and B alike and C worse gives non_inferior; B worse gives not_shown_safe; C as good as A gives uninformative', () => {
  const ok = rep8({ A: '111', B: '111', C: '00' });
  assert.equal(ok.verdict, 'non_inferior');
  assert.equal(ok.reason, null);
  assert.deepEqual(ok.ni, { mean: 0, lower: 0 });
  assert.deepEqual(ok.gate, { mean: 1, lower: 1 });
  const worse = rep8({ A: '111', B: '000', C: '00' });
  assert.equal(worse.verdict, 'not_shown_safe');
  assert.deepEqual(worse.ni, { mean: -1, lower: -1 });
  const idle = rep8({ A: '111', B: '111', C: '111' });
  assert.equal(idle.verdict, 'uninformative');
  assert.equal(idle.reason, 'gate_failed');
  assert.deepEqual(idle.gate, { mean: 0, lower: 0 });
  // The gate being unmet makes the verdict uninformative even when B is clearly worse.
  const both = rep8({ A: '111', B: '000', C: '111' });
  assert.equal(both.verdict, 'uninformative');
  // B better than A is non-inferior with a positive lower bound.
  const better = rep8({ A: '100', B: '111', C: '000' });
  assert.equal(better.verdict, 'non_inferior');
  assert.ok(better.ni.lower > 0);
});

t('analyzeS5: the registered margin decides the NI verdict end to end', () => {
  // B - A is -1/3 on every task, so the lower bound is -1/3 (the sd is 0): non-inferior under a margin of 0.34, not under 0.33.
  const spec = { A: '111', B: '110', C: '00' };
  closeTo(rep8(spec).ni.lower, -1 / 3, 1e-12);
  assert.equal(rep8(spec, { margin: 0.34 }).verdict, 'non_inferior');
  assert.equal(rep8(spec, { margin: 0.33 }).verdict, 'not_shown_safe');
  assert.equal(rep8(spec).verdict, 'not_shown_safe', 'and not under the registered 0.15');
});

t('analyzeS5: the lower bounds are the registered method on the per-task diffs, with the registered alpha and seed', () => {
  const rows = tasksOf(MIXED);
  for (const bound of [{ method: 'paired-t', resamples: 0, seed: 1 }, { method: 'percentile', resamples: 2000, seed: 20261008 }, { method: 'percentile', resamples: 2500, seed: -3 }]) {
    const rep = analyzeS5(rows, prereg(ids8, { bound, alpha: 0.05 }));
    const o = { ...bound, alpha: 0.05 };
    assert.deepEqual(rep.ni, pairedLowerBound(NI_DIFFS, o), `${bound.method} ${bound.resamples}: NI`);
    assert.deepEqual(rep.gate, pairedLowerBound(GATE_DIFFS, o), `${bound.method} ${bound.resamples}: gate`);
    assert.equal(rep.method, bound.method);
  }
  const t1 = analyzeS5(rows, prereg(ids8, { bound: { method: 'paired-t', resamples: 0, seed: 1 } }));
  const p1 = analyzeS5(rows, prereg(ids8, { bound: { method: 'percentile', resamples: 2000, seed: 1 } }));
  assert.notEqual(t1.ni.lower, p1.ni.lower, 'the two methods are two different bounds on this data');
  const a10 = analyzeS5(rows, prereg(ids8, { alpha: 0.1 }));
  assert.deepEqual(a10.ni, pairedLowerBound(NI_DIFFS, { method: 'paired-t', resamples: 2000, seed: 20261008, alpha: 0.1 }));
  assert.equal(a10.alpha, 0.1);
});

t('analyzeS5: the Report names the registered margin, alpha and method, the included and the excluded tasks', () => {
  const ids = ['t3', 't0', 't1', 'tx'];
  const rows = [...tk('t0', { A: '110', B: '1', C: '0' }), ...tk('t1', { A: '1', B: '11', C: '1' }), ...tk('t3', { A: '11', B: '10', C: '1' }), ...runs('t1', 'A', '1', { infra: 'infra_exhausted', grade: null })];
  const rep = analyzeS5(rows, prereg(ids, { margin: 0.2, alpha: 0.1 }));
  assert.equal(rep.margin, 0.2);
  assert.equal(rep.alpha, 0.1);
  assert.equal(rep.method, 'paired-t');
  // Registered order (t3, t0, t1), not id order; a registered task with no row at all is excluded and listed.
  assert.deepEqual(rep.included, [
    { taskId: 't3', A: 1, B: 0.5, C: 1, nA: 2, nB: 2, nC: 1 },
    { taskId: 't0', A: 2 / 3, B: 1, C: 0, nA: 3, nB: 1, nC: 1 },
    { taskId: 't1', A: 1, B: 1, C: 1, nA: 1, nB: 2, nC: 1 },
  ]);
  assert.deepEqual(rep.excluded, [{ taskId: 'tx', reason: 'no_counted_run_in_A_B_C' }]);
  assert.equal(rep.ignoredRows, 0);
  assert.deepEqual(Object.keys(rep.mechanism), ['thinking', 'output', 'total']);
  assert.ok(rep.secondaries && typeof rep.secondaries === 'object');
});

t('analyzeS5: fewer than 2 included tasks is uninformative with reason too_few_tasks and no bounds', () => {
  const rows = [...tk('t0', { A: '11', B: '11', C: '0' }), ...tk('t1', { A: '1', B: '1' })]; // t1 has no C run
  const rep = analyzeS5(rows, prereg(['t0', 't1']));
  assert.equal(rep.verdict, 'uninformative');
  assert.equal(rep.reason, 'too_few_tasks');
  assert.equal(rep.ni, null);
  assert.equal(rep.gate, null);
  assert.deepEqual(rep.excluded, [{ taskId: 't1', reason: 'no_counted_run_in_C' }]);
  const empty = analyzeS5([], prereg(['t0', 't1']));
  assert.equal(empty.reason, 'too_few_tasks');
  assert.deepEqual(empty.included, []);
  assert.equal(empty.excluded.length, 2);
  // Exactly 2 is enough.
  assert.equal(analyzeS5([...tk('t0', { A: '11', B: '11', C: '0' }), ...tk('t1', { A: '11', B: '11', C: '0' })], prereg(['t0', 't1'])).verdict, 'non_inferior');
});

t('analyzeS5: rows of a task the prereg does not list, and rows that are not objects, are ignored and counted', () => {
  const rows = [...fill(ids8, { A: '111', B: '111', C: '00' }), ...tk('zz', { A: '000', B: '000', C: '111' }), null, 'junk', 7];
  const rep = analyzeS5(rows, prereg(ids8));
  assert.equal(rep.ignoredRows, 9 + 3, 'nine rows of the unregistered task, and three that are not rows');
  assert.equal(rep.verdict, 'non_inferior');
  assert.deepEqual(rep.included.map((x) => x.taskId), ids8);
  assert.deepEqual(rep.ni, { mean: 0, lower: 0 });
  assert.equal(rep.mechanism.thinking.nTreated, 24, 'the unregistered task is not in the mechanism either');
  assert.equal(rep.secondaries.counts.A.counted, 24, 'nor in the secondaries');
  assert.equal(rep.secondaries.cost.C.runs, 16);
});

t('analyzeS5 does not depend on the order of the rows', () => {
  const rows = tasksOf(MIXED).map((r, i) => ({ ...r, usage: usageOf({ think: 100 + 7 * i, out: 900 + 3 * i, input: 1000 + i, cc: 50 }) }));
  const base = analyzeS5(rows, prereg(ids8, { bound: { method: 'percentile', resamples: 2000, seed: 4 } }));
  assert.deepEqual(analyzeS5(shuffle(rows, makeRng(8)), prereg(ids8, { bound: { method: 'percentile', resamples: 2000, seed: 4 } })), base);
  assert.deepEqual(analyzeS5([...rows].reverse(), prereg(ids8, { bound: { method: 'percentile', resamples: 2000, seed: 4 } })), base);
});

t('analyzeS5 changes neither its rows nor the (frozen) prereg', () => {
  const rows = deepFreeze(tasksOf(MIXED));
  const p = deepFreeze(prereg(ids8, { bound: { method: 'percentile', resamples: 2000, seed: 4 } }));
  assert.doesNotThrow(() => analyzeS5(rows, p));
  assert.doesNotThrow(() => selectCalibrated(rows));
  assert.doesNotThrow(() => perTaskScores(rows));
  assert.doesNotThrow(() => secondaries(rows, p));
  assert.doesNotThrow(() => mechanism(rows, p));
});

// A plain JSON value: no undefined, NaN, Infinity, Map, Set or class instance anywhere.
function assertPlainJson(v, where = 'report') {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') return assert.ok(Number.isFinite(v), `${where} is ${v}`);
  if (Array.isArray(v)) return v.forEach((x, i) => assertPlainJson(x, `${where}[${i}]`));
  assert.ok(v !== undefined, `${where} is undefined`);
  assert.equal(Object.getPrototypeOf(v), Object.prototype, `${where} is not a plain object`);
  for (const [k, x] of Object.entries(v)) assertPlainJson(x, `${where}.${k}`);
}

t('analyzeS5: the Report is a plain JSON-serializable object, with a value or null in every place (ruling R72)', () => {
  const rows = tasksOf(MIXED).map((r, i) => ({ ...r, usage: usageOf({ think: 100 + 7 * i, out: 900 + 3 * i, input: 1000 + i, cc: 50 }) }));
  for (const bound of [{ method: 'paired-t', resamples: 0, seed: 1 }, { method: 'percentile', resamples: 2000, seed: 1 }]) {
    const rep = analyzeS5(rows, prereg(ids8, { bound }));
    assertPlainJson(rep);
    assert.deepEqual(JSON.parse(JSON.stringify(rep)), rep);
  }
  assertPlainJson(analyzeS5([], prereg(['t0', 't1'])));
  assertPlainJson(analyzeS5(tk('t0', { A: '1', B: '0', C: '0' }), prereg(['t0'])));
});

// ---- simulate ----

const SIM = { nTasks: 12, runs: { A: 3, B: 3, C: 2 }, pA: [0.3, 0.95], deltaB: 0, deltaC: 0, trials: 120, seed: 17, method: 'paired-t', resamples: 0, margin: 0.15, alpha: 0.05 };
const throwsRange = (fn) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof RangeError;
  }
};

t('simulate is deterministic for a seed and returns niRate and gateRate in [0, 1]', () => {
  const a = simulate(SIM);
  assert.deepEqual(a, simulate(SIM));
  assert.deepEqual(Object.keys(a).sort(), ['gateRate', 'niRate']);
  for (const v of Object.values(a)) assert.ok(v >= 0 && v <= 1);
  // A rate is a share of the trials.
  assert.equal(Number.isInteger(a.niRate * SIM.trials), true);
  assert.equal(Number.isInteger(a.gateRate * SIM.trials), true);
  assert.notDeepEqual(simulate({ ...SIM, seed: 18 }), a);
  const pct = { ...SIM, method: 'percentile', resamples: 200, trials: 40 };
  assert.deepEqual(simulate(pct), simulate(pct));
});

t('simulate: niRate is the NI bound alone and gateRate the gate bound alone (ruling R69), exactly', () => {
  const base = simulate({ ...SIM, deltaB: -0.15, deltaC: 0 });
  // The NI rate does not move with deltaC, the gate rate does not move with deltaB: the two arms' data are on their own streams.
  assert.equal(simulate({ ...SIM, deltaB: -0.15, deltaC: -0.4 }).niRate, base.niRate);
  assert.notEqual(simulate({ ...SIM, deltaB: -0.15, deltaC: -0.4 }).gateRate, base.gateRate, 'deltaC moves the gate rate');
  assert.equal(simulate({ ...SIM, deltaB: 0.1, deltaC: 0 }).gateRate, base.gateRate);
  assert.notEqual(simulate({ ...SIM, deltaB: 0.1, deltaC: 0 }).niRate, base.niRate, 'deltaB moves the NI rate');
  // A worse B lowers the NI rate; a worse C raises the gate rate.
  assert.ok(simulate({ ...SIM, deltaB: -0.3 }).niRate < simulate({ ...SIM, deltaB: 0 }).niRate);
  assert.ok(simulate({ ...SIM, deltaC: -0.3 }).gateRate > simulate({ ...SIM, deltaC: 0 }).gateRate);
});

t('simulate clamps pA + delta to [0, 1] (ruling R69)', () => {
  // pA is 1 on every task. deltaB +0.5 would be 1.5 and deltaC -5 would be -4: clamped, B passes every run and C none.
  const all = { ...SIM, pA: [1, 1], trials: 30 };
  assert.deepEqual(simulate({ ...all, deltaB: 0.5, deltaC: -5 }), { niRate: 1, gateRate: 1 });
  // deltaB -5 clamps to 0: B fails every run, B - A = -1 on every task, so NI never holds; deltaC +5 clamps to 1: A - C = 0.
  assert.deepEqual(simulate({ ...all, deltaB: -5, deltaC: 5 }), { niRate: 0, gateRate: 0 });
  // pA is 0: a delta of -0.4 clamps to 0, so all three arms fail every run and both diffs are 0.
  const zero = simulate({ ...SIM, pA: [0, 0], deltaB: -0.4, deltaC: -0.4, trials: 30 });
  assert.deepEqual(zero, { niRate: 1, gateRate: 0 });
});

t('simulate reads the registered margin, alpha, method and run counts', () => {
  const s = { ...SIM, deltaB: -0.15, trials: 150 };
  // margin: the NI bound is compared with -margin.
  assert.ok(simulate({ ...s, margin: 0.6 }).niRate > simulate({ ...s, margin: 0.15 }).niRate);
  assert.equal(simulate({ ...SIM, pA: [1, 1], deltaB: -5, margin: 2, trials: 20 }).niRate, 1, 'a margin of 2 admits a diff of -1');
  assert.equal(simulate({ ...SIM, pA: [1, 1], deltaB: -5, margin: 0.9, trials: 20 }).niRate, 0, 'a margin of 0.9 does not');
  assert.equal(simulate({ ...SIM, pA: [1, 1], deltaB: -5, margin: 1, trials: 20 }).niRate, 0, 'a bound of exactly -margin does not hold: the comparison is strict');
  // alpha: a larger alpha is a looser bound.
  assert.ok(simulate({ ...s, alpha: 0.45 }).niRate > simulate({ ...s, alpha: 0.05 }).niRate);
  // method and resamples reach the bound: a percentile bootstrap needs resamples, paired-t does not.
  assert.throws(() => simulate({ ...SIM, method: 'percentile', resamples: 0, trials: 2 }), RangeError);
  assert.throws(() => simulate({ ...SIM, method: 'bootstrap', trials: 2 }), TypeError);
  assert.doesNotThrow(() => simulate({ ...SIM, method: 'percentile', resamples: 50, trials: 2 }));
  // No method named: the module default, which needs resamples exactly when it is the percentile bootstrap.
  assert.equal(throwsRange(() => simulate({ ...SIM, method: undefined, resamples: 0, trials: 2 })), DEFAULT_METHOD === 'percentile');
  // runs: more runs per arm is less noise, so the same shortfall is detected more often.
  assert.notDeepEqual(simulate({ ...s, runs: { A: 1, B: 1, C: 1 } }), simulate(s));
  assert.notDeepEqual(simulate({ ...s, runs: { A: 3, B: 1, C: 2 } }), simulate(s));
  assert.notDeepEqual(simulate({ ...s, runs: { A: 3, B: 3, C: 1 } }), simulate(s));
  assert.notDeepEqual(simulate({ ...s, runs: { A: 1, B: 3, C: 2 } }), simulate(s));
  assert.notDeepEqual(simulate({ ...s, nTasks: 30 }), simulate(s));
  assert.notDeepEqual(simulate({ ...s, pA: [0.6, 0.9] }), simulate(s));
});

// Measured once with the implementation, then fixed: a change to the data streams, the draw order, the run counts or the
// per-trial bound seeds shows here. The percentile scenario is the one that reaches the bound seeds (paired-t ignores them).
const PINNED_SIM = { niRate: 0.02, gateRate: 0.815 };
const PINNED_SIM_PERCENTILE = { niRate: 0.04, gateRate: 0.84 };
t('simulate: pinned rates for a fixed scenario, with each method', () => {
  assert.deepEqual(simulate({ ...SIM, deltaB: -0.15, deltaC: -0.3, trials: 200, seed: 5 }), PINNED_SIM);
  assert.deepEqual(simulate({ ...SIM, method: 'percentile', resamples: 300, deltaB: -0.15, deltaC: -0.3, trials: 300, seed: 5 }), PINNED_SIM_PERCENTILE);
});

t('simulate refuses what it cannot simulate, naming the field', () => {
  const bads = [
    [{ nTasks: 1 }, 'nTasks'], [{ nTasks: 2.5 }, 'nTasks'], [{ trials: 0 }, 'trials'], [{ runs: { A: 0, B: 3, C: 2 } }, 'runs'], [{ runs: { A: 3, B: 3 } }, 'runs'],
    [{ pA: [0.9, 0.3] }, 'pA'], [{ pA: [0.3, 1.2] }, 'pA'], [{ pA: [0.3] }, 'pA'], [{ margin: 0 }, 'margin'], [{ alpha: 1 }, 'alpha'], [{ deltaB: NaN }, 'deltaB'],
    [{ deltaC: Infinity }, 'deltaC'], [{ seed: 0.5 }, 'seed'], [{ method: 'bootstrap' }, 'method'],
  ];
  for (const [bad, field] of bads) {
    assert.throws(() => simulate({ ...SIM, ...bad }), (e) => (e instanceof TypeError || e instanceof RangeError) && e.message.includes(field), JSON.stringify(bad));
  }
  assert.doesNotThrow(() => simulate({ ...SIM, nTasks: 2, trials: 1 }));
});
