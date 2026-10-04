import assert from 'node:assert/strict';
import { t } from './testkit.mjs';
import { POLICY_VERSION, compileRules, decide } from './decide.mjs';

// The shipped rules file is empty on purpose, so every rule below lives in the test.
const rule = (id, level, confidence, when) => ({ id, level, confidence, reason: `why ${id}`, when });
const compile = (...rules) => compileRules({ version: 1, rules });
const run = (prompt, rules, signals) => decide({ prompt, signals }, rules);
// True only when rule `r1` (a deep/high rule with the given `when`) matched.
const fires = (when, prompt, signals) => {
  const d = run(prompt, compile(rule('r1', 'deep', 'high', when)), signals);
  return d.level === 'deep' && d.reasons.length === 1 && d.reasons[0] === 'r1';
};
const M = { matchesAny: ['marker'] };

t('POLICY_VERSION and version passthrough', () => {
  assert.equal(POLICY_VERSION, 1);
  assert.equal(compileRules({ version: 7, rules: [] }).version, 7);
});

t('guards', () => {
  const sh = (c) => compile(rule('s', 'shallow', c, M));
  const dp = (c) => compile(rule('d', 'deep', c, M));
  assert.deepEqual(run('marker', sh('high')), { level: 'shallow', confidence: 'high', reasons: ['s'] });
  assert.deepEqual(run('marker', sh('high'), { prevTurnFailed: false }), { level: 'shallow', confidence: 'high', reasons: ['s'] });
  assert.deepEqual(run('marker', sh('high'), { prevTurnFailed: true }), { level: 'default', confidence: 'low', reasons: ['guard_shallow', 's'] });
  assert.deepEqual(run('marker', sh('medium')), { level: 'default', confidence: 'low', reasons: ['guard_shallow', 's'] });
  assert.deepEqual(run('marker', sh('low')), { level: 'default', confidence: 'low', reasons: ['guard_shallow', 's'] });
  assert.deepEqual(run('marker', dp('high')), { level: 'deep', confidence: 'high', reasons: ['d'] });
  assert.deepEqual(run('marker', dp('medium')), { level: 'deep', confidence: 'medium', reasons: ['d'] });
  assert.deepEqual(run('marker', dp('low')), { level: 'default', confidence: 'low', reasons: ['low_confidence', 'd'] });
  // A failed previous turn does not block deep.
  assert.deepEqual(run('marker', dp('medium'), { prevTurnFailed: true }), { level: 'deep', confidence: 'medium', reasons: ['d'] });
});

t('no rule matched', () => {
  assert.deepEqual(run('nothing here', compile(rule('s', 'shallow', 'high', M))), { level: 'default', confidence: 'low', reasons: ['no_rule'] });
  assert.deepEqual(run('marker', compile()), { level: 'default', confidence: 'low', reasons: ['no_rule'] });
  assert.deepEqual(run('marker', compileRules({ version: 1, rules: [] })), { level: 'default', confidence: 'low', reasons: ['no_rule'] });
});

t('precedence', () => {
  const hiShallow = rule('hs', 'shallow', 'high', M);
  const medDeep = rule('md', 'deep', 'medium', M);
  const hiDeep = rule('hd', 'deep', 'high', M);
  const medShallow = rule('ms', 'shallow', 'medium', M);
  const loDeep = rule('ld', 'deep', 'low', M);
  // A high shallow rule beats a medium deep rule, whatever the file order.
  const expectShallow = { level: 'shallow', confidence: 'high', reasons: ['hs'] };
  assert.deepEqual(run('marker', compile(hiShallow, medDeep)), expectShallow);
  assert.deepEqual(run('marker', compile(medDeep, hiShallow)), expectShallow);
  // A high deep rule beats a medium shallow rule and a low deep rule, in both orders.
  const expectDeep = { level: 'deep', confidence: 'high', reasons: ['hd'] };
  assert.deepEqual(run('marker', compile(medShallow, hiDeep, loDeep)), expectDeep);
  assert.deepEqual(run('marker', compile(loDeep, hiDeep, medShallow)), expectDeep);
  // A medium deep rule beats a low shallow rule.
  assert.deepEqual(run('marker', compile(rule('ls', 'shallow', 'low', M), medDeep)), { level: 'deep', confidence: 'medium', reasons: ['md'] });
  // A high shallow rule that the guard blocks is not replaced by the medium deep rule below it.
  assert.deepEqual(run('marker', compile(hiShallow, medDeep), { prevTurnFailed: true }), { level: 'default', confidence: 'low', reasons: ['guard_shallow', 'hs'] });
  // A tie between shallow and deep at the top class gives default.
  assert.deepEqual(run('marker', compile(hiShallow, hiDeep)), { level: 'default', confidence: 'low', reasons: ['tie_shallow_deep', 'hs', 'hd'] });
  assert.deepEqual(run('marker', compile(hiDeep, hiShallow)), { level: 'default', confidence: 'low', reasons: ['tie_shallow_deep', 'hd', 'hs'] });
  // The tie also holds at medium and at low.
  assert.deepEqual(run('marker', compile(medShallow, medDeep)), { level: 'default', confidence: 'low', reasons: ['tie_shallow_deep', 'ms', 'md'] });
  assert.deepEqual(run('marker', compile(rule('ls', 'shallow', 'low', M), loDeep)), { level: 'default', confidence: 'low', reasons: ['tie_shallow_deep', 'ls', 'ld'] });
  // Only the top class takes part in a tie: lower-class rules are not listed.
  assert.deepEqual(run('marker', compile(hiShallow, hiDeep, medDeep, medShallow)), { level: 'default', confidence: 'low', reasons: ['tie_shallow_deep', 'hs', 'hd'] });
  // A tie at a lower class does not matter when a higher class has a single level.
  assert.deepEqual(run('marker', compile(hiDeep, medShallow, medDeep)), expectDeep);
  // The reasons list only the rules at the winning class and level.
  assert.deepEqual(
    run('marker', compile(hiShallow, rule('hs2', 'shallow', 'high', M), medShallow, medDeep)),
    { level: 'shallow', confidence: 'high', reasons: ['hs', 'hs2'] },
  );
  assert.deepEqual(
    run('marker', compile(hiDeep, rule('hd2', 'deep', 'high', M), rule('ms', 'shallow', 'high', { matchesAny: ['other'] }))),
    { level: 'deep', confidence: 'high', reasons: ['hd', 'hd2'] },
  );
  // Rules that do not match take no part.
  assert.deepEqual(run('marker', compile(rule('x', 'deep', 'high', { matchesAny: ['other'] }), medShallow)), { level: 'default', confidence: 'low', reasons: ['guard_shallow', 'ms'] });
  // 'ultrathink' beats a matching high shallow rule, and needs no rule at all.
  assert.deepEqual(run('marker ultrathink', compile(hiShallow)), { level: 'deep', confidence: 'high', reasons: ['user_override'] });
  assert.deepEqual(run('ultrathink', compile()), { level: 'deep', confidence: 'high', reasons: ['user_override'] });
  assert.deepEqual(run('marker ultrathink', compile(hiShallow, hiDeep)), { level: 'deep', confidence: 'high', reasons: ['user_override'] });
  assert.deepEqual(run('ULTRATHINK marker', compile(hiShallow), { prevTurnFailed: true }), { level: 'deep', confidence: 'high', reasons: ['user_override'] });
});

t('conditions', () => {
  // minChars counts trimmed characters and is inclusive.
  assert.equal(fires({ minChars: 5 }, 'abcd'), false);
  assert.equal(fires({ minChars: 5 }, 'abcde'), true);
  assert.equal(fires({ minChars: 5 }, '  abcd  '), false);
  // maxChars is inclusive.
  assert.equal(fires({ maxChars: 5 }, 'abcde'), true);
  assert.equal(fires({ maxChars: 5 }, 'abcdef'), false);
  assert.equal(fires({ maxChars: 5 }, '  abcde  '), true);
  // isQuestion, both polarities.
  assert.equal(fires({ isQuestion: true }, 'why?'), true);
  assert.equal(fires({ isQuestion: true }, 'why'), false);
  assert.equal(fires({ isQuestion: false }, 'why'), true);
  assert.equal(fires({ isQuestion: false }, 'why?'), false);
  // hasStackTrace, both polarities.
  const trace = 'oops\nTraceback (most recent call last):\n  File "a.py", line 1';
  assert.equal(fires({ hasStackTrace: true }, trace), true);
  assert.equal(fires({ hasStackTrace: true }, 'oops'), false);
  assert.equal(fires({ hasStackTrace: false }, 'oops'), true);
  assert.equal(fires({ hasStackTrace: false }, trace), false);
  // startsWithSlash, both polarities.
  assert.equal(fires({ startsWithSlash: true }, '/foo bar'), true);
  assert.equal(fires({ startsWithSlash: true }, 'foo bar'), false);
  assert.equal(fires({ startsWithSlash: false }, 'foo bar'), true);
  assert.equal(fires({ startsWithSlash: false }, '/foo bar'), false);
  // matchesAny: any one pattern is enough, and the match is case-insensitive.
  assert.equal(fires({ matchesAny: ['foo', 'bar'] }, 'xx bar'), true);
  assert.equal(fires({ matchesAny: ['foo', 'bar'] }, 'xx foo'), true);
  assert.equal(fires({ matchesAny: ['foo', 'bar'] }, 'baz'), false);
  assert.equal(fires({ matchesAny: ['foo'] }, 'XX FOO'), true);
  assert.equal(fires({ matchesAny: ['^foo$'] }, 'a foo b'), false);
  // matchesNone: one hit in any pattern blocks the rule. It is case-insensitive too.
  assert.equal(fires({ matchesNone: ['foo', 'bar'] }, 'baz'), true);
  assert.equal(fires({ matchesNone: ['foo', 'bar'] }, 'a foo'), false);
  assert.equal(fires({ matchesNone: ['foo', 'bar'] }, 'a bar'), false);
  assert.equal(fires({ matchesNone: ['foo'] }, 'a FOO'), false);
  // prevTurnFailed, both polarities, and the default.
  assert.equal(fires({ prevTurnFailed: true }, 'x', { prevTurnFailed: true }), true);
  assert.equal(fires({ prevTurnFailed: true }, 'x', { prevTurnFailed: false }), false);
  assert.equal(fires({ prevTurnFailed: true }, 'x', {}), false);
  assert.equal(fires({ prevTurnFailed: true }, 'x'), false);
  assert.equal(fires({ prevTurnFailed: false }, 'x', { prevTurnFailed: false }), true);
  assert.equal(fires({ prevTurnFailed: false }, 'x'), true);
  assert.equal(fires({ prevTurnFailed: false }, 'x', { prevTurnFailed: true }), false);
  // planMode, both polarities, and the default.
  assert.equal(fires({ planMode: true }, 'x', { planMode: true }), true);
  assert.equal(fires({ planMode: true }, 'x', { planMode: false }), false);
  assert.equal(fires({ planMode: true }, 'x'), false);
  assert.equal(fires({ planMode: false }, 'x', { planMode: false }), true);
  assert.equal(fires({ planMode: false }, 'x'), true);
  assert.equal(fires({ planMode: false }, 'x', { planMode: true }), false);
  // minRetries: 2 fails at 1, passes at 2 and above, and the default count is 0.
  assert.equal(fires({ minRetries: 2 }, 'x', { retryCount: 1 }), false);
  assert.equal(fires({ minRetries: 2 }, 'x', { retryCount: 2 }), true);
  assert.equal(fires({ minRetries: 2 }, 'x', { retryCount: 3 }), true);
  assert.equal(fires({ minRetries: 1 }, 'x', {}), false);
  assert.equal(fires({ minRetries: 1 }, 'x'), false);
  assert.equal(fires({ minRetries: 1 }, 'x', { retryCount: 'many' }), false);
  // A numeric string is not a count.
  assert.equal(fires({ minRetries: 2 }, 'x', { retryCount: '3' }), false);
});

t('conditions are ANDed', () => {
  const all = {
    minChars: 5,
    maxChars: 50,
    isQuestion: true,
    hasStackTrace: false,
    startsWithSlash: false,
    matchesAny: ['foo'],
    matchesNone: ['bad'],
    prevTurnFailed: true,
    minRetries: 1,
    planMode: true,
  };
  const sig = { prevTurnFailed: true, retryCount: 1, planMode: true };
  const base = 'foo works fine?';
  assert.equal(fires(all, base, sig), true, 'baseline must match');
  const variants = {
    minChars: ['foo?', sig],
    maxChars: ['foo works fine? ' + 'x'.repeat(40) + '?', sig],
    isQuestion: ['foo works fine.', sig],
    hasStackTrace: ['foo?\nTraceback (most recent call last):?', sig],
    startsWithSlash: ['/foo works fine?', sig],
    matchesAny: ['bar works fine?', sig],
    matchesNone: ['foo bad fine?', sig],
    prevTurnFailed: [base, { ...sig, prevTurnFailed: false }],
    minRetries: [base, { ...sig, retryCount: 0 }],
    planMode: [base, { ...sig, planMode: false }],
  };
  for (const [key, [prompt, signals]] of Object.entries(variants)) {
    assert.equal(fires(all, prompt, signals), false, `flipping only ${key} must stop the match`);
    // The flipped input must satisfy every other key, or the case proves nothing.
    const others = { ...all };
    delete others[key];
    assert.equal(fires(others, prompt, signals), true, `${key} variant must satisfy the other keys`);
  }
});

t('regex sees only the first 20000 characters', () => {
  const pad = (n) => 'x'.repeat(n);
  assert.equal(fires({ matchesAny: ['needle'] }, pad(19994) + 'needle'), true);
  assert.equal(fires({ matchesAny: ['needle'] }, pad(20000) + 'needle'), false);
  // A forbidden pattern past the cut does not block a matchesNone rule.
  assert.equal(fires({ matchesNone: ['needle'] }, pad(20000) + 'needle'), true);
  assert.equal(fires({ matchesNone: ['needle'] }, pad(19994) + 'needle'), false);
  // The cut is exact: index 19999 is seen, index 20000 is not.
  assert.equal(fires({ matchesAny: ['Z'] }, pad(19999) + 'Z'), true);
  assert.equal(fires({ matchesAny: ['Z'] }, pad(20000) + 'Z'), false);
});

t('fail open', () => {
  const good = rule('good', 'deep', 'high', M);
  const compiled = compile(
    rule('badre', 'deep', 'high', { matchesAny: ['(unclosed'] }),
    rule('badnone', 'deep', 'high', { matchesNone: ['['] }),
    good,
  );
  assert.deepEqual(compiled.skipped, [
    { id: 'badre', error: 'invalid_regex' },
    { id: 'badnone', error: 'invalid_regex' },
  ]);
  assert.equal(compiled.rules.length, 1);
  assert.deepEqual(run('marker', compiled), { level: 'deep', confidence: 'high', reasons: ['good'] });

  const skip = (r) => compile(r, good);
  const skipped = (r) => skip(r).skipped;
  assert.deepEqual(skipped(rule('e', 'deep', 'high', {})), [{ id: 'e', error: 'empty_when' }]);
  assert.deepEqual(skipped(rule('lv', 'default', 'high', M)), [{ id: 'lv', error: 'invalid_level' }]);
  assert.deepEqual(skipped(rule('lv2', 'medium', 'high', M)), [{ id: 'lv2', error: 'invalid_level' }]);
  assert.deepEqual(skipped(rule('cf', 'deep', 'certain', M)), [{ id: 'cf', error: 'invalid_confidence' }]);
  assert.deepEqual(skipped(rule('cf2', 'deep', undefined, M)), [{ id: 'cf2', error: 'invalid_confidence' }]);
  assert.deepEqual(skipped(rule('uk', 'deep', 'high', { minChars: 1, bogus: true })), [{ id: 'uk', error: 'unknown_when_key' }]);
  assert.deepEqual(skipped(rule('nw', 'deep', 'high', 'marker')), [{ id: 'nw', error: 'invalid_when' }]);
  assert.deepEqual(skipped(rule('nw2', 'deep', 'high', ['marker'])), [{ id: 'nw2', error: 'invalid_when' }]);
  assert.deepEqual(skipped(rule('nw3', 'deep', 'high', undefined)), [{ id: 'nw3', error: 'invalid_when' }]);
  for (const [key, bad] of [
    ['minChars', '5'], ['maxChars', NaN], ['minRetries', null], ['isQuestion', 'yes'], ['hasStackTrace', 1],
    ['startsWithSlash', 0], ['prevTurnFailed', 'true'], ['planMode', {}], ['matchesAny', 'foo'], ['matchesAny', []],
    ['matchesAny', [1]], ['matchesNone', 'foo'], ['matchesNone', []], ['matchesNone', [null]],
  ]) {
    assert.deepEqual(skipped(rule('iv', 'deep', 'high', { [key]: bad })), [{ id: 'iv', error: 'invalid_when_value' }], `${key}=${JSON.stringify(bad)}`);
  }
  // A skipped rule never fires, and the good rule next to it still does.
  for (const bad of [rule('e', 'deep', 'high', {}), rule('lv', 'default', 'high', M), rule('cf', 'deep', 'certain', M)]) {
    assert.deepEqual(run('marker', skip(bad)), { level: 'deep', confidence: 'high', reasons: ['good'] });
  }
  // Entries that are not rules, and ids that are not strings.
  const junk = compileRules({ version: 1, rules: [null, 42, 'x', [], rule('ok', 'deep', 'high', M), { ...good, id: 7 }, { ...good, id: undefined }] });
  assert.deepEqual(junk.skipped, [
    { id: '#0', error: 'invalid_rule' },
    { id: '#1', error: 'invalid_rule' },
    { id: '#2', error: 'invalid_rule' },
    { id: '#3', error: 'invalid_rule' },
    { id: '#5', error: 'invalid_id' },
    { id: '#6', error: 'invalid_id' },
  ]);
  assert.deepEqual(run('marker', junk), { level: 'deep', confidence: 'high', reasons: ['ok'] });
  // A rule whose fields throw on access is skipped; its neighbours survive.
  const boom = { id: 'boom', confidence: 'high', when: M };
  Object.defineProperty(boom, 'level', { get() { throw new Error('nope'); } });
  const withBoom = compileRules({ version: 1, rules: [boom, good] });
  assert.deepEqual(withBoom.skipped, [{ id: 'boom', error: 'invalid_rule' }]);
  assert.deepEqual(run('marker', withBoom), { level: 'deep', confidence: 'high', reasons: ['good'] });
});

t('compileRules and decide never throw', () => {
  const throwing = {};
  Object.defineProperty(throwing, 'rules', { get() { throw new Error('nope'); } });
  const throwingVersion = { rules: [] };
  Object.defineProperty(throwingVersion, 'version', { get() { throw new Error('nope'); } });
  for (const raw of [undefined, null, 42, 'x', true, [], {}, { rules: 'x' }, { rules: {} }, { version: 'x', rules: [] }, throwing, throwingVersion]) {
    const c = compileRules(raw);
    assert.equal(typeof c.version, 'number', JSON.stringify(raw));
    assert.ok(Array.isArray(c.rules) && c.rules.length === 0);
    assert.ok(Array.isArray(c.skipped));
    assert.deepEqual(decide({ prompt: 'marker' }, c), { level: 'default', confidence: 'low', reasons: ['no_rule'] });
  }
  const c = compile(rule('s', 'shallow', 'high', M));
  const dflt = { level: 'default', confidence: 'low' };
  for (const prompt of [undefined, null, 42, '', '   ', {}, [], 'x'.repeat(10)]) {
    const d = decide({ prompt }, c);
    assert.equal(d.level, dflt.level, String(prompt));
    assert.equal(d.confidence, dflt.confidence);
    assert.deepEqual(d.reasons, ['no_rule']);
  }
  // A garbled ctx or garbled rules never throw and give default.
  const evilCtx = {};
  Object.defineProperty(evilCtx, 'prompt', { get() { throw new Error('nope'); } });
  const evilSignals = { prompt: 'marker' };
  Object.defineProperty(evilSignals, 'signals', { get() { throw new Error('nope'); } });
  // The fail-open guarantee: an error inside decide gives exactly default, low, ['internal_error'].
  const failOpen = { level: 'default', confidence: 'low', reasons: ['internal_error'] };
  assert.deepEqual(decide(evilCtx, c), failOpen);
  assert.deepEqual(decide(evilSignals, c), failOpen);
  for (const ctx of [undefined, null, 42, 'x', {}, evilCtx, evilSignals, { prompt: 'marker', signals: null }, { prompt: 'marker', signals: 5 }]) {
    const d = decide(ctx, c);
    assert.equal(d.level === 'default' || d.level === 'shallow', true);
    assert.ok(Array.isArray(d.reasons) && d.reasons.length > 0);
  }
  assert.equal(decide({ prompt: 'marker', signals: null }, c).level, 'shallow');
  for (const rules of [undefined, null, 42, {}, { rules: 'x' }, { rules: [null, 1] }]) {
    assert.deepEqual(decide({ prompt: 'marker' }, rules), { level: 'default', confidence: 'low', reasons: ['no_rule'] });
  }
  // A garbled prompt value gives the features of '' (a rule on zero chars still sees it).
  assert.deepEqual(decide({ prompt: 42 }, compile(rule('z', 'deep', 'high', { maxChars: 0 }))), { level: 'deep', confidence: 'high', reasons: ['z'] });
});

t('slow regex', () => {
  const compiled = compile(
    rule('slow', 'deep', 'high', { matchesAny: ['(a+)+$'] }),
    rule('slow2', 'deep', 'high', { matchesNone: ['(a+)+$'] }),
    rule('fast', 'deep', 'high', { matchesAny: ['foo|bar'] }),
  );
  assert.deepEqual(compiled.skipped, [
    { id: 'slow', error: 'slow_regex' },
    { id: 'slow2', error: 'slow_regex' },
  ]);
  assert.deepEqual(run('xx foo', compiled), { level: 'deep', confidence: 'high', reasons: ['fast'] });
  // Once compiled, nothing in the decision path may hang on the skipped pattern.
  const start = Date.now();
  run('a'.repeat(40) + '!', compiled);
  assert.ok(Date.now() - start < 2000);
});

t('long prompts: features and the override see the whole prompt', () => {
  const hiShallow = rule('hs', 'shallow', 'high', M);
  // A pasted 30 KB log that ends in ultrathink still gets the override: only rule regexes are cut at 20000.
  assert.deepEqual(run('x'.repeat(30000) + ' ultrathink', compile(hiShallow)), { level: 'deep', confidence: 'high', reasons: ['user_override'] });
  assert.deepEqual(run('x'.repeat(30000) + ' ultrathink', compile()), { level: 'deep', confidence: 'high', reasons: ['user_override'] });
  // Length features count the whole prompt, not the first 20000 characters.
  assert.equal(fires({ minChars: 25000 }, 'x'.repeat(30000)), true);
  assert.equal(fires({ minChars: 35000 }, 'x'.repeat(30000)), false);
  assert.equal(fires({ maxChars: 25000 }, 'x'.repeat(30000)), false);
  assert.equal(fires({ maxChars: 35000 }, 'x'.repeat(30000)), true);
  // A question mark past the cut still makes it a question.
  assert.equal(fires({ isQuestion: true }, 'x'.repeat(30000) + '?'), true);
});

t('1 MB prompt with safe rules finishes fast', () => {
  const compiled = compile(
    rule('a', 'deep', 'high', { matchesAny: ['needle'], matchesNone: ['haystack$'] }),
    rule('b', 'shallow', 'high', { minChars: 10, maxChars: 100 }),
  );
  for (const prompt of ['a'.repeat(1024 * 1024), '  at '.repeat(200000), 'x '.repeat(500000) + '?']) {
    const start = Date.now();
    const d = decide({ prompt }, compiled);
    const ms = Date.now() - start;
    assert.ok(ms < 2000, `took ${ms} ms`);
    assert.equal(d.level, 'default');
  }
});

// R20: prevTurnFailed counts as a failure unless it is undefined or false. A
// non-JS harness may send 1, 'true' or null, and the shallow guard must fail
// unsafe (block shallow), never open.
const FAILURE_VALUES = [true, 1, 'true', 'false', null, {}, [], 0, '', NaN, 'yes'];
const NO_FAILURE_VALUES = [false, undefined];

t('R20: any prevTurnFailed value except undefined and false blocks a high shallow rule', () => {
  const sh = compile(rule('s', 'shallow', 'high', M));
  const blocked = { level: 'default', confidence: 'low', reasons: ['guard_shallow', 's'] };
  for (const v of FAILURE_VALUES) {
    assert.deepEqual(run('marker', sh, { prevTurnFailed: v }), blocked, `prevTurnFailed=${String(v)} (${typeof v})`);
  }
});

t('R20: prevTurnFailed false, undefined, absent or unreadable signals allow a high shallow rule', () => {
  const sh = compile(rule('s', 'shallow', 'high', M));
  const allowed = { level: 'shallow', confidence: 'high', reasons: ['s'] };
  for (const v of NO_FAILURE_VALUES) {
    assert.deepEqual(run('marker', sh, { prevTurnFailed: v }), allowed, String(v));
  }
  assert.deepEqual(run('marker', sh, {}), allowed);
  assert.deepEqual(run('marker', sh), allowed);
  assert.deepEqual(run('marker', sh, null), allowed);
  assert.deepEqual(run('marker', sh, 5), allowed);
});

t('R20: a when condition on prevTurnFailed agrees with the guard for every value', () => {
  const sh = compile(rule('s', 'shallow', 'high', M));
  for (const v of [...FAILURE_VALUES, ...NO_FAILURE_VALUES]) {
    const failed = !(v === undefined || v === false);
    const signals = { prevTurnFailed: v };
    const guardBlocks = run('marker', sh, signals).level === 'default';
    assert.equal(guardBlocks, failed, `guard for ${String(v)}`);
    assert.equal(fires({ ...M, prevTurnFailed: true }, 'marker', signals), failed, `when true for ${String(v)}`);
    assert.equal(fires({ ...M, prevTurnFailed: false }, 'marker', signals), !failed, `when false for ${String(v)}`);
    // The two can never disagree: a rule that needs "no failure" fires exactly when the guard lets shallow through.
    assert.equal(fires({ ...M, prevTurnFailed: false }, 'marker', signals), !guardBlocks, `agreement for ${String(v)}`);
  }
});

// A raw, uncompiled rule list must not be able to break the decision vocabulary.
t('decide ignores raw rules whose level or confidence is outside the vocabulary', () => {
  const noRule = { level: 'default', confidence: 'low', reasons: ['no_rule'] };
  const raw = (over) => ({ rules: [{ id: 'a', level: 'deep', confidence: 'high', when: {}, ...over }] });
  for (const level of ['bogus', 'default', '', undefined, null, 3, 'constructor', '__proto__']) {
    assert.deepEqual(decide({ prompt: 'x' }, raw({ level })), noRule, `level ${String(level)}`);
  }
  for (const confidence of ['bogus', '', undefined, null, 3, 'constructor', 'toString', '__proto__']) {
    assert.deepEqual(decide({ prompt: 'x' }, raw({ confidence })), noRule, `confidence ${String(confidence)}`);
  }
  // The same raw rule with a valid level and confidence does fire, so the ignores above are the filter's doing.
  assert.deepEqual(decide({ prompt: 'x' }, raw({})), { level: 'deep', confidence: 'high', reasons: ['a'] });
  // A bogus rule next to a good one never reaches the decision.
  const mixed = { rules: [{ id: 'bad', level: 'bogus', confidence: 'high', when: {} }, { id: 'ok', level: 'deep', confidence: 'medium', when: {} }] };
  assert.deepEqual(decide({ prompt: 'x' }, mixed), { level: 'deep', confidence: 'medium', reasons: ['ok'] });
  const mixedConf = { rules: [{ id: 'bad', level: 'deep', confidence: 'bogus', when: {} }, { id: 'ok', level: 'deep', confidence: 'low', when: {} }] };
  assert.deepEqual(decide({ prompt: 'x' }, mixedConf), { level: 'default', confidence: 'low', reasons: ['low_confidence', 'ok'] });
});
