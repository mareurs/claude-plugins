// r1-sim.mjs — a planted-truth simulation of the R1 two-stage decision (spec "Power").
//
//   simulateR1({ nTasks = 16, runs = 2, pA, trueDelta, trials, seed, method, resamples = 4000, margin = 0.15, alpha = 0.05 })
//     -> { supportRate, trials }
//
// Per trial and task: arm A passes each run with probability pA[i % pA.length]; arm C with that probability plus `trueDelta`,
// clamped to [0, 1]. Stage 1 rows (arm C) come first; the A rows are added only when analyzeR1 answers 'needs_stage_2', as in
// the real study. supportRate is the share of trials whose final verdict is 'support'. At trueDelta = -margin it is the false
// support rate, which should be about alpha; at trueDelta = 0 it is the power.

import { makeRng } from '../s4-prng.mjs';
import { analyzeR1 } from './r1-analyze.mjs';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function simulateR1({ nTasks = 16, runs = 2, pA, trueDelta, trials, seed, method = 'paired-t', resamples = 4000, margin = 0.15, alpha = 0.05 } = {}) {
  if (!Array.isArray(pA) || pA.length === 0 || !pA.every((p) => typeof p === 'number' && p >= 0 && p <= 1)) throw new RangeError('simulateR1: pA must be a non-empty array of probabilities in [0, 1]');
  if (!Number.isSafeInteger(trials) || trials < 1) throw new RangeError(`simulateR1: trials must be a safe integer >= 1, got ${String(trials)}`);
  if (typeof trueDelta !== 'number' || !Number.isFinite(trueDelta)) throw new RangeError('simulateR1: trueDelta must be a finite number');
  const ids = Array.from({ length: nTasks }, (_, i) => `sim-${String(i).padStart(3, '0')}`);
  const prereg = { margin, alpha, bound: { method, resamples: method === 'percentile' ? resamples : 0, seed }, tasks: ids.map((id) => ({ id })) };
  let support = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const rng = makeRng(seed, trial);
    const rowsFor = (arm, prob) => ids.flatMap((taskId, i) => Array.from({ length: runs }, (_, rep) => ({
      taskId, arm, runId: `${taskId}.${arm}.${rep}`, final: true, infra: null, grade: { pass: rng() < prob(i) },
    })));
    const stage1 = rowsFor('C', (i) => clamp01(pA[i % pA.length] + trueDelta));
    let report = analyzeR1(stage1, prereg);
    if (report.verdict === 'needs_stage_2') report = analyzeR1([...stage1, ...rowsFor('A', (i) => pA[i % pA.length])], prereg);
    if (report.verdict === 'support') support += 1;
  }
  return { supportRate: support / trials, trials };
}
