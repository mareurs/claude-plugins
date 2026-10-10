// task-def.mjs — load and validate a task definition directory.
//
//   loadTaskDef(taskDir) -> TaskDef
//
// A task directory holds `task.json`, `TASK.md` and `prompt.txt` (all required, the last two
// non-empty) and, when task.json lists `hidden.extra`, an `extra-tests/` directory with those files.
//
// task.json is exactly this object; a key that is not listed is refused, because a misspelled
// `scrub.terms` would otherwise silently switch the leak check off:
//
//   id          /^[a-z0-9][a-z0-9-]{0,47}$/              (ruling R92: a letter or digit first, 48 characters at most, so that
//                                                        <id>.<arm>.<rep> and an attempt suffix fit a 64-character run id)
//   repo        'codescout' | 'claude-plugins'          (named, never derived from a directory)
//   repoPath    absolute path of the operator's checkout (only read, through git)
//   fix, parent full 40-hex shas; parent must differ from fix (build-task.mjs checks it is fix's first parent)
//   subsystem   non-empty string
//   testRunner  'cargo' | 'node' | 'sh'
//   hidden      { files: string[], extra?: string[], graftLines?: [{ file, line }] }
//                 files       paths whose FIX version becomes hidden tests
//                 extra       paths relative to <taskDir>/extra-tests/ (authored tests); each must be a file there
//                 graftLines  `line` is appended to `file` when the hidden tests are grafted in, and declares exactly
//                             one Rust module (`mod NAME;`, attributes and visibility on the same line allowed): see moduleOf
//   buildCommand, f2p.command, p2p.command   non-empty string arrays
//   f2p         { command, names }   names: non-empty array of non-empty strings
//   p2p         { command, names }   names: array of non-empty strings
//                 AUTHORING RULE (R151): every file that holds a pass-to-pass name must be listed in hidden.files. The grader
//                 replaces the paths of hidden.files and hidden.extra in the agent's tree with the fix commit's version (for a
//                 test file the fix did not change that is the version at P), and no other file; a p2p name in a file that is
//                 not listed runs in the agent's own, possibly edited, version, and an agent that weakened or deleted an
//                 assertion to get green passes it. Nothing here checks it (a test name does not map to a file); the Opus
//                 task review does (README, gate 2). Residual: a file the agent must itself edit, such as a source file that
//                 holds the fix and inline unit tests, cannot be listed (the graft would overwrite the agent's work with the
//                 fix), so its p2p names stay exposed; the review decides whether to accept that for the task.
//                 A command that runs `cargo test` in a cargo task carries --no-fail-fast before any `--` (plain
//                 cargo stops at the first failing test binary, and every listed name behind it would be not run).
//                 A command that runs `node --test` has --test and --test-reporter=tap before its first positional
//                 argument (the first word that does not start with '-'; node ignores options after a file) and no
//                 other reporter or reporter destination: the grader reads TAP and nothing else.
//                 The runner binds the program: in a cargo task every command starts with `cargo`, in a node task with
//                 `node` (no env, sh -c or other wrapper: it would hide the commands above). The sh runner is free.
//   testPatterns string[]
//   scrub       { removePaths: string[], terms: string[] }   terms: non-empty strings
//   timeoutsSec { build, test }      positive integers
//
// Every path (hidden.files, hidden.extra, hidden.graftLines[].file, scrub.removePaths) is relative:
// no leading '/', no '..', '.' or empty segment. No path field, repoPath included, holds a control character:
// a path is written into shell scripts (the graft), and a newline in one could end a here-document.
// A violation is a TypeError that names the field.
//
// IMAGE_FOR_REPO maps `repo` to the image its tasks are built, gated and run in.
// moduleOf is the one module-line rule: the loader refuses a graftLines line it rejects, and the grader
// (grade.mjs re-exports it) refuses the same lines. It lives here, the leaf both import, so there is no cycle.

import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

// Exported (ruling R51): a task id becomes a path segment under <workRoot>/tasks/, so the prereg loader applies this same rule.
// Ruling R92: it starts with a letter or digit (never '-', which a command line would read as an option) and has at most 48
// characters, so the run id `<id>.<arm>.<rep>`, an attempt suffix such as `-a9` and the container names `s5-<run id>-a<n>` and
// `s5-grade-<run id>` all fit grade.mjs's RUN_ID_RE (64 characters) and docker.mjs's NAME_RE. A legal task would otherwise plan
// and then fail in gradeTree.
export const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ID_RE = TASK_ID_RE;
const SHA_RE = /^[0-9a-f]{40}$/;
const REPOS = ['codescout', 'claude-plugins'];
const RUNNERS = ['cargo', 'node', 'sh'];
// Ruling R37. The images are built by images/build.sh; a caller that pins an image by digest passes `image`.
export const IMAGE_FOR_REPO = Object.freeze({ codescout: 's5/codescout', 'claude-plugins': 's5/plugins' });
// A control character (C0, DEL): NUL, newline, tab, escape, ...
const CONTROL = /[\x00-\x1f\x7f]/;

// A graftLines line declares exactly one Rust module: `mod NAME;`, with attributes and visibility on the same
// line allowed. (The grafted line is how a hidden test file becomes part of the crate.)
const MOD_LINE = /^(?:#\[[^\]\r\n]*\]\s*)*(?:pub(?:\s*\([^)\r\n]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$/;
// moduleOf(line) -> the module's name. Throws TypeError for a line that is not one module declaration.
export const moduleOf = (line) => {
  const m = typeof line === 'string' ? MOD_LINE.exec(line) : null;
  if (m === null) throw new TypeError(`a graftLines line must declare exactly one Rust module (\`mod NAME;\`, attributes and visibility allowed), got ${JSON.stringify(line)}`);
  return m[1];
};

const fail = (field, why) => {
  throw new TypeError(`loadTaskDef: ${field} ${why}`);
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => JSON.stringify(v) ?? String(v);

// `value` must be an object with exactly the keys of `spec` ({ key: required? }).
function object(field, value, spec) {
  if (!isObject(value)) fail(field, `must be an object, got ${show(value)}`);
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(spec, key)) fail(field, `has an unknown key ${show(key)} (known: ${Object.keys(spec).join(', ')})`);
  }
  for (const [key, required] of Object.entries(spec)) {
    if (required && !Object.hasOwn(value, key)) fail(`${field}.${key}`, 'is required');
  }
}
function array(field, value) {
  if (!Array.isArray(value)) fail(field, `must be an array, got ${show(value)}`);
}
function text(field, value) {
  if (typeof value !== 'string' || value === '') fail(field, `must be a non-empty string, got ${show(value)}`);
}
function texts(field, value, { nonEmpty = false } = {}) {
  array(field, value);
  if (nonEmpty && value.length === 0) fail(field, 'must not be empty');
  value.forEach((v, i) => text(`${field}[${i}]`, v));
}
function command(field, value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((a) => typeof a !== 'string') || value[0] === '') {
    fail(field, `must be a non-empty array of strings whose first item is the program, got ${show(value)}`);
  }
}
function relPath(field, value) {
  if (typeof value !== 'string' || value === '') fail(field, `must be a non-empty relative path, got ${show(value)}`);
  if (CONTROL.test(value)) fail(field, `must not contain a control character (a newline, a NUL byte, ...), got ${show(value)}`);
  if (isAbsolute(value)) fail(field, `must be relative, but ${show(value)} is an absolute path`);
  for (const seg of value.split('/')) {
    if (seg === '..') fail(field, `must not contain a '..' segment, got ${show(value)}`);
    if (seg === '.' || seg === '') fail(field, `must not contain an empty or '.' segment, got ${show(value)}`);
  }
}
function relPaths(field, value) {
  array(field, value);
  value.forEach((v, i) => relPath(`${field}[${i}]`, v));
}
function seconds(field, value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(field, `must be a positive integer, got ${show(value)}`);
}

// What a test command runs, read from its argv alone. The runner binds the program (R53: a cargo task's commands start
// with `cargo`, a node task's with `node`; there is no `env`, `sh -c` or other wrapper to hide `cargo test` or `node --test`
// in), and the reading fails closed.
//   cargo: any word `test` (or cargo's alias `t`) before the first `--` is the subcommand, so `cargo --locked test` and
//   `cargo +nightly test` are seen, and a package that happens to be called `test` is refused too (the author then adds the flag).
//   node (R52): `--test` anywhere in argv makes it a test run. Node reads its options only up to the first positional
//   argument (the first word after `node` that does not start with '-': a file, or the value of an option written
//   with a space, which counts as one), and ignores them after it: on node v26.10.0 `node --test a.test.mjs
//   --test-reporter=tap` prints spec output, which the grader cannot read. So --test and --test-reporter=tap must both
//   come before it, and no other reporter or reporter destination may appear anywhere.
const beforeDashDash = (argv) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);
const runsCargoTest = (argv) => beforeDashDash(argv).slice(1).some((a) => a === 'test' || a === 't');
const NODE_FLAGS_RULE = "put --test and --test-reporter=tap before the first positional argument (the first word that does not start with '-'), each option in --opt=value form: node ignores them after a file, and a space-separated option value counts as that positional argument";
// -> why `argv` is not a valid node test command, or null
const nodeTestProblem = (argv) => {
  if (argv[0] !== 'node' || !argv.includes('--test')) return null;
  if (argv.includes('--test-reporter')) return `writes --test-reporter and its value as two words, so it must ${NODE_FLAGS_RULE}`;
  const other = argv.find((a) => (a.startsWith('--test-reporter=') && a !== '--test-reporter=tap') || a.startsWith('--test-reporter-destination'));
  if (other !== undefined) return `uses another reporter or a reporter destination (${show(other)}): the grader reads TAP on stdout and nothing else, so only --test-reporter=tap is allowed`;
  const first = argv.findIndex((a, i) => i > 0 && !a.startsWith('-'));
  const options = first === -1 ? argv.slice(1) : argv.slice(1, first);
  return options.includes('--test') && options.includes('--test-reporter=tap') ? null : `must ${NODE_FLAGS_RULE}`;
};

function readRequired(taskDir, name) {
  let bytes;
  try {
    bytes = readFileSync(join(taskDir, name));
  } catch (err) {
    throw new Error(`loadTaskDef: cannot read ${name} in ${taskDir}: ${err.code ?? err.message}`);
  }
  if (bytes.length === 0) throw new Error(`loadTaskDef: ${name} in ${taskDir} is empty`);
  return bytes;
}

export function loadTaskDef(taskDir) {
  let def;
  try {
    def = JSON.parse(readRequired(taskDir, 'task.json').toString('utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) throw new TypeError(`loadTaskDef: task.json in ${taskDir} is not valid JSON: ${err.message}`);
    throw err;
  }

  object('task.json', def, {
    id: true, repo: true, repoPath: true, fix: true, parent: true, subsystem: true, testRunner: true, hidden: true,
    buildCommand: true, f2p: true, p2p: true, testPatterns: true, scrub: true, timeoutsSec: true,
  });
  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) fail('id', `must match ${ID_RE}, got ${show(def.id)}`);
  if (!REPOS.includes(def.repo)) fail('repo', `must be one of ${REPOS.join(', ')}, got ${show(def.repo)}`);
  if (typeof def.repoPath !== 'string' || !isAbsolute(def.repoPath) || CONTROL.test(def.repoPath)) {
    fail('repoPath', `must be an absolute path without a control character, got ${show(def.repoPath)}`);
  }
  if (typeof def.fix !== 'string' || !SHA_RE.test(def.fix)) fail('fix', `must be a full 40-hex lower-case sha, got ${show(def.fix)}`);
  if (typeof def.parent !== 'string' || !SHA_RE.test(def.parent)) fail('parent', `must be a full 40-hex lower-case sha, got ${show(def.parent)}`);
  if (def.parent === def.fix) fail('parent', 'must differ from fix');
  text('subsystem', def.subsystem);
  if (!RUNNERS.includes(def.testRunner)) fail('testRunner', `must be one of ${RUNNERS.join(', ')}, got ${show(def.testRunner)}`);

  object('hidden', def.hidden, { files: true, extra: false, graftLines: false });
  relPaths('hidden.files', def.hidden.files);
  if (def.hidden.extra !== undefined) {
    relPaths('hidden.extra', def.hidden.extra);
    def.hidden.extra.forEach((p, i) => {
      if (def.hidden.files.includes(p)) fail(`hidden.extra[${i}]`, `${show(p)} is also listed in hidden.files; the authored file would replace the fix version`);
      let st = null;
      try {
        st = lstatSync(join(taskDir, 'extra-tests', p));
      } catch {
        // reported below
      }
      if (st === null || !st.isFile()) fail(`hidden.extra[${i}]`, `${show(p)} is not a file under ${join(taskDir, 'extra-tests')}`);
    });
  }
  if (def.hidden.graftLines !== undefined) {
    array('hidden.graftLines', def.hidden.graftLines);
    def.hidden.graftLines.forEach((g, i) => {
      const f = `hidden.graftLines[${i}]`;
      object(f, g, { file: true, line: true });
      relPath(`${f}.file`, g.file);
      if (typeof g.line !== 'string' || g.line === '' || /[\r\n]/.test(g.line)) fail(`${f}.line`, `must be one non-empty line, got ${show(g.line)}`);
      try {
        moduleOf(g.line);
      } catch (err) {
        fail(`${f}.line`, err.message);
      }
    });
  }

  command('buildCommand', def.buildCommand);
  object('f2p', def.f2p, { command: true, names: true });
  command('f2p.command', def.f2p.command);
  texts('f2p.names', def.f2p.names, { nonEmpty: true });
  object('p2p', def.p2p, { command: true, names: true });
  command('p2p.command', def.p2p.command);
  texts('p2p.names', def.p2p.names);
  for (const phase of ['f2p', 'p2p']) {
    const argv = def[phase].command;
    const field = `${phase}.command`;
    if (def.testRunner === 'cargo') {
      if (argv[0] !== 'cargo') {
        fail(field, `must start with cargo in a cargo task: an env, sh -c or other wrapper hides \`cargo test\` from the --no-fail-fast check, got ${show(argv)}`);
      }
      if (runsCargoTest(argv) && !beforeDashDash(argv).includes('--no-fail-fast')) {
        fail(field, `runs cargo test without --no-fail-fast before any '--': cargo would stop at the first failing test binary and every listed name behind it would be not run, got ${show(argv)}`);
      }
    }
    if (def.testRunner === 'node' && argv[0] !== 'node') {
      fail(field, `must start with node in a node task: an env, sh -c or other wrapper hides \`node --test\` from the reporter check, got ${show(argv)}`);
    }
    const problem = nodeTestProblem(argv);
    if (problem !== null) fail(field, `runs node --test and ${problem}, got ${show(argv)}`);
  }
  texts('testPatterns', def.testPatterns);

  object('scrub', def.scrub, { removePaths: true, terms: true });
  relPaths('scrub.removePaths', def.scrub.removePaths);
  // An empty term would match every file, so it is refused rather than treated as "no term".
  texts('scrub.terms', def.scrub.terms);

  object('timeoutsSec', def.timeoutsSec, { build: true, test: true });
  seconds('timeoutsSec.build', def.timeoutsSec.build);
  seconds('timeoutsSec.test', def.timeoutsSec.test);

  readRequired(taskDir, 'TASK.md');
  readRequired(taskDir, 'prompt.txt');
  return def;
}
