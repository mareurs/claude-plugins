import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t } from './testkit.mjs';
import { render } from './steer.mjs';

const SHALLOW = 'Answer directly without deliberating.';
const DEEP = 'Please think hard before responding.';

// The shipped table, read from disk: the phrases are fixed by the spec.
const shipped = JSON.parse(
  readFileSync(fileURLToPath(new URL('./steer.table.json', import.meta.url)), 'utf8'),
);
const table = { version: 1, phrases: { shallow: SHALLOW, deep: DEEP } };
const dec = (level, reasons = ['r1'], confidence = 'high') => ({ level, confidence, reasons });

t('steer.table.json holds the two spec phrases verbatim and version 1', () => {
  assert.equal(shipped.version, 1);
  assert.equal(shipped.phrases.shallow, 'Answer directly without deliberating.');
  assert.equal(shipped.phrases.deep, 'Please think hard before responding.');
  assert.deepEqual(Object.keys(shipped.phrases).sort(), ['deep', 'shallow']);
});

t('render with the shipped table gives the exact phrases', () => {
  assert.equal(render(dec('shallow'), shipped), 'Answer directly without deliberating.');
  assert.equal(render(dec('deep'), shipped), 'Please think hard before responding.');
});

t('render: shallow and deep give their own phrase, default gives null', () => {
  assert.equal(render(dec('shallow'), table), SHALLOW);
  assert.equal(render(dec('deep'), table), DEEP);
  assert.equal(render(dec('default'), table), null);
  // Even a table that carries a default phrase must not steer a default decision.
  assert.equal(render(dec('default'), { version: 1, phrases: { ...table.phrases, default: 'x' } }), null);
});

t('user_override suppresses steering, and only user_override does', () => {
  assert.equal(render(dec('deep', ['user_override']), table), null);
  assert.equal(render(dec('shallow', ['user_override']), table), null);
  assert.equal(render(dec('deep', ['a', 'user_override', 'b']), table), null);
  // A deep decision without user_override must still steer.
  assert.equal(render(dec('deep', ['a', 'b']), table), DEEP);
  assert.equal(render(dec('deep', []), table), DEEP);
  assert.equal(render(dec('deep', ['user_override_not']), table), DEEP);
});

t('an unknown level gives null', () => {
  assert.equal(render(dec('bogus'), table), null);
  // Even when the table carries a phrase for it: the level vocabulary is closed.
  assert.equal(render(dec('bogus'), { version: 1, phrases: { ...table.phrases, bogus: 'x y' } }), null);
  for (const level of ['constructor', '__proto__', 'toString', '', undefined, null, 3]) {
    assert.equal(render(dec(level), table), null, String(level));
  }
});

t('a missing or non-string or empty phrase gives null', () => {
  assert.equal(render(dec('deep'), { version: 1, phrases: { shallow: SHALLOW } }), null);
  assert.equal(render(dec('shallow'), { version: 1, phrases: { deep: DEEP } }), null);
  for (const bad of ['', 42, null, undefined, true, {}, ['x'], () => 'x']) {
    assert.equal(render(dec('deep'), { version: 1, phrases: { deep: bad } }), null, String(bad));
  }
});

t('render never throws and returns null on malformed input', () => {
  const bad = [
    [null, table],
    [undefined, table],
    ['deep', table],
    [{ level: 'deep', confidence: 'high' }, table], // no reasons
    [{ level: 'deep', confidence: 'high', reasons: null }, table],
    [{ level: 'deep', confidence: 'high', reasons: 'user_override' }, table], // not an array
    [{ level: 'deep', confidence: 'high', reasons: {} }, table],
    // A string has .includes, so only the Array.isArray check keeps it from passing.
    [{ level: 'deep', confidence: 'high', reasons: 'abc' }, table],
    [dec('deep'), null],
    [dec('deep'), undefined],
    [dec('deep'), 'table'],
    [dec('deep'), { version: 1 }], // no phrases
    [dec('deep'), { version: 1, phrases: null }],
    [dec('deep'), { version: 1, phrases: 'deep' }],
    [],
  ];
  for (const args of bad) {
    let out;
    assert.doesNotThrow(() => { out = render(...args); }, JSON.stringify(args));
    assert.equal(out, null, JSON.stringify(args));
  }
  // Hostile objects whose property reads throw: render must still return null.
  const boom = () => { throw new Error('boom'); };
  const hostile = [
    [{ get level() { return boom(); }, reasons: [] }, table],
    [{ level: 'deep', get reasons() { return boom(); } }, table],
    [dec('deep'), { get phrases() { return boom(); } }],
    [dec('deep'), { version: 1, phrases: { get deep() { return boom(); } } }],
  ];
  for (const args of hostile) {
    let out;
    assert.doesNotThrow(() => { out = render(...args); });
    assert.equal(out, null);
  }
});
