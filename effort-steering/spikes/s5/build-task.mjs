// build-task.mjs — build one S5 task from a fix commit C and its parent P.
//
//   buildTask(taskDir, { workRoot }) -> Manifest      (synchronous; no model, no Docker)
//   treeAtFix(manifest, srcTreeDir, dstDir) -> the fix tree's commit id      (the task gate's fix tree)
//   reflinkCopy(src, dst)
//
// Output, under <workRoot>/tasks/<id>/ (which must not exist: a build is never overwritten, the
// caller removes an old one on purpose):
//
//   tree/           the repository at P as ONE fresh commit `task <id>` (s5 <s5@localhost>), no remote,
//                   no history. CLAUDE.md, AGENTS.md, .claude/, .codescout/ and .buddy/ are gone at
//                   every depth and replaced by a short task CLAUDE.md; TASK.md sits at the root.
//   hidden/         the fix commit's version of each hidden.files path, plus each hidden.extra file
//                   from <taskDir>/extra-tests/, each at its relative path.
//   manifest.json   { id, repo, fix, parent, baseCommit, treeHash, hiddenHash, promptHash, taskMdHash, def }
//
// Hashes are sha256 hex.
//   baseCommit  the 40-hex id of the tree's one commit, read right after it is made. The grader diffs an
//               agent's change against it: HEAD moves when the agent commits.
//   treeHash    over every file of tree/ except the top-level .git: for each file, in BYTE-order of its
//               relative path (UTF-8, '/'-separated), feed  path + '\0' + sha256(bytes) + '\n'  into one
//               sha256. A symlink contributes the sha256 of its target STRING; it is never followed.
//               The file mode is not part of the hash.
//   hiddenHash  the same over hidden/ (nothing is excluded there).
//   promptHash  sha256 of prompt.txt's bytes.   taskMdHash  sha256 of TASK.md's bytes.
//
// Leak paths this closes (spec "Building a task"): history (one commit, and the new repository holds
// neither P nor C as an object), a remote, the repo's own CLAUDE.md/AGENTS.md/.claude/.codescout/
// .buddy, the paths named in scrub.removePaths, and every scrub term in every channel the agent
// reads: file bytes, symlink target strings, file, directory and symlink NAMES (the whole relative
// path), the task id (it is in the commit message) and prompt.txt (it is the first user message).
// The tree check runs on the final tree, task CLAUDE.md and TASK.md included. A hit removes the build.
//
// The source repository is the operator's live checkout. It is read only through git on committed
// objects (rev-parse, archive, cat-file): never its working tree, index or refs, and never a command
// that writes. All git calls go through ./git.mjs (scrubbed environment).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, utimesSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { git } from './git.mjs';
import { loadTaskDef } from './task-def.mjs';

const TEMPLATE = new URL('./task-claude.md.tmpl', import.meta.url);
const IDENTITY = ['-c', 'user.name=s5', '-c', 'user.email=s5@localhost'];
// Fixed, so that a rebuild writes the same author date; only treeHash matters, not the commit id.
const AUTHOR_DATE = '2026-01-01T00:00:00Z';
// An entry with one of these names is removed wherever it is, whatever its type. .buddy/ holds
// specialist notes about the codebase (codescout tracks .buddy/memory/; ruling R24).
const DROP_NAMES = new Set(['CLAUDE.md', 'AGENTS.md', '.claude', '.codescout', '.buddy']);
const MAX_HITS_SHOWN = 20;
// tar and cp get PATH and nothing else: no TAR_OPTIONS (it can exclude files from the tree), no
// POSIXLY_CORRECT, no locale surprises.
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

// Every directory, and every file or symlink, under root, each list byte-sorted. A symlink to a
// directory is a file entry and is not entered. Only the top-level .git is skipped, and only on request.
function walkTree(root, { skipRootGit = false } = {}) {
  const files = [];
  const dirs = [];
  const rec = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (skipRootGit && r === '.git') continue;
      if (e.isDirectory()) {
        dirs.push(r);
        rec(r);
      } else if (e.isFile() || e.isSymbolicLink()) files.push(r);
      else throw new Error(`buildTask: ${r} is neither a regular file, a directory nor a symlink`);
    }
  };
  rec('');
  return { files: files.sort(byteCmp), dirs: dirs.sort(byteCmp) };
}
const listEntries = (root, opts) => walkTree(root, opts).files;
// A file's bytes, or a symlink's target string. Never follows a link.
function entryBytes(abs) {
  return lstatSync(abs).isSymbolicLink() ? readlinkSync(abs, { encoding: 'buffer' }) : readFileSync(abs);
}
function hashEntries(root, rels) {
  const h = createHash('sha256');
  for (const rel of rels) h.update(`${rel}\0${sha256(entryBytes(join(root, rel)))}\n`);
  return h.digest('hex');
}

// ---- the scrub ----

const needlesOf = (terms) => terms.map((term) => [term, Buffer.from(term, 'utf8')]);
// One line per scrub term found in `bytes`; `where` says which channel it was found in.
function hitsIn(needles, where, bytes) {
  return needles.filter(([, needle]) => bytes.includes(needle)).map(([term]) => `scrub term ${JSON.stringify(term)} found in ${where}`);
}
function throwHits(hits) {
  if (hits.length === 0) return;
  const shown = hits.slice(0, MAX_HITS_SHOWN);
  if (hits.length > shown.length) shown.push(`... and ${hits.length - shown.length} more`);
  throw new Error(`buildTask: ${hits.length} scrub hit(s):\n${shown.join('\n')}`);
}
// The tree's channels: the bytes of every file and the target string of every symlink, and the whole
// relative path of every file, symlink and directory (so a file, a directory or a link NAMED after the
// fix is found even when its body is clean). Never follows a link.
function scrubTree(tree, needles) {
  const { files, dirs } = walkTree(tree);
  const hits = [];
  for (const rel of files) {
    hits.push(...hitsIn(needles, rel, entryBytes(join(tree, rel))));
    hits.push(...hitsIn(needles, `the path ${rel}`, Buffer.from(rel)));
  }
  for (const rel of dirs) hits.push(...hitsIn(needles, `the directory path ${rel}`, Buffer.from(rel)));
  throwHits(hits);
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

// `sha` is def.parent for the task tree and def.fix for the gate's fix tree. `treeDir` exists and is empty.
function extractTree(def, sha, treeDir) {
  const archive = git(def.repoPath, ['archive', '--format=tar', sha]);
  if (archive.status !== 0) throw new Error(`buildTask: git archive ${sha} failed in ${def.repoPath}: ${archive.stderr.toString().trim()}`);
  const tar = spawnSync('tar', ['-x', '--no-same-owner', '-C', treeDir], { input: archive.stdout, env: toolEnv() });
  if (tar.error) throw new Error(`buildTask: tar could not run: ${tar.error.message}`);
  if (tar.status !== 0) throw new Error(`buildTask: tar -x failed (exit ${tar.status}): ${tar.stderr.toString().trim()}`);
}

// One scrub.removePaths entry. Every directory above it must be a real directory in the tree: a
// symlink there could lead the removal outside the tree. The entry itself may be a link (it goes,
// its target stays). A path the tree does not have is refused: it is a typo that leaves a leak.
// `allowMissing` is for the gate's fix tree, where a fix that deleted or moved the file leaves nothing to remove.
function removeListed(tree, rel, { allowMissing = false } = {}) {
  const segs = rel.split('/');
  // The loader refuses these in task.json; a manifest is read back from disk, so the removal checks it again.
  if (rel === '' || rel.startsWith('/') || segs.some((s) => s === '' || s === '.' || s === '..')) {
    throw new TypeError(`buildTask: scrub.removePaths entry ${JSON.stringify(rel)} must be a relative path without '.', '..' or empty segments`);
  }
  let cur = tree;
  for (let i = 0; i < segs.length; i++) {
    cur = join(cur, segs[i]);
    const st = lstatOrNull(cur);
    if (st === null) {
      if (allowMissing) return;
      throw new Error(`buildTask: scrub.removePaths entry ${rel} does not exist in the tree`);
    }
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

// The two files the builder writes at the tree root. Whatever the repo tracks under the same name (a
// symlink out of the tree, say) goes first, and the write is exclusive, so it can never go THROUGH a
// link: a write that finds anything there fails.
function writeTaskFiles(tree, claudeMd, taskMd) {
  for (const name of ['CLAUDE.md', 'TASK.md']) rmSync(join(tree, name), { recursive: true, force: true });
  writeFileSync(join(tree, 'CLAUDE.md'), claudeMd, { flag: 'wx' });
  writeFileSync(join(tree, 'TASK.md'), taskMd, { flag: 'wx' });
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
  // The task's one commit, read while the tree is still ours: the grader diffs an agent's change against
  // THIS commit, not against HEAD (an agent that commits moves HEAD, and `git diff HEAD` then reads zero).
  return run('rev-parse', 'HEAD').toString().trim();
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
  // Two channels to the agent that are not tree files: the prompt is its first message, and the id is
  // in the commit message. Checked before anything is written.
  const needles = needlesOf(def.scrub.terms);
  throwHits([...hitsIn(needles, 'prompt.txt', prompt), ...hitsIn(needles, 'the task id', Buffer.from(def.id))]);

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
    mkdirSync(treeDir);
    extractTree(def, def.parent, treeDir);
    for (const rel of def.scrub.removePaths) removeListed(treeDir, rel);
    removeNamed(treeDir);
    writeTaskFiles(treeDir, renderTaskClaudeMd(def), taskMd);
    scrubTree(treeDir, needles);
    const baseCommit = commitTree(treeDir, def.id);
    writeHidden(def, taskDir, hiddenDir);

    const manifest = {
      id: def.id,
      repo: def.repo,
      fix: def.fix,
      parent: def.parent,
      baseCommit,
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
// The task CLAUDE.md and TASK.md as the P tree holds them: regular files, never a link.
function readRootFile(dir, name) {
  const p = join(dir, name);
  const st = lstatOrNull(p);
  if (st === null || !st.isFile()) throw new Error(`treeAtFix: ${p} is not a regular file (the fix tree takes the P tree's CLAUDE.md and TASK.md byte for byte)`);
  return readFileSync(p);
}
// A regular file of `tree` that `base` lacks, or holds with other bytes, gets the modification time of now.
//
// Why: `git archive` stamps every file with the fix commit's time, which is older than a warm target built from the P
// tree, and cargo calls a source file fresh unless it is NEWER than the artifact built from it. Left alone, the fix's
// changes would never be compiled: the fix tests would fail against the parent's artifacts and a good task would be
// dropped as fails_at_fix (the first real-Docker gate run found exactly this). A file an agent edits is newer than the
// warm target, and so is a file here, so the fix tree builds like an agent's tree that applied the fix. A file the fix
// leaves alone keeps its time: its artifact is current. (A symlink is skipped: cargo reads its target's time.)
function freshenChanged(tree, base) {
  const now = new Date();
  for (const rel of listEntries(tree)) {
    const abs = join(tree, rel);
    if (lstatSync(abs).isSymbolicLink()) continue;
    const other = lstatOrNull(join(base, rel));
    if (other !== null && other.isFile() && readFileSync(abs).equals(readFileSync(join(base, rel)))) continue;
    utimesSync(abs, now, now);
  }
}

// treeAtFix(manifest, srcTreeDir, dstDir) -> the commit id of the fix tree      (synchronous; no model, no Docker)
//
// The gate's fix tree (ruling R33): the repository at def.fix, shaped exactly like the tree an agent gets, so that
// whatever the removals break (a test that reads a removed AGENTS.md or .codescout/ file) breaks here too, and the
// gate drops the task instead of the measured run finding it. It is built like the task tree, with the sha a
// parameter: git archive of def.fix, scrub.removePaths and then the default named removals (a path the fix deleted or
// moved is skipped, where buildTask refuses a path the PARENT lacks), the root CLAUDE.md and TASK.md copied byte for
// byte from srcTreeDir (the built P tree), the files the fix changed stamped as new as the call (see
// freshenChanged), then the same one-commit git init. NO scrub scan: the fix tree is never
// shown to a model and holds the fix by design. `dstDir` must not exist (its parent must); a failure removes it.
export function treeAtFix(manifest, srcTreeDir, dstDir) {
  const def = manifest?.def;
  if (def === null || typeof def !== 'object') throw new TypeError('treeAtFix: the manifest has no def');
  for (const key of ['id', 'repoPath', 'fix', 'parent']) {
    if (typeof def[key] !== 'string' || def[key] === '') throw new TypeError(`treeAtFix: def.${key} must be a non-empty string`);
  }
  if (!Array.isArray(def.scrub?.removePaths)) throw new TypeError('treeAtFix: def.scrub.removePaths must be an array');
  for (const [what, dir] of [['srcTreeDir', srcTreeDir], ['dstDir', dstDir]]) {
    if (typeof dir !== 'string' || dir === '') throw new TypeError(`treeAtFix: ${what} must be a non-empty string`);
  }
  requireFirstParent(def);
  const claudeMd = readRootFile(srcTreeDir, 'CLAUDE.md');
  const taskMd = readRootFile(srcTreeDir, 'TASK.md');
  try {
    mkdirSync(dstDir); // atomic: a directory that exists is never merged into and never removed
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`treeAtFix: ${dstDir} already exists; it is never merged into (choose a fresh path)`);
    throw err;
  }
  try {
    extractTree(def, def.fix, dstDir);
    for (const rel of def.scrub.removePaths) removeListed(dstDir, rel, { allowMissing: true });
    removeNamed(dstDir);
    writeTaskFiles(dstDir, claudeMd, taskMd);
    freshenChanged(dstDir, srcTreeDir);
    return commitTree(dstDir, def.id);
  } catch (err) {
    rmSync(dstDir, { recursive: true, force: true });
    throw err;
  }
}

// `cp -a --reflink=always`: it fails where the filesystem cannot clone, and never falls back to a
// full copy (a copy that silently costs the whole tree would hide a misplaced work directory).
// ANY existing dst is refused, an empty directory included: a copy into a leftover directory would
// merge, and a stale file (a previous run's solution) would survive into the next run's tree. The
// caller chooses a fresh path. A dst this call created is removed again on failure, so a partial
// copy cannot be mistaken for a copy.
export function reflinkCopy(src, dst) {
  if (lstatOrNull(dst) !== null) throw new Error(`reflinkCopy: ${dst} already exists; it is never merged into (choose a fresh path)`);
  const r = spawnSync('cp', ['-a', '--reflink=always', '--', src, dst], { env: toolEnv(), encoding: 'utf8' });
  const failure = r.error ? `cp could not run: ${r.error.message}` : r.status !== 0 ? `cp exited ${r.status}: ${String(r.stderr).trim()}` : '';
  if (failure === '') return;
  rmSync(dst, { recursive: true, force: true });
  throw new Error(`reflinkCopy: cannot reflink ${src} to ${dst} (there is no fallback to a full copy): ${failure}`);
}
