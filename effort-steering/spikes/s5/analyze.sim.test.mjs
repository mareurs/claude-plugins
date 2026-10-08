// analyze.sim.test.mjs — the planted-truth simulation (Task 9, Review Focus 5, rulings R69 and R76).
//
// 32 tasks, runs A 3 / B 3 / C 2, task pass rates uniform on [0.3, 0.95], 1,000 trials of 1,000 resamples, margin 0.15,
// alpha 0.05, registered seed 20261008. The lower bound at N = 32 must hold the false non-inferiority rate at Delta = -0.15 at
// or below 0.065, keep real power at Delta = 0, and the validity gate must be false-positive at or below 0.065 when C is as
// good as A. The thresholds are the brief's and are not loosened here.
//
// Both methods are run and both are asserted at the registered seed; the rates are printed as TAP comments. Measured there:
//   percentile  NI at deltaB -0.15: 0.063   NI at deltaB 0: 0.753   gate at deltaC 0: 0.057   (gate at deltaC -0.3: 0.994)
//   paired-t    NI at deltaB -0.15: 0.048   NI at deltaB 0: 0.722   gate at deltaC 0: 0.053   (gate at deltaC -0.3: 0.995)
//
// WHY THE DEFAULT IS paired-t (ruling R76). Both methods pass at the registered seed, and the brief's tie rule would then take the
// percentile bootstrap. But each rate above is a 1,000-trial estimate (standard error near 0.007), and the percentile's 0.063 is a
// luck-of-the-seed pass: over seeds 1 to 40 (40,000 trials per method, the controller's re-run) the percentile bootstrap's false
// non-inferiority rate at deltaB -0.15 averaged 0.0594 (max 0.082, 5 of 40 seeds above 0.065; about 8 standard errors above 0.05),
// against 0.0482 for paired-t (max 0.066, 1 of 40). The spec's own criterion (l.185: at a true Delta of -0.15 non-inferiority is
// claimed in at most about 5 percent of trials) is met by paired-t and not by the percentile bootstrap, which is anti-conservative
// at N = 32. So DEFAULT_METHOD is paired-t, and the test below calibrates the default over 20 seeds other than the registered one.
// Both stay selectable by prereg.bound.method. If a change to simulate's draw layout moves a single-seed number past 0.065, compare
// the mean over many seeds before reading it as a regression.

import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { DEFAULT_METHOD, METHODS, simulate } from './analyze.mjs';

const REGISTERED_SEED = 20261008;
const BASE = { nTasks: 32, runs: { A: 3, B: 3, C: 2 }, pA: [0.3, 0.95], trials: 1000, resamples: 1000, margin: 0.15, alpha: 0.05, seed: REGISTERED_SEED };

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

// The default's calibration (ruling R76): its false non-inferiority rate at the boundary, averaged over 20 seeds other than the
// registered one (seeds 1 to 20, fixed in advance), is at most 0.055, near the nominal 0.05. A single 1,000-trial rate cannot show
// this (see the header); the percentile bootstrap averages about 0.059 and fails it.
t('the default method is paired-t, and its mean NI rate at deltaB -0.15 over 20 other seeds is at most 0.055', () => {
  assert.equal(DEFAULT_METHOD, 'paired-t');
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.ok(!seeds.includes(REGISTERED_SEED));
  const rates = seeds.map((seed) => simulate({ ...BASE, method: DEFAULT_METHOD, seed, deltaB: -0.15, deltaC: 0 }).niRate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  console.log(`# ${DEFAULT_METHOD} mean NI rate at deltaB -0.15 over seeds 1 to 20 = ${mean.toFixed(4)} (min ${Math.min(...rates)}, max ${Math.max(...rates)})`);
  assert.ok(mean <= 0.055, `mean NI rate ${mean}`);
});
