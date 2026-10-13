import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../../core/testkit.mjs';
import { hashBuiltTask } from '../s5/build-task.mjs';
import { buildR1Root } from './r1-workroot.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const copy = (src, dst) => {
  if (existsSync(dst)) throw new Error(`exists: ${dst}`);
  cpSync(src, dst, { recursive: true });
};
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null' } });

// A fake S5 work root with one built task (a tree that is one git commit holding TASK.md and CLAUDE.md) and a cargo-home.
function makeSrc(root, id) {
  const dir = join(root, 'tasks', id);
  const tree = join(dir, 'tree');
  mkdirSync(join(tree, 'src'), { recursive: true });
  mkdirSync(join(dir, 'hidden'), { recursive: true });
  writeFileSync(join(tree, 'src', 'a.rs'), 'fn a() {}\n');
  writeFileSync(join(tree, 'TASK.md'), 'requirements\n');
  writeFileSync(join(tree, 'CLAUDE.md'), 'Build with cargo. The task is described in TASK.md.\n');
  writeFileSync(join(tree, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(tree, 'ignored.txt'), 'tracked all the same\n');
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'add', '--all', '--force');
  git(tree, 'commit', '-q', '-m', `task ${id}`);
  const baseCommit = git(tree, 'rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(dir, 'hidden', 't.rs'), '#[test] fn t() {}\n');
  writeFileSync(join(dir, 'prompt.txt'), 'the old prompt\n');
  writeFileSync(join(dir, 'gate.json'), JSON.stringify({ ok: true }));
  const hashes = hashBuiltTask(dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, repo: 'codescout', baseCommit, ...hashes, taskMdHash: sha('requirements\n'), def: { testRunner: 'cargo' } }, null, 2));
  mkdirSync(join(root, 'cargo-home'), { recursive: true });
  writeFileSync(join(root, 'cargo-home', 'config'), 'c');
  return { ...hashes, baseCommit };
}

const PROMPT = 'the trace\n\nThis is the failing test output. Please fix it.\n';
const scratch = mkdtempSync(join(tmpdir(), 'r1-workroot-'));
const src = join(scratch, 'src');
const dst = join(scratch, 'dst');
const original = makeSrc(src, 'cs-a');
const promptFile = join(scratch, 'cs-a.prompt.txt');
writeFileSync(promptFile, PROMPT);
const result = buildR1Root({ srcRoot: src, dstRoot: dst, tasks: [{ id: 'cs-a', promptFile }], copy });
const out = join(dst, 'tasks', 'cs-a');
const manifestOf = () => JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));

t('the new prompt.txt holds the trace bytes and the manifest holds their hash', () => {
  const bytes = readFileSync(join(out, 'prompt.txt'));
  assert.equal(bytes.toString(), PROMPT);
  assert.equal(manifestOf().promptHash, sha(bytes));
});

t('the agent tree holds no TASK.md and no CLAUDE.md, and every other file stays', () => {
  assert.equal(existsSync(join(out, 'tree', 'TASK.md')), false);
  assert.equal(existsSync(join(out, 'tree', 'CLAUDE.md')), false);
  assert.equal(readFileSync(join(out, 'tree', 'src', 'a.rs'), 'utf8'), 'fn a() {}\n');
  assert.equal(readFileSync(join(out, 'tree', 'ignored.txt'), 'utf8'), 'tracked all the same\n');
});

t('the tree is one fresh commit that holds neither file and has no trace of the old commit', () => {
  const tree = join(out, 'tree');
  assert.equal(git(tree, 'rev-list', '--count', '--all').stdout.trim(), '1');
  const files = git(tree, 'ls-tree', '-r', '--name-only', 'HEAD').stdout.split('\n');
  assert.ok(!files.includes('TASK.md') && !files.includes('CLAUDE.md'));
  assert.ok(files.includes('ignored.txt'), 'a file the .gitignore matches is committed all the same');
  assert.equal(git(tree, 'status', '--porcelain').stdout, '');
  assert.notEqual(git(tree, 'cat-file', '-e', original.baseCommit).status, 0, 'the old commit object is gone');
  assert.equal(git(tree, 'log', '--all', '--format=%s').stdout.trim(), 'task cs-a');
});

t('baseCommit is the new commit; treeHash is what the bytes hash to and is not the old one', () => {
  const m = manifestOf();
  assert.equal(m.baseCommit, git(join(out, 'tree'), 'rev-parse', 'HEAD').stdout.trim());
  assert.notEqual(m.baseCommit, original.baseCommit);
  assert.notEqual(m.treeHash, original.treeHash);
  assert.equal(m.hiddenHash, original.hiddenHash);
  assert.deepEqual(hashBuiltTask(out), { treeHash: m.treeHash, hiddenHash: m.hiddenHash, promptHash: m.promptHash });
});

t('the copy has no gate.json (the tree changed, so the task is gated again) and taskMdHash is null', () => {
  assert.equal(existsSync(join(out, 'gate.json')), false);
  assert.equal(manifestOf().taskMdHash, null);
});

t('the other manifest fields are unchanged', () => {
  const m = manifestOf();
  assert.equal(m.id, 'cs-a');
  assert.equal(m.repo, 'codescout');
  assert.deepEqual(m.def, { testRunner: 'cargo' });
});

t('the source task directory is untouched, TASK.md and the old commit included', () => {
  const s = join(src, 'tasks', 'cs-a');
  assert.equal(readFileSync(join(s, 'prompt.txt'), 'utf8'), 'the old prompt\n');
  assert.equal(readFileSync(join(s, 'tree', 'TASK.md'), 'utf8'), 'requirements\n');
  assert.equal(readFileSync(join(s, 'gate.json'), 'utf8'), '{"ok":true}');
  assert.equal(git(join(s, 'tree'), 'rev-parse', 'HEAD').stdout.trim(), original.baseCommit);
  assert.deepEqual(hashBuiltTask(s), { treeHash: original.treeHash, hiddenHash: original.hiddenHash, promptHash: original.promptHash });
});

t('cargo-home is copied once and the result lists the tasks with their three new hashes', () => {
  assert.equal(readFileSync(join(dst, 'cargo-home', 'config'), 'utf8'), 'c');
  const m = manifestOf();
  assert.deepEqual(result.tasks, [{ id: 'cs-a', treeHash: m.treeHash, hiddenHash: original.hiddenHash, promptHash: sha(PROMPT) }]);
});

t('an existing destination task is refused, not merged', () => {
  assert.throws(() => buildR1Root({ srcRoot: src, dstRoot: dst, tasks: [{ id: 'cs-a', promptFile }], copy }), /exists/);
});

t('a prompt that holds a NUL is refused before anything is copied', () => {
  const bad = join(scratch, 'bad.txt');
  writeFileSync(bad, Buffer.from([0x61, 0x00, 0x62]));
  const dst2 = join(scratch, 'dst2');
  assert.throws(() => buildR1Root({ srcRoot: src, dstRoot: dst2, tasks: [{ id: 'cs-a', promptFile: bad }], copy }), /NUL/);
  assert.equal(existsSync(dst2), false);
});

t('a tampered source (tree hash differs from its manifest) is refused', () => {
  const src3 = join(scratch, 'src3');
  makeSrc(src3, 'cs-b');
  writeFileSync(join(src3, 'tasks', 'cs-b', 'tree', 'src', 'a.rs'), 'fn tampered() {}\n');
  assert.throws(() => buildR1Root({ srcRoot: src3, dstRoot: join(scratch, 'dst3'), tasks: [{ id: 'cs-b', promptFile }], copy }), /treeHash/);
});

t('a source tree without TASK.md or CLAUDE.md still builds (nothing to remove)', () => {
  const src4 = join(scratch, 'src4');
  makeSrc(src4, 'cs-c');
  const s = join(src4, 'tasks', 'cs-c');
  rmSync(join(s, 'tree', 'TASK.md'));
  rmSync(join(s, 'tree', 'CLAUDE.md'));
  git(join(s, 'tree'), 'add', '--all', '--force');
  git(join(s, 'tree'), 'commit', '-q', '-m', 'task cs-c without');
  const hashes = hashBuiltTask(s);
  const m = JSON.parse(readFileSync(join(s, 'manifest.json'), 'utf8'));
  writeFileSync(join(s, 'manifest.json'), JSON.stringify({ ...m, ...hashes }));
  const r = buildR1Root({ srcRoot: src4, dstRoot: join(scratch, 'dst4'), tasks: [{ id: 'cs-c', promptFile }], copy });
  assert.equal(r.tasks[0].treeHash, hashes.treeHash, 'the tree is the same files, so the hash is the same');
});

rmSync(scratch, { recursive: true, force: true });
