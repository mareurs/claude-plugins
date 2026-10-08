// build-task.test.mjs — the S5 task builder and the task definition loader.
//
// The source repository is a fixture made by fixtures/make-repo.mjs: commits base -> parent -> fix,
// a side branch and a merge (to tell a first parent from a second one). Expected values are
// recomputed here with plain fs calls, not with the builder's own helpers, so a mistake in the
// builder's walk or hash cannot agree with itself. Nothing here starts a model or Docker.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { t } from '../../core/testkit.mjs';
import { git } from './git.mjs';
import { makeRepo } from './fixtures/make-repo.mjs';
import { buildTask, reflinkCopy, renderTaskClaudeMd, shellQuote, treeAtFix } from './build-task.mjs';
import { moduleOf } from './grade.mjs';
import { IMAGE_FOR_REPO, loadTaskDef, moduleOf as loaderModuleOf } from './task-def.mjs';

const made = [];
function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byteCmp = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function lstatOrNull(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

// ---- independent walk and hash, straight from the spec in build-task.mjs's header ----

function walk(root, { skipGit = false } = {}) {
  const out = [];
  const rec = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (skipGit && r === '.git') continue;
      if (e.isDirectory()) rec(r);
      else out.push(r);
    }
  };
  rec('');
  return out.sort(byteCmp);
}
function expectedHash(root, rels) {
  const h = createHash('sha256');
  for (const rel of [...rels].sort(byteCmp)) {
    const abs = join(root, rel);
    const bytes = lstatSync(abs).isSymbolicLink() ? Buffer.from(readlinkSync(abs)) : readFileSync(abs);
    h.update(`${rel}\0${sha256(bytes)}\n`);
  }
  return h.digest('hex');
}
// path + size + mtime of everything under dir, directories included (a lock file that is made and
// removed still moves its directory's mtime).
function snapshot(dir) {
  const out = [];
  const rec = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      const st = lstatSync(join(dir, r));
      out.push(`${r} ${st.isDirectory() ? 'd' : st.size} ${st.mtimeMs}`);
      if (e.isDirectory()) rec(r);
    }
  };
  rec('');
  return out.sort();
}

// ---- the source repository ----

const SLUG = 'add-subtracts-slug';
const ISSUE = 'docs/issues/2026-10-05-add-subtracts.md';
const OLD_HIDDEN_A = '// OLD hidden_a, as at the parent\n';
const FIX_HIDDEN_A = '// FIX hidden_a, as at the fix\n';
const NEW_HIDDEN = '// a test file the fix adds\n';
const DATA_BIN = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x0a]); // not UTF-8
const BLOB = Buffer.concat([Buffer.from([0, 1, 2, 0xff]), Buffer.from('BINLEAK'), Buffer.from([0, 0])]);
const BASE_FILES = {
  'README.md': 'abc readme\n',
  'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a - b }\n',
  'tests/old.rs': '// existing behaviour\n',
  'tests/hidden_a.rs': OLD_HIDDEN_A,
  'CLAUDE.md': '# the repo claude file\n',
  'AGENTS.md': '# agents\n',
  'sub/CLAUDE.md': '# sub claude\n',
  'sub/deep/AGENTS.md': '# deep agents\n',
  '.claude/settings.json': '{}\n',
  'sub/.claude/commands/x.md': 'x\n',
  '.codescout/memories/notes.md': 'notes\n',
  'sub/deep/.codescout/m.md': 'm\n',
  '.buddy/memory/INDEX.md': 'specialist notes\n',
  'sub/.buddy/memory/n.md': 'nested specialist notes\n',
  // Decoys: a name that only STARTS like a removed one must stay.
  '.claude-plugin/plugin.json': '{"keep":true}\n',
  'docs/CLAUDE.md.bak': 'decoy\n',
  '.buddy-notes.md': 'decoy\n',
  [ISSUE]: `# bug ${SLUG}\n`,
  'ignored.txt': 'tracked at the parent, matched by .gitignore\n',
  'data/blob.bin': BLOB,
  // Names that carry a scrub term while the bodies are clean (see the scrub tests).
  'docs/notes/name-leak-widget.md': 'a clean body\n',
  'name-leak-dir/keep.txt': 'a clean body\n',
  // Sort-order probes: byte order puts B.txt first and a-b.txt, a.txt, a/x.txt in that order.
  'B.txt': 'upper\n',
  'a.txt': 'lower\n',
  'a-b.txt': 'dash\n',
  'a/x.txt': 'nested\n',
  // Byte order is UTF-8 byte order, not UTF-16 code-unit order: U+FF5E (EF BD 9E) sorts BEFORE
  // U+10000 (F0 90 80 80) in bytes, and after it as UTF-16 (D800 DC00 < FF5E).
  'u/～.txt': 'bmp\n',
  'u/\u{10000}.txt': 'astral\n',
};
const EXPECT_TREE = [
  '.buddy-notes.md', '.claude-plugin/plugin.json', '.gitignore', 'B.txt', 'CLAUDE.md', 'README.md', 'TASK.md', 'a-b.txt', 'a.txt', 'a/x.txt',
  'data/blob.bin', 'docs/CLAUDE.md.bak', 'docs/notes/name-leak-widget.md', 'ignored.txt', 'name-leak-dir/keep.txt', 'src/lib.rs',
  'tests/hidden_a.rs', 'tests/old.rs', 'u/～.txt', 'u/\u{10000}.txt',
].sort(byteCmp);

function makeSrc({ hiddenASuffix = '' } = {}) {
  const { dir, shas } = makeRepo([
    { label: 'base', subject: 'chore: base', date: '2026-10-01T10:00:00+00:00', files: BASE_FILES },
    // .gitignore comes AFTER ignored.txt is tracked, so the file stays tracked while being ignored.
    { label: 'parent', subject: 'chore: parent', date: '2026-10-02T10:00:00+00:00', files: { '.gitignore': 'ignored.txt\nTASK.md\n', 'README.md': 'abc readme v2\n' } },
    {
      label: 'fix', subject: 'fix(add): add adds', date: '2026-10-03T10:00:00+00:00',
      files: { 'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'tests/hidden_a.rs': FIX_HIDDEN_A + hiddenASuffix, 'tests/new_hidden.rs': NEW_HIDDEN, 'tests/data.bin': DATA_BIN },
    },
    { label: 'side', parents: ['base'], subject: 'chore: side', date: '2026-10-04T10:00:00+00:00', files: { 'side.txt': 'side\n' } },
    { label: 'fixm', parents: ['parent', 'side'], subject: 'fix: merged', date: '2026-10-05T10:00:00+00:00', files: { 'merged.txt': 'merged\n' } },
  ]);
  made.push(dir);
  // The working tree is at fixm; an untracked file must not reach the task tree either.
  writeFileSync(join(dir, 'untracked-leak.txt'), 'UNTRACKED\n');
  return { dir, shas };
}

// One more commit on the fixture, by plain git calls (makeRepo cannot write symlinks or gitlinks).
// A gitlink (a submodule entry) comes out of `git archive` as an EMPTY DIRECTORY.
function addCommit(dir, { files = {}, links = {}, gitlinks = {}, subject }) {
  const id = ['-c', 'user.name=s5', '-c', 'user.email=s5@localhost'];
  const ok = (args) => {
    const r = git(dir, [...id, ...args]);
    assert.equal(r.status, 0, r.stderr.toString());
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  for (const [p, target] of Object.entries(links)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    rmSync(join(dir, p), { force: true });
    symlinkSync(target, join(dir, p));
  }
  ok(['add', '-A']);
  // After `add -A`, which would drop an entry that has no working-tree path.
  for (const [p, sha] of Object.entries(gitlinks)) ok(['update-index', '--add', '--cacheinfo', `160000,${sha},${p}`]);
  ok(['commit', '-q', '--no-verify', '--no-gpg-sign', '-m', subject, '--date', '2026-10-02T10:00:00+00:00']);
  return git(dir, ['rev-parse', 'HEAD']).stdout.toString().trim();
}

// A source with symlinks at the parent: one to a sibling file, one dangling, three that leave the
// tree (a file, a directory, and one named .claude), one named like a scrub term, TASK.md and
// CLAUDE.md as links out of the tree, and a gitlink (an empty directory once archived).
// `linkTarget` is what `link` points to.
function makeLinkSrc(outside, linkTarget) {
  const { dir, shas } = makeRepo([
    { label: 'base', subject: 'chore: base', date: '2026-10-01T10:00:00+00:00', files: { 'a.txt': 'same\n', 'b.txt': 'same\n' } },
  ]);
  made.push(dir);
  const parent = addCommit(dir, {
    subject: 'chore: links',
    links: {
      link: linkTarget,
      gone: 'does-not-exist',
      outlink: join(outside, 'secret.txt'),
      outdir: outside,
      '.claude': outside,
      'name-leak-link': 'a.txt',
      'TASK.md': join(outside, 'task-target.txt'),
      'CLAUDE.md': join(outside, 'claude-target.txt'),
    },
    gitlinks: { 'name-leak-submod': 'a'.repeat(40) },
  });
  const fix = addCommit(dir, { subject: 'fix: x', files: { 'tests/h.txt': 'fixed\n' } });
  return { dir, shas: { base: shas.base, parent, fix } };
}
const TASK_TARGET = 'ORIGINAL task target\n';
const CLAUDE_TARGET = 'ORIGINAL claude target\n';
function makeOutside() {
  const outside = tmp('s5-outside-');
  writeFileSync(join(outside, 'secret.txt'), 'LEAKMARK\n');
  writeFileSync(join(outside, 'task-target.txt'), TASK_TARGET);
  writeFileSync(join(outside, 'claude-target.txt'), CLAUDE_TARGET);
  return outside;
}
// For a link source: the files the task lists are the ones the link fixture has, and LEAKMARK
// (which sits in the file outside the tree) is the only scrub term.
const forLinks = (d) => {
  d.hidden = { files: ['tests/h.txt'] };
  d.scrub = { removePaths: [], terms: ['LEAKMARK'] };
};

// ---- task definitions ----

const TASK_MD = '# Task\n\nadd must add.\n';
const PROMPT = 'add returns the difference of its arguments.\n';
const EXTRA = { 'tests/extra_keep.rs': '// authored behaviour test, v1\n' };

function baseDef(src) {
  return {
    id: 'fix-add',
    repo: 'codescout',
    repoPath: src.dir,
    fix: src.shas.fix,
    parent: src.shas.parent,
    subsystem: 'math',
    testRunner: 'cargo',
    hidden: {
      files: ['tests/hidden_a.rs', 'tests/new_hidden.rs', 'tests/data.bin'],
      extra: ['tests/extra_keep.rs'],
      graftLines: [{ file: 'src/lib.rs', line: 'mod new_hidden;' }],
    },
    buildCommand: ['cargo', 'test', '--no-run', '--no-default-features'],
    f2p: { command: ['cargo', 'test', '--no-fail-fast', '--test', 'hidden_a'], names: ['hidden_a::adds'] },
    p2p: { command: ['cargo', 'test', '--no-fail-fast', '--test', 'old', '--', "it's a filter"], names: ['old::keeps'] },
    testPatterns: ['tests/'],
    scrub: { removePaths: [ISSUE], terms: [SLUG] },
    timeoutsSec: { build: 600, test: 300 },
  };
}
// `edit(def)` changes the definition in place. `taskMd`/`prompt` null leaves that file out.
function makeTaskDir(src, { edit, taskMd = TASK_MD, prompt = PROMPT, extra = EXTRA, def = baseDef(src) } = {}) {
  const dir = tmp('s5-task-');
  if (edit) edit(def);
  writeFileSync(join(dir, 'task.json'), JSON.stringify(def, null, 2));
  if (taskMd !== null) writeFileSync(join(dir, 'TASK.md'), taskMd);
  if (prompt !== null) writeFileSync(join(dir, 'prompt.txt'), prompt);
  for (const [p, c] of Object.entries(extra)) {
    mkdirSync(dirname(join(dir, 'extra-tests', p)), { recursive: true });
    writeFileSync(join(dir, 'extra-tests', p), c);
  }
  return dir;
}
function build(src, opts = {}) {
  const taskDir = makeTaskDir(src, opts);
  const workRoot = opts.workRoot ?? tmp('s5-work-');
  const manifest = buildTask(taskDir, { workRoot });
  const out = join(workRoot, 'tasks', manifest.id);
  return { manifest, taskDir, workRoot, out, treeDir: join(out, 'tree'), hiddenDir: join(out, 'hidden') };
}
// The build of this definition must throw an Error that matches every pattern, and leave no task dir
// (whatever its id) behind.
function refuses(src, label, opts, ...patterns) {
  const workRoot = tmp('s5-work-');
  let err;
  try {
    buildTask(makeTaskDir(src, opts), { workRoot });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof Error, `${label}: must throw`);
  for (const p of patterns) assert.match(err.message, p, label);
  const tasks = join(workRoot, 'tasks');
  assert.ok(!existsSync(tasks) || readdirSync(tasks).length === 0, `${label}: no task dir may remain`);
}

const src = makeSrc();

// ---- loadTaskDef ----

// A definition edited by `edit` must be refused with a TypeError whose message matches every pattern.
function rejects(label, edit, ...patterns) {
  const dir = makeTaskDir(src, { edit });
  let err;
  try {
    loadTaskDef(dir);
  } catch (e) {
    err = e;
  }
  assert.ok(err, `${label}: must throw`);
  assert.ok(err instanceof TypeError, `${label}: must be a TypeError, got ${err}`);
  for (const p of patterns) assert.match(err.message, p, label);
}

// A benign, valid command for each runner: a test replaces the one phase it is about and leaves the other valid.
const BENIGN = { cargo: ['cargo', 'test', '--no-fail-fast'], node: ['node', 'tests/ok.test.mjs'], sh: ['sh', 'tests/ok.sh'] };
const withCommand = (phase, command, runner) => (d) => {
  d.testRunner = runner;
  d.f2p.command = BENIGN[runner];
  d.p2p.command = BENIGN[runner];
  d[phase].command = command;
};

t('loadTaskDef returns the validated definition; hidden.extra and hidden.graftLines are optional', () => {
  assert.deepEqual(loadTaskDef(makeTaskDir(src)), baseDef(src));
  const bare = baseDef(src);
  delete bare.hidden.extra;
  delete bare.hidden.graftLines;
  assert.deepEqual(loadTaskDef(makeTaskDir(src, { def: bare })), bare);
  for (const repo of ['codescout', 'claude-plugins']) assert.equal(loadTaskDef(makeTaskDir(src, { edit: (d) => { d.repo = repo; } })).repo, repo);
  for (const runner of ['cargo', 'node', 'sh']) assert.equal(loadTaskDef(makeTaskDir(src, { edit: (d) => { d.testRunner = runner; d.f2p.command = BENIGN[runner]; d.p2p.command = BENIGN[runner]; } })).testRunner, runner);
});

t("loadTaskDef rejects an absolute hidden path, a '..' path, empty f2p.names and runner 'pytest', each by name", () => {
  rejects('an absolute hidden path', (d) => { d.hidden.files = ['/etc/passwd']; }, /hidden\.files/, /absolute/);
  rejects("a '..' path", (d) => { d.hidden.files = ['tests/../../x']; }, /hidden\.files/, /\.\./);
  rejects('empty f2p.names', (d) => { d.f2p.names = []; }, /f2p\.names/);
  rejects("runner 'pytest'", (d) => { d.testRunner = 'pytest'; }, /testRunner/, /pytest/);
});

t('every path field refuses an absolute path, a .. or . segment, an empty segment and an empty string, by its own name', () => {
  const fields = [
    ['hidden.files', (d, v) => { d.hidden.files = [v]; }],
    ['hidden.extra', (d, v) => { d.hidden.extra = [v]; }],
    ['hidden.graftLines', (d, v) => { d.hidden.graftLines = [{ file: v, line: 'x' }]; }],
    ['scrub.removePaths', (d, v) => { d.scrub.removePaths = [v]; }],
  ];
  for (const [name, set] of fields) {
    for (const bad of ['/abs', '../x', 'a/../b', './x', 'a/./b', 'a//b', 'a/', '']) {
      rejects(`${name} ${JSON.stringify(bad)}`, (d) => set(d, bad), new RegExp(name.replace('.', '\\.')));
    }
  }
});

t('loadTaskDef rejects every other malformed field by name', () => {
  rejects('id with a capital', (d) => { d.id = 'Bad_Id'; }, /\bid\b/);
  rejects('id with a space', (d) => { d.id = 'a b'; }, /\bid\b/);
  rejects('empty id', (d) => { d.id = ''; }, /\bid\b/);
  rejects('unknown repo', (d) => { d.repo = 'github'; }, /\brepo\b/, /github/);
  rejects('no repo', (d) => { delete d.repo; }, /\brepo\b/);
  rejects('relative repoPath', (d) => { d.repoPath = 'work/codescout'; }, /repoPath/);
  rejects('short fix', (d) => { d.fix = 'abc123'; }, /\bfix\b/);
  rejects('upper-case fix', (d) => { d.fix = 'A'.repeat(40); }, /\bfix\b/);
  rejects('non-hex parent', (d) => { d.parent = 'z'.repeat(40); }, /\bparent\b/);
  rejects('parent equal to fix', (d) => { d.parent = d.fix; }, /\bparent\b/, /fix/);
  rejects('empty subsystem', (d) => { d.subsystem = ''; }, /subsystem/);
  rejects('no testRunner', (d) => { delete d.testRunner; }, /testRunner/);
  rejects('no hidden', (d) => { delete d.hidden; }, /\bhidden\b/);
  rejects('hidden.files not an array', (d) => { d.hidden.files = 'tests/a.rs'; }, /hidden\.files/);
  rejects('hidden.extra not in extra-tests/', (d) => { d.hidden.extra = ['tests/missing.rs']; }, /hidden\.extra/, /missing\.rs/);
  rejects('hidden.extra that is a directory', (d) => { d.hidden.extra = ['tests']; }, /hidden\.extra/);
  rejects('hidden.extra also in hidden.files', (d) => { d.hidden.files = ['tests/extra_keep.rs']; }, /hidden\.extra/, /tests\/extra_keep\.rs/);
  rejects('graftLines.line with a newline', (d) => { d.hidden.graftLines = [{ file: 'src/lib.rs', line: 'a\nb' }]; }, /graftLines/);
  rejects('graftLines.line empty', (d) => { d.hidden.graftLines = [{ file: 'src/lib.rs', line: '' }]; }, /graftLines/);
  rejects('graftLines item with an unknown key', (d) => { d.hidden.graftLines = [{ file: 'src/lib.rs', line: 'x', at: 1 }]; }, /graftLines/, /\bat\b/);
  rejects('empty buildCommand', (d) => { d.buildCommand = []; }, /buildCommand/);
  rejects('buildCommand with a non-string', (d) => { d.buildCommand = ['cargo', 3]; }, /buildCommand/);
  rejects('empty f2p.command', (d) => { d.f2p.command = []; }, /f2p\.command/);
  rejects('no p2p', (d) => { delete d.p2p; }, /\bp2p\b/);
  rejects('empty p2p.command', (d) => { d.p2p.command = []; }, /p2p\.command/);
  rejects('f2p.names with an empty name', (d) => { d.f2p.names = ['a', '']; }, /f2p\.names/);
  rejects('f2p.names not an array', (d) => { d.f2p.names = 'a'; }, /f2p\.names/);
  rejects('p2p.names not an array', (d) => { d.p2p.names = 'a'; }, /p2p\.names/);
  rejects('testPatterns with a non-string', (d) => { d.testPatterns = [1]; }, /testPatterns/);
  rejects('no scrub', (d) => { delete d.scrub; }, /\bscrub\b/);
  rejects('an empty scrub term (it would match every file)', (d) => { d.scrub.terms = ['ok', '']; }, /scrub\.terms/);
  rejects('scrub.removePaths not an array', (d) => { d.scrub.removePaths = ISSUE; }, /scrub\.removePaths/);
  rejects('timeoutsSec.build zero', (d) => { d.timeoutsSec.build = 0; }, /timeoutsSec\.build/);
  rejects('timeoutsSec.test a string', (d) => { d.timeoutsSec.test = '300'; }, /timeoutsSec\.test/);
  rejects('an unknown top-level key', (d) => { d.feature = 1; }, /unknown/, /feature/);
  rejects('a misspelled nested key (scrub.term would silently disable the scrub)', (d) => { d.scrub.term = ['x']; }, /scrub/, /unknown/, /\bterm\b/);
});

// ---- loadTaskDef: the checks the gate and the grader rely on ----

// A definition edited by `edit` must load.
const loads = (label, edit) => {
  assert.doesNotThrow(() => loadTaskDef(makeTaskDir(src, { edit })), label);
};

t('R30: a cargo task\'s f2p and p2p commands that run `cargo test` carry --no-fail-fast before any "--"', () => {
  for (const phase of ['f2p', 'p2p']) {
    const field = new RegExp(`${phase}\\.command`);
    const set = (command) => withCommand(phase, command, 'cargo');
    rejects(`${phase} without it`, set(['cargo', 'test', '--test', 'x']), field, /--no-fail-fast/);
    rejects(`${phase}: after "--" it is a libtest argument, not cargo's`, set(['cargo', 'test', '--', '--no-fail-fast']), field, /--no-fail-fast/);
    rejects(`${phase}: a toolchain override before test`, set(['cargo', '+nightly', 'test', '--lib']), field, /--no-fail-fast/);
    rejects(`${phase}: a global option before test`, set(['cargo', '--locked', 'test', '--lib']), field, /--no-fail-fast/);
    rejects(`${phase}: the alias`, set(['cargo', 't', '--lib']), field, /--no-fail-fast/);
    rejects(`${phase}: a near miss is not the flag`, set(['cargo', 'test', '--no-fail-fast=1']), field);
    loads(`${phase} with the flag first`, set(['cargo', 'test', '--no-fail-fast']));
    loads(`${phase} with the flag among the options`, set(['cargo', 'test', '--lib', '--no-fail-fast', '--', 'filter']));
    loads(`${phase} with a toolchain override and the flag`, set(['cargo', '+nightly', 'test', '--no-fail-fast']));
    // Not `cargo test`: nothing to check.
    loads(`${phase}: cargo build`, set(['cargo', 'build', '--tests']));
    loads(`${phase}: an external subcommand named like test`, set(['cargo', 'test-x']));
  }
});

t('R53: in a cargo task every f2p and p2p command starts with cargo (no env, sh -c or other wrapper hides `cargo test` from R30); in a node task with node; the sh runner is unchanged', () => {
  for (const phase of ['f2p', 'p2p']) {
    const field = new RegExp(`${phase}\\.command`);
    const as = (runner) => (command) => withCommand(phase, command, runner);
    // cargo task: the bypass shapes, none of which carries --no-fail-fast
    for (const wrapped of [
      ['env', 'RUST_BACKTRACE=1', 'cargo', 'test', '--workspace'],
      ['sh', '-c', 'cargo test --workspace'],
      ['bash', '-c', 'cargo test --no-fail-fast'], // even with the flag: the loader cannot see inside
      ['make', 'test'],
      ['/usr/local/bin/cargo', 'test', '--no-fail-fast'],
      ['timeout', '60', 'cargo', 'test'],
    ]) {
      rejects(`${phase} in a cargo task: ${wrapped.join(' ')}`, as('cargo')(wrapped), field, /cargo task/, /start with cargo/);
    }
    loads(`${phase}: cargo in a cargo task`, as('cargo')(['cargo', 'build']));
    // node task
    for (const wrapped of [['env', 'NODE_ENV=test', 'node', '--test', '--test-reporter=tap', 'tests/a.test.mjs'], ['sh', '-c', 'node tests/a.mjs'], ['cargo', 'test']]) {
      rejects(`${phase} in a node task: ${wrapped.join(' ')}`, as('node')(wrapped), field, /node task/, /start with node/);
    }
    loads(`${phase}: node in a node task`, as('node')(['node', 'tests/hidden.test.mjs']));
    // sh task: unchanged, any program
    for (const free of [['sh', 'tests/a.sh'], ['env', 'X=1', 'sh', 'tests/a.sh'], ['cargo', 'test'], ['make', 'test']]) {
      loads(`${phase} in an sh task: ${free.join(' ')}`, as('sh')(free));
    }
  }
});

t('R52: a command that runs `node --test` has --test and --test-reporter=tap before its first positional argument, and no other reporter or destination', () => {
  const TEST = 'tests/a.test.mjs';
  for (const phase of ['f2p', 'p2p']) {
    const field = new RegExp(`${phase}\\.command`);
    const set = (command, runner = 'node') => withCommand(phase, command, runner);
    const refused = [
      ['without a reporter', ['node', '--test', TEST], /--test-reporter=tap/],
      ['with spec', ['node', '--test', '--test-reporter=spec', TEST], /--test-reporter=tap/],
      ['the reporter AFTER the file: node ignores it there (verified on v26.10.0) and prints spec', ['node', '--test', TEST, '--test-reporter=tap'], /before the first positional/],
      ['--test after the file too', ['node', '--test-reporter=tap', TEST, '--test'], /before the first positional/],
      ['--test behind an option value', ['node', '--foo', 'bar', '--test', '--test-reporter=tap', TEST], /--opt=value/],
      ['a second reporter', ['node', '--test', '--test-reporter=tap', '--test-reporter=spec', TEST], /another reporter/],
      ['a second reporter after the file', ['node', '--test', '--test-reporter=tap', TEST, '--test-reporter=spec'], /another reporter/],
      ['a reporter destination', ['node', '--test', '--test-reporter=tap', '--test-reporter-destination=stderr', TEST], /destination/],
      ['a space-separated reporter destination', ['node', '--test', '--test-reporter=tap', '--test-reporter-destination', 'stderr', TEST], /destination/],
      ['a space-separated reporter: tap is then a positional argument', ['node', '--test', '--test-reporter', 'tap', TEST], /--opt=value/],
      ['a space-separated reporter next to tap', ['node', '--test', '--test-reporter=tap', '--test-reporter', 'spec', TEST], /--opt=value/],
      ['a space-separated value before the reporter counts as the first positional', ['node', '--test', '--test-name-pattern', 'alpha', '--test-reporter=tap', TEST], /--opt=value/],
      ['a late --test cannot be told from a script argument: refused, fail closed', ['node', TEST, '--test'], /before the first positional/],
    ];
    for (const [what, command, ...patterns] of refused) {
      rejects(`${phase}: ${what}`, set(command), field, ...patterns);
    }
    rejects(`${phase}: in a task of another runner too`, set(['node', '--test', TEST], 'sh'), field, /--test-reporter=tap/);
    rejects(`${phase}: the late reporter in an sh task`, set(['node', '--test', TEST, '--test-reporter=tap'], 'sh'), field, /before the first positional/);

    loads(`${phase} with tap`, set(['node', '--test', '--test-reporter=tap', TEST]));
    loads(`${phase} with tap given first`, set(['node', '--test-reporter=tap', '--test', TEST]));
    loads(`${phase} with another option in --opt=value form`, set(['node', '--test', '--test-reporter=tap', '--test-name-pattern=x', TEST]));
    loads(`${phase} with several files`, set(['node', '--test', '--test-reporter=tap', TEST, 'tests/b.test.mjs']));
    loads(`${phase} with no file at all`, set(['node', '--test', '--test-reporter=tap']));
    loads(`${phase}: a plain node script`, set(['node', 'tests/hidden.test.mjs']));
    loads(`${phase}: a node option that only starts like --test`, set(['node', '--test-name-pattern=x', TEST]));
    loads(`${phase}: a script that is given a reporter-like argument is not a test run`, set(['node', 'tests/a.mjs', '--test-reporter=spec']));
  }
});

// What gradeTree's own predicate says about each line; the loader must say the same.
const GRAFT_LINES_GOOD = [
  'mod x;', 'pub mod x;', 'pub(crate) mod x;', 'pub(in crate::a) mod x;', '#[cfg(test)] mod x;', 'mod x ;',
  '#[cfg(test)] #[allow(dead_code)] pub(super) mod hidden_support_2;',
];
const GRAFT_LINES_BAD = [
  // the two lines the grader's mutation probe found a looser pattern accepting
  '#[a] fn main() {} #[b] mod x;', 'pub(crate) fn f() {} pub(x) mod y;',
  'mod x { }', 'mod x', 'mod x; mod y;', 'use a::b;', '// mod x;', ' mod x;', 'fn f() {}', 'mod x; // c', 'extern crate x;', 'mod ;', 'mod 1x;', 'mod x;\rmod y;', 'pub pub mod x;',
];

t('R40: a graftLines line declares exactly one Rust module, and the loader asks gradeTree\'s own predicate', () => {
  const lineOf = (line) => (d) => { d.hidden.graftLines = [{ file: 'src/lib.rs', line }]; };
  assert.equal(loaderModuleOf, moduleOf, 'one predicate, not two copies of a regex');
  for (const good of GRAFT_LINES_GOOD) {
    loads(`graftLines.line ${JSON.stringify(good)}`, lineOf(good));
    assert.doesNotThrow(() => moduleOf(good), good);
  }
  for (const bad of GRAFT_LINES_BAD) {
    rejects(`graftLines.line ${JSON.stringify(bad)}`, lineOf(bad), /hidden\.graftLines\[0\]\.line/);
    assert.throws(() => moduleOf(bad), TypeError, bad);
  }
  rejects('the second of two lines', (d) => { d.hidden.graftLines = [{ file: 'src/lib.rs', line: 'mod a;' }, { file: 'src/lib.rs', line: 'use b::c;' }]; }, /hidden\.graftLines\[1\]\.line/, /module/);
});

t('every path field refuses a control character (a newline included) by its own name, and so does repoPath', () => {
  const fields = [
    ['hidden.files', (d, v) => { d.hidden.files = [v]; }],
    ['hidden.extra', (d, v) => { d.hidden.extra = [v]; }],
    ['hidden.graftLines', (d, v) => { d.hidden.graftLines = [{ file: v, line: 'mod x;' }]; }],
    ['scrub.removePaths', (d, v) => { d.scrub.removePaths = [v]; }],
    ['repoPath', (d, v) => { d.repoPath = `/tmp/${v}`; }],
  ];
  for (const [name, set] of fields) {
    for (const bad of ['a\nb', 'a\rb', 'a\tb', 'a\x1bb', 'a\x7fb', 'a\x01', 'a\x00b', 'tests/x\nS5_GRAFT_EOF\ny', '\n']) {
      rejects(`${name} ${JSON.stringify(bad)}`, (d) => set(d, bad), new RegExp(name.replace('.', '\\.')), /control|NUL/);
    }
    // the control: a plain name with a space and a non-ASCII letter is a path (an extra file must also exist, so not that field)
    if (name !== 'repoPath' && name !== 'hidden.extra') loads(`${name} with a space`, (d) => set(d, 'tests/a b/é.rs'));
  }
});

t('IMAGE_FOR_REPO names the image of every repo the loader accepts (R37)', () => {
  assert.deepEqual(IMAGE_FOR_REPO, { codescout: 's5/codescout', 'claude-plugins': 's5/plugins' });
  assert.ok(Object.isFrozen(IMAGE_FOR_REPO));
  for (const repo of ['codescout', 'claude-plugins']) {
    loads(`repo ${repo}`, (d) => { d.repo = repo; });
    assert.equal(typeof IMAGE_FOR_REPO[repo], 'string');
  }
});

t('loadTaskDef needs task.json, TASK.md and prompt.txt, all non-empty and readable', () => {
  const missing = (label, make, ...patterns) => {
    const dir = make();
    let err;
    try {
      loadTaskDef(dir);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error, `${label}: must throw`);
    for (const p of patterns) assert.match(err.message, p, label);
  };
  missing('no TASK.md', () => makeTaskDir(src, { taskMd: null }), /TASK\.md/);
  missing('empty TASK.md', () => makeTaskDir(src, { taskMd: '' }), /TASK\.md/);
  missing('no prompt.txt', () => makeTaskDir(src, { prompt: null }), /prompt\.txt/);
  missing('empty prompt.txt', () => makeTaskDir(src, { prompt: '' }), /prompt\.txt/);
  missing('no task.json', () => { const d = makeTaskDir(src); rmSync(join(d, 'task.json')); return d; }, /task\.json/);
  missing('task.json that is not JSON', () => { const d = makeTaskDir(src); writeFileSync(join(d, 'task.json'), '{ not json'); return d; }, /task\.json/);
  missing('task.json that is an array', () => { const d = makeTaskDir(src); writeFileSync(join(d, 'task.json'), '[]'); return d; }, /task\.json/);
});

// ---- the tree ----

t("the tree has the parent's content, exactly one commit and no remote", () => {
  const b = build(src);
  assert.deepEqual(walk(b.treeDir, { skipGit: true }), EXPECT_TREE);
  assert.equal(readFileSync(join(b.treeDir, 'src/lib.rs'), 'utf8'), BASE_FILES['src/lib.rs'], 'the parent, not the fix');
  assert.equal(readFileSync(join(b.treeDir, 'README.md'), 'utf8'), 'abc readme v2\n', 'the parent, not the base');
  assert.equal(readFileSync(join(b.treeDir, 'tests/hidden_a.rs'), 'utf8'), OLD_HIDDEN_A, 'the parent version of a hidden file');
  assert.deepEqual(readFileSync(join(b.treeDir, 'data/blob.bin')), BLOB, 'binary content is byte-exact');
  assert.ok(!existsSync(join(b.treeDir, 'untracked-leak.txt')), 'the source working tree is not copied');
  assert.ok(!existsSync(join(b.treeDir, 'tests/new_hidden.rs')), 'a file only the fix adds is not in the tree');

  const g = (...args) => git(b.treeDir, args);
  assert.equal(g('rev-list', '--count', 'HEAD').stdout.toString().trim(), '1');
  assert.equal(g('log', '-1', '--format=%an|%ae|%s|%at').stdout.toString().trim(), 's5|s5@localhost|task fix-add|1767225600', 'author date 2026-01-01T00:00:00Z');
  assert.equal(g('remote').stdout.length, 0, 'no remote');
  assert.equal(g('config', '--get-regexp', '^remote\\.').status, 1, 'no remote.* config');
  assert.equal(g('for-each-ref', '--format=%(refname)').stdout.toString().trim(), 'refs/heads/main', 'one ref only');
  assert.equal(g('status', '--porcelain', '--ignored').stdout.length, 0, 'the commit holds the whole tree, ignored files included');
  assert.deepEqual(g('ls-files', '-z').stdout.toString().split('\0').filter(Boolean).sort(byteCmp), EXPECT_TREE, 'committed files = files on disk');
  for (const sha of [src.shas.fix, src.shas.parent, src.shas.base]) {
    assert.notEqual(g('cat-file', '-e', sha).status, 0, `commit ${sha} must not be an object of the new repository`);
  }
});

t('the source repository is only read: it is left byte-identical', () => {
  const before = snapshot(src.dir);
  build(src);
  assert.deepEqual(snapshot(src.dir), before);
});

t('a parent that is not the first parent of the fix is refused and nothing is built', () => {
  refuses(src, 'the grandparent', { edit: (d) => { d.parent = src.shas.base; } }, /first parent/);
  refuses(src, 'the SECOND parent of a merge', { edit: (d) => { d.fix = src.shas.fixm; d.parent = src.shas.side; d.hidden.files = ['tests/old.rs']; } }, /first parent/);
  refuses(src, 'a root commit as the fix', { edit: (d) => { d.fix = src.shas.base; } }, /no parent/);
  refuses(src, 'a fix that does not exist', { edit: (d) => { d.fix = '0'.repeat(40); } }, /not a commit/);
  // The control: the first parent of the same merge is accepted.
  const ok = build(src, { edit: (d) => { d.fix = src.shas.fixm; d.parent = src.shas.parent; d.hidden.files = ['tests/old.rs']; d.hidden.graftLines = []; } });
  assert.equal(ok.manifest.parent, src.shas.parent);
});

t('an existing task dir is refused and left as it was', () => {
  const b = build(src);
  const marker = join(b.out, 'MARKER');
  writeFileSync(marker, 'keep');
  assert.throws(() => buildTask(b.taskDir, { workRoot: b.workRoot }), /already exists/);
  assert.equal(readFileSync(marker, 'utf8'), 'keep');
  assert.ok(existsSync(join(b.treeDir, 'TASK.md')));
});

t('an invalid definition is refused before anything is written', () => {
  const workRoot = tmp('s5-work-');
  const dir = makeTaskDir(src, { edit: (d) => { d.hidden.files = ['../escape.txt']; } });
  assert.throws(() => buildTask(dir, { workRoot }), (e) => e instanceof TypeError && /hidden\.files/.test(e.message));
  assert.ok(!existsSync(join(workRoot, 'tasks')));
});

t('the tar environment is a whitelist: TAR_OPTIONS in the parent environment cannot drop a file from the tree', () => {
  const hazard = '--exclude=README.md';
  // The control: the hazard is live on this machine. Plain tar with the variable leaves README.md out.
  const archive = git(src.dir, ['archive', '--format=tar', src.shas.parent]).stdout;
  const plain = tmp('s5-tarctl-');
  const r = spawnSync('tar', ['-x', '-C', plain], { input: archive, env: { ...process.env, TAR_OPTIONS: hazard } });
  assert.equal(r.status, 0, String(r.stderr));
  assert.ok(existsSync(join(plain, 'src', 'lib.rs')), 'control: the rest of the archive was extracted');
  assert.ok(!existsSync(join(plain, 'README.md')), 'control: TAR_OPTIONS made plain tar skip README.md, so this test proves something');

  const clean = build(src).manifest.treeHash;
  const saved = process.env.TAR_OPTIONS;
  process.env.TAR_OPTIONS = hazard;
  let b;
  try {
    b = build(src);
  } finally {
    if (saved === undefined) delete process.env.TAR_OPTIONS;
    else process.env.TAR_OPTIONS = saved;
  }
  assert.equal(readFileSync(join(b.treeDir, 'README.md'), 'utf8'), 'abc readme v2\n', 'README.md is in the tree');
  assert.equal(b.manifest.treeHash, clean, 'the tree is the same with and without the variable');
});

// ---- scrubbing ----

t('CLAUDE.md, AGENTS.md, .claude/, .codescout/ and .buddy/ are removed and the task CLAUDE.md is written', () => {
  const b = build(src);
  const files = walk(b.treeDir, { skipGit: true });
  const dirs = [];
  const rec = (rel) => {
    for (const e of readdirSync(join(b.treeDir, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory() && r !== '.git') {
        dirs.push(r);
        rec(r);
      }
    }
  };
  rec('');
  const named = (n) => [...files, ...dirs].filter((p) => p.split('/').at(-1) === n);
  assert.deepEqual(named('CLAUDE.md'), ['CLAUDE.md'], 'only the task CLAUDE.md remains, at the root');
  assert.deepEqual(named('AGENTS.md'), [], 'AGENTS.md at any depth');
  assert.deepEqual(named('.claude'), [], '.claude/ at any depth');
  assert.deepEqual(named('.codescout'), [], '.codescout/ at any depth');
  assert.deepEqual(named('.buddy'), [], '.buddy/ at any depth');
  assert.ok(!existsSync(join(b.treeDir, ISSUE)), 'scrub.removePaths');
  assert.ok(existsSync(join(b.treeDir, '.claude-plugin/plugin.json')), 'a name that only starts like .claude stays');
  assert.ok(existsSync(join(b.treeDir, 'docs/CLAUDE.md.bak')), 'a name that only starts like CLAUDE.md stays');
  assert.ok(existsSync(join(b.treeDir, '.buddy-notes.md')), 'a name that only starts like .buddy stays');

  const claude = readFileSync(join(b.treeDir, 'CLAUDE.md'), 'utf8');
  assert.ok(!claude.includes('the repo claude file'), 'it is the task file, not the repo file');
  assert.equal(claude, renderTaskClaudeMd(b.manifest.def));
  assert.ok(claude.includes('cargo test --no-run --no-default-features'), 'names the build command');
  assert.ok(claude.includes("cargo test --no-fail-fast --test old -- 'it'\\''s a filter'"), 'names the test command, shell-quoted');
  assert.ok(!claude.includes('hidden_a'), 'does not name the fail-to-pass command or its tests');
  assert.ok(!claude.includes('{{'), 'no placeholder is left');
  assert.deepEqual(readFileSync(join(b.treeDir, 'TASK.md')), Buffer.from(TASK_MD));
});

t('removal never follows a symlink: a link named .claude goes and its target stays; a removePaths path through a link is refused', () => {
  const outside = makeOutside();
  const link = makeLinkSrc(outside, 'a.txt');
  const b = build(link, { edit: forLinks });
  assert.equal(lstatOrNull(join(b.treeDir, '.claude')), null, 'the .claude link is removed');
  assert.equal(readFileSync(join(outside, 'secret.txt'), 'utf8'), 'LEAKMARK\n', 'the link target is untouched');

  refuses(link, 'a path through a link', { edit: (d) => { forLinks(d); d.scrub.removePaths = ['outdir/secret.txt']; } }, /symlink/, /outdir/);
  assert.equal(readFileSync(join(outside, 'secret.txt'), 'utf8'), 'LEAKMARK\n', 'a path through a link deletes nothing');
});

t('the task files are written fresh: a TASK.md or CLAUDE.md the parent tracks as a symlink out of the tree is replaced, never written through', () => {
  const outside = makeOutside();
  const link = makeLinkSrc(outside, 'a.txt');
  // The control: the fixture really tracks both as symlinks (mode 120000) at the parent.
  for (const name of ['TASK.md', 'CLAUDE.md']) {
    assert.match(git(link.dir, ['ls-tree', link.shas.parent, name]).stdout.toString(), /^120000 blob /, `control: ${name} is a tracked symlink`);
  }
  const b = build(link, { edit: forLinks });
  for (const name of ['TASK.md', 'CLAUDE.md']) assert.ok(lstatSync(join(b.treeDir, name)).isFile(), `${name} in the tree is a regular file, not a link`);
  assert.deepEqual(readFileSync(join(b.treeDir, 'TASK.md')), Buffer.from(TASK_MD));
  assert.equal(readFileSync(join(b.treeDir, 'CLAUDE.md'), 'utf8'), renderTaskClaudeMd(b.manifest.def));
  assert.equal(readFileSync(join(outside, 'task-target.txt'), 'utf8'), TASK_TARGET, 'the file TASK.md pointed to is unchanged');
  assert.equal(readFileSync(join(outside, 'claude-target.txt'), 'utf8'), CLAUDE_TARGET, 'the file CLAUDE.md pointed to is unchanged');
});

t('a removePaths entry the tree does not have is refused', () => {
  refuses(src, 'a missing removePaths entry', { edit: (d) => { d.scrub.removePaths = [ISSUE, 'docs/issues/not-there.md']; } }, /not-there\.md/);
});

t('a scrub term left in the tree throws, names the term and the file, and removes the partial build', () => {
  // a text file the removePaths did not cover
  refuses(src, 'a text file', { edit: (d) => { d.scrub.removePaths = []; } }, new RegExp(`"${SLUG}"`), /docs\/issues\/2026-10-05-add-subtracts\.md/);
  // a binary file, with the term after NUL bytes
  refuses(src, 'a binary file', { edit: (d) => { d.scrub.terms = ['BINLEAK']; } }, /"BINLEAK".*data\/blob\.bin/s);
  // TASK.md is in the tree, so it is scanned too
  refuses(src, 'TASK.md', { edit: (d) => { d.scrub.terms = ['must add']; } }, /"must add".*TASK\.md/s);
  // the written task CLAUDE.md is scanned too (it names the build command)
  refuses(src, 'the task CLAUDE.md', { edit: (d) => { d.scrub.terms = ['--no-run']; } }, /"--no-run".*CLAUDE\.md/s);
  // every hit is reported
  refuses(src, 'two terms', { edit: (d) => { d.scrub.removePaths = []; d.scrub.terms = [SLUG, 'BINLEAK']; } }, new RegExp(`"${SLUG}"`), /"BINLEAK"/);
});

t('the scrub also covers the prompt, the task id, and file, directory and symlink names, not only file bytes', () => {
  // The prompt is the agent's first message.
  refuses(src, 'the prompt', { prompt: `The ${SLUG} case: add returns the wrong value.\n` }, new RegExp(`"${SLUG}".*prompt\\.txt`, 's'));
  // The id is in the commit message (`task <id>`), which `git log` shows.
  refuses(src, 'the task id', { edit: (d) => { d.id = SLUG; } }, new RegExp(`"${SLUG}".*the task id`, 's'));
  // A file NAMED after the fix, with a clean body.
  assert.ok(!BASE_FILES['docs/notes/name-leak-widget.md'].includes('name-leak-widget'), 'control: only the name carries the term');
  refuses(src, 'a file name', { edit: (d) => { d.scrub.terms = ['name-leak-widget']; } }, /"name-leak-widget".*docs\/notes\/name-leak-widget\.md/s);
  // A term that spans two path components.
  refuses(src, 'a term across components', { edit: (d) => { d.scrub.terms = ['notes/name-leak']; } }, /"notes\/name-leak".*docs\/notes\/name-leak-widget\.md/s);
  // A directory NAMED after the fix: the file inside it has a clean name.
  refuses(src, 'a directory name', { edit: (d) => { d.scrub.terms = ['name-leak-dir']; } }, /"name-leak-dir".*name-leak-dir\/keep\.txt/s);
  // A symlink NAMED after the fix, with a clean target, and an EMPTY directory (a gitlink) so named.
  const link = makeLinkSrc(makeOutside(), 'a.txt');
  refuses(link, 'a symlink name', { edit: (d) => { forLinks(d); d.scrub.terms = ['name-leak-link']; } }, /"name-leak-link".*the path name-leak-link/s);
  refuses(link, 'an empty directory name', { edit: (d) => { forLinks(d); d.scrub.terms = ['name-leak-submod']; } }, /"name-leak-submod".*the directory path name-leak-submod/s);
});

t('a scrub term is a fixed byte string: case counts and no pattern is expanded', () => {
  // README.md holds "abc readme v2"; none of these occurs, though a regex or a folded match would find them.
  build(src, { edit: (d) => { d.scrub.terms = ['a.c', 'ABC READ', 'a.*d']; } });
});

t('the scrub reads a symlink as its target string and never follows it', () => {
  const outside = makeOutside();
  const link = makeLinkSrc(outside, 'a.txt');
  // outlink -> <outside>/secret.txt holds LEAKMARK in its target FILE; a follower would throw.
  build(link, { edit: forLinks });
  // The dangling link's target string is content, and is scanned.
  refuses(link, 'a link target string', { edit: (d) => { forLinks(d); d.scrub.terms = ['does-not-exist']; } }, /"does-not-exist".*gone/s);
});

// ---- hidden/ ----

t("hidden/ holds the fix commit's version of each hidden file and the task's extra-tests/ files", () => {
  const b = build(src);
  assert.deepEqual(walk(b.hiddenDir), ['tests/data.bin', 'tests/extra_keep.rs', 'tests/hidden_a.rs', 'tests/new_hidden.rs']);
  assert.equal(readFileSync(join(b.hiddenDir, 'tests/hidden_a.rs'), 'utf8'), FIX_HIDDEN_A, 'the fix version, not the parent one');
  assert.equal(readFileSync(join(b.hiddenDir, 'tests/new_hidden.rs'), 'utf8'), NEW_HIDDEN, 'a file that exists only at the fix');
  assert.deepEqual(readFileSync(join(b.hiddenDir, 'tests/data.bin')), DATA_BIN, 'bytes, not a decoded string');
  assert.equal(readFileSync(join(b.hiddenDir, 'tests/extra_keep.rs'), 'utf8'), EXTRA['tests/extra_keep.rs'], 'an extra-tests file');
});

t('a hidden file the fix does not have is refused, naming the path, and the partial build is removed', () => {
  refuses(src, 'a missing hidden file', { edit: (d) => { d.hidden.files = ['tests/nope.rs']; } }, /tests\/nope\.rs/);
});

// ---- hashes and the manifest ----

t('the manifest holds the ids, the hashes of the bytes and the definition, and is written to disk', () => {
  const b = build(src);
  const m = b.manifest;
  assert.deepEqual(Object.keys(m), ['id', 'repo', 'fix', 'parent', 'baseCommit', 'treeHash', 'hiddenHash', 'promptHash', 'taskMdHash', 'def']);
  assert.equal(m.id, 'fix-add');
  assert.equal(m.repo, 'codescout');
  assert.equal(m.fix, src.shas.fix);
  assert.equal(m.parent, src.shas.parent);
  assert.match(m.baseCommit, /^[0-9a-f]{40}$/);
  assert.equal(m.baseCommit, git(b.treeDir, ['rev-parse', 'HEAD']).stdout.toString().trim(), 'baseCommit is the one commit of the tree');
  assert.notEqual(m.baseCommit, m.parent, 'the task commit is a new commit, not the parent');
  assert.notEqual(m.baseCommit, m.fix);
  assert.equal(m.promptHash, sha256(Buffer.from(PROMPT)));
  assert.equal(m.taskMdHash, sha256(Buffer.from(TASK_MD)));
  assert.deepEqual(m.def, JSON.parse(readFileSync(join(b.taskDir, 'task.json'), 'utf8')));
  assert.deepEqual(JSON.parse(readFileSync(join(b.out, 'manifest.json'), 'utf8')), m);
  for (const h of [m.treeHash, m.hiddenHash, m.promptHash, m.taskMdHash]) assert.match(h, /^[0-9a-f]{64}$/);
});

t('treeHash and hiddenHash are the sha256 over the sorted (path, sha256 of bytes) pairs, .git excluded', () => {
  const b = build(src);
  assert.equal(b.manifest.treeHash, expectedHash(b.treeDir, walk(b.treeDir, { skipGit: true })));
  assert.equal(b.manifest.hiddenHash, expectedHash(b.hiddenDir, walk(b.hiddenDir)));
  // The commit date and the work root differ between builds; the hashes must not.
  const again = build(src);
  assert.equal(again.manifest.treeHash, b.manifest.treeHash);
  assert.equal(again.manifest.hiddenHash, b.manifest.hiddenHash);
});

t('treeHash changes when TASK.md changes by one byte; hiddenHash changes when a hidden file changes by one byte', () => {
  const a = build(src).manifest;
  const taskMd = build(src, { taskMd: `${TASK_MD}.` }).manifest;
  assert.notEqual(taskMd.treeHash, a.treeHash, 'TASK.md is in the tree');
  assert.notEqual(taskMd.taskMdHash, a.taskMdHash);
  assert.equal(taskMd.hiddenHash, a.hiddenHash, 'TASK.md is not in hidden/');
  assert.equal(taskMd.promptHash, a.promptHash);

  const srcB = makeSrc({ hiddenASuffix: 'x' }); // the fix's hidden_a.rs differs by one byte
  const hidden = build(srcB).manifest;
  assert.notEqual(hidden.hiddenHash, a.hiddenHash, 'a hidden file is in hidden/');
  assert.equal(hidden.treeHash, a.treeHash, 'the fix version of a hidden file is not in the tree');

  const extra = build(src, { extra: { 'tests/extra_keep.rs': `${EXTRA['tests/extra_keep.rs']}.` } }).manifest;
  assert.notEqual(extra.hiddenHash, a.hiddenHash, 'an extra-tests file is in hidden/');
  assert.equal(extra.treeHash, a.treeHash);
});

t('promptHash changes when prompt.txt changes by one byte, and nothing else does', () => {
  const a = build(src).manifest;
  const p = build(src, { prompt: `${PROMPT}.` }).manifest;
  assert.notEqual(p.promptHash, a.promptHash);
  assert.equal(p.promptHash, sha256(Buffer.from(`${PROMPT}.`)));
  assert.equal(p.treeHash, a.treeHash);
  assert.equal(p.hiddenHash, a.hiddenHash);
  assert.equal(p.taskMdHash, a.taskMdHash);
});

t('treeHash covers the task CLAUDE.md: a different build command changes it', () => {
  const a = build(src).manifest;
  const b = build(src, { edit: (d) => { d.buildCommand = ['cargo', 'build']; } }).manifest;
  assert.notEqual(b.treeHash, a.treeHash);
});

t('a symlink is hashed by its target string, never followed', () => {
  const outside = makeOutside();
  const toA = build(makeLinkSrc(outside, 'a.txt'), { edit: forLinks });
  const toB = build(makeLinkSrc(outside, 'b.txt'), { edit: forLinks });
  // The dangling, absolute and directory links are all in the tree as links.
  for (const l of ['link', 'gone', 'outlink', 'outdir']) assert.ok(lstatSync(join(toA.treeDir, l)).isSymbolicLink(), `${l} is still a link`);
  assert.equal(readlinkSync(join(toA.treeDir, 'link')), 'a.txt');
  // a.txt and b.txt have the same bytes: only the target string tells the two trees apart.
  assert.notEqual(toB.manifest.treeHash, toA.manifest.treeHash);
  assert.equal(toA.manifest.treeHash, expectedHash(toA.treeDir, walk(toA.treeDir, { skipGit: true })));
  assert.equal(toB.manifest.treeHash, expectedHash(toB.treeDir, walk(toB.treeDir, { skipGit: true })));
});

// ---- the task CLAUDE.md template ----

// ---- treeAtFix (the gate's fix tree, R33) ----

const fixTreeDir = () => join(tmp('s5-fixtree-'), 'tree');

t("treeAtFix: the fix commit's tree with the same removals, the P tree's own TASK.md and CLAUDE.md, one commit and no remote", () => {
  const b = build(src);
  // the root files are the P tree's own bytes, not re-rendered: edit them there first
  writeFileSync(join(b.treeDir, 'CLAUDE.md'), "# the P tree's own CLAUDE.md, edited\n");
  writeFileSync(join(b.treeDir, 'TASK.md'), 'TASK.md as the P tree has it, edited\n');
  const dst = fixTreeDir();
  const commit = treeAtFix(b.manifest, b.treeDir, dst);
  assert.deepEqual(walk(dst, { skipGit: true }), [...EXPECT_TREE, 'tests/data.bin', 'tests/new_hidden.rs'].sort(byteCmp), 'the parent\'s tree plus what the fix adds');
  assert.equal(readFileSync(join(dst, 'src/lib.rs'), 'utf8'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'the fix, not the parent');
  assert.equal(readFileSync(join(dst, 'tests/hidden_a.rs'), 'utf8'), FIX_HIDDEN_A, 'the fix version of a hidden file: the fix tree holds the tests');
  assert.equal(readFileSync(join(dst, 'tests/new_hidden.rs'), 'utf8'), NEW_HIDDEN);
  assert.deepEqual(readFileSync(join(dst, 'tests/data.bin')), DATA_BIN, 'binary content is byte-exact');
  assert.equal(readFileSync(join(dst, 'README.md'), 'utf8'), 'abc readme v2\n');
  assert.ok(!existsSync(join(dst, ISSUE)), 'scrub.removePaths');
  for (const name of ['TASK.md', 'CLAUDE.md']) {
    assert.deepEqual(readFileSync(join(dst, name)), readFileSync(join(b.treeDir, name)), `${name} is the P tree's, byte for byte`);
    assert.ok(lstatSync(join(dst, name)).isFile());
  }
  assert.ok(!readFileSync(join(dst, 'CLAUDE.md'), 'utf8').includes('the repo claude file'));
  assert.equal(readFileSync(join(dst, 'CLAUDE.md'), 'utf8'), "# the P tree's own CLAUDE.md, edited\n");

  const g = (...args) => git(dst, args);
  assert.equal(commit, g('rev-parse', 'HEAD').stdout.toString().trim(), 'it returns the one commit');
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.equal(g('rev-list', '--count', 'HEAD').stdout.toString().trim(), '1');
  assert.equal(g('log', '-1', '--format=%an|%ae|%s').stdout.toString().trim(), 's5|s5@localhost|task fix-add');
  assert.equal(g('remote').stdout.length, 0, 'no remote');
  assert.equal(g('status', '--porcelain', '--ignored').stdout.length, 0, 'the commit holds the whole tree');
  assert.deepEqual(g('ls-files', '-z').stdout.toString().split('\0').filter(Boolean).sort(byteCmp), walk(dst, { skipGit: true }), 'committed files = files on disk');
  for (const sha of [src.shas.fix, src.shas.parent, src.shas.base]) assert.notEqual(g('cat-file', '-e', sha).status, 0, `commit ${sha} is not an object of the fix tree`);
  assert.notEqual(commit, b.manifest.baseCommit, 'a different tree is a different commit');
});

// The finding of the first real-Docker gate run: git archive stamps every file with the fix commit's time, which is
// older than a warm target built from the P tree, and cargo calls a source file fresh unless it is NEWER than the
// artifact. The fix's changes were never compiled, the fix tests failed, and a good task was dropped as fails_at_fix.
t('treeAtFix: a file the fix changes or adds is as new as the call; one the fix leaves alone keeps the commit\'s time', () => {
  const b = build(src);
  const start = Date.now();
  const dst = fixTreeDir();
  treeAtFix(b.manifest, b.treeDir, dst);
  const mtime = (rel) => lstatSync(join(dst, rel)).mtimeMs;
  for (const rel of ['src/lib.rs', 'tests/hidden_a.rs', 'tests/new_hidden.rs', 'tests/data.bin']) {
    assert.ok(mtime(rel) >= start - 1, `${rel} is changed by the fix, so it is newer than any build of the parent`);
  }
  for (const rel of ['README.md', 'tests/old.rs', 'a.txt', 'B.txt', 'data/blob.bin', '.gitignore']) {
    assert.ok(mtime(rel) <= start, `${rel} is not changed by the fix, so it keeps the time git archive gave it`);
  }
  // the control: the two trees really differ in exactly those files, by bytes
  for (const rel of ['src/lib.rs', 'tests/hidden_a.rs']) assert.notDeepEqual(readFileSync(join(dst, rel)), readFileSync(join(b.treeDir, rel)));
  assert.deepEqual(readFileSync(join(dst, 'README.md')), readFileSync(join(b.treeDir, 'README.md')));
});

t('treeAtFix: a path that is a directory at the parent and a file at the fix is a changed file, not a crash', () => {
  const { dir, shas } = makeRepo([{ label: 'parent', subject: 'chore: parent', date: '2026-10-02T10:00:00+00:00', files: { 'x/y.txt': 'in a directory\n', 'src/lib.rs': '// p\n' } }]);
  made.push(dir);
  rmSync(join(dir, 'x'), { recursive: true });
  const fix = addCommit(dir, { subject: 'fix: x becomes a file', files: { x: 'now a file\n' } });
  const b = build({ dir, shas: { parent: shas.parent, fix } }, { edit: (d) => { d.hidden = { files: ['x'] }; d.scrub = { removePaths: [], terms: [] }; } });
  assert.ok(lstatSync(join(b.treeDir, 'x')).isDirectory(), 'control: the parent has a directory there');
  const start = Date.now();
  const dst = fixTreeDir();
  treeAtFix(b.manifest, b.treeDir, dst);
  assert.equal(readFileSync(join(dst, 'x'), 'utf8'), 'now a file\n');
  assert.ok(lstatSync(join(dst, 'x')).mtimeMs >= start - 1, 'it is a changed file');
});

t('treeAtFix does not scrub: the fix holds the fix by design, so a scrub term in it is no error', () => {
  const b = build(src);
  const def = { ...b.manifest.def, scrub: { ...b.manifest.def.scrub, terms: [SLUG, 'FIX hidden_a'] } };
  const dst = fixTreeDir();
  treeAtFix({ ...b.manifest, def }, b.treeDir, dst);
  assert.equal(readFileSync(join(dst, 'tests/hidden_a.rs'), 'utf8'), FIX_HIDDEN_A);
});

t('the source repository is only read by treeAtFix too', () => {
  const b = build(src);
  const before = snapshot(src.dir);
  treeAtFix(b.manifest, b.treeDir, fixTreeDir());
  assert.deepEqual(snapshot(src.dir), before);
});

// A source whose fix ADDS removable names (a nested AGENTS.md, a .claude/), rewrites the repo CLAUDE.md and
// DELETES the issue file the scrub removes at the parent.
const makeFixSrc = () => {
  const { dir, shas } = makeRepo([
    {
      label: 'parent', subject: 'chore: parent', date: '2026-10-02T10:00:00+00:00',
      files: { 'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a - b }\n', 'tests/old.rs': '// old\n', 'CLAUDE.md': '# repo claude P\n', 'AGENTS.md': '# agents P\n', '.codescout/memories/n.md': 'n\n', [ISSUE]: `# bug ${SLUG}\n` },
    },
    {
      label: 'fix', subject: 'fix: add', date: '2026-10-03T10:00:00+00:00',
      files: { 'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'tests/new_hidden.rs': NEW_HIDDEN, 'CLAUDE.md': '# repo claude FIX\n', 'contrib/AGENTS.md': '# nested agents FIX\n', '.claude/settings.json': '{}\n', [ISSUE]: null },
    },
  ]);
  made.push(dir);
  return { dir, shas };
};
const forFixSrc = (d) => { d.hidden = { files: ['tests/new_hidden.rs'] }; };

t('treeAtFix removes the same names from the fix tree, even ones the fix adds, and tolerates a removePaths entry the fix deleted', () => {
  const fsrc = makeFixSrc();
  assert.equal(git(fsrc.dir, ['cat-file', '-e', `${fsrc.shas.parent}:${ISSUE}`]).status, 0, 'control: the parent has the issue file');
  assert.notEqual(git(fsrc.dir, ['cat-file', '-e', `${fsrc.shas.fix}:${ISSUE}`]).status, 0, 'control: the fix deleted it');
  assert.equal(git(fsrc.dir, ['cat-file', '-e', `${fsrc.shas.fix}:contrib/AGENTS.md`]).status, 0, 'control: the fix adds a nested AGENTS.md');
  const b = build(fsrc, { edit: forFixSrc });
  assert.throws(() => buildTask(makeTaskDir(fsrc, { edit: (d) => { forFixSrc(d); d.scrub.removePaths = [ISSUE, 'docs/issues/not-there.md']; } }), { workRoot: tmp('s5-work-') }), /not-there\.md/, 'control: the builder still refuses a removePaths entry the PARENT lacks');
  const dst = fixTreeDir();
  treeAtFix(b.manifest, b.treeDir, dst);
  assert.deepEqual(walk(dst, { skipGit: true }), ['CLAUDE.md', 'TASK.md', 'src/lib.rs', 'tests/new_hidden.rs', 'tests/old.rs']);
  assert.equal(readFileSync(join(dst, 'CLAUDE.md'), 'utf8'), renderTaskClaudeMd(b.manifest.def), 'the task CLAUDE.md, not the repo\'s FIX one');
  assert.equal(readFileSync(join(dst, 'src/lib.rs'), 'utf8'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n');
});

t('treeAtFix replaces a TASK.md or CLAUDE.md the fix tracks as a symlink out of the tree, and never writes through it', () => {
  const outside = makeOutside();
  const link = makeLinkSrc(outside, 'a.txt');
  const b = build(link, { edit: forLinks });
  const dst = fixTreeDir();
  treeAtFix(b.manifest, b.treeDir, dst);
  for (const name of ['TASK.md', 'CLAUDE.md']) {
    assert.match(git(link.dir, ['ls-tree', link.shas.fix, name]).stdout.toString(), /^120000 blob /, `control: ${name} is a tracked symlink at the fix`);
    assert.ok(lstatSync(join(dst, name)).isFile(), `${name} in the fix tree is a regular file`);
  }
  assert.deepEqual(readFileSync(join(dst, 'TASK.md')), Buffer.from(TASK_MD));
  assert.equal(readFileSync(join(outside, 'task-target.txt'), 'utf8'), TASK_TARGET);
  assert.equal(readFileSync(join(outside, 'claude-target.txt'), 'utf8'), CLAUDE_TARGET);
});

t('treeAtFix refuses an existing destination and leaves it alone; on a failure it removes what it made', () => {
  const b = build(src);
  const taken = tmp('s5-fixtree-taken-');
  writeFileSync(join(taken, 'MARKER'), 'keep');
  assert.throws(() => treeAtFix(b.manifest, b.treeDir, taken), /already exists/);
  assert.deepEqual(readdirSync(taken), ['MARKER'], 'nothing was added to it');
  assert.equal(readFileSync(join(taken, 'MARKER'), 'utf8'), 'keep');

  const noTask = tmp('s5-fixtree-src-');
  writeFileSync(join(noTask, 'CLAUDE.md'), 'x');
  const dst = fixTreeDir();
  assert.throws(() => treeAtFix(b.manifest, noTask, dst), /TASK\.md/);
  assert.ok(!existsSync(dst), 'a partial fix tree is removed');

  // a root file that is a link in the P tree is refused: it is read, never followed
  const linked = tmp('s5-fixtree-link-');
  writeFileSync(join(linked, 'CLAUDE.md'), 'x');
  writeFileSync(join(linked, 'elsewhere.md'), 'x');
  symlinkSync('elsewhere.md', join(linked, 'TASK.md'));
  const dstLink = fixTreeDir();
  assert.throws(() => treeAtFix(b.manifest, linked, dstLink), /regular file/);
  assert.ok(!existsSync(dstLink));

  // A failure AFTER the archive was extracted: a removePaths entry through a symlink. The tree is gone again.
  const outside = makeOutside();
  const link = makeLinkSrc(outside, 'a.txt');
  const lb = build(link, { edit: forLinks });
  const bad = { ...lb.manifest, def: { ...lb.manifest.def, scrub: { ...lb.manifest.def.scrub, removePaths: ['outdir/secret.txt'] } } };
  const dst2 = fixTreeDir();
  assert.throws(() => treeAtFix(bad, lb.treeDir, dst2), /symlink/);
  assert.ok(!existsSync(dst2), 'what the failed call made is removed');
  assert.equal(readFileSync(join(outside, 'secret.txt'), 'utf8'), 'LEAKMARK\n', 'and nothing behind the link was deleted');
  assert.throws(() => treeAtFix({ ...lb.manifest, def: { ...lb.manifest.def, scrub: { ...lb.manifest.def.scrub, removePaths: ['../x'] } } }, lb.treeDir, fixTreeDir()), /relative path/);
});

t('treeAtFix refuses a fix that is not a child of the parent, a bad manifest and a src tree that is not a directory', () => {
  const b = build(src);
  const wrong = { ...b.manifest, def: { ...b.manifest.def, parent: src.shas.base } };
  const dst = fixTreeDir();
  assert.throws(() => treeAtFix(wrong, b.treeDir, dst), /first parent/);
  assert.ok(!existsSync(dst));
  assert.throws(() => treeAtFix(null, b.treeDir, dst), TypeError);
  assert.throws(() => treeAtFix({ ...b.manifest, def: null }, b.treeDir, dst), TypeError);
  assert.throws(() => treeAtFix(b.manifest, '', dst), TypeError);
  assert.throws(() => treeAtFix(b.manifest, b.treeDir, ''), TypeError);
  assert.throws(() => treeAtFix(b.manifest, join(b.treeDir, 'does-not-exist'), dst), /TASK\.md|not a directory/);
  assert.ok(!existsSync(dst));
});

t('the template says nothing about effort, thinking or steering', () => {
  const tmpl = readFileSync(new URL('./task-claude.md.tmpl', import.meta.url), 'utf8');
  assert.doesNotMatch(tmpl, /effort|thinking|steer/i);
  assert.match(tmpl, /\{\{BUILD_COMMAND\}\}/);
  assert.match(tmpl, /\{\{TEST_COMMAND\}\}/);
  assert.match(tmpl, /network/i);
  assert.ok(tmpl.length < 800, 'short');
  assert.doesNotMatch(renderTaskClaudeMd(baseDef(src)), /effort|thinking|steer/i);
});

t('shellQuote output, run by sh, gives back the same argv', () => {
  const argv = ['cargo', 'test', '--no-default-features', 'a b', "it's", '$HOME', '`id`', 'a\nb', '', '*', '--', '-x', '~', '#c', 'a;b', '(x)', 'k=v', 'x"y', 'back\\slash'];
  const r = spawnSync('sh', ['-c', `printf '%s\\0' ${shellQuote(argv)}`], { encoding: 'buffer' });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(r.stdout.toString().split('\0').slice(0, -1), argv);
  assert.equal(shellQuote(['cargo', 'test', '-p', 'x/y.z']), 'cargo test -p x/y.z', 'a plain word stays unquoted');
});

// ---- reflinkCopy ----

const fsType = (p) => spawnSync('stat', ['-f', '-c', '%T', p], { encoding: 'utf8' }).stdout.trim();
const REFLINK_FS = ['btrfs', 'xfs'];
// A skip is printed as a skip, never as a pass.
function tIf(name, skipReason, fn) {
  if (skipReason) console.log(`ok - ${name} # SKIP ${skipReason}`);
  else t(name, fn);
}

const WORK = join(homedir(), 'work', 'claude', 's5-work');
const NO_REFLINK_HERE = !existsSync(WORK) ? `${WORK} does not exist` : !REFLINK_FS.includes(fsType(WORK)) ? `${WORK} is on ${fsType(WORK)}, which cannot reflink` : '';
// A scratch directory on the work filesystem (btrfs), removed afterwards.
function onWorkFs(fn) {
  const base = join(WORK, 'tmp-tests');
  mkdirSync(base, { recursive: true });
  const d = mkdtempSync(join(base, 'reflink-'));
  try {
    fn(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
    try {
      rmdirSync(base);
    } catch {
      // other test dirs are in it
    }
  }
}

tIf('reflinkCopy copies a tree by reflink: bytes equal, the copy is independent, links stay links', NO_REFLINK_HERE, () => {
  onWorkFs((d) => {
    const from = join(d, 'from');
    mkdirSync(join(from, 'sub'), { recursive: true });
    writeFileSync(join(from, 'a.txt'), 'alpha\n');
    writeFileSync(join(from, 'sub', 'b.bin'), DATA_BIN);
    symlinkSync('a.txt', join(from, 'l'));

    const to = join(d, 'to');
    reflinkCopy(from, to);
    assert.deepEqual(walk(to), ['a.txt', 'l', 'sub/b.bin']);
    assert.equal(readFileSync(join(to, 'a.txt'), 'utf8'), 'alpha\n');
    assert.deepEqual(readFileSync(join(to, 'sub', 'b.bin')), DATA_BIN);
    assert.ok(lstatSync(join(to, 'l')).isSymbolicLink());
    assert.equal(readlinkSync(join(to, 'l')), 'a.txt');
    writeFileSync(join(to, 'a.txt'), 'changed\n');
    assert.equal(readFileSync(join(from, 'a.txt'), 'utf8'), 'alpha\n', 'writing the copy does not touch the source');
  });
});

tIf('reflinkCopy refuses ANY existing destination, empty or not, and leaves it untouched', NO_REFLINK_HERE, () => {
  onWorkFs((d) => {
    const from = join(d, 'from');
    mkdirSync(from);
    writeFileSync(join(from, 'a.txt'), 'alpha\n');
    // control: a fresh destination on this filesystem does copy, so a refusal below is the refusal and not a reflink error
    reflinkCopy(from, join(d, 'fresh'));
    assert.equal(readFileSync(join(d, 'fresh', 'a.txt'), 'utf8'), 'alpha\n');

    const empty = join(d, 'empty');
    mkdirSync(empty);
    assert.throws(() => reflinkCopy(from, empty), /already exists/);
    assert.deepEqual(readdirSync(empty), [], 'an empty destination stays empty');

    // A leftover work dir holding a previous run's solution must not leak into the next run's tree.
    const stale = join(d, 'stale');
    mkdirSync(stale);
    writeFileSync(join(stale, 'STALE-SOLUTION.rs'), 'fn solved() {}\n');
    assert.throws(() => reflinkCopy(from, stale), /already exists/);
    assert.deepEqual(readdirSync(stale), ['STALE-SOLUTION.rs'], 'a non-empty destination is untouched and nothing was merged into it');
    assert.equal(readFileSync(join(stale, 'STALE-SOLUTION.rs'), 'utf8'), 'fn solved() {}\n');

    // A dangling symlink is an existing destination too: cp would write through it.
    const aim = join(d, 'aim');
    symlinkSync(aim, join(d, 'dangling'));
    assert.throws(() => reflinkCopy(from, join(d, 'dangling')), /already exists/);
    assert.equal(lstatOrNull(aim), null, 'nothing was created where the link points');
  });
});

tIf(
  'reflinkCopy throws where the filesystem cannot reflink, and does not fall back to a full copy',
  REFLINK_FS.includes(fsType(tmpdir())) ? `${tmpdir()} is on ${fsType(tmpdir())}, which can reflink` : '',
  () => {
    const d = tmp('s5-reflink-');
    mkdirSync(join(d, 'from'));
    writeFileSync(join(d, 'from', 'a.txt'), 'alpha\n');
    const to = join(d, 'to');
    assert.throws(() => reflinkCopy(join(d, 'from'), to), /reflink|clone|not supported/i);
    assert.ok(!existsSync(to), 'no full copy was made and no partial destination is left');
  },
);

for (const d of made) rmSync(d, { recursive: true, force: true });
