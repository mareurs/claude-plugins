import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../core/testkit.mjs';
import { loadPrereg } from './s4-prereg.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 's4-prereg-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

// Child git processes must not inherit a hook's repo environment.
const ENV = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[k];
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
  for (const bad of [0, -1, '5', NaN, Infinity]) {
    throwsNaming({ ...VALID, effectSizeThinkingTokens: bad }, 'effectSizeThinkingTokens');
  }
  throwsNaming(`{"direction":"down","effectSizeThinkingTokens":1e999,"latencyBudgetMs":2000,"holdoutRate":0.25,"repeats":5,"minPerArm":4,"model":"m","prompts":["a","b","c","d"],"steerLevel":"shallow"}`, 'effectSizeThinkingTokens');
});

t('latencyBudgetMs must be a positive finite number', () => {
  for (const bad of [0, -5, '100', NaN]) throwsNaming({ ...VALID, latencyBudgetMs: bad }, 'latencyBudgetMs');
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
  throwsNaming({ ...VALID, steerLevel: 'mid' }, 'steerLevel');
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
