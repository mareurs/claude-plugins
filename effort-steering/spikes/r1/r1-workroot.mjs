// r1-workroot.mjs — the second work root of the R1 experiment: each usable task is a reflink copy of its S5 built task with
// prompt.txt replaced by the trace prompt and manifest.promptHash updated. The S5 work root stays intact; the S5 runner runs on
// the new root unchanged (it reads <root>/tasks/<id>/prompt.txt and checks its sha256 against manifest.promptHash).
//
//   buildR1Root({ srcRoot, dstRoot, tasks: [{ id, promptFile }], copy = reflinkCopy })
//     -> { tasks: [{ id, treeHash, hiddenHash, promptHash }] }
//
// tree/ loses TASK.md and CLAUDE.md at its root (spec decision 4) and holds the hidden tests (V2, spec decision 5: grafted by the grader's
// own graftScript, so a later grader graft changes nothing), and becomes a fresh one-commit repository, so treeHash and
// manifest.baseCommit change and the copy has no gate.json: run `s5.mjs gate` on every task of the new root. hidden/ is untouched
// (hiddenHash is checked). The source manifest's tree and hidden hashes are re-checked against the bytes (hashBuiltTask) first.
// manifest.taskMdHash becomes null: there is no TASK.md any more.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashBuiltTask, reflinkCopy } from '../s5/build-task.mjs';
import { graftScript } from '../s5/grade.mjs';
import { git } from '../s5/git.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readPrompt(file) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) throw new Error(`buildR1Root: ${file} holds a NUL byte; the prompt reaches the CLI as one process argument`);
  if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw new Error(`buildR1Root: ${file} is not valid UTF-8`);
  return bytes;
}

// The recipe of build-task.mjs's commitTree (one fresh repository, one commit `task <id>`, the S5 identity and author date; without its
// --show-toplevel and tracked-equals-on-disk checks, which the byte copy of an already checked tree makes redundant), after
// TASK.md and CLAUDE.md are removed at the tree root. The old .git goes first: its one commit holds both files, and an agent could
// read them with `git show`. Returns the new commit's id, which the grader diffs against (manifest.baseCommit).
const IDENTITY = ['-c', 'user.name=s5', '-c', 'user.email=s5@localhost'];
const AUTHOR_DATE = '2026-01-01T00:00:00Z';
const TASK_FILES = ['TASK.md', 'CLAUDE.md'];

// V2 leak repair (spec decision 5). adjust[id] = { hiddenFromP: [path], dropText: [{ file, text }] } (the committed r1-v2-adjust.json): the Opus
// review found that the fix commit's own tests, added to a hidden file that already exists at P, would be visible in the agent's tree and state the
// fix. hiddenFromP: the hidden copy becomes the P file (right when no graded name needs the added tests). dropText: this exact text is removed once
// from the hidden copy (a comment that states the cause). Both are validated against the SOURCE task directory, before anything is copied.
function hiddenPathsOf(manifest) {
  return [...manifest.def.hidden.files, ...(manifest.def.hidden.extra ?? [])];
}

function checkAdjustment(taskDir, manifest, adjustment, id) {
  if (adjustment === undefined) return;
  for (const key of Object.keys(adjustment)) {
    if (!['hiddenFromP', 'dropText'].includes(key)) throw new Error(`buildR1Root: ${id}: unknown key ${JSON.stringify(key)} in the adjustment (a misspelled key would silently undo a repair)`);
    if (!Array.isArray(adjustment[key])) throw new Error(`buildR1Root: ${id}: ${key} must be an array`);
  }
  if (Object.keys(adjustment).length === 0) throw new Error(`buildR1Root: ${id}: an empty adjustment names nothing`);
  const hidden = hiddenPathsOf(manifest);
  const isHidden = (rel) => typeof rel === 'string' && hidden.includes(rel);
  for (const rel of adjustment.hiddenFromP ?? []) {
    if (!isHidden(rel)) throw new Error(`buildR1Root: ${id}: ${JSON.stringify(rel)} is not a hidden file, so hiddenFromP cannot name it`);
    const st = lstatSync(join(taskDir, 'tree', rel), { throwIfNoEntry: false });
    if (st === undefined || !st.isFile()) throw new Error(`buildR1Root: ${id}: hiddenFromP ${rel}: no P file in the tree to take`);
  }
  for (const { file, text } of adjustment.dropText ?? []) {
    if (!isHidden(file)) throw new Error(`buildR1Root: ${id}: ${JSON.stringify(file)} is not a hidden file, so dropText cannot name it`);
    const body = readFileSync(join(taskDir, 'hidden', file), 'utf8');
    if (typeof text !== 'string' || text === '' || body.split(text).length - 1 !== 1) throw new Error(`buildR1Root: ${id}: dropText in ${file} must be non-empty and occur exactly once`);
  }
}

function adjustHiddenTests(dir, adjustment) {
  if (adjustment === undefined) return;
  for (const rel of adjustment.hiddenFromP ?? []) copyFileSync(join(dir, 'tree', rel), join(dir, 'hidden', rel));
  for (const { file, text } of adjustment.dropText ?? []) {
    const path = join(dir, 'hidden', file);
    const body = readFileSync(path, 'utf8');
    const at = body.indexOf(text);
    writeFileSync(path, body.slice(0, at) + body.slice(at + text.length));
  }
}

// V2 (spec decision 5): the hidden tests are in the agent's tree. graftHiddenTests runs the grader's own graftScript on the fresh copy
// (host side is safe here: the copy is ours, not the agent's), so the visible tree is byte-identical to what the grader grafts onto an
// untouched tree and the grader's graft on it changes nothing. When it grades an edited tree, that graft removes each hidden path and
// copies the original in again, and re-adds a graftLines module line the agent removed (see graftScript in grade.mjs).
function graftHiddenTests(dir, manifest, id) {
  const script = graftScript(manifest, { work: join(dir, 'tree'), hidden: join(dir, 'hidden') });
  const r = spawnSync('sh', ['-s'], { input: script, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`buildR1Root: ${id}: the graft of the hidden tests failed (exit ${r.status}): ${(r.stderr ?? '').trim()}`);
}

function recommitWithoutTaskFiles(tree, id) {
  const run = (...args) => {
    const r = git(tree, args);
    if (r.status !== 0) throw new Error(`buildR1Root: git ${args.join(' ')} failed in ${tree} (exit ${r.status}): ${r.stderr.toString().trim()}`);
    return r.stdout.toString().trim();
  };
  for (const name of TASK_FILES) rmSync(join(tree, name), { recursive: true, force: true });
  rmSync(join(tree, '.git'), { recursive: true, force: true });
  run('init', '-q', '-b', 'main', '--template=', tree);
  // --force: a file the repo tracks but its .gitignore matches is part of the tree all the same (as in buildTask).
  run('add', '--all', '--force');
  run(...IDENTITY, 'commit', '-q', '--no-verify', '--no-gpg-sign', '-m', `task ${id}`, `--date=${AUTHOR_DATE}`);
  if (run('rev-list', '--count', '--all') !== '1') throw new Error(`buildR1Root: the tree of ${id} has more than one commit`);
  return run('rev-parse', 'HEAD');
}

export function buildR1Root({ srcRoot, dstRoot, tasks, copy = reflinkCopy, adjust = {} }) {
  const src = resolve(srcRoot);
  const dst = resolve(dstRoot);
  // The inputs (source hashes, prompt bytes, the adjustments) are checked before the first copy. A failure AFTER a copy (git, or the hidden-hash check)
  // leaves tasks/<id>/ half built, without gate.json and with the old manifest: remove it by hand before a rerun.
  const planned = tasks.map(({ id, promptFile }) => {
    const manifestFile = join(src, 'tasks', id, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    if (!Array.isArray(manifest.def?.hidden?.files)) throw new Error(`buildR1Root: ${id}: def.hidden must have a files list (V2 grafts the hidden tests into the agent tree)`);
    const actual = hashBuiltTask(join(src, 'tasks', id));
    for (const key of ['treeHash', 'hiddenHash']) {
      if (manifest[key] !== actual[key]) throw new Error(`buildR1Root: ${id}: ${key} of the source manifest is not what the bytes hash to`);
    }
    checkAdjustment(join(src, 'tasks', id), manifest, adjust[id], id);
    return { id, manifest, bytes: readPrompt(promptFile) };
  });
  for (const key of Object.keys(adjust)) {
    if (!key.startsWith('_') && !tasks.some((task) => task.id === key)) throw new Error(`buildR1Root: an adjustment for unknown task ${key}`);
  }

  mkdirSync(join(dst, 'tasks'), { recursive: true });
  if (existsSync(join(src, 'cargo-home')) && !existsSync(join(dst, 'cargo-home'))) copy(join(src, 'cargo-home'), join(dst, 'cargo-home'));
  const built = [];
  for (const { id, manifest, bytes } of planned) {
    const dir = join(dst, 'tasks', id);
    copy(join(src, 'tasks', id), dir);
    if (hashBuiltTask(dir).hiddenHash !== manifest.hiddenHash) throw new Error(`buildR1Root: ${id}: the copy's hidden tests do not hash to the manifest`);
    // V2 leak repair: the committed adjustments change the hidden copies (and so hiddenHash) before the graft puts them in the tree.
    adjustHiddenTests(dir, adjust[id]);
    graftHiddenTests(dir, manifest, id);
    // Decision 4 (spec): the agent finds no TASK.md and no CLAUDE.md. The tree is a new one-commit repository, and the old
    // commit (which holds both files) is gone. The tree changed, so the source's gate.json no longer describes it: the task is
    // gated again (`s5.mjs gate`), which writes a new one.
    const baseCommit = recommitWithoutTaskFiles(join(dir, 'tree'), id);
    rmSync(join(dir, 'gate.json'), { force: true });
    writeFileSync(join(dir, 'prompt.txt'), bytes);
    const promptHash = sha256(bytes);
    const { treeHash, hiddenHash } = hashBuiltTask(dir);
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({ ...manifest, baseCommit, treeHash, hiddenHash, promptHash, taskMdHash: null }, null, 2)}\n`);
    built.push({ id, treeHash, hiddenHash, promptHash });
  }
  return { tasks: built };
}
