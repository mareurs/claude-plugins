// Test for S4a: replay of UserPromptSubmit hook output recorded in transcripts.
// Synthetic jsonl only; every text value is a placeholder.

import assert from 'node:assert/strict';
import { t } from '../core/testkit.mjs';
import { replayHookContext } from './s4a-hook-context-replay.mjs';

function user(content, extra = {}) {
  return JSON.stringify({ isSidechain: false, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content }, ...extra });
}
function attach(hookName, hookEvent = 'UserPromptSubmit') {
  return JSON.stringify({ type: 'attachment', attachment: { type: 'hook_additional_context', content: ['PLACEHOLDER'], hookName, hookEvent } });
}

t('replayHookContext: orders, multi-hook turns, non-human attachments', () => {
  const lines = [
    user('PLACEHOLDER-ONE'),
    attach('A'),
    attach('B'),
    attach('C', 'PostToolUse'), // never counted
    user('PLACEHOLDER-PEER', { origin: { kind: 'peer', from: 'x' } }),
    attach('D'),
    user('PLACEHOLDER-TWO'), // no attachment
    'not json',
  ];
  const r = replayHookContext(lines);
  assert.equal(r.turns, 2);
  assert.equal(r.withAttachment, 2);
  assert.equal(r.multiHookTurns, 1);
  assert.deepEqual(r.orders, { 'A>B': 1 });
  assert.equal(r.nonHumanWithAttachment.peer, 1);
  assert.equal(r.nonHumanWithAttachment['task-notification'], 0);
  assert.equal(r.nonHumanWithAttachment.command, 0);
});

t('replayHookContext: hook_success records of UserPromptSubmit are counted', () => {
  const ok = (name) => JSON.stringify({ type: 'attachment', attachment: { type: 'hook_success', hookName: name, hookEvent: 'UserPromptSubmit', content: 'PLACEHOLDER' } });
  const r = replayHookContext([user('PLACEHOLDER'), ok('A'), ok('B')]);
  assert.equal(r.withAttachment, 1);
  assert.deepEqual(r.orders, { 'A>B': 1 });
});

t('replayHookContext: PostToolUse-only turn is not counted', () => {
  const r = replayHookContext([user('PLACEHOLDER'), attach('A', 'PostToolUse')]);
  assert.equal(r.turns, 1);
  assert.equal(r.withAttachment, 0);
  assert.deepEqual(r.orders, {});
});
