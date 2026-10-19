// analyze.mjs — the effort-toggle verdicts: the operator's pre-registered decision rules for step 0 and step 1, and the random arm's
// generator parameters. Pure: no file, no clock, no model. Never calls a model.
//
//   step0Verdict(runs, reg)  -> { positiveControl, up, down, counts, stop, detail }
//       runs = { 'F-L': Run[], 'F-X': Run[], 'F-LX': Run[], 'F-XL': Run[] }, reg = { switchAt, n, extension }
//       positiveControl 'pass' | 'fail'; up, down 'delivered' | 'not_delivered' | 'inconclusive' | 'needs_extension';
//       counts[arm] = { counted, broad, pass, meanCostUsd }; stop = string[]; detail.realized[arm] (below)
//   step1Verdict(runs, reg)  -> { quality, cost, harm, works, timing, incomplete, stop, detail }
//       runs = { L, X, T, P, R } (each Run[]; R-quality and R-other may be given too, for the audit stop only), reg = { qualityTask,
//       qualityRuns, otherRuns, costEstimator: 'run' | 'task' }
//   randomParams(tRuns)      -> { s, u, n, pUp, pDown, degenerate, expected: { share, upSwitches }, gap: { share, upSwitches } }
//   chainExpectation(pUp, pDown, n) -> { share, upSwitches }   the exact expectation of the mod's random chain
//
// Run = { runId, taskId, rep, pass: boolean | null, costUsd: number | null, excludedFor: string | null, secondTurn, broadAt: number[],
//         requests, shareXhigh, upSwitches } (check-runs also writes arm, calls, callLog; the verdicts do not read them).
//
// Rules implemented (spec "Decisions" C7, C8, C10; "Step 0"; "Step 1" success rule; "Blinding"), with the controller's rulings:
//   COUNTED. A run is counted when pass is a boolean (not null) and excludedFor is null. In step 0 a counted run with secondTurn true is
//   skipped (not counted) and the next rep counts (C7). Each arm takes its first n counted runs ordered by rep; with n + extension counted
//   runs it can pool the first n + extension. An arm with fewer than n counted runs is 'inconclusive' and counts shows how many it had.
//   BROAD. A run is broad when some broadAt entry is >= reg.switchAt (the main-request indices of broad checks, Task 6).
//   THRESHOLDS. At N counted runs "high" is broad >= ceil(3N/4) and "low" is broad <= floor(N/4): at n = 4 that is 3 and 1 (the spec's
//   3-of-4 and 1-of-4), at the pooled 8 it is 6 and 2 (C8). The positive control uses the n = 4 pair: F-X high, F-L low.
//   POSITIVE CONTROL (P5). When it fails, up and down are 'inconclusive' and stop holds 'positive_control_failed'. The control is not
//   demonstrated when F-X or F-L has fewer than n counted runs: then positiveControl is 'fail' (the type has no other value), stop holds
//   'positive_control_incomplete' (not 'failed': the spec says a failed control is final, an incomplete one is not), up/down inconclusive.
//   UP (F-LX). high -> 'delivered', low -> 'not_delivered'. DOWN (F-XL): low -> 'delivered', high -> 'not_delivered'. Any other count of
//   the first n (2 of 4) is 'needs_extension' while fewer than n + extension counted runs exist (C8: the extension applies only when the
//   control passed); with n + extension counted runs the pooled thresholds decide, anything between them is 'inconclusive'. An arm
//   whose first n runs already decide keeps that verdict whatever its later runs say (the extension is for the middle count only).
//   counts[arm] covers the runs the verdict used: the first n, or the pooled n + extension when the pooled thresholds decided it; its
//   meanCostUsd skips runs with a null costUsd and is null when none is known.
//   REALIZED (ruling P24, reporting only, no verdict reads it). detail.realized[arm] = { counted, meanShareXhigh, meanUpSwitches,
//   meanRequests } over the same used runs (counted = how many; a mean is null when no run has a finite value). It is what the arms did,
//   so the random arm's realized share and up-switches can be set beside T's.
//   STOP. 'positive_control_failed' / 'positive_control_incomplete'; for each arm with more than 2 runs excluded for 'audit' (P10:
//   excludedFor === 'audit'), 'audit:<arm>'; for each arm with more than 2 secondTurn runs (C7), 'secondTurn:<arm>'. Those two are
//   counted over every run of the arm, counted or not.
//
//   STEP 1 (no secondTurn rule). Counted as above. On reg.qualityTask each arm takes its first reg.qualityRuns counted runs by rep; on
//   every other task its first reg.otherRuns. QUALITY: passT >= passX - 1 AND passT - passP >= 3 on the quality task. COST (ruling P12,
//   the spec says run-weighted, the plan task-weighted, so the estimator is a REGISTRATION FIELD): reg.costEstimator must be 'run' or
//   'task', else a TypeError names the field. 'run' = total costUsd over the used runs divided by their number; 'task' = the mean over
//   tasks of each task's mean costUsd over its used runs. cost = T <= (L + X) / 2 with the registered estimator, equality passes;
//   detail.cost = { run: {L,X,T}, task: {L,X,T}, used } always carries both. HARM: passes over all other tasks, passT >= passL - 1.
//   COST and HARM use only the tasks the compared arms share (cost: L, X and T with a costed run; harm: L and T). TIMING (reported, not
//   part of works): passT - passR >= 2 on the quality task; null when R has no counted run there.
//   INCOMPLETE (ruling P11): over the union of the tasks L, X, T and P have runs for (in order of first appearance), an arm with no
//   counted run at all is listed by name; else each task it has no counted run on is '<arm>:<task>' and each task it has counted runs on
//   but none with a finite costUsd is '<arm>:<task>:cost' (order: arm L, X, T, P, then task). quality, cost and harm are still computed
//   from the data that exists but are PROVISIONAL while incomplete is non-empty. WORKS = quality && cost && harm; null whenever
//   incomplete is non-empty or a criterion could not be evaluated. A SHORT cell (fewer counted runs than registered, at least one) is
//   not incomplete: it still gives a verdict and is listed in detail.short as '<arm>:<task>:<counted>/<registered>' (an exclusion plus
//   a capped replacement can leave one; letting it block would let one exclusion veto the experiment). detail also carries the quality
//   passes, the harm totals and costTasks. detail.realized[arm] as in step 0 for L, X, T, P, R. detail.partlyCosted (ruling P24):
//   '<arm>:<task>:<costed>/<counted>' for each cell of L, X, T, P whose used runs have a null costUsd on some but not all of them
//   (all null is '<arm>:<task>:cost' in incomplete); both cost estimators average only the costed runs, so such a cell is reported.
//   STOP (ruling P23, spec Blinding): 'audit:<arm>' for each arm of L, X, T, P, R-quality, R-other with more than 2 runs excluded for
//   'audit' (over every run of the arm, counted or not; a plain R is an arm only when neither stratum is given). Empty when none.
//
//   RANDOM (C10, ruling P22). s = mean shareXhigh and u = mean upSwitches over tRuns, n = round(mean requests). The mod's chain starts at
//   'low' at request 0 and, at each of the n - 1 later requests, draws once: low -> xhigh with probability pUp, xhigh -> low with
//   probability pDown (register.ts levelChain; a draw u switches when u < p, so the probability is p). Over n requests its EXPECTED share
//   of xhigh requests and EXPECTED number of low -> xhigh switches are computed exactly by dynamic programming over the two states
//   (chainExpectation), not by a stationary formula (the chain is short and starts at low, so those are off by 19% to 43%).
//   randomParams solves chainExpectation(pUp, pDown, n) = (s, u) deterministically: for a given pUp the expected share falls as pDown
//   rises, so the pDown that gives share s is found by bisection (0 or 1 when s lies outside what pUp can give); the up-switch count
//   then rises with pUp along that curve, so pUp is found by bisection too. 100 halvings each, i.e. a tolerance far below double
//   precision of [0, 1]: the result matches the targets to ~1e-12 whenever they are reachable (a test checks 1e-6 against a second DP).
//   The targets can be unreachable (u above what share s allows, or s above (n - 1) / n because request 0 is low): the up-switch
//   equation is then solved with the share matched as closely as pUp allows, or pUp = 1 with the share matched, and `gap` says by how
//   much. expected = the chain's values at the returned parameters; gap.share and gap.upSwitches = (expected - target) / target (0 when
//   both are 0, 1 when only the target is 0). degenerate (pUp = pDown = 0) when s is 0, u is 0, or n (1 - s) is not positive (s 1,
//   n 0). Empty tRuns -> s = u = n = 0, degenerate. Non-finite fields are skipped in the means, so no NaN comes out.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ARMS0 = ['F-L', 'F-X', 'F-LX', 'F-XL'];

const isCounted = (run) => isObject(run) && typeof run.pass === 'boolean' && (run.excludedFor ?? null) === null;
const byRep = (runs) => [...runs].sort((a, b) => a.rep - b.rep);
const list = (v) => (Array.isArray(v) ? v.filter(isObject) : []);
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const mean = (values) => {
  const v = values.filter(finite);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
};
const isBroad = (run, switchAt) => Array.isArray(run.broadAt) && run.broadAt.some((i) => finite(i) && i >= switchAt);
const high = (N) => Math.ceil((3 * N) / 4);
const low = (N) => Math.floor(N / 4);

const summarize = (used, switchAt) => ({
  counted: used.length,
  broad: used.filter((r) => isBroad(r, switchAt)).length,
  pass: used.filter((r) => r.pass === true).length,
  meanCostUsd: mean(used.map((r) => r.costUsd)),
});

// What the used runs did (ruling P24): reporting only.
const realized = (rs) => ({
  counted: rs.length,
  meanShareXhigh: mean(rs.map((r) => r.shareXhigh)),
  meanUpSwitches: mean(rs.map((r) => r.upSwitches)),
  meanRequests: mean(rs.map((r) => r.requests)),
});

export function step0Verdict(runs, reg) {
  const { switchAt, n, extension } = reg ?? {};
  if (!finite(switchAt) || !Number.isInteger(n) || n < 1 || !Number.isInteger(extension) || extension < 0) {
    throw new TypeError('step0Verdict: reg needs a number switchAt, an integer n >= 1 and an integer extension >= 0');
  }
  const pool = n + extension;
  const all = {};
  const counted = {};
  for (const arm of ARMS0) {
    all[arm] = list(runs?.[arm]);
    counted[arm] = byRep(all[arm].filter((r) => isCounted(r) && r.secondTurn !== true));
  }
  const broadOf = (rs) => rs.filter((r) => isBroad(r, switchAt)).length;

  // Positive control: F-X broad in at least high(n), F-L broad in at most low(n).
  const controlRuns = counted['F-X'].length >= n && counted['F-L'].length >= n;
  const controlPass = controlRuns
    && broadOf(counted['F-X'].slice(0, n)) >= high(n)
    && broadOf(counted['F-L'].slice(0, n)) <= low(n);

  const used = {};
  for (const arm of ARMS0) used[arm] = counted[arm].slice(0, n);

  // 'high' | 'low' | 'inconclusive' | 'needs_extension' for one switch arm; sets used[arm] to the runs the verdict used.
  const direction = (arm) => {
    const c = counted[arm];
    if (!controlPass) return 'inconclusive';
    if (c.length < n) {
      used[arm] = c;
      return 'inconclusive';
    }
    const b = broadOf(c.slice(0, n));
    if (b >= high(n)) return 'high';
    if (b <= low(n)) return 'low';
    if (c.length < pool) return 'needs_extension';
    const pooled = c.slice(0, pool);
    used[arm] = pooled;
    const bp = broadOf(pooled);
    if (bp >= high(pool)) return 'high';
    if (bp <= low(pool)) return 'low';
    return 'inconclusive';
  };
  const upDir = direction('F-LX');
  const downDir = direction('F-XL');
  const verdict = (dir, deliveredWhen) => {
    if (dir === 'inconclusive' || dir === 'needs_extension') return dir;
    return dir === deliveredWhen ? 'delivered' : 'not_delivered';
  };

  const stop = [];
  if (!controlRuns) stop.push('positive_control_incomplete');
  else if (!controlPass) stop.push('positive_control_failed');
  for (const arm of ARMS0) if (all[arm].filter((r) => r.excludedFor === 'audit').length > 2) stop.push(`audit:${arm}`);
  for (const arm of ARMS0) if (all[arm].filter((r) => r.secondTurn === true).length > 2) stop.push(`secondTurn:${arm}`);

  const counts = {};
  const realizedOf = {};
  for (const arm of ARMS0) {
    counts[arm] = summarize(used[arm], switchAt);
    realizedOf[arm] = realized(used[arm]);
  }
  return {
    positiveControl: controlPass ? 'pass' : 'fail',
    up: verdict(upDir, 'high'),
    down: verdict(downDir, 'low'),
    counts,
    stop,
    detail: { realized: realizedOf },
  };
}

// ---- step 1 -----------------------------------------------------------------------------------------------------------------

// The used runs of one arm by task: the first `limit(task)` counted runs by rep. -> Map<taskId, Run[]>
function usedByTask(arm, limit) {
  const byTask = new Map();
  for (const r of byRep(list(arm).filter(isCounted))) {
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, []);
    byTask.get(r.taskId).push(r);
  }
  for (const [task, rs] of byTask) byTask.set(task, rs.slice(0, limit(task)));
  return byTask;
}

const passes = (rs) => rs.filter((r) => r.pass === true).length;

export function step1Verdict(runs, reg) {
  const { qualityTask, qualityRuns, otherRuns, costEstimator } = reg ?? {};
  if (typeof qualityTask !== 'string' || !Number.isInteger(qualityRuns) || qualityRuns < 1 || !Number.isInteger(otherRuns) || otherRuns < 1) {
    throw new TypeError('step1Verdict: reg needs a string qualityTask and integers qualityRuns >= 1 and otherRuns >= 1');
  }
  if (costEstimator !== 'run' && costEstimator !== 'task') {
    throw new TypeError(`step1Verdict: reg.costEstimator must be 'run' or 'task' (a registered choice), got ${JSON.stringify(costEstimator)}`);
  }
  const limit = (task) => (task === qualityTask ? qualityRuns : otherRuns);
  const by = {};
  for (const a of ['L', 'X', 'T', 'P', 'R']) by[a] = usedByTask(runs?.[a], limit);

  // INCOMPLETE (ruling P11): over the union of the tasks L, X, T and P have runs for (counted or not), in order of first appearance.
  // An arm with no counted run at all is listed by name; otherwise each task it has no counted run on is '<arm>:<task>', and each task
  // it has counted runs on but none with a finite costUsd is '<arm>:<task>:cost'. Order: arm L, X, T, P, then task order.
  const unionTasks = [];
  for (const a of ['L', 'X', 'T', 'P']) {
    for (const r of list(runs?.[a])) if (r.taskId !== undefined && !unionTasks.includes(r.taskId)) unionTasks.push(r.taskId);
  }
  const incomplete = [];
  for (const a of ['L', 'X', 'T', 'P']) {
    if (by[a].size === 0) {
      incomplete.push(a);
      continue;
    }
    for (const task of unionTasks) {
      if (!by[a].has(task)) incomplete.push(`${a}:${task}`);
      else if (mean(by[a].get(task).map((r) => r.costUsd)) === null) incomplete.push(`${a}:${task}:cost`);
    }
  }

  const qPass = (a) => (by[a].has(qualityTask) ? passes(by[a].get(qualityTask)) : null);
  const detail = { qualityPasses: { L: qPass('L'), X: qPass('X'), T: qPass('T'), P: qPass('P'), R: qPass('R') } };
  // A short cell (fewer counted runs than registered, but at least one) is reported, not incomplete.
  const short = [];
  for (const a of ['L', 'X', 'T', 'P', 'R']) {
    for (const [task, rs] of by[a]) if (rs.length < limit(task)) short.push(`${a}:${task}:${rs.length}/${limit(task)}`);
  }
  detail.short = short;
  // Ruling P24: reporting only. realized over the used runs of each arm; partlyCosted for a cell with some but not all runs costed.
  detail.realized = {};
  for (const a of ['L', 'X', 'T', 'P', 'R']) detail.realized[a] = realized([...by[a].values()].flat());
  detail.partlyCosted = [];
  for (const a of ['L', 'X', 'T', 'P']) {
    for (const [task, rs] of by[a]) {
      const costed = rs.filter((r) => finite(r.costUsd)).length;
      if (costed > 0 && costed < rs.length) detail.partlyCosted.push(`${a}:${task}:${costed}/${rs.length}`);
    }
  }

  // quality (provisional while incomplete is non-empty)
  let quality = null;
  const q = detail.qualityPasses;
  if (q.X !== null && q.T !== null && q.P !== null) quality = q.T >= q.X - 1 && q.T - q.P >= 3;

  // cost over the tasks L, X and T all have costed runs on (provisional while incomplete is non-empty). Both estimators are
  // returned; reg.costEstimator picks the one the boolean uses.
  const costOf = (a, task) => mean(by[a].get(task).map((r) => r.costUsd));
  const costTasks = [...by.T.keys()].filter((task) => by.L.has(task) && by.X.has(task)
    && costOf('L', task) !== null && costOf('X', task) !== null && costOf('T', task) !== null);
  const taskWeighted = (a) => mean(costTasks.map((task) => costOf(a, task)));
  const runWeighted = (a) => mean(costTasks.flatMap((task) => by[a].get(task).map((r) => r.costUsd)));
  const est = (f) => ({ L: f('L'), X: f('X'), T: f('T') });
  let cost = null;
  detail.cost = { run: { L: null, X: null, T: null }, task: { L: null, X: null, T: null }, used: costEstimator };
  if (costTasks.length > 0) {
    detail.cost = { run: est(runWeighted), task: est(taskWeighted), used: costEstimator };
    const c = detail.cost[costEstimator];
    cost = c.T <= (c.L + c.X) / 2;
  }
  detail.costTasks = costTasks.length;

  // harm over the other tasks that L and T both have (provisional while incomplete is non-empty)
  const harmTasks = [...by.T.keys()].filter((task) => task !== qualityTask && by.L.has(task));
  let harm = null;
  detail.harm = { tasks: harmTasks.length, L: null, T: null };
  if (harmTasks.length > 0) {
    const sum = (a) => harmTasks.reduce((acc, task) => acc + passes(by[a].get(task)), 0);
    detail.harm = { tasks: harmTasks.length, L: sum('L'), T: sum('T') };
    harm = detail.harm.T >= detail.harm.L - 1;
  }

  const timing = q.T !== null && q.R !== null ? q.T - q.R >= 2 : null;
  const works = incomplete.length > 0 || quality === null || cost === null || harm === null ? null : quality && cost && harm;
  // Ruling P23: blinding. A plain R is an arm only when neither stratum arm is given.
  const stop = [];
  const stratified = runs?.['R-quality'] !== undefined || runs?.['R-other'] !== undefined;
  for (const a of ['L', 'X', 'T', 'P', ...(stratified ? ['R-quality', 'R-other'] : ['R'])]) {
    if (list(runs?.[a]).filter((r) => r.excludedFor === 'audit').length > 2) stop.push(`audit:${a}`);
  }
  return { quality, cost, harm, works, timing, incomplete, stop, detail };
}

// ---- the random arm ---------------------------------------------------------------------------------------------------------

// The mod's chain (register.ts levelChain) over `n` main requests: request 0 is low; each later request draws once, low -> xhigh with
// probability pUp, xhigh -> low with probability pDown. -> the exact expected share of xhigh requests and expected number of
// low -> xhigh switches, by dynamic programming over P(xhigh at request i).
export function chainExpectation(pUp, pDown, n) {
  let high = 0; // P(request i is xhigh)
  let sum = 0;
  let ups = 0;
  for (let i = 0; i < n; i += 1) {
    sum += high;
    if (i < n - 1) {
      ups += pUp * (1 - high);
      high = high * (1 - pDown) + (1 - high) * pUp;
    }
  }
  return { share: n > 0 ? sum / n : 0, upSwitches: ups };
}

const HALVINGS = 100;
// The pDown in [0, 1] whose expected share is s for this pUp (the share falls as pDown rises); 0 or 1 when s is out of reach.
function solvePDown(pUp, s, n) {
  if (chainExpectation(pUp, 0, n).share <= s) return 0;
  if (chainExpectation(pUp, 1, n).share >= s) return 1;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < HALVINGS; k += 1) {
    const mid = (lo + hi) / 2;
    if (chainExpectation(pUp, mid, n).share > s) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const relGap = (expected, target) => (target === 0 ? (expected === 0 ? 0 : 1) : (expected - target) / target);

export function randomParams(tRuns) {
  const rs = list(tRuns);
  const s = mean(rs.map((r) => r.shareXhigh)) ?? 0;
  const u = mean(rs.map((r) => r.upSwitches)) ?? 0;
  const n = Math.round(mean(rs.map((r) => r.requests)) ?? 0);
  let pUp = 0;
  let pDown = 0;
  const degenerate = s === 0 || u === 0 || !(n * (1 - s) > 0);
  if (!degenerate) {
    // The up-switch count rises with pUp along the curve of pDown(pUp) that holds the share at s: bisect pUp on it.
    const upsAt = (a) => chainExpectation(a, solvePDown(a, s, n), n).upSwitches;
    if (upsAt(1) <= u) {
      pUp = 1;
    } else {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < HALVINGS; k += 1) {
        const mid = (lo + hi) / 2;
        if (upsAt(mid) < u) lo = mid;
        else hi = mid;
      }
      pUp = (lo + hi) / 2;
    }
    pDown = solvePDown(pUp, s, n);
  }
  const expected = chainExpectation(pUp, pDown, n);
  return { s, u, n, pUp, pDown, degenerate, expected, gap: { share: relGap(expected.share, s), upSwitches: relGap(expected.upSwitches, u) } };
}
