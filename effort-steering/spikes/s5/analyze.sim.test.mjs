// analyze.sim.test.mjs — the planted-truth simulation (Task 9, Review Focus 5, ruling R69).
//
// 32 tasks, runs A 3 / B 3 / C 2, task pass rates uniform on [0.3, 0.95], 1,000 trials of 1,000 resamples, margin 0.15,
// alpha 0.05, registered seed 20261008. The lower bound at N = 32 must hold the false non-inferiority rate at Delta = -0.15 at
// or below 0.065, keep real power at Delta = 0, and the validity gate must be false-positive at or below 0.065 when C is as
// good as A. The thresholds are the brief's and are not loosened here.
//
// Both methods are run and both are asserted; the rates are printed as TAP comments. Measured at seed 20261008:
//   percentile  NI at deltaB -0.15: 0.063   NI at deltaB 0: 0.753   gate at deltaC 0: 0.057   (gate at deltaC -0.3: 0.994)
//   paired-t    NI at deltaB -0.15: 0.048   NI at deltaB 0: 0.722   gate at deltaC 0: 0.053   (gate at deltaC -0.3: 0.995)
// Both pass, so DEFAULT_METHOD is the percentile bootstrap (the brief's rule). Each rate is a 1,000-trial estimate with a
// standard error near 0.007, so a seed other than the registered one can put the percentile's 0.063 above 0.065: over 30 other
// seeds its mean NI rate at deltaB -0.15 was 0.058 (6 of 30 above 0.065) against 0.0485 for paired-t (0 of 30). If a change to
// simulate's draw layout moves the number past 0.065, compare the mean over many seeds before reading it as a regression.

import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { DEFAULT_METHOD, METHODS, simulate } from './analyze.mjs';

const BASE = { nTasks: 32, runs: { A: 3, B: 3, C: 2 }, pA: [0.3, 0.95], trials: 1000, resamples: 1000, margin: 0.15, alpha: 0.05, seed: 20261008 };

// niRate depends on deltaB alone and gateRate on deltaC alone (ruling R69), so the type-I scenario (deltaB -0.15, deltaC 0)
// gives both false-positive rates, and the power scenario (deltaB 0, deltaC -0.3) gives the NI power and the gate's.
const results = {};
for (const method of METHODS) {
  const typeOne = simulate({ ...BASE, method, deltaB: -0.15, deltaC: 0 });
  const power = simulate({ ...BASE, method, deltaB: 0, deltaC: -0.3 });
  results[method] = { typeOne, power };
  console.log(`# ${method}${method === DEFAULT_METHOD ? ' (default)' : ''}: NI rate at deltaB -0.15 = ${typeOne.niRate}, NI rate at deltaB 0 = ${power.niRate}, gate rate at deltaC 0 = ${typeOne.gateRate}, gate rate at deltaC -0.3 = ${power.gateRate}`);
}

for (const method of METHODS) {
  t(`${method}: at deltaB -0.15 the NI rate is at most 0.065`, () => {
    assert.ok(results[method].typeOne.niRate <= 0.065, `NI rate ${results[method].typeOne.niRate}`);
  });
  t(`${method}: at deltaB 0 the NI rate is at least 0.6`, () => {
    assert.ok(results[method].power.niRate >= 0.6, `NI rate ${results[method].power.niRate}`);
  });
  t(`${method}: at deltaC 0 the gate rate is at most 0.065`, () => {
    assert.ok(results[method].typeOne.gateRate <= 0.065, `gate rate ${results[method].typeOne.gateRate}`);
  });
}

t('the module default is a method that passes all three', () => {
  assert.ok(METHODS.includes(DEFAULT_METHOD));
  const { typeOne, power } = results[DEFAULT_METHOD];
  assert.ok(typeOne.niRate <= 0.065 && power.niRate >= 0.6 && typeOne.gateRate <= 0.065);
});
