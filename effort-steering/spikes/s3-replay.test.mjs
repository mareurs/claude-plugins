import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from '../core/testkit.mjs';
import { turnsFromTranscript, bucketReport, byEffort, median, p90, createTurnCollector, measuredTurns, replay, profileName } from './s3-replay.mjs';

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
  assert.equal(a.messages, 2); // m1 once + m2
  assert.equal(b.messages, 1);
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

// ---- Round 1: turn terminators, measuredTurns, multi-directory replay.

const P1 = 'PLACEHOLDER-A';
const P2 = 'PLACEHOLDER-B';

// Records that start an assistant response on their own, so replies after them
// belong to no human prompt. name -> a record builder.
const TRIGGERS = {
  peer: () => user('PLACEHOLDER-PEER', { isMeta: true, origin: { kind: 'peer', from: 'x' } }),
  'task-notification': () => user('<task-notification>PLACEHOLDER</task-notification>', { origin: { kind: 'task-notification' } }),
  command: () => user('<command-name>/PLACEHOLDER</command-name>', { origin: undefined }),
  'command (message tag, human origin)': () => user('<command-message>PLACEHOLDER</command-message>', { origin: { kind: 'human' } }),
};

for (const [name, build] of Object.entries(TRIGGERS)) {
  t(`a ${name} record ends the turn: its replies are not folded into the previous prompt`, () => {
    const c = createTurnCollector('message.id');
    for (const l of [
      user(P1),
      assistant({ mid: 'ta', thinking: 10, out: 1, cache: 1 }),
      build(),
      assistant({ mid: 'tb', thinking: 5000, out: 500, cache: 50 }),
      assistant({ mid: 'tc', thinking: 600, out: 60, cache: 6 }),
      user(P2),
      assistant({ mid: 'td', thinking: 3, out: 1, cache: 1 }),
    ]) c.push(l);
    const [a, b] = c.turns();
    assert.equal(c.turns().length, 2);
    assert.equal(a.thinkingTokens, 10);
    assert.equal(a.outputTokens, 1);
    assert.equal(a.messages, 1);
    assert.equal(b.thinkingTokens, 3);
    assert.equal(b.messages, 1);
    const key = name.startsWith('command') ? 'command' : name;
    const d = c.dropped()[key];
    assert.deepEqual(d, { messages: 2, thinkingTokens: 5600, turns: 1 });
  });
}

t('replies dropped after a trigger stay dropped until the next real prompt, across a tool result and a second trigger', () => {
  const c = createTurnCollector('message.id');
  for (const l of [
    user(P1),
    assistant({ mid: 'ua', thinking: 1, out: 1, cache: 1 }),
    TRIGGERS.peer(),
    assistant({ mid: 'ub', thinking: 100, out: 1, cache: 1 }),
    user([{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'PLACEHOLDER' }], { toolUseResult: { stdout: 'PLACEHOLDER' }, origin: undefined }),
    assistant({ mid: 'uc', thinking: 200, out: 1, cache: 1 }),
    TRIGGERS.command(),
    assistant({ mid: 'ud', thinking: 400, out: 1, cache: 1 }),
  ]) c.push(l);
  assert.equal(c.turns()[0].thinkingTokens, 1);
  assert.deepEqual(c.dropped().peer, { messages: 2, thinkingTokens: 300, turns: 1 });
  assert.deepEqual(c.dropped().command, { messages: 1, thinkingTokens: 400, turns: 1 });
});

t('a tool result and a local command output do not end the turn', () => {
  const c = createTurnCollector('message.id');
  for (const l of [
    user(P1),
    assistant({ mid: 'va', thinking: 10, out: 1, cache: 1 }),
    user([{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'PLACEHOLDER' }], { toolUseResult: { stdout: 'PLACEHOLDER' }, origin: undefined }),
    assistant({ mid: 'vb', thinking: 20, out: 1, cache: 1 }),
    user('<local-command-stdout>PLACEHOLDER</local-command-stdout>', { origin: undefined }),
    assistant({ mid: 'vc', thinking: 30, out: 1, cache: 1 }),
  ]) c.push(l);
  assert.equal(c.turns()[0].thinkingTokens, 60);
  assert.equal(c.turns()[0].messages, 3);
  assert.deepEqual(c.dropped(), {});
});

t('measuredTurns drops a prompt with no reply and keeps a reply with zero thinking', () => {
  const turns = turnsFromTranscript([
    user(P1), // no reply
    user(P2),
    assistant({ mid: 'w1', thinking: 0, out: 5, cache: 1 }),
  ], 'message.id');
  assert.deepEqual(turns.map((x) => x.messages), [0, 1]);
  const m = measuredTurns(turns);
  assert.equal(m.length, 1);
  assert.equal(m[0].messages, 1);
  assert.equal(m[0].thinkingTokens, 0);
  assert.equal(measuredTurns([]).length, 0);
});

t('profileName is the .claude* folder of the path, never a full path', () => {
  assert.equal(profileName('/home/u/.claude-sdd/projects/-some-project'), '.claude-sdd');
  assert.equal(profileName('/home/u/.claude/projects/-some-project/'), '.claude');
  assert.equal(profileName('/tmp/other/dir'), 'dir');
});

async function ta(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.log(`not ok - ${name}`);
    console.log(String(err && err.stack ? err.stack : err));
    process.exitCode = 1;
  }
}

await ta('replay shares one message.id seen-set across files and profiles, and reads only top-level *.jsonl', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's3-replay-'));
  try {
    const a = path.join(root, '.claude-a', 'projects', 'proj');
    const b = path.join(root, '.claude-b', 'projects', 'proj');
    const missing = path.join(root, '.claude-c', 'projects', 'proj');
    fs.mkdirSync(path.join(a, 'subagents'), { recursive: true });
    fs.mkdirSync(b, { recursive: true });
    const w = (p, ls) => fs.writeFileSync(p, ls.join('\n') + '\n');
    const m1 = assistant({ mid: 'shared-1', thinking: 100, out: 1, cache: 1, effort: 'high' });
    w(path.join(a, 's1.jsonl'), [user(P1), m1, user(P2), assistant({ mid: 'only-a', thinking: 40, out: 1, cache: 1 })]);
    // Ignored: backup copy and subagent transcript, both holding unique, heavy messages.
    w(path.join(a, 's1.jsonl.bak-1'), [user(P1), assistant({ mid: 'bak', thinking: 9999, out: 1, cache: 1 })]);
    w(path.join(a, 'subagents', 'x.jsonl'), [user(P1), assistant({ mid: 'sub', thinking: 8888, out: 1, cache: 1 })]);
    // Resumed session in another profile: carries a copy of the first prompt and message.
    w(path.join(b, 's2.jsonl'), [user(P1), m1, user('PLACEHOLDER-C'), assistant({ mid: 'only-b', thinking: 7, out: 1, cache: 1 })]);

    const r = await replay([a, b, missing], 'message.id');
    assert.deepEqual(r.profiles, {
      '.claude-a': { files: 1, turns: 2, measured: 2 },
      '.claude-b': { files: 1, turns: 2, measured: 1 }, // the copied prompt has no counted reply
      '.claude-c': { files: 0, turns: 0, measured: 0 },
    });
    const total = measuredTurns(r.turns).reduce((s, x) => s + x.thinkingTokens, 0);
    assert.equal(total, 147); // 100 once + 40 + 7; the bak and subagent files are not read
    assert.equal(r.turns.length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- Round 2 (R9): a command echo that directly follows a typed prompt is that
// prompt's own expansion, not a new trigger.

const ECHO = () => user('<command-message>PLACEHOLDER</command-message><command-name>/PLACEHOLDER</command-name>', { origin: undefined });
const CAVEAT = () => user('<local-command-caveat>PLACEHOLDER</local-command-caveat>', { isMeta: true, origin: undefined });

t('a typed slash prompt followed by its command echo keeps the turn open and owns the replies', () => {
  const c = createTurnCollector('message.id');
  for (const l of [
    user('/PLACEHOLDER-SLASH arg'),
    CAVEAT(),
    ECHO(),
    assistant({ mid: 'xa', thinking: 500, out: 50, cache: 5, effort: 'high' }),
    assistant({ mid: 'xb', thinking: 20, out: 2, cache: 2 }),
  ]) c.push(l);
  assert.equal(c.turns().length, 1);
  const x = c.turns()[0];
  assert.equal(x.features.startsWithSlash, true);
  assert.equal(x.messages, 2);
  assert.equal(x.thinkingTokens, 520);
  assert.equal(x.effort, 'high');
  assert.deepEqual(c.dropped(), {}); // an absorbed echo is not a drop
});

t('a command echo after the turn already has a reply terminates it; later replies are dropped for command', () => {
  const c = createTurnCollector('message.id');
  for (const l of [
    user(P1),
    assistant({ mid: 'ya', thinking: 10, out: 1, cache: 1 }),
    ECHO(),
    assistant({ mid: 'yb', thinking: 700, out: 1, cache: 1 }),
  ]) c.push(l);
  assert.equal(c.turns()[0].thinkingTokens, 10);
  assert.equal(c.turns()[0].messages, 1);
  assert.deepEqual(c.dropped().command, { messages: 1, thinkingTokens: 700, turns: 1 });
});

t('a command echo with no open turn opens nothing and attributes nothing', () => {
  const c = createTurnCollector('message.id');
  for (const l of [
    ECHO(),
    assistant({ mid: 'za', thinking: 900, out: 1, cache: 1 }),
  ]) c.push(l);
  assert.equal(c.turns().length, 0);
});

t('an echo that follows a typed prompt does not shield a later echo: the second one terminates', () => {
  const c = createTurnCollector('message.id');
  for (const l of [
    user('/PLACEHOLDER-SLASH'),
    ECHO(), // absorbed: no reply yet
    assistant({ mid: 'qa', thinking: 5, out: 1, cache: 1 }),
    ECHO(), // terminates: the turn has a reply
    assistant({ mid: 'qb', thinking: 800, out: 1, cache: 1 }),
  ]) c.push(l);
  assert.equal(c.turns()[0].thinkingTokens, 5);
  assert.deepEqual(c.dropped().command, { messages: 1, thinkingTokens: 800, turns: 1 });
});

for (const name of ['peer', 'task-notification']) {
  t(`a ${name} record right after a prompt with no reply still terminates the turn (R9 covers command echoes only)`, () => {
    const c = createTurnCollector('message.id');
    for (const l of [
      user(P1),
      TRIGGERS[name](),
      assistant({ mid: 'ra', thinking: 900, out: 1, cache: 1 }),
    ]) c.push(l);
    assert.equal(c.turns()[0].messages, 0);
    assert.equal(c.turns()[0].thinkingTokens, 0);
    assert.deepEqual(c.dropped()[name], { messages: 1, thinkingTokens: 900, turns: 1 });
  });
}
