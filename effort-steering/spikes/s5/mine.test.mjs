// mine.test.mjs — S5 mining rules over fixture git repos (no model call anywhere).
//
// A rule is pinned by a commit that violates THAT rule alone and satisfies every other
// one, so a mutated rule lets exactly one named subject through. The fixtures are tiny
// git repos under os.tmpdir(); they are removed at the end of this file.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { t } from '../../core/testkit.mjs';
import { git } from './git.mjs';
import { mineCommits } from './mine.mjs';
import { makeRepo } from './fixtures/make-repo.mjs';

const SINCE = '2026-09-28';
const OLD = '2026-01-01T00:00:00+00:00';
const day = (d, time = '10:00:00') => `2026-10-${d}T${time}+00:00`;

const dirs = [];
function repo(commits) {
  const r = makeRepo(commits);
  dirs.push(r.dir);
  return r;
}
// Called with only { since, refs }: every other option takes its documented default
// (minFiles 2, minLines 40, maxPerSubsystem 4, excludePrefixes ['effort-steering/']).
const mine = (r, extra = {}) => mineCommits(r.dir, { since: SINCE, refs: ['--all'], ...extra });
const subjects = (cands) => cands.map((c) => c.subject);

const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i}\n`).join('');
const base = { label: 'base', subject: 'chore: base', date: OLD, files: { 'README.md': 'base\n' } };
// A commit that satisfies every rule: 2 source files, 1 test file, 1 changed line each.
const qual = (label, subject, date, extra = {}) => ({
  label,
  subject,
  date,
  files: { [`src/${label}-a.rs`]: 'a\n', [`src/${label}-b.rs`]: 'b\n', [`tests/${label}.rs`]: 't\n', ...extra },
});

t('keeps a fix that changes 2 source files and 1 test file', () => {
  const r = repo([base, qual('f', 'fix(read_file): handle the empty range', day('01'))]);
  const got = mine(r);
  assert.equal(got.length, 1);
  const { patchId, ...rest } = got[0];
  assert.deepEqual(rest, {
    repo: basename(r.dir),
    fix: r.shas.f,
    parent: r.shas.base,
    subject: 'fix(read_file): handle the empty range',
    date: '2026-10-01T10:00:00Z',
    subsystem: 'read_file',
    testFiles: ['tests/f.rs'],
    sourceFiles: ['src/f-a.rs', 'src/f-b.rs'],
    sourceLinesChanged: 2,
  });
  // The recipe is `git show <sha> | git patch-id --stable`, first column (not the commit id).
  const shown = git(r.dir, ['show', r.shas.f]).stdout;
  const expected = git(r.dir, ['patch-id', '--stable'], { input: shown }).stdout.toString().split(/\s+/)[0];
  assert.match(patchId, /^[0-9a-f]{40,64}$/);
  assert.equal(patchId, expected);
});

t("drops: a merge; a root commit; a 'feat' subject; docs only; tests only; source only; 1 source file with 39 lines", () => {
  const r = repo([
    // The first commit has no parent, so there is no tree "at P" to build a task from.
    qual('root', 'fix(root): a root commit has no parent', day('01')),
    { ...base, files: { ...base.files, 'src/l39.rs': lines(20, 'old') } },
    qual('feat', 'feat(read_file): add a mode', day('02')),
    // "fix" inside a subject is not a fix subject: the rule is `^fix`.
    qual('infix', 'feat(read_file): add a bugfix helper', day('02')),
    qual('chore', 'chore: fix lint', day('02')),
    { label: 'docs', subject: 'fix(docs): fix a typo', date: day('02'), files: { 'docs/a.md': 'a\n', 'docs/b.md': 'b\n' } },
    { label: 'testsonly', subject: 'fix(x): tests only', date: day('02'), files: { 'tests/p.rs': 'p\n', 'tests/q.rs': 'q\n' } },
    { label: 'srconly', subject: 'fix(x): source only', date: day('02'), files: { 'src/p.rs': 'p\n', 'src/q.rs': 'q\n' } },
    // 20 deleted + 19 inserted = 39 changed lines in ONE source file, plus a test file.
    { label: 'l39', subject: 'fix(x): one source file with 39 lines', date: day('02'), files: { 'src/l39.rs': lines(19, 'new'), 'tests/l39.rs': 't\n' } },
    qual('keep', 'fix(keep): qualifies', day('03')),
    // The merge brings 2 source files and a test file in over its first parent and has a fix
    // subject, so only the "non-merge" rule can drop it.
    { ...qual('side', 'chore: side work', day('04')), parents: ['base'] },
    { label: 'merge', subject: 'fix(read_file): merge the side work', date: day('05'), parents: ['keep', 'side'], files: {} },
  ]);
  assert.deepEqual(subjects(mine(r)), ['fix(keep): qualifies']);
  // Guard the fixture: the merge really is a merge, and its diff over the first parent qualifies.
  const parents = git(r.dir, ['rev-list', '--parents', '-n', '1', r.shas.merge]).stdout.toString().trim().split(' ');
  assert.equal(parents.length, 3);
  const { status } = git(r.dir, ['diff', '--quiet', r.shas.keep, r.shas.merge]);
  assert.equal(status, 1);
});

t('compares the author date as an instant against since: strictly after, whatever the offset', () => {
  const r = repo([
    base,
    qual('a', 'fix(x): a one second before since', '2026-09-27T23:59:59+00:00'),
    qual('b', 'fix(x): b exactly at since', '2026-09-28T00:00:00+00:00'),
    qual('c', 'fix(x): c one second after since', '2026-09-28T00:00:01+00:00'),
    // 01:00 at +05:00 is 20:00 UTC the day before: its calendar date reads "2026-09-28".
    qual('d', 'fix(x): d on 09-28 locally but before since', '2026-09-28T01:00:00+05:00'),
    qual('e', 'fix(x): e 07:00 at +05:00 is 02:00 UTC', '2026-09-28T07:00:00+05:00'),
  ]);
  const got = mine(r);
  assert.deepEqual(subjects(got), ['fix(x): c one second after since', 'fix(x): e 07:00 at +05:00 is 02:00 UTC']);
  assert.deepEqual(got.map((c) => c.date), ['2026-09-28T00:00:01Z', '2026-09-28T02:00:00Z']);
});

t('keeps 1 source file with 40 changed lines', () => {
  const r = repo([
    { ...base, files: { ...base.files, 'src/l40.rs': lines(20, 'old') } },
    // 20 deleted + 20 inserted: counting only one side would give 20.
    { label: 'swap', subject: 'fix(x): swap 20 lines', date: day('01'), files: { 'src/l40.rs': lines(20, 'new'), 'tests/swap.rs': 't\n' } },
    // 40 inserted, none deleted: counting only deletions would give 0.
    { label: 'add', subject: 'fix(y): add 40 lines', date: day('02'), files: { 'src/big.rs': lines(40, 'n'), 'tests/add.rs': 't\n' } },
  ]);
  const got = mine(r);
  assert.deepEqual(subjects(got), ['fix(x): swap 20 lines', 'fix(y): add 40 lines']);
  assert.deepEqual(got.map((c) => c.sourceLinesChanged), [40, 40]);
  assert.deepEqual(got.map((c) => c.sourceFiles.length), [1, 1]);
});

t('a test file never counts toward the source line total', () => {
  const r = repo([
    base,
    { label: 'f', subject: 'fix(x): small source, huge test', date: day('01'), files: { 'src/a.rs': lines(3, 's'), 'tests/a.rs': lines(60, 't') } },
  ]);
  assert.deepEqual(mine(r), []);
});

t('drops a commit that touches effort-steering/ even when its other files qualify', () => {
  const r = repo([
    base,
    qual('insrc', 'fix(x): effort-steering source path', day('01'), { 'effort-steering/spikes/s5/x.mjs': 'x\n' }),
    qual('intest', 'fix(x): effort-steering test path', day('02'), { 'effort-steering/foo.test.mjs': 'x\n' }),
    // "starts with", not "contains": these paths do not start with the prefix.
    qual('nested', 'fix(x): a path that only contains effort-steering/', day('03'), { 'docs/effort-steering/notes.md': 'x\n' }),
    qual('sibling', 'fix(x): a sibling directory with the same stem', day('04'), { 'effort-steering-notes/a.md': 'x\n' }),
  ]);
  assert.deepEqual(subjects(mine(r)), [
    'fix(x): a path that only contains effort-steering/',
    'fix(x): a sibling directory with the same stem',
  ]);
  // The option is wired: no prefixes keeps all four; another prefix drops its own commit.
  assert.equal(mine(r, { excludePrefixes: [] }).length, 4);
  assert.deepEqual(subjects(mine(r, { excludePrefixes: ['docs/'] })), [
    'fix(x): effort-steering source path',
    'fix(x): effort-steering test path',
    'fix(x): a sibling directory with the same stem',
  ]);
});

t('dedupes a cherry-pick by patch-id and keeps the earliest', () => {
  const r = repo([
    base,
    qual('orig', 'fix(read_file): the original', day('05')),
    // The same patch on the same parent, one authored BEFORE the original and one after:
    // the earliest author date wins, not the first or last commit in any listing order.
    { label: 'early', subject: 'fix(read_file): the original, cherry-picked early', date: day('02'), parents: ['base'], cherryOf: 'orig' },
    { label: 'late', subject: 'fix(read_file): the original, cherry-picked late', date: day('09'), parents: ['base'], cherryOf: 'orig' },
    qual('other', 'fix(grep): a different fix', day('04'), {}),
  ]);
  const got = mine(r);
  assert.deepEqual(got.map((c) => c.fix), [r.shas.early, r.shas.other]);
  // Guard the fixture: the three copies really do share one patch-id, and the other fix does not.
  const byFix = Object.fromEntries(
    ['orig', 'early', 'late', 'other'].map((l) => [l, git(r.dir, ['patch-id', '--stable'], { input: git(r.dir, ['show', r.shas[l]]).stdout }).stdout.toString().split(/\s+/)[0]]),
  );
  assert.equal(byFix.orig, byFix.early);
  assert.equal(byFix.orig, byFix.late);
  assert.notEqual(byFix.orig, byFix.other);
});

t('on equal author dates the duplicate with the lowest sha is kept', () => {
  const copies = Array.from({ length: 8 }, (_, i) => ({ label: `c${i}`, subject: `fix(read_file): copy ${i}`, date: day('03'), parents: ['base'], cherryOf: 'c0' }));
  const r = repo([base, { ...qual('c0', 'fix(read_file): copy 0', day('03')), parents: ['base'] }, ...copies.slice(1)]);
  const got = mine(r);
  assert.equal(got.length, 1);
  const lowest = Object.entries(r.shas).filter(([l]) => /^c\d$/.test(l)).map(([, sha]) => sha).sort()[0];
  assert.equal(got[0].fix, lowest);
});

t("caps subsystem 'read_file' at 4, keeping the 4 earliest", () => {
  // Dates are NOT in history order, so "earliest" cannot be satisfied by list order.
  const order = ['05', '02', '06', '01', '04', '03'];
  const r = repo([
    base,
    ...order.map((d) => qual(`rf${d}`, `fix(read_file): n${d}`, day(d))),
    qual('g', 'fix(grep): another subsystem', day('07')),
  ]);
  assert.deepEqual(subjects(mine(r)), [
    'fix(read_file): n01',
    'fix(read_file): n02',
    'fix(read_file): n03',
    'fix(read_file): n04',
    'fix(grep): another subsystem',
  ]);
  assert.deepEqual(subjects(mine(r, { maxPerSubsystem: 2 })), ['fix(read_file): n01', 'fix(read_file): n02', 'fix(grep): another subsystem']);
});

t('a duplicate does not use up a subsystem cap slot', () => {
  const r = repo([
    base,
    qual('f1', 'fix(read_file): n1', day('01')),
    // A later copy of f1: dedupe removes it BEFORE the cap counts, so f3 still fits.
    { label: 'd1', subject: 'fix(read_file): n1, cherry-picked', date: day('02'), parents: ['base'], cherryOf: 'f1' },
    qual('f2', 'fix(read_file): n2', day('03')),
    qual('f3', 'fix(read_file): n3', day('04')),
    qual('f4', 'fix(read_file): n4', day('05')),
  ]);
  assert.deepEqual(subjects(mine(r, { maxPerSubsystem: 3 })), ['fix(read_file): n1', 'fix(read_file): n2', 'fix(read_file): n3']);
});

t('sorts by author date, then by sha', () => {
  const r = repo([
    base,
    ...['a', 'b', 'c', 'd', 'e'].map((s) => qual(`t${s}`, `fix(${s}): same instant`, day('03'))),
    qual('first', 'fix(z): earlier', day('01')),
  ]);
  const got = mine(r);
  assert.equal(got[0].fix, r.shas.first);
  const tied = got.slice(1).map((c) => c.fix);
  assert.equal(tied.length, 5);
  assert.deepEqual(tied, [...tied].sort());
});

t('uses the parent directory of the most-changed source file when the subject has no scope', () => {
  const r = repo([
    base,
    // The biggest file is a TEST file and must not win; the biggest SOURCE file is mod.rs.
    { label: 'noscope', subject: 'fix: handle the empty range', date: day('01'), files: { 'src/tools/read_file/mod.rs': lines(30, 'm'), 'src/tools/other.rs': lines(3, 'o'), 'tests/big.rs': lines(50, 't') } },
    { ...qual('bang', 'fix(grep)!: drop the flag', day('02')) },
    { label: 'empty', subject: 'fix(): an empty scope falls back', date: day('03'), files: { 'lib/deep/x.rs': lines(5, 'x'), 'lib/y.rs': lines(2, 'y'), 'tests/e.rs': 't\n' } },
    { label: 'top', subject: 'fix: top level files', date: day('04'), files: { 'a.rs': lines(3, 'a'), 'b.rs': lines(1, 'b'), 'tests/top.rs': 't\n' } },
    { label: 'tie', subject: 'fix: equal sizes, the lower path wins', date: day('05'), files: { 'zeta/x.rs': lines(4, 'z'), 'alpha/y.rs': lines(4, 'a'), 'tests/tie.rs': 't\n' } },
  ]);
  const bySubject = Object.fromEntries(mine(r).map((c) => [c.subject, c.subsystem]));
  assert.deepEqual(bySubject, {
    'fix: handle the empty range': 'src/tools/read_file',
    'fix(grep)!: drop the flag': 'grep',
    'fix(): an empty scope falls back': 'lib/deep',
    'fix: top level files': '.',
    'fix: equal sizes, the lower path wins': 'alpha',
  });
});

t('classifies test files by the seven patterns and nothing else', () => {
  const tests = [
    'tests/a.rs', 'test/b.js', 'crates/x/tests/c.rs', // (^|/)tests?/
    'src/foo_test.rs', 'src/foo_tests.rs', // _tests?\.rs$
    'src/tests.rs', // (^|/)tests\.rs$
    'lib/x.test.mjs', 'lib/y.test.js', 'lib/z.test.ts', // \.test\.(mjs|js|ts)$
    'hooks/test-bar.sh', // (^|/)test-[^/]*\.sh$
    'scripts/test_baz.py', // (^|/)test_[^/]*\.py$
    'scripts/qux_test.py', // _test\.py$
  ];
  const sources = [
    'src/latest/a.rs', 'src/attests.rs', 'src/mytests.rs', // "test" inside a name is not a test dir or file
    'lib/test.mjs', 'lib/x.test.json', 'lib/xtest.mjs',
    'hooks/pretest-bar.sh', 'hooks/test-bar.py',
    'scripts/contest_baz.py', 'scripts/baz_tests.py', 'scripts/test-baz.py',
  ];
  const files = Object.fromEntries([...tests, ...sources].map((p) => [p, 'x\n']));
  const r = repo([base, { label: 'f', subject: 'fix(table): classify', date: day('01'), files }]);
  const got = mine(r);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].testFiles, [...tests].sort());
  assert.deepEqual(got[0].sourceFiles, [...sources].sort());
  assert.equal(got[0].sourceLinesChanged, sources.length);
});

t('a binary file is a changed file that adds 0 lines', () => {
  const r = repo([
    base,
    { label: 'f', subject: 'fix(bin): ship a blob', date: day('01'), files: { 'src/a.rs': lines(5, 's'), 'src/blob.bin': '\0\0\0\0\0', 'tests/t.rs': 't\n' } },
  ]);
  const got = mine(r);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].sourceFiles, ['src/a.rs', 'src/blob.bin']);
  assert.equal(got[0].sourceLinesChanged, 5);
});

t('the size rule is files OR lines, and both thresholds are options', () => {
  const r = repo([
    base,
    qual('two', 'fix(x): two small source files', day('01')),
    { label: 'big', subject: 'fix(y): one big source file', date: day('02'), files: { 'src/big.rs': lines(40, 'n'), 'tests/big.rs': 't\n' } },
  ]);
  const pick = (o) => subjects(mine(r, o));
  assert.deepEqual(pick({}), ['fix(x): two small source files', 'fix(y): one big source file']);
  assert.deepEqual(pick({ minFiles: 3 }), ['fix(y): one big source file']);
  assert.deepEqual(pick({ minLines: 41 }), ['fix(x): two small source files']);
  assert.deepEqual(pick({ minFiles: 3, minLines: 41 }), []);
  assert.deepEqual(pick({ minFiles: 3, minLines: 2 }), ['fix(x): two small source files', 'fix(y): one big source file']);
});

t('a commit with no source file is dropped even when the size thresholds are 0', () => {
  const r = repo([
    base,
    qual('ok', 'fix(x): qualifies', day('01')),
    { label: 'testsonly', subject: 'fix(x): tests only', date: day('02'), files: { 'tests/p.rs': 'p\n', 'tests/q.rs': 'q\n' } },
    { label: 'srconly', subject: 'fix(x): source only', date: day('03'), files: { 'src/p.rs': 'p\n', 'src/q.rs': 'q\n' } },
  ]);
  assert.deepEqual(subjects(mine(r, { minFiles: 0, minLines: 0 })), ['fix(x): qualifies']);
});

t('refs are passed through to git log', () => {
  const r = repo([base, qual('f1', 'fix(x): one', day('01')), qual('f2', 'fix(x): two', day('02'))]);
  assert.deepEqual(subjects(mine(r)), ['fix(x): one', 'fix(x): two']);
  assert.deepEqual(subjects(mine(r, { refs: ['refs/heads/f1'] })), ['fix(x): one']);
});

t('a bad option is a TypeError, not an empty result', () => {
  const r = repo([base]);
  const ok = { since: SINCE, refs: ['--all'] };
  for (const bad of [
    {},
    { ...ok, since: 'not a date' },
    { ...ok, since: 20260928 },
    { ...ok, minFiles: -1 },
    { ...ok, minFiles: 1.5 },
    { ...ok, minLines: '40' },
    { ...ok, maxPerSubsystem: NaN },
    { ...ok, excludePrefixes: [''] },
    { ...ok, excludePrefixes: 'effort-steering/' },
    { ...ok, refs: [] },
    { ...ok, refs: [1] },
  ]) {
    assert.throws(() => mineCommits(r.dir, bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => mineCommits(42, ok), TypeError);
});

t('a directory that is not a git repository throws with the git command in the message', () => {
  const empty = mkdtempSync(join(tmpdir(), 's5-fixture-'));
  dirs.push(empty);
  assert.throws(() => mineCommits(empty, { since: SINCE, refs: ['--all'] }), /git .*log.* failed/s);
});

for (const d of dirs) rmSync(d, { recursive: true, force: true });
