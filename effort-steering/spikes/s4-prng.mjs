// s4-prng.mjs — a small seeded PRNG for the S4 experiment (ruling R24).
//
// The registered `seed` decides which repeats of each prompt are held out, the order of
// the runs, and the permutation draws of the p-value. A registered number must give the
// same plan and the same p on any machine, so this is a fixed algorithm (mulberry32), not
// Math.random. Its state is 32 bits: the seed's two 32-bit halves and a `stream` number
// are mixed into it, so seeds that differ only above bit 32 still differ, and the plan and
// the permutation test can draw from two independent streams of one seed.
//
// Not cryptographic. Nothing here touches the clock, the environment or the filesystem.

const isStream = (v) => Number.isSafeInteger(v) && v >= 0;

// murmur3's 32-bit finaliser: spreads every input bit over the whole word.
function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function makeRng(seed, stream = 0) {
  if (!Number.isSafeInteger(seed)) throw new TypeError(`seed must be a safe integer, got ${String(seed)}`);
  if (!isStream(stream)) throw new TypeError(`stream must be a safe integer >= 0, got ${String(stream)}`);
  const big = BigInt.asUintN(64, BigInt(seed));
  const lo = Number(big & 0xffffffffn);
  const hi = Number(big >> 32n);
  const st = BigInt.asUintN(64, BigInt(stream));
  let a = fmix32(fmix32(lo ^ 0x9e3779b9) ^ fmix32(hi ^ 0x7f4a7c15) ^ fmix32(Number(st & 0xffffffffn) ^ 0x2545f491));
  // mulberry32
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates on a copy; the input is never mutated.
export function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
