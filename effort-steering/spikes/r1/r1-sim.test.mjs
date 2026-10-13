import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { simulateR1 } from './r1-sim.mjs';

const base = { nTasks: 16, runs: 2, trials: 60, seed: 7, method: 'paired-t' };

t('no true difference and a perfect arm A always gives support', () => {
  assert.deepEqual(simulateR1({ ...base, pA: [1], trueDelta: 0 }), { supportRate: 1, trials: 60 });
});

t('a total loss of C never gives support', () => {
  assert.equal(simulateR1({ ...base, pA: [1], trueDelta: -1 }).supportRate, 0);
});

t('the same seed gives the same result', () => {
  const args = { ...base, pA: [0.9, 1, 0.8], trueDelta: -0.1 };
  assert.deepEqual(simulateR1(args), simulateR1(args));
});

t('another seed changes a noisy result', () => {
  const a = simulateR1({ ...base, trials: 400, pA: [0.9], trueDelta: -0.1, seed: 1 });
  const b = simulateR1({ ...base, trials: 400, pA: [0.9], trueDelta: -0.1, seed: 2 });
  assert.notEqual(a.supportRate, b.supportRate);
});

t('the method does not matter when every task ties', () => {
  const p = simulateR1({ ...base, method: 'percentile', resamples: 2000, pA: [1], trueDelta: 0 });
  assert.equal(p.supportRate, 1);
});

t('a harder true shortfall gives support less often', () => {
  const mild = simulateR1({ ...base, trials: 300, pA: [0.97], trueDelta: -0.02 }).supportRate;
  const bad = simulateR1({ ...base, trials: 300, pA: [0.97], trueDelta: -0.3 }).supportRate;
  assert.ok(bad < mild, `bad ${bad} < mild ${mild}`);
});

t('bad arguments are refused', () => {
  assert.throws(() => simulateR1({ ...base, pA: [], trueDelta: 0 }), /pA/);
  assert.throws(() => simulateR1({ ...base, pA: [1.5], trueDelta: 0 }), /pA/);
  assert.throws(() => simulateR1({ ...base, pA: [1], trueDelta: 0, trials: 0 }), /trials/);
});
