// s4-analyze.mjs — turns S4 experiment rows into the verdict that decides whether
// steering continues. Pure: the caller loads the prereg and builds the rows.
//
// Rows that cannot be trusted (unknown arm, or a number that is not finite and
// >= 0) are excluded from both arms and counted in nIgnored; they never count
// toward minPerArm. A number that cannot be computed honestly (an empty arm, a
// short arm for delta) is null, never a zero that looks like a measurement.

import { median } from './s3-replay.mjs';

const ARMS = new Set(['treated', 'holdout']);
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function isValidRow(r) {
  return r !== null && typeof r === 'object' && ARMS.has(r.arm)
    && isCount(r.thinking_tokens) && isCount(r.cache_creation) && isCount(r.input_total);
}

// Reads exactly the three prereg fields it uses; anything else is the loader's job.
function checkPrereg(p) {
  if (p === null || typeof p !== 'object') throw new TypeError('prereg must be an object');
  if (p.direction !== 'down' && p.direction !== 'up') throw new TypeError("prereg.direction must be 'down' or 'up'");
  if (typeof p.effectSizeThinkingTokens !== 'number' || !Number.isFinite(p.effectSizeThinkingTokens)) {
    throw new TypeError('prereg.effectSizeThinkingTokens must be a finite number');
  }
  if (typeof p.minPerArm !== 'number' || !Number.isFinite(p.minPerArm)) {
    throw new TypeError('prereg.minPerArm must be a finite number');
  }
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// null for an empty arm; 0 (not NaN) when the arm has rows but no input tokens.
function cacheShare(arm) {
  if (arm.length === 0) return null;
  const total = sum(arm.map((r) => r.input_total));
  return total === 0 ? 0 : sum(arm.map((r) => r.cache_creation)) / total;
}

export function analyzeArms(rows, prereg) {
  checkPrereg(prereg);
  const all = Array.isArray(rows) ? rows : [];
  const valid = all.filter(isValidRow);
  const treated = valid.filter((r) => r.arm === 'treated');
  const holdout = valid.filter((r) => r.arm === 'holdout');

  // Medians only when the arm has rows: median([]) is 0, which must not leak out.
  const medianTreated = treated.length ? median(treated.map((r) => r.thinking_tokens)) : null;
  const medianHoldout = holdout.length ? median(holdout.map((r) => r.thinking_tokens)) : null;
  const cacheShareTreated = cacheShare(treated);
  const cacheShareHoldout = cacheShare(holdout);
  const cacheOk = cacheShareTreated === null || cacheShareHoldout === null
    ? null
    : cacheShareTreated <= cacheShareHoldout;

  const enough = treated.length >= prereg.minPerArm && holdout.length >= prereg.minPerArm;
  const delta = enough ? medianTreated - medianHoldout : null;

  let verdict = 'insufficient_data';
  if (enough) {
    const effect = prereg.direction === 'down' ? -delta : delta;
    verdict = effect >= prereg.effectSizeThinkingTokens ? 'mechanism_pass' : 'mechanism_fail';
  }

  return {
    nTreated: treated.length,
    nHoldout: holdout.length,
    nIgnored: all.length - valid.length,
    medianTreated,
    medianHoldout,
    delta,
    cacheShareTreated,
    cacheShareHoldout,
    cacheOk,
    verdict,
  };
}
