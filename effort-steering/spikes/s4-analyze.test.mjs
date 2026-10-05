// s4-analyze.test.mjs — vectors for the S4 verdict. Each condition that can flip
// the verdict (sign, arm labels, threshold equality, direction, cache comparison,
// per-arm minimum, median vs mean) has a test that fails when it is changed.

import assert from 'node:assert/strict';
import { t } from '../core/testkit.mjs';
import { analyzeArms } from './s4-analyze.mjs';

const prereg = (over = {}) => ({ direction: 'down', effectSizeThinkingTokens: 150, minPerArm: 3, ...over });
const row = (arm, thinking_tokens, cache_creation = 0, input_total = 100) => ({ arm, thinking_tokens, cache_creation, input_total });
const arm = (name, tokens) => tokens.map((v) => row(name, v));
const rows = (treated, holdout) => [...arm('treated', treated), ...arm('holdout', holdout)];

t('treated 100 vs holdout 300, down, effect 150: mechanism_pass', () => {
  const r = analyzeArms(rows([100, 100, 100], [300, 300, 300]), prereg());
  assert.equal(r.verdict, 'mechanism_pass');
  assert.equal(r.delta, -200);
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
  assert.equal(r.delta, 200);
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

t('treated arm below minPerArm: insufficient_data, delta null', () => {
  const r = analyzeArms(rows([100, 100], [300, 300, 300]), prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.delta, null);
  assert.equal(r.nTreated, 2);
});

t('holdout arm below minPerArm: insufficient_data, delta null', () => {
  const r = analyzeArms(rows([100, 100, 100], [300, 300]), prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.delta, null);
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
  for (const k of ['medianTreated', 'medianHoldout', 'delta', 'cacheShareTreated', 'cacheShareHoldout', 'cacheOk']) {
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
  assert.equal(r.delta, null);
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
  assert.equal(r.delta, null);
  assert.equal(r.nTreated, 5);
  assert.equal(r.nHoldout, 2);
});

t('unbalanced arms: 2 treated vs 5 holdout is insufficient', () => {
  const r = analyzeArms(rows([100, 100], [300, 300, 300, 300, 300]), prereg());
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.delta, null);
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

t('fractional threshold, down: delta -149.5', () => {
  const data = rows([150, 151], [300, 300]);
  const p = (e) => prereg({ minPerArm: 2, effectSizeThinkingTokens: e });
  assert.equal(analyzeArms(data, p(150)).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, p(149.5)).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(data, p(149.6)).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, p(150)).delta, -149.5);
});

t('fractional threshold, up: delta 150.5', () => {
  const data = rows([450, 451], [300, 300]);
  const p = (e) => prereg({ direction: 'up', minPerArm: 2, effectSizeThinkingTokens: e });
  assert.equal(analyzeArms(data, p(151)).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, p(150.5)).verdict, 'mechanism_pass');
  assert.equal(analyzeArms(data, p(150.6)).verdict, 'mechanism_fail');
  assert.equal(analyzeArms(data, p(150)).delta, 150.5);
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
