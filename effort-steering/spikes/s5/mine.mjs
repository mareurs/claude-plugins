// mine.mjs — list candidate fix commits from a git repository by STRUCTURAL rules.
//
// No model is called and no model outcome is read: every rule below is a property of a
// commit's metadata or diff. A candidate is a commit that
//   - has a subject starting with `fix`, has exactly one parent (a merge is dropped, and so
//     is a root commit: there is no tree "at P" to build a task from);
//   - was AUTHORED strictly after `since` (the author date, compared as an instant; git's own
//     --since reads the committer date, which a cherry-pick or rebase moves);
//   - changes at least one test file and at least one non-test ("source") file;
//   - changes `minFiles` or more source files, OR `minLines` or more source lines
//     (insertions + deletions; a binary file counts as a file and adds 0 lines);
//   - changes no path that starts with one of `excludePrefixes`;
// then, among the commits that pass all of that, in (author date, sha) order:
//   - a commit whose `git patch-id --stable` was already seen is dropped, so the earliest
//     author date (then the lowest sha) of each patch survives;
//   - at most `maxPerSubsystem` commits survive per subsystem: the earliest ones.
// The result is sorted by author date, then sha.
//
// `since` is anything Date.parse reads; a bare date (`2026-09-28`) is UTC midnight, and the
// comparison is on the instant, so an offset cannot move a commit across it.
//
// Candidate = { repo, fix, parent, subject, date, subsystem, patchId, testFiles, sourceFiles,
// sourceLinesChanged }. `repo` is the basename of repoDir. `date` is the author date in UTC to
// the second (`2026-10-01T10:00:00Z`), the same on every git version. `parent` is the first
// parent, the tree a task is built from.
//
// Subsystem = the conventional-commit scope in the subject (`fix(read_file): ...` gives
// `read_file`), else the parent directory of the most-changed source file (ties: the path
// that sorts first; a file at the repo root gives `.`).

import { basename, posix, resolve } from 'node:path';
import { git } from './git.mjs';

const TEST_FILE_PATTERNS = [
  /(^|\/)tests?\//,
  /_tests?\.rs$/,
  /(^|\/)tests\.rs$/,
  /\.test\.(mjs|js|ts)$/,
  /(^|\/)test-[^/]*\.sh$/,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.py$/,
];

const DEFAULTS = {
  refs: ['--all'],
  excludePrefixes: ['effort-steering/'],
  maxPerSubsystem: 4,
  minFiles: 2,
  minLines: 40,
};

const isTestFile = (path) => TEST_FILE_PATTERNS.some((re) => re.test(path));

// stdout of a git call that must succeed.
function gitOut(dir, args, opts) {
  const r = git(dir, args, opts);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.toString().trim()}`);
  return r.stdout;
}

function resolveOptions(options) {
  const o = options ?? {};
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = o[key] ?? DEFAULTS[key];
  if (typeof o.since !== 'string' || Number.isNaN(Date.parse(o.since))) {
    throw new TypeError(`mineCommits: since must be a date string Date.parse understands, got ${JSON.stringify(o.since)}`);
  }
  out.sinceMs = Date.parse(o.since);
  for (const key of ['maxPerSubsystem', 'minFiles', 'minLines']) {
    if (!Number.isSafeInteger(out[key]) || out[key] < 0) throw new TypeError(`mineCommits: ${key} must be a safe integer >= 0, got ${JSON.stringify(out[key])}`);
  }
  if (!Array.isArray(out.refs) || out.refs.length === 0 || out.refs.some((r) => typeof r !== 'string' || r === '')) {
    throw new TypeError(`mineCommits: refs must be a non-empty array of non-empty strings, got ${JSON.stringify(out.refs)}`);
  }
  // An empty prefix matches every path and would silently drop everything.
  if (!Array.isArray(out.excludePrefixes) || out.excludePrefixes.some((p) => typeof p !== 'string' || p === '')) {
    throw new TypeError(`mineCommits: excludePrefixes must be an array of non-empty strings, got ${JSON.stringify(out.excludePrefixes)}`);
  }
  return out;
}

// One record per line: sha NUL parents NUL author-epoch-seconds NUL subject. A subject is one
// line (%s folds it) and git refuses a NUL in a message, so neither separator can occur inside a field.
function listCommits(repoDir, refs) {
  const out = gitOut(repoDir, ['log', ...refs, '--format=%H%x00%P%x00%at%x00%s', '--']).toString('utf8');
  const commits = [];
  for (const line of out.split('\n')) {
    if (line === '') continue;
    const f = line.split('\0');
    if (f.length !== 4) throw new Error(`git log: unparseable record ${JSON.stringify(line)}`);
    const authoredMs = Number(f[2]) * 1000;
    if (!Number.isSafeInteger(authoredMs)) throw new Error(`git log: bad author date in ${JSON.stringify(line)}`);
    commits.push({ sha: f[0], parents: f[1] === '' ? [] : f[1].split(' '), authoredMs, subject: f[3] });
  }
  return commits;
}

// [{ path, lines }] changed between the parent and the commit. `-z` leaves paths unquoted;
// a rename is a delete plus an add, so every record has one path (diff-tree detects no
// renames unless asked; --no-renames pins that against a future default).
function changedFiles(repoDir, parent, sha) {
  const out = gitOut(repoDir, ['diff-tree', '-r', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', parent, sha]).toString('utf8');
  const files = [];
  for (const entry of out.split('\0')) {
    if (entry === '') continue;
    const a = entry.indexOf('\t');
    const b = entry.indexOf('\t', a + 1);
    if (a < 0 || b < 0) throw new Error(`git diff-tree: unparseable numstat record ${JSON.stringify(entry)}`);
    const count = (s) => (s === '-' ? 0 : Number(s)); // `-` marks a binary file
    const lines = count(entry.slice(0, a)) + count(entry.slice(a + 1, b));
    if (!Number.isSafeInteger(lines)) throw new Error(`git diff-tree: bad line count in ${JSON.stringify(entry)}`);
    files.push({ path: entry.slice(b + 1), lines });
  }
  return files;
}

function patchIdOf(repoDir, sha) {
  const patch = gitOut(repoDir, ['show', '--no-ext-diff', '--no-textconv', sha]);
  const out = gitOut(repoDir, ['patch-id', '--stable'], { input: patch }).toString('utf8');
  const id = out.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40,64}$/.test(id)) throw new Error(`no patch-id for ${sha}: git patch-id said ${JSON.stringify(out)}`);
  return id;
}

function subsystemOf(subject, sourceFiles) {
  const scope = /^fix\(([^)]+)\)!?:/.exec(subject)?.[1].trim();
  if (scope) return scope;
  // Most-changed source file; on a tie the path that sorts first.
  const biggest = [...sourceFiles].sort((x, y) => y.lines - x.lines || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))[0];
  return posix.dirname(biggest.path);
}

const byDateThenSha = (x, y) => x.authoredMs - y.authoredMs || (x.sha < y.sha ? -1 : x.sha > y.sha ? 1 : 0);

export function mineCommits(repoDir, options) {
  if (typeof repoDir !== 'string' || repoDir === '') throw new TypeError(`mineCommits: repoDir must be a non-empty string, got ${JSON.stringify(repoDir)}`);
  const { sinceMs, refs, excludePrefixes, maxPerSubsystem, minFiles, minLines } = resolveOptions(options);
  const repo = basename(resolve(repoDir));

  // 1. Cheap rules first: a diff is read only for a commit that survives them.
  const qualified = [];
  for (const c of listCommits(repoDir, refs)) {
    if (c.parents.length !== 1) continue;
    if (!c.subject.startsWith('fix')) continue;
    if (!(c.authoredMs > sinceMs)) continue;
    const files = changedFiles(repoDir, c.parents[0], c.sha);
    if (files.some((f) => excludePrefixes.some((p) => f.path.startsWith(p)))) continue;
    const testFiles = files.filter((f) => isTestFile(f.path));
    const sourceFiles = files.filter((f) => !isTestFile(f.path));
    if (testFiles.length === 0 || sourceFiles.length === 0) continue;
    const sourceLinesChanged = sourceFiles.reduce((n, f) => n + f.lines, 0);
    if (!(sourceFiles.length >= minFiles || sourceLinesChanged >= minLines)) continue;
    qualified.push({ ...c, parent: c.parents[0], testFiles, sourceFiles, sourceLinesChanged });
  }
  qualified.sort(byDateThenSha);

  // 2. One commit per patch (the earliest), then the per-subsystem cap (the earliest).
  const seenPatches = new Set();
  const perSubsystem = new Map();
  const candidates = [];
  for (const c of qualified) {
    const patchId = patchIdOf(repoDir, c.sha);
    if (seenPatches.has(patchId)) continue;
    seenPatches.add(patchId);
    const subsystem = subsystemOf(c.subject, c.sourceFiles);
    const kept = perSubsystem.get(subsystem) ?? 0;
    if (kept >= maxPerSubsystem) continue;
    perSubsystem.set(subsystem, kept + 1);
    candidates.push({
      repo,
      fix: c.sha,
      parent: c.parent,
      subject: c.subject,
      date: new Date(c.authoredMs).toISOString().replace('.000Z', 'Z'),
      subsystem,
      patchId,
      testFiles: c.testFiles.map((f) => f.path).sort(),
      sourceFiles: c.sourceFiles.map((f) => f.path).sort(),
      sourceLinesChanged: c.sourceLinesChanged,
    });
  }
  return candidates;
}
