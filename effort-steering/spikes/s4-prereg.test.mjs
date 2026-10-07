import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync, utimesSync, statSync, chmodSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../core/testkit.mjs';
import { loadPrereg } from './s4-prereg.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 's4-prereg-'));
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

const VALID = {
  direction: 'down',
  effectSizeThinkingTokens: 500,
  latencyBudgetMs: 2000,
  holdoutRate: 0.25,
  repeats: 5,
  minPerArm: 4,
  model: 'm-test',
  prompts: ['prompt one', 'prompt two', 'prompt three', 'prompt four'],
  steerLevel: 'shallow',
  alpha: 0.05,
  permutations: 1000,
  seed: 12345,
};

// Raw text, for numbers JSON.stringify cannot write (1e999, 2^53 + 1). The last three
// arguments are the R24 fields, raw too.
const RAW = (eff, lat, alpha = '0.05', perms = '1000', seed = '12345') =>
  `{"direction":"down","effectSizeThinkingTokens":${eff},"latencyBudgetMs":${lat},"holdoutRate":0.25,"repeats":5,"minPerArm":4,"model":"m","prompts":["a a","b b","c c","d d"],"steerLevel":"shallow","alpha":${alpha},"permutations":${perms},"seed":${seed}}`;
// Four distinct two-word prompts, with `p` substituted at index i.
const promptsWith = (i, p) => ['w a', 'w b', 'w c', 'w d'].map((s, k) => (k === i ? p : s));

let n = 0;
// Write a prereg file in the repo; commit it unless told otherwise.
function put(obj, { commit = true } = {}) {
  const f = join(REPO, `prereg-${n++}.json`);
  writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  if (commit) {
    git(REPO, 'add', '--', f);
    git(REPO, 'commit', '-q', '-m', 'add');
  }
  return f;
}

function throwsNaming(obj, field) {
  const f = put(obj);
  assert.throws(() => loadPrereg(f), (e) => e instanceof Error && e.message.includes(field), `expected error naming ${field}`);
}

t('valid committed file loads and returns the object', () => {
  assert.deepEqual(loadPrereg(put(VALID)), VALID);
});

t('deep + up is a valid pairing', () => {
  const v = { ...VALID, steerLevel: 'deep', direction: 'up' };
  assert.deepEqual(loadPrereg(put(v)), v);
});

t('boundary values load: repeats 3, minPerArm 3, 4 prompts', () => {
  const v = { ...VALID, repeats: 3, minPerArm: 3 };
  assert.deepEqual(loadPrereg(put(v)), v);
});

t('missing or null field throws naming it', () => {
  for (const k of Object.keys(VALID)) {
    const missing = { ...VALID };
    delete missing[k];
    throwsNaming(missing, k);
    throwsNaming({ ...VALID, [k]: null }, k);
  }
});

t('null numbers throw naming the field', () => {
  throwsNaming({ ...VALID, effectSizeThinkingTokens: null }, 'effectSizeThinkingTokens');
  throwsNaming({ ...VALID, latencyBudgetMs: null }, 'latencyBudgetMs');
});

t('effectSizeThinkingTokens must be a positive finite number', () => {
  for (const bad of [0, -1, '5']) {
    throwsNaming({ ...VALID, effectSizeThinkingTokens: bad }, 'effectSizeThinkingTokens');
  }
  // JSON.stringify writes NaN/Infinity as null, so hand-write the raw text.
  throwsNaming(RAW('1e999', 2000), 'effectSizeThinkingTokens');
});

t('latencyBudgetMs must be a positive finite number', () => {
  for (const bad of [0, -5, '100']) throwsNaming({ ...VALID, latencyBudgetMs: bad }, 'latencyBudgetMs');
  throwsNaming(RAW(500, '1e999'), 'latencyBudgetMs');
});

t('latencyBudgetMs must be a safe integer: 150.5 throws naming the field, 1 loads', () => {
  throwsNaming({ ...VALID, latencyBudgetMs: 150.5 }, 'latencyBudgetMs');
  throwsNaming(RAW(500, '9007199254740993'), 'latencyBudgetMs');
  assert.equal(loadPrereg(put({ ...VALID, latencyBudgetMs: 1 })).latencyBudgetMs, 1);
});

// ---- R24: the registered permutation test ----

t('alpha must be a finite number strictly between 0 and 1', () => {
  for (const bad of [0, 1, -0.1, 1.5, '0.05', true]) throwsNaming({ ...VALID, alpha: bad }, 'alpha');
  throwsNaming(RAW(500, 2000, '1e999'), 'alpha');
  // 10 repeats at rate 0.25 is 3 holdout runs per prompt: 120^4 labelings, so even 0.0001 is reachable.
  for (const ok of [0.0001, 0.05, 0.9999]) assert.equal(loadPrereg(put({ ...VALID, repeats: 10, permutations: 20000, alpha: ok })).alpha, ok);
});

t('permutations must be a safe integer >= 1', () => {
  for (const bad of [0, -1, 1.5, '100', true]) throwsNaming({ ...VALID, permutations: bad }, 'permutations');
  throwsNaming(RAW(500, 2000, '0.05', '1e300'), 'permutations');
  assert.equal(loadPrereg(put({ ...VALID, alpha: 0.5, permutations: 1 })).permutations, 1);
});

// ---- R25: feasibility. A registered number the runner could never satisfy must not load. ----

t('permutations must reach the alpha grain: permutations >= ceil(1 / alpha) - 1', () => {
  // alpha 0.05: the smallest p is 1 / (1 + permutations), so 19 draws reach 0.05 and 18 stop at 1/19.
  assert.equal(loadPrereg(put({ ...VALID, alpha: 0.05, permutations: 19 })).permutations, 19);
  throwsNaming({ ...VALID, alpha: 0.05, permutations: 18 }, 'permutations');
  // alpha 0.25 is exact in binary: 3 draws reach it, 2 do not.
  assert.equal(loadPrereg(put({ ...VALID, alpha: 0.25, permutations: 3 })).permutations, 3);
  throwsNaming({ ...VALID, alpha: 0.25, permutations: 2 }, 'permutations');
  // the registered 10000 reaches any alpha down to 1 / 10001
  assert.equal(loadPrereg(put({ ...VALID, repeats: 10, alpha: 0.0001, permutations: 9999 })).permutations, 9999);
  throwsNaming({ ...VALID, repeats: 10, alpha: 0.0001, permutations: 9998 }, 'permutations');
});

// 4 prompts x 4 repeats at rate 0.25 is 1 holdout run per prompt: C(4, 1) = 4 labelings each,
// 4^4 = 256 = 2^8 in all, so 1 / 256 is exact in binary and ulp(1 / 256) is 2^-60.
const EXACT = { ...VALID, repeats: 4, minPerArm: 3, permutations: 100000 };

t('alpha must exceed the exact permutation floor 1 / C(repeats, h)^k', () => {
  throwsNaming({ ...EXACT, alpha: 1 / 256 }, 'alpha'); // exactly at the floor: not above it
  throwsNaming({ ...EXACT, alpha: 1 / 256 - 2 ** -61 }, 'alpha'); // the double just below
  assert.equal(loadPrereg(put({ ...EXACT, alpha: 1 / 256 + 2 ** -60 })).alpha, 1 / 256 + 2 ** -60); // the double just above
  throwsNaming({ ...EXACT, alpha: 0.003 }, 'alpha');
  assert.equal(loadPrereg(put({ ...EXACT, alpha: 0.004 })).alpha, 0.004);
});

t('the floor follows the runner arm count: 4 prompts x 3 repeats at rate 0.4 is 1 / 3^4', () => {
  const v = { ...VALID, repeats: 3, holdoutRate: 0.4, minPerArm: 3 }; // round(1.2) = 1 holdout run per prompt
  throwsNaming({ ...v, alpha: 0.012 }, 'alpha'); // below 1/81 = 0.012346
  throwsNaming({ ...v, alpha: 1 / 81 }, 'alpha'); // the double nearest 1/81 lies just below 1/81
  assert.equal(loadPrereg(put({ ...v, alpha: 0.0124 })).alpha, 0.0124);
});

t('the floor is reachable for the registered shape: 12 prompts x 4 repeats at rate 0.5 is 1 / 6^12', () => {
  const prompts = Array.from({ length: 12 }, (_, i) => `prompt number ${i}`);
  const v = { ...VALID, prompts, repeats: 4, holdoutRate: 0.5, minPerArm: 24, permutations: 10000 };
  assert.equal(loadPrereg(put(v)).alpha, 0.05);
});

t('the floor does not overflow or hang: a huge repeats or many prompts load, they are not read as a zero floor', () => {
  const many = Array.from({ length: 300 }, (_, i) => `prompt number ${i}`);
  // C(5000, 2500) is about 10^1503: a float product is Infinity, a float ratio NaN.
  assert.equal(loadPrereg(put({ ...VALID, repeats: 5000, holdoutRate: 0.5, prompts: many })).repeats, 5000);
  // C(10^15, h) has as many digits as no machine can build; the loader must stop early.
  assert.equal(loadPrereg(put({ ...VALID, repeats: 10 ** 15 })).repeats, 10 ** 15);
});

t('minPerArm must fit both planned arm totals: k x (repeats - h) treated and k x h holdout', () => {
  // VALID: 4 prompts x 5 repeats at rate 0.25 is h = 1, so 16 treated and 4 holdout runs.
  assert.equal(loadPrereg(put({ ...VALID, minPerArm: 4 })).minPerArm, 4); // exactly the holdout total
  throwsNaming({ ...VALID, minPerArm: 5 }, 'minPerArm'); // one past it
  // 4 prompts x 3 repeats at rate 0.5 is h = 2, so 4 treated and 8 holdout runs.
  const v = { ...VALID, repeats: 3, holdoutRate: 0.5 };
  assert.equal(loadPrereg(put({ ...v, minPerArm: 4 })).minPerArm, 4); // exactly the treated total
  throwsNaming({ ...v, minPerArm: 5 }, 'minPerArm'); // one past it; the holdout total (8) would allow it
});

t('minPerArm uses the clamped arm count: rate 0.1 still holds out one run, rate 0.99 still treats one', () => {
  // 4 prompts x 4 repeats at rate 0.1: round(0.4) = 0 is clamped to 1, so 12 treated and 4 holdout runs.
  const low = { ...VALID, repeats: 4, holdoutRate: 0.1 };
  assert.equal(loadPrereg(put({ ...low, minPerArm: 4 })).minPerArm, 4);
  throwsNaming({ ...low, minPerArm: 5 }, 'minPerArm');
  // rate 0.99: round(3.96) = 4 is clamped to 3, so 4 treated and 12 holdout runs.
  const high = { ...VALID, repeats: 4, holdoutRate: 0.99 };
  assert.equal(loadPrereg(put({ ...high, minPerArm: 4 })).minPerArm, 4);
  throwsNaming({ ...high, minPerArm: 5 }, 'minPerArm');
});

t('seed must be a safe integer (negative and zero allowed)', () => {
  for (const bad of [1.5, '1', true, [1]]) throwsNaming({ ...VALID, seed: bad }, 'seed');
  throwsNaming(RAW(500, 2000, '0.05', '1000', '9007199254740993'), 'seed');
  throwsNaming(RAW(500, 2000, '0.05', '1000', '1e300'), 'seed');
  for (const ok of [0, -5, Number.MAX_SAFE_INTEGER]) assert.equal(loadPrereg(put({ ...VALID, seed: ok })).seed, ok);
});

t('a missing or null R24 field is reported as required, like every other field', () => {
  for (const k of ['alpha', 'permutations', 'seed']) {
    const missing = { ...VALID };
    delete missing[k];
    for (const obj of [missing, { ...VALID, [k]: null }]) {
      const f = put(obj);
      assert.throws(() => loadPrereg(f), new RegExp(`field ${k} is required and must not be null`), k);
    }
  }
});

t('holdoutRate must be strictly inside (0, 1)', () => {
  for (const bad of [0, 1, -0.1, 1.5, '0.5']) throwsNaming({ ...VALID, holdoutRate: bad }, 'holdoutRate');
});

t('repeats must be an integer >= 3', () => {
  for (const bad of [2, 0, 3.5, '3']) throwsNaming({ ...VALID, repeats: bad }, 'repeats');
});

t('minPerArm must be an integer >= 3', () => {
  for (const bad of [2, 0, 3.5, '3']) throwsNaming({ ...VALID, minPerArm: bad }, 'minPerArm');
});

t('model must be a non-empty string', () => {
  for (const bad of ['', 5]) throwsNaming({ ...VALID, model: bad }, 'model');
});

t('prompts must be >= 4 non-empty strings', () => {
  throwsNaming({ ...VALID, prompts: ['a', 'b', 'c'] }, 'prompts');
  throwsNaming({ ...VALID, prompts: ['a', 'b', 'c', ''] }, 'prompts');
  throwsNaming({ ...VALID, prompts: ['a', 'b', 'c', 4] }, 'prompts');
  throwsNaming({ ...VALID, prompts: 'abcd' }, 'prompts');
});

t('steerLevel must be shallow or deep', () => {
  const f = put({ ...VALID, steerLevel: 'mid', direction: 'up' });
  assert.throws(() => loadPrereg(f), /field steerLevel must be/);
});

t('direction must be down or up', () => {
  throwsNaming({ ...VALID, direction: 'sideways' }, 'direction');
});

t('direction must match steerLevel', () => {
  throwsNaming({ ...VALID, steerLevel: 'shallow', direction: 'up' }, 'direction');
  throwsNaming({ ...VALID, steerLevel: 'deep', direction: 'down' }, 'direction');
});

t('non-JSON file throws', () => {
  const f = put('{not json');
  assert.throws(() => loadPrereg(f), /JSON/i);
});

t('untracked file throws "not committed"', () => {
  const f = put(VALID, { commit: false });
  assert.throws(() => loadPrereg(f), /not committed/);
});

t('tracked file edited after commit throws "differs from HEAD"', () => {
  const f = put(VALID);
  writeFileSync(f, JSON.stringify({ ...VALID, effectSizeThinkingTokens: 1 }, null, 2));
  assert.throws(() => loadPrereg(f), /differs from HEAD/);
});

t('staged-but-uncommitted edit throws "differs from HEAD"', () => {
  const f = put(VALID);
  writeFileSync(f, JSON.stringify({ ...VALID, effectSizeThinkingTokens: 1 }, null, 2));
  git(REPO, 'add', '--', f);
  assert.throws(() => loadPrereg(f), /differs from HEAD/);
});

t('file outside any git repo throws "not committed"', () => {
  const dir = join(ROOT, 'norepo');
  mkdirSync(dir);
  const f = join(dir, 'p.json');
  writeFileSync(f, JSON.stringify(VALID));
  assert.throws(() => loadPrereg(f), /not committed/);
});

t('git runs against the file directory, not the process cwd', () => {
  const f = put(VALID);
  const prev = process.cwd();
  process.chdir(ROOT); // not a repo
  try {
    assert.deepEqual(loadPrereg(f), VALID);
  } finally {
    process.chdir(prev);
  }
});

t('loadPrereg does not modify the file or the repo', () => {
  const f = put(VALID);
  const before = git(REPO, 'status', '--porcelain');
  const bytes = readFileSync(f, 'utf8');
  loadPrereg(f);
  assert.equal(git(REPO, 'status', '--porcelain'), before);
  assert.equal(readFileSync(f, 'utf8'), bytes);
});

t('the real committed template throws: its numbers are null', () => {
  const real = fileURLToPath(new URL('./s4-prereg.json', import.meta.url));
  assert.throws(() => loadPrereg(real), /field \w+ is required and must not be null/);
});

t('the real template lists every registered field, the R24 fields last and null', () => {
  const real = JSON.parse(readFileSync(fileURLToPath(new URL('./s4-prereg.json', import.meta.url)), 'utf8'));
  assert.deepEqual(Object.keys(real), ['direction', 'effectSizeThinkingTokens', 'latencyBudgetMs', 'holdoutRate', 'repeats', 'minPerArm', 'model', 'prompts', 'steerLevel', 'alpha', 'permutations', 'seed']);
  for (const k of ['alpha', 'permutations', 'seed']) assert.equal(real[k], null, k);
});

// ---- prompt guards (final review M-2): a prompt is the last argv element of `claude -p` ----

const throwsAt = (prompts, index) => {
  const f = put({ ...VALID, prompts });
  assert.throws(() => loadPrereg(f), (e) => e instanceof Error && e.message.includes(`prompts[${index}]`), `expected an error naming prompts[${index}]`);
};

t('a bare one-word prompt is rejected naming its index (a claude subcommand name could dispatch)', () => {
  for (const word of ['update', 'install', 'purge', 'ultrareview', 'doctor', 'x']) throwsAt(promptsWith(2, word), 2);
  throwsAt(promptsWith(0, 'update '), 0); // one word after trimming
  throwsAt(promptsWith(3, '  install\n'), 3);
});

t('a prompt starting with - is rejected naming its index (it would parse as a flag)', () => {
  for (const p of ['-c and more', '--settings x', '--help me', '- dash then words', '  -c leading space']) throwsAt(promptsWith(1, p), 1);
});

t('a prompt starting with / is rejected naming its index (a slash command)', () => {
  for (const p of ['/ultrareview now', '/help me', '  /compact this']) throwsAt(promptsWith(3, p), 3);
});

t('valid multi-word prompts load, including a tab and an inner dash or slash', () => {
  const prompts = ['fix the bug', 'explain\tthis', 'a-b c', 'path a/b please'];
  assert.deepEqual(loadPrereg(put({ ...VALID, prompts })).prompts, prompts);
});

// ---- registration bypasses (ruling R15): an edited, unregistered value must not load ----

const EDITED = { ...VALID, effectSizeThinkingTokens: 1 };
const edit = (f) => writeFileSync(f, JSON.stringify(EDITED, null, 2));

t('assume-unchanged then edit throws "differs from HEAD"', () => {
  const f = put(VALID);
  git(REPO, 'update-index', '--assume-unchanged', '--', f);
  edit(f);
  assert.throws(() => loadPrereg(f), /differs from HEAD/);
});

t('skip-worktree then edit throws "differs from HEAD"', () => {
  const f = put(VALID);
  git(REPO, 'update-index', '--skip-worktree', '--', f);
  edit(f);
  assert.throws(() => loadPrereg(f), /differs from HEAD/);
});

t('a committed symlink to an untracked file throws', () => {
  const target = join(REPO, `target-${n}.json`);
  writeFileSync(target, JSON.stringify(EDITED));
  const link = join(REPO, `link-${n++}.json`);
  symlinkSync(target, link);
  git(REPO, 'add', '--', link);
  git(REPO, 'commit', '-q', '-m', 'link');
  assert.throws(() => loadPrereg(link), /symlink/);
});

t('a glob-named untracked file next to a committed one throws "not committed"', () => {
  const dir = join(REPO, 'globdir');
  mkdirSync(dir);
  writeFileSync(join(dir, 'p1.json'), JSON.stringify(VALID));
  git(REPO, 'add', '--', join(dir, 'p1.json'));
  git(REPO, 'commit', '-q', '-m', 'p1');
  for (const name of ['p*.json', '[p]1.json']) {
    const f = join(dir, name);
    writeFileSync(f, JSON.stringify(EDITED));
    assert.throws(() => loadPrereg(f), /not committed/, name);
  }
});

t('an env-injected lossy textconv cannot hide an edit', () => {
  const repo = join(ROOT, 'textconv');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, '.gitattributes'), '*.json diff=x\n');
  const f = join(repo, 'p.json');
  writeFileSync(f, JSON.stringify(VALID, null, 2));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'c');
  edit(f);
  const saved = { ...process.env };
  Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'diff.x.textconv', GIT_CONFIG_VALUE_0: 'true' });
  try {
    assert.throws(() => loadPrereg(f), /differs from HEAD/);
  } finally {
    for (const k of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
      if (k in saved) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
});

t('an inherited GIT_DIR pointing at another repo cannot vouch for an untracked file', () => {
  const other = join(ROOT, 'other');
  mkdirSync(other);
  git(other, 'init', '-q');
  writeFileSync(join(other, 'env-file.json'), JSON.stringify(VALID, null, 2));
  git(other, 'add', '.');
  git(other, 'commit', '-q', '-m', 'c');
  const f = join(REPO, 'env-file.json'); // same name and bytes, untracked here
  writeFileSync(f, JSON.stringify(VALID, null, 2));
  const had = process.env.GIT_DIR;
  process.env.GIT_DIR = join(other, '.git');
  try {
    assert.throws(() => loadPrereg(f), /not committed/);
  } finally {
    if (had === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = had;
  }
});

t('a repo with no commits and the file staged throws', () => {
  const repo = join(ROOT, 'nocommit');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  const f = join(repo, 'p.json');
  writeFileSync(f, JSON.stringify(VALID));
  git(repo, 'add', '--', f);
  assert.throws(() => loadPrereg(f), /not committed/);
});

// ---- stricter field rules ----

// Two-word prompts, so the duplicate rule (not the one-word rule) is what throws.
const DISTINCT = /at least 4 distinct, non-blank strings/;
const throwsDistinct = (prompts) => {
  const f = put({ ...VALID, prompts });
  assert.throws(() => loadPrereg(f), DISTINCT, JSON.stringify(prompts));
};

t('duplicate, blank and whitespace-only prompts are rejected', () => {
  throwsDistinct(['w a', 'w b', 'w c', 'w a']);
  throwsDistinct(['w a', 'w b', 'w c', ' w a ']);
  throwsDistinct(['w a', 'w b', 'w c', '   ']);
  throwsDistinct(['w a', 'w b', 'w c', 'w d', 'w a']);
});

t('a whitespace-only model is rejected', () => {
  throwsNaming({ ...VALID, model: '   ' }, 'model');
});

t('repeats and minPerArm must be safe integers', () => {
  throwsNaming(RAW('5', 2000).replace('"repeats":5', '"repeats":1e300'), 'repeats');
  throwsNaming(RAW('5', 2000).replace('"minPerArm":4', '"minPerArm":9007199254740993'), 'minPerArm');
});

t('a file removed from the index (still in HEAD, same bytes) throws "not committed"', () => {
  const f = put(VALID);
  git(REPO, 'rm', '-q', '--cached', '--', f);
  assert.throws(() => loadPrereg(f), /not committed/);
});

// ---- fix round 2 ----

const newRepo = (name) => {
  const repo = join(ROOT, name);
  mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  return repo;
};
const commitFile = (repo, name, obj) => {
  const f = join(repo, name);
  writeFileSync(f, JSON.stringify(obj, null, 2));
  git(repo, 'add', '--', f);
  git(repo, 'commit', '-q', '-m', name);
  return f;
};
const withEnv = (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

t('git replace of the HEAD blob cannot forge the registered bytes', () => {
  const repo = newRepo('replace-blob');
  const f = commitFile(repo, 'p.json', VALID);
  const old = git(repo, 'rev-parse', 'HEAD:./p.json').trim();
  edit(f);
  const forged = git(repo, 'hash-object', '-w', '--', f).trim();
  git(repo, 'replace', old, forged);
  assert.throws(() => loadPrereg(f), /differs from HEAD/);
});

t('git replace of the HEAD commit cannot forge the registered bytes', () => {
  const repo = newRepo('replace-commit');
  const f = commitFile(repo, 'p.json', VALID);
  const c1 = git(repo, 'rev-parse', 'HEAD').trim();
  edit(f);
  git(repo, 'commit', '-q', '-a', '-m', 'fake');
  const c2 = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'reset', '-q', '--hard', c1);
  git(repo, 'replace', c1, c2); // HEAD now resolves to the fake tree
  edit(f);
  assert.throws(() => loadPrereg(f), /differs from HEAD/);
});

t('a clean filter that normalises the edit back to the HEAD blob cannot hide it', () => {
  const repo = newRepo('clean-filter');
  const f = commitFile(repo, 'p.json', VALID);
  const keep = join(ROOT, 'committed.bin');
  writeFileSync(keep, readFileSync(f));
  writeFileSync(join(repo, '.gitattributes'), '*.json filter=f\n');
  git(repo, 'add', '.gitattributes');
  git(repo, 'commit', '-q', '-m', 'attrs');
  git(repo, 'config', 'filter.f.clean', `cat ${keep}`);
  edit(f);
  // the filter makes git believe the file is unchanged
  assert.equal(git(repo, 'hash-object', '--', f).trim(), git(repo, 'rev-parse', 'HEAD:./p.json').trim());
  assert.throws(() => loadPrereg(f), /differs from HEAD/);
});

t('a same-size edit with the mtime restored throws', () => {
  const f = put(VALID);
  const st = statSync(f);
  const same = JSON.stringify({ ...VALID, effectSizeThinkingTokens: 501 }, null, 2);
  assert.equal(same.length, readFileSync(f).length);
  writeFileSync(f, same);
  utimesSync(f, st.atime, st.mtime);
  assert.throws(() => loadPrereg(f), /differs from HEAD/);
});

t('textconv from GLOBAL attributes and config cannot hide an edit', () => {
  const home = join(ROOT, 'fakehome');
  mkdirSync(join(home, '.config', 'git'), { recursive: true });
  writeFileSync(join(home, '.config', 'git', 'attributes'), '*.json diff=x\n');
  writeFileSync(join(home, '.gitconfig'), '[diff "x"]\n\ttextconv = true\n');
  const repo = newRepo('global-textconv');
  const f = commitFile(repo, 'p.json', VALID);
  edit(f);
  withEnv({ HOME: home, XDG_CONFIG_HOME: join(home, '.config') }, () => {
    assert.throws(() => loadPrereg(f), /differs from HEAD/);
  });
});

t('a committed symlink to an IGNORED untracked file in the repo throws', () => {
  const repo = newRepo('ignored-link');
  appendFileSync(join(repo, '.git', 'info', 'exclude'), 'ignored-*.json\n');
  writeFileSync(join(repo, 'ignored-t.json'), JSON.stringify(EDITED));
  const link = join(repo, 'p.json');
  symlinkSync(join(repo, 'ignored-t.json'), link);
  git(repo, 'add', '--', link);
  git(repo, 'commit', '-q', '-m', 'link');
  assert.throws(() => loadPrereg(link), /symlink/);
});

// ---- git child environment and argv, observed through a stub `git` ----

const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { env: ENV, encoding: 'utf8' }).trim();
const STUB = join(ROOT, 'stub');
mkdirSync(STUB);
writeFileSync(
  join(STUB, 'git'),
  `#!/bin/sh\nenv > "$STUB_ENV"\nprintf '%s\\n' "$*" >> "$STUB_ARGS"\nexec ${REAL_GIT} "$@"\n`,
);
chmodSync(join(STUB, 'git'), 0o755);

function viaStub(extra, fn) {
  const envFile = join(ROOT, `stub-env-${n}`);
  const argsFile = join(ROOT, `stub-args-${n++}`);
  writeFileSync(argsFile, '');
  withEnv({ PATH: `${STUB}:${process.env.PATH}`, STUB_ENV: envFile, STUB_ARGS: argsFile, ...extra }, fn);
  return {
    env: Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])),
    calls: readFileSync(argsFile, 'utf8').split('\n').filter(Boolean),
  };
}

t('the git child gets no GIT_* variable except the fixed safe ones, and never prompts or lazy-fetches', () => {
  const f = put(VALID);
  const { env, calls } = viaStub(
    { GIT_TERMINAL_PROMPT: '1', GIT_NO_LAZY_FETCH: '0', GIT_OBJECT_DIRECTORY: '/nonexistent', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/x', GIT_REPLACE_REF_BASE: 'refs/x/', GIT_CEILING_DIRECTORIES: '/', GIT_EXTERNAL_DIFF: 'true', GIT_FOO: '1' },
    () => loadPrereg(f),
  );
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_NO_LAZY_FETCH, '1');
  const allowed = new Set(['GIT_TERMINAL_PROMPT', 'GIT_NO_LAZY_FETCH', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']);
  assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('GIT_') && !allowed.has(k)), []);
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    assert.match(c, /--no-replace-objects/);
    assert.match(c, /core\.fsmonitor=false/);
    assert.match(c, /--literal-pathspecs/);
  }
});

t('GIT_OBJECT_DIRECTORY pointing at an empty store does not change the answer', () => {
  const f = put(VALID);
  const empty = join(ROOT, `empty-objects-${n++}`);
  mkdirSync(empty);
  withEnv({ GIT_OBJECT_DIRECTORY: empty }, () => assert.deepEqual(loadPrereg(f), VALID));
});

t('a repo-local core.fsmonitor hook does not run', () => {
  const repo = newRepo('fsmonitor');
  const f = commitFile(repo, 'p.json', VALID);
  const marker = join(ROOT, 'fsmonitor-ran');
  const hook = join(ROOT, 'fsmonitor-hook.sh');
  writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`);
  chmodSync(hook, 0o755);
  git(repo, 'config', 'core.fsmonitor', hook);
  loadPrereg(f);
  assert.equal(existsSync(marker), false);
});

t('prompt duplicates that differ only in whitespace are rejected', () => {
  throwsDistinct(['w a', 'w b', 'w c', 'w d', ' w a ']);
});
