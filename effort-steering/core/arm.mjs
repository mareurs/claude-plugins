// arm.mjs — deterministic holdout assignment. For a decided steering sentence
// it answers: apply it ('treated') or withhold it ('holdout'). The same
// (session, turn, rate) always gives the same arm, so a replay or a retry
// never moves a turn from one arm to the other.

import { createHash } from 'node:crypto';

export function assignArm(sessionId, turnId, holdoutRate) {
  // The rate is validated first, so a bad rate wins over a bad id.
  if (typeof holdoutRate !== 'number' || !(holdoutRate >= 0 && holdoutRate <= 1)) {
    throw new RangeError(`holdoutRate must be a number in [0, 1], got ${String(holdoutRate)}`);
  }
  // Ids must already be strings: JSON.stringify([1, 2]) and
  // JSON.stringify(['1', '2']) differ, so coercing would split one logical
  // turn across two arms.
  if (typeof sessionId !== 'string') {
    throw new TypeError('sessionId must be a string');
  }
  if (typeof turnId !== 'string') {
    throw new TypeError('turnId must be a string');
  }
  // JSON.stringify of the pair is injective, unlike a plain ':' join, where
  // ('a:b', 'c') and ('a', 'b:c') would share a key.
  const digest = createHash('sha256').update(JSON.stringify([sessionId, turnId])).digest('hex');
  const unit = parseInt(digest.slice(0, 8), 16) / 2 ** 32;
  return unit < holdoutRate ? 'holdout' : 'treated';
}
