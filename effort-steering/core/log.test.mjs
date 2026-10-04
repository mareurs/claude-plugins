import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { t } from './testkit.mjs';
import { extractFeatures } from './features.mjs';
import { POLICY_VERSION } from './decide.mjs';
import { appendRecord, buildRecord, hashPrompt, stateDirFor } from './log.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const logUrl = pathToFileURL(path.join(here, 'log.mjs')).href;

// Every test that writes works inside its own temp directory, removed at the end.
function withTmp(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'es-log-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// testkit's `t` is synchronous. The concurrency test needs to await child
// processes, so it has an async twin that prints the same lines.
async function ta(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.log(`not ok - ${name}`);
    console.log(String(err && err.stack ? err.stack : err));
    process.exitCode = 1;
  }
}

const SECRET_PROMPT = 'my secret token abc123';
const DECISION = { level: 'deep', confidence: 'medium', reasons: ['rule-a', 'rule-b'] };

function args(over = {}) {
  const prompt = over.prompt ?? SECRET_PROMPT;
  return {
    sessionId: 'sess-1',
    turnId: 't-1',
    harness: 'claude-code',
    prompt,
    features: extractFeatures(prompt),
    decision: DECISION,
    arm: 'treated',
    steered: true,
    rulesVersion: 3,
    steerVersion: 4,
    now: new Date('2026-10-04T12:00:00.000Z'),
    ...over,
  };
}

const KEYS = [
  'ts', 'session_id', 'turn_id', 'harness', 'policy_version', 'rules_version', 'steer_version',
  'level', 'confidence', 'reasons', 'features', 'prompt_sha256', 'arm', 'steered',
];

// Every string reachable inside a value, so a leak is found wherever it hides.
function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allStrings(v, out);
    }
  }
  return out;
}

// ---- hashPrompt ----------------------------------------------------------

t('hashPrompt is the sha256 hex digest of the prompt', () => {
  // Known vector for the empty string and for 'abc'.
  assert.equal(hashPrompt(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hashPrompt('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

t('hashPrompt hashes a non-string as the empty string', () => {
  const empty = hashPrompt('');
  for (const bad of [undefined, null, 5, {}, ['abc']]) assert.equal(hashPrompt(bad), empty);
});

// ---- buildRecord ---------------------------------------------------------

t('a record built from a prompt holds no prompt text, only its hash', () => {
  const rec = buildRecord(args());
  const line = JSON.stringify(rec);
  assert.ok(!line.includes('abc123'), 'the secret token is in the serialized record');
  assert.ok(!line.includes(SECRET_PROMPT), 'the whole prompt is in the serialized record');
  for (const s of allStrings(rec)) {
    assert.ok(!s.includes('abc123'), `value or key leaks the token: ${s}`);
    assert.ok(!s.includes(SECRET_PROMPT), `value or key leaks the prompt: ${s}`);
  }
  assert.equal(rec.prompt_sha256, hashPrompt(SECRET_PROMPT));
  assert.match(rec.prompt_sha256, /^[0-9a-f]{64}$/);
});

t('a different prompt gives a different hash', () => {
  const a = buildRecord(args({ prompt: 'one prompt' }));
  const b = buildRecord(args({ prompt: 'another prompt' }));
  assert.notEqual(a.prompt_sha256, b.prompt_sha256);
  assert.equal(a.prompt_sha256, hashPrompt('one prompt'));
  assert.equal(b.prompt_sha256, hashPrompt('another prompt'));
});

t('a non-string prompt hashes as the empty string and does not throw', () => {
  const rec = buildRecord(args({ prompt: undefined, features: extractFeatures('') }));
  assert.equal(rec.prompt_sha256, hashPrompt(''));
});

t('a record has every LogRecord key, in order, and no other key', () => {
  const rec = buildRecord(args());
  assert.deepEqual(Object.keys(rec), KEYS);
});

t('every LogRecord key carries the right value and type', () => {
  const rec = buildRecord(args());
  assert.equal(rec.ts, '2026-10-04T12:00:00.000Z');
  assert.equal(rec.session_id, 'sess-1');
  assert.equal(rec.turn_id, 't-1');
  assert.equal(rec.harness, 'claude-code');
  assert.equal(rec.policy_version, POLICY_VERSION);
  assert.equal(typeof rec.policy_version, 'number');
  assert.equal(rec.rules_version, 3);
  assert.equal(rec.steer_version, 4);
  assert.equal(rec.level, 'deep');
  assert.equal(rec.confidence, 'medium');
  assert.deepEqual(rec.reasons, ['rule-a', 'rule-b']);
  assert.deepEqual(rec.features, extractFeatures(SECRET_PROMPT));
  assert.equal(rec.arm, 'treated');
  assert.equal(rec.steered, true);
  const holdout = buildRecord(args({ arm: 'holdout', steered: false }));
  assert.equal(holdout.arm, 'holdout');
  assert.equal(holdout.steered, false);
});

t('ts defaults to the current time as an ISO string', () => {
  const before = Date.now();
  const rec = buildRecord(args({ now: undefined }));
  const after = Date.now();
  assert.match(rec.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const ms = Date.parse(rec.ts);
  assert.ok(ms >= before && ms <= after, 'ts is not the current time');
});

t('the record owns its features and reasons: later changes to the inputs do not reach it', () => {
  const features = extractFeatures('hello there');
  const decision = { level: 'default', confidence: 'low', reasons: ['r1'] };
  const rec = buildRecord(args({ features, decision }));
  const snapshot = JSON.stringify(rec);
  assert.notEqual(rec.features, features, 'features object is shared with the caller');
  assert.notEqual(rec.reasons, decision.reasons, 'reasons array is shared with the caller');
  features.chars = 99999;
  decision.reasons.push('late');
  assert.equal(JSON.stringify(rec), snapshot);
});

// ---- stateDirFor ---------------------------------------------------------

const homeState = path.join(os.homedir(), '.local', 'state', 'effort-steering');

t('stateDirFor uses an absolute XDG_STATE_HOME', () => {
  assert.equal(stateDirFor({ XDG_STATE_HOME: '/s' }), path.join('/s', 'effort-steering'));
  assert.ok(stateDirFor({ XDG_STATE_HOME: '/s' }).endsWith('/s/effort-steering'));
});

t('stateDirFor falls back to the home path when XDG_STATE_HOME is empty or unset', () => {
  assert.equal(stateDirFor({}), homeState);
  assert.equal(stateDirFor({ XDG_STATE_HOME: '' }), homeState);
  assert.equal(stateDirFor({ XDG_STATE_HOME: undefined }), homeState);
});

t('stateDirFor ignores a relative XDG_STATE_HOME (R14)', () => {
  for (const rel of ['rel/state', 'state', './state', '../state', '~/state']) {
    assert.equal(stateDirFor({ XDG_STATE_HOME: rel }), homeState, `relative value ${rel}`);
  }
});

t('stateDirFor ignores an XDG_STATE_HOME that is not a string (R14)', () => {
  for (const bad of [5, true, null, {}, ['/s'], () => '/s']) {
    assert.equal(stateDirFor({ XDG_STATE_HOME: bad }), homeState, `value ${String(bad)}`);
  }
});

// ---- appendRecord: path safety -------------------------------------------

const BAD_IDS = [
  ['../x', '../x'],
  ['/abs', '/abs'],
  ['empty', ''],
  ['a/b', 'a/b'],
  ['..', '..'],
  ['.', '.'],
  ['129 characters', 'a'.repeat(129)],
  ['NUL character', 'a\0b'],
  ['trailing newline', 'abc\n'],
  ['space', 'a b'],
  ['backslash', 'a\\b'],
  ['non-ASCII', 'caf\u00e9'],
  ['number', 123],
  ['null', null],
  ['undefined', undefined],
  ['array that stringifies to a valid id', ['abc']],
  ['object that stringifies to a valid id', { toString: () => 'abc' }],
];

for (const [label, id] of BAD_IDS) {
  t(`appendRecord rejects session_id ${label} with RangeError and writes nothing`, () => {
    withTmp((root) => {
      // The state directory does not exist yet: a mkdir before validation would create it.
      const stateDir = path.join(root, 'state');
      const rec = { ...buildRecord(args()), session_id: id };
      assert.throws(() => appendRecord(stateDir, rec), RangeError);
      assert.ok(!existsSync(stateDir), 'the state directory was created before validation');
      assert.deepEqual(readdirSync(root), [], 'something appeared in the temp directory');
    });
  });
}

t('appendRecord rejects a record with no session_id key', () => {
  withTmp((root) => {
    const stateDir = path.join(root, 'state');
    const { session_id, ...rest } = buildRecord(args());
    assert.throws(() => appendRecord(stateDir, rest), RangeError);
    assert.deepEqual(readdirSync(root), []);
  });
});

t('appendRecord rejects a record that is not an object', () => {
  withTmp((root) => {
    const stateDir = path.join(root, 'state');
    for (const bad of [null, undefined, 'abc', 5]) {
      assert.throws(() => appendRecord(stateDir, bad), TypeError);
    }
    assert.deepEqual(readdirSync(root), []);
  });
});

t('a 128-character id is accepted and stays inside the state directory', () => {
  withTmp((root) => {
    const stateDir = path.join(root, 'state');
    const id = 'a'.repeat(128);
    const file = appendRecord(stateDir, { ...buildRecord(args()), session_id: id });
    assert.equal(file, path.join(stateDir, `${id}.jsonl`));
    assert.ok(existsSync(file));
  });
});

t('ids with dots inside, such as a..b and ..hidden, are plain file names inside the state directory', () => {
  withTmp((root) => {
    const stateDir = path.join(root, 'state');
    for (const id of ['a..b', '..hidden', 'a.b', '.hidden', 'a-b_c.D9']) {
      const file = appendRecord(stateDir, { ...buildRecord(args()), session_id: id });
      assert.equal(path.dirname(file), stateDir, `id ${id} escaped the state directory`);
      assert.equal(path.basename(file), `${id}.jsonl`);
      assert.ok(existsSync(file));
    }
    assert.deepEqual(readdirSync(root), ['state']);
  });
});

// ---- appendRecord: behavior ----------------------------------------------

t('appendRecord returns <stateDir>/<session_id>.jsonl and writes the record as one newline-ended JSON line', () => {
  withTmp((root) => {
    const stateDir = path.join(root, 'state', 'nested');
    const rec = buildRecord(args());
    const file = appendRecord(stateDir, rec);
    assert.equal(file, path.join(stateDir, 'sess-1.jsonl'));
    assert.equal(readFileSync(file, 'utf8'), `${JSON.stringify(rec)}\n`);
  });
});

t('two appends to one session give two lines, in order', () => {
  withTmp((root) => {
    const stateDir = path.join(root, 'state');
    const a = buildRecord(args({ turnId: 't-1' }));
    const b = buildRecord(args({ turnId: 't-2' }));
    const f1 = appendRecord(stateDir, a);
    const f2 = appendRecord(stateDir, b);
    assert.equal(f1, f2);
    const text = readFileSync(f1, 'utf8');
    assert.ok(text.endsWith('\n'));
    const lines = text.split('\n').slice(0, -1);
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), a);
    assert.deepEqual(JSON.parse(lines[1]), b);
  });
});

t('two session ids give two files', () => {
  withTmp((root) => {
    const stateDir = path.join(root, 'state');
    const f1 = appendRecord(stateDir, buildRecord(args({ sessionId: 's-one' })));
    const f2 = appendRecord(stateDir, buildRecord(args({ sessionId: 's-two' })));
    assert.notEqual(f1, f2);
    assert.deepEqual(readdirSync(stateDir).sort(), ['s-one.jsonl', 's-two.jsonl']);
    assert.equal(readFileSync(f1, 'utf8').split('\n').length, 2);
    assert.equal(JSON.parse(readFileSync(f1, 'utf8')).session_id, 's-one');
    assert.equal(JSON.parse(readFileSync(f2, 'utf8')).session_id, 's-two');
  });
});

t('appending to an existing state directory and file works', () => {
  withTmp((root) => {
    appendRecord(root, buildRecord(args()));
    appendRecord(root, buildRecord(args()));
    assert.equal(readFileSync(path.join(root, 'sess-1.jsonl'), 'utf8').split('\n').length, 3);
  });
});

if (process.platform !== 'win32') {
  t('the state directory is created with mode 0700 and the log file with mode 0600', () => {
    withTmp((root) => {
      const stateDir = path.join(root, 'state');
      const file = appendRecord(stateDir, buildRecord(args()));
      assert.equal(statSync(stateDir).mode & 0o777, 0o700);
      assert.equal(statSync(file).mode & 0o777, 0o600);
    });
  });
}

// ---- appendRecord: concurrency -------------------------------------------

const WORKERS = 20;
const PER_WORKER = 50;

await ta('20 processes appending 50 records each to one session file lose and corrupt no line', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'es-log-conc-'));
  try {
    const stateDir = path.join(root, 'state');
    const script = path.join(root, 'child.mjs');
    writeFileSync(
      script,
      [
        `import { buildRecord, appendRecord } from ${JSON.stringify(logUrl)};`,
        'const [stateDir, worker, count] = process.argv.slice(2);',
        'for (let i = 0; i < Number(count); i += 1) {',
        '  appendRecord(stateDir, buildRecord({',
        "    sessionId: 'shared', turnId: `${worker}-${i}`, harness: 'claude-code',",
        "    prompt: 'concurrent prompt', features: { chars: 17, words: 2, isQuestion: false, hasStackTrace: false, startsWithSlash: false, explicitDeep: false },",
        "    decision: { level: 'default', confidence: 'low', reasons: ['r'] },",
        "    arm: 'treated', steered: false, rulesVersion: 1, steerVersion: 1,",
        '  }));',
        '}',
        '',
      ].join('\n'),
    );

    const runs = Array.from({ length: WORKERS }, (_, w) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, stateDir, String(w), String(PER_WORKER)], {
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ w, code, stderr }));
      }),
    );
    const results = await Promise.all(runs);
    for (const r of results) assert.equal(r.code, 0, `worker ${r.w} failed: ${r.stderr}`);

    const text = readFileSync(path.join(stateDir, 'shared.jsonl'), 'utf8');
    assert.ok(text.endsWith('\n'), 'the file does not end with a newline');
    const lines = text.split('\n').slice(0, -1);
    assert.equal(lines.length, WORKERS * PER_WORKER);
    const seen = new Set();
    for (const line of lines) {
      const rec = JSON.parse(line); // throws on an interleaved or torn line
      assert.deepEqual(Object.keys(rec), KEYS);
      seen.add(rec.turn_id);
    }
    assert.equal(seen.size, WORKERS * PER_WORKER, 'a record was lost or duplicated');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
