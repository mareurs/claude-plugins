// build-task.mjs — build one S5 task from a fix commit C and its parent P.
//
//   buildTask(taskDir, { workRoot }) -> Manifest      (synchronous; no model, no Docker)
//   reflinkCopy(src, dst)
//
// Output, under <workRoot>/tasks/<id>/ (which must not exist: a build is never overwritten, the
// caller removes an old one on purpose):
//
//   tree/           the repository at P as ONE fresh commit `task <id>` (s5 <s5@localhost>), no remote,
//                   no history. CLAUDE.md, AGENTS.md, .claude/ and .codescout/ are gone at every depth
//                   and replaced by a short task CLAUDE.md; TASK.md sits at the root.
//   hidden/         the fix commit's version of each hidden.files path, plus each hidden.extra file
//                   from <taskDir>/extra-tests/, each at its relative path.
//   manifest.json   { id, repo, fix, parent, treeHash, hiddenHash, promptHash, taskMdHash, def }
//
// Hashes are sha256 hex.
//   treeHash    over every file of tree/ except the top-level .git: for each file, in BYTE-order of its
//               relative path (UTF-8, '/'-separated), feed  path + '\0' + sha256(bytes) + '\n'  into one
//               sha256. A symlink contributes the sha256 of its target STRING; it is never followed.
//               The file mode is not part of the hash.
//   hiddenHash  the same over hidden/ (nothing is excluded there).
//   promptHash  sha256 of prompt.txt's bytes.   taskMdHash  sha256 of TASK.md's bytes.
//
// Leak paths this closes (spec "Building a task"): history (one commit, and the new repository holds
// neither P nor C as an object), a remote, the repo's own CLAUDE.md/AGENTS.md/.claude/.codescout, the
// paths named in scrub.removePaths, and any scrub term left in any file or symlink target (the check
// runs on the final tree, task CLAUDE.md and TASK.md included, and the build is removed on a hit).
//
// The source repository is the operator's live checkout. It is read only through git on committed
// objects (rev-parse, archive, cat-file): never its working tree, index or refs, and never a command
// that writes. All git calls go through ./git.mjs (scrubbed environment).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { git } from './git.mjs';
import { loadTaskDef } from './task-def.mjs';

const TEMPLATE = new URL('./task-claude.md.tmpl', import.meta.url);
const IDENTITY = ['-c', 'user.name=s5', '-c', 'user.email=s5@localhost'];
// Fixed, so that a rebuild writes the same author date; only treeHash matters, not the commit id.
const AUTHOR_DATE = '2026-01-01T00:00:00Z';
// An entry with one of these names is removed wherever it is, whatever its type.
const DROP_NAMES = new Set(['CLAUDE.md', 'AGENTS.md', '.claude', '.codescout']);
const MAX_HITS_SHOWN = 20;
// tar and cp get PATH and nothing else (no TAR_OPTIONS, no POSIXLY_CORRECT, no locale surprises).
const toolEnv = () => ({ PATH: process.env.PATH });

const byteCmp = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function lstatOrNull(p) {
  try {
    return lstatSync(p);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// ---- the task CLAUDE.md ----

// POSIX-shell quoting for one command line: a word of safe characters stays bare, anything else is
// single-quoted ('\'' for a quote inside). The empty string becomes ''.
export function shellQuote(argv) {
  return argv.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`)).join(' ');
}

// The agent runs the existing tests (p2p.command). It is never given f2p.command: that names the
// hidden tests.
export function renderTaskClaudeMd(def) {
  const values = { BUILD_COMMAND: shellQuote(def.buildCommand), TEST_COMMAND: shellQuote(def.p2p.command) };
  // One pass: a command that happens to contain "{{X}}" is not substituted again.
  return readFileSync(TEMPLATE, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`task-claude.md.tmpl: unknown placeholder ${placeholder}`);
    return values[key];
  });
}

// ---- walking and hashing a tree ----

// Every file and symlink under root (directories are not entries), byte-sorted. A symlink to a
// directory is an entry and is not entered. Only the top-level .git is skipped, and only on request.
function listEntries(root, { skipRootGit = false } = {}) {
  const out = [];
  const rec = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (skipRootGit && r === '.git') continue;
      if (e.isDirectory()) rec(r);
      else if (e.isFile() || e.isSymbolicLink()) out.push(r);
      else throw new Error(`buildTask: ${r} is neither a regular file, a directory nor a symlink`);
    }
  };
  rec('');
  return out.sort(byteCmp);
}
// A file's bytes, or a symlink's target string. Never follows a link.
function entryBytes(abs) {
  return lstatSync(abs).isSymbolicLink() ? readlinkSync(abs, { encoding: 'buffer' }) : readFileSync(abs);
}
function hashEntries(root, rels) {
  const h = createHash('sha256');
  for (const rel of rels) h.update(`${rel}\0${sha256(entryBytes(join(root, rel)))}\n`);
  return h.digest('hex');
}

// ---- steps ----

function gitOut(dir, args) {
  const r = git(dir, args);
  if (r.status !== 0) throw new Error(`buildTask: git ${args.join(' ')} failed in ${dir} (exit ${r.status}): ${r.stderr.toString().trim()}`);
  return r.stdout;
}

function requireFirstParent(def) {
  const isCommit = git(def.repoPath, ['rev-parse', '--verify', '-q', `${def.fix}^{commit}`]);
  if (isCommit.status !== 0) {
    throw new Error(`buildTask: fix ${def.fix} is not a commit in ${def.repoPath}${isCommit.stderr.length ? `: ${isCommit.stderr.toString().trim()}` : ''}`);
  }
  const first = git(def.repoPath, ['rev-parse', '--verify', '-q', `${def.fix}^1`]);
  if (first.status !== 0) throw new Error(`buildTask: fix ${def.fix} has no parent, so there is no tree to build a task from`);
  const actual = first.stdout.toString().trim();
  if (actual !== def.parent) {
    throw new Error(`buildTask: parent ${def.parent} is not the first parent of fix ${def.fix} in ${def.repoPath} (the first parent is ${actual})`);
  }
}

function extractTree(def, treeDir) {
  const archive = git(def.repoPath, ['archive', '--format=tar', def.parent]);
  if (archive.status !== 0) throw new Error(`buildTask: git archive ${def.parent} failed in ${def.repoPath}: ${archive.stderr.toString().trim()}`);
  mkdirSync(treeDir);
  const tar = spawnSync('tar', ['-x', '--no-same-owner', '-C', treeDir], { input: archive.stdout, env: toolEnv() });
  if (tar.error) throw new Error(`buildTask: tar could not run: ${tar.error.message}`);
  if (tar.status !== 0) throw new Error(`buildTask: tar -x failed (exit ${tar.status}): ${tar.stderr.toString().trim()}`);
}

// One scrub.removePaths entry. Every directory above it must be a real directory in the tree: a
// symlink there could lead the removal outside the tree. The entry itself may be a link (it goes,
// its target stays). A path the tree does not have is refused: it is a typo that leaves a leak.
function removeListed(tree, rel) {
  const segs = rel.split('/');
  let cur = tree;
  for (let i = 0; i < segs.length; i++) {
    cur = join(cur, segs[i]);
    const st = lstatOrNull(cur);
    if (st === null) throw new Error(`buildTask: scrub.removePaths entry ${rel} does not exist in the tree`);
    if (st.isSymbolicLink() && i < segs.length - 1) {
      throw new Error(`buildTask: scrub.removePaths entry ${rel} goes through the symlink ${segs.slice(0, i + 1).join('/')}; it is refused`);
    }
  }
  rmSync(cur, { recursive: true });
}

function removeNamed(tree) {
  const rec = (rel) => {
    for (const e of readdirSync(join(tree, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      // rmSync looks at the entry itself, so a symlink is unlinked and its target is untouched.
      if (DROP_NAMES.has(e.name)) rmSync(join(tree, r), { recursive: true });
      else if (e.isDirectory()) rec(r);
    }
  };
  rec('');
}

function scrubCheck(tree, terms) {
  const needles = terms.map((term) => [term, Buffer.from(term, 'utf8')]);
  const hits = [];
  for (const rel of listEntries(tree)) {
    const bytes = entryBytes(join(tree, rel));
    for (const [term, needle] of needles) if (bytes.includes(needle)) hits.push(`scrub term ${JSON.stringify(term)} found in ${rel}`);
  }
  if (hits.length === 0) return;
  const shown = hits.slice(0, MAX_HITS_SHOWN);
  if (hits.length > shown.length) shown.push(`... and ${hits.length - shown.length} more`);
  throw new Error(`buildTask: ${hits.length} scrub hit(s) left in the tree:\n${shown.join('\n')}`);
}

function commitTree(tree, id) {
  const run = (...args) => gitOut(tree, args);
  // The path is explicit and the toplevel is checked before add/commit: a git that ignored -C must
  // never get to commit somewhere else.
  run('init', '-q', '-b', 'main', '--template=', tree);
  const top = run('rev-parse', '--show-toplevel').toString().trim();
  if (top !== realpathSync(tree)) throw new Error(`buildTask: git is working in ${top}, not in the task tree ${tree}`);
  // --force: a file the repo tracks but its .gitignore matches is part of the tree all the same.
  run('add', '--all', '--force');
  run(...IDENTITY, 'commit', '-q', '--no-verify', '--no-gpg-sign', '-m', `task ${id}`, `--date=${AUTHOR_DATE}`);
  const commits = run('rev-list', '--count', 'HEAD').toString().trim();
  if (commits !== '1') throw new Error(`buildTask: the task tree has ${commits} commits, expected 1`);
  if (run('remote').length !== 0) throw new Error('buildTask: the task tree has a remote');
  const tracked = run('ls-files', '-z').toString().split('\0').filter(Boolean).sort(byteCmp);
  const onDisk = listEntries(tree, { skipRootGit: true });
  const missing = onDisk.filter((p) => !tracked.includes(p));
  const extra = tracked.filter((p) => !onDisk.includes(p));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`buildTask: the commit and the tree differ; not committed: ${JSON.stringify(missing.slice(0, 5))}, committed but not on disk: ${JSON.stringify(extra.slice(0, 5))}`);
  }
}

function put(dir, rel, bytes) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
}
function writeHidden(def, taskDir, hiddenDir) {
  mkdirSync(hiddenDir);
  for (const rel of def.hidden.files) {
    // cat-file blob: the stored bytes, with no textconv or filter and no decoding.
    const r = git(def.repoPath, ['cat-file', 'blob', `${def.fix}:${rel}`]);
    if (r.status !== 0) throw new Error(`buildTask: hidden file ${rel} is not a file at fix ${def.fix} in ${def.repoPath}: ${r.stderr.toString().trim()}`);
    put(hiddenDir, rel, r.stdout);
  }
  for (const rel of def.hidden.extra ?? []) put(hiddenDir, rel, readFileSync(join(taskDir, 'extra-tests', rel)));
}

// ---- the public entry points ----

export function buildTask(taskDir, { workRoot } = {}) {
  if (typeof workRoot !== 'string' || workRoot === '') throw new TypeError('buildTask: workRoot must be a non-empty string');
  const def = loadTaskDef(taskDir);
  const taskMd = readFileSync(join(taskDir, 'TASK.md'));
  const prompt = readFileSync(join(taskDir, 'prompt.txt'));
  requireFirstParent(def);

  const tasksDir = join(resolve(workRoot), 'tasks');
  const out = join(tasksDir, def.id);
  mkdirSync(tasksDir, { recursive: true });
  try {
    mkdirSync(out); // atomic: two builders cannot both pass
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`buildTask: ${out} already exists; remove it first (a build is never overwritten)`);
    throw err;
  }
  try {
    const treeDir = join(out, 'tree');
    const hiddenDir = join(out, 'hidden');
    extractTree(def, treeDir);
    for (const rel of def.scrub.removePaths) removeListed(treeDir, rel);
    removeNamed(treeDir);
    writeFileSync(join(treeDir, 'CLAUDE.md'), renderTaskClaudeMd(def));
    writeFileSync(join(treeDir, 'TASK.md'), taskMd);
    scrubCheck(treeDir, def.scrub.terms);
    commitTree(treeDir, def.id);
    writeHidden(def, taskDir, hiddenDir);

    const manifest = {
      id: def.id,
      repo: def.repo,
      fix: def.fix,
      parent: def.parent,
      treeHash: hashEntries(treeDir, listEntries(treeDir, { skipRootGit: true })),
      hiddenHash: hashEntries(hiddenDir, listEntries(hiddenDir)),
      promptHash: sha256(prompt),
      taskMdHash: sha256(taskMd),
      def,
    };
    writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } catch (err) {
    rmSync(out, { recursive: true, force: true });
    throw err;
  }
}

// `cp -a --reflink=always`: it fails where the filesystem cannot clone, and never falls back to a
// full copy (a copy that silently costs the whole tree would hide a misplaced work directory).
// -T makes dst THE copy: with plain `cp -a src dst`, an existing dst directory would get src
// nested inside it. A dst this call created is removed again on failure, so a partial copy cannot
// be mistaken for a copy.
export function reflinkCopy(src, dst) {
  const existed = lstatOrNull(dst) !== null;
  const r = spawnSync('cp', ['-a', '--reflink=always', '-T', '--', src, dst], { env: toolEnv(), encoding: 'utf8' });
  const failure = r.error ? `cp could not run: ${r.error.message}` : r.status !== 0 ? `cp exited ${r.status}: ${String(r.stderr).trim()}` : '';
  if (failure === '') return;
  if (!existed) rmSync(dst, { recursive: true, force: true });
  throw new Error(`reflinkCopy: cannot reflink ${src} to ${dst} (there is no fallback to a full copy): ${failure}`);
}
