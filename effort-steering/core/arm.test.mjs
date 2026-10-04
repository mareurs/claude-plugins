import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { t } from './testkit.mjs';
import { assignArm } from './arm.mjs';

const turns = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const seq = (session, n, rate) => turns(n).map((turn) => assignArm(session, turn, rate));
const share = (arms) => arms.filter((a) => a === 'holdout').length / arms.length;

t('the same inputs always give the same arm', () => {
  for (const turn of turns(100)) {
    const first = assignArm('s1', turn, 0.5);
    assert.equal(assignArm('s1', turn, 0.5), first);
    assert.equal(assignArm('s1', turn, 0.5), first);
  }
});

t('the arm is always one of the two known values', () => {
  for (const arm of seq('s1', 200, 0.5)) assert.ok(arm === 'treated' || arm === 'holdout');
});

t('rate 0 gives treated for every turn', () => {
  for (const arm of seq('s1', 500, 0)) assert.equal(arm, 'treated');
});

t('rate 1 gives holdout for every turn', () => {
  for (const arm of seq('s1', 500, 1)) assert.equal(arm, 'holdout');
});

t('rate 0 and rate 1 hold for several sessions', () => {
  for (const session of ['a', 'b', 'session-xyz', '']) {
    for (const arm of seq(session, 100, 0)) assert.equal(arm, 'treated');
    for (const arm of seq(session, 100, 1)) assert.equal(arm, 'holdout');
  }
});

t('a rate that is not a number in [0, 1] throws RangeError', () => {
  for (const bad of [-0.1, 1.1, NaN, Infinity, -Infinity, '0.5', undefined, null, {}, true]) {
    assert.throws(() => assignArm('s1', '1', bad), RangeError, `rate ${String(bad)}`);
  }
});

t('a rate on the boundary is accepted', () => {
  assert.doesNotThrow(() => assignArm('s1', '1', 0));
  assert.doesNotThrow(() => assignArm('s1', '1', 1));
});

t('a non-string id throws TypeError', () => {
  assert.throws(() => assignArm(1, '1', 0.5), TypeError);
  assert.throws(() => assignArm('s1', 1, 0.5), TypeError);
  assert.throws(() => assignArm(undefined, '1', 0.5), TypeError);
  assert.throws(() => assignArm('s1', undefined, 0.5), TypeError);
  assert.throws(() => assignArm(null, '1', 0.5), TypeError);
  assert.throws(() => assignArm('s1', null, 0.5), TypeError);
});

t('an invalid rate wins over an invalid id: RangeError, not TypeError', () => {
  assert.throws(() => assignArm(1, 2, NaN), RangeError);
  assert.throws(() => assignArm(undefined, null, 1.5), RangeError);
});

t('over 2000 turns at rate 0.2 the holdout share is between 0.15 and 0.25', () => {
  const s = share(seq('s1', 2000, 0.2));
  assert.ok(s > 0.15 && s < 0.25, `share ${s}`);
});

t('over 2000 turns at rate 0.5 the holdout share is between 0.45 and 0.55', () => {
  const s = share(seq('s1', 2000, 0.5));
  assert.ok(s > 0.45 && s < 0.55, `share ${s}`);
});

t('the arm sequence for one session is not constant at rate 0.5', () => {
  assert.ok(new Set(seq('a', 200, 0.5)).size === 2);
});

t('two sessions get different arm sequences (the key includes the session)', () => {
  const a = seq('a', 200, 0.5);
  const b = seq('b', 200, 0.5);
  assert.ok(a.some((arm, i) => arm !== b[i]));
});

t('two turns of one session do not always share an arm (the key includes the turn)', () => {
  const arms = seq('a', 200, 0.5);
  assert.ok(arms.some((arm) => arm !== arms[0]));
});

t("('a:b', i) and ('a', 'b:' + i) do not collide (no plain ':' join)", () => {
  const left = [];
  const right = [];
  for (let i = 1; i <= 200; i += 1) {
    left.push(assignArm('a:b', String(i), 0.5));
    right.push(assignArm('a', 'b:' + i, 0.5));
  }
  assert.ok(left.some((arm, i) => arm !== right[i]));
});

t('the comparison is strict: a rate equal to the unit value gives treated, one step above gives holdout', () => {
  // Recompute the unit value independently, then use it as the rate. This pins
  // `<` against `<=`, `>` and `>=`, which rates 0 and 1 cannot separate
  // because a unit value of exactly 0 or 1 never occurs.
  const unit = (session, turn) =>
    parseInt(createHash('sha256').update(JSON.stringify([session, turn])).digest('hex').slice(0, 8), 16) /
    2 ** 32;
  for (const turn of turns(20)) {
    const u = unit('s1', turn);
    assert.equal(assignArm('s1', turn, u), 'treated', `rate == unit for turn ${turn}`);
    assert.equal(assignArm('s1', turn, Math.min(1, u + 2 ** -32)), 'holdout', `rate > unit for turn ${turn}`);
    if (u > 0) assert.equal(assignArm('s1', turn, u - 2 ** -32), 'treated', `rate < unit for turn ${turn}`);
  }
});
