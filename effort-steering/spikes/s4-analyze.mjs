// s4-analyze.mjs — turns S4 experiment rows into the verdict that decides whether
// steering continues. Pure: the caller loads the prereg and builds the rows.
//
// THE STATISTIC (ruling R24). The runner balances the arms WITHIN each prompt, so the
// comparison is made within each prompt too: per prompt, delta = median(treated) -
// median(holdout); a prompt CONTRIBUTES when both arms have at least one valid row. T is
// the mean over contributing prompts of the direction-signed delta (`down`: -delta, `up`:
// +delta), so a larger T always means more movement in the registered direction. Pooling
// all prompts' rows into one median per arm let prompts with different thinking levels
// manufacture a GO from noise (final review C-1), so the pooled medians below are
// DESCRIPTION only, never the statistic.
//
// THE P-VALUE. One-sided permutation test: the arm labels are shuffled WITHIN each
// contributing prompt (each prompt keeps its own treated/holdout counts), `permutations`
// draws from a PRNG seeded with the registered `seed`, and
// p = (1 + #{T_perm >= T_obs}) / (1 + permutations). The draws use stream 1 of the seed;
// the runner's arm plan uses stream 0, so the two are independent.
//
// THE VERDICT. insufficient_data when either arm's total valid n is below minPerArm, or no
// prompt contributes; otherwise mechanism_pass iff T >= effectSizeThinkingTokens AND
// p <= alpha; else mechanism_fail.
//
// Rows that cannot be trusted (no safe-integer promptIndex >= 0, unknown arm, a number that
// is not finite and >= 0, or cache_creation > input_total, which the definition of
// input_total forbids) are excluded from both arms and counted in nIgnored; they never
// count toward minPerArm. A number that cannot be computed honestly (an empty arm, or any
// gate while the data is insufficient) is null, never a zero that looks like a measurement.

import { median } from './s3-replay.mjs';
import { makeRng } from './s4-prng.mjs';

const ARMS = new Set(['treated', 'holdout']);
const PERMUTATION_STREAM = 1;
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function isValidRow(r) {
  return r !== null && typeof r === 'object' && Number.isSafeInteger(r.promptIndex) && r.promptIndex >= 0
    && ARMS.has(r.arm)
    && isCount(r.thinking_tokens) && isCount(r.cache_creation) && isCount(r.input_total)
    && r.cache_creation <= r.input_total;
}

// Reads exactly the prereg fields it uses; anything else is the loader's job.
function checkPrereg(p) {
  if (p === null || typeof p !== 'object') throw new TypeError('prereg must be an object');
  if (p.direction !== 'down' && p.direction !== 'up') throw new TypeError("prereg.direction must be 'down' or 'up'");
  // A zero/negative effect or a zero floor would let an empty or null-effect arm pass.
  if (typeof p.effectSizeThinkingTokens !== 'number' || !Number.isFinite(p.effectSizeThinkingTokens) || !(p.effectSizeThinkingTokens > 0)) {
    throw new TypeError('prereg.effectSizeThinkingTokens must be a finite number > 0');
  }
  if (!Number.isInteger(p.minPerArm) || p.minPerArm < 1) {
    throw new TypeError('prereg.minPerArm must be an integer >= 1');
  }
  if (typeof p.alpha !== 'number' || !Number.isFinite(p.alpha) || !(p.alpha > 0 && p.alpha < 1)) {
    throw new TypeError('prereg.alpha must be a number strictly between 0 and 1');
  }
  if (!Number.isSafeInteger(p.permutations) || p.permutations < 1) {
    throw new TypeError('prereg.permutations must be a safe integer >= 1');
  }
  if (!Number.isSafeInteger(p.seed)) throw new TypeError('prereg.seed must be a safe integer');
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// null for an empty arm; 0 (not NaN) when the arm has rows but no input tokens.
function cacheShare(arm) {
  if (arm.length === 0) return null;
  const total = sum(arm.map((r) => r.input_total));
  return total === 0 ? 0 : sum(arm.map((r) => r.cache_creation)) / total;
}

// Valid rows grouped per prompt, in promptIndex order: { promptIndex, treated: [], holdout: [] }.
function groupByPrompt(valid) {
  const groups = new Map();
  for (const r of valid) {
    if (!groups.has(r.promptIndex)) groups.set(r.promptIndex, { promptIndex: r.promptIndex, treated: [], holdout: [] });
    groups.get(r.promptIndex)[r.arm].push(r.thinking_tokens);
  }
  return [...groups.values()].sort((a, b) => a.promptIndex - b.promptIndex);
}

// Mean over the given prompts of sign * (median(treated) - median(holdout)).
function signedMean(pools, sign) {
  let s = 0;
  for (const { treated, holdout } of pools) s += sign * (median(treated) - median(holdout));
  return s / pools.length;
}

// One-sided permutation p-value. Each draw relabels every contributing prompt on its own: a
// partial Fisher-Yates picks a uniformly random set of nTreated of that prompt's values for
// the treated label, and the rest stay holdout. Ties count as "at least as extreme".
function permutationP(contributing, sign, tObs, permutations, seed) {
  const rng = makeRng(seed, PERMUTATION_STREAM);
  const work = contributing.map((g) => ({ values: [...g.treated, ...g.holdout], nTreated: g.treated.length }));
  const tol = 1e-9 * Math.max(1, Math.abs(tObs));
  let atLeast = 0;
  for (let b = 0; b < permutations; b++) {
    const pools = work.map(({ values, nTreated }) => {
      for (let i = 0; i < nTreated; i++) {
        const j = i + Math.floor(rng() * (values.length - i));
        const tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
      }
      return { treated: values.slice(0, nTreated), holdout: values.slice(nTreated) };
    });
    if (signedMean(pools, sign) >= tObs - tol) atLeast++;
  }
  return (1 + atLeast) / (1 + permutations);
}

export function analyzeArms(rows, prereg) {
  checkPrereg(prereg);
  const all = Array.isArray(rows) ? rows : [];
  const valid = all.filter(isValidRow);
  const treated = valid.filter((r) => r.arm === 'treated');
  const holdout = valid.filter((r) => r.arm === 'holdout');

  // Pooled, descriptive only. Medians only when the arm has rows: median([]) is 0.
  const medianTreated = treated.length ? median(treated.map((r) => r.thinking_tokens)) : null;
  const medianHoldout = holdout.length ? median(holdout.map((r) => r.thinking_tokens)) : null;
  const cacheShareTreated = cacheShare(treated);
  const cacheShareHoldout = cacheShare(holdout);

  const groups = groupByPrompt(valid);
  const perPrompt = groups.map((g) => {
    const mT = g.treated.length ? median(g.treated) : null;
    const mH = g.holdout.length ? median(g.holdout) : null;
    return { promptIndex: g.promptIndex, nTreated: g.treated.length, nHoldout: g.holdout.length, medianTreated: mT, medianHoldout: mH, delta: mT !== null && mH !== null ? mT - mH : null };
  });
  const contributing = groups.filter((g) => g.treated.length > 0 && g.holdout.length > 0);

  // Per arm, never pooled: a short arm is insufficient whatever the other holds.
  const enough = treated.length >= prereg.minPerArm && holdout.length >= prereg.minPerArm && contributing.length > 0;

  let verdict = 'insufficient_data';
  let signedDelta = null;
  let pValue = null;
  if (enough) {
    const sign = prereg.direction === 'down' ? -1 : 1;
    signedDelta = signedMean(contributing, sign);
    pValue = permutationP(contributing, sign, signedDelta, prereg.permutations, prereg.seed);
    verdict = signedDelta >= prereg.effectSizeThinkingTokens && pValue <= prereg.alpha ? 'mechanism_pass' : 'mechanism_fail';
  }
  // A registered gate below the sample floor is unknown, not true (R18).
  const cacheOk = enough ? cacheShareTreated <= cacheShareHoldout : null;

  return {
    nTreated: treated.length,
    nHoldout: holdout.length,
    nIgnored: all.length - valid.length,
    nPrompts: contributing.length,
    medianTreated,
    medianHoldout,
    perPrompt,
    signedDelta,
    pValue,
    cacheShareTreated,
    cacheShareHoldout,
    cacheOk,
    verdict,
  };
}
