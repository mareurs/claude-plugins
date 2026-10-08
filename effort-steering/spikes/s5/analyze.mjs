// analyze.mjs — the S5 analysis: per-task scores, the paired non-inferiority bound, the validity gate, the mechanism check,
// secondaries, calibration selection and a planted-truth simulation. Pure: the caller loads the prereg (prereg.mjs) and
// reads the rows (run.mjs's Row); nothing here touches the clock, the environment, the filesystem or a model.
//
// The verdict this module computes IS the experiment's result, so each definition below is pinned by a test that fails when
// it flips (analyze.test.mjs).
//
// WHICH ROWS COUNT (ruling R63). A row counts iff `final === true && infra === null` and its arm is A, B or C, so an
// infrastructure row (an `infra_exhausted` row included) never counts. A counted row passes iff `grade !== null &&
// grade.pass === true`: a timeout is a counted failure.
//
// THE UNIT IS THE TASK (ruling R68a). Per task, an arm's score is the mean pass over that arm's counted runs, never the
// pooled runs of all tasks. A task with no counted run in every arm is excluded and listed; the rest are included. The paired
// differences are B - A (non-inferiority) and A - C (the validity gate), one per included task.
//
// THE BOUND (ruling R68b, c). pairedLowerBound(diffs, { method, resamples, seed, alpha }) -> { mean, lower }; `mean` is the
// mean of the given diffs and `lower` the one-sided lower bound at `alpha`.
//   percentile  resample the tasks with replacement `resamples` times from makeRng(seed, 7) and take the type-1 empirical
//               alpha-quantile of the resampled means: sorted[max(0, ceil(alpha * resamples - 1e-9) - 1)]. The 1e-9 keeps
//               floating-point noise (0.07 * 100 is 7.000000000000001) from moving the index.
//   paired-t    mean - t(1 - alpha, n - 1) * sd / sqrt(n), with the sample sd (n - 1) and the Student-t quantile computed
//               numerically (t(0.95, 31) = 1.6955, checked against the t density).
// Both need at least 2 diffs (RangeError otherwise). DEFAULT_METHOD is the method simulate and pairedLowerBound use when none
// is named; analyzeS5 always uses the registered one (prereg.bound.method). The default is 'paired-t' (ruling R76), against the
// brief's tie rule: both methods pass the brief's three simulation assertions at the registered seed, but over seeds 1 to 40 the
// percentile bootstrap's false non-inferiority rate at a true Delta of -0.15 averaged 0.0594 (anti-conservative at N = 32, about 8
// standard errors above 0.05) against 0.0482 for paired-t, and the spec's criterion (l.185) is about 5 percent. The percentile's
// seed-20261008 pass (0.063) is luck. Both stay selectable by the registration (see analyze.sim.test.mjs).
//
// THE VERDICT (ruling R68d). 'uninformative' unless gateLower > 0; then 'non_inferior' iff niLower > -margin, else
// 'not_shown_safe'. Both comparisons are strict.
//
// THE MECHANISM (ruling R62). B is `treated`, A is `holdout`, taskIndex is `promptIndex`, and analyzeArms runs with direction
// 'down', the registered effect, alpha, permutations and seed, and minPerArm the included TASK count (not a row count: analyzeArms
// counts rows per arm, and one ignored row must not turn a met floor into insufficient_data). Three analyses, each
// reading its measured count and cache_creation and input_total from the SAME usage part (analyzeArms ignores a row without
// them, silently except for nIgnored): `thinking` (usage.main.thinking, the registered test), `output` (usage.main.output) and
// `total` (usage.total.thinking, descriptive). The population is the counted rows of the included tasks, arms A and B.
//
// ONE RUN COUNTS ONCE (ruling R78). analyzeS5 throws when two counted rows share a runId. Rows of a task the prereg does not list
// are ignored and counted in `ignoredRows`.
//
// SECONDARIES (rulings R64, R70, R79, R80) are descriptive. Every one reads the counted rows of the INCLUDED tasks only (an excluded
// task is dropped from all arms, never from one), except `infraRows` and `excludedTasks`, which are about exclusion. They are:
// cost per resolved task, pass^3, counts (counted, timeouts, testsNotRun, infraRows, thinkingFieldMissing, p2pRegressions), the
// median wall time and diff size per arm (the median of an even count is the mean of the two middle values; null for none),
// discordant tasks, and the log ratio of B over A for output and thinking.
//
// THE SIGN TEST (ruling R80). `signTest` is the exact sign test on the included tasks' B - A: counts of B better, A better and
// ties, and the exact two-sided binomial p over the non-tied tasks (1 when none is non-tied). A descriptive robustness check.
//
// THE REPORT (ruling R72). analyzeS5 returns a plain JSON-serializable object (no undefined, NaN, Map):
//   { margin, alpha, method,                    the registered values read
//     included: [{ taskId, A, B, C, nA, nB, nC }],  registered order
//     excluded: [{ taskId, reason }],           registered order; reason 'no_counted_run_in_<arms>' (e.g. 'no_counted_run_in_C')
//     ignoredRows,                              rows that are not objects or name a task the prereg does not list
//     ni: { mean, lower } | null,               B - A; null when fewer than 2 tasks are included
//     gate: { mean, lower } | null,             A - C
//     signTest: { bBetter, aBetter, ties, p },  B - A on the included tasks
//     verdict, reason,                          reason null, 'too_few_tasks' or 'gate_failed' (when uninformative)
//     mechanism: { thinking, output, total },
//     secondaries: { excludedTasks, cost, counts, medians: { wallMs, diffSize }, pass3, discordant, logRatio } }
// The report holds no input row. The rows' order does not matter: tasks are taken in registered order (analyzeS5) or id order
// (the other functions), so one rows file always gives one report.

import { analyzeArms } from '../s4-analyze.mjs';
import { makeRng } from '../s4-prng.mjs';

export const ARMS = Object.freeze(['A', 'B', 'C']);
export const METHODS = Object.freeze(['percentile', 'paired-t']);
export const DEFAULT_METHOD = 'paired-t';

const BOUND_STREAM = 7; // pairedLowerBound's resampling
const LOG_RATIO_STREAM = Object.freeze({ output: 8, thinking: 9 }); // ruling R70
const LOG_RATIO_MIN_RESAMPLES = 2000;
const SIM_SEED_STREAM = 3; // simulate: the per-trial bound seeds
const SIM_DATA_STREAM = 100; // simulate: trial k draws pA, A, B, C from streams 100 + 4k .. 103 + 4k (never 7)

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isCost = (v) => isFiniteNumber(v) && v >= 0;
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => sum(xs) / xs.length;
const perArm = (fn) => Object.fromEntries(ARMS.map((arm) => [arm, fn(arm)]));

// ---- which rows count ----

export function isCounted(r) {
  return isObject(r) && typeof r.taskId === 'string' && ARMS.includes(r.arm) && r.final === true && r.infra === null;
}

export function isPass(r) {
  return isObject(r) && isObject(r.grade) && r.grade.pass === true;
}

// Map<taskId, { A: Row[], B: Row[], C: Row[] }> of the COUNTED rows. A task with rows of no counted kind is still listed (with
// empty arms), so that it is reported as excluded instead of vanishing.
function countedByTask(rows) {
  const byTask = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isObject(r) || typeof r.taskId !== 'string') continue;
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, { A: [], B: [], C: [] });
    if (isCounted(r)) byTask.get(r.taskId)[r.arm].push(r);
  }
  return byTask;
}

const passShare = (rs) => rs.filter(isPass).length / rs.length;

// scores: Map<taskId, { A, B, C, nA, nB, nC }> of the included tasks, by id; excluded: [{ taskId, reason }], by id.
export function perTaskScores(rows) {
  const scores = new Map();
  const excluded = [];
  const byTask = countedByTask(rows);
  for (const taskId of [...byTask.keys()].sort(byString)) {
    const arms = byTask.get(taskId);
    const missing = ARMS.filter((arm) => arms[arm].length === 0);
    if (missing.length > 0) {
      excluded.push({ taskId, reason: `no_counted_run_in_${missing.join('_')}` });
      continue;
    }
    scores.set(taskId, { A: passShare(arms.A), B: passShare(arms.B), C: passShare(arms.C), nA: arms.A.length, nB: arms.B.length, nC: arms.C.length });
  }
  return { scores, excluded };
}

// ---- the Student-t quantile ----
//
// P(T > t) for t >= 0 is half the regularised incomplete beta I_x(df/2, 1/2) at x = df / (df + t^2); the quantile is found by
// bisection on that tail, so a tail near 0 (the side a lower bound asks for) is never computed as 1 - something.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

// The continued fraction of the incomplete beta (modified Lentz).
function betaContinuedFraction(a, b, x) {
  const TINY = 1e-300;
  const nudge = (v) => (Math.abs(v) < TINY ? TINY : v);
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 / nudge(1 - (qab * x) / qap);
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 / nudge(1 + aa * d);
    c = nudge(1 + aa / c);
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 / nudge(1 + aa * d);
    c = nudge(1 + aa / c);
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) return h;
  }
  throw new Error(`tQuantile: the continued fraction did not converge for a = ${a}, b = ${b}, x = ${x}`);
}

function regularizedBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

const tUpperTail = (t, df) => 0.5 * regularizedBeta(df / (df + t * t), df / 2, 0.5);

// t such that P(T <= t) = p for a Student-t with `df` degrees of freedom (any real df > 0).
export function tQuantile(p, df) {
  if (!(typeof p === 'number' && p > 0 && p < 1)) throw new RangeError(`tQuantile: p must be a number strictly between 0 and 1, got ${String(p)}`);
  if (!(isFiniteNumber(df) && df > 0)) throw new RangeError(`tQuantile: df must be a finite number > 0, got ${String(df)}`);
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  const tail = 1 - p;
  let lo = 0;
  let hi = 1;
  while (tUpperTail(hi, df) > tail) {
    lo = hi;
    hi *= 2;
  }
  for (let i = 0; i < 200 && hi - lo > 1e-15 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (tUpperTail(mid, df) > tail) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- the bound ----

// The type-1 empirical p-quantile of an ascending array: sorted[max(0, ceil(p * n - 1e-9) - 1)] (ruling R68b).
export function quantile1(sorted, p) {
  if (!(typeof p === 'number' && p > 0 && p < 1)) throw new RangeError(`quantile1: p must be a number strictly between 0 and 1, got ${String(p)}`);
  if (!(sorted.length >= 1)) throw new RangeError('quantile1: nothing to take a quantile of');
  return sorted[Math.max(0, Math.ceil(p * sorted.length - 1e-9) - 1)];
}

// The means of `resamples` resamples (with replacement, one draw per value) of `values`, ascending.
function sortedResampleMeans(values, resamples, rng) {
  const n = values.length;
  const means = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)];
    means[b] = s / n;
  }
  return means.sort();
}

export function pairedLowerBound(diffs, { method = DEFAULT_METHOD, resamples, seed, alpha } = {}) {
  if (!Array.isArray(diffs) || !diffs.every(isFiniteNumber)) throw new TypeError('pairedLowerBound: diffs must be an array of finite numbers');
  if (!METHODS.includes(method)) throw new TypeError(`pairedLowerBound: method must be one of ${METHODS.join(', ')}, got ${String(method)}`);
  if (!(typeof alpha === 'number' && alpha > 0 && alpha < 1)) throw new RangeError(`pairedLowerBound: alpha must be a number strictly between 0 and 1, got ${String(alpha)}`);
  const n = diffs.length;
  if (n < 2) throw new RangeError(`pairedLowerBound: at least 2 diffs are needed, got ${n}`);
  const m = mean(diffs);
  if (method === 'paired-t') {
    const sd = Math.sqrt(sum(diffs.map((d) => (d - m) ** 2)) / (n - 1));
    return { mean: m, lower: m - (tQuantile(1 - alpha, n - 1) * sd) / Math.sqrt(n) };
  }
  if (!(Number.isSafeInteger(resamples) && resamples >= 1)) throw new RangeError(`pairedLowerBound: resamples must be a safe integer >= 1 for the percentile method, got ${String(resamples)}`);
  return { mean: m, lower: quantile1(sortedResampleMeans(diffs, resamples, makeRng(seed, BOUND_STREAM)), alpha) };
}

// ---- the sign test and the median (ruling R80) ----

// The exact sign test on per-task differences (B - A): a positive difference is B better, a negative one A better, an exact zero a
// tie. p is the exact two-sided binomial p over the non-tied tasks, min(1, 2 * P(X <= the smaller side)), and 1 when none is
// non-tied (there is no evidence either way). Descriptive robustness check (spec l.181, ruling R80), not the registered test.
export function signTest(diffs) {
  if (!Array.isArray(diffs) || !diffs.every(isFiniteNumber)) throw new TypeError('signTest: diffs must be an array of finite numbers');
  const bBetter = diffs.filter((d) => d > 0).length;
  const aBetter = diffs.filter((d) => d < 0).length;
  const decided = bBetter + aBetter;
  const p = decided === 0 ? 1 : Math.min(1, 2 * binomialHalfCdf(Math.min(bBetter, aBetter), decided));
  return { bBetter, aBetter, ties: diffs.length - decided, p };
}

// The median; the mean of the two middle values for an even count; null for no values (never a 0 that looks like a measurement).
export function medianOrNull(values) {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// P(X <= k) for X ~ Binomial(m, 1/2), by the term recurrence (m is a task count, far below the 0.5 ** m underflow at 1074).
function binomialHalfCdf(k, m) {
  let term = 0.5 ** m;
  let cdf = term;
  for (let i = 0; i < k; i++) {
    term = (term * (m - i)) / (i + 1);
    cdf += term;
  }
  return cdf;
}

// ---- the verdict ----

export function verdict({ gateLower, niLower, margin } = {}) {
  if (!isFiniteNumber(gateLower)) throw new TypeError(`verdict: gateLower must be a finite number, got ${String(gateLower)}`);
  if (!isFiniteNumber(niLower)) throw new TypeError(`verdict: niLower must be a finite number, got ${String(niLower)}`);
  if (!(isFiniteNumber(margin) && margin > 0)) throw new TypeError(`verdict: margin must be a finite number > 0, got ${String(margin)}`);
  if (!(gateLower > 0)) return 'uninformative';
  return niLower > -margin ? 'non_inferior' : 'not_shown_safe';
}

// ---- calibration ----

// Which tasks stay in the measured set after the calibration run (A x 2, C x 1). Dropped, in this order of test: 'not_measured'
// (no counted A run or no counted C run: a task whose every run was infrastructure cannot be judged, ruling R71),
// 'never_solved' (A passes 0 of its runs), 'effort_idle' (A passes every run and C passes every run). Both lists are by id.
export function selectCalibrated(rows) {
  const kept = [];
  const dropped = [];
  const byTask = countedByTask(rows);
  for (const taskId of [...byTask.keys()].sort(byString)) {
    const { A, C } = byTask.get(taskId);
    if (A.length === 0 || C.length === 0) {
      dropped.push({ taskId, reason: 'not_measured' });
      continue;
    }
    const aPasses = A.filter(isPass).length;
    const cPasses = C.filter(isPass).length;
    if (aPasses === 0) dropped.push({ taskId, reason: 'never_solved' });
    else if (aPasses === A.length && cPasses === C.length) dropped.push({ taskId, reason: 'effort_idle' });
    else kept.push(taskId);
  }
  return { kept, dropped };
}

// ---- the mechanism ----

export function mechanism(rows, prereg) {
  const included = new Set(perTaskScores(rows).scores.keys());
  const pool = (Array.isArray(rows) ? rows : []).filter((r) => isCounted(r) && (r.arm === 'A' || r.arm === 'B') && included.has(r.taskId));
  const m = prereg.mechanism;
  const analysis = {
    direction: 'down',
    effectSizeThinkingTokens: m.effectSizeThinkingTokens,
    minPerArm: Math.max(1, included.size), // analyzeArms wants an integer >= 1; with no included task there are no rows either
    alpha: m.alpha,
    permutations: m.permutations,
    seed: m.seed,
  };
  // The measured count and the cache fields come from one usage part, so a row either has all three or is ignored (and counted).
  const arms = (partName, field) =>
    pool.map((r) => ({
      promptIndex: r.taskIndex,
      arm: r.arm === 'B' ? 'treated' : 'holdout',
      thinking_tokens: r.usage?.[partName]?.[field],
      cache_creation: r.usage?.[partName]?.cache_creation,
      input_total: r.usage?.[partName]?.input_total,
    }));
  return {
    thinking: analyzeArms(arms('main', 'thinking'), analysis),
    output: analyzeArms(arms('main', 'output'), analysis),
    total: analyzeArms(arms('total', 'thinking'), analysis),
  };
}

// ---- secondaries ----

// The size of a row's diff, insertions + deletions, or null when it has no usable one (no grade, or a grade whose diff is null).
function diffSize(r) {
  const diff = r.grade?.diff;
  if (!isObject(diff) || !isFiniteNumber(diff.insertions) || !isFiniteNumber(diff.deletions) || diff.insertions < 0 || diff.deletions < 0) return null;
  return diff.insertions + diff.deletions;
}

// The mean of usage.main[field] over the rows, or null when a row has no usable count.
function usageMean(rs, field) {
  const values = rs.map((r) => r.usage?.main?.[field]);
  return values.length > 0 && values.every((v) => isFiniteNumber(v) && v >= 0) ? mean(values) : null;
}

// Per-task log(mean B / mean A) of usage.main[field]; a task with a missing or zero mean in either arm is left out and counted.
function logRatioSummary(scores, byTask, field, prereg) {
  const logs = [];
  let nSkipped = 0;
  for (const taskId of scores.keys()) {
    const arms = byTask.get(taskId);
    const a = usageMean(arms.A, field);
    const b = usageMean(arms.B, field);
    if (a === null || b === null || a === 0 || b === 0) nSkipped += 1;
    else logs.push(Math.log(b / a));
  }
  const meanLogRatio = logs.length > 0 ? mean(logs) : null;
  let lower = null;
  let upper = null;
  if (logs.length >= 2) {
    const resamples = Math.max(prereg.bound.resamples, LOG_RATIO_MIN_RESAMPLES);
    const sorted = sortedResampleMeans(logs, resamples, makeRng(prereg.bound.seed, LOG_RATIO_STREAM[field]));
    lower = quantile1(sorted, prereg.alpha);
    upper = quantile1(sorted, 1 - prereg.alpha);
  }
  return { n: logs.length, nSkipped, meanLogRatio, ratio: meanLogRatio === null ? null : Math.exp(meanLogRatio), lower, upper };
}

// C(c, 3) / C(n, 3).
const passCaret3 = (c, n) => (c < 3 ? 0 : (c * (c - 1) * (c - 2)) / (n * (n - 1) * (n - 2)));

export function secondaries(rows, prereg) {
  const all = (Array.isArray(rows) ? rows : []).filter((r) => isObject(r) && ARMS.includes(r.arm));
  const { scores, excluded } = perTaskScores(all);
  const byTask = countedByTask(all);
  // Ruling R79 (spec: a task with a persistent infrastructure failure "is dropped from all arms, never from one"): every secondary
  // reads the counted rows of the INCLUDED tasks only, so an excluded task adds nothing to one arm and not to another. The two
  // exceptions are `infraRows` and `excludedTasks`, which are about exclusion and read every row given.
  const counted = perArm((arm) => [...scores.keys()].flatMap((taskId) => byTask.get(taskId)[arm]));

  // Cost per resolved task (failures counted): the cost of every counted run over the number of passing counted runs. A run with
  // no cost reading (a timeout may leave no JSON) adds nothing and is counted in `missing`.
  const cost = perArm((arm) => {
    const rs = counted[arm];
    const usd = sum(rs.map((r) => r.costUsd).filter(isCost));
    const resolved = rs.filter(isPass).length;
    return { usd, runs: rs.length, resolved, missing: rs.filter((r) => !isCost(r.costUsd)).length, perResolved: resolved > 0 ? usd / resolved : null };
  });

  // A timeout is read from exit.timedOut, never inferred from a missing grade. p2pRegressions is the number of counted runs whose
  // grade names a pass-to-pass test that FAILED (notRun is not a failure here).
  const counts = perArm((arm) => ({
    counted: counted[arm].length,
    timeouts: counted[arm].filter((r) => r.exit?.timedOut === true).length,
    testsNotRun: counted[arm].filter((r) => r.testsRunBeforeDone === false).length,
    infraRows: all.filter((r) => r.arm === arm && r.infra !== null && r.infra !== undefined).length,
    thinkingFieldMissing: counted[arm].filter((r) => r.usage?.main?.thinkingFieldMissing > 0).length,
    p2pRegressions: counted[arm].filter((r) => Array.isArray(r.grade?.p2p?.failed) && r.grade.p2p.failed.length > 0).length,
  }));

  // Medians over the counted rows of the included tasks (ruling R80): the run's wall time, and the size of its diff (insertions +
  // deletions) over the rows whose grade has a diff.
  const medians = {
    wallMs: perArm((arm) => medianOrNull(counted[arm].map((r) => r.wallMs).filter((v) => isFiniteNumber(v) && v >= 0))),
    diffSize: perArm((arm) => medianOrNull(counted[arm].map(diffSize).filter((v) => v !== null))),
  };

  // pass^3 per included task is C(c, 3) / C(n, 3) over its n counted runs, c of them passing; a task with n < 3 is left out and counted.
  const pass3 = perArm((arm) => {
    const values = [];
    let skipped = 0;
    for (const taskId of scores.keys()) {
      const rs = byTask.get(taskId)[arm];
      if (rs.length < 3) skipped += 1;
      else values.push(passCaret3(rs.filter(isPass).length, rs.length));
    }
    return { value: values.length > 0 ? mean(values) : null, tasks: values.length, skipped };
  });

  const discordant = [...scores]
    .filter(([, s]) => s.A !== s.B)
    .map(([taskId, s]) => ({ taskId, A: s.A, B: s.B }))
    .sort((x, y) => x.B - x.A - (y.B - y.A)); // the sort is stable and `scores` is by id, so equal differences stay in id order

  return {
    excludedTasks: excluded.length,
    cost,
    counts,
    medians,
    pass3,
    discordant,
    logRatio: { output: logRatioSummary(scores, byTask, 'output', prereg), thinking: logRatioSummary(scores, byTask, 'thinking', prereg) },
  };
}

// ---- the report ----

// One run must never count twice (ruling R78): Task 10's resume skips a final run, so two counted rows with one runId mean a
// corrupted rows file, and a silent double count would weight one run twice. A retry or infrastructure row shares its run's id
// legitimately and is not counted, so only counted rows are compared.
function assertOneRowPerRun(rows) {
  const seen = new Set();
  for (const r of rows) {
    if (!isCounted(r)) continue;
    if (seen.has(r.runId)) throw new Error(`analyzeS5: two counted rows share runId ${String(r.runId)}: one run must never count twice`);
    seen.add(r.runId);
  }
}


export function analyzeS5(rows, prereg) {
  const all = Array.isArray(rows) ? rows : [];
  const registered = prereg.tasks.map((task) => task.id);
  const known = new Set(registered);
  const mine = all.filter((r) => isObject(r) && known.has(r.taskId));
  assertOneRowPerRun(mine);
  const { scores, excluded: unscored } = perTaskScores(mine);
  const reasons = new Map(unscored.map((e) => [e.taskId, e.reason]));

  const included = [];
  const excluded = [];
  for (const taskId of registered) {
    if (scores.has(taskId)) included.push({ taskId, ...scores.get(taskId) });
    else excluded.push({ taskId, reason: reasons.get(taskId) ?? `no_counted_run_in_${ARMS.join('_')}` });
  }

  let ni = null;
  let gate = null;
  let outcome = 'uninformative';
  let reason = 'too_few_tasks';
  if (included.length >= 2) {
    const bound = { method: prereg.bound.method, resamples: prereg.bound.resamples, seed: prereg.bound.seed, alpha: prereg.alpha };
    ni = pairedLowerBound(included.map((s) => s.B - s.A), bound);
    gate = pairedLowerBound(included.map((s) => s.A - s.C), bound);
    outcome = verdict({ gateLower: gate.lower, niLower: ni.lower, margin: prereg.margin });
    reason = outcome === 'uninformative' ? 'gate_failed' : null;
  }

  return {
    margin: prereg.margin,
    alpha: prereg.alpha,
    method: prereg.bound.method,
    included,
    excluded,
    ignoredRows: all.length - mine.length,
    ni,
    gate,
    signTest: signTest(included.map((s) => s.B - s.A)),
    verdict: outcome,
    reason,
    mechanism: mechanism(mine, prereg),
    secondaries: secondaries(mine, prereg),
  };
}

// ---- the planted-truth simulation (ruling R69) ----

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// The number of passes in `n` runs of pass probability p. A p outside [0, 1] is refused rather than silently read as 0 or 1.
function passes(n, p, rng) {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`simulate: a pass probability must be in [0, 1], got ${p}`);
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k += 1;
  return k;
}

// How often the registered bounds would hold on data with a planted truth. Per trial, `nTasks` tasks get a pass rate pA drawn
// uniformly from [lo, hi]; B and C pass at clamp(pA + deltaB) and clamp(pA + deltaC); `runs.A/B/C` runs are drawn per arm and
// the task scores are the pass shares. niRate is the share of trials whose NI bound alone holds (niLower > -margin), gateRate
// the share whose gate bound alone holds (gateLower > 0). pA, A, B and C each draw from a stream of their own, so the NI rate
// does not move with deltaC and the gate rate does not move with deltaB, and each trial's bound seed is derived from `seed`.
export function simulate({ nTasks, runs, pA, deltaB, deltaC, trials, seed, method = DEFAULT_METHOD, resamples, margin, alpha } = {}) {
  if (!(Number.isSafeInteger(nTasks) && nTasks >= 2)) throw new RangeError(`simulate: nTasks must be an integer >= 2, got ${String(nTasks)}`);
  if (!isObject(runs) || !ARMS.every((arm) => Number.isSafeInteger(runs[arm]) && runs[arm] >= 1)) throw new RangeError('simulate: runs must be { A, B, C }, each an integer >= 1');
  if (!(Array.isArray(pA) && pA.length === 2 && pA[0] >= 0 && pA[0] <= pA[1] && pA[1] <= 1)) throw new RangeError('simulate: pA must be [lo, hi] with 0 <= lo <= hi <= 1');
  if (!isFiniteNumber(deltaB) || !isFiniteNumber(deltaC)) throw new TypeError('simulate: deltaB and deltaC must be finite numbers');
  if (!(Number.isSafeInteger(trials) && trials >= 1)) throw new RangeError(`simulate: trials must be an integer >= 1, got ${String(trials)}`);
  if (!METHODS.includes(method)) throw new TypeError(`simulate: method must be one of ${METHODS.join(', ')}, got ${String(method)}`);
  if (!(isFiniteNumber(margin) && margin > 0)) throw new RangeError(`simulate: margin must be a finite number > 0, got ${String(margin)}`);
  if (!(typeof alpha === 'number' && alpha > 0 && alpha < 1)) throw new RangeError(`simulate: alpha must be a number strictly between 0 and 1, got ${String(alpha)}`);
  const [lo, hi] = pA;
  const seeds = makeRng(seed, SIM_SEED_STREAM);
  let ni = 0;
  let gate = 0;
  for (let k = 0; k < trials; k++) {
    const draw = (j) => makeRng(seed, SIM_DATA_STREAM + 4 * k + j);
    const [rngP, rngA, rngB, rngC] = [draw(0), draw(1), draw(2), draw(3)];
    const niDiffs = new Array(nTasks);
    const gateDiffs = new Array(nTasks);
    for (let i = 0; i < nTasks; i++) {
      const p = lo + (hi - lo) * rngP();
      const a = passes(runs.A, p, rngA) / runs.A;
      const b = passes(runs.B, clamp01(p + deltaB), rngB) / runs.B;
      const c = passes(runs.C, clamp01(p + deltaC), rngC) / runs.C;
      niDiffs[i] = b - a;
      gateDiffs[i] = a - c;
    }
    const bound = { method, resamples, seed: Math.floor(seeds() * 0x7fffffff), alpha };
    if (pairedLowerBound(niDiffs, bound).lower > -margin) ni += 1;
    if (pairedLowerBound(gateDiffs, bound).lower > 0) gate += 1;
  }
  return { niRate: ni / trials, gateRate: gate / trials };
}
