import assert from 'node:assert/strict';
import { t } from '../core/testkit.mjs';
import { usageRecords, dedupeKeyReport, effortKeyPaths } from './s2-usage-report.mjs';

// Placeholder fixture. Shapes follow real Claude Code assistant records; every
// text value is a placeholder, never copied transcript content.
function assistant({ uuid, mid, thinking, out = 50, extra = {} }) {
  return JSON.stringify({
    parentUuid: 'parent-' + uuid,
    isSidechain: false,
    message: {
      id: mid,
      role: 'assistant',
      content: [{ type: 'text', text: 'PLACEHOLDER' }],
      usage: {
        input_tokens: 3,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 200,
        output_tokens: out,
        output_tokens_details: { thinking_tokens: thinking },
      },
    },
    type: 'assistant',
    uuid,
    sessionId: 'sess-1',
    effort: 'high',
    ...extra,
  });
}

const A1 = assistant({ uuid: 'u1', mid: 'msg_A', thinking: 1895 });
const A2 = assistant({ uuid: 'u2', mid: 'msg_A', thinking: 1895 });
const B1 = assistant({ uuid: 'u3', mid: 'msg_B', thinking: 10 });
const BAD = '{not json';
const NO_USAGE = JSON.stringify({ type: 'user', uuid: 'u4', message: { role: 'user', content: 'PLACEHOLDER' } });

t('usageRecords parses usage lines and skips bad or usage-free lines', () => {
  const recs = usageRecords([A1, BAD, A2, NO_USAGE, B1, '']);
  assert.equal(recs.length, 3);
  assert.deepEqual(recs.map((r) => r.line), [1, 3, 5]);
  assert.equal(recs[0].thinkingTokens, 1895);
  assert.equal(recs[0].outputTokens, 50);
  assert.equal(recs[0].cacheCreation, 100);
  assert.equal(recs[0].cacheRead, 200);
  assert.equal(recs[0].ids['message.id'], 'msg_A');
  assert.equal(recs[0].ids['uuid'], 'u1');
  assert.equal(recs[0].ids['sessionId'], 'sess-1');
});

t('usageRecords uses null for absent token fields and does not treat arrays as ids', () => {
  const line = JSON.stringify({
    type: 'assistant',
    uuid: 'u9',
    message: { id: 'm9', content: [{ type: 'tool_use', id: 'toolu_1' }], usage: { output_tokens: 7 } },
  });
  const [r] = usageRecords([line]);
  assert.equal(r.thinkingTokens, null);
  assert.equal(r.cacheCreation, null);
  assert.equal(r.cacheRead, null);
  assert.equal(r.outputTokens, 7);
  assert.deepEqual(Object.keys(r.ids).sort(), ['message.id', 'uuid']);
});

t('usageRecords ignores ids inside the dynamic-key wireToolInputs subtree', () => {
  const line = JSON.stringify({
    type: 'assistant',
    uuid: 'u8',
    message: { id: 'm8', usage: { output_tokens: 2 } },
    wireToolInputs: { toolu_X: { id: 'inner', task_id: 't' } },
  });
  const [r] = usageRecords([line]);
  assert.deepEqual(Object.keys(r.ids).sort(), ['message.id', 'uuid']);
});

t('dedupeKeyReport: message id collapses duplicates, per-line uuid does not', () => {
  const rep = dedupeKeyReport(usageRecords([A1, A2, B1]));
  const byKey = Object.fromEntries(rep.map((r) => [r.key, r]));
  assert.equal(byKey['message.id'].groups, 2);
  assert.equal(byKey['message.id'].consistent, true);
  assert.equal(byKey['uuid'].groups, 3);
  assert.equal(byKey['uuid'].consistent, true);
});

t('dedupeKeyReport: a key shared by records with different thinking tokens is inconsistent', () => {
  const clash = assistant({ uuid: 'u5', mid: 'msg_A', thinking: 7 });
  const rep = dedupeKeyReport(usageRecords([A1, clash, B1]));
  const byKey = Object.fromEntries(rep.map((r) => [r.key, r]));
  assert.equal(byKey['message.id'].groups, 2);
  assert.equal(byKey['message.id'].consistent, false);
  assert.equal(byKey['uuid'].consistent, true);
});

t('dedupeKeyReport: records lacking a key are left out of that key only', () => {
  const noMid = JSON.stringify({ type: 'assistant', uuid: 'u6', message: { usage: { output_tokens: 1 } } });
  const rep = dedupeKeyReport(usageRecords([A1, noMid]));
  const byKey = Object.fromEntries(rep.map((r) => [r.key, r]));
  assert.equal(byKey['message.id'].groups, 1);
  assert.equal(byKey['uuid'].groups, 2);
});

t('dedupeKeyReport: no records gives an empty report', () => {
  assert.deepEqual(dedupeKeyReport([]), []);
});

t('effortKeyPaths finds effort-named key paths with array indexes normalised', () => {
  const withNested = assistant({ uuid: 'u7', mid: 'msg_C', thinking: 1, extra: { perTurnEffort: null, nested: { items: [{ Effort_level: 'x' }] } } });
  const paths = effortKeyPaths([A1, withNested, BAD, NO_USAGE]);
  assert.deepEqual(Object.keys(paths).sort(), ['effort', 'nested.items[].Effort_level', 'perTurnEffort']);
  assert.equal(paths['effort'], 2);
  assert.equal(paths['perTurnEffort'], 1);
});
