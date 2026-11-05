import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'session-start.mjs');
const GIT = ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t'];
const git = (cwd, ...a) => execFileSync('git', [...GIT, ...a], { cwd, stdio: 'pipe' });

const dirs = [];
function put(root, rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
function repo(config) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-ss-')));
  dirs.push(root);
  git(root, 'init', '-q', '-b', 'main');
  if (config !== null) put(root, '.sdd/config.json', config);
  put(root, 'README.md', 'x\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
function addActivePlan(root, name) {
  put(root, `docs/superpowers/specs/2026-11-05-${name}-design.md`, '---\nstatus: approved\n---\nspec\n');
  put(root, `docs/superpowers/plans/2026-11-05-${name}.md`,
    `---\nstatus: approved\nfeature: ${name}\n---\n**Spec:** docs/superpowers/specs/2026-11-05-${name}-design.md\n`);
}
function run(payload, raw) {
  const r = spawnSync('node', [HOOK], { input: raw ?? JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(r.status, 0);
  return r.stdout;
}
const ctx = (s) => JSON.parse(s).hookSpecificOutput;

after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('no config, bad stdin: silent exit 0', () => {
  const root = repo(null);
  assert.equal(run({ cwd: root }), '');
  assert.equal(run(null, 'not json'), '');
  assert.equal(run(null, ''), '');
});

test('strict with one active plan: names mode, feature and the review gate', () => {
  const root = repo('{"enforcement":"strict"}');
  addActivePlan(root, 'auth-login');
  const out = ctx(run({ cwd: root, source: 'startup' }));
  assert.equal(out.hookEventName, 'SessionStart');
  assert.match(out.additionalContext, /strict/);
  assert.match(out.additionalContext, /auth-login/);
  assert.match(out.additionalContext, /\/sdd:approve review auth-login/);
  assert.match(out.additionalContext, /main/);
});

test('no active plan: points at /sdd:approve', () => {
  const root = repo('{"enforcement":"warn"}');
  const out = ctx(run({ cwd: root }));
  assert.match(out.additionalContext, /warn/);
  assert.match(out.additionalContext, /\/sdd:approve/);
});

test('malformed config: says unreadable and enforcement is warn', () => {
  const root = repo('{not json');
  const out = ctx(run({ cwd: root }));
  assert.match(out.additionalContext, /unreadable/);
  assert.match(out.additionalContext, /warn/);
});
