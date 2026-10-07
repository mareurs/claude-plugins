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
//   id          /^[a-z0-9-]+$/
//   repo        'codescout' | 'claude-plugins'          (named, never derived from a directory)
//   repoPath    absolute path of the operator's checkout (only read, through git)
//   fix, parent full 40-hex shas; parent must differ from fix (build-task.mjs checks it is fix's first parent)
//   subsystem   non-empty string
//   testRunner  'cargo' | 'node' | 'sh'
//   hidden      { files: string[], extra?: string[], graftLines?: [{ file, line }] }
//                 files       paths whose FIX version becomes hidden tests
//                 extra       paths relative to <taskDir>/extra-tests/ (authored tests); each must be a file there
//                 graftLines  `line` (one non-empty line) is appended to `file` when the hidden tests are grafted in
//   buildCommand, f2p.command, p2p.command   non-empty string arrays
//   f2p         { command, names }   names: non-empty array of non-empty strings
//   p2p         { command, names }   names: array of non-empty strings
//   testPatterns string[]
//   scrub       { removePaths: string[], terms: string[] }   terms: non-empty strings
//   timeoutsSec { build, test }      positive integers
//
// Every path (hidden.files, hidden.extra, hidden.graftLines[].file, scrub.removePaths) is relative:
// no leading '/', no '..', '.' or empty segment. A violation is a TypeError that names the field.

import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const ID_RE = /^[a-z0-9-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const REPOS = ['codescout', 'claude-plugins'];
const RUNNERS = ['cargo', 'node', 'sh'];

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
  if (value.includes('\0')) fail(field, 'must not contain a NUL byte');
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
  if (typeof def.repoPath !== 'string' || !isAbsolute(def.repoPath) || def.repoPath.includes('\0')) {
    fail('repoPath', `must be an absolute path, got ${show(def.repoPath)}`);
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
    });
  }

  command('buildCommand', def.buildCommand);
  object('f2p', def.f2p, { command: true, names: true });
  command('f2p.command', def.f2p.command);
  texts('f2p.names', def.f2p.names, { nonEmpty: true });
  object('p2p', def.p2p, { command: true, names: true });
  command('p2p.command', def.p2p.command);
  texts('p2p.names', def.p2p.names);
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
