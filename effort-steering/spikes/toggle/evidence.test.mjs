// evidence.test.mjs — the effort-toggle run evidence (evidence.mjs), on transcripts and mod logs built in memory.
//
//   TMPDIR=/home/marius/.cache/sdd-effort-toggle-tmp node --test effort-steering/spikes/toggle/evidence.test.mjs
//
// The transcript builder writes the records the way Claude Code does: one API message split over several assistant records that
// share a `message.id` (a thinking block, then text or tool_use), a top-level `effort` on each, user records that carry either a
// string, text blocks or `tool_result` blocks. The log builder writes the lines the mod writes (spikes/toggle/mod/hooks/register.ts):
// `step`, `call`, `invalid`, `error`. Pure functions over strings: no I/O, never calls a model.

import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { checkRun, firstEditIndex, mainRequests, secondUserTurn } from './evidence.mjs';
import { randomLevels, register } from './mod/hooks/register.ts';

const jsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

// One assistant record. `blocks` are content blocks; `out` is usage.output_tokens.
const rec = (id, effort, blocks, out = 10, extra = {}) => ({
  type: 'assistant',
  ...(effort === undefined ? {} : { effort }),
  isSidechain: false,
  message: { id, role: 'assistant', model: 'claude-sonnet-5-5', content: blocks, usage: { output_tokens: out } },
  ...extra,
});
let useCounter = 0;
const use = (name, input, id = `tu_${(useCounter += 1)}`) => ({ type: 'tool_use', id, name, input });
const bashUse = (command) => use('Bash', { command });
const text = (s) => ({ type: 'text', text: s });
const thinking = () => ({ type: 'thinking', thinking: '' });
const userText = (s) => ({ type: 'user', message: { role: 'user', content: s } });
const userBlocks = (blocks) => ({ type: 'user', message: { role: 'user', content: blocks } });
const toolResult = () => userBlocks([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }]);

// A transcript of one single-record message per entry of `efforts`, each with one Bash call.
const simple = (efforts, command = 'ls') => jsonl(efforts.map((e, i) => rec(`msg_${i}`, e, [bashUse(command)])));

// The mod's log lines.
const step = (request, before, after, extra = {}) => ({ type: 'step', request, agentId: null, turnId: 't1', before, after, ...extra });
const subStep = (before, after) => ({ type: 'step', request: null, agentId: 'a1', turnId: 't1', before, after });
const call = (request, level) => ({ type: 'call', request, level, reason: 'r' });
const logOf = (lines) => jsonl(lines);
// A log that agrees with `efforts`: one step per request whose before and after are that effort.
const agreeing = (efforts) => efforts.map((e, i) => step(i, e, e));

// ---- mainRequests -----------------------------------------------------------------------------------------------------

t('mainRequests: a message split over three records counts once and keeps all its tool uses', () => {
  const text3 = jsonl([
    rec('msg_a', 'low', [thinking()], 3),
    rec('msg_a', 'low', [bashUse('ls')], 40),
    rec('msg_a', 'low', [use('Read', { file_path: '/work/x' })], 41),
    toolResult(),
    rec('msg_b', 'xhigh', [text('done')], 7),
  ]);
  const reqs = mainRequests(text3);
  assert.equal(reqs.length, 2);
  assert.deepEqual(
    reqs.map((r) => [r.index, r.messageId, r.effort]),
    [
      [0, 'msg_a', 'low'],
      [1, 'msg_b', 'xhigh'],
    ],
  );
  assert.deepEqual(reqs[0].toolUses, [
    { name: 'Bash', input: { command: 'ls' } },
    { name: 'Read', input: { file_path: '/work/x' } },
  ]);
  assert.deepEqual(reqs[1].toolUses, []);
});

t('mainRequests: first-appearance order holds when records of two ids interleave', () => {
  const reqs = mainRequests(jsonl([rec('m1', 'low', [thinking()]), rec('m2', 'low', [bashUse('a')]), rec('m1', 'low', [bashUse('b')])]));
  assert.deepEqual(
    reqs.map((r) => [r.messageId, r.toolUses.map((u) => u.input.command)]),
    [
      ['m1', ['b']],
      ['m2', ['a']],
    ],
  );
});

t('mainRequests: the effort is read from the record with the largest output_tokens, the later one on a tie', () => {
  const reqs = mainRequests(
    jsonl([rec('m1', 'low', [thinking()], 3), rec('m1', 'xhigh', [text('x')], 300), rec('m1', 'low', [text('y')], 300), rec('m2', 'low', [text('z')], 5)]),
  );
  assert.deepEqual(reqs.map((r) => r.effort), ['low', 'low']);
  const reqs2 = mainRequests(jsonl([rec('m1', 'low', [thinking()], 3), rec('m1', 'xhigh', [text('x')], 300), rec('m1', 'low', [text('y')], 299)]));
  assert.equal(reqs2[0].effort, 'xhigh');
});

t('mainRequests: a non-string or absent effort is null; a repeated tool_use id is gathered once', () => {
  const reqs = mainRequests(
    jsonl([
      rec('m1', 3, [bashUse('a')]),
      rec('m2', undefined, [use('Bash', { command: 'b' }, 'tu_dup')]),
      rec('m2', undefined, [use('Bash', { command: 'b' }, 'tu_dup')]),
    ]),
  );
  assert.deepEqual(reqs.map((r) => r.effort), [null, null]);
  assert.equal(reqs[1].toolUses.length, 1);
});

t('mainRequests: API-error records, user records, records with no message or no id, and torn lines are not requests', () => {
  const lines = [
    JSON.stringify(rec('m1', 'low', [bashUse('a')])),
    JSON.stringify({ type: 'assistant', isApiErrorMessage: true, effort: 'low', message: { id: 'err1', role: 'assistant', model: '<synthetic>', content: [text('boom')], usage: { output_tokens: 0 } } }),
    JSON.stringify(toolResult()),
    JSON.stringify({ type: 'assistant', effort: 'low' }),
    JSON.stringify({ type: 'assistant', effort: 'low', message: { role: 'assistant', content: [text('no id')] } }),
    JSON.stringify({ type: 'assistant', effort: 'low', message: null }),
    'null',
    '[1,2]',
    '{"type":"assistant","message":{"id":"torn',
    '',
    JSON.stringify(rec('m2', 'xhigh', [text('b')])),
  ];
  assert.deepEqual(mainRequests(lines.join('\n')).map((r) => r.messageId), ['m1', 'm2']);
});

t('mainRequests: a sidechain record is a subagent step, not a main request', () => {
  const reqs = mainRequests(jsonl([rec('m1', 'low', [bashUse('a')]), rec('s1', 'low', [bashUse('b')], 10, { isSidechain: true }), rec('m2', 'low', [bashUse('c')])]));
  assert.deepEqual(reqs.map((r) => r.messageId), ['m1', 'm2']);
});

t('mainRequests: a tool_use block with no input has an empty input; non-tool blocks and bad content are ignored', () => {
  const reqs = mainRequests(
    jsonl([
      rec('m1', 'low', [{ type: 'tool_use', id: 'a', name: 'Glob' }, null, 'str', text('t')]),
      rec('m2', 'low', 'plain string content'),
      rec('m3', 'low', null),
    ]),
  );
  assert.deepEqual(reqs[0].toolUses, [{ name: 'Glob', input: {} }]);
  assert.deepEqual(reqs[1].toolUses, []);
  assert.deepEqual(reqs[2].toolUses, []);
});

// ---- secondUserTurn ---------------------------------------------------------------------------------------------------

t('secondUserTurn: a task-notification user text after the first assistant record is a second turn', () => {
  assert.equal(secondUserTurn(jsonl([userText('fix it'), rec('m1', 'low', [bashUse('a')]), toolResult(), userText('<task-notification>done</task-notification>'), rec('m2', 'low', [text('ok')])])), true);
  assert.equal(secondUserTurn(jsonl([userText('fix it'), rec('m1', 'low', [bashUse('a')]), userBlocks([text('and also this')])])), true);
  assert.equal(secondUserTurn(jsonl([userText('fix it'), rec('m1', 'low', [bashUse('a')]), userBlocks([{ type: 'tool_result', tool_use_id: 'x', content: 'r' }, text('and text')])])), true);
});

t('secondUserTurn: tool_result-only user records, the first prompt and empty texts are not a second turn', () => {
  assert.equal(secondUserTurn(jsonl([userText('fix it'), rec('m1', 'low', [bashUse('a')]), toolResult(), rec('m2', 'low', [text('ok')]), toolResult()])), false);
  assert.equal(secondUserTurn(jsonl([userText('first'), userText('still before any assistant record'), rec('m1', 'low', [text('x')])])), false);
  assert.equal(secondUserTurn(jsonl([userText('fix it'), rec('m1', 'low', [text('x')]), userText('   '), userBlocks([text('')]), userBlocks([])])), false);
  assert.equal(secondUserTurn(''), false);
  assert.equal(secondUserTurn('not json\n{"type":"user"'), false);
});

// ---- firstEditIndex ---------------------------------------------------------------------------------------------------

t('firstEditIndex: an Edit, Write or MultiEdit call, by request index', () => {
  for (const name of ['Edit', 'Write', 'MultiEdit']) {
    const tr = jsonl([rec('m0', 'low', [bashUse('ls')]), rec('m1', 'low', [use('Read', { file_path: '/work/a' })]), rec('m2', 'low', [thinking()]), rec('m2', 'low', [use(name, { file_path: '/work/a' })])]);
    assert.equal(firstEditIndex(tr), 2, name);
  }
});

t('firstEditIndex: a Bash call holding sed -i, cat >, tee or a heredoc whose body calls .write(', () => {
  const edits = [
    "sed -i 's/a/b/' src/lib.rs",
    "sed -i.bak 's/a/b/' src/lib.rs",
    "sed -ni 's/a/b/p' f",
    "cd /work && sed -E -i 's/a/b/' f",
    'sed --in-place s/a/b/ f',
    "cat > src/new.rs <<'EOF'\nfn main() {}\nEOF",
    'cat >src/new.rs',
    'cat a 2>&1 > out.txt',
    'echo hi | tee out.txt',
    'tee -a notes.md < x',
    "python3 - <<'PY'\nopen('/work/f','w').write('x')\nPY",
    "python3 <<PY\nfrom pathlib import Path\nPath('f').write_text('x')\np = open('g', 'w')\np.write('x')\nPY",
  ];
  for (const command of edits) {
    assert.equal(firstEditIndex(jsonl([rec('m0', 'low', [bashUse('ls')]), rec('m1', 'low', [bashUse(command)])])), 1, command);
  }
});

t('firstEditIndex: reads, searches and tests are not edits; none gives null', () => {
  const quiet = [
    'ls -la',
    "sed -n '1,20p' src/lib.rs",
    'sed s/a/b/ f',
    'cat src/lib.rs',
    'cat a b | wc -l',
    'cargo test 2>&1',
    'cat f 2>&1 | head',
    'cat f >&2',
    'cat > /dev/null',
    "python3 - <<'PY'\nprint(open('f').read())\nPY",
    'cat <<EOF\nhello\nEOF',
  ];
  for (const command of quiet) {
    assert.equal(firstEditIndex(jsonl([rec('m0', 'low', [bashUse(command)])])), null, command);
  }
  assert.equal(firstEditIndex(''), null);
  assert.equal(firstEditIndex(jsonl([rec('m0', 'low', [use('Bash', { command: 7 })]), rec('m1', 'low', [use('Bash', null)]), rec('m2', 'low', [use('Read', {})])])), null);
});

// ---- checkRun ---------------------------------------------------------------------------------------------------------

t('checkRun: a consistent toggle run gives no reasons, shareXhigh 0.5 and upSwitches 1 for efforts low, low, xhigh, xhigh', () => {
  const efforts = ['low', 'low', 'xhigh', 'xhigh'];
  const log = logOf([...agreeing(efforts).slice(0, 2), call(1, 'xhigh'), ...agreeing(efforts).slice(2)]);
  const r = checkRun({ transcriptText: simple(efforts), modLogText: log, mode: 'toggle' });
  assert.deepEqual(r.reasons, []);
  assert.equal(r.requests, 4);
  assert.equal(r.shareXhigh, 0.5);
  assert.equal(r.upSwitches, 1);
  assert.equal(r.calls, 1);
  assert.equal(r.secondTurn, false);
  assert.deepEqual(r.broadAt, []);
  assert.deepEqual(r.audit, []);
});

t('checkRun: upSwitches counts low to xhigh transitions between consecutive requests only', () => {
  const run = (efforts) => checkRun({ transcriptText: simple(efforts), modLogText: logOf(agreeing(efforts)), mode: 'toggle' });
  assert.equal(run(['low', 'xhigh', 'low', 'xhigh']).upSwitches, 2);
  assert.equal(run(['xhigh', 'low', 'low']).upSwitches, 0);
  assert.equal(run(['xhigh', 'xhigh']).upSwitches, 0);
  assert.equal(run(['low', 'xhigh', 'xhigh', 'low', 'low', 'xhigh']).upSwitches, 2);
  assert.equal(run(['xhigh']).shareXhigh, 1);
  assert.equal(run(['low', 'low', 'low']).shareXhigh, 0);
});

t('checkRun: the requests count is a number and ignores the log', () => {
  const r = checkRun({ transcriptText: simple(['low', 'low', 'low']), modLogText: logOf(agreeing(['low'])), mode: 'toggle' });
  assert.equal(typeof r.requests, 'number');
  assert.equal(r.requests, 3);
});

t('checkRun: an extra message id (API retry) gives log_transcript_mismatch and does not throw', () => {
  const efforts = ['low', 'low', 'xhigh'];
  const retried = jsonl([
    rec('m0', 'low', [bashUse('ls')]),
    rec('m0_retry', 'low', [bashUse('ls')]),
    rec('m1', 'low', [bashUse('ls')]),
    rec('m2', 'xhigh', [bashUse('ls')]),
  ]);
  let r;
  assert.doesNotThrow(() => {
    r = checkRun({ transcriptText: retried, modLogText: logOf(agreeing(efforts)), mode: 'toggle' });
  });
  assert.deepEqual(r.reasons, ['log_transcript_mismatch']);
  assert.equal(r.requests, 4);
});

t('checkRun: fewer transcript requests than log steps, and a step whose after differs from the transcript effort, are mismatches', () => {
  const fewer = checkRun({ transcriptText: simple(['low', 'low']), modLogText: logOf(agreeing(['low', 'low', 'low'])), mode: 'toggle' });
  assert.deepEqual(fewer.reasons, ['log_transcript_mismatch']);
  const differs = checkRun({ transcriptText: simple(['low', 'low']), modLogText: logOf([step(0, 'low', 'low'), step(1, 'low', 'xhigh')]), mode: 'toggle' });
  assert.deepEqual(differs.reasons, ['log_transcript_mismatch']);
  // `before` is the effort the step arrived with; only `after` is the request as sent (ruling P2).
  const rewritten = checkRun({ transcriptText: simple(['xhigh', 'xhigh']), modLogText: logOf([step(0, 'low', 'xhigh'), step(1, 'low', 'xhigh')]), mode: 'toggle' });
  assert.deepEqual(rewritten.reasons, []);
});

t('checkRun: a non-string effort in the log or in the transcript is a mismatch', () => {
  const inLog = checkRun({ transcriptText: simple(['low']), modLogText: logOf([step(0, 1, 1)]), mode: 'toggle' });
  assert.deepEqual(inLog.reasons, ['log_transcript_mismatch']);
  const nullInLog = checkRun({ transcriptText: simple(['low']), modLogText: logOf([step(0, null, null)]), mode: 'toggle' });
  assert.deepEqual(nullInLog.reasons, ['log_transcript_mismatch']);
  const inTranscript = checkRun({ transcriptText: simple([7]), modLogText: logOf([step(0, 7, 7)]), mode: 'toggle' });
  assert.deepEqual(inTranscript.reasons, ['log_transcript_mismatch']);
  const oddBefore = checkRun({ transcriptText: simple(['low']), modLogText: logOf([step(0, 1, 'low')]), mode: 'toggle' });
  assert.deepEqual(oddBefore.reasons, ['log_transcript_mismatch']);
  // a step that arrived with no effort (before null) and was rewritten is fine
  const nullBefore = checkRun({ transcriptText: simple(['low']), modLogText: logOf([step(0, null, 'low')]), mode: 'toggle' });
  assert.deepEqual(nullBefore.reasons, []);
  const absent = checkRun({ transcriptText: simple([undefined]), modLogText: logOf([step(0, null, null)]), mode: 'toggle' });
  assert.deepEqual(absent.reasons, ['log_transcript_mismatch']);
});

t('checkRun: subagent step lines (request null) are not main steps', () => {
  const efforts = ['low', 'xhigh'];
  const log = logOf([subStep(null, null), step(0, 'low', 'low'), subStep('low', 'low'), step(1, 'low', 'xhigh'), subStep('low', 'xhigh')]);
  const r = checkRun({ transcriptText: simple(efforts), modLogText: log, mode: 'toggle' });
  assert.deepEqual(r.reasons, []);
  assert.equal(r.requests, 2);
});

t('checkRun: a main step whose request number is not its position is a mismatch', () => {
  const r = checkRun({ transcriptText: simple(['low', 'low']), modLogText: logOf([step(0, 'low', 'low'), step(5, 'low', 'low')]), mode: 'toggle' });
  assert.deepEqual(r.reasons, ['log_transcript_mismatch']);
});

t('checkRun: a missing log gives no_mod_log and nothing else; an error line gives mod_error', () => {
  const transcriptText = simple(['low', 'low']);
  for (const modLogText of [undefined, null, '', '  \n\n']) {
    const r = checkRun({ transcriptText, modLogText, mode: 'toggle' });
    assert.deepEqual(r.reasons, ['no_mod_log'], JSON.stringify(modLogText));
    assert.equal(r.requests, 2);
    assert.equal(r.calls, 0);
  }
  const err = checkRun({ transcriptText, modLogText: logOf([{ type: 'error', message: 'cannot read config.json: ENOENT' }]), mode: 'toggle' });
  assert.ok(err.reasons.includes('mod_error'));
  assert.ok(!err.reasons.includes('no_mod_log'));
  // an error line next to a log that otherwise agrees is still an error run
  const both = checkRun({ transcriptText, modLogText: logOf([{ type: 'error', message: 'x' }, ...agreeing(['low', 'low'])]), mode: 'toggle' });
  assert.deepEqual(both.reasons, ['mod_error']);
});

t('checkRun: a torn last log line is a mismatch, whether it cuts a step or a call', () => {
  const efforts = ['low', 'low'];
  const good = logOf([...agreeing(efforts), call(1, 'xhigh')]);
  const cutCall = good.slice(0, good.length - 12);
  const r = checkRun({ transcriptText: simple(efforts), modLogText: cutCall, mode: 'toggle' });
  assert.deepEqual(r.reasons, ['log_transcript_mismatch']);
  const cutStep = logOf(agreeing(efforts)).slice(0, -15);
  assert.deepEqual(checkRun({ transcriptText: simple(efforts), modLogText: cutStep, mode: 'toggle' }).reasons, ['log_transcript_mismatch']);
});

t('checkRun: calls counts the call lines only, not invalid ones', () => {
  const log = logOf([step(0, 'low', 'low'), call(0, 'xhigh'), { type: 'invalid', request: 0, input: { level: 'medium' } }, call(0, 'low')]);
  assert.equal(checkRun({ transcriptText: simple(['low']), modLogText: log, mode: 'toggle' }).calls, 2);
});

t('checkRun: a Bash call cat /run/config/... gives an audit entry with its request index', () => {
  const tr = jsonl([
    rec('m0', 'low', [bashUse('ls /work')]),
    rec('m1', 'low', [thinking()]),
    rec('m1', 'low', [bashUse('cat /run/config/arm.json'), use('Read', { file_path: '/work/README.md' })]),
    rec('m2', 'low', [use('Read', { file_path: '/opt/es/mod/hooks/register.ts' })]),
  ]);
  const r = checkRun({ transcriptText: tr, modLogText: logOf(agreeing(['low', 'low', 'low'])), mode: 'toggle' });
  assert.deepEqual(r.reasons, ['audit']);
  assert.equal(r.audit.length, 2);
  assert.deepEqual(r.audit[0], { request: 1, tool: 'Bash', hits: ['names /run/config'] });
  assert.equal(r.audit[1].request, 2);
  assert.equal(r.audit[1].tool, 'Read');
  assert.ok(r.audit[1].hits.length > 0);
});

t('checkRun: reasons come in the order no_mod_log, mod_error, log_transcript_mismatch, audit', () => {
  const tr = jsonl([rec('m0', 'low', [bashUse('cat /run/state/x')]), rec('m1', 'low', [bashUse('ls')])]);
  const r = checkRun({ transcriptText: tr, modLogText: logOf([{ type: 'error', message: 'e' }]), mode: 'toggle' });
  assert.deepEqual(r.reasons, ['mod_error', 'log_transcript_mismatch', 'audit']);
  const none = checkRun({ transcriptText: tr, modLogText: undefined, mode: 'toggle' });
  assert.deepEqual(none.reasons, ['no_mod_log', 'audit']);
});

t('checkRun: broadAt lists the request indices of broad checks', () => {
  const tr = jsonl([
    rec('m0', 'low', [bashUse('cargo test --lib')]),
    rec('m1', 'low', [bashUse('cargo test --workspace')]),
    rec('m2', 'low', [bashUse('ls')]),
    rec('m3', 'low', [use('Read', { file_path: '/work/a' }), bashUse('cd /work && cargo clippy --all-targets')]),
    rec('m4', 'low', [bashUse('cargo test')]),
  ]);
  const r = checkRun({ transcriptText: tr, modLogText: logOf(agreeing(['low', 'low', 'low', 'low', 'low'])), mode: 'toggle' });
  assert.deepEqual(r.broadAt, [1, 3, 4]);
  assert.deepEqual(r.reasons, []);
});

t('checkRun: secondTurn comes from the transcript', () => {
  const tr = jsonl([userText('go'), rec('m0', 'low', [bashUse('ls')]), userText('<task-notification>x</task-notification>'), rec('m1', 'low', [text('done')])]);
  const r = checkRun({ transcriptText: tr, modLogText: logOf(agreeing(['low', 'low'])), mode: 'toggle' });
  assert.equal(r.secondTurn, true);
  assert.deepEqual(r.reasons, []);
});

t('checkRun: without a mod the arm check is not made, whatever `mode` says (it is no longer read)', () => {
  const efforts = ['low', 'xhigh'];
  for (const mode of ['toggle', 'placebo', 'random', 'schedule', undefined, 'nonsense']) {
    const r = checkRun({ transcriptText: simple(efforts), modLogText: logOf(agreeing(efforts)), mode });
    assert.deepEqual(r.reasons, [], String(mode));
  }
});

t('checkRun: never throws, on empty, torn, hostile or non-string input', () => {
  const tr = jsonl([
    userText('go'),
    rec('m0', 'low', [thinking()], 3),
    rec('m0', 'low', [bashUse('cat /run/config/x <<EOF\nbody\nEOF'), use('Read', { file_path: '/opt/es' })], 40),
    toolResult(),
    userText('<task-notification>x</task-notification>'),
    rec('m1', 'xhigh', [bashUse('cargo test --workspace')]),
  ]);
  const log = logOf([step(0, 'low', 'low'), call(0, 'xhigh'), step(1, 'low', 'xhigh'), { type: 'error', message: 'e' }]);
  // every prefix of both texts, each paired with the whole of the other and with itself
  for (let i = 0; i <= tr.length; i += 7) {
    assert.doesNotThrow(() => checkRun({ transcriptText: tr.slice(0, i), modLogText: log, mode: 'toggle' }), `transcript cut at ${i}`);
  }
  for (let i = 0; i <= log.length; i += 3) {
    assert.doesNotThrow(() => checkRun({ transcriptText: tr, modLogText: log.slice(0, i), mode: 'toggle' }), `log cut at ${i}`);
  }
  const hostile = [
    '',
    '\n\n',
    'null',
    '[]',
    '{',
    '{"type":"assistant"}',
    '{"type":"assistant","message":null}',
    '{"type":"assistant","message":{"id":"x","content":[{"type":"tool_use","name":"Bash","input":{"command":{"a":1}}}]}}',
    '{"type":"assistant","message":{"id":"x","content":[{"type":"tool_use","name":7,"input":[1]}]}}',
    '{"type":"user","message":{"content":[null,1,"a",{"type":"text"}]}}',
    '{"type":"user"}',
    '{"type":"step","request":"0"}',
    '\u0000\ud800',
  ];
  for (const a of hostile) {
    for (const b of [...hostile, undefined, null]) {
      assert.doesNotThrow(() => checkRun({ transcriptText: a, modLogText: b, mode: 'toggle' }), JSON.stringify([a, b]));
    }
  }
  for (const odd of [undefined, null, 5, {}, [], true]) {
    assert.doesNotThrow(() => checkRun({ transcriptText: odd, modLogText: odd, mode: odd }));
  }
  assert.doesNotThrow(() => checkRun({}));
  assert.doesNotThrow(() => checkRun());
  const r = checkRun({ transcriptText: '', modLogText: '', mode: 'toggle' });
  assert.deepEqual(r.reasons, ['no_mod_log']);
  assert.equal(r.requests, 0);
  assert.equal(r.shareXhigh, 0);
  assert.equal(r.upSwitches, 0);
  assert.equal(r.secondTurn, false);
});

// ---- checkRun: the arm check (ruling P20) -------------------------------------------------------------------------------

const sched = (...schedule) => ({ mode: 'schedule', schedule });
const PLACEBO = { mode: 'placebo' };
const TOGGLE = { mode: 'toggle' };
// A run whose transcript carries `levels` and whose log is `lines`; `mod` and `startEffort` are the arm's.
const arm = (mod, startEffort, levels, lines) => checkRun({ transcriptText: simple(levels), modLogText: logOf(lines), mod, startEffort });
// The log of a run that started at `start` and sent `levels`.
const sent = (start, levels) => levels.map((l, i) => step(i, start, l));
const LX = sched('low', 'low', 'low', 'xhigh'); // F-LX with switchAt 3
const LX_LEVELS = ['low', 'low', 'low', 'xhigh', 'xhigh', 'xhigh'];

t('checkRun arm check, schedule: F-LX levels fit F-LX and break F-L, F-X and a different switch point', () => {
  assert.deepEqual(arm(LX, 'low', LX_LEVELS, sent('low', LX_LEVELS)).reasons, []);
  assert.deepEqual(arm(sched('low'), 'low', LX_LEVELS, sent('low', LX_LEVELS)).reasons, ['arm_mismatch'], 'F-L levels expected: F-LX data is not F-L');
  assert.deepEqual(arm(sched('low', 'low', 'low', 'low', 'xhigh'), 'low', LX_LEVELS, sent('low', LX_LEVELS)).reasons, ['arm_mismatch'], 'a switch one request later');
  assert.deepEqual(arm(sched('low', 'xhigh'), 'low', LX_LEVELS, sent('low', LX_LEVELS)).reasons, ['arm_mismatch'], 'a switch earlier');
  // F-L data fed as the F-LX arm (the review's case)
  assert.deepEqual(arm(LX, 'low', Array(6).fill('low'), sent('low', Array(6).fill('low'))).reasons, ['arm_mismatch']);
  assert.deepEqual(arm(sched('low'), 'low', Array(6).fill('low'), sent('low', Array(6).fill('low'))).reasons, []);
  assert.deepEqual(arm(sched('xhigh'), 'xhigh', Array(4).fill('xhigh'), sent('xhigh', Array(4).fill('xhigh'))).reasons, []);
  // F-XL
  const xl = ['xhigh', 'xhigh', 'low', 'low'];
  assert.deepEqual(arm(sched('xhigh', 'xhigh', 'low'), 'xhigh', xl, sent('xhigh', xl)).reasons, []);
  assert.deepEqual(arm(sched('xhigh', 'low'), 'xhigh', xl, sent('xhigh', xl)).reasons, ['arm_mismatch']);
});

t('checkRun arm check: the first step must have started at the arm CLI effort', () => {
  assert.deepEqual(arm(sched('low'), 'xhigh', ['low', 'low'], sent('low', ['low', 'low'])).reasons, ['arm_mismatch'], 'start effort xhigh expected, the run started low');
  assert.deepEqual(arm(sched('low'), 'low', ['low', 'low'], sent('xhigh', ['low', 'low'])).reasons, ['arm_mismatch'], 'first step arrived at xhigh');
  // only the first step counts for this rule (a later step may arrive at another effort in schedule mode)
  assert.deepEqual(arm(sched('low'), 'low', ['low', 'low'], [step(0, 'low', 'low'), step(1, 'xhigh', 'low')]).reasons, []);
  assert.deepEqual(arm(sched('low'), 'low', ['low'], [step(0, null, 'low')]).reasons, ['arm_mismatch'], 'before null is not the start effort');
  assert.deepEqual(arm(sched('low'), 'medium', ['low'], sent('low', ['low'])).reasons, ['arm_mismatch'], 'a start effort that is not a level');
  assert.deepEqual(arm(PLACEBO, 'medium', ['medium', 'medium'], sent('medium', ['medium', 'medium'])).reasons, ['arm_mismatch'], 'levels are exactly low and xhigh, even for a placebo that never rewrites');
  assert.deepEqual(arm(sched('low'), undefined, ['low'], sent('low', ['low'])).reasons, ['arm_mismatch']);
});

t('checkRun arm check, placebo: nothing is rewritten and every step arrives at the start effort', () => {
  const lines = [...sent('low', ['low', 'low', 'low']).slice(0, 1), call(0, 'xhigh'), step(1, 'low', 'low'), call(1, 'low'), step(2, 'low', 'low')];
  assert.deepEqual(arm(PLACEBO, 'low', ['low', 'low', 'low'], lines).reasons, []);
  // a rewritten step (xhigh after a call) is a toggle run, not a placebo run
  assert.deepEqual(arm(PLACEBO, 'low', ['low', 'low', 'xhigh'], [step(0, 'low', 'low'), call(0, 'xhigh'), step(1, 'low', 'low'), step(2, 'low', 'xhigh')]).reasons, ['arm_mismatch']);
  // a placebo run that arrived at xhigh throughout, against a low start
  assert.deepEqual(arm(PLACEBO, 'low', ['xhigh', 'xhigh'], sent('xhigh', ['xhigh', 'xhigh'])).reasons, ['arm_mismatch']);
  // and a later step that arrived at another effort without being rewritten is not the arm's start effort
  assert.deepEqual(arm(PLACEBO, 'low', ['low', 'xhigh'], [step(0, 'low', 'low'), step(1, 'xhigh', 'xhigh')]).reasons, ['arm_mismatch']);
  assert.deepEqual(arm(PLACEBO, 'xhigh', ['xhigh', 'xhigh'], sent('xhigh', ['xhigh', 'xhigh'])).reasons, [], 'a placebo arm that starts at xhigh');
});

t('checkRun arm check, toggle: a step follows the last call of an EARLIER request, else the start effort', () => {
  const ok = [step(0, 'low', 'low'), step(1, 'low', 'low'), call(1, 'xhigh'), step(2, 'low', 'xhigh'), step(3, 'low', 'xhigh'), call(3, 'low'), step(4, 'low', 'low')];
  const levels = ['low', 'low', 'xhigh', 'xhigh', 'low'];
  assert.deepEqual(arm(TOGGLE, 'low', levels, ok).reasons, []);
  // the level changes with no call
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'low', 'xhigh', 'xhigh', 'xhigh'], [step(0, 'low', 'low'), step(1, 'low', 'low'), step(2, 'low', 'xhigh'), step(3, 'low', 'xhigh'), step(4, 'low', 'xhigh')]).reasons, ['arm_mismatch']);
  // a call that is ignored: the next step stays low
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'low', 'low'], [step(0, 'low', 'low'), step(1, 'low', 'low'), call(1, 'xhigh'), step(2, 'low', 'low')]).reasons, ['arm_mismatch']);
  // timing, early: the call made in request 1 must not reach request 1
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'xhigh', 'xhigh'], [step(0, 'low', 'low'), step(1, 'low', 'xhigh'), call(1, 'xhigh'), step(2, 'low', 'xhigh')]).reasons, ['arm_mismatch']);
  // timing, late: it must reach request 2
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'low', 'low', 'xhigh'], [step(0, 'low', 'low'), step(1, 'low', 'low'), call(1, 'xhigh'), step(2, 'low', 'low'), step(3, 'low', 'xhigh')]).reasons, ['arm_mismatch']);
  // two calls in one request: the last answered wins
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'low'], [step(0, 'low', 'low'), call(0, 'xhigh'), call(0, 'low'), step(1, 'low', 'low')]).reasons, []);
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'xhigh'], [step(0, 'low', 'low'), call(0, 'low'), call(0, 'xhigh'), step(1, 'low', 'xhigh')]).reasons, []);
  // an invalid line is not a call; a hand-made call line with a level that is not allowed does not set a level
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'low'], [step(0, 'low', 'low'), { type: 'invalid', request: 0, input: { level: 'high' } }, call(0, 'high'), step(1, 'low', 'low')]).reasons, []);
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'xhigh'], [step(0, 'low', 'low'), { type: 'invalid', request: 0, input: { level: 'xhigh' } }, step(1, 'low', 'xhigh')]).reasons, ['arm_mismatch']);
  // a toggle arm that starts at xhigh
  assert.deepEqual(arm(TOGGLE, 'xhigh', ['xhigh', 'xhigh'], sent('xhigh', ['xhigh', 'xhigh'])).reasons, []);
});

t('checkRun arm check, toggle: a subagent call counts like the mod counts it (it sets the main level); subagent steps are ignored', () => {
  const log = [
    subStep(null, null),
    step(0, 'low', 'low'),
    { ...call(0, 'xhigh'), agentId: 'a1', text: 'Effort is now xhigh. It applies from your next step.' },
    subStep('low', 'xhigh'),
    step(1, 'low', 'xhigh'),
  ];
  assert.deepEqual(arm(TOGGLE, 'low', ['low', 'xhigh'], log).reasons, []);
  // a subagent step with a wrong level changes nothing
  assert.deepEqual(arm(sched('low'), 'low', ['low'], [subStep('xhigh', 'xhigh'), step(0, 'low', 'low'), subStep('xhigh', 'xhigh')]).reasons, []);
});

t('checkRun arm check, random: the levels must equal randomLevels for the arm seed and the first main turnId', () => {
  const mod = { mode: 'random', random: { pUp: 0.5, pDown: 0.5, seed: 42 } };
  const levels = randomLevels(0.5, 0.5, 42, 't1', 8);
  // pUp and pDown are not interchangeable
  const skew = { mode: 'random', random: { pUp: 0.8, pDown: 0.2, seed: 5 } };
  const skewed = randomLevels(0.8, 0.2, 5, 't1', 10);
  assert.notDeepEqual(skewed, randomLevels(0.2, 0.8, 5, 't1', 10));
  assert.deepEqual(arm(skew, 'low', skewed, sent('low', skewed)).reasons, []);
  assert.deepEqual(arm({ mode: 'random', random: { pUp: 0.2, pDown: 0.8, seed: 5 } }, 'low', skewed, sent('low', skewed)).reasons, ['arm_mismatch']);
  assert.ok(levels.includes('low') && levels.includes('xhigh'));
  assert.deepEqual(arm(mod, 'low', levels, sent('low', levels)).reasons, []);
  assert.deepEqual(arm({ mode: 'random', random: { pUp: 0.5, pDown: 0.5, seed: 43 } }, 'low', levels, sent('low', levels)).reasons, ['arm_mismatch'], 'a wrong seed');
  assert.deepEqual(arm({ mode: 'random', random: { pUp: 0.9, pDown: 0.1, seed: 42 } }, 'low', levels, sent('low', levels)).reasons, ['arm_mismatch'], 'wrong probabilities');
  // the chain is seeded with the FIRST main step's turnId, not a later one
  const other = levels.map((l, i) => ({ ...step(i, 'low', l), turnId: i === 0 ? 'T-other' : 't1' }));
  assert.deepEqual(arm(mod, 'low', levels, other).reasons, ['arm_mismatch']);
  const later = randomLevels(0.5, 0.5, 42, 'T-other', 8);
  assert.deepEqual(arm(mod, 'low', later, later.map((l, i) => ({ ...step(i, 'low', l), turnId: i === 0 ? 'T-other' : 't1' }))).reasons, [], 'a later turn continues the chain (P6)');
  // a main-step turnId that is not a string cannot seed anything
  assert.deepEqual(arm(mod, 'low', levels, levels.map((l, i) => ({ ...step(i, 'low', l), turnId: undefined }))).reasons, ['arm_mismatch']);
  // a malformed random block
  for (const random of [undefined, { pUp: 2, pDown: 0, seed: 1 }, { pUp: 0.5, pDown: 0.5, seed: 1.5 }, { pUp: 0.5, pDown: 'x', seed: 1 }]) {
    assert.deepEqual(arm({ mode: 'random', random }, 'low', levels, sent('low', levels)).reasons, ['arm_mismatch'], JSON.stringify(random));
  }
});

t('checkRun arm check: a numeric or missing effort is a mismatch, a malformed mod is a mismatch, a null mod is no check', () => {
  const r = arm(sched('low'), 'low', [7], [step(0, 'low', 7)]);
  assert.ok(r.reasons.includes('arm_mismatch'));
  for (const mod of [{}, { mode: 'sometimes' }, { mode: 'schedule' }, { mode: 'schedule', schedule: [] }, { mode: 'schedule', schedule: ['medium'] }, 'schedule', [], 5]) {
    assert.deepEqual(arm(mod, 'low', ['low'], sent('low', ['low'])).reasons, ['arm_mismatch'], JSON.stringify(mod));
  }
  for (const mod of [null, undefined]) assert.deepEqual(arm(mod, 'low', ['xhigh', 'low'], sent('xhigh', ['xhigh', 'low'])).reasons, [], 'no mod: no arm check');
  // no main step at all: nothing to compare
  assert.deepEqual(arm(sched('low'), 'low', [], [subStep(null, null)]).reasons, []);
});

t('checkRun arm check: no_mod_log stands alone; reasons come in the order log reasons, arm_mismatch, audit', () => {
  const tr = jsonl([rec('m0', 'low', [bashUse('cat /run/state/x')]), rec('m1', 'low', [bashUse('ls')])]);
  assert.deepEqual(checkRun({ transcriptText: tr, modLogText: undefined, mod: sched('xhigh'), startEffort: 'xhigh' }).reasons, ['no_mod_log', 'audit']);
  const all = checkRun({ transcriptText: tr, modLogText: logOf([{ type: 'error', message: 'e' }]), mod: sched('xhigh'), startEffort: 'xhigh' });
  assert.deepEqual(all.reasons, ['mod_error', 'log_transcript_mismatch', 'audit'], 'no main step line, nothing to compare');
  const withSteps = checkRun({ transcriptText: tr, modLogText: logOf([{ type: 'error', message: 'e' }, step(0, 'low', 'low'), step(1, 'low', 'low')]), mod: sched('xhigh'), startEffort: 'xhigh' });
  assert.deepEqual(withSteps.reasons, ['mod_error', 'arm_mismatch', 'audit']);
  const mismatch = checkRun({ transcriptText: tr, modLogText: logOf([step(0, 'low', 'low')]), mod: sched('xhigh'), startEffort: 'xhigh' });
  assert.deepEqual(mismatch.reasons, ['log_transcript_mismatch', 'arm_mismatch', 'audit']);
});

t('checkRun: callLog lists the call lines as { request, level, reason }; log lines with the new fields (index, agentId, text) give no reasons', () => {
  const efforts = ['low', 'low', 'xhigh'];
  const log = logOf([
    step(0, 'low', 'low', { index: 0 }),
    { type: 'call', request: 0, agentId: null, level: 'low', reason: 'first', text: 'Effort is now low. It applies from your next step.' },
    step(1, 'low', 'low', { index: 1, agentId: null }),
    { type: 'call', request: 1, agentId: 'a1', level: 'xhigh', reason: 'review', text: 'Effort is now xhigh. It applies from your next step.' },
    { type: 'invalid', request: 1, agentId: null, input: { level: 'high' } },
    step(2, 'low', 'xhigh', { index: 0 }), // a new turn: index restarts, request does not
  ]);
  for (const arg of [{}, { mod: TOGGLE, startEffort: 'low' }]) {
    const r = checkRun({ transcriptText: simple(efforts), modLogText: log, ...arg });
    assert.deepEqual(r.reasons, [], JSON.stringify(arg));
    assert.equal(r.calls, 2);
    assert.deepEqual(r.callLog, [
      { request: 0, level: 'low', reason: 'first' },
      { request: 1, level: 'xhigh', reason: 'review' },
    ]);
  }
  assert.deepEqual(checkRun({ transcriptText: simple(efforts), modLogText: undefined }).callLog, []);
});

t('checkRun arm check: never throws, whatever mod, startEffort and log hold', () => {
  const tr = simple(['low', 'xhigh']);
  const logs = [logOf(agreeing(['low', 'xhigh'])), logOf([{ type: 'step', request: 0 }, { type: 'call' }, { type: 'call', request: 'x', level: 'xhigh' }]), '{', 'null', '[1]'];
  const mods = [null, undefined, 0, 'x', [], {}, { mode: 'toggle' }, { mode: 'random' }, { mode: 'random', random: null }, { mode: 'random', random: { pUp: NaN, pDown: 0, seed: 1 } }, { mode: 'schedule', schedule: 'low' }, { mode: 'placebo' }, { mode: 'toggle', schedule: [1] }];
  for (const modLogText of logs) {
    for (const mod of mods) {
      for (const startEffort of ['low', 'xhigh', 5, null, undefined, {}]) {
        assert.doesNotThrow(() => checkRun({ transcriptText: tr, modLogText, mod, startEffort }), JSON.stringify([modLogText, mod, startEffort]));
      }
    }
  }
});

// ---- checkRun: a timeout that kills a run mid-request (ruling P27) --------------------------------------------------------
//
// The mod writes the `step` line of a request BEFORE the request is sent (register.ts turn.step); the transcript records the message
// only when the response returns. A wall-clock kill during request N therefore leaves N + 1 main step lines against N transcript
// requests. The logs below come from the REAL mod, register.ts driven by fakes the way mod.test.mjs drives it.

const MOD_LOG_PATH = '/run/state/effort-toggle/log.jsonl';

// Drives the real mod through `events` (one turn.step each, as the engine sends them); `callAfter` maps an event index to the level the
// model asks for with set_effort in the response to that step. Returns the log text and the effort each step's request carried.
async function driveRealMod(config, events, callAfter = {}) {
  const hooks = { 'session.start': [], 'tool.call': [], 'turn.step': [] };
  const on = (event, a, b) => hooks[event].push(b === undefined ? { matcher: undefined, hook: a } : { matcher: a, hook: b });
  const files = new Map([['/opt/es/mod/config.json', JSON.stringify({ ...config, logPath: MOD_LOG_PATH })]]);
  const $ = {
    plugin: { name: 'effort-toggle', root: '/opt/es/mod' },
    fs: {
      read: async (p) => {
        if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
        return files.get(p);
      },
      write: async (p, s) => {
        files.set(p, s);
      },
    },
    tool: { register: async (spec) => ({ tool: `mcp__effort-toggle__${spec.name}` }) },
  };
  register(on, {});
  await hooks['session.start'][0].hook($, Object.freeze({ cwd: '/work' }), async (x) => ({ cwd: x.cwd }));
  const sent = [];
  for (const [i, ev] of events.entries()) {
    const seen = [];
    const next = async function* (x) {
      seen.push(x);
      return {};
    };
    const gen = hooks['turn.step'][0].hook($, Object.freeze({ model: 'claude-test', messageCount: 3, index: i, turnId: 't1', ...ev }), next);
    while (!(await gen.next()).done);
    sent.push(seen[0].effort);
    if (callAfter[i] !== undefined) {
      const e = Object.freeze({ tool: 'mcp__effort-toggle__set_effort', tool_use_id: `tu_${i}`, level: callAfter[i], reason: 'r' });
      await hooks['tool.call'][0].hook($, e, async () => ({ result: 'passed on' }));
    }
  }
  return { logText: files.get(MOD_LOG_PATH), sent };
}

// A run killed with `extra` requests sent and unanswered after `answered` answered ones: the transcript holds the answered requests
// (each at the effort the mod sent), the log every step the mod saw.
async function killedRun(mod, answered, extra, callAfter = {}) {
  const events = Array.from({ length: answered + extra }, () => ({ effort: 'low' }));
  const { logText, sent } = await driveRealMod(mod, events, callAfter);
  const lines = logText.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { sent, logText, lines, transcriptText: simple(sent.slice(0, answered)) };
}

const P27_SCHEDULE = { mode: 'schedule', schedule: ['low', 'low', 'xhigh'] };
const P27_TOGGLE = { mode: 'toggle' };
const KS = await killedRun(P27_SCHEDULE, 4, 1); // 4 answered (low low xhigh xhigh), request 4 in flight (xhigh)
const KS2 = await killedRun(P27_SCHEDULE, 4, 2);
const KT = await killedRun(P27_TOGGLE, 3, 1, { 1: 'xhigh' }); // answered low low xhigh, set_effort xhigh answered at request 1, request 3 in flight
const K0 = await killedRun(P27_SCHEDULE, 0, 1);
const P27_RANDOM = { mode: 'random', random: { pUp: 0.5, pDown: 0.5, seed: 42 } };
const KR = await killedRun(P27_RANDOM, 5, 1);
// a subagent step (event 2) between main steps: 5 main steps, the 5th unanswered
const KSUB = await driveRealMod(P27_SCHEDULE, [{ effort: 'low' }, { effort: 'low' }, { effort: 'low', agentId: 'a1' }, { effort: 'low' }, { effort: 'low' }, { effort: 'low' }]);
const mainOf = (lines) => lines.filter((l) => l.type === 'step' && l.request !== null);
assert.deepEqual(KS.sent, ['low', 'low', 'xhigh', 'xhigh', 'xhigh'], 'the real mod sent the schedule');
assert.deepEqual(KT.sent, ['low', 'low', 'xhigh', 'xhigh'], 'the real mod applied the call from the next request');
assert.equal(mainOf(KS.lines).length, 5);
assert.equal(mainOf(KS2.lines).length, 6);
assert.equal(mainOf(KT.lines).length, 4);
assert.equal(mainOf(K0.lines).length, 1);

const killedCheck = (K, mod, extra = {}) => checkRun({ transcriptText: K.transcriptText, modLogText: K.logText, mod, startEffort: 'low', ...extra });
// A copy of the log's lines edited by `fn` and written the way the mod writes it.
const edited = (K, fn) => logOf(fn(K.lines.map((l) => ({ ...l }))));
const renumbered = (lines) => {
  let n = 0;
  return lines.map((l) => (l.type === 'step' && l.request !== null ? { ...l, request: n++ } : l));
};

t('P27: a timed-out run with one extra trailing main step in the real mod log has no reasons, in a schedule and in a toggle arm', () => {
  const s = killedCheck(KS, P27_SCHEDULE, { timedOut: true });
  assert.deepEqual(s.reasons, []);
  assert.equal(s.requests, 4);
  const tg = killedCheck(KT, P27_TOGGLE, { timedOut: true });
  assert.deepEqual(tg.reasons, []);
  assert.equal(tg.requests, 3);
  assert.equal(tg.calls, 1);
  // without an arm (a reused row) the same
  assert.deepEqual(killedCheck(KS, undefined, { timedOut: true }).reasons, []);
  assert.deepEqual(killedCheck(KS, null, { timedOut: true }).reasons, []);
});

t('P27: the same log without timedOut (false, absent, or not the boolean true) is still log_transcript_mismatch, and only that', () => {
  assert.deepEqual(killedCheck(KS, P27_SCHEDULE).reasons, ['log_transcript_mismatch'], 'absent');
  assert.deepEqual(killedCheck(KT, P27_TOGGLE).reasons, ['log_transcript_mismatch'], 'absent, toggle');
  for (const timedOut of [false, undefined, null, 'true', 1, {}]) {
    assert.deepEqual(killedCheck(KS, P27_SCHEDULE, { timedOut }).reasons, ['log_transcript_mismatch'], JSON.stringify(timedOut));
  }
  // and an agreeing log is no mismatch either way
  const agree = { transcriptText: KS.transcriptText, modLogText: edited(KS, (ls) => ls.slice(0, 4)) };
  for (const timedOut of [true, false]) assert.deepEqual(checkRun({ ...agree, mod: P27_SCHEDULE, startEffort: 'low', timedOut }).reasons, []);
});

t('P27: two or more extra main steps are a mismatch even for a timeout', () => {
  assert.deepEqual(killedCheck(KS2, P27_SCHEDULE, { timedOut: true }).reasons, ['log_transcript_mismatch']);
  assert.deepEqual(killedCheck(KS2, undefined, { timedOut: true }).reasons, ['log_transcript_mismatch']);
});

t('P27: N + 1 steps where the extra one is not the last is a mismatch (an inserted step, a skipped or repeated request number)', () => {
  // an extra low step inserted before request 2, the numbers renumbered: the first 4 steps read low low low xhigh against low low xhigh xhigh
  const inserted = edited(KS, (ls) => renumbered([ls[0], ls[1], { ...ls[1] }, ls[2], ls[3]]));
  assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: inserted, timedOut: true }).reasons, ['log_transcript_mismatch']);
  // a skipped request number among the first N
  const skipped = edited(KS, (ls) => ls.map((l, i) => (i >= 3 ? { ...l, request: l.request + 1 } : l)));
  assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: skipped, timedOut: true }).reasons, ['log_transcript_mismatch']);
  // the trailing step is request N + 1, not N
  const gap = edited(KS, (ls) => ls.map((l, i) => (i === 4 ? { ...l, request: 5 } : l)));
  assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: gap, timedOut: true }).reasons, ['log_transcript_mismatch']);
  // a repeated request number
  const repeated = edited(KS, (ls) => ls.map((l, i) => (i === 4 ? { ...l, request: 3 } : l)));
  assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: repeated, timedOut: true }).reasons, ['log_transcript_mismatch']);
});

t('P27: N + 1 steps with a differing `after` in the first N, or a transcript effort that differs from the log, is a mismatch', () => {
  const wrongAfter = edited(KS, (ls) => ls.map((l, i) => (i === 1 ? { ...l, after: 'xhigh' } : l)));
  assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: wrongAfter, timedOut: true }).reasons, ['log_transcript_mismatch']);
  const wrongBefore = edited(KS, (ls) => ls.map((l, i) => (i === 1 ? { ...l, before: 7 } : l)));
  assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: wrongBefore, timedOut: true }).reasons, ['log_transcript_mismatch']);
  const otherTranscript = simple(['low', 'xhigh', 'xhigh', 'xhigh']);
  assert.deepEqual(checkRun({ transcriptText: otherTranscript, modLogText: KS.logText, timedOut: true }).reasons, ['log_transcript_mismatch']);
  // with the arm check on, the wrong `after` is also an arm violation: both reasons, in the documented order
  const both = checkRun({ transcriptText: KS.transcriptText, modLogText: wrongAfter, mod: P27_SCHEDULE, startEffort: 'low', timedOut: true });
  assert.deepEqual(both.reasons, ['log_transcript_mismatch', 'arm_mismatch']);
});

t('P27: a malformed trailing step (a request number that is not N, a non-string `after`, a `before` that is neither string nor null) is a mismatch', () => {
  const last = (patch) => edited(KS, (ls) => ls.map((l, i) => (i === 4 ? { ...l, ...patch } : l)));
  for (const patch of [{ request: '4' }, { request: 4.5 }, { after: null }, { after: 3 }, { before: 3 }, { before: undefined, after: undefined }]) {
    assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: last(patch), timedOut: true }).reasons, ['log_transcript_mismatch'], JSON.stringify(patch));
  }
  // `before` null is fine (the step carried no effort)
  assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: last({ before: null }), timedOut: true }).reasons, []);
});

t('P27: the arm check still runs over the trailing step: a trailing step that breaks the arm rule is arm_mismatch, not excused', () => {
  // the schedule says xhigh for request 4; the log says the mod sent low
  const bad = edited(KS, (ls) => ls.map((l, i) => (i === 4 ? { ...l, after: 'low' } : l)));
  assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText: bad, mod: P27_SCHEDULE, startEffort: 'low', timedOut: true }).reasons, ['arm_mismatch']);
  // toggle: the last answered call asked xhigh, the trailing step went out low
  const badToggle = edited(KT, (ls) => ls.map((l) => (l.type === 'step' && l.request === 3 ? { ...l, after: 'low' } : l)));
  assert.deepEqual(checkRun({ transcriptText: KT.transcriptText, modLogText: badToggle, mod: P27_TOGGLE, startEffort: 'low', timedOut: true }).reasons, ['arm_mismatch']);
  // placebo: a rewritten trailing step
  const placebo = edited(KS, (ls) => ls.map((l, i) => (i === 4 ? { ...l, before: 'low', after: 'low' } : { ...l, after: l.before })));
  const plTranscript = simple(['low', 'low', 'low', 'low']);
  assert.deepEqual(checkRun({ transcriptText: plTranscript, modLogText: placebo, mod: { mode: 'placebo' }, startEffort: 'low', timedOut: true }).reasons, []);
  const placeboBad = edited(KS, (ls) => ls.map((l, i) => (i === 4 ? { ...l, before: 'low', after: 'xhigh' } : { ...l, after: l.before })));
  assert.deepEqual(checkRun({ transcriptText: plTranscript, modLogText: placeboBad, mod: { mode: 'placebo' }, startEffort: 'low', timedOut: true }).reasons, ['arm_mismatch']);
  // random: the mod's own chain, and the trailing step flipped
  assert.deepEqual(killedCheck(KR, P27_RANDOM, { timedOut: true }).reasons, []);
  const flipped = edited(KR, (ls) => ls.map((l, i) => (i === 5 ? { ...l, after: l.after === 'low' ? 'xhigh' : 'low' } : l)));
  assert.deepEqual(checkRun({ transcriptText: KR.transcriptText, modLogText: flipped, mod: P27_RANDOM, startEffort: 'low', timedOut: true }).reasons, ['arm_mismatch']);
});

t('P27: an audit hit, a mod_error line, a torn log line and a missing log still exclude a timeout row', () => {
  // audit: request 1 read the config
  const peek = jsonl(KS.sent.slice(0, 4).map((e, i) => rec(`msg_${i}`, e, [bashUse(i === 1 ? 'cat /run/config/arm.json' : 'ls')])));
  assert.deepEqual(checkRun({ transcriptText: peek, modLogText: KS.logText, mod: P27_SCHEDULE, startEffort: 'low', timedOut: true }).reasons, ['audit']);
  // mod_error
  const withError = logOf([{ type: 'error', message: 'x' }]) + KS.logText;
  assert.deepEqual(killedCheck({ ...KS, logText: withError }, P27_SCHEDULE, { timedOut: true }).reasons, ['mod_error']);
  // a torn last line (the kill cut the in-flight step line itself) and a torn line in the middle
  const tornLast = KS.logText.slice(0, -20);
  assert.throws(() => JSON.parse(tornLast.split('\n').filter(Boolean).at(-1)), 'the fixture is torn');
  assert.deepEqual(killedCheck({ ...KS, logText: tornLast }, P27_SCHEDULE, { timedOut: true }).reasons, ['log_transcript_mismatch']);
  const lines = KS.logText.split('\n').filter(Boolean);
  const tornMiddle = [...lines.slice(0, 2), lines[2].slice(0, 10), ...lines.slice(3)].join('\n') + '\n';
  assert.deepEqual(killedCheck({ ...KS, logText: tornMiddle }, P27_SCHEDULE, { timedOut: true }).reasons, ['log_transcript_mismatch']);
  // no log at all
  for (const modLogText of [undefined, null, '', ' \n']) {
    assert.deepEqual(checkRun({ transcriptText: KS.transcriptText, modLogText, mod: P27_SCHEDULE, startEffort: 'low', timedOut: true }).reasons, ['no_mod_log'], JSON.stringify(modLogText));
  }
});

t('P27: N = 0 (no transcript request, one step in the log) follows the same rule; subagent steps never count as extra', () => {
  assert.deepEqual(killedCheck(K0, P27_SCHEDULE, { timedOut: true }).reasons, []);
  assert.equal(killedCheck(K0, P27_SCHEDULE, { timedOut: true }).requests, 0);
  assert.deepEqual(killedCheck(K0, P27_SCHEDULE).reasons, ['log_transcript_mismatch']);
  assert.deepEqual(checkRun({ transcriptText: '', modLogText: KS.logText, timedOut: true }).reasons, ['log_transcript_mismatch'], 'five steps against none');
  // a subagent step between main steps is no main step: 4 answered + 1 in flight is still one extra
  const { logText, sent } = KSUB;
  assert.equal(mainOf(logText.split('\n').filter(Boolean).map((l) => JSON.parse(l))).length, 5);
  const mainSent = sent.filter((_, i) => i !== 2);
  const r = checkRun({ transcriptText: simple(mainSent.slice(0, 4)), modLogText: logText, mod: P27_SCHEDULE, startEffort: 'low', timedOut: true });
  assert.deepEqual(r.reasons, []);
  assert.equal(r.requests, 4);
  assert.deepEqual(checkRun({ transcriptText: simple(mainSent.slice(0, 4)), modLogText: logText, mod: P27_SCHEDULE, startEffort: 'low' }).reasons, ['log_transcript_mismatch']);
});
