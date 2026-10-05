// s4-rows.test.mjs — vectors for the log + transcript join. No model call, no spawn.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from '../core/testkit.mjs';
import { armFromLog, buildRow, decisionFromLog, findTranscripts, hasApiError, reportsThinkingTokens, tokensFromTranscript } from './s4-rows.mjs';

const roots = [];
process.on('exit', () => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 's4-rows-test-'));
  roots.push(d);
  return d;
};

const msg = (id, u, role = 'assistant') => JSON.stringify({ type: role, message: { id, role, usage: u } });
const usage = (input, cc, cr, thinking) => ({
  input_tokens: input,
  cache_creation_input_tokens: cc,
  cache_read_input_tokens: cr,
  output_tokens: 999,
  output_tokens_details: { thinking_tokens: thinking },
});

t('armFromLog reads the arm of the first valid line and rejects anything else', () => {
  assert.equal(armFromLog('{"arm":"treated"}\n'), 'treated');
  assert.equal(armFromLog('{"arm":"holdout"}\n'), 'holdout');
  assert.equal(armFromLog('not json\n{"arm":"holdout"}\n'), 'holdout');
  assert.equal(armFromLog('{"arm":"other"}\n{"x":1}\n'), null);
  assert.equal(armFromLog(''), null);
});

t('tokensFromTranscript sums over assistant messages deduped by message.id (R3)', () => {
  const text = [
    msg('A', usage(10, 20, 30, 50)),
    msg('A', usage(10, 20, 30, 50)), // streamed duplicate of A
    msg('B', usage(5, 0, 100, 30)),
    msg('U', usage(1000, 1000, 1000, 1000), 'user'), // not an assistant message
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: usage(7, 7, 7, 7) } }), // no id: not countable
    'torn line {',
  ].join('\n');
  assert.deepEqual(tokensFromTranscript(text), { thinking_tokens: 80, cache_creation: 20, input_total: 60 + 105 });
});

t('tokensFromTranscript returns null when there is no assistant usage', () => {
  assert.equal(tokensFromTranscript(''), null);
  assert.equal(tokensFromTranscript(msg('U', usage(1, 1, 1, 1), 'user')), null);
});

t('tokensFromTranscript treats missing detail fields as zero, not NaN', () => {
  const text = JSON.stringify({ message: { id: 'A', role: 'assistant', usage: { input_tokens: 4 } } });
  assert.deepEqual(tokensFromTranscript(text), { thinking_tokens: 0, cache_creation: 0, input_total: 4 });
});

t('findTranscripts globs projects/*/<id>.jsonl without computing a slug, and returns every match', () => {
  const cfg = tmp();
  mkdirSync(path.join(cfg, 'projects', '-any-slug-at-all'), { recursive: true });
  mkdirSync(path.join(cfg, 'projects', 'other'), { recursive: true });
  const file = path.join(cfg, 'projects', '-any-slug-at-all', 'sid-1.jsonl');
  writeFileSync(file, '');
  assert.deepEqual(findTranscripts('sid-1', cfg), [file]);
  assert.deepEqual(findTranscripts('sid-2', cfg), []);
  assert.deepEqual(findTranscripts('sid-1', path.join(cfg, 'nope')), []);
  const second = path.join(cfg, 'projects', 'other', 'sid-1.jsonl');
  writeFileSync(second, '');
  assert.equal(findTranscripts('sid-1', cfg).length, 2);
});

t('an EMPTY CLAUDE_CONFIG_DIR means the default $HOME/.claude (|| not ??)', () => {
  const home = tmp();
  mkdirSync(path.join(home, '.claude', 'projects', 'p'), { recursive: true });
  const file = path.join(home, '.claude', 'projects', 'p', 'sid-e.jsonl');
  writeFileSync(file, '');
  const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  try {
    process.env.HOME = home;
    process.env.CLAUDE_CONFIG_DIR = '';
    assert.deepEqual(findTranscripts('sid-e', undefined), [file]);
    assert.deepEqual(findTranscripts('sid-e', ''), [file]);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

const apiErr = (extra = {}) =>
  JSON.stringify({
    type: 'assistant',
    isApiErrorMessage: true,
    message: { id: 'E', role: 'assistant', model: '<synthetic>', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens_details: { thinking_tokens: 0 } } },
    ...extra,
  });

t('API-error records are detected by the flag alone and by the synthetic model alone, and never count as usage', () => {
  const flagOnly = JSON.stringify({ isApiErrorMessage: true, message: { id: 'E', role: 'assistant', model: 'real', usage: usage(0, 0, 0, 0) } });
  const modelOnly = JSON.stringify({ message: { id: 'E', role: 'assistant', model: '<synthetic>', usage: usage(0, 0, 0, 0) } });
  assert.equal(hasApiError(flagOnly), true);
  assert.equal(hasApiError(modelOnly), true);
  assert.equal(hasApiError(apiErr()), true);
  assert.equal(hasApiError(msg('A', usage(1, 2, 3, 4))), false);
  assert.equal(tokensFromTranscript(flagOnly), null);
  assert.equal(tokensFromTranscript(modelOnly), null);
  // beside a real message the error record adds nothing
  assert.deepEqual(tokensFromTranscript(`${msg('A', usage(1, 2, 3, 4))}\n${apiErr()}`), { thinking_tokens: 4, cache_creation: 2, input_total: 6 });
});

t('buildRow joins arm and tokens; each exclusion has its own reason, never holdout', () => {
  const cfg = tmp();
  const state = tmp();
  mkdirSync(path.join(cfg, 'projects', 'p'), { recursive: true });
  mkdirSync(path.join(cfg, 'projects', 'q'), { recursive: true });
  const tr = (id, text) => writeFileSync(path.join(cfg, 'projects', 'p', `${id}.jsonl`), text);
  const base = { stateDir: state, configDir: cfg };
  const ctx = { ...base, plannedArm: 'treated', promptIndex: 0 };
  writeFileSync(path.join(state, 'ok.jsonl'), '{"arm":"holdout","steered":false}\n');
  tr('ok', `${msg('A', usage(1, 2, 3, 4))}\n`);
  assert.deepEqual(buildRow('ok', { ...base, plannedArm: 'holdout', promptIndex: 2 }), { row: { promptIndex: 2, arm: 'holdout', thinking_tokens: 4, cache_creation: 2, input_total: 6 } });
  tr('nolog', `${msg('A', usage(1, 2, 3, 4))}\n`);
  assert.deepEqual(buildRow('nolog', ctx), { reason: 'no_log' });
  writeFileSync(path.join(state, 'notr.jsonl'), '{"arm":"treated","steered":true}\n');
  assert.deepEqual(buildRow('notr', ctx), { reason: 'no_transcript' });
  writeFileSync(path.join(state, 'noarm.jsonl'), '{"x":1}\n');
  tr('noarm', `${msg('A', usage(1, 2, 3, 4))}\n`);
  assert.deepEqual(buildRow('noarm', ctx), { reason: 'no_log' });
  writeFileSync(path.join(state, 'amb.jsonl'), '{"arm":"treated","steered":true}\n');
  tr('amb', `${msg('A', usage(1, 2, 3, 4))}\n`);
  writeFileSync(path.join(cfg, 'projects', 'q', 'amb.jsonl'), `${msg('A', usage(9, 9, 9, 9))}\n`);
  assert.deepEqual(buildRow('amb', ctx), { reason: 'ambiguous_transcript' });
  writeFileSync(path.join(state, 'err.jsonl'), '{"arm":"treated","steered":true}\n');
  tr('err', `${apiErr()}\n`);
  assert.deepEqual(buildRow('err', ctx), { reason: 'api_error' });
  writeFileSync(path.join(state, 'mixed.jsonl'), '{"arm":"treated","steered":true}\n');
  tr('mixed', `${msg('A', usage(1, 2, 3, 4))}\n${apiErr()}\n`);
  assert.deepEqual(buildRow('mixed', ctx), { reason: 'api_error' });
  writeFileSync(path.join(state, 'empty.jsonl'), '{"arm":"treated","steered":true}\n');
  tr('empty', '');
  assert.deepEqual(buildRow('empty', ctx), { reason: 'no_transcript' });
});

// ---- R24 / I-1: the planned arm and the steering must match the decision log ----

function fixture() {
  const cfg = tmp();
  const state = tmp();
  mkdirSync(path.join(cfg, 'projects', 'p'), { recursive: true });
  const put = (id, log, transcript = `${msg('A', usage(1, 2, 3, 4))}\n`) => {
    if (log !== null) writeFileSync(path.join(state, `${id}.jsonl`), log);
    if (transcript !== null) writeFileSync(path.join(cfg, 'projects', 'p', `${id}.jsonl`), transcript);
  };
  return { put, ctx: (plannedArm, promptIndex = 0) => ({ stateDir: state, configDir: cfg, plannedArm, promptIndex }) };
}

t('decisionFromLog returns the arm and steered flag of the first line with a valid arm', () => {
  assert.deepEqual(decisionFromLog('{"arm":"treated","steered":true}\n'), { arm: 'treated', steered: true });
  assert.deepEqual(decisionFromLog('junk\n{"arm":"other"}\n{"arm":"holdout","steered":false}\n{"arm":"treated"}\n'), { arm: 'holdout', steered: false });
  assert.deepEqual(decisionFromLog('{"arm":"treated"}\n'), { arm: 'treated', steered: undefined });
  assert.equal(decisionFromLog(''), null);
});

t('a log arm that differs from the planned arm is excluded as arm_mismatch (both ways)', () => {
  const f = fixture();
  f.put('a', '{"arm":"treated","steered":true}\n');
  assert.deepEqual(buildRow('a', f.ctx('holdout')), { reason: 'arm_mismatch' });
  f.put('b', '{"arm":"holdout","steered":false}\n');
  assert.deepEqual(buildRow('b', f.ctx('treated')), { reason: 'arm_mismatch' });
  // the log is checked before the transcript
  f.put('c', '{"arm":"treated","steered":true}\n', null);
  assert.deepEqual(buildRow('c', f.ctx('holdout')), { reason: 'arm_mismatch' });
});

t('a treated run that was not steered is excluded as not_steered', () => {
  const f = fixture();
  for (const [id, log] of [['f', '{"arm":"treated","steered":false}\n'], ['m', '{"arm":"treated"}\n'], ['s', '{"arm":"treated","steered":"true"}\n']]) {
    f.put(id, log);
    assert.deepEqual(buildRow(id, f.ctx('treated')), { reason: 'not_steered' }, id);
  }
  f.put('ok', '{"arm":"treated","steered":true}\n');
  assert.equal(buildRow('ok', f.ctx('treated', 3)).row.promptIndex, 3);
});

t('a holdout run that was steered is excluded as steered_holdout', () => {
  const f = fixture();
  f.put('h', '{"arm":"holdout","steered":true}\n');
  assert.deepEqual(buildRow('h', f.ctx('holdout')), { reason: 'steered_holdout' });
  f.put('ok', '{"arm":"holdout","steered":false}\n');
  assert.equal(buildRow('ok', f.ctx('holdout')).row.arm, 'holdout');
});

t('a transcript whose usage never reports thinking_tokens is excluded as no_thinking_field', () => {
  const f = fixture();
  const noThinking = `${JSON.stringify({ message: { id: 'A', role: 'assistant', usage: { input_tokens: 4, output_tokens: 9 } } })}\n`;
  f.put('n', '{"arm":"treated","steered":true}\n', noThinking);
  assert.deepEqual(buildRow('n', f.ctx('treated')), { reason: 'no_thinking_field' });
  assert.equal(reportsThinkingTokens(noThinking), false);
  assert.equal(reportsThinkingTokens(`${msg('A', usage(1, 2, 3, 0))}\n`), true); // a reported 0 is a measurement
  assert.equal(reportsThinkingTokens(apiErr()), false); // an API-error record reports nothing
});

t('buildRow refuses a missing or unknown planned arm and a bad promptIndex', () => {
  const f = fixture();
  f.put('x', '{"arm":"treated","steered":true}\n');
  for (const plannedArm of [undefined, 'Treated', 'control', null]) assert.throws(() => buildRow('x', f.ctx(plannedArm)), TypeError);
  for (const promptIndex of [-1, 1.5, '0', null]) assert.throws(() => buildRow('x', f.ctx('treated', promptIndex)), TypeError);
});
