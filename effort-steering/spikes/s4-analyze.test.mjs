// s4-analyze.test.mjs — vectors for the S4 verdict. Each condition that can flip
// the verdict (sign, arm labels, threshold equality, direction, cache comparison,
// per-arm minimum, median vs mean, per-prompt statistic, permutation p-value, alpha,
// seed) has a test that fails when it is changed.
//
// The single-prompt vectors below register alpha 0.9, so their verdict is decided by the
// effect-size gate: with tied values the median statistic has a coarse permutation
// distribution (3 treated at 100 vs 3 holdout at 300 has exact p = 10/20, because any
// assignment that keeps two 100s treated and two 300s holdout ties T_obs). The p-value,
// alpha and calibration tests further down register their own alpha.

import assert from 'node:assert/strict';
import { t } from '../core/testkit.mjs';
import { analyzeArms } from './s4-analyze.mjs';
import { makeRng } from './s4-prng.mjs';
import { planRuns } from './s4-run.mjs';

const prereg = (over = {}) => ({ direction: 'down', effectSizeThinkingTokens: 150, minPerArm: 3, alpha: 0.9, permutations: 200, seed: 1, ...over });
const row = (arm, thinking_tokens, cache_creation = 0, input_total = 100, promptIndex = 0) => ({ promptIndex, arm, thinking_tokens, cache_creation, input_total });
const arm = (name, tokens, promptIndex = 0) => tokens.map((v) => row(name, v, 0, 100, promptIndex));
const rows = (treated, holdout, promptIndex = 0) => [...arm('treated', treated, promptIndex), ...arm('holdout', holdout, promptIndex)];

t('treated 100 vs holdout 300, down, effect 150: mechanism_pass', () => {
  const r = analyzeArms(rows([100, 100, 100], [300, 300, 300]), prereg());
  assert.equal(r.verdict, 'mechanism_pass');
  assert.equal(r.signedDelta, 200); // down: -(100 - 300)
  assert.equal(r.medianTreated, 100);
  assert.equal(r.medianHoldout, 300);
  assert.equal(r.nTreated, 3);
  assert.equal(r.nHoldout, 3);
});

t('same data with direction up: mechanism_fail', () => {
  assert.equal(analyzeArms(rows([100, 100, 100], [300, 300, 300]), prereg({ direction: 'up' })).verdict, 'mechanism_fail');
});

t('up passes when treated is higher by the effect size', () => {
  const r = analyzeArms(rows([300, 300, 300], [100, 100, 100]), prereg({ direction: 'up' }));
  assert.equal(r.verdict, 'mechanism_pass');
  assert.equal(r.signedDelta, 200); // up: +(300 - 100)
});

t('swapping the arm labels flips the verdict (down)', () => {
  assert.equal(analyzeArms(rows([300, 300, 300], [100, 100, 100]), prereg()).verdict, 'mechanism_fail');
});

t('swapping the arm labels flips the verdict (up)', () => {
  assert.equal(analyzeArms(rows([100, 100, 100], [300, 300, 300]), prereg({ direction: 'up' })).verdict, 'mechanism_fail');
});

t('down: delta exactly equal to the effect size passes, one token short fails', () => {
  assert.equal(analyzeArms(rows([150, 150, 150], [300, 300, 300]), prereg()).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(rows([151, 151, 151], [300, 300, 300]), prereg()).verdict, 'mechanism_fail');
});

t('up: delta exactly equal to the effect size passes, one token short fails', () => {
  const p = prereg({ direction: 'up' });
  assert.equal(analyzeArms(rows([300, 300, 300], [150, 150, 150]), p).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(rows([299, 299, 299], [150, 150, 150]), p).verdict, 'mechanism_fail');
});

t('down: an effect in the wrong direction fails, even if large', () => {
  assert.equal(analyzeArms(rows([1000, 1000, 1000], [100, 100, 100]), prereg()).verdict, 'mechanism_fail');
});

t('up: an effect in the wrong direction fails, even if large', () => {
  assert.equal(analyzeArms(rows([100, 100, 100], [1000, 1000, 1000]), prereg({ direction: 'up' })).verdict, 'mechanism_fail');
});

t('treated arm below minPerArm: insufficient_data, signedDelta and pValue null', () => {
  const r = analyzeArms(rows([100, 100], [300, 300, 300]), prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.signedDelta, null);
  assert.equal(r.pValue, null);
  assert.equal(r.nTreated, 2);
});

t('holdout arm below minPerArm: insufficient_data, signedDelta and pValue null', () => {
  const r = analyzeArms(rows([100, 100, 100], [300, 300]), prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.signedDelta, null);
  assert.equal(r.pValue, null);
});

t('exactly minPerArm in each arm is enough', () => {
  assert.equal(analyzeArms(rows([100, 100], [300, 300]), prereg({ minPerArm: 2 })).verdict, 'mechanism_pass');
});

t('a short arm is never a pass or fail even with a huge effect', () => {
  assert.equal(analyzeArms(rows([0], [100000, 100000, 100000]), prereg()).verdict, 'insufficient_data');
  assert.equal(analyzeArms(rows([0, 0, 0], [100000]), prereg()).verdict, 'insufficient_data');
});

t('cache share higher in treated: cacheOk false', () => {
  const data = [row('treated', 1, 50, 100), row('holdout', 1, 10, 100)];
  const r = analyzeArms(data, prereg({ minPerArm: 1 }));
  assert.equal(r.cacheShareTreated, 0.5);
  assert.equal(r.cacheShareHoldout, 0.1);
  assert.equal(r.cacheOk, false);
});

t('cache share lower in treated: cacheOk true', () => {
  const data = [row('treated', 1, 10, 100), row('holdout', 1, 50, 100)];
  assert.equal(analyzeArms(data, prereg({ minPerArm: 1 })).cacheOk, true);
});

t('equal cache shares: cacheOk true', () => {
  const data = [row('treated', 1, 20, 100), row('holdout', 1, 40, 200)];
  const r = analyzeArms(data, prereg({ minPerArm: 1 }));
  assert.equal(r.cacheShareTreated, r.cacheShareHoldout);
  assert.equal(r.cacheOk, true);
});

t('cache share is sum over sum, not a mean of per-row ratios', () => {
  const data = [row('treated', 1, 0, 100), row('treated', 1, 100, 100), row('treated', 1, 100, 300), row('holdout', 1, 0, 1)];
  assert.equal(analyzeArms(data, prereg({ minPerArm: 1 })).cacheShareTreated, 200 / 500);
});

t('cache failure does not change the mechanism verdict', () => {
  const data = rows([100, 100, 100], [300, 300, 300]).map((r) => (r.arm === 'treated' ? { ...r, cache_creation: 90 } : r));
  const r = analyzeArms(data, prereg());
  assert.equal(r.verdict, 'mechanism_pass');
  assert.equal(r.cacheOk, false);
});

t('empty input: insufficient_data with nulls, no NaN, no throw', () => {
  const r = analyzeArms([], prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.nTreated, 0);
  assert.equal(r.nHoldout, 0);
  assert.equal(r.nPrompts, 0);
  assert.deepEqual(r.perPrompt, []);
  for (const k of ['medianTreated', 'medianHoldout', 'signedDelta', 'pValue', 'cacheShareTreated', 'cacheShareHoldout', 'cacheOk']) {
    assert.equal(r[k], null, k);
  }
});

t('an empty arm gives null for that arm, not a real-looking zero', () => {
  const r = analyzeArms(arm('treated', [5, 5, 5]), prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.medianTreated, 5);
  assert.equal(r.medianHoldout, null);
  assert.equal(r.cacheShareHoldout, null);
  assert.equal(r.cacheOk, null);
  assert.equal(r.signedDelta, null);
});

t('non-array input does not throw and gives insufficient_data', () => {
  assert.equal(analyzeArms(undefined, prereg()).verdict, 'insufficient_data');
});

t('input_total 0 gives share 0, not NaN', () => {
  const data = [row('treated', 1, 0, 0), row('holdout', 1, 0, 0)];
  const r = analyzeArms(data, prereg({ minPerArm: 1 }));
  assert.equal(r.cacheShareTreated, 0);
  assert.equal(r.cacheShareHoldout, 0);
  assert.equal(r.cacheOk, true);
});

t('even-count arm uses the mean of the two middle values', () => {
  const r = analyzeArms(rows([100, 200, 300, 1000], [500, 500, 500]), prereg());
  assert.equal(r.medianTreated, 250);
});

t('median, not mean: an outlier does not move the verdict', () => {
  // mean of treated = 700 (would fail down), median = 100 (passes)
  assert.equal(analyzeArms(rows([100, 100, 2500], [300, 300, 300]), prereg()).verdict, 'mechanism_pass');
});

t('median, not mean, in the holdout arm too', () => {
  // holdout mean = 900 (would pass down), median = 100 (delta 0, fails)
  assert.equal(analyzeArms(rows([100, 100, 100], [100, 100, 2500]), prereg()).verdict, 'mechanism_fail');
});

t('an unsorted arm gives the right median', () => {
  const r = analyzeArms(rows([900, 100, 500], [30, 10, 20]), prereg());
  assert.equal(r.medianTreated, 500);
  assert.equal(r.medianHoldout, 20);
});

t('the input array and its rows are not mutated', () => {
  const data = rows([900, 100, 500], [30, 10, 20]);
  const copy = JSON.parse(JSON.stringify(data));
  analyzeArms(data, prereg());
  assert.deepEqual(data, copy);
});

t('rows with an unknown arm are ignored and counted, never count toward minPerArm', () => {
  const data = [...rows([100, 100], [300, 300, 300]), row('control', 100), row(undefined, 100), row('Treated', 100)];
  const r = analyzeArms(data, prereg());
  assert.equal(r.nTreated, 2);
  assert.equal(r.nIgnored, 3);
  assert.equal(r.verdict, 'insufficient_data');
});

t('rows with non-finite or negative numbers are ignored and counted', () => {
  const bad = [
    row('treated', NaN), row('treated', Infinity), row('treated', -1), row('treated', '100'),
    row('treated', 1, NaN), row('treated', 1, -5), row('treated', 1, 0, Infinity), row('treated', 1, 0, -1),
    { arm: 'treated' }, null, 'x',
  ];
  const r = analyzeArms([...rows([100, 100], [300, 300, 300]), ...bad], prereg());
  assert.equal(r.nTreated, 2);
  assert.equal(r.nIgnored, bad.length);
  assert.equal(r.verdict, 'insufficient_data');
});

t('a zero thinking_tokens row is valid and counted', () => {
  const r = analyzeArms(rows([0, 0, 0], [300, 300, 300]), prereg());
  assert.equal(r.nTreated, 3);
  assert.equal(r.nIgnored, 0);
  assert.equal(r.verdict, 'mechanism_pass');
});

t('a clean input reports nIgnored 0', () => {
  assert.equal(analyzeArms(rows([1, 1, 1], [2, 2, 2]), prereg()).nIgnored, 0);
});

t('unbalanced arms: 5 treated vs 2 holdout is insufficient, not a pass (no pooled count)', () => {
  const r = analyzeArms(rows([100, 100, 100, 100, 100], [300, 300]), prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.signedDelta, null);
  assert.equal(r.nTreated, 5);
  assert.equal(r.nHoldout, 2);
});

t('unbalanced arms: 2 treated vs 5 holdout is insufficient', () => {
  const r = analyzeArms(rows([100, 100], [300, 300, 300, 300, 300]), prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.signedDelta, null);
});

t('short but non-empty arms: cacheOk null, shares still reported', () => {
  const r = analyzeArms([row('treated', 1, 10, 100), row('holdout', 1, 50, 100)], prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.cacheOk, null);
  assert.equal(r.cacheShareTreated, 0.1);
  assert.equal(r.cacheShareHoldout, 0.5);
});

t('only the treated arm short: cacheOk null', () => {
  const r = analyzeArms(rows([1], [2, 2, 2]), prereg());
  assert.equal(r.cacheOk, null);
});

t('only the holdout arm short: cacheOk null', () => {
  const r = analyzeArms(rows([1, 1, 1], [2]), prereg());
  assert.equal(r.cacheOk, null);
});

t('fractional threshold, down: signedDelta 149.5', () => {
  const data = rows([150, 151], [300, 300]);
  const p = (e) => prereg({ minPerArm: 2, effectSizeThinkingTokens: e });
  assert.equal(analyzeArms(data, p(150)).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, p(149.5)).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(data, p(149.6)).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, p(150)).signedDelta, 149.5);
});

t('fractional threshold, up: signedDelta 150.5', () => {
  const data = rows([450, 451], [300, 300]);
  const p = (e) => prereg({ direction: 'up', minPerArm: 2, effectSizeThinkingTokens: e });
  assert.equal(analyzeArms(data, p(151)).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, p(150.5)).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(data, p(150.6)).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, p(150)).signedDelta, 150.5);
});

t('a hand-built prereg cannot pass with an empty arm or a non-positive effect', () => {
  const data = rows([100, 100, 100], [300, 300, 300]);
  assert.throws(() => analyzeArms([], prereg({ minPerArm: 0 })), TypeError);
  assert.throws(() => analyzeArms(arm('treated', [1]), prereg({ minPerArm: 0 })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ minPerArm: 2.5 })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ minPerArm: -1 })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ effectSizeThinkingTokens: 0 })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ effectSizeThinkingTokens: -10 })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ effectSizeThinkingTokens: Infinity })), TypeError);
});

t('a row with cache_creation > input_total is invalid: ignored and counted', () => {
  const data = [...rows([100, 100], [300, 300, 300]), row('treated', 100, 50, 0), row('treated', 100, 101, 100)];
  const r = analyzeArms(data, prereg());
  assert.equal(r.nTreated, 2);
  assert.equal(r.nIgnored, 2);
  assert.equal(r.verdict, 'insufficient_data');
});

t('cache_creation equal to input_total is valid', () => {
  const r = analyzeArms([row('treated', 1, 100, 100), row('holdout', 1, 0, 100)], prereg({ minPerArm: 1 }));
  assert.equal(r.nIgnored, 0);
  assert.equal(r.cacheShareTreated, 1);
  assert.equal(r.cacheOk, false);
});

t('a malformed prereg throws a TypeError', () => {
  const data = rows([1, 1, 1], [2, 2, 2]);
  assert.throws(() => analyzeArms(data, prereg({ direction: 'sideways' })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ direction: undefined })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ effectSizeThinkingTokens: undefined })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ effectSizeThinkingTokens: '150' })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ minPerArm: undefined })), TypeError);
  assert.throws(() => analyzeArms(data, prereg({ minPerArm: NaN })), TypeError);
  assert.throws(() => analyzeArms(data, undefined), TypeError);
});

t('a malformed prereg throws even on empty input', () => {
  assert.throws(() => analyzeArms([], prereg({ minPerArm: undefined })), TypeError);
});

// ---- R24: per-prompt statistic and the one-sided permutation test ----------------------

const P = (over = {}) => prereg({ minPerArm: 1, ...over });

// Exact one-sided p by full enumeration of the within-prompt label assignments (counts kept),
// as the fraction of assignments with T >= T_obs. The Monte-Carlo p must approach it.
function combos(n, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = start; i < n; i++) pick(i + 1, [...acc, i]);
  };
  pick(0, []);
  return out;
}
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function exactP(groups, direction) {
  const sign = direction === 'down' ? -1 : 1;
  const tOf = (gs) => gs.reduce((a, g) => a + sign * (med(g.t) - med(g.h)), 0) / gs.length;
  const tObs = tOf(groups.map(([t, h]) => ({ t, h })));
  const choices = groups.map(([t, h]) => {
    const vals = [...t, ...h];
    return combos(vals.length, t.length).map((idx) => ({ t: idx.map((i) => vals[i]), h: vals.filter((_, i) => !idx.includes(i)) }));
  });
  let total = 0;
  let atLeast = 0;
  const walk = (k, acc) => {
    if (k === choices.length) {
      total++;
      if (tOf(acc) >= tObs - 1e-9) atLeast++;
      return;
    }
    for (const c of choices[k]) walk(k + 1, [...acc, c]);
  };
  walk(0, []);
  return { tObs, p: atLeast / total, total };
}

t('T is the mean over contributing prompts of the signed per-prompt median delta; perPrompt is reported', () => {
  const data = [...rows([100, 100], [300, 300], 0), ...rows([1000], [1100], 1), row('treated', 7, 0, 100, 5)];
  const r = analyzeArms(data, prereg());
  assert.equal(r.nPrompts, 2);
  assert.equal(r.signedDelta, 150); // mean of 200 and 100
  assert.deepEqual(r.perPrompt, [
    { promptIndex: 0, nTreated: 2, nHoldout: 2, medianTreated: 100, medianHoldout: 300, delta: -200 },
    { promptIndex: 1, nTreated: 1, nHoldout: 1, medianTreated: 1000, medianHoldout: 1100, delta: -100 },
    { promptIndex: 5, nTreated: 1, nHoldout: 0, medianTreated: 7, medianHoldout: null, delta: null },
  ]);
  // pooled numbers stay as description
  assert.equal(r.nTreated, 4);
  assert.equal(r.nHoldout, 3);
  assert.equal(r.medianTreated, 100);
  assert.equal(r.medianHoldout, 300);
  assert.equal(r.verdict, 'mechanism_pass');
  assert.equal(analyzeArms(data, prereg({ effectSizeThinkingTokens: 150.5 })).verdict, 'mechanism_fail');
});

t('perPrompt is ordered by promptIndex as a number', () => {
  const r = analyzeArms([...rows([1], [2], 10), ...rows([1], [2], 2)], P());
  assert.deepEqual(r.perPrompt.map((g) => g.promptIndex), [2, 10]);
});

t('a pooled statistic would hide a real per-prompt effect; the per-prompt statistic finds it', () => {
  // prompt 0 (high): 3 treated at 700 vs 1 holdout at 1000; prompt 1 (low): 1 treated at 100
  // vs 3 holdout at 400. Every prompt moved down by 300, but the pooled medians are
  // treated 700 vs holdout 400, i.e. UP by 300. Exact within-prompt p = 1/16.
  const data = [...rows([700, 700, 700], [1000], 0), ...rows([100], [400, 400, 400], 1)];
  const r = analyzeArms(data, prereg({ effectSizeThinkingTokens: 250, alpha: 0.2, permutations: 2000 }));
  assert.equal(r.signedDelta, 300);
  assert.ok(r.medianTreated > r.medianHoldout, 'the pooled description points the wrong way');
  assert.ok(Math.abs(r.pValue - exactP([[[700, 700, 700], [1000]], [[100], [400, 400, 400]]], 'down').p) < 0.03, `p ${r.pValue}`);
  assert.equal(r.verdict, 'mechanism_pass');
});

t('the pooled-median false-GO scenario from the final review does not pass', () => {
  // No effect inside any prompt; the arms are unbalanced across prompts with very different
  // baselines, so the pooled medians differ by ~900 tokens.
  const data = [...rows([100, 102], [101], 0), ...rows([1001], [1000, 1002], 1)];
  const pooledT = -(med([100, 102, 1001]) - med([101, 1000, 1002]));
  assert.ok(pooledT >= 150, `sanity: the old pooled rule would have said GO (pooled T ${pooledT})`);
  const r = analyzeArms(data, prereg());
  assert.equal(r.signedDelta, 0);
  assert.equal(r.verdict, 'mechanism_fail');
});

t('swapping the arm labels flips the verdict (several prompts)', () => {
  const data = [...rows([100, 100], [300, 300], 0), ...rows([1000, 1000], [1400, 1400], 1)];
  const swapped = data.map((r) => ({ ...r, arm: r.arm === 'treated' ? 'holdout' : 'treated' }));
  const p = prereg({ minPerArm: 2 });
  assert.equal(analyzeArms(data, p).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(swapped, p).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(swapped, p).signedDelta, -300);
});

t('the sign follows the registered direction: up rewards treated > holdout, down the reverse', () => {
  const higher = [...rows([500, 500], [100, 100], 0), ...rows([900, 900], [300, 300], 1)];
  const up = analyzeArms(higher, prereg({ direction: 'up', minPerArm: 2 }));
  const down = analyzeArms(higher, prereg({ direction: 'down', minPerArm: 2 }));
  assert.equal(up.signedDelta, 500);
  assert.equal(down.signedDelta, -500);
  assert.equal(up.verdict, 'mechanism_pass');
  assert.equal(down.verdict, 'mechanism_fail');
  const lower = higher.map((r) => ({ ...r, arm: r.arm === 'treated' ? 'holdout' : 'treated' }));
  assert.equal(analyzeArms(lower, prereg({ direction: 'down', minPerArm: 2 })).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(lower, prereg({ direction: 'up', minPerArm: 2 })).verdict, 'mechanism_fail');
});

t('exact p on a tiny case: 1 prompt, 2 treated + 2 holdout, all 6 assignments enumerated', () => {
  // treated {10,20} vs holdout {30,40}, down: T_obs = 20. Of the 6 assignments only the observed
  // one reaches 20 (the others give 10, 0, 0, -10, -20), so the exact p is 1/6.
  const ex = exactP([[[10, 20], [30, 40]]], 'down');
  assert.equal(ex.total, 6);
  assert.equal(ex.tObs, 20);
  assert.equal(ex.p, 1 / 6);
  const B = 4000;
  const r = analyzeArms(rows([10, 20], [30, 40]), P({ permutations: B, effectSizeThinkingTokens: 1 }));
  assert.equal(r.signedDelta, 20);
  assert.ok(Math.abs(r.pValue - 1 / 6) < 0.03, `Monte-Carlo p ${r.pValue} vs exact 1/6`);
  // the add-one form: p = (1 + count) / (1 + permutations), with count an integer in [0, B]
  const count = r.pValue * (1 + B) - 1;
  assert.ok(Math.abs(count - Math.round(count)) < 1e-6 && count >= 0 && count <= B, `count ${count}`);
});

t('exact p, 2 prompts with 1 treated + 1 holdout each: labels shuffle WITHIN each prompt (p = 1/4)', () => {
  // Within-prompt shuffles: 2 x 2 assignments, only the observed one reaches T_obs = 550, so
  // p = 1/4. Shuffling labels ACROSS the prompts would give about 1/6 instead.
  const groups = [[[0], [100]], [[1000], [2000]]];
  assert.equal(exactP(groups, 'down').p, 1 / 4);
  const r = analyzeArms([...rows([0], [100], 0), ...rows([1000], [2000], 1)], P({ permutations: 4000, effectSizeThinkingTokens: 1 }));
  assert.equal(r.signedDelta, 550);
  assert.ok(Math.abs(r.pValue - 0.25) < 0.03, `Monte-Carlo p ${r.pValue} vs exact 1/4`);
});

t('the p-value keeps the add-one: one draw gives 1/2 or 1, never 0', () => {
  // 6 treated far below 6 holdout: one random draw is almost surely below T_obs, so
  // p = (1 + 0) / (1 + 1). Without the add-one it would be 0.
  const r = analyzeArms(rows([1, 2, 3, 4, 5, 6], [101, 102, 103, 104, 105, 106]), P({ permutations: 1 }));
  assert.equal(r.pValue, 0.5);
  for (const B of [1, 7, 50]) {
    const q = analyzeArms(rows([1, 2, 3], [101, 102, 103]), P({ permutations: B })).pValue;
    assert.ok(q >= 1 / (1 + B), `p ${q} below 1/(1+${B})`);
  }
});

t('alpha gates the verdict: an effect above the size but with p above alpha fails', () => {
  // 1 treated vs 1 holdout: T = 200 >= 150, but the exact p is 1/2.
  const r = analyzeArms(rows([100], [300]), P({ alpha: 0.05, permutations: 1000 }));
  assert.equal(r.signedDelta, 200);
  assert.ok(r.pValue > 0.4, `p ${r.pValue}`);
  assert.equal(r.verdict, 'mechanism_fail');
});

t('alpha is inclusive: p equal to alpha passes, p just above alpha fails', () => {
  const data = rows([10, 20], [30, 40]);
  const base = P({ permutations: 19, effectSizeThinkingTokens: 1 });
  const p = analyzeArms(data, base).pValue;
  assert.ok(p > 0 && p < 1, `p ${p}`);
  assert.equal(analyzeArms(data, { ...base, alpha: p }).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(data, { ...base, alpha: p - 1e-9 }).verdict, 'mechanism_fail');
});

t('the effect-size gate holds: alpha alone never passes a tiny effect', () => {
  // Every prompt: treated 3 tokens below holdout, perfectly separated, so p is tiny.
  const data = [0, 1, 2, 3].flatMap((k) => rows([10 * k, 10 * k + 1, 10 * k + 2], [10 * k + 3, 10 * k + 4, 10 * k + 5], k));
  const tiny = analyzeArms(data, prereg({ alpha: 0.05, permutations: 500 }));
  assert.equal(tiny.signedDelta, 3);
  assert.ok(tiny.pValue <= 0.01, `p ${tiny.pValue}`);
  assert.equal(tiny.verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, prereg({ alpha: 0.05, permutations: 500, effectSizeThinkingTokens: 3 })).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(data, prereg({ alpha: 0.05, permutations: 500, effectSizeThinkingTokens: 3.0001 })).verdict, 'mechanism_fail');
});

t('a registered seed reproduces the same p on any machine (pinned: 150/1001)', () => {
  // Recorded 2026-10-05. The permutation draws come from stream 1 of the seed (the plan uses
  // stream 0); changing the stream, the PRNG or the draw order after registration would
  // silently change a registered result.
  const data = [...rows([10, 20], [30, 40], 0), ...rows([100], [130, 90], 1)];
  const r = analyzeArms(data, P({ permutations: 1000, seed: 42, effectSizeThinkingTokens: 1 }));
  assert.equal(r.signedDelta, 15);
  assert.equal(r.pValue, 150 / 1001);
});

t('the permutation draws follow the registered seed: same seed same p, other seeds other p', () => {
  const data = rows([10, 20], [30, 40]);
  const pOf = (seed) => analyzeArms(data, P({ permutations: 500, seed, effectSizeThinkingTokens: 1 })).pValue;
  assert.equal(pOf(11), pOf(11));
  assert.equal(pOf(11), pOf(11));
  const ps = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(pOf));
  assert.ok(ps.size > 1, `every seed gave p ${[...ps]}`);
});

t('no contributing prompt (each prompt has one arm only) is insufficient_data, cacheOk null', () => {
  const data = [...arm('treated', [1, 1, 1], 0), ...arm('holdout', [9, 9, 9], 1)];
  const r = analyzeArms(data, prereg());
  assert.equal(r.nTreated, 3);
  assert.equal(r.nHoldout, 3);
  assert.equal(r.nPrompts, 0);
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.signedDelta, null);
  assert.equal(r.pValue, null);
  assert.equal(r.cacheOk, null);
});

t('rows without a valid promptIndex are ignored and counted', () => {
  const bad = [-1, 1.5, '0', null, undefined, NaN, 2 ** 53].map((promptIndex) => ({ ...row('treated', 1), promptIndex }));
  const { promptIndex, ...noIndex } = row('treated', 1);
  const r = analyzeArms([...rows([1, 1, 1], [2, 2, 2]), ...bad, noIndex], prereg());
  assert.equal(r.nIgnored, bad.length + 1);
  assert.equal(r.nTreated, 3);
});

t('a malformed alpha, permutations or seed throws a TypeError', () => {
  const data = rows([1, 1, 1], [2, 2, 2]);
  for (const alpha of [0, 1, -0.5, 2, NaN, Infinity, '0.05', undefined]) assert.throws(() => analyzeArms(data, prereg({ alpha })), TypeError, `alpha ${alpha}`);
  for (const permutations of [0, -1, 1.5, '10', NaN, undefined, 2 ** 53]) assert.throws(() => analyzeArms(data, prereg({ permutations })), TypeError, `permutations ${permutations}`);
  for (const seed of [1.5, '1', NaN, undefined, 2 ** 53]) assert.throws(() => analyzeArms(data, prereg({ seed })), TypeError, `seed ${seed}`);
  // even when there is nothing to permute
  for (const bad of [{ alpha: 1 }, { permutations: 0 }, { seed: 1.5 }]) assert.throws(() => analyzeArms([], prereg(bad)), TypeError, JSON.stringify(bad));
});

// ---- calibration and power: balanced arms from the runner's own plan --------------------

const BASELINES = [300, 1500, 6000, 20000]; // very different thinking levels per prompt
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

// One simulated S4 experiment: 4 prompts x 5 repeats, arms from planRuns (holdoutRate 0.4,
// so 2 holdout + 3 treated per prompt), 30% multiplicative noise; `reduction` is the TRUE
// effect on treated rows (0 = none).
// One simulated S4 experiment: 4 prompts x `repeats`, arms from planRuns, multiplicative
// gaussian noise of sd `noise`; `reduction` is the TRUE effect on treated rows (0 = none).
function simulate(seed, reduction, analysis, { repeats = 5, holdoutRate = 0.4, noise: sd = 0.3 } = {}) {
  const noise = makeRng(seed, 9);
  const plan = planRuns({ prompts: ['a a', 'b b', 'c c', 'd d'], repeats, holdoutRate, seed });
  const data = plan.map((r) => ({
    promptIndex: r.promptIndex,
    arm: r.arm,
    thinking_tokens: Math.max(0, BASELINES[r.promptIndex] * (r.arm === 'treated' ? 1 - reduction : 1) * (1 + sd * gauss(noise))),
    cache_creation: 0,
    input_total: 100,
  }));
  return analyzeArms(data, { direction: 'down', minPerArm: 3, alpha: 0.05, permutations: 500, seed, ...analysis });
}
const passRate = (trials, seed0, reduction, analysis, design) => {
  let passes = 0;
  for (let k = 0; k < trials; k++) if (simulate(seed0 + k, reduction, analysis, design).verdict === 'mechanism_pass') passes++;
  return passes / trials;
};

t('CALIBRATION: with no true effect the false-GO rate is at most 0.10 at alpha 0.05 (300 seeded experiments)', () => {
  // 4 prompts x 5 repeats (2 holdout + 3 treated each). Effect size 1 token, so the alpha
  // gate alone is what is being measured.
  const rate = passRate(300, 1000, 0, { effectSizeThinkingTokens: 1 });
  console.log(`# calibration: false-GO rate ${rate} over 300 experiments, no effect, 4 prompts x 5 repeats, alpha 0.05, permutations 500`);
  assert.ok(rate <= 0.1, `false-GO rate ${rate}`);
});

t("CALIBRATION: the final review's scenario (4 prompts x 3 repeats, effect size 150) no longer gives a false GO", () => {
  // The pooled method passed 40.4% of such no-effect runs. holdoutRate 0.5 -> 2 holdout + 1 treated.
  const rate = passRate(300, 3000, 0, { effectSizeThinkingTokens: 150 }, { repeats: 3, holdoutRate: 0.5 });
  console.log(`# calibration: false-GO rate ${rate} over 300 experiments, the review's 4 x 3 scenario, effect size 150`);
  assert.ok(rate <= 0.1, `false-GO rate ${rate}`);
});

t('POWER: a clear effect (every treated row 60% below its prompt, 10% noise) passes in all 100 seeded experiments', () => {
  const rate = passRate(100, 5000, 0.6, { effectSizeThinkingTokens: 150 }, { noise: 0.1 });
  console.log(`# power: ${rate} at a 60% reduction with 10% noise, effect size 150, alpha 0.05`);
  assert.equal(rate, 1);
});

t('POWER: with 30% noise a 60% reduction still passes in at least 85% of 100 seeded experiments', () => {
  // T is a mean of raw-token deltas, so the highest-baseline prompt dominates it; when that
  // prompt's arms overlap, the p-value can exceed alpha. Reported, not hidden.
  const rate = passRate(100, 7000, 0.6, { effectSizeThinkingTokens: 150 });
  console.log(`# power: ${rate} at a 60% reduction with 30% noise, effect size 150, alpha 0.05`);
  assert.ok(rate >= 0.85, `power ${rate}`);
});
