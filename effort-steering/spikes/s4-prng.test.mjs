// s4-prng.test.mjs — the seeded PRNG behind the S4 arm plan and the permutation test.
// A registered seed must reproduce the same plan and the same p-value on any machine,
// so the sequence itself is pinned, not only its statistics.

import assert from 'node:assert/strict';
import { t } from '../core/testkit.mjs';
import { makeRng, shuffle } from './s4-prng.mjs';

const draw = (rng, n) => Array.from({ length: n }, () => rng());
// Recorded from this implementation on 2026-10-05 (see the pinned-sequence test).
const PINNED_42 = [0.8441071535926312, 0.43019958958029747, 0.7417244396638125, 0.7334562973119318];
const PINNED_42_S1 = [0.6414163063745946, 0.6424670442938805];

t('the same seed gives the same sequence', () => {
  assert.deepEqual(draw(makeRng(7), 1000), draw(makeRng(7), 1000));
  assert.deepEqual(draw(makeRng(-3, 2), 200), draw(makeRng(-3, 2), 200));
});

t('different seeds give different sequences, including seeds that differ only above bit 32', () => {
  const seeds = [0, 1, 2, -1, -2, 2 ** 32, 2 ** 32 + 1, 2 ** 40, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
  const firsts = seeds.map((s) => JSON.stringify(draw(makeRng(s), 8)));
  assert.equal(new Set(firsts).size, seeds.length);
});

t('different streams of one seed give different sequences', () => {
  assert.notDeepEqual(draw(makeRng(5, 0), 8), draw(makeRng(5, 1), 8));
  assert.notDeepEqual(draw(makeRng(5, 1), 8), draw(makeRng(5, 2), 8));
  assert.deepEqual(draw(makeRng(5), 8), draw(makeRng(5, 0), 8));
});

t('values are in [0, 1) and spread evenly over ten bins', () => {
  const rng = makeRng(123);
  const bins = new Array(10).fill(0);
  const n = 100000;
  for (let i = 0; i < n; i++) {
    const v = rng();
    assert.ok(typeof v === 'number' && v >= 0 && v < 1, `out of range: ${v}`);
    bins[Math.floor(v * 10)]++;
  }
  for (const b of bins) assert.ok(Math.abs(b - n / 10) < 600, `bin count ${b}`);
});

t('the sequence is pinned: a registered seed reproduces the same plan on any machine', () => {
  // Recorded from this implementation (mulberry32 over a mixed 32-bit state). Changing the
  // algorithm after a seed is registered would silently change the registered plan.
  assert.deepEqual(draw(makeRng(42), 4), PINNED_42);
  assert.deepEqual(draw(makeRng(42, 1), 2), PINNED_42_S1);
});

t('a seed that is not a safe integer throws a TypeError', () => {
  for (const bad of [1.5, NaN, Infinity, '1', 2 ** 53, null, undefined, {}]) {
    assert.throws(() => makeRng(bad), TypeError, String(bad));
  }
});

t('a stream that is not a safe integer >= 0 throws a TypeError', () => {
  for (const bad of [-1, 0.5, '1', NaN, null]) {
    assert.throws(() => makeRng(1, bad), TypeError, String(bad));
  }
});

t('shuffle returns a permutation, leaves its input alone, and is deterministic per seed', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const copy = [...input];
  const a = shuffle(input, makeRng(9));
  assert.deepEqual(input, copy);
  assert.deepEqual([...a].sort((x, y) => x - y), copy);
  assert.deepEqual(shuffle(input, makeRng(9)), a);
  assert.notDeepEqual(shuffle(input, makeRng(10)), a);
  assert.deepEqual(shuffle([], makeRng(1)), []);
});

t('shuffle is uniform: each of the 6 orders of 3 items appears about equally often', () => {
  const rng = makeRng(77);
  const counts = new Map();
  const n = 60000;
  for (let i = 0; i < n; i++) {
    const k = shuffle([0, 1, 2], rng).join('');
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.size, 6);
  for (const c of counts.values()) assert.ok(Math.abs(c - n / 6) < 500, `count ${c}`);
});
