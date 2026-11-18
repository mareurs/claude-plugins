// cost.test.mjs — cost.mjs, the cost rule for a run that printed no cost (ruling R148). run.mjs's stop rule and analyze.mjs's secondaries
// both stand on it; their own suites pin the use, this one pins the rule itself.
import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { costOf, isEstimated, knownCost, largestKnownCost } from './cost.mjs';

const timedOut = (over = {}) => ({ costUsd: null, exit: { code: 137, timedOut: true, oomKilled: false }, infra: null, final: true, ...over });

t('knownCost: a number >= 0 is known (0 is a measurement); anything else, and anything that is no Row, is not', () => {
  for (const [value, want] of [[0, 0], [0.25, 0.25], [12, 12], [-0.01, null], [null, null], [undefined, null], ['3', null], [NaN, null], [Infinity, null]]) {
    assert.equal(knownCost({ costUsd: value }), want, String(value));
  }
  for (const notARow of [null, undefined, 5, 'x', []]) assert.equal(knownCost(notARow), null, String(notARow));
  assert.equal(knownCost({}), null);
});

t('isEstimated: no known cost AND (a timeout, infra interrupted, or an exhausted line whose last infrastructure was an interruption); never a noAttempt line, never a known cost', () => {
  assert.equal(isEstimated(timedOut()), true);
  assert.equal(isEstimated(timedOut({ infra: 'no_log', final: false })), true, 'a timeout whose evidence then failed');
  assert.equal(isEstimated({ costUsd: null, exit: { code: 130, timedOut: false }, infra: 'interrupted', final: false }), true);
  assert.equal(isEstimated({ costUsd: null, exit: { code: 143, timedOut: false }, infra: 'infra_exhausted', lastInfra: 'interrupted', final: true }), true);
  assert.equal(isEstimated({ costUsd: null, infra: 'interrupted' }), true, 'interrupted needs no exit object');
  assert.equal(isEstimated(timedOut({ noAttempt: true })), false, 'the line written without an attempt: its cost is in its attempt\'s own line');
  assert.equal(isEstimated(timedOut({ costUsd: 3 })), false, 'a known cost is summed as it is');
  assert.equal(isEstimated(timedOut({ costUsd: 0 })), false, 'and 0 is known');
  assert.equal(isEstimated({ costUsd: null, exit: null, infra: 'run_failed', final: false }), false, 'never reached a container');
  assert.equal(isEstimated({ costUsd: null, exit: { code: 1, timedOut: false }, infra: null, final: true }), false, 'no timeout, no signal: a null cost adds 0');
  assert.equal(isEstimated({ costUsd: null, exit: { code: 1, timedOut: false }, infra: 'infra_exhausted', lastInfra: 'api_error', final: true }), false);
  assert.equal(isEstimated(null), false);
});

// R-PL9. A plan_limit row can be a partial run that printed no JSON (the CLI refused part-way, or the container was cut off), and the arms under test burn the
// most plan usage, so summed as 0 it would hide the spend the stop rule exists to see. It is estimated like an interrupted one.
t('R-PL9 isEstimated: a plan_limit row with no known cost is estimated; with a known cost, 0 included, it is not; a noAttempt line never is', () => {
  const planLimit = (over = {}) => ({ costUsd: null, exit: { code: 1, timedOut: false, oomKilled: false }, infra: 'plan_limit', final: false, ...over });
  assert.equal(isEstimated(planLimit()), true, 'no cost, no timeout, no signal: only the infra value makes it estimated');
  assert.equal(isEstimated({ costUsd: null, infra: 'plan_limit' }), true, 'it needs no exit object');
  assert.equal(isEstimated(planLimit({ costUsd: 0.4 })), false, 'a known cost is summed as it is');
  assert.equal(isEstimated(planLimit({ costUsd: 0 })), false, 'and 0 is known');
  assert.equal(isEstimated(planLimit({ noAttempt: true })), false);
  assert.equal(isEstimated({ costUsd: null, exit: { code: 1, timedOut: false }, infra: 'api_error', final: false }), false, 'another infra value with no timeout stays as it was');
});

t('R-PL9 costOf: a plan_limit row without a cost adds the largest known cost once; with a known cost it adds that cost and is not counted as estimated', () => {
  const planLimit = (costUsd) => ({ costUsd, exit: { code: 1, timedOut: false, oomKilled: false }, infra: 'plan_limit', final: false });
  assert.deepEqual(costOf([{ costUsd: 4 }, { costUsd: 6 }, planLimit(null)]), { costUsd: 10 + 6, estimatedRows: 1, largest: 6 });
  assert.deepEqual(costOf([{ costUsd: 4 }, planLimit(null), planLimit(null)]), { costUsd: 4 + 2 * 4, estimatedRows: 2, largest: 4 });
  assert.deepEqual(costOf([{ costUsd: 4 }, planLimit(0.5)]), { costUsd: 4.5, estimatedRows: 0, largest: 4 });
  assert.deepEqual(costOf([planLimit(null)]), { costUsd: 0, estimatedRows: 1, largest: 0 }, 'nothing known: 0, not NaN');
});

t('largestKnownCost: the maximum of the known costs, 0 for none, 0 for rows with only unknown costs', () => {
  assert.equal(largestKnownCost([]), 0);
  assert.equal(largestKnownCost([timedOut(), { costUsd: null }]), 0);
  assert.equal(largestKnownCost([{ costUsd: 2 }, { costUsd: 9 }, { costUsd: 3 }, timedOut()]), 9);
  assert.equal(largestKnownCost([{ costUsd: 0 }]), 0);
});

t('costOf: the known costs plus, per estimated row, the largest known cost; the estimate count is reported; nothing known gives 0, not NaN', () => {
  assert.deepEqual(costOf([]), { costUsd: 0, estimatedRows: 0, largest: 0 });
  assert.deepEqual(costOf([{ costUsd: 4 }, { costUsd: 6 }, timedOut(), timedOut()]), { costUsd: 10 + 12, estimatedRows: 2, largest: 6 });
  assert.deepEqual(costOf([timedOut(), timedOut()]), { costUsd: 0, estimatedRows: 2, largest: 0 });
  assert.deepEqual(costOf([{ costUsd: 5 }, { costUsd: null, exit: { code: 1, timedOut: false }, infra: null }]), { costUsd: 5, estimatedRows: 0, largest: 5 });
});
