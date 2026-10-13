import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { extractFeatures } from '../../core/features.mjs';
import { buildTracePrompt, checkTracePrompt, traceFromTestOutput } from './r1-prompt.mjs';

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
// A prompt with frames and no f2p name in it, for the cases that must stay clean.
const FRAMES = "thread 't' panicked at src/lib.rs:3:1:\nboom\nstack backtrace:\n   0: f\n             at ./src/lib.rs:34:9\n";

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

t('buildTracePrompt ends with the default instruction and one newline', () => {
  const p = buildTracePrompt('trace text\n\n');
  assert.equal(p, 'trace text\n\nThis is the failing test output. Please fix it.\n');
});

t('buildTracePrompt takes another instruction', () => {
  assert.equal(buildTracePrompt('trace', 'Fix it.'), 'trace\n\nFix it.\n');
});

t('a clean prompt with frames is ok', () => {
  assert.deepEqual(checkTracePrompt(FRAMES, def()), { ok: true, reasons: [], f2pNamesShown: false });
});

t('a panic-only prompt has no trace and is not shallow', () => {
  const r = checkTracePrompt("thread 't' panicked at src/lib.rs:3:1:\nboom\n", def());
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
