// usage.test.mjs — the S5 transcript reader. No model call, no spawn.
//
// The verdict on an effort-steering sentence rests on these numbers, so each rule has a test
// that fails when the rule is broken (checked by hand on a scratch copy, see the task report).
// Transcript text is built here from small builders or read from fixtures/transcripts/; every
// string in them is synthetic.

import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { tokensFromTranscript } from '../s4-rows.mjs';
import { finalTextTail, firstUserText, hookContexts, messageUsages, readRunUsage, testsRunBeforeDone, totals } from './usage.mjs';

const roots = [];
process.on('exit', () => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 's5-usage-test-'));
  roots.push(d);
  return d;
};

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcripts');

// ---- builders -------------------------------------------------------------------------------

const lines = (...recs) => recs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
const txt = (s) => ({ type: 'text', text: s });
const bash = (command) => ({ type: 'tool_use', id: 'toolu_x', name: 'Bash', input: { command } });
const THINKING = { type: 'thinking', thinking: '', signature: 'sig' };

// One assistant record. `thinking` left out means no output_tokens_details at all, as on the early
// records of a split message.
const asst = (id, o = {}) => ({
  type: 'assistant',
  ...(o.effort === undefined ? {} : { effort: o.effort }),
  message: {
    id,
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: o.content ?? [txt('ok')],
    usage: {
      input_tokens: o.input ?? 0,
      output_tokens: o.out ?? 0,
      cache_creation_input_tokens: o.cc ?? 0,
      cache_read_input_tokens: o.cr ?? 0,
      ...(o.thinking === undefined ? {} : { output_tokens_details: { thinking_tokens: o.thinking } }),
    },
  },
});
const asstRaw = (id, usage) => ({ type: 'assistant', message: { id, role: 'assistant', content: [txt('ok')], usage } });
// Claude Code's failed-call record (S4 ruling R22): synthetic model, zero usage, isApiErrorMessage.
const apiErr = (id, o = {}) => ({
  type: 'assistant',
  isApiErrorMessage: true,
  message: { id, role: 'assistant', model: '<synthetic>', content: [txt('API Error: 529 overloaded')], usage: { input_tokens: 0, output_tokens: o.out ?? 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
});
const say = (s, id = 'm-say') => asst(id, { content: [txt(s)] });
const run = (command, id = 'm-run') => asst(id, { content: [bash(command)] });
const user = (content) => ({ type: 'user', message: { role: 'user', content } });
const toolResult = () => user([{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'ok' }]);
const env = () => ({ type: 'attachment', attachment: { type: 'environment', snapshot: { cwd: '/work' } } });
const hook = (content, hookEvent = 'UserPromptSubmit') => ({
  type: 'attachment',
  attachment: { type: 'hook_additional_context', hookEvent, hookName: `${hookEvent}:steer`, toolUseID: 'toolu_hook', content },
});

const ZERO = { input_total: 0, cache_creation: 0, cache_read: 0, output: 0, thinking: 0, messages: 0, thinkingFieldMissing: 0 };

// A config dir holding projects/<slug>/<sid>.jsonl (when `main` is not null) and, per entry of
// `subs`, projects/<slug>/<sid>/subagents/<name>.
function put(cfg, slug, sid, main, subs = {}) {
  const dir = path.join(cfg, 'projects', slug);
  mkdirSync(dir, { recursive: true });
  if (main !== null) writeFileSync(path.join(dir, `${sid}.jsonl`), main);
  for (const [name, content] of Object.entries(subs)) {
    const sub = path.join(dir, sid, 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(path.join(sub, name), content);
  }
  return path.join(dir, `${sid}.jsonl`);
}

// ---- messageUsages: the final-record rule ----------------------------------------------------

t('final-record rule: one id with records (3 out, no thinking) then (313 out, 40 thinking) gives output 313 and thinking 40', () => {
  const text = lines(
    asst('m1', { out: 3, input: 10, cc: 200, cr: 5000, content: [THINKING] }),
    asst('m1', { out: 313, thinking: 40, input: 10, cc: 200, cr: 5000, content: [bash('ls')] }),
  );
  const u = messageUsages(text);
  assert.equal(u.size, 1);
  assert.equal(u.get('m1').output_tokens, 313);
  assert.equal(u.get('m1').output_tokens_details.thinking_tokens, 40);
  assert.deepEqual(totals(u), { input_total: 5210, cache_creation: 200, cache_read: 5000, output: 313, thinking: 40, messages: 1, thinkingFieldMissing: 0 });
});

t('final-record rule: (16,-),(16,-),(16,-),(728, thinking 0) gives output 728, thinking 0 and nothing missing', () => {
  const text = lines(asst('m1', { out: 16 }), asst('m1', { out: 16 }), asst('m1', { out: 16 }), asst('m1', { out: 728, thinking: 0 }));
  assert.deepEqual(totals(messageUsages(text)), { ...ZERO, output: 728, messages: 1 });
});

t('final-record rule: (3,-),(4916, thinking 2756) gives output 4916 and thinking 2756', () => {
  const text = lines(asst('m1', { out: 3 }), asst('m1', { out: 4916, thinking: 2756 }));
  assert.deepEqual(totals(messageUsages(text)), { ...ZERO, output: 4916, thinking: 2756, messages: 1 });
});

t('final-record rule: the largest output wins wherever it sits; a later, smaller record does not displace it', () => {
  const text = lines(asst('m1', { out: 5, thinking: 1 }), asst('m1', { out: 300, thinking: 7 }), asst('m1', { out: 100, thinking: 3 }));
  const t1 = totals(messageUsages(text));
  assert.equal(t1.output, 300);
  assert.equal(t1.thinking, 7);
  // and a first record that is already the largest stays chosen
  const t2 = totals(messageUsages(lines(asst('m1', { out: 300, thinking: 7 }), asst('m1', { out: 5, thinking: 1 }))));
  assert.equal(t2.output, 300);
  assert.equal(t2.thinking, 7);
});

t('a tie on output_tokens keeps the last record', () => {
  const three = lines(asst('m1', { out: 100, thinking: 10 }), asst('m1', { out: 100, thinking: 20 }), asst('m1', { out: 100, thinking: 30 }));
  assert.equal(totals(messageUsages(three)).thinking, 30);
  // a tie at the maximum, with a smaller record after it
  const tail = lines(asst('m1', { out: 300, thinking: 1 }), asst('m1', { out: 300, thinking: 2 }), asst('m1', { out: 5, thinking: 3 }));
  assert.equal(totals(messageUsages(tail)).thinking, 2);
});

t('thinking comes from the chosen record only: a field on a smaller record is not borrowed', () => {
  const text = lines(asst('m1', { out: 3, thinking: 99 }), asst('m1', { out: 313 }));
  assert.deepEqual(totals(messageUsages(text)), { ...ZERO, output: 313, thinking: 0, messages: 1, thinkingFieldMissing: 1 });
});

t('distinct ids are distinct messages, each with its own final record', () => {
  const text = lines(
    asst('a', { out: 3 }),
    asst('b', { out: 10, thinking: 2, input: 1, cc: 2, cr: 3 }),
    asst('a', { out: 50, thinking: 4, input: 4, cc: 5, cr: 6 }),
    asst('b', { out: 10, thinking: 8, input: 1, cc: 2, cr: 3 }),
  );
  const u = messageUsages(text);
  assert.deepEqual([...u.keys()].sort(), ['a', 'b']);
  assert.deepEqual(totals(u), { input_total: 15 + 6, cache_creation: 7, cache_read: 9, output: 60, thinking: 12, messages: 2, thinkingFieldMissing: 0 });
});

// ---- messageUsages: which records count --------------------------------------------------------

t('API-error records are not counted', () => {
  const text = lines(
    asst('m1', { out: 10, thinking: 1 }),
    apiErr('err1', { out: 5000 }),
    // synthetic model without the flag (a real Claude Code shape)
    { type: 'assistant', message: { id: 'err2', role: 'assistant', model: '<synthetic>', content: [txt('x')], usage: { input_tokens: 0, output_tokens: 7000 } } },
    // an error record that shares a real message's id and would win on output_tokens
    apiErr('m1', { out: 9999 }),
  );
  const u = messageUsages(text);
  assert.deepEqual([...u.keys()], ['m1']);
  assert.deepEqual(totals(u), { ...ZERO, output: 10, thinking: 1, messages: 1 });
});

t('messageUsages applies the S4 record filter: no id, a user role, no usage, array usage and torn lines are not counted', () => {
  const text = [
    JSON.stringify(asst('a', { out: 11, thinking: 5, input: 1, cc: 20, cr: 300 })),
    JSON.stringify(asst('b', { out: 22, thinking: 6, input: 2, cc: 30, cr: 400 })),
    JSON.stringify(asst('c', { out: 33, thinking: 7, input: 3, cc: 40, cr: 500 })),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 9000, output_tokens: 9000 } } }), // no id
    JSON.stringify({ type: 'assistant', message: { id: '', role: 'assistant', usage: { input_tokens: 9000, output_tokens: 9000 } } }), // empty id
    JSON.stringify({ type: 'user', message: { id: 'u1', role: 'user', usage: { input_tokens: 9000, output_tokens: 9000 } } }), // not assistant
    JSON.stringify({ type: 'assistant', message: { id: 'nu', role: 'assistant' } }), // no usage
    JSON.stringify({ type: 'assistant', message: { id: 'au', role: 'assistant', usage: [1, 2] } }), // array usage
    '',
    'torn line {"type":"assistant"',
  ].join('\n');
  const tot = totals(messageUsages(text));
  assert.deepEqual(tot, { input_total: 321 + 432 + 543, cache_creation: 90, cache_read: 1200, output: 66, thinking: 18, messages: 3, thinkingFieldMissing: 0 });
  // one record per id: S4's first-record rule and the final-record rule agree, so S4's sums are the oracle
  const s4 = tokensFromTranscript(text);
  assert.equal(tot.input_total, s4.input_total);
  assert.equal(tot.cache_creation, s4.cache_creation);
  assert.equal(tot.thinking, s4.thinking_tokens);
});

t('empty and unparseable text give an empty map', () => {
  assert.equal(messageUsages('').size, 0);
  assert.equal(messageUsages('not json\n{"half":').size, 0);
});

// ---- totals --------------------------------------------------------------------------------------

t('totals sums input_total as input + cache_creation + cache_read and keeps each part, over a Map or an array', () => {
  const u1 = { input_tokens: 1, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 4000, output_tokens_details: { thinking_tokens: 50 } };
  const u2 = { input_tokens: 6, cache_creation_input_tokens: 70, cache_read_input_tokens: 800, output_tokens: 9000, output_tokens_details: { thinking_tokens: 1000 } };
  const want = { input_total: 1197, cache_creation: 90, cache_read: 1100, output: 13000, thinking: 1050, messages: 2, thinkingFieldMissing: 0 };
  assert.deepEqual(totals(new Map([['a', u1], ['b', u2]])), want);
  assert.deepEqual(totals([u1, u2]), want);
});

t('totals of nothing is all zeros, and missing or non-numeric fields count as 0, never NaN', () => {
  assert.deepEqual(totals(new Map()), ZERO);
  const res = totals(new Map([['a', {}], ['b', { input_tokens: 'x', output_tokens: null, cache_read_input_tokens: -4 }]]));
  assert.deepEqual(res, { ...ZERO, messages: 2, thinkingFieldMissing: 2 });
  assert.ok(Object.values(res).every(Number.isFinite));
});

t('thinkingFieldMissing counts chosen records whose thinking_tokens is absent or not a non-negative number; a reported 0 is a measurement', () => {
  const text = lines(
    asstRaw('absent', { output_tokens: 1 }),
    asstRaw('empty-details', { output_tokens: 1, output_tokens_details: {} }),
    asstRaw('null', { output_tokens: 1, output_tokens_details: { thinking_tokens: null } }),
    asstRaw('negative', { output_tokens: 1, output_tokens_details: { thinking_tokens: -5 } }),
    asstRaw('string', { output_tokens: 1, output_tokens_details: { thinking_tokens: '12' } }),
    asstRaw('zero', { output_tokens: 1, output_tokens_details: { thinking_tokens: 0 } }),
    asstRaw('seven', { output_tokens: 1, output_tokens_details: { thinking_tokens: 7 } }),
  );
  assert.deepEqual(totals(messageUsages(text)), { ...ZERO, output: 7, thinking: 7, messages: 7, thinkingFieldMissing: 5 });
});

// ---- readRunUsage ----------------------------------------------------------------------------------

t('subagent transcripts add to subagents and total, never to main', () => {
  const cfg = tmp();
  const mainPath = put(
    cfg,
    '-any-slug',
    'sid-1',
    lines(asst('m1', { out: 1000, thinking: 5, input: 1, cc: 10, cr: 100 })),
    {
      'agent-a1.jsonl': lines(asst('s1', { out: 2000, thinking: 6, input: 2, cc: 20, cr: 200 })),
      'agent-b2.jsonl': lines(asst('s2', { out: 3 }), asst('s2', { out: 3000, thinking: 7, input: 3, cc: 30, cr: 300 })),
    },
  );
  const r = readRunUsage(cfg, 'sid-1');
  assert.equal(r.reason, null);
  assert.equal(r.transcriptPath, mainPath);
  assert.deepEqual(r.main, { input_total: 111, cache_creation: 10, cache_read: 100, output: 1000, thinking: 5, messages: 1, thinkingFieldMissing: 0 });
  assert.deepEqual(r.subagents, { input_total: 555, cache_creation: 50, cache_read: 500, output: 5000, thinking: 13, messages: 2, thinkingFieldMissing: 0 });
  assert.deepEqual(r.total, { input_total: 666, cache_creation: 60, cache_read: 600, output: 6000, thinking: 18, messages: 3, thinkingFieldMissing: 0 });
  assert.deepEqual(r.subagentFiles, [path.join(path.dirname(mainPath), 'sid-1', 'subagents', 'agent-a1.jsonl'), path.join(path.dirname(mainPath), 'sid-1', 'subagents', 'agent-b2.jsonl')]);
});

t('total adds thinkingFieldMissing and messages from both sides, field by field', () => {
  const cfg = tmp();
  put(cfg, 's', 'sid-1', lines(asst('m1', { out: 1 }), asst('m2', { out: 1, thinking: 1 })), { 'agent-a.jsonl': lines(asst('s1', { out: 1 }), asst('s2', { out: 1 }), asst('s3', { out: 1, thinking: 2 })) });
  const r = readRunUsage(cfg, 'sid-1');
  assert.equal(r.main.thinkingFieldMissing, 1);
  assert.equal(r.subagents.thinkingFieldMissing, 2);
  assert.equal(r.total.thinkingFieldMissing, 3);
  assert.equal(r.total.messages, 5);
  assert.equal(r.total.thinking, 3);
});

t('no transcript gives reason no_transcript; two give ambiguous_transcript', () => {
  const cfg = tmp();
  const none = readRunUsage(cfg, 'nope');
  assert.equal(none.reason, 'no_transcript');
  assert.deepEqual([none.main, none.subagents, none.total], [ZERO, ZERO, ZERO]);
  assert.deepEqual([none.subagentFiles, none.efforts, none.subagentEfforts], [[], [], []]);
  assert.equal(none.apiError, false);
  assert.equal(none.subagentApiErrors, 0);
  assert.equal(none.transcriptPath, null);

  // two transcripts for one session id, each holding usage: neither is read
  put(cfg, 'slug-a', 'sid-2', lines(asst('m1', { out: 100, thinking: 1, effort: 'xhigh' })), { 'agent-a.jsonl': lines(asst('s1', { out: 200 })) });
  put(cfg, 'slug-b', 'sid-2', lines(asst('m2', { out: 300, thinking: 2, effort: 'xhigh' })));
  const two = readRunUsage(cfg, 'sid-2');
  assert.equal(two.reason, 'ambiguous_transcript');
  assert.deepEqual([two.main, two.subagents, two.total], [ZERO, ZERO, ZERO]);
  assert.deepEqual([two.subagentFiles, two.efforts, two.subagentEfforts], [[], [], []]);
  assert.equal(two.transcriptPath, null);

  // a missing config dir is no transcript, not an exception
  assert.equal(readRunUsage(path.join(cfg, 'does-not-exist'), 'sid-2').reason, 'no_transcript');
});

t('a session with no subagents directory has zero subagent files and total equals main', () => {
  const cfg = tmp();
  put(cfg, 's', 'sid-1', lines(asst('m1', { out: 40, thinking: 3, input: 1, cc: 2, cr: 3 })));
  const r = readRunUsage(cfg, 'sid-1');
  assert.equal(r.reason, null);
  assert.deepEqual(r.subagents, ZERO);
  assert.deepEqual(r.subagentFiles, []);
  assert.deepEqual(r.subagentEfforts, []);
  assert.equal(r.subagentApiErrors, 0);
  assert.deepEqual(r.total, r.main);
  assert.equal(r.main.output, 40);
});

t("only agent-*.jsonl in this session's own subagents directory are read", () => {
  const cfg = tmp();
  const rec = (id, out) => lines(asst(id, { out }));
  const mainPath = put(cfg, 'slug-a', 'sid-1', rec('m1', 1), {
    'agent-a1.jsonl': rec('s1', 100),
    'agent-a1.meta.json': rec('meta', 7000), // the meta file of a subagent, even if it held usage-shaped lines
    'other.jsonl': rec('other', 9000), // not an agent transcript
    'agent-a1.jsonl.bak': rec('bak', 11000),
  });
  put(cfg, 'slug-a', 'other-sid', null, { 'agent-q.jsonl': rec('q', 13000) }); // another session's subagents
  put(cfg, 'slug-b', 'sid-1', null, { 'agent-r.jsonl': rec('r', 15000) }); // same id under a slug that holds no main transcript
  const r = readRunUsage(cfg, 'sid-1');
  assert.equal(r.subagents.output, 100);
  assert.equal(r.subagents.messages, 1);
  assert.deepEqual(r.subagentFiles, [path.join(path.dirname(mainPath), 'sid-1', 'subagents', 'agent-a1.jsonl')]);
  assert.equal(r.total.output, 101);
});

t('efforts come from the main transcript only; subagentEfforts are the union over subagent files', () => {
  const cfg = tmp();
  put(cfg, 's', 'sid-1', lines(asst('m1', { out: 1, effort: 'xhigh' }), asst('m2', { out: 1, effort: 'xhigh' })), {
    'agent-a.jsonl': lines(asst('s1', { out: 1, effort: 'low' })),
    'agent-b.jsonl': lines(asst('s2', { out: 1, effort: 'low' }), asst('s3', { out: 1, effort: 'medium' })),
  });
  const r = readRunUsage(cfg, 'sid-1');
  assert.deepEqual(r.efforts, ['xhigh']);
  assert.deepEqual(r.subagentEfforts, ['low', 'medium']);
});

t('subagentFiles are sorted by name, and subagentEfforts follow that order, whatever order the files were written in', () => {
  const cfg = tmp();
  const mainPath = put(cfg, 's', 'sid-1', lines(asst('m1', { out: 1 })), {
    'agent-c.jsonl': lines(asst('s3', { out: 1, effort: 'high' })),
    'agent-a.jsonl': lines(asst('s1', { out: 1, effort: 'low' })),
    'agent-b.jsonl': lines(asst('s2', { out: 1, effort: 'medium' })),
  });
  const r = readRunUsage(cfg, 'sid-1');
  const dir = path.join(path.dirname(mainPath), 'sid-1', 'subagents');
  assert.deepEqual(r.subagentFiles, ['agent-a.jsonl', 'agent-b.jsonl', 'agent-c.jsonl'].map((n) => path.join(dir, n)));
  assert.deepEqual(r.subagentEfforts, ['low', 'medium', 'high']);
});

t('efforts keep a null for a main record that records none, so a guard sees it', () => {
  const cfg = tmp();
  put(cfg, 's', 'sid-1', lines(asst('m1', { out: 1, effort: 'xhigh' }), asst('m2', { out: 1 })));
  assert.deepEqual(readRunUsage(cfg, 'sid-1').efforts, ['xhigh', null]);
});

t("apiError is the main transcript's; subagentApiErrors counts subagent files that hold one", () => {
  const cfg = tmp();
  put(cfg, 's', 'sid-1', lines(asst('m1', { out: 1 })), {
    'agent-a.jsonl': lines(asst('s1', { out: 1 }), apiErr('e1'), apiErr('e2')), // two error records, one file
    'agent-b.jsonl': lines(asst('s2', { out: 1 }), apiErr('e3')),
    'agent-c.jsonl': lines(asst('s3', { out: 1 })),
  });
  const r = readRunUsage(cfg, 'sid-1');
  assert.equal(r.apiError, false);
  assert.equal(r.subagentApiErrors, 2);
  // the error records add no usage anywhere
  assert.equal(r.subagents.messages, 3);

  const cfg2 = tmp();
  put(cfg2, 's', 'sid-1', lines(asst('m1', { out: 1 }), apiErr('e1')), { 'agent-a.jsonl': lines(asst('s1', { out: 1 })) });
  const r2 = readRunUsage(cfg2, 'sid-1');
  assert.equal(r2.apiError, true);
  assert.equal(r2.subagentApiErrors, 0);
});

// A subagents directory that cannot be read is an error. Reading it as "no subagents" would drop
// their usage without a trace. (root reads any directory, so there the test cannot run.)
if (process.getuid?.() === 0) {
  console.log('skip - an unreadable subagents directory is an error (running as root)');
} else {
  t('an unreadable subagents directory is an error, not zero subagents', () => {
    const cfg = tmp();
    const mainPath = put(cfg, 's', 'sid-1', lines(asst('m1', { out: 1 })), { 'agent-a.jsonl': lines(asst('s1', { out: 1 })) });
    const subDir = path.join(path.dirname(mainPath), 'sid-1', 'subagents');
    chmodSync(subDir, 0o000);
    try {
      assert.throws(() => readRunUsage(cfg, 'sid-1'), /EACCES/);
    } finally {
      chmodSync(subDir, 0o755);
    }
  });
}

t('a message id that appears in several files is counted once: a fork copies its parent history, which is already counted', () => {
  const cfg = tmp();
  const parent = asst('m1', { out: 100, thinking: 10, input: 1, cc: 2, cr: 3 });
  const s1 = asst('s1', { out: 50, thinking: 5 });
  put(cfg, 's', 'sid-1', lines(parent), {
    'agent-a.jsonl': lines(parent, s1), // a fork: the parent's message, then its own
    'agent-b.jsonl': lines(parent, s1, asst('s2', { out: 20, thinking: 2 })), // a second fork of the same parent
  });
  const r = readRunUsage(cfg, 'sid-1');
  assert.equal(r.main.messages, 1);
  assert.equal(r.main.output, 100);
  assert.equal(r.subagents.messages, 2);
  assert.equal(r.subagents.output, 70);
  assert.equal(r.subagents.thinking, 7);
  assert.equal(r.total.messages, 3);
  assert.equal(r.total.output, 170);
  assert.equal(r.total.thinking, 17);
});

t('the real shape end to end: a split message in main and in a subagent, from fixture transcripts', () => {
  const cfg = tmp();
  const slugDir = path.join(cfg, 'projects', '-fixture-slug');
  mkdirSync(path.join(slugDir, 'fixture-session', 'subagents'), { recursive: true });
  copyFileSync(path.join(FIXTURES, 'session-main.jsonl'), path.join(slugDir, 'fixture-session.jsonl'));
  copyFileSync(path.join(FIXTURES, 'subagent-a1.jsonl'), path.join(slugDir, 'fixture-session', 'subagents', 'agent-a1.jsonl'));
  const r = readRunUsage(cfg, 'fixture-session');
  assert.equal(r.reason, null);
  assert.deepEqual(r.main, { input_total: 5210 + 5212, cache_creation: 200, cache_read: 10200, output: 363, thinking: 40, messages: 2, thinkingFieldMissing: 0 });
  assert.deepEqual(r.subagents, { input_total: 1007, cache_creation: 100, cache_read: 900, output: 4916, thinking: 2756, messages: 1, thinkingFieldMissing: 0 });
  assert.deepEqual(r.total, { input_total: 11429, cache_creation: 300, cache_read: 11100, output: 5279, thinking: 2796, messages: 3, thinkingFieldMissing: 0 });
  assert.deepEqual(r.efforts, ['xhigh']);
  assert.deepEqual(r.subagentEfforts, ['xhigh']);
  assert.equal(r.apiError, false);
  assert.equal(r.subagentApiErrors, 0);

  const main = readFileSync(path.join(FIXTURES, 'session-main.jsonl'), 'utf8');
  assert.equal(firstUserText(main), 'Fix the parser so that empty input returns an empty list.\nKeep the change small.\n');
  assert.deepEqual(hookContexts(main), ['Synthetic steering line one.\nSynthetic steering line two.']);
  assert.equal(testsRunBeforeDone(main, ['cargo test']), true);
  assert.equal(finalTextTail(main), 'Done. The parser now returns an empty list for empty input.');
});

// ---- firstUserText -----------------------------------------------------------------------------------

t('firstUserText returns the prompt exactly, newlines included', () => {
  const prompt = '  Fix the parser.\n\nKeep the change small.\n  Second paragraph, trailing space \n';
  assert.equal(firstUserText(lines(user(prompt), user('a later prompt'))), prompt);
});

t('firstUserText skips every record that is not the prompt', () => {
  const text = lines(
    { type: 'queue-operation', operation: 'enqueue', content: 'queued' },
    env(),
    hook(['hook text']),
    say('assistant words'),
    toolResult(),
    user([txt('text beside a result'), { type: 'tool_result', tool_use_id: 't', content: 'r' }]),
    user([{ type: 'image', source: {} }]),
    { type: 'user' }, // no message
    { type: 'user', message: { role: 'user' } }, // no content
    user(42), // content of no known shape
    user('the prompt'),
    user('a second prompt'),
  );
  assert.equal(firstUserText(text), 'the prompt');
});

t('firstUserText joins the text blocks of an array prompt with nothing between them', () => {
  assert.equal(firstUserText(lines(user([txt('line one\n'), { type: 'image', source: {} }, txt('line two')]))), 'line one\nline two');
  // a text block without a string text is not a text block
  assert.equal(firstUserText(lines(user([{ type: 'text' }, { type: 'text', text: 7 }, txt('kept')]))), 'kept');
  assert.equal(firstUserText(lines(user([{ type: 'text' }]), user('next'))), 'next');
});

t('firstUserText is null when there is no prompt', () => {
  assert.equal(firstUserText(''), null);
  assert.equal(firstUserText(lines(say('hi'), toolResult(), env())), null);
  assert.equal(firstUserText('torn {'), null);
});

// ---- testsRunBeforeDone ------------------------------------------------------------------------------

t("testsRunBeforeDone: true when 'cargo test' runs before the final text; false when it runs only after it or never", () => {
  assert.equal(testsRunBeforeDone(lines(run('cargo test'), toolResult(), say('done')), ['cargo test']), true);
  assert.equal(testsRunBeforeDone(lines(say('done'), run('cargo test')), ['cargo test']), false);
  assert.equal(testsRunBeforeDone(lines(run('ls'), toolResult(), say('done')), ['cargo test']), false);
  assert.equal(testsRunBeforeDone(lines(say('done')), ['cargo test']), false);
});

t('testsRunBeforeDone measures against the LAST assistant text, not the first', () => {
  // an interim text, then the tests, then the final text: the tests came before done
  assert.equal(testsRunBeforeDone(lines(say('plan', 'a'), run('cargo test', 'b'), toolResult(), say('done', 'c')), ['cargo test']), true);
  // the tests ran before an interim text and before the final one
  assert.equal(testsRunBeforeDone(lines(run('cargo test', 'a'), say('interim', 'b'), run('ls', 'c'), say('done', 'd')), ['cargo test']), true);
  // the tests ran after the last text, with an earlier text in the transcript
  assert.equal(testsRunBeforeDone(lines(say('plan', 'a'), say('done', 'b'), run('cargo test', 'c')), ['cargo test']), false);
  // the tests ran before the last text and again after it: they ran before done
  assert.equal(testsRunBeforeDone(lines(run('cargo test', 'a'), say('done', 'b'), run('cargo test', 'c')), ['cargo test']), true);
  // the last text and the tests in one record, the text first: the tests follow it
  assert.equal(testsRunBeforeDone(lines(asst('m1', { content: [txt('final'), bash('cargo test')] })), ['cargo test']), false);
});

t('testsRunBeforeDone: a transcript with no assistant text says whether any matching Bash ran', () => {
  assert.equal(testsRunBeforeDone(lines(run('cargo test')), ['cargo test']), true);
  assert.equal(testsRunBeforeDone(lines(run('ls')), ['cargo test']), false);
  assert.equal(testsRunBeforeDone('', ['cargo test']), false);
  // a text block without a string text is no text: the run is not "after the last text"
  assert.equal(testsRunBeforeDone(lines(asst('m-n', { content: [{ type: 'text' }, { type: 'text', text: 7 }] }), run('cargo test')), ['cargo test']), true);
});

t('testsRunBeforeDone counts only a Bash tool_use whose input.command holds a pattern', () => {
  const other = (name, input) => asst('m-o', { content: [{ type: 'tool_use', id: 't', name, input }] });
  const done = say('done', 'm-done');
  assert.equal(testsRunBeforeDone(lines(other('Read', { command: 'cargo test' }), done), ['cargo test']), false); // not Bash
  assert.equal(testsRunBeforeDone(lines(other('Bash', { description: 'cargo test' }), done), ['cargo test']), false); // not the command
  assert.equal(testsRunBeforeDone(lines(other('Bash', { command: 42 }), done), ['cargo test']), false);
  assert.equal(testsRunBeforeDone(lines(other('Bash', undefined), done), ['cargo test']), false);
  assert.equal(testsRunBeforeDone(lines(say('I will run cargo test now', 'm-t'), done), ['cargo test']), false); // text, not a tool call
  assert.equal(testsRunBeforeDone(lines(toolResult(), done), ['cargo test']), false);
});

t('testsRunBeforeDone: any pattern matches, as a plain substring and case-sensitively', () => {
  const doneAfter = (command, patterns) => testsRunBeforeDone(lines(run(command), say('done')), patterns);
  assert.equal(doneAfter('cd /work && cargo test -p parser --lib', ['pytest', 'cargo test']), true);
  assert.equal(doneAfter('pytest -q', ['pytest', 'cargo test']), true);
  assert.equal(doneAfter('cargo build', ['pytest', 'cargo test']), false);
  assert.equal(doneAfter('cargo test', ['Cargo Test']), false); // case-sensitive
  assert.equal(doneAfter('cargo  test', ['cargo.test']), false); // not a regex
  assert.equal(doneAfter('cargo test', ['cargo.test']), false);
  assert.equal(doneAfter('make a+b', ['a+b']), true); // a regex would read a+b as one or more a, then b
  assert.equal(doneAfter('make aab', ['a+b']), false);
});

t('testsRunBeforeDone: no patterns, or an empty pattern, matches nothing', () => {
  const text = lines(run('cargo test'), say('done'));
  assert.equal(testsRunBeforeDone(text, []), false);
  assert.equal(testsRunBeforeDone(text, ['']), false);
  assert.equal(testsRunBeforeDone(text, ['', 'cargo test']), true);
});

t('testsRunBeforeDone: the text of an API-error record is not the final text', () => {
  // the tests ran after the model's last real text; the error record after them is not "done"
  assert.equal(testsRunBeforeDone(lines(say('done', 'a'), run('cargo test', 'b'), apiErr('e1')), ['cargo test']), false);
});

// ---- finalTextTail -----------------------------------------------------------------------------------

t('finalTextTail is the last 300 characters of the last assistant text block', () => {
  const text = lines(say('z'.repeat(400), 'a'), run('ls', 'b'), say('a'.repeat(50) + 'b'.repeat(300), 'c'), user('a user message after the last assistant text'), toolResult());
  assert.equal(finalTextTail(text), 'b'.repeat(300));
});

t('finalTextTail honours n, returns a short text whole, and takes the last text block of a record', () => {
  assert.equal(finalTextTail(lines(say('abcdefghij')), 4), 'ghij');
  assert.equal(finalTextTail(lines(say('abc')), 300), 'abc');
  assert.equal(finalTextTail(lines(say('abc')), 3), 'abc');
  assert.equal(finalTextTail(lines(say('abc')), 0), '');
  assert.equal(finalTextTail(lines(asst('m1', { content: [txt('first block'), bash('ls'), txt('last block')] }))), 'last block');
});

t('finalTextTail is empty when no assistant text exists, and never reads the text of an API-error record', () => {
  assert.equal(finalTextTail(''), '');
  assert.equal(finalTextTail(lines(user('only a prompt'), run('ls'))), '');
  assert.equal(finalTextTail(lines(say('the real end'), apiErr('e1'))), 'the real end');
  // a text block without a string text is not text
  assert.equal(finalTextTail(lines(say('the real end'), asst('m9', { content: [{ type: 'text' }, { type: 'text', text: 7 }] }))), 'the real end');
});

// ---- hookContexts ------------------------------------------------------------------------------------

t('hookContexts: a UserPromptSubmit hook attachment plus an environment attachment gives exactly one string; without it, none', () => {
  assert.deepEqual(hookContexts(lines(user('p'), env(), hook('steer text'), say('x'))), ['steer text']);
  assert.deepEqual(hookContexts(lines(user('p'), env(), say('x'))), []);
  assert.deepEqual(hookContexts(''), []);
});

t('hookContexts: an array content is joined with a newline; other hook events and other attachment types are left out; order is kept', () => {
  const text = lines(
    hook(['line one', 'line two'], 'UserPromptSubmit'),
    hook('from session start', 'SessionStart'),
    { type: 'attachment', attachment: { type: 'skill_listing', hookEvent: 'UserPromptSubmit', content: 'not a hook context' } },
    { type: 'user', attachment: { type: 'hook_additional_context', hookEvent: 'UserPromptSubmit', content: 'not an attachment record' } },
    hook('second prompt hook'),
  );
  assert.deepEqual(hookContexts(text), ['line one\nline two', 'second prompt hook']);
  // an array element that is not a string is not text
  assert.deepEqual(hookContexts(lines(hook(['a', 5, null, { x: 1 }, 'b']))), ['a\nb']);
  // content of no known shape has nothing to give
  assert.deepEqual(hookContexts(lines(hook(undefined), hook({ not: 'text' }))), []);
});

// ---- torn input ------------------------------------------------------------------------------------

t('every reader ignores torn lines and empty text', () => {
  const torn = 'garbage\n{"type":"assistant","message":\n';
  assert.equal(messageUsages(torn).size, 0);
  assert.equal(firstUserText(torn), null);
  assert.equal(testsRunBeforeDone(torn, ['x']), false);
  assert.equal(finalTextTail(torn), '');
  assert.deepEqual(hookContexts(torn), []);
});
