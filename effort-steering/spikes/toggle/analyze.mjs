// analyze.mjs — the effort-toggle verdicts: the operator's pre-registered decision rules for step 0 and step 1, and the random arm's
// generator parameters. Pure: no file, no clock, no model. Never calls a model.
//
//   step0Verdict(runs, reg)  -> { positiveControl, up, down, counts, stop }
//       runs = { 'F-L': Run[], 'F-X': Run[], 'F-LX': Run[], 'F-XL': Run[] }, reg = { switchAt, n, extension }
//       positiveControl 'pass' | 'fail'; up, down 'delivered' | 'not_delivered' | 'inconclusive' | 'needs_extension';
//       counts[arm] = { counted, broad, pass, meanCostUsd }; stop = string[]
//   step1Verdict(runs, reg)  -> { quality, cost, harm, works, timing, incomplete, detail }
//       runs = { L, X, T, P, R } (each Run[]), reg = { qualityTask, qualityRuns, otherRuns }
//   randomParams(tRuns)      -> { s, u, n, pUp, pDown, degenerate }
//
// Run = { runId, taskId, rep, pass: boolean | null, costUsd: number | null, excludedFor: string | null, secondTurn, broadAt: number[],
//         requests, shareXhigh, upSwitches }. Task 8 builds it from the rows and checkRun (evidence.mjs).
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
//   STOP. 'positive_control_failed' / 'positive_control_incomplete'; for each arm with more than 2 runs excluded for 'audit' (P10:
//   excludedFor === 'audit'), 'audit:<arm>'; for each arm with more than 2 secondTurn runs (C7), 'secondTurn:<arm>'. Those two are
//   counted over every run of the arm, counted or not.
//
//   STEP 1 (no secondTurn rule). Counted as above. On reg.qualityTask each arm takes its first reg.qualityRuns counted runs by rep; on
//   every other task its first reg.otherRuns. QUALITY: passT >= passX - 1 AND passT - passP >= 3 on the quality task. COST: the task-
//   weighted mean (mean over tasks of the task's mean costUsd over its used runs) of T <= (L + X) / 2, equality passes. HARM: passes
//   over all other tasks, passT >= passL - 1. COST and HARM use only the tasks both compared arms have (cost: L, X and T; harm: L and
//   T), so a task missing in one arm cannot tilt the comparison; with every arm complete that is every task. TIMING (reported, not part
//   of works): passT - passR >= 2 on the quality task; null when R has no counted run there. WORKS = quality && cost && harm; null when
//   L, X, T or P has no counted run (their names go in incomplete) or a criterion could not be evaluated. A (arm, task) cell with fewer
//   counted runs than asked is listed in detail.short and does not block a verdict. detail carries the numbers behind the verdicts.
//
//   RANDOM (C10). s = mean shareXhigh, u = mean upSwitches, n = mean requests over tRuns; pUp = u / (n (1 - s)); pDown = pUp (1 - s) / s;
//   both clipped to [0, 1] after being computed. degenerate (pUp = pDown = 0) when s is 0, u is 0, or n (1 - s) is not positive (s 1,
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
  for (const arm of ARMS0) counts[arm] = summarize(used[arm], switchAt);
  return {
    positiveControl: controlPass ? 'pass' : 'fail',
    up: verdict(upDir, 'high'),
    down: verdict(downDir, 'low'),
    counts,
    stop,
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
  const { qualityTask, qualityRuns, otherRuns } = reg ?? {};
  if (typeof qualityTask !== 'string' || !Number.isInteger(qualityRuns) || qualityRuns < 1 || !Number.isInteger(otherRuns) || otherRuns < 1) {
    throw new TypeError('step1Verdict: reg needs a string qualityTask and integers qualityRuns >= 1 and otherRuns >= 1');
  }
  const limit = (task) => (task === qualityTask ? qualityRuns : otherRuns);
  const by = {};
  for (const a of ['L', 'X', 'T', 'P', 'R']) by[a] = usedByTask(runs?.[a], limit);
  const present = (a) => by[a].size > 0;
  const incomplete = ['L', 'X', 'T', 'P'].filter((a) => !present(a));

  const qPass = (a) => (by[a].has(qualityTask) ? passes(by[a].get(qualityTask)) : null);
  const detail = { qualityPasses: { L: qPass('L'), X: qPass('X'), T: qPass('T'), P: qPass('P'), R: qPass('R') } };
  const short = [];
  for (const a of ['L', 'X', 'T', 'P', 'R']) {
    for (const [task, rs] of by[a]) if (rs.length < limit(task)) short.push(`${a}:${task}`);
  }
  detail.short = short;

  // quality
  let quality = null;
  const q = detail.qualityPasses;
  if (q.X !== null && q.T !== null && q.P !== null) quality = q.T >= q.X - 1 && q.T - q.P >= 3;

  // cost over the tasks that L, X and T all have
  const taskCost = (a, task) => mean(by[a].get(task).map((r) => r.costUsd));
  const costTasks = [...by.T.keys()].filter((task) => by.L.has(task) && by.X.has(task)
    && taskCost('L', task) !== null && taskCost('X', task) !== null && taskCost('T', task) !== null);
  const weighted = (a) => mean(costTasks.map((task) => taskCost(a, task)));
  let cost = null;
  detail.cost = { tasks: costTasks.length, L: null, X: null, T: null };
  if (costTasks.length > 0) {
    detail.cost = { tasks: costTasks.length, L: weighted('L'), X: weighted('X'), T: weighted('T') };
    cost = detail.cost.T <= (detail.cost.L + detail.cost.X) / 2;
  }

  // harm over the other tasks that L and T both have
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
  return { quality, cost, harm, works, timing, incomplete, detail };
}

// ---- the random arm ---------------------------------------------------------------------------------------------------------

const clip01 = (x) => Math.min(1, Math.max(0, x));

export function randomParams(tRuns) {
  const rs = list(tRuns);
  const s = mean(rs.map((r) => r.shareXhigh)) ?? 0;
  const u = mean(rs.map((r) => r.upSwitches)) ?? 0;
  const n = mean(rs.map((r) => r.requests)) ?? 0;
  const denom = n * (1 - s);
  if (s === 0 || u === 0 || !(denom > 0)) return { s, u, n, pUp: 0, pDown: 0, degenerate: true };
  const pUp = u / denom;
  const pDown = (pUp * (1 - s)) / s;
  return { s, u, n, pUp: clip01(pUp), pDown: clip01(pDown), degenerate: false };
}
