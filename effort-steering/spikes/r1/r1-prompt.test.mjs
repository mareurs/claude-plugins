import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { extractFeatures } from '../../core/features.mjs';
import { TEST_COMMAND_SENTENCE, buildTracePrompt, checkTracePrompt, traceFromTestOutput } from './r1-prompt.mjs';

const OUTPUT = [
  'running 1 test',
  'test x::y ... FAILED',
  '',
  'failures:',
  '',
  '---- x::y stdout ----',
  "thread 'x::y' panicked at src/lib.rs:34:9:",
  'assertion `left == right` failed',
  '  left: 1',
  ' right: 2',
  'stack backtrace:',
  '   0: rust_begin_unwind',
  '             at /rustc/abc/library/std/src/panicking.rs:665:5',
  '   1: x::y',
  '             at ./src/lib.rs:34:9',
  '',
  'failures:',
  '    x::y',
  '',
  'test result: FAILED. 0 passed; 1 failed',
  '',
].join('\n');

const def = (over = {}) => ({ scrub: { terms: ['secret_term'] }, f2p: { names: ['x::y'] }, ...over });
const CLEAN = buildTracePrompt(traceFromTestOutput(OUTPUT));
// A prompt with frames and no f2p name in it, for the cases that must stay clean. It ends with the operator's build-hint sentence.
const withSentence = (p) => `${p}\n${TEST_COMMAND_SENTENCE}\n`;
const FRAMES_ONLY = "thread 't' panicked at src/lib.rs:3:1:\nboom\nstack backtrace:\n   0: f\n             at ./src/lib.rs:34:9\n";
const FRAMES = withSentence(FRAMES_ONLY);

t('traceFromTestOutput keeps the failure block and its frames, and drops the framing', () => {
  const trace = traceFromTestOutput(OUTPUT);
  assert.ok(trace.startsWith('---- x::y stdout ----'));
  assert.ok(trace.includes('at ./src/lib.rs:34:9'));
  assert.ok(!trace.includes('running 1 test'));
  assert.ok(!trace.includes('test result:'));
  assert.ok(!/^failures:$/m.test(trace));
});

t('traceFromTestOutput returns null when there is no failure header', () => {
  assert.equal(traceFromTestOutput('running 1 test\ntest x ... ok\n'), null);
});

t('traceFromTestOutput cuts a long block at a line boundary and keeps frames', () => {
  const frames = ['stack backtrace:', '   0: f', '             at ./src/lib.rs:1:1'];
  const filler = Array.from({ length: 5000 }, (_, i) => `line ${i} of a very long failure message`);
  const out = ['---- big stdout ----', ...frames, ...filler, ''].join('\n');
  const trace = traceFromTestOutput(out);
  assert.ok(trace.length <= 8000);
  assert.ok(trace.split('\n').every((l) => l === '' || out.split('\n').includes(l)), 'every kept line is a whole line of the output');
  assert.equal(extractFeatures(trace).hasStackTrace, true);
});

t('traceFromTestOutput honours maxChars', () => {
  const trace = traceFromTestOutput(OUTPUT, { maxChars: 120 });
  assert.ok(trace.length <= 120);
});

t('buildTracePrompt ends with the default instruction, the build-hint sentence and one newline', () => {
  const p = buildTracePrompt('trace text\n\n');
  assert.equal(p, `trace text\n\nThis is the failing test output. Please fix it. ${TEST_COMMAND_SENTENCE}\n`);
});

t('buildTracePrompt takes another instruction and keeps the sentence', () => {
  assert.equal(buildTracePrompt('trace', 'Fix it.'), `trace\n\nFix it. ${TEST_COMMAND_SENTENCE}\n`);
});

t('TEST_COMMAND_SENTENCE is the operator\'s wording: one sentence, nothing about the bug', () => {
  assert.equal(TEST_COMMAND_SENTENCE, 'Run the tests with `cargo test`; if the build fails to link ONNX Runtime, add `--no-default-features`.');
});

t('every built prompt holds the sentence once and ends with it, whatever the trace', () => {
  for (const trace of ['a', FRAMES_ONLY, 'x\n'.repeat(50)]) {
    const p = buildTracePrompt(trace);
    assert.equal(p.split(TEST_COMMAND_SENTENCE).length - 1, 1);
    assert.ok(p.endsWith(` ${TEST_COMMAND_SENTENCE}\n`));
  }
});

t('the suffix after the trace is the same text for every task', () => {
  const suffix = (p) => p.slice(p.lastIndexOf('\n\n'));
  assert.equal(suffix(buildTracePrompt('trace one')), suffix(buildTracePrompt('another\ntrace')));
});

t('a clean prompt with frames is ok', () => {
  assert.deepEqual(checkTracePrompt(FRAMES, def()), { ok: true, reasons: [], f2pNamesShown: false });
});

t('a panic-only prompt has no trace and is not shallow', () => {
  const r = checkTracePrompt(withSentence("thread 't' panicked at src/lib.rs:3:1:\nboom\n"), def());
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['no_stack_trace', 'not_shallow']);
});

t('ultrathink is a reason', () => {
  const r = checkTracePrompt(`ultrathink\n${FRAMES}`, def());
  assert.deepEqual(r.reasons, ['ultrathink']);
});

t('a scrub term is a leak, whatever its case', () => {
  const r = checkTracePrompt(`${FRAMES}Secret_Term here\n`, def());
  assert.deepEqual(r.reasons, ['leak:secret_term']);
});

t('a NUL byte is refused', () => {
  const r = checkTracePrompt(`${FRAMES}\0`, def());
  assert.deepEqual(r.reasons, ['not_utf8_or_nul']);
});

t('an f2p name in the prompt is information, not a reason', () => {
  const r = checkTracePrompt(CLEAN, def());
  assert.equal(r.ok, true);
  assert.equal(r.f2pNamesShown, true);
});

t('a def without scrub terms is fine', () => {
  assert.equal(checkTracePrompt(FRAMES, { f2p: { names: [] } }).ok, true);
});

t('a prompt without the build-hint sentence is refused', () => {
  const r = checkTracePrompt(FRAMES_ONLY, def());
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['test_command_sentence']);
});

t('a prompt that holds the sentence twice is refused', () => {
  const r = checkTracePrompt(`${FRAMES}${TEST_COMMAND_SENTENCE}\n`, def());
  assert.deepEqual(r.reasons, ['test_command_sentence']);
});

t('a trace that merely mentions the flag does not count as the sentence', () => {
  const r = checkTracePrompt(`${FRAMES_ONLY}run it with --no-default-features\n`, def());
  assert.deepEqual(r.reasons, ['test_command_sentence']);
});

t('a prompt built by buildTracePrompt from a real-shaped trace passes the checks', () => {
  assert.equal(checkTracePrompt(CLEAN, def()).ok, true);
});
