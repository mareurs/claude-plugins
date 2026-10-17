// analyze.test.mjs — the effort-toggle verdicts (analyze.mjs) at every threshold: step 0 (positive control, up, down, the extension, the
// stop rule), step 1 (quality, cost, harm, works, timing) and the random arm's parameters.
//
//   node --test effort-steering/spikes/toggle/analyze.test.mjs
//
// Pure functions on hand-built Run objects: no I/O, never calls a model. Each table row sits on one side of a threshold, so a
// wrong direction (>= for >) or an off-by-one flips at least one row.

import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { randomParams, step0Verdict, step1Verdict } from './analyze.mjs';

const REG0 = { switchAt: 5, n: 4, extension: 4 };

let seq = 0;
const run = (over = {}) => ({
  runId: `r${seq++}`, taskId: 'cs-p20', rep: 0, pass: true, costUsd: 1, excludedFor: null, secondTurn: false,
  broadAt: [], requests: 20, shareXhigh: 0, upSwitches: 0, ...over,
});
// A broad run has a broad check at request 6 (>= switchAt 5); a narrow one only at request 4 (before it).
const broadRun = (rep, over = {}) => run({ rep, broadAt: [6], ...over });
const narrowRun = (rep, over = {}) => run({ rep, broadAt: [4], ...over });
// `flags` = array of booleans (broad or not), reps 0, 1, 2, ...
const arm = (flags, over = {}) => flags.map((b, rep) => (b ? broadRun(rep, over) : narrowRun(rep, over)));
const flagsOf = (k, total) => Array.from({ length: total }, (_, i) => i < k);

// A step 0 input whose control passes at its boundary (F-X 3 of 4, F-L 1 of 4) and whose F-LX and F-XL are given.
const step0 = (fLX, fXL, over = {}) => ({
  'F-L': arm([true, false, false, false]),
  'F-X': arm([true, true, true, false]),
  'F-LX': fLX,
  'F-XL': fXL,
  ...over,
});
const neutral = arm([false, false, false, false]);

// ---- broad ------------------------------------------------------------------------------------------------------------------

t('step 0: broad means a broadAt entry at or after switchAt (4 is not, 5 is, any one entry is enough, none is not)', () => {
  const cases = [[[4], 0], [[5], 1], [[3, 7], 1], [[], 0], [[0, 1, 2, 3, 4], 0]];
  for (const [broadAt, want] of cases) {
    const v = step0Verdict(step0(neutral.map((r, rep) => run({ rep, broadAt })), neutral), REG0);
    assert.equal(v.counts['F-LX'].broad, want * 4, JSON.stringify(broadAt));
  }
});

// ---- the positive control ---------------------------------------------------------------------------------------------------

t('step 0: the positive control passes at F-X 3 of 4 and F-L 1 of 4, fails at F-X 2 or F-L 2', () => {
  const table = [
    [3, 1, 'pass'], [4, 0, 'pass'], [4, 1, 'pass'], [3, 0, 'pass'],
    [2, 1, 'fail'], [3, 2, 'fail'], [0, 0, 'fail'], [4, 4, 'fail'], [2, 2, 'fail'],
  ];
  for (const [x, l, want] of table) {
    const v = step0Verdict(step0(arm([true, true, true, true]), arm([false, false, false, false]),
      { 'F-X': arm(flagsOf(x, 4)), 'F-L': arm(flagsOf(l, 4)) }), REG0);
    assert.equal(v.positiveControl, want, `F-X ${x}, F-L ${l}`);
    assert.equal(v.stop.includes('positive_control_failed'), want === 'fail', `stop for F-X ${x}, F-L ${l}`);
  }
});

t('step 0: a failed positive control makes up and down inconclusive even when F-LX and F-XL look decisive (ruling P5)', () => {
  const v = step0Verdict(step0(arm([true, true, true, true]), arm([false, false, false, false]), { 'F-X': arm(flagsOf(2, 4)) }), REG0);
  assert.equal(v.positiveControl, 'fail');
  assert.equal(v.up, 'inconclusive');
  assert.equal(v.down, 'inconclusive');
  assert.deepEqual(v.stop, ['positive_control_failed']);
  assert.equal(v.counts['F-LX'].counted, 4);
  assert.equal(v.counts['F-LX'].broad, 4);
});

t('step 0: a control arm with fewer than n counted runs is not a pass; stop says incomplete, not failed', () => {
  const v = step0Verdict(step0(arm([true, true, true, true]), arm([false, false, false, false]), { 'F-X': arm([true, true, true]) }), REG0);
  assert.equal(v.positiveControl, 'fail');
  assert.deepEqual(v.stop, ['positive_control_incomplete']);
  assert.equal(v.up, 'inconclusive');
  assert.equal(v.counts['F-X'].counted, 3);
});

// ---- up and down at n = 4 ---------------------------------------------------------------------------------------------------

t('step 0: up-switch (F-LX) by broad count of 4: 0,1 not delivered; 2 needs extension; 3,4 delivered', () => {
  const want = ['not_delivered', 'not_delivered', 'needs_extension', 'delivered', 'delivered'];
  for (let k = 0; k <= 4; k += 1) {
    const v = step0Verdict(step0(arm(flagsOf(k, 4)), neutral), REG0);
    assert.equal(v.up, want[k], `F-LX ${k} of 4`);
    assert.equal(v.counts['F-LX'].broad, k);
    assert.equal(v.counts['F-LX'].counted, 4);
  }
});

t('step 0: down-switch (F-XL) is mirrored: 0,1 delivered; 2 needs extension; 3,4 not delivered', () => {
  const want = ['delivered', 'delivered', 'needs_extension', 'not_delivered', 'not_delivered'];
  for (let k = 0; k <= 4; k += 1) {
    const v = step0Verdict(step0(neutral, arm(flagsOf(k, 4))), REG0);
    assert.equal(v.down, want[k], `F-XL ${k} of 4`);
  }
});

t('step 0: up and down are decided independently of each other', () => {
  const v = step0Verdict(step0(arm(flagsOf(4, 4)), arm(flagsOf(4, 4))), REG0);
  assert.equal(v.up, 'delivered');
  assert.equal(v.down, 'not_delivered');
});

// ---- the extension (C8) -----------------------------------------------------------------------------------------------------

// The first 4 runs hold exactly 2 broad; the extension holds `more` broad of 4 (reps 4..7): pooled broad = 2 + more.
const pooled = (more) => arm([true, true, false, false, ...flagsOf(more, 4)]);

t('step 0: up with the extension: pooled 6 of 8 delivered; 5, 4, 3 inconclusive; 2 of 8 not delivered', () => {
  // first four broad = 2, so the pooled count is 2 + more; more 0..4 gives pooled 2..6
  const want = { 4: 'delivered', 3: 'inconclusive', 2: 'inconclusive', 1: 'inconclusive', 0: 'not_delivered' };
  for (const more of [0, 1, 2, 3, 4]) {
    const v = step0Verdict(step0(pooled(more), neutral), REG0);
    assert.equal(v.up, want[more], `pooled ${2 + more} of 8`);
    assert.equal(v.counts['F-LX'].counted, 8);
    assert.equal(v.counts['F-LX'].broad, 2 + more);
  }
});

t('step 0: down with the extension, mirrored: pooled 2 of 8 delivered; 3, 4, 5 inconclusive; 6 of 8 not delivered', () => {
  const want = { 0: 'delivered', 1: 'inconclusive', 2: 'inconclusive', 3: 'inconclusive', 4: 'not_delivered' };
  for (const more of [0, 1, 2, 3, 4]) {
    const v = step0Verdict(step0(neutral, pooled(more)), REG0);
    assert.equal(v.down, want[more], `pooled ${2 + more} of 8`);
  }
});

t('step 0: a 2-of-4 arm with 5, 6 or 7 counted runs still needs the extension (the pool is n + extension = 8)', () => {
  for (const total of [4, 5, 6, 7]) {
    const v = step0Verdict(step0(arm([true, true, false, false, ...flagsOf(4, total - 4)]), neutral), REG0);
    assert.equal(v.up, 'needs_extension', `${total} counted`);
    assert.equal(v.counts['F-LX'].counted, 4, `${total} counted: the verdict used the first n`);
  }
});

t('step 0: an arm that the first 4 runs decide keeps its verdict, whatever the extra runs say', () => {
  const v = step0Verdict(step0(arm([true, true, true, false, false, false, false, false]), neutral), REG0);
  assert.equal(v.up, 'delivered');
  assert.equal(v.counts['F-LX'].counted, 4);
  assert.equal(v.counts['F-LX'].broad, 3);
});

t('step 0: the extension does not apply when the positive control failed (no rerun)', () => {
  const v = step0Verdict(step0(pooled(4), neutral, { 'F-L': arm(flagsOf(2, 4)) }), REG0);
  assert.equal(v.up, 'inconclusive');
});

// ---- which runs count -------------------------------------------------------------------------------------------------------

t('step 0: a secondTurn run is skipped and the next rep counts', () => {
  // reps 0, 2 and 4 broad; rep 1 narrow and a second turn; rep 3 narrow. Skipped: counted = reps 0, 2, 3, 4 -> 3 broad.
  const fLX = [
    broadRun(0), narrowRun(1, { secondTurn: true }), broadRun(2), narrowRun(3), broadRun(4),
  ];
  const v = step0Verdict(step0(fLX, neutral), REG0);
  assert.equal(v.counts['F-LX'].counted, 4);
  assert.equal(v.counts['F-LX'].broad, 3);
  assert.equal(v.up, 'delivered');
  assert.deepEqual(v.stop, []);
  // had rep 1 been counted the first four (reps 0..3) would hold 2 broad: needs_extension
  const unskipped = fLX.map((r) => ({ ...r, secondTurn: false }));
  assert.equal(step0Verdict(step0(unskipped, neutral), REG0).up, 'needs_extension');
});

t('step 0: a run with pass null, or with any excludedFor, is not counted; the next rep counts', () => {
  for (const over of [{ pass: null }, { excludedFor: 'audit' }, { excludedFor: 'no_mod_log' }]) {
    const fLX = [broadRun(0), narrowRun(1, over), broadRun(2), narrowRun(3), broadRun(4)];
    const v = step0Verdict(step0(fLX, neutral), REG0);
    assert.equal(v.counts['F-LX'].counted, 4, JSON.stringify(over));
    assert.equal(v.counts['F-LX'].broad, 3, JSON.stringify(over));
  }
});

t('step 0: each arm takes its first n counted runs by rep, not by array order', () => {
  // rep order: 0 N, 1 N, 2 B, 3 B (2 broad -> needs_extension), then 4 B, 5 B, 6 B listed first in the array
  const fLX = [broadRun(6), broadRun(5), narrowRun(1), broadRun(2), narrowRun(0), broadRun(3), broadRun(4)];
  const v = step0Verdict(step0(fLX, neutral), REG0);
  assert.equal(v.up, 'needs_extension');
  assert.equal(v.counts['F-LX'].broad, 2);
});

t('step 0: fewer than n counted runs is inconclusive, shows how many were counted, and does not throw', () => {
  for (const have of [0, 1, 3]) {
    const v = step0Verdict(step0(arm(flagsOf(have, have)), neutral), REG0);
    assert.equal(v.up, 'inconclusive', `${have} counted`);
    assert.equal(v.counts['F-LX'].counted, have);
    assert.equal(v.counts['F-LX'].meanCostUsd, have === 0 ? null : 1);
  }
  const empty = step0Verdict({}, REG0);
  assert.equal(empty.up, 'inconclusive');
  assert.equal(empty.down, 'inconclusive');
  assert.equal(empty.positiveControl, 'fail');
  assert.equal(empty.counts['F-L'].counted, 0);
});

// ---- the stop rule ----------------------------------------------------------------------------------------------------------

t('step 0: stop names an arm with more than 2 secondTurn runs (2 is still fine)', () => {
  for (const [n2, want] of [[2, []], [3, ['secondTurn:F-LX']], [4, ['secondTurn:F-LX']]]) {
    const fLX = Array.from({ length: 4 + n2 }, (_, rep) => (rep < n2 ? broadRun(rep, { secondTurn: true }) : broadRun(rep)));
    assert.deepEqual(step0Verdict(step0(fLX, neutral), REG0).stop, want, `${n2} second turns`);
  }
});

t('step 0: stop names an arm with more than 2 runs excluded for audit (2 is still fine; another reason does not count)', () => {
  const withExcluded = (count, excludedFor) => Array.from({ length: 4 + count }, (_, rep) =>
    (rep < count ? narrowRun(rep, { excludedFor }) : narrowRun(rep)));
  for (const [count, excludedFor, want] of [
    [2, 'audit', []], [3, 'audit', ['audit:F-X']], [3, 'log_transcript_mismatch', []], [5, 'audit', ['audit:F-X']],
  ]) {
    const input = step0(neutral, neutral, { 'F-X': arm([true, true, true, true]).concat(withExcluded(count, excludedFor).slice(0, count)) });
    assert.deepEqual(step0Verdict(input, REG0).stop, want, `${count} x ${excludedFor}`);
  }
});

t('step 0: stop lists the control, then audit arms, then secondTurn arms', () => {
  const bad = (k, over) => Array.from({ length: k }, (_, rep) => narrowRun(10 + rep, over));
  const input = step0(neutral, neutral, {
    'F-L': arm(flagsOf(4, 4)),
    'F-XL': neutral.concat(bad(3, { excludedFor: 'audit' })),
    'F-LX': neutral.concat(bad(3, { secondTurn: true })),
  });
  assert.deepEqual(step0Verdict(input, REG0).stop, ['positive_control_failed', 'audit:F-XL', 'secondTurn:F-LX']);
});

// ---- counts -----------------------------------------------------------------------------------------------------------------

t('step 0: counts carries counted, broad, pass and the mean cost per arm, over the runs the verdict used', () => {
  const fLX = [
    broadRun(0, { pass: true, costUsd: 1 }), broadRun(1, { pass: false, costUsd: 2 }),
    narrowRun(2, { pass: true, costUsd: 3 }), narrowRun(3, { pass: false, costUsd: 6 }),
  ];
  const v = step0Verdict(step0(fLX, neutral), REG0);
  assert.deepEqual(v.counts['F-LX'], { counted: 4, broad: 2, pass: 2, meanCostUsd: 3 });
  assert.deepEqual(Object.keys(v.counts), ['F-L', 'F-X', 'F-LX', 'F-XL']);
});

t('step 0: counts for a pooled arm cover the pooled 8; a null cost is left out of the mean', () => {
  const fLX = pooled(4).map((r, i) => ({ ...r, costUsd: i === 7 ? null : 2 }));
  const c = step0Verdict(step0(fLX, neutral), REG0).counts['F-LX'];
  assert.equal(c.counted, 8);
  assert.equal(c.meanCostUsd, 2);
});

// ---- step 1 -----------------------------------------------------------------------------------------------------------------

const REG1 = { qualityTask: 'cs-p20', qualityRuns: 5, otherRuns: 2, costEstimator: 'task' };
// `n` runs of one task with the first `passes` passing, at one cost.
const cell = (taskId, n, passes, costUsd = 1) => Array.from({ length: n }, (_, rep) => run({ taskId, rep, pass: rep < passes, costUsd }));
// An arm from { task: [n, passes, cost] }.
const mkArm = (spec) => Object.entries(spec).flatMap(([taskId, [n, passes, costUsd]]) => cell(taskId, n, passes, costUsd));
// A step 1 input whose three criteria pass by default (equal arms except the placebo, which fails the quality task).
const base = (over = {}) => ({
  L: mkArm({ 'cs-p20': [5, 0, 1], 'a': [2, 2, 1], 'b': [2, 2, 1] }),
  X: mkArm({ 'cs-p20': [5, 5, 3], 'a': [2, 2, 3], 'b': [2, 2, 3] }),
  T: mkArm({ 'cs-p20': [5, 4, 2], 'a': [2, 2, 2], 'b': [2, 2, 2] }),
  P: mkArm({ 'cs-p20': [5, 0, 1], 'a': [2, 2, 1], 'b': [2, 2, 1] }),
  R: mkArm({ 'cs-p20': [5, 2, 2], 'a': [2, 2, 2], 'b': [2, 2, 2] }),
  ...over,
});

t('step 1: the default input works (all three criteria) and carries no incomplete arm', () => {
  const v = step1Verdict(base(), REG1);
  assert.deepEqual([v.quality, v.cost, v.harm, v.works, v.incomplete], [true, true, true, true, []]);
});

t('step 1: quality needs T >= X - 1: T = X - 1 passes, T = X - 2 fails (P = 0)', () => {
  for (const [x, tt, want] of [[5, 5, true], [5, 4, true], [5, 3, false], [4, 3, true], [4, 2, false]]) {
    const v = step1Verdict(base({ X: mkArm({ 'cs-p20': [5, x, 3], 'a': [2, 2, 3], 'b': [2, 2, 3] }),
      T: mkArm({ 'cs-p20': [5, tt, 2], 'a': [2, 2, 2], 'b': [2, 2, 2] }), P: mkArm({ 'cs-p20': [5, 0, 1], 'a': [2, 2, 1], 'b': [2, 2, 1] }) }), REG1);
    assert.equal(v.quality, want, `X ${x}, T ${tt}`);
  }
});

t('step 1: quality needs T - P >= 3: 3 passes, 2 fails (X high enough)', () => {
  for (const [tt, p, want] of [[4, 1, true], [3, 0, true], [3, 1, false], [4, 2, false], [5, 2, true], [5, 3, false]]) {
    // X passes 4, so T >= X - 1 holds for every T here and only T - P decides
    const v = step1Verdict(base({ X: mkArm({ 'cs-p20': [5, 4, 3], 'a': [2, 2, 3], 'b': [2, 2, 3] }),
      T: mkArm({ 'cs-p20': [5, tt, 2], 'a': [2, 2, 2], 'b': [2, 2, 2] }),
      P: mkArm({ 'cs-p20': [5, p, 1], 'a': [2, 2, 1], 'b': [2, 2, 1] }) }), REG1);
    assert.equal(v.quality, want, `T ${tt}, P ${p}`);
    assert.equal(v.works, want, `works follows quality when cost and harm hold: T ${tt}, P ${p}`);
  }
});

t('step 1: quality counts only the first qualityRuns counted runs by rep on the quality task', () => {
  // T has 7 cs-p20 runs: the first five (reps 0..4) pass 2, reps 5, 6 pass; counting them would give T 4 and a pass.
  const tRuns = [...cell('cs-p20', 7, 0, 2).map((r) => ({ ...r, pass: r.rep === 0 || r.rep === 1 || r.rep >= 5 })), ...mkArm({ a: [2, 2, 2], b: [2, 2, 2] })];
  const v = step1Verdict(base({ T: tRuns }), REG1);
  assert.equal(v.detail.qualityPasses.T, 2);
  assert.equal(v.quality, false);
});

t('step 1: cost is the task-weighted mean and equality with the midpoint of L and X passes', () => {
  // L = 1 and X = 3 on every task: the midpoint is 2. T = 2 on both tasks: exactly the midpoint.
  const arms = (tCostA, tCostB) => base({
    L: mkArm({ 'cs-p20': [5, 0, 1], a: [2, 2, 1] }), X: mkArm({ 'cs-p20': [5, 5, 3], a: [2, 2, 3] }),
    T: mkArm({ 'cs-p20': [5, 4, tCostA], a: [2, 2, tCostB] }),
  });
  for (const [ca, cb, want] of [[2, 2, true], [2.01, 2, false], [1.99, 2, true], [3, 1, true], [3, 1.01, false]]) {
    assert.equal(step1Verdict(arms(ca, cb), REG1).cost, want, `T costs ${ca} and ${cb}`);
  }
});

t('step 1: the task weighting is by task, not by run (5 runs of one task do not outweigh 2 of another)', () => {
  // T: cs-p20 3 (5 runs), a 1 (2 runs). By task (3 + 1) / 2 = 2 = midpoint: passes. By run (15 + 2) / 7 = 2.43: would fail.
  const v = step1Verdict(base({
    L: mkArm({ 'cs-p20': [5, 0, 1], a: [2, 2, 1] }), X: mkArm({ 'cs-p20': [5, 5, 3], a: [2, 2, 3] }),
    T: mkArm({ 'cs-p20': [5, 4, 3], a: [2, 2, 1] }),
  }), REG1);
  assert.equal(v.detail.cost.task.T, 2);
  assert.equal(v.detail.cost.task.L, 1);
  assert.equal(v.detail.cost.task.X, 3);
  assert.equal(v.cost, true);
});

t('step 1: harm is T passes >= L passes - 1 on the other tasks: L - 1 passes, L - 2 fails', () => {
  // two other tasks of 2 runs: L passes 4
  for (const [tPasses, want] of [[4, true], [3, true], [2, false], [0, false]]) {
    const spec = { 'cs-p20': [5, 4, 2], a: [2, Math.min(2, tPasses), 2], b: [2, Math.max(0, tPasses - 2), 2] };
    const v = step1Verdict(base({ T: mkArm(spec) }), REG1);
    assert.equal(v.harm, want, `T passes ${tPasses} of 4`);
    assert.equal(v.detail.harm.L, 4);
    assert.equal(v.detail.harm.T, tPasses);
  }
});

t('step 1: harm leaves the quality task out (L and T differ there only)', () => {
  const v = step1Verdict(base({ L: mkArm({ 'cs-p20': [5, 5, 1], a: [2, 2, 1], b: [2, 2, 1] }), T: mkArm({ 'cs-p20': [5, 4, 2], a: [2, 2, 2], b: [2, 2, 2] }) }), REG1);
  assert.equal(v.harm, true);
  assert.equal(v.detail.harm.L, 4);
});

t('step 1: harm and cost use only the first otherRuns counted runs per other task', () => {
  const v = step1Verdict(base({ T: mkArm({ 'cs-p20': [5, 4, 2], a: [2, 2, 2], b: [2, 2, 2] }).concat(cell('a', 3, 0, 100).map((r) => ({ ...r, rep: r.rep + 2 }))) }), REG1);
  assert.equal(v.detail.harm.T, 4);
  assert.equal(v.detail.cost.task.T, 2);
});

t('step 1: works needs all three: one failing criterion alone makes works false', () => {
  const lowHarm = base({ T: mkArm({ 'cs-p20': [5, 4, 2], a: [2, 0, 2], b: [2, 1, 2] }) });
  const v1 = step1Verdict(lowHarm, REG1);
  assert.deepEqual([v1.quality, v1.cost, v1.harm, v1.works], [true, true, false, false]);
  const dearT = base({ T: mkArm({ 'cs-p20': [5, 4, 4], a: [2, 2, 4], b: [2, 2, 4] }) });
  const v2 = step1Verdict(dearT, REG1);
  assert.deepEqual([v2.quality, v2.cost, v2.harm, v2.works], [true, false, true, false]);
  const weakT = base({ T: mkArm({ 'cs-p20': [5, 2, 2], a: [2, 2, 2], b: [2, 2, 2] }) });
  const v3 = step1Verdict(weakT, REG1);
  assert.deepEqual([v3.quality, v3.cost, v3.harm, v3.works], [false, true, true, false]);
});

t('step 1: timing is T - R >= 2 on the quality task: 2 is enough, 1 is not; it is not part of works', () => {
  for (const [r, want] of [[2, true], [3, false], [4, false], [0, true]]) {
    const v = step1Verdict(base({ R: mkArm({ 'cs-p20': [5, r, 2] }) }), REG1);
    assert.equal(v.timing, want, `T 4, R ${r}`);
    assert.equal(v.works, true, 'works does not depend on timing');
  }
});

t('step 1: a missing R arm leaves works defined and timing null; R is not in incomplete', () => {
  for (const noR of [{ R: undefined }, { R: [] }]) {
    const v = step1Verdict(base(noR), REG1);
    assert.equal(v.timing, null);
    assert.equal(v.works, true);
    assert.deepEqual(v.incomplete, []);
  }
});

t('step 1: a missing L, X, T or P lists its name in incomplete (in that order) and sets works to null', () => {
  for (const missing of [['L'], ['X'], ['T'], ['P'], ['L', 'P'], ['L', 'X', 'T', 'P']]) {
    const input = base();
    for (const a of missing) input[a] = [];
    const v = step1Verdict(input, REG1);
    assert.deepEqual(v.incomplete, missing);
    assert.equal(v.works, null, `missing ${missing}`);
  }
});

t('step 1: runs that are not counted (pass null, excluded) do not count, and an arm of only those is missing', () => {
  const input = base({ L: cell('cs-p20', 5, 5).map((r, i) => ({ ...r, pass: i % 2 ? null : true, excludedFor: i % 2 ? null : 'audit' })) });
  const v = step1Verdict(input, REG1);
  assert.deepEqual(v.incomplete, ['L']);
  assert.equal(v.works, null);
});

t('step 1: a short cell is reported in detail.short and does not stop a verdict', () => {
  const v = step1Verdict(base({ T: mkArm({ 'cs-p20': [5, 4, 2], a: [2, 2, 2], b: [1, 1, 2] }) }), REG1);
  assert.deepEqual(v.detail.short, ['T:b:1/2']);
  assert.deepEqual(v.incomplete, []);
  assert.equal(typeof v.works, 'boolean');
});

t('step 1: no NaN and no throw on empty input', () => {
  const v = step1Verdict({}, REG1);
  assert.equal(v.works, null);
  assert.deepEqual(v.incomplete, ['L', 'X', 'T', 'P']);
  assert.equal(v.quality, null);
  assert.equal(v.cost, null);
  assert.equal(v.harm, null);
  assert.equal(v.timing, null);
});

// ---- step 1: the union of tasks, short cells, the cost estimator (rulings P11, P12) -----------------------------------------

const OTHER = Array.from({ length: 11 }, (_, i) => `o${i + 1}`);
// A full 12-task arm: cs-p20 5 runs, the 11 others 2 runs, every run passing at one cost; `cells` overrides a task's [n, passes, cost].
const full = (costUsd, cells = {}) => {
  const spec = { 'cs-p20': [5, 5, costUsd], ...Object.fromEntries(OTHER.map((o) => [o, [2, 2, costUsd]])) };
  for (const [task, c] of Object.entries(cells)) {
    if (c === null) delete spec[task];
    else spec[task] = c;
  }
  return mkArm(spec);
};
const full12 = (over = {}) => ({ L: full(1), X: full(3), T: full(2), P: full(1, { 'cs-p20': [5, 0, 1] }), R: full(2), ...over });

t('step 1 (P11): a complete 12-task input has no incomplete entry and works is defined', () => {
  const v = step1Verdict(full12(), REG1);
  assert.deepEqual(v.incomplete, []);
  assert.equal(v.works, true);
});

t('step 1 (P11): T missing a whole other task is incomplete as T:<task> and works is null', () => {
  const v = step1Verdict(full12({ T: full(2, { o11: null }) }), REG1);
  assert.deepEqual(v.incomplete, ['T:o11']);
  assert.equal(v.works, null);
});

t('step 1 (P11): L at 22 of 22 and T missing task o1 is incomplete (T:o1), works null, never a silent harm true', () => {
  const v = step1Verdict(full12({ T: full(2, { o1: null }) }), REG1);
  assert.deepEqual(v.incomplete, ['T:o1']);
  assert.equal(v.works, null);
});

t('step 1 (P11): T without the quality task is incomplete as T:cs-p20 and works is null', () => {
  const v = step1Verdict(full12({ T: full(2, { 'cs-p20': null }) }), REG1);
  assert.deepEqual(v.incomplete, ['T:cs-p20']);
  assert.equal(v.works, null);
  assert.equal(v.quality, null);
});

t('step 1 (P11): counted runs with a null costUsd on every run of a task is <arm>:<task>:cost and works is null', () => {
  const noCost = mkArm({ 'cs-p20': [5, 5, 2], ...Object.fromEntries(OTHER.map((o) => [o, [2, 2, o === 'o3' ? null : 2]])) });
  const v = step1Verdict(full12({ T: noCost }), REG1);
  assert.deepEqual(v.incomplete, ['T:o3:cost']);
  assert.equal(v.works, null);
  // one costed run among the task's runs is enough
  const oneCost = noCost.map((r, i) => (r.taskId === 'o3' && i % 2 === 0 ? { ...r, costUsd: 2 } : r));
  assert.deepEqual(step1Verdict(full12({ T: oneCost }), REG1).incomplete, []);
});

t('step 1 (P11): incomplete entries are ordered by arm L, X, T, P, then by task of first appearance', () => {
  const v = step1Verdict(full12({ P: full(1, { o5: null, o2: null }), T: full(2, { o9: null }), L: full(1, { o7: null }) }), REG1);
  assert.deepEqual(v.incomplete, ['L:o7', 'T:o9', 'P:o2', 'P:o5']);
  assert.equal(v.works, null);
});

t('step 1 (P11): a missing arm is listed by its name alone, a missing R leaves works defined and timing null, a missing L names L', () => {
  assert.deepEqual(step1Verdict(full12({ L: [] }), REG1).incomplete, ['L']);
  assert.equal(step1Verdict(full12({ L: [] }), REG1).works, null);
  const noR = step1Verdict(full12({ R: undefined }), REG1);
  assert.equal(noR.works, true);
  assert.equal(noR.timing, null);
  assert.deepEqual(noR.incomplete, []);
});

t('step 1 (P11): a short cell (1 of 2 counted) is in detail.short, not in incomplete, and works is still a verdict', () => {
  const v = step1Verdict(full12({ T: full(2, { o4: [1, 1, 2] }) }), REG1);
  assert.ok(v.detail.short.includes('T:o4:1/2'), JSON.stringify(v.detail.short));
  assert.deepEqual(v.incomplete, []);
  assert.equal(v.works, true);
  // a short quality cell (4 of 5) is reported the same way
  const q = step1Verdict(full12({ T: full(2, { 'cs-p20': [4, 4, 2] }) }), REG1);
  assert.deepEqual(q.detail.short, ['T:cs-p20:4/5']);
  assert.deepEqual(q.incomplete, []);
  assert.notEqual(q.works, null);
});

// T costs 10 on cs-p20 (5 runs) and 1 on the 11 others (22 runs); L = 1 and X = 3 everywhere; the midpoint is 2.
// Task-weighted T = (10 + 11 * 1) / 12 = 1.75 (passes); run-weighted T = (50 + 22) / 27 = 2.667 (fails).
const costInput = () => full12({ T: full(1, { 'cs-p20': [5, 5, 10] }) });

t('step 1 (P12): costEstimator task passes and run fails on the same data (probe numbers), both values are always returned', () => {
  const task = step1Verdict(costInput(), { ...REG1, costEstimator: 'task' });
  const run_ = step1Verdict(costInput(), { ...REG1, costEstimator: 'run' });
  assert.equal(task.cost, true);
  assert.equal(run_.cost, false);
  for (const v of [task, run_]) {
    near(v.detail.cost.task.T, 1.75, 'task T');
    near(v.detail.cost.run.T, 72 / 27, 'run T');
    assert.deepEqual([v.detail.cost.task.L, v.detail.cost.task.X, v.detail.cost.run.L, v.detail.cost.run.X], [1, 3, 1, 3]);
  }
  assert.equal(task.detail.cost.used, 'task');
  assert.equal(run_.detail.cost.used, 'run');
  assert.equal(task.works, true);
  assert.equal(run_.works, false);
});

t('step 1 (P12): the run estimator is total cost over the used runs divided by their number (here run passes, task fails)', () => {
  // T costs 1 on the 5 cs-p20 runs and 2.2 on the 22 others: run = (5 + 48.4) / 27 = 1.978 <= 2; task = (1 + 11 * 2.2) / 12 = 2.183 > 2
  const input = full12({ T: full(2.2, { 'cs-p20': [5, 5, 1] }) });
  const run_ = step1Verdict(input, { ...REG1, costEstimator: 'run' });
  const task = step1Verdict(input, { ...REG1, costEstimator: 'task' });
  near(run_.detail.cost.run.T, 53.4 / 27, 'run T');
  near(run_.detail.cost.task.T, (1 + 11 * 2.2) / 12, 'task T');
  assert.equal(run_.cost, true);
  assert.equal(task.cost, false);
});

t('step 1 (P12): costEstimator must be registered: missing or anything but run/task is a TypeError naming the field', () => {
  for (const bad of [undefined, null, '', 'mean', 'Run', 1]) {
    assert.throws(() => step1Verdict(full12(), { ...REG1, costEstimator: bad }), (e) => e instanceof TypeError && /costEstimator/.test(e.message), String(bad));
  }
  const { costEstimator: _omit, ...noField } = REG1;
  assert.throws(() => step1Verdict(full12(), noField), (e) => e instanceof TypeError && /costEstimator/.test(e.message));
});

// ---- randomParams -----------------------------------------------------------------------------------------------------------

function near(a, b, msg) { assert.ok(Math.abs(a - b) < 1e-12, `${msg ?? ''}: ${a} vs ${b}`); }

t('randomParams: s, u, n are the means; pUp = u / (n (1 - s)); pDown = pUp (1 - s) / s', () => {
  const tRuns = [
    run({ shareXhigh: 0.2, upSwitches: 2, requests: 40 }),
    run({ shareXhigh: 0.4, upSwitches: 4, requests: 60 }),
  ];
  const p = randomParams(tRuns);
  near(p.s, 0.3, 's');
  near(p.u, 3, 'u');
  near(p.n, 50, 'n');
  near(p.pUp, 3 / (50 * 0.7), 'pUp');
  near(p.pDown, (3 / (50 * 0.7)) * 0.7 / 0.3, 'pDown');
  assert.equal(p.degenerate, false);
});

t('randomParams: the generator matches its target (expected share and up-switches per run) for a known input', () => {
  // A two-state chain of n requests: stationary share = pUp / (pUp + pDown) is NOT what the formula states; it states
  // u = n (1 - s) pUp (up-switches start from the low share) and pDown = pUp (1 - s) / s, which gives n s pDown = u.
  const p = randomParams([run({ shareXhigh: 0.25, upSwitches: 3, requests: 80 })]);
  near(80 * (1 - 0.25) * p.pUp, 3, 'expected up-switches');
  near(80 * 0.25 * p.pDown, 3, 'expected down-switches equal the up-switches');
});

t('randomParams: each probability is clipped to [0, 1]', () => {
  // u / (n (1 - s)) = 10 / (10 * 0.5) = 2 -> 1; pDown = 2 * 0.5 / 0.5 = 2 -> 1
  const big = randomParams([run({ shareXhigh: 0.5, upSwitches: 10, requests: 10 })]);
  assert.equal(big.pUp, 1);
  assert.equal(big.pDown, 1);
  assert.equal(big.degenerate, false);
  // pUp stays below 1 but pDown clips: s 0.1, u 4, n 20 -> pUp 4 / 18 = 0.222; pDown = 0.222 * 0.9 / 0.1 = 2
  const clipDown = randomParams([run({ shareXhigh: 0.1, upSwitches: 4, requests: 20 })]);
  near(clipDown.pUp, 4 / 18, 'pUp');
  assert.equal(clipDown.pDown, 1);
});

t('randomParams: s = 0 or u = 0 is degenerate with pUp and pDown both 0', () => {
  for (const over of [{ shareXhigh: 0, upSwitches: 3, requests: 40 }, { shareXhigh: 0.4, upSwitches: 0, requests: 40 }]) {
    const p = randomParams([run(over)]);
    assert.equal(p.degenerate, true, JSON.stringify(over));
    assert.equal(p.pUp, 0);
    assert.equal(p.pDown, 0);
  }
});

t('randomParams: s = 1 (division by zero in pUp) and zero requests are degenerate, with no NaN or Infinity', () => {
  for (const over of [{ shareXhigh: 1, upSwitches: 2, requests: 40 }, { shareXhigh: 0.5, upSwitches: 2, requests: 0 }]) {
    const p = randomParams([run(over)]);
    assert.equal(p.degenerate, true, JSON.stringify(over));
    for (const k of ['s', 'u', 'n', 'pUp', 'pDown']) assert.ok(Number.isFinite(p[k]), `${k} in ${JSON.stringify(over)}`);
    assert.equal(p.pUp, 0);
    assert.equal(p.pDown, 0);
  }
});

t('randomParams: empty tRuns is degenerate with s, u, n = 0 and no NaN', () => {
  assert.deepEqual(randomParams([]), { s: 0, u: 0, n: 0, pUp: 0, pDown: 0, degenerate: true });
  assert.deepEqual(randomParams(undefined), { s: 0, u: 0, n: 0, pUp: 0, pDown: 0, degenerate: true });
});
