// grade.mjs — the S5 grader. After an agent run it decides PASS or FAIL for that run, and the quality
// verdict of the whole experiment is a mean of these values, so every rule here is chosen to fail
// closed: a hidden test that does not demonstrably run is a failure, and an outcome that says nothing
// about the model is never scored.
//
//   gradeTree(manifest, agentTreeDir, { workRoot, image, timeouts, dockerBin, runId, cpus, memoryGb })
//     -> Promise<{ infra, graft, build, f2p, p2p, nonAssertion, pass, diff, wallMs, detail, kept, leftover }>
//
// ONE grade is ONE container (s5-grade-<runId>, network none, the repo's image, user agent, workdir /work).
// Its mounts, all of them built from reflink copies, so the agent's own tree and the task's warm target are
// never written:
//
//   /work     a fresh copy of the agent's final tree (rw)
//   /hidden   <workRoot>/tasks/<id>/hidden (ro)
//   /target   cargo tasks, when <workRoot>/tasks/<id>/target exists: a fresh copy of the warm target (rw),
//             with CARGO_TARGET_DIR=/target
//   /cargo    cargo tasks, when <workRoot>/cargo-home exists (ro)
//   /results  a fresh host directory (rw): the driver's status and output files
//
// The container runs a generated `sh` driver (driverScript) that, in order: (1) records the diff stats of the
// agent's change against manifest.baseCommit, the task's one commit (`git add -A`, then
// `git diff --cached --shortstat <baseCommit>`; HEAD would read zero for an agent that commits), BEFORE
// anything is grafted, so the hidden tests are not in them; (2) grafts the hidden tests (graftScript);
// (3) runs buildCommand; (4) if the build succeeded, runs f2p.command and p2p.command. Every step runs as
// argv under `timeout -k 10 <seconds>` (the two git calls of the diff and the graft under 120 s each, the
// build under the build limit, each test step under the test limit), with its stdin from
// /dev/null and its output in /results. The host then parses /results. NOTHING of the agent's is read,
// written, built or run on the host: no git on its tree, no graft, no model-written code.
//
// Pass = infra null AND graft ok AND build ok AND every f2p.names and p2p.names entry is reported ok
// (cargo, node) or its step exits 0 (sh), and at least one F2P name passed. A name that is absent from the
// output, or reported `ignored`, is `notRun`, and a name not run is a failure. A name reported by several
// test binaries passes only if every report is ok. Each name counts by its own report: a compile error does
// not void a step (cargo runs no test when the build fails, so those names are simply absent). When the build
// did not succeed no test step ran, and every name is notRun.
//
//   infra  null, or why this outcome is the harness's and not the model's, so it is never scored and the
//          caller re-runs it:  create_failed (no container was created), oom (the kernel killed it),
//          inspect_failed (docker could not say whether it did), rm_failed (it could not be removed),
//          timeout (the grade container's own wall clock: the harness's limit, not the model's),
//          incomplete (the driver never reached its last line: it was killed from outside).
//          The step limits inside the container (build, test) are the model's: a build or test that hangs
//          because of the agent's code is build 'timeout' or a name not run.
//   graft  'ok' | 'failed' | 'not_run'
//   build  'ok' | 'failed' | 'timeout' (the driver's `timeout` exit, 124) | 'not_run'
//   f2p, p2p  { passed, failed, notRun }: name lists, in the order the task def gives them
//   nonAssertion  the listed F2P and P2P names (each once) that failed by something other than an assertion: a
//          ReferenceError, a TypeError, a missing export. The node parser alone can tell; it is always [] for cargo
//          and sh. The task gate reads it: a fail-to-pass test that fails like this at the parent names a symbol the
//          parent lacks, and tests nothing about the fix.
//   diff   { files, insertions, deletions } of the agent's own change against manifest.baseCommit, or null when
//          git could not say (a base it cannot resolve, a failure, a timeout): never zeros for "unknown"
//   detail a short text about the docker run when infra is set, else null
//   kept   the grade directory when S5_KEEP_GRADES=1 (the copies and the results, for debugging), else null
//   leftover  the grade directory when it could not be removed, else null
//
// The files in /results are written by a container that runs the agent's code, so they are untrusted: they
// are read without following links, only if they are regular files, and capped in size.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, rmSync, statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { reflinkCopy } from './build-task.mjs';
import { dockerRun } from './docker.mjs';
import { moduleOf, TASK_ID_RE } from './task-def.mjs';

const RUNNERS = ['cargo', 'node', 'sh'];
// The one run-id rule of the harness (ruling R96): gate-task.mjs imports it, and the runner's `<taskId>.<arm>.<rep>` fits it by
// task-def's TASK_ID_RE (48 characters at most, ruling R92). It becomes a container name suffix, so it starts with a letter, digit or '_'.
export const RUN_ID_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/;
// `timeout -k`: a command that ignores SIGTERM is killed this many seconds later, so a hang that is the
// agent's code's is cut off INSIDE the container (a model failure) and never reaches the harness's clock.
const KILL_AFTER_SEC = 10;
// The diff's two git calls and the graft each get this limit: on a real tree they take seconds, and only the
// agent's tree can make them hang (a git hook, a FIFO where a graftLines file belongs). Not the test limit:
// a long test limit must not stretch a hang in a step that is not a test.
const PREP_SEC = 120;
// The grade container's own limit is the sum of every step's limit and its kill-after (limitsOf), plus this
// for the container's start and the driver's own bookkeeping, so every inner limit fires first.
const SLACK_SEC = 300;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DETAIL_BYTES = 500;

// ---- the parsers ----

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const linesOf = (text) => String(text).replace(ANSI, '').split(/\r?\n/);
// A name reported more than once keeps its worst report: FAILED, then ignored, then ok.
const WORSE = { ok: 0, ignored: 1, FAILED: 2 };
function record(results, name, result) {
  const seen = results.get(name);
  if (seen === undefined || WORSE[result] > WORSE[seen]) results.set(name, result);
}

const CARGO_REPORT = /^test (.+?) \.\.\. (ok|FAILED|ignored)(?:[ ,].*)?$/;
// libtest appends the test's kind to its name: ` - should panic` for #[should_panic], ` - compile fail` and
// ` - compile` for doc-tests. The name a task lists is the plain one.
const CARGO_NAME_SUFFIX = / - (?:should panic|compile fail|compile)$/;
// `failures:` (exactly) opens the section that prints each failed test's captured output; it runs until the
// next test binary starts (`running N tests`). Nothing in it is a report: a failed test's own stdout can hold
// a line that looks like one, and a failed doc-test prints the compiler's errors there.
const CARGO_FAILURES = 'failures:';
const CARGO_RUNNING = /^running \d+ tests?$/;
// `error: could not compile` ends every failed build; `error[E....]` is the same failure, named. NOT
// `error: test failed` or `error: N targets failed`, which are tests that ran and failed.
const CARGO_COMPILE_ERROR = /^(?:error\[E\d+\]|error: could not compile)/;

// parseCargo(stdout) -> { results: Map<name, 'ok'|'FAILED'|'ignored'>, compileError }
// compileError is informative: the build step reports the build, and cargo runs no test when a build fails,
// so the names of such a run are simply absent.
export function parseCargo(stdout) {
  const results = new Map();
  let compileError = false;
  let inFailures = false;
  for (const line of linesOf(stdout)) {
    if (CARGO_RUNNING.test(line)) inFailures = false;
    else if (line === CARGO_FAILURES) inFailures = true;
    else if (!inFailures) {
      const m = CARGO_REPORT.exec(line);
      if (m) record(results, m[1].replace(CARGO_NAME_SUFFIX, ''), m[2]);
      else if (CARGO_COMPILE_ERROR.test(line)) compileError = true;
    }
  }
  return { results, compileError };
}

// `ok - name` / `not ok - name` (the plain node scripts' helper) and TAP `ok 1 - name` / `not ok 1 - name`
// (node --test --test-reporter=tap), indented when nested. A `# SKIP` or `# TODO` directive means the test did
// not verify anything. Node v26 prints a test's own stdout as a `# ` comment in TAP, so a raw `ok 7 - x` that
// a test prints is not a report there; without --test-reporter=tap node writes the spec format, which this
// parser does not read (the task def must say --test-reporter=tap).
const NODE_REPORT = /^\s*(not ok|ok)(?: (\d+))? - (.+)$/;
const NODE_DIRECTIVE = / # (?:SKIP|TODO)\b.*$/i;
// A numbered TAP name is escaped by node (checked in node v26.10.0): control characters become `\t`, `\n`, `\r`,
// `\b`, `\f`, `\v`, then every `\` becomes `\\` and every `#` becomes `\#`. One left-to-right pass undoes the
// last two, which is exact for any name without control characters; a control character comes back as its
// backslash-letter form (it cannot be told from a literal backslash and letter).
const unescapeTap = (name) => name.replace(/\\([\\#])/g, '$1');

// What a failed test printed after its `not ok` line, up to the next report: an assertion (the code under
// test behaved differently), a parent whose subtests failed, or anything else (ReferenceError, TypeError, a
// missing export: the test could not even exercise the code).
function failureKind(lines, from) {
  let first = null;
  let assertion = false;
  let subtests = false;
  for (let i = from; i < lines.length && !NODE_REPORT.test(lines[i]); i++) {
    if (first === null && lines[i].trim() !== '') first = lines[i].trim();
    if (/^\s*code:\s*['"]?ERR_ASSERTION\b/.test(lines[i])) assertion = true;
    if (/^\s*failureType:\s*['"]?subtestsFailed\b/.test(lines[i])) subtests = true;
  }
  if (assertion || (first !== null && /^AssertionError\b/.test(first))) return 'assertion';
  return subtests ? 'subtests' : 'other';
}

// parseNodeTest(stdout) -> { results, nonAssertionFailures: string[] }
export function parseNodeTest(stdout) {
  const results = new Map();
  const nonAssertionFailures = [];
  const lines = linesOf(stdout);
  lines.forEach((line, i) => {
    const m = NODE_REPORT.exec(line);
    if (!m) return;
    const [, status, number, text] = m;
    // The directive is looked for in the raw text: an escaped `\# SKIP` inside a numbered name is not one.
    const directive = NODE_DIRECTIVE.test(text);
    const bare = text.replace(NODE_DIRECTIVE, '');
    const name = number === undefined ? bare : unescapeTap(bare);
    const result = directive ? 'ignored' : status === 'ok' ? 'ok' : 'FAILED';
    record(results, name, result);
    if (result === 'FAILED' && failureKind(lines, i + 1) === 'other' && !nonAssertionFailures.includes(name)) nonAssertionFailures.push(name);
  });
  return { results, nonAssertionFailures };
}

// An sh task has one command per phase, and its exit status is the whole report: every name of the phase
// shares the one result under this key.
export const SH_RESULT = 'exit status';
// parseSh(status) -> { results }
export function parseSh(status) {
  return { results: new Map([[SH_RESULT, status === 0 ? 'ok' : 'FAILED']]) };
}

// ---- the pass rule ----

// judgeNames(runner, names, step) -> { passed, failed, notRun }. `step` is { status, stdout }, or null when
// the step never ran. `ignored` and an absent name are both notRun.
export function judgeNames(runner, names, step) {
  let report = () => undefined;
  if (step !== null && step !== undefined) {
    if (runner === 'cargo') {
      // Each name counts by its own report. (Cargo runs no test when anything fails to compile, so the names
      // of such a run are absent; a compile error printed in a failed doc-test's section is not one.)
      const { results } = parseCargo(step.stdout);
      report = (name) => results.get(name);
    } else if (runner === 'node') {
      const { results } = parseNodeTest(step.stdout);
      report = (name) => results.get(name);
    } else if (runner === 'sh') {
      const result = parseSh(step.status).results.get(SH_RESULT);
      report = () => result;
    } else {
      throw new TypeError(`judgeNames: unknown test runner ${JSON.stringify(runner)}`);
    }
  }
  const out = { passed: [], failed: [], notRun: [] };
  for (const name of names) {
    const result = report(name);
    if (result === 'ok') out.passed.push(name);
    else if (result === 'FAILED') out.failed.push(name);
    else out.notRun.push(name);
  }
  return out;
}
// nonAssertionNames(runner, phase, step) -> the phase's names that FAILED by something other than an assertion (a
// ReferenceError, a TypeError, a missing export: the test could not exercise the code). Only node reports it: the
// cargo parser has no classifier (Rust prints a custom assert message without the word "assertion", so a panic
// cannot be told from one) and an sh step has no names. `phase` is judgeNames' result for the same step.
function nonAssertionNames(runner, phase, step) {
  if (runner !== 'node' || step === null || step === undefined) return [];
  return parseNodeTest(step.stdout).nonAssertionFailures.filter((name) => phase.failed.includes(name));
}

// verdict({ infra, graft, build, f2p, p2p }) -> boolean. Fails closed: anything other than the exact green
// values is false (an undefined infra is not "no infra").
export function verdict({ infra, graft, build, f2p, p2p }) {
  return infra === null
    && graft === 'ok'
    && build === 'ok'
    && f2p.passed.length > 0
    && [f2p, p2p].every((phase) => phase.failed.length === 0 && phase.notRun.length === 0);
}

// infraOf(dockerRunResult) -> null | 'create_failed' | 'oom' | 'inspect_failed' | 'rm_failed' | 'timeout'.
// `created` comes first: with no container there is nothing to inspect, and oomKilled is null for that reason.
export function infraOf(r) {
  if (!r.created) return 'create_failed';
  if (r.oomKilled === true) return 'oom';
  if (r.oomKilled === null) return 'inspect_failed';
  if (!r.rmOk) return 'rm_failed';
  if (r.timedOut) return 'timeout';
  return null;
}

// limitsOf(def, timeouts) -> { build, test, container } in seconds. The container's own limit outlasts the
// worst serial path through the driver: the diff's two git calls and the graft (PREP_SEC each), the build, and
// both test steps, every one with its kill-after, plus SLACK_SEC. `timeouts.container` overrides it. (The
// prep limit is fixed; it is not an option.)
export function limitsOf(def, timeouts = {}) {
  const build = timeouts.build ?? def.timeoutsSec.build;
  const test = timeouts.test ?? def.timeoutsSec.test;
  const serial = 3 * (PREP_SEC + KILL_AFTER_SEC) + (build + KILL_AFTER_SEC) + 2 * (test + KILL_AFTER_SEC);
  const container = timeouts.container ?? serial + SLACK_SEC;
  for (const [what, value, whole] of [['build', build, true], ['test', test, true], ['container', container, false]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (whole && !Number.isInteger(value))) {
      throw new TypeError(`gradeTree: timeouts.${what} must be a positive ${whole ? 'integer' : 'number'} of seconds, got ${JSON.stringify(value)}`);
    }
  }
  return { build, test, container };
}

// parseShortstat(text) -> { files, insertions, deletions }. git prints nothing for no change.
export function parseShortstat(text) {
  const count = (re) => Number(re.exec(text)?.[1] ?? 0);
  return { files: count(/(\d+) files? changed/), insertions: count(/(\d+) insertions?\(\+\)/), deletions: count(/(\d+) deletions?\(-\)/) };
}

// ---- the scripts that run inside the grade container ----

const sq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const hiddenPaths = (def) => [...new Set([...def.hidden.files, ...(def.hidden.extra ?? [])])];

// Every directory above `rel` under `work` must be a real directory: a symlink or a file there is removed
// and replaced by one, so nothing below it can be reached through a link.
function ensureDirs(work, rel) {
  const lines = [];
  const parts = rel.split('/').slice(0, -1);
  for (let i = 0; i < parts.length; i++) {
    const dir = sq(`${work}/${parts.slice(0, i + 1).join('/')}`);
    lines.push(`if [ -L ${dir} ] || { [ -e ${dir} ] && [ ! -d ${dir} ]; }; then rm -rf -- ${dir} || exit 1; fi`);
    lines.push(`[ -d ${dir} ] || mkdir -- ${dir} || exit 1`);
  }
  return lines;
}

// A graftLines line declares exactly one Rust module: see moduleOf in task-def.mjs, the one rule the loader and this
// grader share. It is re-exported here, where the graft and its tests have always found it.
export { moduleOf };

// graftScript(manifest, { work = '/work', hidden = '/hidden' }) -> an sh script. For each hidden file (the
// def's hidden.files and hidden.extra): repair the parent directories, remove whatever is at the target
// without following a link, and copy the hidden version in. Then each graftLines line is appended to its
// file unless the file already declares that module. It runs INSIDE the grade container: the agent controls
// its tree, so a hidden path, or a directory above it, can be a symlink to anywhere, and a host-side write
// would land outside the tree. (The roots are parameters so the tests can run the script on fixtures.)
//
// "Already declares the module" is a line that starts (column 0) with optional attributes, an optional
// visibility, `mod NAME` and then `;` or `{`: so an agent's own `pub mod NAME;`, rustfmt's `#[cfg(test)]`
// newline `mod NAME;`, a CRLF file or an inline `mod NAME {` all count, and a `//` comment, an indented line or
// a different name do not. A second `mod NAME` would be E0428. (An inline `mod NAME { .. }` of the agent's
// keeps its module and the hidden file is then not compiled: its names are not run, which is a failure.)
export function graftScript(manifest, { work = '/work', hidden = '/hidden' } = {}) {
  const lines = [];
  for (const rel of hiddenPaths(manifest.def)) {
    const target = sq(`${work}/${rel}`);
    lines.push(...ensureDirs(work, rel));
    lines.push(`rm -rf -- ${target} || exit 1`);
    lines.push(`cp -- ${sq(`${hidden}/${rel}`)} ${target} || exit 1`);
  }
  for (const { file, line } of manifest.def.hidden.graftLines ?? []) {
    const target = sq(`${work}/${file}`);
    const text = sq(line);
    const declared = `^(#\\[[^]]*\\][[:space:]]*)*(pub([[:space:]]*\\([^)]*\\))?[[:space:]]+)?mod[[:space:]]+${moduleOf(line)}[[:space:]]*[;{]`;
    lines.push(...ensureDirs(work, file));
    lines.push(`if grep -Eq -- ${sq(declared)} ${target}; then :; else`);
    // A file that does not end in a newline would swallow the appended line.
    lines.push(`  if [ -s ${target} ] && [ -n "$(tail -c 1 ${target})" ]; then printf '\\n' >> ${target} || exit 1; fi`);
    lines.push(`  printf '%s\\n' ${text} >> ${target} || exit 1`);
    lines.push('fi');
  }
  lines.push('exit 0');
  return `${lines.join('\n')}\n`;
}

const BASE_COMMIT_RE = /^[0-9a-f]{40}$/;
const GRAFT_EOF = 'S5_GRAFT_EOF';
// git in the grade container: the agent's own tree supplies the repository, so its config may not run a
// filesystem monitor hook for us, and a directory owned by another uid is fine.
const GIT = "git -c safe.directory='*' -c core.fsmonitor=false";

// driverScript(manifest, { buildSec, testSec, prepSec, work, hidden, results }) -> the sh script the grade container runs.
// Every step is under `timeout -k`: the diff's two git calls and the graft under prepSec (PREP_SEC; only the
// agent's tree can make them hang, e.g. a FIFO where a graftLines file should be; the option is a seam for
// tests), the build under the build limit, the tests under the test limit. An unbounded step would reach the
// container's own clock and be scored as infrastructure.
// The diff is against manifest.baseCommit, the task's one commit, because an agent that commits moves HEAD.
export function driverScript(manifest, { buildSec, testSec, prepSec = PREP_SEC, work = '/work', hidden = '/hidden', results = '/results' } = {}) {
  const { def, baseCommit } = manifest;
  if (typeof baseCommit !== 'string' || !BASE_COMMIT_RE.test(baseCommit)) throw new TypeError(`driverScript: manifest.baseCommit must be a 40-hex commit id, got ${JSON.stringify(baseCommit)}`);
  const buildLimit = buildSec ?? def.timeoutsSec.build;
  const testLimit = testSec ?? def.timeoutsSec.test;
  const file = (name) => sq(`${results}/${name}`);
  const run = (limit, argv, name) => `timeout -k ${KILL_AFTER_SEC} ${limit} ${argv.map(sq).join(' ')} < /dev/null > ${file(`${name}.out`)} 2>&1`;
  const graft = graftScript(manifest, { work, hidden }).trimEnd();
  if (graft.split('\n').includes(GRAFT_EOF)) throw new Error('driverScript: the graft script contains its own here-document delimiter');
  return [
    `cd ${sq(work)} || exit 1`,
    '# (1) the diff stats of the agent\'s own change against the task commit: BEFORE the graft, so the hidden tests are not in them',
    `timeout -k ${KILL_AFTER_SEC} ${prepSec} ${GIT} add -A > ${file('diff.log')} 2>&1 && timeout -k ${KILL_AFTER_SEC} ${prepSec} ${GIT} diff --cached --shortstat ${sq(baseCommit)} > ${file('diff.txt')} 2>> ${file('diff.log')}`,
    `echo $? > ${file('diff.status')}`,
    '# (2) the graft, as its own shell, read from the here-document',
    `timeout -k ${KILL_AFTER_SEC} ${prepSec} sh -s > ${file('graft.log')} 2>&1 <<'${GRAFT_EOF}'`,
    graft,
    GRAFT_EOF,
    'gs=$?',
    `echo $gs > ${file('graft.status')}`,
    'if [ $gs -eq 0 ]; then',
    '  # (3) the build',
    `  ${run(buildLimit, def.buildCommand, 'build')}`,
    '  bs=$?',
    `  echo $bs > ${file('build.status')}`,
    '  if [ $bs -eq 0 ]; then',
    '    # (4) the tests',
    `    ${run(testLimit, def.f2p.command, 'f2p')}`,
    `    echo $? > ${file('f2p.status')}`,
    `    ${run(testLimit, def.p2p.command, 'p2p')}`,
    `    echo $? > ${file('p2p.status')}`,
    '  fi',
    'fi',
    `echo done > ${file('done')}`,
    '',
  ].join('\n');
}

// ---- reading what the container left ----

// readResultFile(path, maxBytes) -> the file's text (at most maxBytes of it), or null when it is not a regular
// file: missing, a symlink (never followed), a directory, a FIFO (the open does not block).
export function readResultFile(path, maxBytes = MAX_OUTPUT_BYTES) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const want = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const n = readSync(fd, buf, got, want - got, got);
      if (n === 0) break;
      got += n;
    }
    return buf.subarray(0, got).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function summarise(def, docker, resultsDir) {
  const read = (name) => readResultFile(join(resultsDir, name));
  const number = (name) => {
    const text = read(name);
    return text !== null && /^\d+\s*$/.test(text) ? Number(text) : null;
  };
  const graftStatus = number('graft.status');
  const graft = graftStatus === null ? 'not_run' : graftStatus === 0 ? 'ok' : 'failed';
  // A build after a graft that failed is not the build of the graded tree.
  const buildStatus = graft === 'ok' ? number('build.status') : null;
  const build = buildStatus === null ? 'not_run' : buildStatus === 0 ? 'ok' : buildStatus === 124 ? 'timeout' : 'failed';
  const step = (name) => {
    if (build !== 'ok') return null;
    const status = number(`${name}.status`);
    return status === null ? null : { status, stdout: read(`${name}.out`) ?? '' };
  };
  const f2pStep = step('f2p');
  const p2pStep = step('p2p');
  const f2p = judgeNames(def.testRunner, def.f2p.names, f2pStep);
  const p2p = judgeNames(def.testRunner, def.p2p.names, p2pStep);
  const nonAssertion = [...new Set([nonAssertionNames(def.testRunner, f2p, f2pStep), nonAssertionNames(def.testRunner, p2p, p2pStep)].flat())];

  let infra = infraOf(docker);
  if (infra === null && read('done') === null) infra = 'incomplete';
  const diffStatus = number('diff.status');
  const diffText = read('diff.txt');
  const tail = String(docker.stderr).trim().slice(-DETAIL_BYTES);
  return {
    infra,
    graft,
    build,
    f2p,
    p2p,
    nonAssertion,
    pass: verdict({ infra, graft, build, f2p, p2p }),
    diff: diffStatus === 0 && diffText !== null ? parseShortstat(diffText) : null,
    wallMs: docker.wallMs,
    detail: infra === null ? null : `docker run exited ${docker.status}${tail === '' ? '' : `: ${tail}`}`,
  };
}

// ---- inputs ----

const isStrings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s !== '');
const isCommand = (v) => isStrings(v) && v.length > 0;
function relativePath(what, p) {
  if (typeof p !== 'string' || p === '' || p.includes('\0') || p.startsWith('/') || p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new TypeError(`gradeTree: ${what} must be a relative path without '.', '..' or empty segments, got ${JSON.stringify(p)}`);
  }
}
function requireManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object') throw new TypeError('gradeTree: the manifest must be an object');
  if (typeof manifest.id !== 'string' || !TASK_ID_RE.test(manifest.id)) throw new TypeError(`gradeTree: manifest.id must match ${TASK_ID_RE}, got ${JSON.stringify(manifest.id)}`);
  const { def } = manifest;
  if (def === null || typeof def !== 'object') throw new TypeError('gradeTree: the manifest has no def');
  if (!RUNNERS.includes(def.testRunner)) throw new TypeError(`gradeTree: def.testRunner must be one of ${RUNNERS.join(', ')}, got ${JSON.stringify(def.testRunner)}`);
  if (!isCommand(def.buildCommand)) throw new TypeError('gradeTree: def.buildCommand must be a non-empty array of non-empty strings');
  for (const phase of ['f2p', 'p2p']) {
    if (def[phase] === null || typeof def[phase] !== 'object' || !isCommand(def[phase].command) || !isStrings(def[phase].names)) {
      throw new TypeError(`gradeTree: def.${phase} must have a command and a list of names`);
    }
  }
  // An empty F2P list would pass vacuously: nothing would have shown the fix.
  if (def.f2p.names.length === 0) throw new TypeError('gradeTree: def.f2p.names must not be empty');
  const hidden = def.hidden;
  if (hidden === null || typeof hidden !== 'object' || !Array.isArray(hidden.files) || (hidden.extra !== undefined && !Array.isArray(hidden.extra))) {
    throw new TypeError('gradeTree: def.hidden must have a files list');
  }
  const paths = hiddenPaths(def);
  if (paths.length === 0) throw new TypeError('gradeTree: the task has no hidden test files');
  for (const p of paths) relativePath('a hidden file', p);
  for (const g of hidden.graftLines ?? []) {
    relativePath('a graftLines file', g?.file);
    if (typeof g.line !== 'string' || g.line === '' || /[\r\n\0]/.test(g.line)) throw new TypeError('gradeTree: a graftLines line must be one non-empty line');
    try {
      moduleOf(g.line);
    } catch (err) {
      throw new TypeError(`gradeTree: ${err.message}`);
    }
  }
  if (typeof manifest.baseCommit !== 'string' || !BASE_COMMIT_RE.test(manifest.baseCommit)) {
    throw new TypeError(`gradeTree: manifest.baseCommit must be the task commit's 40-hex id (build-task records it), got ${JSON.stringify(manifest.baseCommit)}`);
  }
  if (def.timeoutsSec === null || typeof def.timeoutsSec !== 'object') throw new TypeError('gradeTree: the def has no timeoutsSec');
}

function lstatOrNull(p) {
  try {
    return lstatSync(p);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Remove a grade directory. A directory the container made read-only (a test that chmods its scratch
// directory) stops a plain removal, so one retry first makes the tree writable (chmod -R never follows a link).
// -> { kept: null, leftover: null | dir }
export function removeGradeDir(dir) {
  const remove = () => rmSync(dir, { recursive: true, force: true });
  try {
    remove();
    return { kept: null, leftover: null };
  } catch {
    spawnSync('chmod', ['-R', 'u+rwX', '--', dir], { stdio: 'ignore', env: { PATH: process.env.PATH } });
  }
  try {
    remove();
    return { kept: null, leftover: null };
  } catch {
    return { kept: null, leftover: dir };
  }
}

// ---- the grade ----

export async function gradeTree(manifest, agentTreeDir, options = {}) {
  const { workRoot, image, timeouts = {}, dockerBin, runId, cpus, memoryGb } = options ?? {};
  requireManifest(manifest);
  const { def } = manifest;
  if (typeof workRoot !== 'string' || workRoot === '') throw new TypeError('gradeTree: workRoot must be a non-empty string');
  if (typeof image !== 'string' || image === '') throw new TypeError('gradeTree: image must be a non-empty string');
  if (typeof agentTreeDir !== 'string' || agentTreeDir === '') throw new TypeError('gradeTree: agentTreeDir must be a non-empty string');
  if (runId !== undefined && (typeof runId !== 'string' || !RUN_ID_RE.test(runId))) throw new TypeError(`gradeTree: runId must match ${RUN_ID_RE}, got ${JSON.stringify(runId)}`);
  const limits = limitsOf(def, timeouts);

  const root = resolve(workRoot);
  const taskDir = join(root, 'tasks', manifest.id);
  const hiddenDir = join(taskDir, 'hidden');
  for (const rel of hiddenPaths(def)) {
    const st = lstatOrNull(join(hiddenDir, rel));
    if (st === null || !st.isFile()) throw new Error(`gradeTree: hidden file ${rel} is not a regular file in ${hiddenDir}`);
  }
  const tree = resolve(agentTreeDir);
  const treeStat = lstatOrNull(tree);
  if (treeStat === null || !treeStat.isDirectory()) throw new Error(`gradeTree: the agent tree ${agentTreeDir} is not a directory (a link is not a tree)`);
  const cargo = def.testRunner === 'cargo';
  const warmTarget = join(taskDir, 'target');
  const warmStat = cargo ? lstatOrNull(warmTarget) : null;
  if (warmStat !== null && !warmStat.isDirectory()) throw new Error(`gradeTree: ${warmTarget} exists but is not a directory`);
  const cargoHome = join(root, 'cargo-home');
  let hasCargoHome = false;
  if (cargo) {
    try {
      hasCargoHome = statSync(cargoHome).isDirectory();
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  const gradeId = runId ?? randomBytes(6).toString('hex');
  const gradeDir = join(root, 'grades', gradeId);
  mkdirSync(join(root, 'grades'), { recursive: true });
  try {
    mkdirSync(gradeDir); // atomic: a grade id in use is never merged into, and never removed by a second grade
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`gradeTree: ${gradeDir} already exists (a grade with runId ${gradeId} is in progress, or its directory was kept)`);
    throw err;
  }

  let summary = null;
  let failure = null;
  try {
    const workDir = join(gradeDir, 'work');
    reflinkCopy(tree, workDir);
    const resultsDir = join(gradeDir, 'results');
    mkdirSync(resultsDir);
    const mounts = [
      { host: workDir, container: '/work' },
      { host: hiddenDir, container: '/hidden', readOnly: true },
      { host: resultsDir, container: '/results' },
    ];
    const env = {};
    if (warmStat !== null) {
      const targetDir = join(gradeDir, 'target');
      reflinkCopy(warmTarget, targetDir);
      mounts.push({ host: targetDir, container: '/target' });
      env.CARGO_TARGET_DIR = '/target';
    }
    if (hasCargoHome) mounts.push({ host: cargoHome, container: '/cargo', readOnly: true });

    const docker = await dockerRun({
      image,
      name: `s5-grade-${gradeId}`,
      labels: { 's5.task': manifest.id },
      ...(cpus === undefined ? {} : { cpus }),
      ...(memoryGb === undefined ? {} : { memoryGb }),
      network: 'none',
      mounts,
      env,
      workdir: '/work',
      user: 'agent',
      cmd: ['sh', '-c', driverScript(manifest, { buildSec: limits.build, testSec: limits.test })],
      timeoutMs: Math.max(1, Math.round(limits.container * 1000)),
      stdin: 'null',
    }, { dockerBin });
    summary = summarise(def, docker, resultsDir);
  } catch (err) {
    failure = err;
  }
  const disposal = process.env.S5_KEEP_GRADES === '1' ? { kept: gradeDir, leftover: null } : removeGradeDir(gradeDir);
  if (failure !== null) throw failure;
  return { ...summary, ...disposal };
}
