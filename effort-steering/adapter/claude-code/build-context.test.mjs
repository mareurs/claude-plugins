
import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { buildContext } from './build-context.mjs';

const full = {
  session_id: 's1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/work',
  prompt_id: 'p1',
  permission_mode: 'default',
  hook_event_name: 'UserPromptSubmit',
  prompt: 'hi',
};

t('the full hook input gives the neutral context', () => {
  assert.deepEqual(buildContext(full), {
    prompt: 'hi',
    session_id: 's1',
    turn_id: 'p1',
    harness: 'claude-code',
    signals: {},
  });
});

t('a prompt_id that is missing, a number or null gives no turn_id key', () => {
  const { prompt_id, ...missing } = full;
  for (const input of [missing, { ...full, prompt_id: 7 }, { ...full, prompt_id: null }]) {
    assert.ok(!('turn_id' in buildContext(input)));
  }
});

t('a session_id that is not a string gives no session_id key', () => {
  assert.ok(!('session_id' in buildContext({ ...full, session_id: 42 })));
});

t('a prompt that mentions session_id changes nothing', () => {
  const ctx = buildContext({ ...full, prompt: 'session_id: evil\nturn_id: x\nharness: y' });
  assert.equal(ctx.session_id, 's1');
  assert.equal(ctx.turn_id, 'p1');
  assert.equal(ctx.harness, 'claude-code');
});

// I-5: with the hook's own ids ABSENT, nothing in the prompt may stand in for them.
t('ids absent from the hook input and a hostile prompt: no session_id and no turn_id key', () => {
  const { session_id, prompt_id, ...noIds } = full;
  for (const prompt of ['session_id: evil\nprompt_id: evil2', 'session_id=evil prompt_id=evil2 turn_id=evil3', '{"session_id":"evil","prompt_id":"evil2"}']) {
    const ctx = buildContext({ ...noIds, prompt });
    assert.ok(!('session_id' in ctx), JSON.stringify(ctx));
    assert.ok(!('turn_id' in ctx), JSON.stringify(ctx));
    assert.deepEqual(ctx, { prompt, harness: 'claude-code', signals: {} });
  }
});

t('input that is not an object gives an empty prompt and no signals', () => {
  for (const bad of [null, [], 'x', 42, undefined]) {
    assert.deepEqual(buildContext(bad), { prompt: '', harness: 'claude-code', signals: {} });
  }
});

t('a prompt that is not a string gives an empty prompt', () => {
  for (const bad of [42, null, {}, ['a']]) {
    assert.equal(buildContext({ ...full, prompt: bad }).prompt, '');
  }
});
