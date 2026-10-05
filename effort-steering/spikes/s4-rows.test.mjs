// s4-rows.test.mjs — vectors for the log + transcript join. No model call, no spawn.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from '../core/testkit.mjs';
import { armFromLog, buildRow, findTranscript, tokensFromTranscript } from './s4-rows.mjs';

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

t('findTranscript globs projects/*/<id>.jsonl without computing a slug', () => {
  const cfg = tmp();
  mkdirSync(path.join(cfg, 'projects', '-any-slug-at-all'), { recursive: true });
  mkdirSync(path.join(cfg, 'projects', 'other'), { recursive: true });
  const file = path.join(cfg, 'projects', '-any-slug-at-all', 'sid-1.jsonl');
  writeFileSync(file, '');
  assert.equal(findTranscript('sid-1', cfg), file);
  assert.equal(findTranscript('sid-2', cfg), null);
  assert.equal(findTranscript('sid-1', path.join(cfg, 'nope')), null);
});

t('buildRow joins arm and tokens; a missing log or transcript gives null, never holdout', () => {
  const cfg = tmp();
  const state = tmp();
  mkdirSync(path.join(cfg, 'projects', 'p'), { recursive: true });
  writeFileSync(path.join(state, 'ok.jsonl'), '{"arm":"holdout"}\n');
  writeFileSync(path.join(cfg, 'projects', 'p', 'ok.jsonl'), `${msg('A', usage(1, 2, 3, 4))}\n`);
  assert.deepEqual(buildRow('ok', { stateDir: state, configDir: cfg }), { arm: 'holdout', thinking_tokens: 4, cache_creation: 2, input_total: 6 });
  // transcript but no log
  writeFileSync(path.join(cfg, 'projects', 'p', 'nolog.jsonl'), `${msg('A', usage(1, 2, 3, 4))}\n`);
  assert.equal(buildRow('nolog', { stateDir: state, configDir: cfg }), null);
  // log but no transcript
  writeFileSync(path.join(state, 'notr.jsonl'), '{"arm":"treated"}\n');
  assert.equal(buildRow('notr', { stateDir: state, configDir: cfg }), null);
  // log without a valid arm
  writeFileSync(path.join(state, 'noarm.jsonl'), '{"x":1}\n');
  writeFileSync(path.join(cfg, 'projects', 'p', 'noarm.jsonl'), `${msg('A', usage(1, 2, 3, 4))}\n`);
  assert.equal(buildRow('noarm', { stateDir: state, configDir: cfg }), null);
});
