import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { pairedLowerBound } from '../s5/analyze.mjs';
import { analyzeR1 } from './r1-analyze.mjs';

const ids = Array.from({ length: 16 }, (_, i) => `cs-t${String(i).padStart(2, '0')}`);
const prereg = (over = {}) => ({
  margin: 0.15, alpha: 0.05, bound: { method: 'paired-t', resamples: 0, seed: 1 },
  tasks: ids.map((id) => ({ id })), ...over,
});
const row = (taskId, arm, rep, pass, over = {}) => ({
  taskId, arm, runId: `${taskId}.${arm}.${rep}`, final: true, infra: null, grade: { pass }, ...over,
});
// `passes(task)` says how many of the 2 runs of the arm pass.
const rowsFor = (arm, passes, taskIds = ids) => taskIds.flatMap((id) => [0, 1].map((rep) => row(id, arm, rep, rep < passes(id))));
const allPass = () => 2;

t('stage 1, every C run passes: support, no bound', () => {
  const r = analyzeR1(rowsFor('C', allPass), prereg());
  assert.equal(r.stage, 1);
  assert.equal(r.verdict, 'support');
  assert.equal(r.d, null);
  assert.deepEqual(r.failedC, []);
  assert.equal(r.included.length, 16);
});

t('stage 1, one C run fails: needs stage 2 and names the task', () => {
  const r = analyzeR1(rowsFor('C', (id) => (id === ids[3] ? 1 : 2)), prereg());
  assert.equal(r.verdict, 'needs_stage_2');
  assert.deepEqual(r.failedC, [ids[3]]);
});

t('stage 2, all tied: lower bound 0 and support', () => {
  const r = analyzeR1([...rowsFor('C', allPass), ...rowsFor('A', allPass)], prereg());
  assert.equal(r.stage, 2);
  assert.equal(r.d.lower, 0);
  assert.equal(r.verdict, 'support');
});

t('stage 2, one task C 0 of 2 and A 2 of 2: the verdict follows the strict comparison with the registered bound', () => {
  const rows = [...rowsFor('C', (id) => (id === ids[0] ? 0 : 2)), ...rowsFor('A', allPass)];
  const diffs = ids.map((id) => (id === ids[0] ? -1 : 0));
  const expected = pairedLowerBound(diffs, { method: 'paired-t', resamples: 0, seed: 1, alpha: 0.05 });
  const r = analyzeR1(rows, prereg());
  assert.equal(r.d.lower, expected.lower);
  assert.equal(r.d.mean, expected.mean);
  assert.equal(r.verdict, expected.lower > -0.15 ? 'support' : 'not_shown_safe');
  assert.equal(r.verdict, 'not_shown_safe', 'one total failure in 16 sinks the claim (paired-t lower bound is about -0.17)');
});

t('stage 2, two half failures stay inside the margin', () => {
  const rows = [...rowsFor('C', (id) => (id === ids[0] || id === ids[1] ? 1 : 2)), ...rowsFor('A', allPass)];
  const r = analyzeR1(rows, prereg());
  assert.equal(r.verdict, r.d.lower > -0.15 ? 'support' : 'not_shown_safe');
  assert.ok(Math.abs(r.d.mean - -0.0625) < 1e-12);
});

t('a lost run drops the task from both arms', () => {
  const lost = row(ids[0], 'A', 1, false, { infra: 'infra_exhausted' });
  const rows = [...rowsFor('C', allPass), ...rowsFor('A', allPass, ids.slice(1)), row(ids[0], 'A', 0, true), lost];
  const r = analyzeR1(rows, prereg());
  assert.deepEqual(r.excluded, [{ taskId: ids[0], reason: 'infra_exhausted_in_A' }]);
  assert.equal(r.included.length, 15);
  assert.ok(!r.included.some((x) => x.taskId === ids[0]));
});

t('a task with C rows but no A rows in stage 2 is excluded', () => {
  const rows = [...rowsFor('C', allPass), ...rowsFor('A', allPass, ids.slice(1))];
  const r = analyzeR1(rows, prereg());
  assert.deepEqual(r.excluded, [{ taskId: ids[0], reason: 'no_counted_run_in_A' }]);
});

t('a registered task with no counted C run is excluded', () => {
  const r = analyzeR1(rowsFor('C', allPass, ids.slice(1)), prereg());
  assert.deepEqual(r.excluded, [{ taskId: ids[0], reason: 'no_counted_run_in_C' }]);
  assert.equal(r.included.length, 15);
});

t('fewer than 2 included tasks is insufficient, never a bound', () => {
  const r = analyzeR1(rowsFor('C', allPass, [ids[0]]), prereg());
  assert.equal(r.verdict, 'insufficient');
  assert.equal(r.d, null);
});

t('the margin comparison is strict', () => {
  // Two tasks whose diffs give lower exactly at the margin: use the percentile method with 1 resample at a fixed seed is not
  // exact, so pin the rule with a registered margin equal to the computed lower bound itself.
  const rows = [...rowsFor('C', (id) => (id === ids[0] ? 0 : 2)), ...rowsFor('A', allPass)];
  const lower = analyzeR1(rows, prereg()).d.lower;
  const r = analyzeR1(rows, prereg({ margin: -lower }));
  assert.equal(r.verdict, 'not_shown_safe');
  const looser = analyzeR1(rows, prereg({ margin: -lower + 1e-9 }));
  assert.equal(looser.verdict, 'support');
});

t('two counted rows with one runId throw', () => {
  const rows = [...rowsFor('C', allPass), row(ids[0], 'C', 0, true)];
  assert.throws(() => analyzeR1(rows, prereg()), /runId/);
});

t('rows of arm B and of unregistered tasks change nothing', () => {
  const base = analyzeR1(rowsFor('C', allPass), prereg());
  const noisy = analyzeR1([...rowsFor('C', allPass), row(ids[0], 'B', 0, false), row('cs-other', 'C', 0, false)], prereg());
  assert.deepEqual(noisy, base);
});

t('a timeout is a counted failure, a non-final retry row is not counted', () => {
  const rows = rowsFor('C', allPass).map((r) => (r.runId === `${ids[0]}.C.1` ? { ...r, grade: null } : r));
  const r = analyzeR1(rows, prereg());
  assert.equal(r.verdict, 'needs_stage_2');
  const retry = [...rowsFor('C', allPass), row(ids[0], 'C', 1, false, { final: false, runId: 'retry' })];
  assert.equal(analyzeR1(retry, prereg()).verdict, 'support');
});

t('a stage 1 that stopped early is incomplete, never support', () => {
  const r = analyzeR1(rowsFor('C', allPass, ids.slice(0, 2)), prereg());
  assert.equal(r.verdict, 'incomplete');
  assert.equal(r.reason, 'unmeasured_tasks');
  assert.equal(r.excluded.length, 14);
});

t('stage 1: a lost run does not hide an observed C failure of the same task', () => {
  const rows = [
    ...rowsFor('C', allPass, ids.slice(1)),
    row(ids[0], 'C', 0, false),
    row(ids[0], 'C', 1, false, { infra: 'infra_exhausted' }),
  ];
  const r = analyzeR1(rows, prereg());
  assert.deepEqual(r.failedC, [ids[0]]);
  assert.equal(r.verdict, 'needs_stage_2');
  assert.deepEqual(r.excluded, [{ taskId: ids[0], reason: 'infra_exhausted_in_C' }]);
});

t('stage 2: a lost task with no observed C failure is dropped and the bound still decides', () => {
  const lost = row(ids[0], 'A', 1, false, { infra: 'infra_exhausted' });
  const rows = [...rowsFor('C', allPass), ...rowsFor('A', allPass, ids.slice(1)), row(ids[0], 'A', 0, true), lost];
  const r = analyzeR1(rows, prereg());
  assert.equal(r.included.length, 15);
  assert.equal(r.verdict, 'support');
});

t('stage 2: a lost task that has an observed C failure makes the result incomplete', () => {
  const lost = row(ids[0], 'A', 1, false, { infra: 'infra_exhausted' });
  const rows = [
    ...rowsFor('C', (id) => (id === ids[0] ? 1 : 2)),
    ...rowsFor('A', allPass, ids.slice(1)),
    row(ids[0], 'A', 0, true),
    lost,
  ];
  const r = analyzeR1(rows, prereg());
  assert.deepEqual(r.failedC, [ids[0]]);
  assert.equal(r.verdict, 'incomplete');
});

t('stage 2: a task with C rows but no A rows at all makes the result incomplete', () => {
  const rows = [...rowsFor('C', allPass), ...rowsFor('A', allPass, ids.slice(1))];
  assert.equal(analyzeR1(rows, prereg()).verdict, 'incomplete');
});
