import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { t } from '../core/testkit.mjs';
import { turnsFromTranscript, bucketReport, byEffort, median, p90 } from './s3-replay.mjs';

// Placeholder fixture. Shapes follow real Claude Code records (fields found in
// Step 1 of the S3 brief); every text value is a placeholder, never transcript content.
const PROMPT_1 = 'PLACEHOLDER-PROMPT-ONE ultrathink?';
const PROMPT_2 = 'PLACEHOLDER-PROMPT-TWO';

function user(content, extra = {}) {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    userType: 'external',
    origin: { kind: 'human' },
    message: { role: 'user', content },
    sessionId: 'sess-1',
    uuid: 'u-' + Math.random().toString(36).slice(2),
    ...extra,
  });
}

function assistant({ mid, thinking, out, cache, effort, sidechain = false }) {
  const obj = {
    isSidechain: sidechain,
    type: 'assistant',
    message: {
      id: mid,
      role: 'assistant',
      content: [{ type: 'text', text: 'PLACEHOLDER-ANSWER' }],
      usage: {
        cache_creation_input_tokens: cache,
        cache_read_input_tokens: 7,
        output_tokens: out,
        output_tokens_details: { thinking_tokens: thinking },
      },
    },
    sessionId: 'sess-1',
    uuid: 'a-' + Math.random().toString(36).slice(2),
  };
  if (effort !== undefined) obj.effort = effort;
  return JSON.stringify(obj);
}

const lines = [
  assistant({ mid: 'm-orphan', thinking: 999, out: 999, cache: 999, effort: 'low' }), // before any prompt: ignored
  user(PROMPT_1),
  assistant({ mid: 'm1', thinking: 100, out: 150, cache: 1000, effort: 'xhigh' }),
  assistant({ mid: 'm1', thinking: 100, out: 150, cache: 1000, effort: 'xhigh' }), // duplicate of m1
  // tool result: must not start a turn
  user([{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'PLACEHOLDER' }], { toolUseResult: { stdout: 'PLACEHOLDER' }, origin: undefined }),
  assistant({ mid: 'm2', thinking: 40, out: 60, cache: 500, effort: 'high' }),
  // command echo, sidechain, meta, compaction summary, peer and task-notification records: none start a turn
  user('<command-name>/PLACEHOLDER</command-name>', { origin: undefined }),
  user('<local-command-stdout>PLACEHOLDER</local-command-stdout>', { origin: undefined }),
  user('PLACEHOLDER-SIDECHAIN', { isSidechain: true }),
  user('PLACEHOLDER-TOOLRESULT-AS-TEXT', { origin: undefined, toolUseResult: { stdout: 'PLACEHOLDER' } }),
  user('PLACEHOLDER-META', { isMeta: true }),
  user('PLACEHOLDER-SUMMARY', { origin: undefined, isCompactSummary: true, isVisibleInTranscriptOnly: true }),
  user('PLACEHOLDER-PEER', { origin: { kind: 'peer', from: 'x' } }),
  user('<task-notification>PLACEHOLDER</task-notification>', { origin: { kind: 'task-notification' } }),
  user([{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined }),
  '{not json',
  user(PROMPT_2),
  assistant({ mid: 'm3', thinking: 0, out: 10, cache: 20 }), // no effort field
  assistant({ mid: 'm-side', thinking: 7777, out: 7777, cache: 7777, effort: 'low', sidechain: true }), // sidechain: not counted
];

t('two turns come back and non-prompt user records do not start a turn', () => {
  const turns = turnsFromTranscript(lines, 'message.id');
  assert.equal(turns.length, 2);
});

t('a duplicated assistant message counts once in the sums', () => {
  const [a, b] = turnsFromTranscript(lines, 'message.id');
  assert.equal(a.thinkingTokens, 140); // 100 once + 40
  assert.equal(a.outputTokens, 210);
  assert.equal(a.cacheCreation, 1500);
  assert.equal(b.thinkingTokens, 0);
  assert.equal(b.outputTokens, 10);
  assert.equal(b.cacheCreation, 20);
});

t('without a dedupe hit the duplicate would double count (guard against a no-op dedupe)', () => {
  const [a] = turnsFromTranscript(lines, 'uuid'); // uuid differs per line: no dedupe
  assert.equal(a.thinkingTokens, 240);
});

t('turn effort is the effort of the first deduped assistant message, or null', () => {
  const [a, b] = turnsFromTranscript(lines, 'message.id');
  assert.equal(a.effort, 'xhigh');
  assert.equal(b.effort, null);
});

t('prompt hash and features come from the prompt; no turn field holds prompt text', () => {
  const turns = turnsFromTranscript(lines, 'message.id');
  assert.equal(turns[0].promptSha256, crypto.createHash('sha256').update(PROMPT_1).digest('hex'));
  assert.equal(turns[0].features.explicitDeep, true);
  assert.equal(turns[0].features.isQuestion, true);
  assert.equal(turns[1].features.explicitDeep, false);
  const json = JSON.stringify(turns);
  assert.ok(!json.includes('PLACEHOLDER'));
  assert.ok(!json.includes('ultrathink'));
});

t('median and p90', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([3, 1, 2, 4]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(p90([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), 9); // sorts first
  assert.equal(p90([5]), 5);
  assert.equal(p90([]), 0);
});

function turn(chars, thinking, over = {}) {
  return {
    promptSha256: 'h',
    features: { chars, words: 1, isQuestion: false, hasStackTrace: false, startsWithSlash: false, explicitDeep: false, ...(over.features || {}) },
    thinkingTokens: thinking,
    outputTokens: 0,
    cacheCreation: 0,
    effort: over.effort === undefined ? 'high' : over.effort,
    messages: 1,
  };
}

t('bucketReport splits by every feature and reports n, median and p90 of thinking tokens', () => {
  const turns = [
    turn(40, 10),
    turn(41, 20),
    turn(400, 30),
    turn(401, 40),
    turn(5, 50, { features: { isQuestion: true } }),
    turn(5, 60, { features: { hasStackTrace: true } }),
    turn(5, 70, { features: { startsWithSlash: true } }),
    turn(5, 80, { features: { explicitDeep: true } }),
  ];
  const rows = bucketReport(turns);
  assert.deepEqual(rows.map((r) => r.name), ['all', 'chars<=40', 'chars41-400', 'chars>400', 'isQuestion', 'hasStackTrace', 'startsWithSlash', 'explicitDeep']);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.all.n, 8);
  assert.equal(by['chars<=40'].n, 5); // chars 40 and four chars-5 turns
  assert.equal(by['chars41-400'].n, 2); // 41 and 400 are both in
  assert.equal(by['chars>400'].n, 1); // 401 only
  assert.equal(by['chars>400'].median, 40);
  assert.equal(by['chars41-400'].median, 25);
  assert.equal(by.isQuestion.n, 1);
  assert.equal(by.isQuestion.median, 50);
  assert.equal(by.hasStackTrace.median, 60);
  assert.equal(by.startsWithSlash.median, 70);
  assert.equal(by.explicitDeep.p90, 80);
  assert.equal(by.all.p90, 80); // ceil(0.9*8)-1 = 7
});

t('bucketReport on no turns gives n 0 rows rather than throwing', () => {
  const rows = bucketReport([]);
  assert.equal(rows.length, 8);
  assert.ok(rows.every((r) => r.n === 0 && r.median === 0 && r.p90 === 0));
});

t('byEffort groups by effort and puts null under unknown', () => {
  const turns = [turn(1, 1, { effort: 'high' }), turn(1, 2, { effort: 'xhigh' }), turn(1, 3, { effort: null }), turn(1, 4, { effort: 'high' })];
  const g = byEffort(turns);
  assert.deepEqual(Object.keys(g).sort(), ['high', 'unknown', 'xhigh']);
  assert.equal(g.high.length, 2);
  assert.equal(g.unknown.length, 1);
  assert.equal(g.unknown[0].thinkingTokens, 3);
});
