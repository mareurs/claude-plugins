import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../../core/testkit.mjs';
import { hashBuiltTask } from '../s5/build-task.mjs';
import { graftScript } from '../s5/grade.mjs';
import { buildR1Root } from './r1-workroot.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const copy = (src, dst) => {
  if (existsSync(dst)) throw new Error(`exists: ${dst}`);
  cpSync(src, dst, { recursive: true });
};
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null' } });

// The def holds what the grader grafts (V2): one new hidden file with its mod line, and one hidden file that replaces a file of the P tree.
const DEF = { testRunner: 'cargo', hidden: { files: ['src/s5h_t.rs'], extra: ['tests/p2p.rs'], graftLines: [{ file: 'src/a.rs', line: 'mod s5h_t;' }] } };

// A fake S5 work root with one built task (a tree that is one git commit holding TASK.md and CLAUDE.md) and a cargo-home.
function makeSrc(root, id) {
  const dir = join(root, 'tasks', id);
  const tree = join(dir, 'tree');
  mkdirSync(join(tree, 'src'), { recursive: true });
  mkdirSync(join(dir, 'hidden', 'src'), { recursive: true });
  mkdirSync(join(dir, 'hidden', 'tests'), { recursive: true });
  mkdirSync(join(tree, 'tests'), { recursive: true });
  writeFileSync(join(tree, 'src', 'a.rs'), 'fn a() {}\n');
  writeFileSync(join(tree, 'tests', 'p2p.rs'), '// the P version\n#[test] fn p() {}\n');
  writeFileSync(join(tree, 'TASK.md'), 'requirements\n');
  writeFileSync(join(tree, 'CLAUDE.md'), 'Build with cargo. The task is described in TASK.md.\n');
  writeFileSync(join(tree, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(tree, 'ignored.txt'), 'tracked all the same\n');
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'add', '--all', '--force');
  git(tree, 'commit', '-q', '-m', `task ${id}`);
  const baseCommit = git(tree, 'rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(dir, 'hidden', 'src', 's5h_t.rs'), '#[test] fn t() {}\n');
  writeFileSync(join(dir, 'hidden', 'tests', 'p2p.rs'), '// the hidden version\n#[test] fn p() {}\n#[test] fn q() {}\n');
  writeFileSync(join(dir, 'prompt.txt'), 'the old prompt\n');
  writeFileSync(join(dir, 'gate.json'), JSON.stringify({ ok: true }));
  const hashes = hashBuiltTask(dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, repo: 'codescout', baseCommit, ...hashes, taskMdHash: sha('requirements\n'), def: DEF }, null, 2));
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
  assert.equal(readFileSync(join(out, 'tree', 'src', 'a.rs'), 'utf8'), 'fn a() {}\nmod s5h_t;\n', 'src/a.rs is the P file plus the graftLines module line');
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
  assert.deepEqual(m.def, DEF);
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

t('a copy whose hidden tests differ from the source manifest is refused', () => {
  const src5 = join(scratch, 'src5');
  makeSrc(src5, 'cs-e');
  const tamper = (s, d) => {
    copy(s, d);
    if (existsSync(join(d, 'hidden', 'src', 's5h_t.rs'))) writeFileSync(join(d, 'hidden', 'src', 's5h_t.rs'), 'tampered\n');
  };
  assert.throws(() => buildR1Root({ srcRoot: src5, dstRoot: join(scratch, 'dst5'), tasks: [{ id: 'cs-e', promptFile }], copy: tamper }), /hidden/);
});

t('the new .git holds no hooks directory (it is created without a template)', () => {
  assert.equal(existsSync(join(out, 'tree', '.git', 'hooks')), false);
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
  const tree = join(scratch, 'dst4', 'tasks', 'cs-c', 'tree');
  assert.equal(r.tasks[0].treeHash, hashBuiltTask(join(scratch, 'dst4', 'tasks', 'cs-c')).treeHash);
  assert.notEqual(r.tasks[0].treeHash, hashes.treeHash, 'the hidden tests are grafted in, so the tree differs from the source');
  assert.deepEqual(git(tree, 'ls-tree', '-r', '--name-only', 'HEAD').stdout.split('\n').filter(Boolean), ['.gitignore', 'ignored.txt', 'src/a.rs', 'src/s5h_t.rs', 'tests/p2p.rs']);
});

// ---- V2 (spec decision 5): the agent's tree holds the hidden tests, grafted by the grader's own graftScript ----

const bytesOf = (...p) => readFileSync(join(out, ...p), 'utf8');
const hiddenBytes = (...p) => readFileSync(join(out, 'hidden', ...p), 'utf8');

t('V2: the agent tree holds every hidden file byte for byte, a hidden file replaces the P file of the same path', () => {
  assert.equal(bytesOf('tree', 'src', 's5h_t.rs'), hiddenBytes('src', 's5h_t.rs'));
  assert.equal(bytesOf('tree', 'tests', 'p2p.rs'), hiddenBytes('tests', 'p2p.rs'));
  assert.ok(!bytesOf('tree', 'tests', 'p2p.rs').includes('the P version'));
});

t('V2: the graftLines module is declared once, so cargo finds the hidden test', () => {
  const lines = bytesOf('tree', 'src', 'a.rs').split('\n').filter((l) => l === 'mod s5h_t;');
  assert.equal(lines.length, 1);
  assert.equal(bytesOf('tree', 'src', 'a.rs'), 'fn a() {}\nmod s5h_t;\n');
});

t('V2: the grafted files are part of the one commit, so the grader\'s diff of the agent\'s own change starts empty', () => {
  const tree = join(out, 'tree');
  const files = git(tree, 'ls-tree', '-r', '--name-only', 'HEAD').stdout.split('\n');
  assert.ok(files.includes('src/s5h_t.rs') && files.includes('tests/p2p.rs'));
  assert.equal(git(tree, 'status', '--porcelain').stdout, '');
  assert.equal(git(tree, 'diff', '--cached', '--shortstat', manifestOf().baseCommit).stdout, '');
  assert.equal(git(tree, 'rev-list', '--count', '--all').stdout.trim(), '1');
});

t('V2: the grader\'s graft on the untouched tree changes nothing (same script, same bytes)', () => {
  const before = hashBuiltTask(out).treeHash;
  const r = spawnSync('sh', ['-s'], { input: graftScript({ ...manifestOf() }, { work: join(out, 'tree'), hidden: join(out, 'hidden') }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(hashBuiltTask(out).treeHash, before);
  assert.equal(git(join(out, 'tree'), 'status', '--porcelain').stdout, '');
});

t('V2: an agent edit of a hidden file or of its mod line is undone by the grader\'s graft', () => {
  const probe = join(scratch, 'probe');
  cpSync(out, probe, { recursive: true });
  const tree = join(probe, 'tree');
  writeFileSync(join(tree, 'src', 's5h_t.rs'), '#[test] fn t() { /* the agent made it pass */ }\n');
  rmSync(join(tree, 'tests', 'p2p.rs'));
  writeFileSync(join(tree, 'src', 'a.rs'), 'fn a() {}\n');
  const r = spawnSync('sh', ['-s'], { input: graftScript(manifestOf(), { work: tree, hidden: join(probe, 'hidden') }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(tree, 'src', 's5h_t.rs'), 'utf8'), hiddenBytes('src', 's5h_t.rs'));
  assert.equal(readFileSync(join(tree, 'tests', 'p2p.rs'), 'utf8'), hiddenBytes('tests', 'p2p.rs'));
  assert.equal(readFileSync(join(tree, 'src', 'a.rs'), 'utf8'), 'fn a() {}\nmod s5h_t;\n');
});

t('V2: a source manifest without def.hidden is refused before anything is copied', () => {
  const src6 = join(scratch, 'src6');
  makeSrc(src6, 'cs-f');
  const mf = join(src6, 'tasks', 'cs-f', 'manifest.json');
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  writeFileSync(mf, JSON.stringify({ ...m, def: { testRunner: 'cargo' } }));
  const dst6 = join(scratch, 'dst6');
  assert.throws(() => buildR1Root({ srcRoot: src6, dstRoot: dst6, tasks: [{ id: 'cs-f', promptFile }], copy }), /def\.hidden/);
  assert.equal(existsSync(dst6), false);
});

t('V2: a graft that fails stops the build with the script\'s error', () => {
  const src7 = join(scratch, 'src7');
  makeSrc(src7, 'cs-g');
  rmSync(join(src7, 'tasks', 'cs-g', 'hidden', 'tests', 'p2p.rs'));
  const mf = join(src7, 'tasks', 'cs-g', 'manifest.json');
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  writeFileSync(mf, JSON.stringify({ ...m, ...hashBuiltTask(join(src7, 'tasks', 'cs-g')) }));
  assert.throws(() => buildR1Root({ srcRoot: src7, dstRoot: join(scratch, 'dst7'), tasks: [{ id: 'cs-g', promptFile }], copy }), /graft/);
});

rmSync(scratch, { recursive: true, force: true });
