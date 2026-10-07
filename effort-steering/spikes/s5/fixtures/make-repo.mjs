// make-repo.mjs — build a tiny fixture git repository from a list of commit specs.
//
//   makeRepo(commits) -> { dir, shas }
//
//   commit = { label, subject, date, files?, parents?, cherryOf? }
//     label     [A-Za-z0-9_-]+, unique; names the commit in `shas` and in `parents`/`cherryOf`.
//               Every labelled commit also gets the branch refs/heads/<label>, so
//               `git log --all` reaches all of them and `refs: ['refs/heads/<label>']` works.
//     subject   the commit message.
//     date      the AUTHOR date, any ISO 8601 string with an offset. The committer date is
//               the wall clock; mining reads author dates only.
//     files     { path: string | null }: write the file, or delete it for null. Paths are
//               relative to the repo and may not leave it or touch .git.
//     parents   labels. Default: the previous commit in the list (none for the first).
//               More than one makes a merge commit (the others are merged into the first,
//               and `files` are applied on top of the merge result). Only the FIRST commit
//               may be a root commit.
//     cherryOf  label: re-apply that commit's patch instead of writing `files`. Put it on a
//               parent where the patch applies (usually the source commit's own parent).
//
// Git runs through ../git.mjs (scrubbed environment). Because that scrub removes HOME and
// every GIT_* variable, identity is passed with -c on each call and the author date with
// `git commit --date`.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { git } from '../git.mjs';

const IDENTITY = ['-c', 'user.name=s5', '-c', 'user.email=s5@localhost'];
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function run(dir, args, opts) {
  const r = git(dir, [...IDENTITY, ...args], opts);
  if (r.status !== 0) throw new Error(`makeRepo: git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.toString().trim()}`);
  return r.stdout;
}

function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const abs = resolve(dir, path);
    const inside = abs.startsWith(dir + sep) && !isAbsolute(path);
    if (!inside || path.split('/').includes('.git')) throw new Error(`makeRepo: path leaves the repo or touches .git: ${path}`);
    if (content === null) {
      rmSync(abs, { force: true });
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }
}

export function makeRepo(commits) {
  const dir = mkdtempSync(join(tmpdir(), 's5-fixture-'));
  const shas = {};
  try {
    // The path is explicit so that a git that ignored -C would still initialise the fixture and
    // not the caller's cwd; the check then refuses to go on (add -A, commit) anywhere else.
    run(dir, ['init', '-q', '-b', 'main', dir]);
    const top = run(dir, ['rev-parse', '--show-toplevel']).toString().trim();
    if (top !== realpathSync(dir)) throw new Error(`makeRepo: git is working in ${top}, not in the fixture ${dir}`);
    let prev = null;
    for (const spec of commits) {
      const { label, subject, date } = spec;
      if (!LABEL.test(label ?? '')) throw new Error(`makeRepo: bad label ${JSON.stringify(label)}`);
      if (Object.hasOwn(shas, label)) throw new Error(`makeRepo: duplicate label ${label}`);
      if (typeof subject !== 'string' || typeof date !== 'string') throw new Error(`makeRepo: ${label} needs a subject and a date`);
      if (spec.cherryOf !== undefined && spec.files !== undefined) throw new Error(`makeRepo: ${label} has both cherryOf and files`);
      const parents = spec.parents ?? (prev === null ? [] : [prev]);
      for (const p of parents) if (!Object.hasOwn(shas, p)) throw new Error(`makeRepo: ${label} names an unknown parent ${p}`);
      if (parents.length === 0 && prev !== null) throw new Error(`makeRepo: ${label} has no parent; only the first commit may be a root`);

      if (parents.length > 0) {
        run(dir, ['checkout', '-q', '--detach', shas[parents[0]]]);
        if (parents.length > 1) {
          run(dir, ['merge', '--no-ff', '--no-commit', '-q', ...parents.slice(1).map((p) => shas[p])]);
          // A merge of an ancestor is a no-op that leaves no MERGE_HEAD; do not let it pass as one.
          if (git(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status !== 0) throw new Error(`makeRepo: ${label} is not a merge: its second parent is already an ancestor`);
        }
      }
      if (spec.cherryOf !== undefined) {
        if (!Object.hasOwn(shas, spec.cherryOf)) throw new Error(`makeRepo: ${label} cherry-picks an unknown commit ${spec.cherryOf}`);
        const patch = run(dir, ['show', '--format=', shas[spec.cherryOf]]);
        run(dir, ['apply', '--index', '--whitespace=nowarn'], { input: patch });
      } else {
        writeFiles(dir, spec.files ?? {});
      }
      run(dir, ['add', '-A']);
      run(dir, ['commit', '-q', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', subject, '--date', date]);
      const sha = run(dir, ['rev-parse', 'HEAD']).toString().trim();
      run(dir, ['update-ref', `refs/heads/${label}`, sha]);
      shas[label] = sha;
      prev = label;
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { dir, shas };
}
