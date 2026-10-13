import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { parseFlags, parseRows } from './r1.mjs';

t('parseRows reads JSON lines, skips blank lines, and keeps non-row objects for the analysis to ignore', () => {
  const text = '{"taskId":"a","arm":"C"}\n\n{"type":"stopped","reason":"signal"}\n';
  assert.deepEqual(parseRows(text, 'f'), [{ taskId: 'a', arm: 'C' }, { type: 'stopped', reason: 'signal' }]);
});

t('parseRows names the file and line of a bad line', () => {
  assert.throws(() => parseRows('{"a":1}\nnot json\n', 'rows.jsonl'), /rows\.jsonl line 2/);
});

t('parseFlags reads strings, numbers and repeated list flags', () => {
  const f = parseFlags(['--a', 'x', '--n', '4', '--rows', 'r1', '--rows', 'r2'], { a: 'string', n: 'number', rows: 'list' });
  assert.deepEqual(f, { a: 'x', n: 4, rows: ['r1', 'r2'] });
});

t('parseFlags refuses an unknown flag, a missing value and a bad number', () => {
  assert.throws(() => parseFlags(['--zzz', '1'], { a: 'string' }), /unknown argument/);
  assert.throws(() => parseFlags(['--a'], { a: 'string' }), /needs a value/);
  assert.throws(() => parseFlags(['--n', '0'], { n: 'number' }), /above 0/);
});
