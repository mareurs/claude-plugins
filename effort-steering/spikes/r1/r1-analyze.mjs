// r1-analyze.mjs — the R1 analysis: the cheap screen (stage 1, arm C alone) and the paired check (stage 2, C against A).
// Pure: the caller loads the prereg and the rows. Definitions follow spikes/s5/analyze.mjs (rulings R63, R68, R149):
//   a row counts iff `final === true && infra === null` (isCounted); it passes iff grade.pass === true (isPass);
//   the unit is the task (an arm's score is the mean pass over its counted runs);
//   a task with a lost run (infra_exhausted, never recovered) is dropped from ALL arms.
//
//   analyzeR1(rows, prereg) -> { margin, alpha, method, stage, included, excluded, failedC, d, verdict, reason }
//
// stage 2 iff any counted row is arm A. Rows of arm B and of tasks the prereg does not list are ignored.
//   stage 1: a C failure anywhere (failedC, also in a task dropped for a lost run) -> 'needs_stage_2'; else every included task
//            has C === 1 -> 'support'.
//   'incomplete' (reason unmeasured_tasks): a registered task has no counted run, or a dropped task has an observed C failure.
//            Checked after the 'insufficient' rule and, in stage 1, after the C-failure rule; never 'support' on a partial run.
//   stage 2: d_i = C_i - A_i; d = pairedLowerBound(diffs, bound); 'support' iff d.lower > -margin (strict), else 'not_shown_safe'.
//   fewer than 2 included tasks -> 'insufficient' (no bound is computed).
// "support" means no harm found on these tasks, never "proven safe" (spec: "Limits the report must state").

import { isCounted, isPass, lostRunArms, pairedLowerBound } from '../s5/analyze.mjs';

const ARM_ORDER = ['A', 'C'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const share = (rows) => rows.filter(isPass).length / rows.length;

function assertOneRowPerRun(rows) {
  const seen = new Set();
  for (const r of rows) {
    if (!isCounted(r) || typeof r.runId !== 'string') continue;
    if (seen.has(r.runId)) throw new Error(`analyzeR1: two counted rows share the runId ${JSON.stringify(r.runId)}; one run counts once`);
    seen.add(r.runId);
  }
}

export function analyzeR1(rows, prereg) {
  const registered = prereg.tasks.map((task) => task.id);
  const known = new Set(registered);
  const relevant = (Array.isArray(rows) ? rows : []).filter((r) => isObject(r) && known.has(r.taskId) && ARM_ORDER.includes(r.arm));
  assertOneRowPerRun(relevant);

  const stage = relevant.some((r) => isCounted(r) && r.arm === 'A') ? 2 : 1;
  const needed = stage === 2 ? ARM_ORDER : ['C'];
  const lost = lostRunArms(relevant);
  const counted = (taskId, arm) => relevant.filter((r) => r.taskId === taskId && r.arm === arm && isCounted(r));

  const included = [];
  const excluded = [];
  for (const taskId of registered) {
    const lostArms = ARM_ORDER.filter((arm) => lost.get(taskId)?.has(arm));
    if (lostArms.length > 0) {
      excluded.push({ taskId, reason: `infra_exhausted_in_${lostArms.join('_')}` });
      continue;
    }
    const missing = needed.filter((arm) => counted(taskId, arm).length === 0);
    if (missing.length > 0) {
      excluded.push({ taskId, reason: `no_counted_run_in_${missing.join('_')}` });
      continue;
    }
    const c = counted(taskId, 'C');
    const a = counted(taskId, 'A');
    included.push({ taskId, C: share(c), A: stage === 2 ? share(a) : null, nC: c.length, nA: a.length });
  }

  // A C failure counts wherever it was observed, also in a task that was dropped for a lost run: a drop must not hide it.
  const failedC = registered.filter((taskId) => {
    const c = counted(taskId, 'C');
    return c.length > 0 && c.some((r) => !isPass(r));
  });
  const report = { margin: prereg.margin, alpha: prereg.alpha, method: prereg.bound.method, stage, included, excluded, failedC, d: null, verdict: null, reason: null };

  if (included.length < 2) return { ...report, verdict: 'insufficient', reason: 'too_few_tasks' };
  if (stage === 1 && failedC.length > 0) return { ...report, verdict: 'needs_stage_2' };
  // Unmeasured: a task with no counted run (a batch that stopped early, or an arm that never ran), or a dropped task with an
  // observed C failure. The claim would rest on fewer tasks than were registered, so it is not made.
  if (excluded.some((e) => e.reason.startsWith('no_counted_run') || failedC.includes(e.taskId))) {
    return { ...report, verdict: 'incomplete', reason: 'unmeasured_tasks' };
  }
  if (stage === 1) return { ...report, verdict: 'support' };
  const diffs = included.map((x) => x.C - x.A);
  const d = pairedLowerBound(diffs, { method: prereg.bound.method, resamples: prereg.bound.resamples, seed: prereg.bound.seed, alpha: prereg.alpha });
  return { ...report, d, verdict: d.lower > -prereg.margin ? 'support' : 'not_shown_safe' };
}
