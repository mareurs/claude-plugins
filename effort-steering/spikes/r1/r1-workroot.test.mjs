import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { t } from '../../core/testkit.mjs';
import { hashBuiltTask } from '../s5/build-task.mjs';
import { buildR1Root } from './r1-workroot.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const copy = (src, dst) => {
  if (existsSync(dst)) throw new Error(`exists: ${dst}`);
  cpSync(src, dst, { recursive: true });
};

// A fake S5 work root with one built task and a cargo-home.
function makeSrc(root, id) {
  const dir = join(root, 'tasks', id);
  mkdirSync(join(dir, 'tree', 'src'), { recursive: true });
  mkdirSync(join(dir, 'hidden'), { recursive: true });
  writeFileSync(join(dir, 'tree', 'src', 'a.rs'), 'fn a() {}\n');
  writeFileSync(join(dir, 'tree', 'TASK.md'), 'requirements\n');
  writeFileSync(join(dir, 'hidden', 't.rs'), '#[test] fn t() {}\n');
  writeFileSync(join(dir, 'prompt.txt'), 'the old prompt\n');
  writeFileSync(join(dir, 'gate.json'), JSON.stringify({ ok: true }));
  const hashes = hashBuiltTask(dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, repo: 'codescout', ...hashes, taskMdHash: 'x', def: { testRunner: 'cargo' } }, null, 2));
  mkdirSync(join(root, 'cargo-home'), { recursive: true });
  writeFileSync(join(root, 'cargo-home', 'config'), 'c');
  return hashes;
}

const scratch = mkdtempSync(join(tmpdir(), 'r1-workroot-'));
const src = join(scratch, 'src');
const dst = join(scratch, 'dst');
const original = makeSrc(src, 'cs-a');
const promptFile = join(scratch, 'cs-a.prompt.txt');
writeFileSync(promptFile, 'the trace\n\nThis is the failing test output. Please fix it.\n');
const result = buildR1Root({ srcRoot: src, dstRoot: dst, tasks: [{ id: 'cs-a', promptFile }], copy });

t('the new prompt.txt holds the trace bytes and the manifest holds their hash', () => {
  const bytes = readFileSync(join(dst, 'tasks', 'cs-a', 'prompt.txt'));
  assert.equal(bytes.toString(), 'the trace\n\nThis is the failing test output. Please fix it.\n');
  const manifest = JSON.parse(readFileSync(join(dst, 'tasks', 'cs-a', 'manifest.json'), 'utf8'));
  assert.equal(manifest.promptHash, sha(bytes));
});

t('treeHash and hiddenHash are the source manifest values, and hashBuiltTask agrees', () => {
  const manifest = JSON.parse(readFileSync(join(dst, 'tasks', 'cs-a', 'manifest.json'), 'utf8'));
  assert.equal(manifest.treeHash, original.treeHash);
  assert.equal(manifest.hiddenHash, original.hiddenHash);
  assert.deepEqual(hashBuiltTask(join(dst, 'tasks', 'cs-a')), { treeHash: manifest.treeHash, hiddenHash: manifest.hiddenHash, promptHash: manifest.promptHash });
});

t('the other manifest fields and gate.json are unchanged', () => {
  const manifest = JSON.parse(readFileSync(join(dst, 'tasks', 'cs-a', 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'cs-a');
  assert.equal(manifest.taskMdHash, 'x');
  assert.deepEqual(manifest.def, { testRunner: 'cargo' });
  assert.equal(readFileSync(join(dst, 'tasks', 'cs-a', 'gate.json'), 'utf8'), '{"ok":true}');
});

t('the source task directory is untouched', () => {
  assert.equal(readFileSync(join(src, 'tasks', 'cs-a', 'prompt.txt'), 'utf8'), 'the old prompt\n');
  assert.deepEqual(hashBuiltTask(join(src, 'tasks', 'cs-a')), original);
});

t('cargo-home is copied once and the result lists the tasks with their three hashes', () => {
  assert.equal(readFileSync(join(dst, 'cargo-home', 'config'), 'utf8'), 'c');
  assert.deepEqual(result.tasks, [{ id: 'cs-a', treeHash: original.treeHash, hiddenHash: original.hiddenHash, promptHash: sha('the trace\n\nThis is the failing test output. Please fix it.\n') }]);
});

t('an existing destination task is refused, not merged', () => {
  assert.throws(() => buildR1Root({ srcRoot: src, dstRoot: dst, tasks: [{ id: 'cs-a', promptFile }], copy }), /exists/);
});

t('a prompt that is not valid UTF-8 or holds a NUL is refused before anything is copied', () => {
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

rmSync(scratch, { recursive: true, force: true });
