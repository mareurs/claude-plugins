import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../core/testkit.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 's1-dump-hook.mjs');

// Runs the hook with `input` on stdin. `withOut` false leaves S1_OUT unset.
function run(input, { withOut = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 's1-dump-'));
  const out = join(dir, 'out.json');
  const env = { ...process.env };
  delete env.S1_OUT;
  if (withOut) env.S1_OUT = out;
  try {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', HOOK], {
      input,
      env,
      encoding: 'utf8',
    });
    const written = existsSync(out) ? readFileSync(out, 'utf8') : null;
    return { status: r.status, stdout: r.stdout, written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

t('records key names and typeof values, exits 0, prints nothing', () => {
  const r = run('{"session_id":"s","cwd":"/x","prompt":"hello"}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const parsed = JSON.parse(r.written);
  assert.equal(parsed.keys.session_id, 'string');
  assert.equal(parsed.keys.cwd, 'string');
  assert.equal(parsed.keys.prompt, 'string');
});

t('never stores the prompt text or any other value', () => {
  const r = run('{"session_id":"sess-secret-id","cwd":"/x/secret-dir","prompt":"hello"}');
  assert.equal(r.status, 0);
  assert.ok(!r.written.includes('hello'));
  assert.ok(!r.written.includes('sess-secret-id'));
  assert.ok(!r.written.includes('secret-dir'));
});

t('records typeof for non-string values', () => {
  const r = run('{"a":1,"b":true,"c":null,"d":{"x":1},"e":[1],"f":"s"}');
  assert.equal(r.status, 0);
  const k = JSON.parse(r.written).keys;
  assert.equal(k.a, 'number');
  assert.equal(k.b, 'boolean');
  assert.equal(k.c, 'null');
  assert.equal(k.d, 'object');
  assert.equal(k.e, 'array');
  assert.equal(k.f, 'string');
});

t('invalid JSON exits 0, prints nothing, writes nothing', () => {
  const r = run('{not json');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.written, null);
});

t('empty input exits 0, prints nothing, writes nothing', () => {
  const r = run('');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.written, null);
});

t('non-object JSON exits 0 and writes nothing', () => {
  for (const input of ['null', '42', '"hello"', '[1,2]']) {
    const r = run(input);
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '', input);
    assert.equal(r.written, null, input);
  }
});

t('missing S1_OUT exits 0 and prints nothing', () => {
  const r = run('{"session_id":"s","prompt":"hello"}', { withOut: false });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
