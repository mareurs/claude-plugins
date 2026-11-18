import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { compileRules, decide } from '../../core/decide.mjs';
import { R1_RULE, R1_RULES } from './r1-rule.mjs';

const compiled = compileRules(R1_RULES);
const run = (prompt, signals, rules = compiled) => decide({ prompt, signals }, rules);
const SHALLOW = { level: 'shallow', confidence: 'high', reasons: ['r1-stack-trace-shallow'] };

const PY = 'oops\nTraceback (most recent call last):\n  File "a.py", line 1, in <module>\nValueError: x\n';
const NODE = 'Error: x\n    at run (/a/b.js:1:2)\n';
const RUST = "thread 't' panicked at src/lib.rs:3:1:\nboom\nstack backtrace:\n   0: f\n             at ./src/lib.rs:34:9\n";

t('R1 compiles with the slow-regex probe on and skips nothing', () => {
  assert.deepEqual(compiled.skipped, []);
  assert.equal(compiled.rules.length, 1);
});

t('a Python traceback gives shallow/high with the rule id', () => {
  assert.deepEqual(run(PY), SHALLOW);
});

t('a Node frame gives shallow/high with the rule id', () => {
  assert.deepEqual(run(NODE), SHALLOW);
});

t('a Rust backtrace gives shallow/high with the rule id', () => {
  assert.deepEqual(run(RUST), SHALLOW);
});

t('a bare Rust panic message does not fire', () => {
  const bare = "thread 't' panicked at src/lib.rs:3:1:\nassertion failed: left == right\n";
  assert.deepEqual(run(bare), { level: 'default', confidence: 'low', reasons: ['no_rule'] });
});

t('ultrathink with a trace is still deep', () => {
  assert.deepEqual(run(`ultrathink\n${PY}`).reasons, ['user_override']);
  assert.equal(run(`ultrathink\n${PY}`).level, 'deep');
});

t('a failed previous turn turns R1 off', () => {
  const d = run(PY, { prevTurnFailed: true });
  assert.equal(d.level, 'default');
  assert.equal(d.reasons[0], 'guard_shallow');
});

t('R1 needs confidence high', () => {
  const medium = compileRules({ version: 1, rules: [{ ...R1_RULE, confidence: 'medium' }] });
  const d = run(PY, undefined, medium);
  assert.equal(d.level, 'default');
  assert.equal(d.reasons[0], 'guard_shallow');
});
