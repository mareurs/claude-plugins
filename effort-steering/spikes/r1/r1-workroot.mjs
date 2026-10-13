// r1-workroot.mjs — the second work root of the R1 experiment: each usable task is a reflink copy of its S5 built task with
// prompt.txt replaced by the trace prompt and manifest.promptHash updated. The S5 work root stays intact; the S5 runner runs on
// the new root unchanged (it reads <root>/tasks/<id>/prompt.txt and checks its sha256 against manifest.promptHash).
//
//   buildR1Root({ srcRoot, dstRoot, tasks: [{ id, promptFile }], copy = reflinkCopy })
//     -> { tasks: [{ id, treeHash, hiddenHash, promptHash }] }
//
// tree/ loses TASK.md and CLAUDE.md at its root (spec decision 4) and becomes a fresh one-commit repository, so treeHash and
// manifest.baseCommit change and the copy has no gate.json: run `s5.mjs gate` on every task of the new root. hidden/ is untouched
// (hiddenHash is checked). The source manifest's tree and hidden hashes are re-checked against the bytes (hashBuiltTask) first.
// manifest.taskMdHash becomes null: there is no TASK.md any more.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashBuiltTask, reflinkCopy } from '../s5/build-task.mjs';
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

export function buildR1Root({ srcRoot, dstRoot, tasks, copy = reflinkCopy }) {
  const src = resolve(srcRoot);
  const dst = resolve(dstRoot);
  // The inputs (source hashes, prompt bytes) are checked before the first copy. A failure AFTER a copy (git, or the hidden-hash check)
  // leaves tasks/<id>/ half built, without gate.json and with the old manifest: remove it by hand before a rerun.
  const planned = tasks.map(({ id, promptFile }) => {
    const manifestFile = join(src, 'tasks', id, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const actual = hashBuiltTask(join(src, 'tasks', id));
    for (const key of ['treeHash', 'hiddenHash']) {
      if (manifest[key] !== actual[key]) throw new Error(`buildR1Root: ${id}: ${key} of the source manifest is not what the bytes hash to`);
    }
    return { id, manifest, bytes: readPrompt(promptFile) };
  });

  mkdirSync(join(dst, 'tasks'), { recursive: true });
  if (existsSync(join(src, 'cargo-home')) && !existsSync(join(dst, 'cargo-home'))) copy(join(src, 'cargo-home'), join(dst, 'cargo-home'));
  const built = [];
  for (const { id, manifest, bytes } of planned) {
    const dir = join(dst, 'tasks', id);
    copy(join(src, 'tasks', id), dir);
    // Decision 4 (spec): the agent finds no TASK.md and no CLAUDE.md. The tree is a new one-commit repository, and the old
    // commit (which holds both files) is gone. The tree changed, so the source's gate.json no longer describes it: the task is
    // gated again (`s5.mjs gate`), which writes a new one.
    const baseCommit = recommitWithoutTaskFiles(join(dir, 'tree'), id);
    rmSync(join(dir, 'gate.json'), { force: true });
    writeFileSync(join(dir, 'prompt.txt'), bytes);
    const promptHash = sha256(bytes);
    const { treeHash, hiddenHash } = hashBuiltTask(dir);
    if (hiddenHash !== manifest.hiddenHash) throw new Error(`buildR1Root: ${id}: the copy's hidden tests do not hash to the manifest`);
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({ ...manifest, baseCommit, treeHash, promptHash, taskMdHash: null }, null, 2)}\n`);
    built.push({ id, treeHash, hiddenHash, promptHash });
  }
  return { tasks: built };
}
