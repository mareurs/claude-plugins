// prereg.test.mjs — the S5 preregistration loader (Task 8, rulings R2, R22, R49, R50, R51, R59, R60).
//
// Every refusal is tested on both sides of its boundary, in both loaders unless the check belongs to one of them,
// and the refusal must NAME the field the check blames: VALID loads, so a refusal that names the field can only
// have come from the one change the case makes. The prereg loader's files are committed first, so a refusal can
// never be the committed-bytes check standing in for a validation check.
//
// Fixtures live under one mkdtemp directory in os.tmpdir(), removed on process exit (also after a failed test).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { EFFORTS } from '../s4-prereg.mjs';
import { PROXY_IMAGE, hostPattern } from './proxy.mjs';
import { checkTasksMatch, loadS5Config, loadS5Prereg } from './prereg.mjs';
import { IMAGE_FOR_REPO, TASK_ID_RE } from './task-def.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 's5-prereg-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

// Child git processes must not inherit a hook's repo environment.
const ENV = { ...process.env };
for (const k of Object.keys(ENV)) if (k.startsWith('GIT_')) delete ENV[k];
ENV.HOME = ROOT;
ENV.GIT_CONFIG_NOSYSTEM = '1';
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const REPO = join(ROOT, 'repo');
mkdirSync(REPO);
git(REPO, 'init', '-q');
git(REPO, 'commit', '-q', '--allow-empty', '-m', 'init');
// A directory that is not in a git repository.
const PLAIN = join(ROOT, 'plain');
mkdirSync(PLAIN);

// ---- the registration under test ----

const hex = (n) => n.toString(16).padStart(64, '0');
const digest = (n) => `sha256:${hex(n)}`;
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

const VALID = {
  model: 'claude-sonnet-5-5',
  cli: { version: '2.1.292', sha256: digest(0xc11) },
  arms: {
    A: { effort: 'xhigh', steer: false, runs: 3 },
    B: { effort: 'xhigh', steer: true, runs: 3 },
    C: { effort: 'low', steer: false, runs: 2 },
  },
  tasks: Array.from({ length: 8 }, (_, i) => ({ id: `task-${i + 1}`, treeHash: hex(0x100 + i), hiddenHash: hex(0x200 + i), promptHash: hex(0x300 + i) })),
  margin: 0.15,
  alpha: 0.05,
  bound: { method: 'percentile', resamples: 10000, seed: 7 },
  orderSeed: 11,
  mechanism: { alpha: 0.05, permutations: 1000, seed: 13, effectSizeThinkingTokens: 500 },
  limits: { timeoutMinutes: 90, cpus: 4, memoryGb: 16, concurrency: 2, infraRetries: 2 },
  images: { codescout: digest(0x1), 'claude-plugins': digest(0x2), proxy: digest(0x3) },
  proxyAllowlist: ['api.anthropic.com', 'statsig.anthropic.com'],
  stopAtCostUsd: 100,
};
const NINTH_TASK = { id: 'task-9', treeHash: hex(0x109), hiddenHash: hex(0x209), promptHash: hex(0x309) };

// ---- building variants of VALID ----

const MISSING = Symbol('missing');
class Raw {
  constructor(text) {
    this.text = text;
  }
}
// Number text JSON.stringify cannot write, or writes differently: 2^53 is canonical but not a safe integer; 1e999, 1e-999 and 2^53 + 1
// parse to Infinity, 0 and 2^53, which the canonical form writes back as null, 0 and 9007199254740992 (see NOT_CANONICAL below).
const raw = (text) => new Raw(text);
const UNSAFE = raw('9007199254740992');
const NOT_CANONICAL = [raw('1e999'), raw('-1e999'), raw('1e-999'), raw('9007199254740993')];

const keysOf = (path) => path.replace(/\[(\d+)\]/g, '.$1').split('.');
// VALID with each [path, value] applied; MISSING removes the key.
function variant(changes, base = VALID) {
  const v = structuredClone(base);
  for (const [path, value] of changes) {
    const keys = keysOf(path);
    const last = keys.pop();
    let o = v;
    for (const k of keys) o = o[k];
    if (value === MISSING) delete o[last];
    else o[last] = value;
  }
  return v;
}
// The canonical form (R65): what JSON.stringify(parsed, null, 2) plus a newline writes. A registration is only loaded in this form.
function serialize(obj) {
  const text = JSON.stringify(obj, (k, v) => (v instanceof Raw ? `@@RAW@@${v.text}@@` : v), 2);
  return `${text.replace(/"@@RAW@@(.*?)@@"/g, '$1')}\n`;
}
const show = (v) => (v === MISSING ? '(missing)' : v instanceof Raw ? v.text : (JSON.stringify(v) ?? String(v)));

// ---- files ----

let fileNo = 0;
const queued = [];
// Writes a file in REPO and queues it for the next commit; `commitQueued()` commits the whole batch in one go.
function put(content) {
  const f = join(REPO, `prereg-${fileNo++}.json`);
  writeFileSync(f, typeof content === 'string' ? content : serialize(content));
  queued.push(f);
  return f;
}
function commitQueued() {
  if (queued.length === 0) return;
  git(REPO, 'add', '--', ...queued);
  git(REPO, 'commit', '-q', '-m', 'add');
  queued.length = 0;
}
// A file in `dir` that is never added to git.
function loose(content, dir = REPO) {
  const f = join(dir, `loose-${fileNo++}.json`);
  writeFileSync(f, typeof content === 'string' ? content : serialize(content));
  return f;
}
const committed = (content) => {
  const f = put(content);
  commitQueued();
  return f;
};

// ---- the two loaders under one interface ----

const LOADERS = {
  prereg: (f) => loadS5Prereg(f),
  config: (f) => loadS5Config(f, { mode: 'pilot' }),
};
const BOTH = Object.keys(LOADERS);

// Every case (a list of [path, value] changes to VALID) must be refused by every loader in `only`, naming `field`.
function refuseCases(cases, field, { only = BOTH } = {}) {
  const files = cases.map((changes) => put(variant(changes)));
  commitQueued();
  cases.forEach((changes, i) => {
    for (const name of only) {
      assert.throws(
        () => LOADERS[name](files[i]),
        (e) => {
          assert.ok(e instanceof Error, `${name}: threw a non-Error`);
          assert.ok(e.message.includes(`field ${field} `), `${name} with ${changes.map(([p, v]) => `${p} = ${show(v)}`).join(', ')}: wanted a refusal naming "field ${field} ", got: ${e.message}`);
          return true;
        },
        `${name} must refuse ${changes.map(([p, v]) => `${p} = ${show(v)}`).join(', ')}`,
      );
    }
  });
}
function acceptCases(cases, { only = BOTH } = {}) {
  const files = cases.map((changes) => put(variant(changes)));
  commitQueued();
  cases.forEach((changes, i) => {
    for (const name of only) {
      try {
        LOADERS[name](files[i]);
      } catch (e) {
        throw new Error(`${name} must accept ${changes.map(([p, v]) => `${p} = ${show(v)}`).join(', ')}: ${e.message}`);
      }
    }
  });
}
// One path, many values.
const refuse = (path, values, opts = {}) => refuseCases(values.map((v) => [[path, v], ...(opts.extra ?? [])]), opts.field ?? path, opts);
const accept = (path, values, opts = {}) => acceptCases(values.map((v) => [[path, v], ...(opts.extra ?? [])]), opts);

// ---- the shape of VALID: every field path, and every object path ----

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function walk(value, prefix, out) {
  for (const [k, v] of Object.entries(value)) {
    const p = prefix === '' ? k : `${prefix}.${k}`;
    out.fields.push(p);
    if (Array.isArray(v)) {
      if (isPlain(v[0])) {
        out.fields.push(`${p}[0]`);
        out.objects.push(`${p}[0]`);
        walk(v[0], `${p}[0]`, out);
      }
    } else if (isPlain(v)) {
      out.objects.push(p);
      walk(v, p, out);
    }
  }
  return out;
}
const SHAPE = walk(VALID, '', { fields: [], objects: [''] });
// A value of another JSON type than `v`: a string becomes a number, a number, boolean or array a string, an object a number.
const otherType = (v) => (typeof v === 'string' ? 5 : typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v) ? 'x' : 5);
const valueAt = (path) => keysOf(path).reduce((o, k) => o[k], VALID);
const deepFrozen = (v) => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(deepFrozen));

// =====================================================================================================
// loading, the committed bytes, the result
// =====================================================================================================

t('a committed valid file loads', () => {
  const loaded = loadS5Prereg(committed(VALID));
  assert.deepEqual(loaded, { ...VALID, registered: true });
  assert.deepEqual(loaded.tasks.map((x) => x.id), VALID.tasks.map((x) => x.id), 'the registered task order is kept');
});

t('a valid file that differs from HEAD is refused', () => {
  const f = committed(VALID);
  const changed = variant([['margin', 0.2]]); // still valid: only the committed-bytes check can refuse it
  writeFileSync(f, serialize(changed));
  assert.throws(() => loadS5Prereg(f), /differs from HEAD/);
  assert.equal(loadS5Config(f, { mode: 'pilot' }).margin, 0.2, 'the config loader does not look at git');
});

t('a valid file that differs from HEAD only in key order is refused: the bytes are compared, not the parse', () => {
  const f = committed(VALID);
  const { model, ...rest } = VALID;
  const reordered = serialize({ ...rest, model }); // canonical, the same registration, other bytes
  assert.notEqual(reordered, serialize(VALID));
  writeFileSync(f, reordered);
  assert.throws(() => loadS5Prereg(f), /differs from HEAD/);
  assert.deepEqual(loadS5Config(f, { mode: 'pilot' }), { ...VALID, registered: false });
});

t('a valid file that git does not track is refused as not committed, and loadS5Config loads it', () => {
  const f = loose(VALID);
  assert.throws(() => loadS5Prereg(f), /not committed/);
  assert.deepEqual(loadS5Config(f, { mode: 'calibrate' }), { ...VALID, registered: false });
});

t('a valid file outside any git repository is refused as not committed, and loadS5Config loads it', () => {
  const f = loose(VALID, PLAIN);
  assert.throws(() => loadS5Prereg(f), /not committed/);
  assert.deepEqual(loadS5Config(f, { mode: 'smoke' }), { ...VALID, registered: false });
});

t('a symlink is refused naming the cause even when git holds it: to a file, to a directory, dangling', () => {
  const target = committed(VALID);
  const dir = join(REPO, `dir-${fileNo++}`);
  mkdirSync(dir);
  const links = [[target, 'a file'], [dir, 'a directory'], [join(REPO, 'no-such-target.json'), 'nothing']].map(([to, what]) => {
    const link = join(REPO, `link-${fileNo++}.json`);
    symlinkSync(to, link);
    return [link, what];
  });
  git(REPO, 'add', '--', ...links.map(([link]) => link));
  git(REPO, 'commit', '-q', '-m', 'links');
  for (const [link, what] of links) assert.throws(() => loadS5Prereg(link), (e) => e.message.includes(`${link} is not committed: it is a symlink`), `a link to ${what}`);
});

t('loadS5Config reads through a symlink to a file, and says it cannot read a dangling one', () => {
  const dir = join(PLAIN, `links-${fileNo++}`);
  mkdirSync(dir);
  symlinkSync(loose(VALID, PLAIN), join(dir, 'ok.json'));
  symlinkSync(join(dir, 'no-such-target.json'), join(dir, 'dangling.json'));
  assert.deepEqual(loadS5Config(join(dir, 'ok.json'), { mode: 'pilot' }), { ...VALID, registered: false });
  assert.throws(() => loadS5Config(join(dir, 'dangling.json'), { mode: 'pilot' }), /cannot read/);
  // A loop of links is an unreadable file to the config loader, not a refused symlink: only the measured loader refuses links.
  symlinkSync(join(dir, 'b.json'), join(dir, 'a.json'));
  symlinkSync(join(dir, 'a.json'), join(dir, 'b.json'));
  assert.throws(() => loadS5Config(join(dir, 'a.json'), { mode: 'pilot' }), (e) => /cannot read/.test(e.message) && !/not committed/.test(e.message));
});

t('the loaders close the file they read: no descriptor is left open after a read that succeeds, fails after the open, or is refused', () => {
  if (!existsSync('/proc/self/fd')) {
    console.log('skip - the descriptor check: /proc/self/fd is not here');
    return;
  }
  const open = () => readdirSync('/proc/self/fd').length;
  const ok = committed(VALID);
  const dir = join(REPO, `fd-dir-${fileNo++}`);
  mkdirSync(dir);
  const link = join(REPO, `fd-link-${fileNo++}.json`);
  symlinkSync(ok, link);
  const before = open();
  for (let i = 0; i < 50; i++) {
    loadS5Prereg(ok);
    loadS5Config(ok, { mode: 'pilot' });
    assert.throws(() => loadS5Prereg(dir), /cannot read/); // opens, then reading a directory fails
    assert.throws(() => loadS5Config(dir, { mode: 'pilot' }), /cannot read/);
    assert.throws(() => loadS5Prereg(link), /symlink/);
  }
  assert.equal(open(), before);
});

t('validation runs before the committed check: an invalid file git does not track is refused naming the field', () => {
  const f = loose(variant([['margin', 0]]));
  assert.throws(() => loadS5Prereg(f), (e) => e.message.includes('field margin ') && !/not committed/.test(e.message));
});

t('loadS5Prereg returns registered: true and loadS5Config registered: false, for each mode', () => {
  assert.equal(loadS5Prereg(committed(VALID)).registered, true);
  const f = loose(VALID);
  for (const mode of ['smoke', 'pilot', 'calibrate']) assert.deepEqual(loadS5Config(f, { mode }), { ...VALID, registered: false }, mode);
});

t('the loaded object is plain data, frozen at every depth', () => {
  for (const loaded of [loadS5Prereg(committed(VALID)), loadS5Config(loose(VALID), { mode: 'pilot' })]) {
    assert.equal(Object.getPrototypeOf(loaded), Object.prototype);
    assert.ok(deepFrozen(loaded));
    assert.ok(Object.isFrozen(loaded.tasks[0]) && Object.isFrozen(loaded.proxyAllowlist) && Object.isFrozen(loaded.arms.C));
  }
});

t('the registered marker cannot come from the file (R59): both loaders refuse a registered key, whatever its value', () => {
  for (const value of [true, false, 'true', 1, null]) {
    const f = committed({ ...VALID, registered: value });
    for (const load of [() => loadS5Prereg(f), () => loadS5Config(f, { mode: 'pilot' })]) {
      assert.throws(load, (e) => e.message.includes('field registered ') && e.message.includes('only loadS5Prereg sets it'), `registered: ${JSON.stringify(value)}`);
    }
  }
});

t('loadS5Config refuses every mode but smoke, pilot and calibrate, naming the mode', () => {
  const f = loose(VALID);
  const MODE_RULE = 'mode must be one of smoke, pilot, calibrate';
  for (const mode of ['measure', 'Pilot', 'smoke ', '', 'all', undefined, null, 1]) {
    assert.throws(() => loadS5Config(f, { mode }), (e) => e.message.includes(MODE_RULE) && e.message.includes(`got ${JSON.stringify(mode) ?? String(mode)}`), `mode ${String(mode)}`);
  }
  for (const options of [undefined, {}, null]) assert.throws(() => loadS5Config(f, options), (e) => e.message.includes(MODE_RULE), `options ${String(options)}`);
});

t('every mode runs the same checks: smoke and calibrate refuse a bad margin and accept zero runs', () => {
  const bad = loose(variant([['margin', 0]]));
  const zero = loose(variant([['arms.A.runs', 0], ['arms.B.runs', 0], ['arms.C.runs', 0]]));
  for (const mode of ['smoke', 'pilot', 'calibrate']) {
    assert.throws(() => loadS5Config(bad, { mode }), (e) => e.message.includes('field margin '), mode);
    assert.equal(loadS5Config(zero, { mode }).arms.B.runs, 0, mode);
  }
});

t('a file that cannot be read, is not JSON, or is not a JSON object is refused by both loaders', () => {
  const missing = join(REPO, 'no-such-file.json');
  assert.throws(() => loadS5Prereg(missing), /cannot read/);
  assert.throws(() => loadS5Config(missing, { mode: 'pilot' }), /cannot read/);
  const notJson = committed('{ "model": ');
  assert.throws(() => loadS5Prereg(notJson), /not valid JSON/);
  assert.throws(() => loadS5Config(notJson, { mode: 'pilot' }), /not valid JSON/);
  const empty = committed('');
  assert.throws(() => loadS5Prereg(empty), /not valid JSON/);
  assert.throws(() => loadS5Config(empty, { mode: 'pilot' }), /not valid JSON/);
  // Canonical text of values that parse but are not an object.
  for (const value of [[], null, 3, 's', [{ model: 'm' }]]) {
    const f = committed(`${JSON.stringify(value, null, 2)}\n`);
    assert.throws(() => loadS5Prereg(f), /JSON object/, JSON.stringify(value));
    assert.throws(() => loadS5Config(f, { mode: 'pilot' }), /JSON object/, JSON.stringify(value));
  }
});

// =====================================================================================================
// the canonical form (R65): a key written twice, or a value written other than JSON.stringify writes it
// =====================================================================================================

const CANON = serialize(VALID);
// `base` with the one occurrence of `needle` replaced by `replacement`.
const edited = (needle, replacement, base = CANON) => {
  assert.equal(base.split(needle).length - 1, 1, `${JSON.stringify(needle)} occurs once in the text`);
  return base.replace(needle, () => replacement);
};
const rewriteCommandOf = (message) => message.split('Rewrite it with: ')[1];

// Each [label, text] is written to a committed file; both loaders must refuse it, naming the file, saying what is wrong and
// giving a one-line rewrite command (returned per case, for the caller to run).
const refuseNotCanonical = (cases) => {
  const files = cases.map(([, text]) => put(text));
  commitQueued();
  return cases.map(([label], i) => {
    const commands = [];
    for (const name of BOTH) {
      assert.throws(
        () => LOADERS[name](files[i]),
        (e) => {
          assert.ok(e instanceof Error, `${label}: ${name} threw a non-Error`);
          assert.ok(e.message.includes(files[i]), `${label}: ${name} must name the file, got: ${e.message}`);
          assert.ok(e.message.includes('repeated key or a value that is not in canonical form'), `${label}: ${name} must say what is wrong, got: ${e.message}`);
          const command = rewriteCommandOf(e.message);
          assert.ok(typeof command === 'string' && command.startsWith('node -e ') && !command.includes('\n'), `${label}: ${name} must end in a one-line rewrite command, got: ${e.message}`);
          commands.push(command);
          return true;
        },
        `${label}: ${name} must refuse`,
      );
    }
    assert.equal(commands[0], commands[1], `${label}: both loaders give the same command`);
    return { label, file: files[i], command: commands[0] };
  });
};

t('a key written twice at the top level is refused by both loaders, though JSON.parse keeps the last value (R65)', () => {
  const text = edited('"margin": 0.15,', '"margin": 0.15,\n  "margin": 0.9,');
  assert.equal(JSON.parse(text).margin, 0.9, 'what loading it would have registered');
  refuseNotCanonical([['top-level repeat', text]]);
});

t('a key written twice inside a nested object is refused: arms.B.effort and arms.B.runs', () => {
  const sameValue = edited('"effort": "xhigh",\n      "steer": true,', '"effort": "xhigh",\n      "effort": "xhigh",\n      "steer": true,');
  const otherValue = edited('"steer": true,', '"steer": true,\n      "runs": 5,');
  assert.equal(JSON.parse(otherValue).arms.B.runs, 3, 'the later value wins, the first is hidden');
  refuseNotCanonical([['arms.B.effort repeated', sameValue], ['arms.B.runs repeated with another value', otherValue]]);
});

t('a key written twice inside a task is refused: tasks[3].id', () => {
  const text = edited('"id": "task-4",', '"id": "task-44",\n      "id": "task-4",');
  assert.equal(JSON.parse(text).tasks[3].id, 'task-4');
  refuseNotCanonical([['tasks[3].id repeated', text]]);
});

t('a key written twice once escaped is still a repeat: "margin" and "m\\u0061rgin"', () => {
  const text = edited('"margin": 0.15,', '"margin": 0.15,\n  "m\\u0061rgin": 0.9,');
  assert.equal(JSON.parse(text).margin, 0.9, 'JSON.parse decodes the escape, so it is the same key');
  refuseNotCanonical([['escaped repeat', text]]);
});

t('a repeated __proto__ key is refused as a repeat', () => {
  const text = `{\n  "__proto__": 1,\n  "__proto__": 2,${CANON.slice(1)}`;
  assert.ok(Object.hasOwn(JSON.parse(text), '__proto__'));
  refuseNotCanonical([['__proto__ repeated', text]]);
});

t('an unambiguous file that is not in canonical form is refused: 0.10, no trailing newline, other indents, escapes, number spellings', () => {
  const alphaTenth = serialize(variant([['alpha', 0.1]]));
  const cases = [
    ['0.10 for 0.1', edited('"alpha": 0.1,', '"alpha": 0.10,', alphaTenth), variant([['alpha', 0.1]])],
    ['0.150 for 0.15', edited('"margin": 0.15,', '"margin": 0.150,'), VALID],
    ['1.1e1 for 11', edited('"orderSeed": 11,', '"orderSeed": 1.1e1,'), VALID],
    ['no trailing newline', CANON.slice(0, -1), VALID],
    ['two trailing newlines', `${CANON}\n`, VALID],
    ['four-space indent', `${JSON.stringify(VALID, null, 4)}\n`, VALID],
    ['tab indent', `${JSON.stringify(VALID, null, '\t')}\n`, VALID],
    ['compact', `${JSON.stringify(VALID)}\n`, VALID],
    ['CRLF line ends', CANON.replaceAll('\n', '\r\n'), VALID],
    ['\\u0035 for 5 in a string', edited('"claude-sonnet-5-5"', '"claude-sonnet-\\u0035-5"'), VALID],
    ['leading blank line', `\n${CANON}`, VALID],
  ];
  for (const [label, text, registration] of cases) assert.deepEqual(JSON.parse(text), registration, `${label} is the same registration`);
  refuseNotCanonical(cases);
});

t('a number the canonical form writes differently (1e999, -1e999, 1e-999, 2^53 + 1) is refused as not canonical', () => {
  refuseNotCanonical(NOT_CANONICAL.map((value) => [`margin = ${value.text}`, serialize(variant([['margin', value]]))]));
});

t('the canonical check is on the bytes: a byte that is not UTF-8 is refused though it decodes to the character JSON.stringify writes back', () => {
  // 0xFF decodes to U+FFFD, which JSON.stringify writes back as itself, EF BF BD: the decoded texts agree, the bytes do not.
  const good = Buffer.from(CANON, 'utf8');
  const model = Buffer.from('claude-sonnet-5-5', 'utf8');
  const at = good.indexOf(model);
  const bad = Buffer.concat([good.subarray(0, at), Buffer.from([0xff]), good.subarray(at + model.length)]);
  assert.equal(bad.toString('utf8'), `${JSON.stringify(JSON.parse(bad.toString('utf8')), null, 2)}\n`, 'as text it is canonical');
  const f = put('');
  writeFileSync(f, bad);
  commitQueued();
  for (const name of BOTH) assert.throws(() => LOADERS[name](f), (e) => e.message.includes('canonical form'), name);
});

t('the canonical check comes before validation: an invalid file in another form is refused as not canonical, an invalid canonical file by its field', () => {
  const invalid = variant([['margin', 0]]);
  refuseNotCanonical([['invalid and 4-space indent', `${JSON.stringify(invalid, null, 4)}\n`]]);
  const f = committed(invalid);
  for (const name of BOTH) assert.throws(() => LOADERS[name](f), (e) => e.message.includes('field margin ') && !e.message.includes('canonical form'), name);
});

t('the rewrite command in the refusal works: it collapses a repeat to its last value, and the result loads', () => {
  const [{ file, command }] = refuseNotCanonical([['top-level repeat', edited('"margin": 0.15,', '"margin": 0.15,\n  "margin": 0.9,')]]);
  execFileSync('sh', ['-c', command], { encoding: 'utf8' });
  assert.equal(readFileSync(file, 'utf8'), serialize(variant([['margin', 0.9]])), 'the rewrite is the canonical form of what JSON.parse read');
  assert.throws(() => loadS5Prereg(file), /differs from HEAD/, 'the registration commit has to show the change');
  assert.equal(loadS5Config(file, { mode: 'pilot' }).margin, 0.9);
  git(REPO, 'add', '--', file);
  git(REPO, 'commit', '-q', '-m', 'rewrite');
  assert.equal(loadS5Prereg(file).margin, 0.9);
});

t('the rewrite command quotes a path that holds a space and a quote', () => {
  const dir = join(ROOT, "a b'c");
  mkdirSync(dir);
  const file = loose(`${JSON.stringify(VALID, null, 4)}\n`, dir);
  let command;
  assert.throws(() => loadS5Config(file, { mode: 'pilot' }), (e) => {
    command = rewriteCommandOf(e.message);
    return e.message.includes(file);
  });
  execFileSync('sh', ['-c', command], { encoding: 'utf8' });
  assert.equal(readFileSync(file, 'utf8'), CANON);
  assert.deepEqual(loadS5Config(file, { mode: 'pilot' }), { ...VALID, registered: false });
});

// =====================================================================================================
// the shape: missing, null, wrong type, unknown
// =====================================================================================================

t('the shape walk saw every field of VALID (so the loops below miss none)', () => {
  assert.deepEqual(
    SHAPE.fields.slice().sort(),
    [
      'model', 'cli', 'cli.version', 'cli.sha256', 'arms', 'arms.A', 'arms.A.effort', 'arms.A.steer', 'arms.A.runs', 'arms.B', 'arms.B.effort', 'arms.B.steer', 'arms.B.runs',
      'arms.C', 'arms.C.effort', 'arms.C.steer', 'arms.C.runs', 'tasks', 'tasks[0]', 'tasks[0].id', 'tasks[0].treeHash', 'tasks[0].hiddenHash', 'tasks[0].promptHash', 'margin', 'alpha',
      'bound', 'bound.method', 'bound.resamples', 'bound.seed', 'orderSeed', 'mechanism', 'mechanism.alpha', 'mechanism.permutations', 'mechanism.seed', 'mechanism.effectSizeThinkingTokens',
      'limits', 'limits.timeoutMinutes', 'limits.cpus', 'limits.memoryGb', 'limits.concurrency', 'limits.infraRetries', 'images', 'images.codescout', 'images.claude-plugins', 'images.proxy',
      'proxyAllowlist', 'stopAtCostUsd',
    ].sort(),
  );
});

t('a missing, null or wrong-typed field is refused naming its path, for every field', () => {
  for (const path of SHAPE.fields) {
    refuse(path, [MISSING, null, otherType(valueAt(path))]);
  }
});

t('a missing or null field is refused as required, a field that is not defined as not known', () => {
  const required = ['model', 'cli', 'cli.sha256', 'arms', 'arms.C', 'arms.C.effort', 'tasks', 'tasks[0].id', 'bound.seed', 'limits.infraRetries', 'images.proxy', 'proxyAllowlist', 'stopAtCostUsd'];
  const cases = [];
  for (const path of required) for (const value of [MISSING, null]) cases.push({ path, value, say: `field ${path} is required and must not be null` });
  for (const path of ['extra', 'arms.A.extra', 'tasks[0].extra', 'images.extra']) cases.push({ path, value: 1, say: `field ${path} is not a known field` });
  const files = cases.map(({ path, value }) => put(variant([[path, value]])));
  commitQueued();
  cases.forEach(({ path, value, say }, i) => {
    for (const name of BOTH) assert.throws(() => LOADERS[name](files[i]), (e) => e.message.includes(say), `${name} with ${path} = ${show(value)}: wanted "${say}"`);
  });
});

t('a wrong-typed field is refused by name and says what it must be', () => {
  refuseCases([[['margin', 'x']]], 'margin');
  const f = committed(variant([['limits.concurrency', 'x']]));
  assert.throws(() => loadS5Prereg(f), /field limits\.concurrency must be a safe integer >= 1, got "x"/);
});

t('a field the registration does not define is refused naming its path, at every level', () => {
  for (const object of SHAPE.objects) {
    const path = object === '' ? 'extra' : `${object}.extra`;
    refuse(path, [1, null, 'x', false]);
  }
  refuse('arms.D', [{ effort: 'low', steer: false, runs: 1 }]);
});

t('__proto__ and constructor keys are refused as unknown fields, at the top level and nested', () => {
  // JSON.parse makes `__proto__` an own property and JSON.stringify writes it back, so a file holding one IS in canonical form
  // (R65 does not refuse it): what refuses it is the unknown-key check, which names the key. `constructor` is an ordinary key.
  const canonicalOf = (text) => `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  const places = [
    ['{\n  "model"', '{\n  "KEY": 1,\n  "model"', 'KEY'],
    ['"arms": {', '"arms": {\n    "KEY": 1,', 'arms.KEY'],
    ['"A": {', '"A": {\n      "KEY": 1,', 'arms.A.KEY'],
    ['"tasks": [\n    {', '"tasks": [\n    {\n      "KEY": 1,', 'tasks[0].KEY'],
    ['"images": {', '"images": {\n    "KEY": 1,', 'images.KEY'],
  ];
  const cases = [];
  for (const key of ['__proto__', 'constructor']) {
    for (const [needle, replacement, path] of places) {
      const text = canonicalOf(edited(needle, replacement.replace('KEY', key)));
      assert.ok(text.includes(`"${key}": 1`), 'the key is in the file');
      cases.push({ text, say: `field ${path.replace('KEY', key)} is not a known field` });
    }
  }
  const files = cases.map(({ text }) => put(text));
  commitQueued();
  cases.forEach(({ text, say }, i) => {
    assert.equal(canonicalOf(text), text, 'the file is in canonical form, so the refusal below is the unknown-key one');
    for (const name of BOTH) assert.throws(() => LOADERS[name](files[i]), (e) => e.message.includes(say) && !e.message.includes('canonical form'), `${name}: wanted "${say}"`);
  });
});

// =====================================================================================================
// arms
// =====================================================================================================

t('EFFORTS is the one effort order, exported by s4-prereg (R60)', () => {
  assert.deepEqual(EFFORTS, LEVELS);
});

t('every arm effort must be one of the five levels', () => {
  for (const arm of ['A', 'B', 'C']) refuse(`arms.${arm}.effort`, ['ultra', 'XHIGH', 'Low', 'x-high', '', ' low', 'low\n']);
});

t('A and B must carry the same effort (the steer is their only difference); naming arms.B.effort', () => {
  const same = [];
  const differ = [];
  // C stays `low`, below every A that is not `low`; with A `low` nothing is below, so only the blame is checked there.
  for (const a of LEVELS) {
    for (const b of LEVELS) {
      if (a === b && a !== 'low') same.push([['arms.A.effort', a], ['arms.B.effort', b]]);
      if (a !== b) differ.push([['arms.A.effort', a], ['arms.B.effort', b]]);
    }
  }
  assert.equal(same.length, 4);
  assert.equal(differ.length, 20);
  acceptCases(same);
  refuseCases(differ, 'arms.B.effort');
});

t('C must sit strictly below A in low < medium < high < xhigh < max, for every pair (B follows A)', () => {
  const below = [];
  const notBelow = [];
  for (const a of LEVELS) {
    for (const c of LEVELS) {
      (LEVELS.indexOf(c) < LEVELS.indexOf(a) ? below : notBelow).push([['arms.A.effort', a], ['arms.B.effort', a], ['arms.C.effort', c]]);
    }
  }
  assert.equal(below.length, 10);
  assert.equal(notBelow.length, 15);
  acceptCases(below);
  refuseCases(notBelow, 'arms.C.effort');
});

t('the steer flags are exactly A false, B true, C false', () => {
  refuse('arms.A.steer', [true, 'false', 0, 1]);
  refuse('arms.B.steer', [false, 'true', 0, 1]);
  refuse('arms.C.steer', [true, 'false', 0, 1]);
  accept('arms.A.steer', [false]);
  accept('arms.B.steer', [true]);
  accept('arms.C.steer', [false]);
});

t('measured runs: A and B at least 2, C at least 1 (loadS5Prereg)', () => {
  refuse('arms.A.runs', [1, 0, -1], { only: ['prereg'] });
  refuse('arms.B.runs', [1, 0, -1], { only: ['prereg'] });
  refuse('arms.C.runs', [0, -1], { only: ['prereg'] });
  accept('arms.A.runs', [2, 3, 50], { only: ['prereg'] });
  accept('arms.B.runs', [2, 3, 50], { only: ['prereg'] });
  accept('arms.C.runs', [1, 2, 50], { only: ['prereg'] });
});

t('runs are safe integers in both loaders: a fraction, a string, an unsafe integer and Infinity are refused', () => {
  for (const arm of ['A', 'B', 'C']) {
    refuse(`arms.${arm}.runs`, [2.5, '3', UNSAFE, true]);
    refuse(`arms.${arm}.runs`, [-1], { only: ['config'] });
  }
});

t('loadS5Config (R2): any arm may have 0 runs, so calibration needs no B arm to run', () => {
  for (const arm of ['A', 'B', 'C']) accept(`arms.${arm}.runs`, [0, 1], { only: ['config'] });
  acceptCases([[['arms.A.runs', 2], ['arms.B.runs', 0], ['arms.C.runs', 1]], [['arms.A.runs', 0], ['arms.B.runs', 0], ['arms.C.runs', 0]]], { only: ['config'] });
});

// =====================================================================================================
// tasks
// =====================================================================================================

t('loadS5Prereg needs at least 8 tasks: 7 refused, 8 and 9 load', () => {
  refuseCases([[['tasks', VALID.tasks.slice(0, 7)]], [['tasks', []]], [['tasks', VALID.tasks.slice(0, 1)]]], 'tasks', { only: ['prereg'] });
  acceptCases([[['tasks', VALID.tasks]], [['tasks', [...VALID.tasks, NINTH_TASK]]]], { only: ['prereg'] });
});

t('loadS5Config (R2) needs at least 1 task: none refused, 1 and 7 load', () => {
  refuseCases([[['tasks', []]]], 'tasks', { only: ['config'] });
  acceptCases([[['tasks', VALID.tasks.slice(0, 1)]], [['tasks', VALID.tasks.slice(0, 7)]], [['tasks', VALID.tasks]]], { only: ['config'] });
});

t('a task id follows the task-def id rule (R92: a letter or digit first, then letters, digits and dashes, 48 characters at most), and must be a string', () => {
  assert.ok(TASK_ID_RE.test('task-1') && !TASK_ID_RE.test('Task-1'), 'the rule this test assumes');
  refuse('tasks[3].id', ['Task-1', 'task_1', 'task 1', 'a/b', '../x', '', '.', '..', 'tâsk', 'task-1\n', 5, true, ['task-x'], '-', '-x', '--', '-task-1', 'x'.repeat(49), `1${'-'.repeat(48)}`, 'x'.repeat(62), 'x'.repeat(200)]);
  accept('tasks[3].id', ['a', '0', 'a-b-0', 'a-', '9-', 'task-99', 'x'.repeat(47), 'x'.repeat(48), `1${'-'.repeat(47)}`]);
});

t('task ids are unique: a repeat is refused naming the second one', () => {
  refuseCases([[['tasks[5].id', VALID.tasks[2].id]]], 'tasks[5].id');
  refuseCases([[['tasks[7].id', VALID.tasks[0].id]]], 'tasks[7].id');
  refuseCases([[['tasks[1].id', VALID.tasks[0].id]]], 'tasks[1].id');
});

t('a task hash is 64 lowercase hex characters, as a string', () => {
  for (const key of ['treeHash', 'hiddenHash', 'promptHash']) {
    refuse(`tasks[3].${key}`, [hex(1).slice(1), `${hex(1)}0`, hex(0xabc).toUpperCase(), `g${hex(1).slice(1)}`, '', ` ${hex(1)}`, `${hex(1)}\n`, digest(1), 5, true, [hex(1)]]);
    accept(`tasks[3].${key}`, [hex(0xabcdef), '0123456789abcdef'.repeat(4)]);
  }
});

// =====================================================================================================
// the numbers
// =====================================================================================================

t('model is a non-blank string', () => {
  refuse('model', ['', ' ', '\n\t', 5, true]);
  accept('model', ['m', 'claude-sonnet-5-5']);
});

t('cli.version is a non-blank string', () => {
  refuse('cli.version', ['', ' ', '\n\t', 5, 2.1]);
  accept('cli.version', ['2.1.292', 'x']);
});

t('margin lies strictly between 0 and 1', () => {
  refuse('margin', [0, 1, -0.15, 1.5, '0.15']);
  accept('margin', [0.0001, 0.15, 0.9999]);
});

t('alpha lies in (0, 0.1]: 0.1 loads, the next double above it is refused', () => {
  refuse('alpha', [0, -0.05, 0.11, 0.5, 1, '0.05', raw('0.10000000000000002')]);
  accept('alpha', [0.1, 0.05, 0.001, 1e-9]);
});

t('bound.method is percentile or paired-t', () => {
  refuse('bound.method', ['bootstrap', 'Percentile', 'paired_t', 'paired-t ', 'paired-T', '', 5]);
  accept('bound.method', ['percentile', 'paired-t']);
});

t('percentile needs at least 2000 resamples: 1999 refused, 2000 loads', () => {
  refuse('bound.resamples', [1999, 1000, 1, 0, -2000, 2000.5, '2000', UNSAFE]);
  accept('bound.resamples', [2000, 2001, 10000]);
});

t('paired-t sets no resample floor but still wants a non-negative safe integer', () => {
  const paired = [['bound.method', 'paired-t']];
  accept('bound.resamples', [0, 1, 1999, 2000, 10000], { extra: paired });
  refuse('bound.resamples', [-1, 1.5, '1999', UNSAFE, true], { extra: paired });
});

t('every seed is a safe integer, negative included (makeRng takes any)', () => {
  for (const path of ['bound.seed', 'orderSeed', 'mechanism.seed']) {
    refuse(path, [1.5, '7', UNSAFE, true]);
    accept(path, [0, 7, -7, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
  }
});

t('mechanism.alpha lies strictly between 0 and 1', () => {
  refuse('mechanism.alpha', [0, 1, -0.05, 1.5, '0.05']);
  accept('mechanism.alpha', [0.05, 0.5, 0.001, 0.9]);
});

t('mechanism.permutations is at least ceil(1 / alpha) - 1: the floor loads, one less is refused', () => {
  // [alpha, ceil(1 / alpha) - 1], checked by hand: 1/0.05 = 20, 1/0.1 = 10, 1/0.03 = 33.3, 1/0.3 = 3.3, 1/0.5 = 2, 1/0.9 = 1.1, 1/0.01 = 100.
  for (const [alpha, floor] of [[0.05, 19], [0.1, 9], [0.03, 33], [0.3, 3], [0.5, 1], [0.9, 1], [0.01, 99]]) {
    acceptCases([[['mechanism.alpha', alpha], ['mechanism.permutations', floor]], [['mechanism.alpha', alpha], ['mechanism.permutations', floor + 1]], [['mechanism.alpha', alpha], ['mechanism.permutations', 5000]]]);
    refuseCases([[['mechanism.alpha', alpha], ['mechanism.permutations', floor - 1]]], 'mechanism.permutations');
  }
});

t('mechanism.permutations is a safe integer', () => {
  refuse('mechanism.permutations', [19.5, 1000.5, '1000', UNSAFE, -1, 0, true]);
  accept('mechanism.permutations', [19, 20, 1000]);
});

t('mechanism.alpha so small that no safe integer reaches the floor is refused', () => {
  refuseCases([[['mechanism.alpha', 1e-300], ['mechanism.permutations', Number.MAX_SAFE_INTEGER]], [['mechanism.alpha', raw('5e-324')], ['mechanism.permutations', Number.MAX_SAFE_INTEGER]]], 'mechanism.permutations');
});

t('mechanism.effectSizeThinkingTokens is a finite number above 0', () => {
  refuse('mechanism.effectSizeThinkingTokens', [0, -1, -0.5, '500', true]);
  accept('mechanism.effectSizeThinkingTokens', [0.5, 500, 1e6]);
});

t('limits.timeoutMinutes is a safe integer from 1 to 240', () => {
  refuse('limits.timeoutMinutes', [0, -1, 241, 1000, 0.5, 1.5, 240.5, '90', UNSAFE]);
  accept('limits.timeoutMinutes', [1, 2, 90, 239, 240]);
});

t('limits.cpus and limits.memoryGb are finite numbers above 0', () => {
  for (const path of ['limits.cpus', 'limits.memoryGb']) {
    refuse(path, [0, -1, -0.5, '4', true]);
    accept(path, [0.5, 1, 4, 64]);
  }
});

t('limits.concurrency is a safe integer of at least 1', () => {
  refuse('limits.concurrency', [0, -1, 1.5, '2', UNSAFE, true]);
  accept('limits.concurrency', [1, 2, 16]);
});

t('limits.infraRetries is a safe integer from 0 to 5: 0 and 5 load, -1 and 6 are refused', () => {
  refuse('limits.infraRetries', [-1, 6, 7, 100, 2.5, '2', UNSAFE, true]);
  accept('limits.infraRetries', [0, 1, 4, 5]);
});

t('stopAtCostUsd is a finite number above 0', () => {
  refuse('stopAtCostUsd', [0, -1, -0.01, '100', true]);
  accept('stopAtCostUsd', [0.01, 1, 100, 1e6]);
});

// =====================================================================================================
// digests (R22, R49)
// =====================================================================================================

t('the cli sha256 and every image digest are sha256: plus 64 lowercase hex characters', () => {
  const bad = [
    hex(5), // no prefix
    `sha256:${hex(5).slice(1)}`, // 63
    `sha256:${hex(5)}0`, // 65
    `sha256:${'A'.repeat(64)}`,
    `sha256:${'g'.repeat(64)}`,
    `SHA256:${hex(5)}`,
    `sha1:${hex(5)}`,
    ` sha256:${hex(5)}`,
    `sha256:${hex(5)}\n`,
    'sha256:',
    '',
    5,
    true,
    [digest(5)], // an array of one string coerces to that string
  ];
  const good = [digest(0xabcdef), `sha256:${'0123456789abcdef'.repeat(4)}`];
  for (const path of ['cli.sha256', 'images.codescout', 'images.claude-plugins', 'images.proxy']) {
    refuse(path, bad);
    accept(path, good);
  }
});

t('images names exactly the repos of IMAGE_FOR_REPO plus proxy; the digests.json image names are not accepted as keys', () => {
  assert.deepEqual(Object.keys(VALID.images).sort(), [...Object.keys(IMAGE_FOR_REPO), 'proxy'].sort());
  refuse('images', [{ 's5/codescout': digest(1), 's5/plugins': digest(2), 's5/proxy': digest(3) }], { field: 'images.s5/codescout' });
  refuse('images', [{ codescout: digest(1), 'claude-plugins': digest(2) }], { field: 'images.proxy' });
  refuse('images', [{ codescout: digest(1), proxy: digest(3) }], { field: 'images.claude-plugins' });
  refuse('images', [{ ...VALID.images, plugins: digest(9) }], { field: 'images.plugins' });
});

const DIGESTS = fileURLToPath(new URL('./images/digests.json', import.meta.url));
if (existsSync(DIGESTS)) {
  t('the digests images/build.sh wrote, copied by image name, make a prereg that loads (R22)', () => {
    const d = JSON.parse(readFileSync(DIGESTS, 'utf8'));
    const images = { codescout: d[IMAGE_FOR_REPO.codescout], 'claude-plugins': d[IMAGE_FOR_REPO['claude-plugins']], proxy: d[PROXY_IMAGE] };
    assert.ok(Object.values(images).every((v) => typeof v === 'string'), `digests.json lacks an image: ${JSON.stringify(images)}`);
    assert.deepEqual(loadS5Prereg(committed(variant([['images', images]]))).images, images);
  });
} else {
  console.log('skip - the real images/digests.json check: images/digests.json is not built here (images/build.sh writes it)');
}

// =====================================================================================================
// the proxy allowlist (R50)
// =====================================================================================================

t('proxyAllowlist is a non-empty array', () => {
  refuse('proxyAllowlist', [[], 'api.anthropic.com', { 'api.anthropic.com': true }, 5]);
  accept('proxyAllowlist', [['api.anthropic.com'], ['a'], ['api.anthropic.com', 'statsig.anthropic.com', 'a.b.c.example.net']]);
});

t('an allowlist entry is accepted exactly when the proxy accepts it: one predicate, hostPattern', () => {
  const accepted = (h) => {
    try {
      hostPattern(h);
      return true;
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      return false;
    }
  };
  const LONG = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`; // 253 characters
  const entries = [
    'api.anthropic.com', 'a', 'a-b.example.com', 'API.Anthropic.com', '1.2.3.4', 'localhost', `${'x'.repeat(63)}.com`, `${'x'.repeat(64)}.com`, LONG, `${LONG}e`,
    'https://api.anthropic.com', 'http://a.com', 'api.anthropic.com:443', '*.anthropic.com', '*', 'api.anthropic.com/v1', 'api.anthropic.com/', '', ' ', ' a.com', 'a.com ', 'a.com\n',
    '-a.com', 'a-.com', 'a..com', '.a.com', 'a.com.', 'a b.com', 'é.com', 'a_b.com', 'a@b.com', 'a,b.com',
    5, null, true, ['a.com'], {},
  ];
  assert.ok(entries.some(accepted) && entries.some((e) => !accepted(e)), 'the table covers both outcomes');
  const good = entries.filter(accepted);
  const bad = entries.filter((e) => !accepted(e));
  acceptCases(good.map((entry) => [['proxyAllowlist', ['statsig.example.net', entry]]]));
  refuseCases(bad.map((entry) => [['proxyAllowlist', ['statsig.example.net', entry]]]), 'proxyAllowlist[1]');
  // The refusal names the entry itself, not only its index.
  const files = bad.map((entry) => put(variant([['proxyAllowlist', ['statsig.example.net', entry]]])));
  commitQueued();
  bad.forEach((entry, i) => {
    for (const name of BOTH) {
      assert.throws(() => LOADERS[name](files[i]), (e) => e.message.includes(JSON.stringify(entry)), `${name}: the refusal names the entry ${JSON.stringify(entry)}`);
    }
  });
});

t('a bad entry anywhere in the list is blamed at its own index', () => {
  refuseCases([[['proxyAllowlist', ['https://x.com', 'a.com', 'b.com']]]], 'proxyAllowlist[0]');
  refuseCases([[['proxyAllowlist', ['a.com', 'b.com', 'c.com:1']]]], 'proxyAllowlist[2]');
});

t('a duplicate entry is refused naming the second one, case aside (the proxy lower-cases)', () => {
  refuseCases([[['proxyAllowlist', ['a.com', 'a.com']]], [['proxyAllowlist', ['a.com', 'A.com']]]], 'proxyAllowlist[1]');
  refuseCases([[['proxyAllowlist', ['a.com', 'b.com', 'a.com']]], [['proxyAllowlist', ['A.COM', 'b.com', 'a.com']]]], 'proxyAllowlist[2]');
  accept('proxyAllowlist', [['a.com', 'a.com.evil.com', 'xa.com', 'b.a.com']]);
});

// =====================================================================================================
// checkTasksMatch (R51)
// =====================================================================================================

let workNo = 0;
// <root>/tasks/<id>/manifest.json for every task of `tasks`, in the shape build-task.mjs writes.
function workRootFor(tasks) {
  const root = join(ROOT, `work-${workNo++}`);
  for (const task of tasks) {
    const dir = join(root, 'tasks', task.id);
    mkdirSync(dir, { recursive: true });
    const manifest = {
      id: task.id, repo: 'codescout', fix: 'f'.repeat(40), parent: 'a'.repeat(40), baseCommit: 'b'.repeat(40),
      treeHash: task.treeHash, hiddenHash: task.hiddenHash, promptHash: task.promptHash, taskMdHash: hex(0x999), def: { id: task.id },
    };
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return root;
}
const manifestFile = (root, id) => join(root, 'tasks', id, 'manifest.json');
function patchManifest(root, id, patch) {
  const f = manifestFile(root, id);
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), ...patch }));
}

t('checkTasksMatch returns nothing when every manifest carries the registered hashes, for a loaded prereg too', () => {
  const root = workRootFor(VALID.tasks);
  assert.deepEqual(checkTasksMatch(VALID, root), []);
  assert.deepEqual(checkTasksMatch(loadS5Prereg(committed(VALID)), root), []);
});

t('checkTasksMatch names a task whose manifest treeHash differs', () => {
  const root = workRootFor(VALID.tasks);
  patchManifest(root, 'task-3', { treeHash: hex(0xdead) });
  assert.deepEqual(checkTasksMatch(VALID, root), ['task-3']);
});

t('checkTasksMatch names a task whose manifest hiddenHash differs', () => {
  const root = workRootFor(VALID.tasks);
  patchManifest(root, 'task-5', { hiddenHash: hex(0xdead) });
  assert.deepEqual(checkTasksMatch(VALID, root), ['task-5']);
});

t('checkTasksMatch names a task whose manifest promptHash differs', () => {
  const root = workRootFor(VALID.tasks);
  patchManifest(root, 'task-8', { promptHash: hex(0xdead) });
  assert.deepEqual(checkTasksMatch(VALID, root), ['task-8']);
});

t('checkTasksMatch compares each hash as an exact string: a case change, a trailing newline or a number is a mismatch', () => {
  // The hashes of VALID are all digits, so this prereg carries letters for the case change to bite on.
  const tasks = ['t-1', 't-2', 't-3', 't-4'].map((id, i) => ({ id, treeHash: hex(0xabc0 + i), hiddenHash: hex(0xdef0 + i), promptHash: hex(0xfab0 + i) }));
  const root = workRootFor(tasks);
  assert.deepEqual(checkTasksMatch({ tasks }, root), []);
  patchManifest(root, 't-1', { treeHash: tasks[0].treeHash.toUpperCase() });
  patchManifest(root, 't-2', { hiddenHash: `${tasks[1].hiddenHash}\n` });
  patchManifest(root, 't-3', { promptHash: 0xfab2 });
  assert.deepEqual(checkTasksMatch({ tasks }, root), ['t-1', 't-2', 't-3']);
  // A hash of digits only equals the number it reads as under `==`: the manifest holds that number, the registration the string.
  const digits = VALID.tasks.slice(0, 1);
  const digitsRoot = workRootFor(digits);
  patchManifest(digitsRoot, digits[0].id, { treeHash: 100 });
  assert.equal(digits[0].treeHash, hex(0x100));
  assert.deepEqual(checkTasksMatch({ tasks: digits }, digitsRoot), [digits[0].id]);
});

t('checkTasksMatch names every mismatch, in the registered order', () => {
  const root = workRootFor(VALID.tasks);
  patchManifest(root, 'task-7', { treeHash: hex(1) });
  patchManifest(root, 'task-2', { promptHash: hex(2) });
  patchManifest(root, 'task-4', { hiddenHash: hex(3) });
  assert.deepEqual(checkTasksMatch(VALID, root), ['task-2', 'task-4', 'task-7']);
});

t('checkTasksMatch fails closed: a manifest that is missing or unreadable is named too', () => {
  const root = workRootFor(VALID.tasks);
  rmSync(join(root, 'tasks', 'task-1'), { recursive: true }); // no manifest at all
  writeFileSync(manifestFile(root, 'task-2'), '{ "treeHash": '); // not JSON
  writeFileSync(manifestFile(root, 'task-3'), 'null');
  writeFileSync(manifestFile(root, 'task-4'), '[]');
  writeFileSync(manifestFile(root, 'task-5'), '');
  rmSync(manifestFile(root, 'task-6'));
  mkdirSync(manifestFile(root, 'task-6')); // a directory where the file should be
  assert.deepEqual(checkTasksMatch(VALID, root), ['task-1', 'task-2', 'task-3', 'task-4', 'task-5', 'task-6']);
});

t('checkTasksMatch fails closed: a manifest without a hash field is named, even when the prereg task lacks it as well', () => {
  const root = workRootFor(VALID.tasks);
  const f = manifestFile(root, 'task-3');
  const m = JSON.parse(readFileSync(f, 'utf8'));
  delete m.treeHash;
  writeFileSync(f, JSON.stringify(m));
  assert.deepEqual(checkTasksMatch(VALID, root), ['task-3']);
  const bare = { tasks: [{ id: 'bare' }] };
  mkdirSync(join(root, 'tasks', 'bare'), { recursive: true });
  writeFileSync(manifestFile(root, 'bare'), JSON.stringify({ id: 'bare' }));
  assert.deepEqual(checkTasksMatch(bare, root), ['bare']);
});

t('checkTasksMatch names every task when the work root has no tasks directory', () => {
  assert.deepEqual(checkTasksMatch(VALID, join(ROOT, 'no-such-work-root')), VALID.tasks.map((x) => x.id));
});

t('checkTasksMatch never builds a path from an id outside the id rule: the id is named, not read', () => {
  const root = workRootFor(VALID.tasks);
  // <root>/tasks/../outside/manifest.json would match the hashes below, were the id used as a path segment.
  const outside = { id: '../outside', treeHash: hex(1), hiddenHash: hex(2), promptHash: hex(3) };
  mkdirSync(join(root, 'outside'), { recursive: true });
  writeFileSync(join(root, 'outside', 'manifest.json'), JSON.stringify(outside));
  assert.ok(existsSync(join(root, 'tasks', '..', 'outside', 'manifest.json')));
  assert.deepEqual(checkTasksMatch({ tasks: [outside] }, root), ['../outside']);
  // A number is not an id even though `${5}` is '5', which the rule allows, and a matching manifest sits at tasks/5.
  mkdirSync(join(root, 'tasks', '5'), { recursive: true });
  writeFileSync(join(root, 'tasks', '5', 'manifest.json'), JSON.stringify(outside));
  assert.deepEqual(checkTasksMatch({ tasks: [{ ...outside, id: 5 }] }, root), [5]);
  assert.deepEqual(checkTasksMatch({ tasks: [{ ...outside, id: 'Task-1' }, { ...outside, id: '' }, { ...outside, id: 5 }] }, root), ['Task-1', '', 5]);
});
