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
  prompts: ['p1', 'p2', 'p3', 'p4'],
  steerLevel: 'shallow',
};

const RAW = (eff, lat) => `{"direction":"down","effectSizeThinkingTokens":${eff},"latencyBudgetMs":${lat},"holdoutRate":0.25,"repeats":5,"minPerArm":4,"model":"m","prompts":["a","b","c","d"],"steerLevel":"shallow"}`;

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

t('duplicate, blank and whitespace-only prompts are rejected', () => {
  throwsNaming({ ...VALID, prompts: ['a', 'b', 'c', 'a'] }, 'prompts');
  throwsNaming({ ...VALID, prompts: ['a', 'b', 'c', ' a '] }, 'prompts');
  throwsNaming({ ...VALID, prompts: ['a', 'b', 'c', '   '] }, 'prompts');
  throwsNaming({ ...VALID, prompts: ['a', 'b', 'c', 'd', 'a'] }, 'prompts');
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
  throwsNaming({ ...VALID, prompts: ['a', 'b', 'c', 'd', ' a '] }, 'prompts');
});
