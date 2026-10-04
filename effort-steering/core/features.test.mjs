import assert from 'node:assert/strict';
import { t } from './testkit.mjs';
import { extractFeatures } from './features.mjs';

t('counts', () => {
  const f = extractFeatures('fix the bug');
  assert.equal(f.chars, 11);
  assert.equal(f.words, 3);
  for (const s of ['', '   ']) {
    assert.deepEqual(extractFeatures(s), {
      chars: 0,
      words: 0,
      isQuestion: false,
      hasStackTrace: false,
      startsWithSlash: false,
      explicitDeep: false,
    });
  }
  assert.deepEqual(extractFeatures(undefined), extractFeatures(''));
  assert.deepEqual(extractFeatures(42), extractFeatures(''));
});

t('isQuestion', () => {
  assert.equal(extractFeatures('why does this fail?').isQuestion, true);
  assert.equal(extractFeatures('fix it').isQuestion, false);
});

t('hasStackTrace', () => {
  const py = 'oops\nTraceback (most recent call last):\n  File "a.py", line 1, in <module>\nValueError: x';
  assert.equal(extractFeatures(py).hasStackTrace, true);
  assert.equal(extractFeatures('Error: boom\n    at run (/a/b.js:1:2)\n').hasStackTrace, true);
  assert.equal(extractFeatures('meet me at noon').hasStackTrace, false);
  // Leading whitespace plus `at`, but no :line:col, must not look like a frame.
  assert.equal(extractFeatures('  at the office').hasStackTrace, false);
  assert.equal(extractFeatures('    at run (foo)').hasStackTrace, false);
  // :line:col present, but `at` does not start a line.
  assert.equal(extractFeatures('look at foo.js:1:2').hasStackTrace, false);
  // :line:col shape, `at` at line start, but not indented: a clock time, not a frame.
  assert.equal(extractFeatures('at 10:30:45 the deploy failed').hasStackTrace, false);
  assert.equal(extractFeatures('done\nat 10:30:45 it broke').hasStackTrace, false);
  // Indented `at` without :line:col on a later line is still prose.
  assert.equal(extractFeatures('boom\n  at the office').hasStackTrace, false);
});

t('startsWithSlash', () => {
  assert.equal(extractFeatures('/legible:explain').startsWithSlash, true);
  assert.equal(extractFeatures('see /etc/hosts').startsWithSlash, false);
  assert.equal(extractFeatures('/etc/hosts is wrong').startsWithSlash, false);
});

t('explicitDeep', () => {
  assert.equal(extractFeatures('ultrathink about this').explicitDeep, true);
  assert.equal(extractFeatures('ULTRATHINK').explicitDeep, true);
  assert.equal(extractFeatures('ultrathinking').explicitDeep, false);
});

t('linear time', () => {
  for (const s of ['a'.repeat(1024 * 1024), '  at '.repeat(100000)]) {
    const start = Date.now();
    extractFeatures(s);
    const ms = Date.now() - start;
    assert.ok(ms < 2000, `took ${ms} ms`);
  }
});
