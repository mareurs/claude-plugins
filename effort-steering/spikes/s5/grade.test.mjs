// grade.test.mjs — the S5 grader: the parsers, the pass rule, the graft and driver scripts, and
// gradeTree against a FAKE docker (always); the real thing against real Docker (S5_DOCKER_TESTS=1).
//
// What a green run here is evidence for: every way a run can be scored wrongly is pinned by a test
// that fails when the rule is mutated. A hidden test that silently does not run (a name missing, an
// `ignored` report, a compile error, a build that failed, a step that was never reached) is a
// failure, and an infrastructure outcome is never a score. The generated shell (the graft and the
// driver) is tested as text AND by running it with `sh` on fixture directories that this file makes
// (never on model-written code: that runs only inside the grade container).
//
// gradeTree needs a reflink-capable filesystem (reflinkCopy never falls back to a full copy), so its
// test directories live under ~/work/claude/s5-work/tmp-tests/ (btrfs) and are removed afterwards.
// The fake docker (fixtures/fake-docker.mjs) writes the files a container's driver would have left
// in the /results mount; nothing here starts a container unless S5_DOCKER_TESTS=1.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { ta } from './fixtures/testkit-async.mjs';
import { git } from './git.mjs';
import {
  driverScript, gradeTree, graftScript, infraOf, judgeNames, limitsOf, moduleOf, parseCargo, parseNodeTest, parseSh, parseShortstat, readResultFile, removeGradeDir, SH_RESULT, verdict,
} from './grade.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-docker.mjs');
const fixture = (name) => readFileSync(join(HERE, 'fixtures', 'test-output', name), 'utf8');

const made = [];
process.on('exit', () => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
  try {
    rmdirSync(join(homedir(), 'work', 'claude', 's5-work', 'tmp-tests'));
  } catch {
    // other test dirs are in it, or it is gone
  }
});
function tmp(prefix, base = tmpdir()) {
  mkdirSync(base, { recursive: true });
  const d = mkdtempSync(join(base, prefix));
  made.push(d);
  return d;
}
const put = (root, rel, content = '') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};
const readOr = (p, fallback = null) => (existsSync(p) ? readFileSync(p, 'utf8') : fallback);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// ---- manifests ----

const defOf = (over = {}) => ({
  testRunner: 'cargo',
  buildCommand: ['cargo', 'test', '--no-run', '--no-default-features'],
  f2p: { command: ['cargo', 'test', '--no-default-features', 'hidden'], names: ['hidden::it_works'] },
  p2p: { command: ['cargo', 'test', '--no-default-features'], names: ['existing::stays'] },
  hidden: { files: ['tests/hidden.rs'], extra: ['tests/extra/more.rs'], graftLines: [{ file: 'src/lib.rs', line: 'mod hidden_support;' }] },
  timeoutsSec: { build: 600, test: 300 },
  ...over,
});
const BASE = 'b'.repeat(40);
const manifestOf = (over = {}) => ({ id: 'task-one', repo: 'codescout', baseCommit: BASE, def: defOf(over) });

// =====================================================================================
// parsers
// =====================================================================================

t('parseCargo reads ok, FAILED and ignored lines; a failed doc-test\'s compile error is not a compile error', () => {
  const run = parseCargo(fixture('cargo-run.txt'));
  assert.equal(run.results.get('tools::add::adds_positive'), 'ok');
  assert.equal(run.results.get('tools::add::adds_negative'), 'FAILED');
  assert.equal(run.results.get('tools::add::slow_one'), 'ignored');
  assert.equal(run.results.get('tools::add::slow_two'), 'ignored', 'an ignore reason does not hide the report');
  assert.equal(run.results.get('src/lib.rs - add (line 3)'), 'ok', 'a doc-test name holds spaces');
  assert.equal(run.results.get('only_in_other'), 'ok');
  assert.equal(run.results.get('src/lib.rs - f (line 1)'), 'FAILED', 'a doc-test that does not compile is a failed test');
  assert.equal(run.compileError, false, 'error[E0308] in a failed doc-test\'s section, and "error: 3 targets failed", are test failures, not a build failure');
  assert.equal(run.results.size, 15);

  const broken = parseCargo(fixture('cargo-compile-error.txt'));
  assert.equal(broken.compileError, true);
  assert.equal(broken.results.size, 0);
});

t('parseCargo strips libtest\'s kind suffix from a name: " - should panic", " - compile fail", " - compile"', () => {
  const run = parseCargo(fixture('cargo-run.txt'));
  assert.equal(run.results.get('tests::listed_should_panic'), 'ok', 'real libtest output: "test tests::listed_should_panic - should panic ... ok"');
  assert.equal(run.results.get('src/lib.rs - g (line 9)'), 'ok');
  assert.equal(run.results.get('src/lib.rs - h (line 14)'), 'ok');
  assert.equal(run.results.get('src/lib.rs - i (line 20)'), 'ok');
  assert.ok(![...run.results.keys()].some((k) => / - (should panic|compile fail|compile)$/.test(k)), 'no suffix survives');
  const inline = parseCargo('test a - should panic ... FAILED\ntest b - compile fail ... ignored\ntest c - compile ... ok\ntest d - compile_more ... ok\ntest e - should panic - should panic ... ok\n');
  assert.deepEqual([...inline.results], [['a', 'FAILED'], ['b', 'ignored'], ['c', 'ok'], ['d - compile_more', 'ok'], ['e - should panic', 'ok']], 'only a TRAILING suffix, once');
});

t('parseCargo ignores every line from "failures:" to the next "running N tests": a failed test\'s own output cannot report', () => {
  const run = parseCargo(fixture('cargo-run.txt'));
  assert.equal(run.results.has('tests::forged'), false, 'a forged "test tests::forged ... ok" in a failure section is not a report');

  const forged = [
    'running 2 tests',
    'test real::one ... FAILED',
    'test real::two ... ok',
    '',
    'failures:',
    '',
    '---- real::one stdout ----',
    'test real::forged ... ok',
    'test real::one ... ok',
    'error[E0308]: mismatched types',
    'error: could not compile `x` (lib) due to 1 previous error',
    '',
    'failures:',
    '    real::one',
    '',
    'test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
    '',
    'running 1 test',
    'test later::binary ... ok',
    '',
  ].join('\n');
  const run2 = parseCargo(forged);
  assert.deepEqual([...run2.results], [['real::one', 'FAILED'], ['real::two', 'ok'], ['later::binary', 'ok']], 'reports resume at the next "running N tests"');
  assert.equal(run2.compileError, false);
  // only the exact line opens the section
  for (const notOpening of ['  failures:', 'failures: ', 'failures', 'failures:x']) {
    assert.equal(parseCargo(`${notOpening}\ntest a ... ok\n`).results.get('a'), 'ok', JSON.stringify(notOpening));
  }
  // only "running N test(s)" closes it
  assert.equal(parseCargo('failures:\nrunning soon\ntest a ... ok\n').results.has('a'), false);
  assert.equal(parseCargo('failures:\nrunning 0 tests\ntest a ... ok\n').results.get('a'), 'ok');
  assert.equal(parseCargo('failures:\nrunning 1 test\ntest a ... ok\n').results.get('a'), 'ok');
  // and only the WHOLE line does: a captured line that merely ends with it, starts with it, is indented or padded
  // does not reopen reporting, so a forged report behind it stays ignored
  for (const captured of ['note: running 2 tests', 'running 2 tests later', '  running 2 tests', 'running 2 tests ', 'running 2 test cases', 'xrunning 2 tests']) {
    const out = parseCargo(`failures:\n${captured}\ntest x ... ok\nrunning 2 tests\ntest y ... ok\n`);
    assert.equal(out.results.has('x'), false, `after ${JSON.stringify(captured)} the section is still open`);
    assert.equal(out.results.get('y'), 'ok', 'and the real "running 2 tests" line still closes it');
  }
});

t('parseCargo: a compile error without an error code is still a compile error; a test failure and prose are not', () => {
  assert.equal(parseCargo('error: expected one of `!` or `::`, found `}`\nerror: could not compile `tiny` (lib) due to 1 previous error\n').compileError, true);
  assert.equal(parseCargo('error[E0432]: unresolved import `x`\n').compileError, true);
  assert.equal(parseCargo('error: test failed, to rerun pass `--lib`\n').compileError, false);
  assert.equal(parseCargo('error: no test target named `hidden` in default-run packages\n').compileError, false, 'a missing target runs nothing, and the names are simply absent');
  assert.equal(parseCargo('the error[E0425] in this sentence\n  error: could not compile (indented: not cargo)\n').compileError, false);
});

t('parseCargo: a name reported by several binaries is its WORST report, whatever the order', () => {
  const run = parseCargo(fixture('cargo-run.txt'));
  assert.equal(run.results.get('shared::helper_works'), 'FAILED', 'ok in the lib, FAILED in the integration binary');
  assert.equal(run.results.get('order::flip'), 'FAILED', 'FAILED first, ok second');
  assert.equal(run.results.get('checks_ok'), 'ok', 'ok in two binaries stays ok');

  assert.equal(parseCargo('test x ... ok\ntest x ... ignored\n').results.get('x'), 'ignored');
  assert.equal(parseCargo('test x ... ignored\ntest x ... ok\n').results.get('x'), 'ignored');
  assert.equal(parseCargo('test x ... ignored\ntest x ... FAILED\n').results.get('x'), 'FAILED');
  assert.equal(parseCargo('test x ... FAILED\ntest x ... ignored\n').results.get('x'), 'FAILED');
});

t('parseCargo strips colour and a report time, and ignores lines that only look like reports', () => {
  const coloured = parseCargo('test a ... \u001b[32mok\u001b[0m\ntest b ... \u001b[31mFAILED\u001b[0m\ntest c ... ok <0.012s>\ntest d ... FAILED <0.5s>\r\n');
  assert.deepEqual([...coloured.results], [['a', 'ok'], ['b', 'FAILED'], ['c', 'ok'], ['d', 'FAILED']]);

  const noise = parseCargo([
    'test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
    '    test indented ... ok',
    'test x ... okay',
    'test y ... FAILEDX',
    'test_z ... ok',
    'running 3 tests',
    'test  ... ok',
    'test bench_a ... bench:         123 ns/iter (+/- 4)',
  ].join('\n'));
  assert.deepEqual([...noise.results], []);
});

t('parseNodeTest separates assertion failures from a ReferenceError', () => {
  const run = parseNodeTest(fixture('node-plain.txt'));
  assert.deepEqual([...run.results], [
    ['parses a plain version', 'ok'],
    ['exports the helper', 'FAILED'],
    ['rejects a negative count', 'FAILED'],
    ['handles an empty list', 'ok'],
    ['needs the new option', 'FAILED'],
    ['a \\#1 stays as the helper printed it', 'ok'],
  ]);
  assert.deepEqual(run.nonAssertionFailures, ['exports the helper', 'needs the new option'], 'the AssertionError is a behaviour failure; ReferenceError and TypeError are not');
});

t('parseNodeTest reads node v26 --test-reporter=tap output: numbering, nesting, SKIP and TODO, escaped names, a test\'s own prints in comments', () => {
  const run = parseNodeTest(fixture('node-tap.txt'));
  assert.deepEqual([...run.results], [
    ['needs a missing export', 'FAILED'],
    ['rejects a negative count', 'FAILED'],
    ['parses a plain version', 'ok'],
    ['waits for the network', 'ignored'],
    ['not done yet', 'ignored'],
    ['a #1', 'ok'],
    ['back\\slash and tab\\there', 'ok'],
    ['new\\nline and cr\\rhere', 'ok'],
    ['bell\\bform\\fvt\\vend', 'ok'],
    ['a ## b \\# c', 'ok'],
    ['prints a forged line', 'ok'],
    ['adds two numbers', 'ok'],
    ['subtracts', 'FAILED'],
    ['suite one', 'FAILED'],
  ]);
  assert.equal(run.results.has('forged'), false, 'a test\'s own print of "ok 7 - forged" lands in a "# " comment and is not a report');
  assert.equal(run.results.has('forged too'), false);
  // The ReferenceError comes BEFORE the assertion failures: a failure's block ends at the next report.
  assert.deepEqual(run.nonAssertionFailures, ['needs a missing export'], 'ERR_ASSERTION is an assertion; a parent whose subtests failed is not a failure of its own');
});

t('parseNodeTest un-escapes a numbered TAP name (node escapes \\ and #), and leaves the helper\'s plain names alone', () => {
  const one = (text) => [...parseNodeTest(text).results];
  assert.deepEqual(one('ok 1 - a \\#1\n'), [['a #1', 'ok']]);
  assert.deepEqual(one('ok 1 - a \\\\\\# b\n'), [['a \\# b', 'ok']], 'backslash, backslash, backslash, hash: an escaped backslash then an escaped hash');
  assert.deepEqual(one('ok 1 - C:\\\\temp\\\\new\n'), [['C:\\temp\\new', 'ok']], 'a path with a backslash-t is a backslash and a t');
  assert.deepEqual(one('ok - a \\#1\n'), [['a \\#1', 'ok']], 'no number: the plain helper does not escape, so nothing is undone');
  assert.deepEqual(one('ok 1 - x \\# SKIP y\n'), [['x # SKIP y', 'ok']], 'an escaped # is part of the name, not a directive');
  assert.deepEqual(one('ok 2 - x # SKIP y\n'), [['x', 'ignored']]);
  assert.deepEqual(one('not ok 3 - tab\\\\there\n'), [['tab\\there', 'FAILED']], 'a control character comes back as its backslash-letter form');
  assert.deepEqual(one('ok 4 - \\\\\n'), [['\\', 'ok']]);
});

t('parseNodeTest on node\'s default spec format reads only a test\'s own raw prints: every listed name is not run', () => {
  const spec = parseNodeTest(fixture('node-spec.txt'));
  assert.deepEqual([...spec.results].map(([name]) => name).sort(), ['forged', 'forged too'], 'the check marks are not reports; a raw print is, which is why the task def must say --test-reporter=tap');
  assert.deepEqual(judgeNames('node', ['adds two numbers', 'parses a plain version'], { status: 1, stdout: fixture('node-spec.txt') }), { passed: [], failed: [], notRun: ['adds two numbers', 'parses a plain version'] });
});

t('parseNodeTest: a name reported twice is its worst report; prose and stack lines are not reports', () => {
  const twice = parseNodeTest('ok - a\nnot ok - a\nnot ok - b\nok - b\nok - c\nok - c\n');
  assert.deepEqual([...twice.results], [['a', 'FAILED'], ['b', 'FAILED'], ['c', 'ok']]);
  const noise = parseNodeTest('okay - y\nnot ok\nok -\n    at ok - nothing (file:1:1)\nthe ok - word\n# ok - comment\n1..3\n# tests 3\n');
  assert.deepEqual([...noise.results], []);
  assert.deepEqual(parseNodeTest('not ok - x\n').nonAssertionFailures, ['x'], 'a failure that shows no assertion is listed as not an assertion');
  assert.deepEqual(parseNodeTest('ok 1 - x # skip because\nnot ok 2 - y # TODO later\n').results.get('x'), 'ignored');
  assert.deepEqual(parseNodeTest('ok 1 - x # skip because\nnot ok 2 - y # TODO later\n').results.get('y'), 'ignored');
});

t('parseSh: only exit status 0 is ok, and the output plays no part', () => {
  assert.deepEqual([...parseSh(0).results], [[SH_RESULT, 'ok']]);
  for (const status of [1, 2, 124, 126, 127, 137, null, undefined, Number.NaN, '0', false]) {
    assert.deepEqual([...parseSh(status).results], [[SH_RESULT, 'FAILED']], `status ${String(status)}`);
  }
});

// =====================================================================================
// the pass rule
// =====================================================================================

t('judgeNames (cargo): a listed name that is missing, ignored or FAILED is not passed', () => {
  const out = 'test a ... ok\ntest b ... FAILED\ntest c ... ignored\ntest unlisted ... ok\n';
  assert.deepEqual(judgeNames('cargo', ['a', 'b', 'c', 'd'], { status: 101, stdout: out }), { passed: ['a'], failed: ['b'], notRun: ['c', 'd'] });
  assert.deepEqual(judgeNames('cargo', ['a'], { status: 0, stdout: out }), { passed: ['a'], failed: [], notRun: [] });
});

t('judgeNames (cargo): a name reported by two binaries passes only if both reports are ok', () => {
  const both = fixture('cargo-run.txt');
  assert.deepEqual(judgeNames('cargo', ['checks_ok', 'shared::helper_works', 'order::flip'], { status: 101, stdout: both }), {
    passed: ['checks_ok'], failed: ['shared::helper_works', 'order::flip'], notRun: [],
  });
});

t('judgeNames (cargo): each listed name counts by its own report; a compile error voids nothing and a failed doc-test\'s section reports nothing', () => {
  // (the old rule voided the whole step next to any `error[E…]`: a failed doc-test prints one in its own section)
  const names = ['tests::listed_should_panic', 'src/lib.rs - f (line 1)', 'src/lib.rs - g (line 9)', 'tests::forged', 'checks_ok'];
  assert.deepEqual(judgeNames('cargo', names, { status: 101, stdout: fixture('cargo-run.txt') }), {
    passed: ['tests::listed_should_panic', 'src/lib.rs - g (line 9)', 'checks_ok'],
    failed: ['src/lib.rs - f (line 1)'],
    notRun: ['tests::forged'],
  });
  // a name that reported ok next to a real compile error counts as ok: it ran, by its own report
  assert.deepEqual(judgeNames('cargo', ['a', 'b'], { status: 101, stdout: `test a ... ok\n${fixture('cargo-compile-error.txt')}` }), { passed: ['a'], failed: [], notRun: ['b'] });
  // cargo runs nothing when the build fails: the compile error alone leaves every name absent
  assert.deepEqual(judgeNames('cargo', ['a', 'b'], { status: 101, stdout: fixture('cargo-compile-error.txt') }), { passed: [], failed: [], notRun: ['a', 'b'] });
});

t('judgeNames: a step that never ran leaves every name not run', () => {
  for (const runner of ['cargo', 'node', 'sh']) assert.deepEqual(judgeNames(runner, ['a', 'b'], null), { passed: [], failed: [], notRun: ['a', 'b'] }, runner);
});

t('judgeNames (node): ok passes, not ok fails, an absent or skipped name is not run', () => {
  const out = 'ok - a\nnot ok - b\nTypeError: x\nok - c # SKIP no\nok - unlisted\n';
  assert.deepEqual(judgeNames('node', ['a', 'b', 'c', 'd'], { status: 1, stdout: out }), { passed: ['a'], failed: ['b'], notRun: ['c', 'd'] });
});

t('judgeNames (sh): the exit status decides for every name, whatever the output says', () => {
  const names = ['tests/hidden.sh'];
  const output = fixture('sh-run.txt');
  const status = Number(fixture('sh-run.status'));
  assert.deepEqual(judgeNames('sh', names, { status, stdout: output }), { passed: [], failed: names, notRun: [] }, 'output with PASS lines, but exit 1');
  assert.deepEqual(judgeNames('sh', names, { status: 0, stdout: 'FAIL: everything\n' }), { passed: names, failed: [], notRun: [] }, 'output with FAIL, but exit 0');
  assert.deepEqual(judgeNames('sh', names, { status: 124, stdout: '' }), { passed: [], failed: names, notRun: [] });
  assert.deepEqual(judgeNames('sh', ['x', 'y'], { status: 0, stdout: '' }), { passed: ['x', 'y'], failed: [], notRun: [] });
});

const empty = () => ({ passed: [], failed: [], notRun: [] });
const green = () => ({ infra: null, graft: 'ok', build: 'ok', f2p: { ...empty(), passed: ['a'] }, p2p: { ...empty(), passed: ['b'] } });

t('verdict: green only when there is no infra state, the graft and build are ok, and every name passed', () => {
  assert.equal(verdict(green()), true);
  assert.equal(verdict({ ...green(), p2p: empty() }), true, 'an empty P2P list is fine');
});

t('verdict is false for each way a run can fail, one at a time', () => {
  for (const infra of ['create_failed', 'oom', 'inspect_failed', 'rm_failed', 'timeout', 'incomplete']) {
    assert.equal(verdict({ ...green(), infra }), false, `infra ${infra} with every name passed`);
  }
  for (const graft of ['failed', 'not_run']) assert.equal(verdict({ ...green(), graft }), false, `graft ${graft}`);
  for (const build of ['failed', 'timeout', 'not_run']) assert.equal(verdict({ ...green(), build }), false, `build ${build} with no failing name reported`);
  for (const which of ['f2p', 'p2p']) {
    assert.equal(verdict({ ...green(), [which]: { ...green()[which], failed: ['x'] } }), false, `${which} has a failed name`);
    assert.equal(verdict({ ...green(), [which]: { ...green()[which], notRun: ['x'] } }), false, `${which} has a name not run`);
  }
  assert.equal(verdict({ ...green(), f2p: empty() }), false, 'an F2P list that proved nothing is not a pass');
});

t('infraOf maps each docker outcome, and "no container" is never read as "inspect failed"', () => {
  const ok = { created: true, oomKilled: false, inspectOk: true, rmOk: true, timedOut: false };
  assert.equal(infraOf(ok), null);
  assert.equal(infraOf({ ...ok, created: false, oomKilled: null, inspectOk: false }), 'create_failed');
  assert.equal(infraOf({ ...ok, oomKilled: true }), 'oom');
  assert.equal(infraOf({ ...ok, oomKilled: null, inspectOk: false }), 'inspect_failed');
  assert.equal(infraOf({ ...ok, rmOk: false }), 'rm_failed');
  assert.equal(infraOf({ ...ok, timedOut: true }), 'timeout');
  assert.equal(infraOf({ ...ok, timedOut: true, oomKilled: true }), 'oom', 'a timed-out container that was also OOM-killed is reported as OOM');
});

t('limitsOf: the task defaults, the overrides, and a container limit that outlasts the worst serial path through the driver', () => {
  // the worst path, written out from the driver's own steps: the diff's two git calls and the graft at 120 s,
  // the build, and both test steps, each followed by its 10 s kill-after
  const worst = (build, test) => 3 * (120 + 10) + (build + 10) + 2 * (test + 10);
  assert.deepEqual(limitsOf({ timeoutsSec: { build: 600, test: 300 } }, {}), { build: 600, test: 300, container: worst(600, 300) + 300 });
  assert.deepEqual(limitsOf({ timeoutsSec: { build: 600, test: 300 } }, { build: 7, test: 9 }), { build: 7, test: 9, container: worst(7, 9) + 300 });
  assert.equal(limitsOf({ timeoutsSec: { build: 600, test: 300 } }, { build: 7, test: 9 }).container, 745, 'the number, for {build 7, test 9}');
  for (const [build, test] of [[7, 9], [600, 300], [7, 261], [7, 1000], [3600, 3600], [1, 1]]) {
    const { container } = limitsOf({ timeoutsSec: { build: 1, test: 1 } }, { build, test });
    assert.ok(container > worst(build, test), `build ${build}, test ${test}: ${container} must exceed the worst serial path ${worst(build, test)}`);
    assert.equal(container - worst(build, test), 300, 'by exactly the slack');
  }
  assert.deepEqual(limitsOf({ timeoutsSec: { build: 600, test: 300 } }, { container: 0.5 }), { build: 600, test: 300, container: 0.5 }, 'an explicit container limit wins');
  assert.equal(limitsOf({ timeoutsSec: { build: 600, test: 300 } }, { build: 7, test: 9, container: 5000 }).container, 5000);
  for (const bad of [{ build: 0 }, { build: 1.5 }, { test: -1 }, { test: '5' }, { container: 0 }, { container: Number.NaN }]) {
    assert.throws(() => limitsOf({ timeoutsSec: { build: 600, test: 300 } }, bad), TypeError, JSON.stringify(bad));
  }
});

t('parseShortstat reads git\'s singular and plural forms; empty output is zero changes', () => {
  assert.deepEqual(parseShortstat(' 3 files changed, 10 insertions(+), 2 deletions(-)\n'), { files: 3, insertions: 10, deletions: 2 });
  assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+), 1 deletion(-)\n'), { files: 1, insertions: 1, deletions: 1 });
  assert.deepEqual(parseShortstat(' 1 file changed, 4 insertions(+)\n'), { files: 1, insertions: 4, deletions: 0 });
  assert.deepEqual(parseShortstat(' 2 files changed, 7 deletions(-)\n'), { files: 2, insertions: 0, deletions: 7 });
  assert.deepEqual(parseShortstat(''), { files: 0, insertions: 0, deletions: 0 });
  assert.deepEqual(parseShortstat('\n'), { files: 0, insertions: 0, deletions: 0 });
});

// =====================================================================================
// readResultFile: the container's files are model-controlled
// =====================================================================================

t('readResultFile reads a regular file, caps its size, and treats a link, a directory, a FIFO or a missing file as absent', () => {
  const d = tmp('s5-grade-read-');
  writeFileSync(join(d, 'a.txt'), 'hello\n');
  writeFileSync(join(d, 'secret'), 'outside\n');
  symlinkSync(join(d, 'secret'), join(d, 'link'));
  mkdirSync(join(d, 'dir'));
  assert.equal(spawnSync('mkfifo', [join(d, 'fifo')]).status, 0);
  assert.equal(readResultFile(join(d, 'a.txt')), 'hello\n');
  assert.equal(readResultFile(join(d, 'a.txt'), 3), 'hel', 'the cap cuts the read');
  assert.equal(readResultFile(join(d, 'link')), null, 'a symlink is never followed');
  assert.equal(readResultFile(join(d, 'dir')), null);
  assert.equal(readResultFile(join(d, 'fifo')), null, 'a FIFO does not hang the read');
  assert.equal(readResultFile(join(d, 'missing')), null);
  writeFileSync(join(d, 'empty'), '');
  assert.equal(readResultFile(join(d, 'empty')), '', 'an empty file is present, not absent');
});

// =====================================================================================
// graftScript: text
// =====================================================================================

const idx = (text, needle, from = 0) => {
  const i = text.indexOf(needle, from);
  assert.notEqual(i, -1, `${JSON.stringify(needle)} not found in:\n${text}`);
  return i;
};

t('graftScript removes each hidden entry without following links, repairs every parent, then copies', () => {
  const script = graftScript(manifestOf({ hidden: { files: ['tests/a.rs', 'tests/deep/b.rs'], extra: ['x/c.rs'] } }));
  for (const rel of ['tests/a.rs', 'tests/deep/b.rs', 'x/c.rs']) {
    const rm = idx(script, `rm -rf -- '/work/${rel}'`);
    const cp = idx(script, `cp -- '/hidden/${rel}' '/work/${rel}'`);
    assert.ok(rm < cp, `${rel}: the target is removed before the copy`);
  }
  // Every parent component is checked for being a symlink or a non-directory, removed, and made a directory.
  for (const dir of ['tests', 'tests/deep', 'x']) {
    const link = idx(script, `-L '/work/${dir}'`);
    idx(script, `mkdir -- '/work/${dir}'`, link);
  }
  assert.ok(!script.includes("mkdir -- '/work/tests/a.rs'"), 'the file itself is not made a directory');
  assert.ok(idx(script, "mkdir -- '/work/tests/deep'") < idx(script, "rm -rf -- '/work/tests/deep/b.rs'"), 'the parents are repaired BEFORE anything is removed through them');
  assert.match(script, /exit 1/, 'a failed step stops the graft');
  assert.match(script.trimEnd(), /exit 0$/);
});

t('graftScript names hidden files from files and extra once each, and honours the roots', () => {
  const script = graftScript(manifestOf({ hidden: { files: ['a.rs', 'b.rs'], extra: ['b.rs', 'c.rs'] } }), { work: '/w', hidden: '/h' });
  assert.equal(script.split("cp -- '/h/b.rs' '/w/b.rs'").length - 1, 1);
  for (const rel of ['a.rs', 'b.rs', 'c.rs']) idx(script, `cp -- '/h/${rel}' '/w/${rel}'`);
  assert.ok(!script.includes('/work') && !script.includes('/hidden'));
});

t('graftScript quotes a hostile path and a hostile line; neither can end its quote', () => {
  const rel = 'tests/it\'s a $(id) `id` "q";x.rs';
  const line = '#[path = "it\'s $(id) %s.rs"] mod hostile_mod;';
  const script = graftScript(manifestOf({ hidden: { files: [rel], extra: [], graftLines: [{ file: 'src/lib.rs', line }] } }));
  const q = (s) => `'${s.replaceAll("'", "'\\''")}'`;
  idx(script, `rm -rf -- ${q(`/work/${rel}`)}`);
  idx(script, `printf '%s\\n' ${q(line)} >>`);
  idx(script, 'mod[[:space:]]+hostile_mod[[:space:]]*[;{]');
});

t('graftScript refuses a graftLines line that is not exactly one module declaration', () => {
  const bad = ['fn main() {}', 'mod a; mod b;', 'mod a; // comment', 'use crate::a;', 'mod a {}', 'mod 1a;', 'mod a', 'pub mod a; \nmod b;', '', 'mod a;;', 'extern crate x;'];
  for (const line of bad) {
    assert.throws(() => moduleOf(line), TypeError, JSON.stringify(line));
    assert.throws(() => graftScript(manifestOf({ hidden: { files: ['tests/a.rs'], graftLines: [{ file: 'src/lib.rs', line }] } })), TypeError, JSON.stringify(line));
  }
  const good = { 'mod a;': 'a', 'pub mod a_1;': 'a_1', 'pub(crate) mod _x;': '_x', 'pub(in crate::a) mod b;': 'b', '#[cfg(test)] mod t;': 't', '#[cfg(test)]#[allow(dead_code)] pub mod u;': 'u', 'mod   a  ;  ': 'a', '#[path = "x/y.rs"] mod z;': 'z' };
  for (const [line, name] of Object.entries(good)) assert.equal(moduleOf(line), name, JSON.stringify(line));
});

// =====================================================================================
// graftScript: run with sh on fixture directories
// =====================================================================================

function graftScene(files = {}, hiddenFiles = {}) {
  const dir = tmp('s5-grade-graft-');
  const scene = { dir, work: join(dir, 'work'), hidden: join(dir, 'hidden') };
  mkdirSync(scene.work);
  mkdirSync(scene.hidden);
  for (const [rel, c] of Object.entries(files)) put(scene.work, rel, c);
  for (const [rel, c] of Object.entries(hiddenFiles)) put(scene.hidden, rel, c);
  return scene;
}
function runGraft(scene, hidden, extra = {}) {
  const script = graftScript(manifestOf({ hidden: { files: hidden.files ?? [], extra: hidden.extra ?? [], graftLines: hidden.graftLines } }), { work: scene.work, hidden: scene.hidden, ...extra });
  return spawnSync('sh', ['-c', script], { cwd: scene.dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
}

t('graft overwrites the agent\'s edit to a hidden file, and puts a removed file and its removed directory back', () => {
  const s = graftScene({ 'tests/a.rs': 'the agent\'s trivial version\n' }, { 'tests/a.rs': 'hidden A\n', 'tests/deep/er/b.rs': 'hidden B\n' });
  const r = runGraft(s, { files: ['tests/a.rs'], extra: ['tests/deep/er/b.rs'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(s.work, 'tests/a.rs'), 'utf8'), 'hidden A\n');
  assert.equal(readFileSync(join(s.work, 'tests/deep/er/b.rs'), 'utf8'), 'hidden B\n');
});

t('graft removes a symlink at the target instead of writing through it', () => {
  const s = graftScene({}, { 'tests/a.rs': 'hidden A\n' });
  put(s.dir, 'outside.txt', 'untouched\n');
  mkdirSync(join(s.work, 'tests'));
  symlinkSync(join(s.dir, 'outside.txt'), join(s.work, 'tests/a.rs'));
  const r = runGraft(s, { files: ['tests/a.rs'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(s.dir, 'outside.txt'), 'utf8'), 'untouched\n', 'the file the link pointed at is unchanged');
  assert.equal(lstatSync(join(s.work, 'tests/a.rs')).isSymbolicLink(), false);
  assert.equal(readFileSync(join(s.work, 'tests/a.rs'), 'utf8'), 'hidden A\n');
});

t('graft replaces a symlinked PARENT directory with a real one: nothing is removed or written through the link', () => {
  const s = graftScene({}, { 'tests/a.rs': 'hidden A\n', 'tests/sub/b.rs': 'hidden B\n' });
  put(s.dir, 'escape/keep.txt', 'mine\n');
  put(s.dir, 'escape/a.rs', 'a file the agent hid behind its link\n');
  symlinkSync(join(s.dir, 'escape'), join(s.work, 'tests'));
  const r = runGraft(s, { files: ['tests/a.rs', 'tests/sub/b.rs'] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(join(s.dir, 'escape')).sort(), ['a.rs', 'keep.txt'], 'the directory behind the link gained nothing and lost nothing');
  assert.equal(readFileSync(join(s.dir, 'escape/a.rs'), 'utf8'), 'a file the agent hid behind its link\n');
  assert.equal(lstatSync(join(s.work, 'tests')).isDirectory(), true);
  assert.equal(readFileSync(join(s.work, 'tests/a.rs'), 'utf8'), 'hidden A\n');
  assert.equal(readFileSync(join(s.work, 'tests/sub/b.rs'), 'utf8'), 'hidden B\n');
});

t('graft through a dangling parent link creates nothing at the link\'s target', () => {
  const s = graftScene({}, { 'tests/a.rs': 'hidden A\n' });
  const target = join(s.dir, 'escape-missing', 'deeper');
  symlinkSync(target, join(s.work, 'tests'));
  const r = runGraft(s, { files: ['tests/a.rs'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(s.dir, 'escape-missing')), false, 'nothing was created behind the dangling link');
  assert.equal(readFileSync(join(s.work, 'tests/a.rs'), 'utf8'), 'hidden A\n');
});

t('graft replaces a parent that is a regular file with a directory', () => {
  const s = graftScene({ tests: 'not a directory\n' }, { 'tests/a.rs': 'hidden A\n' });
  const r = runGraft(s, { files: ['tests/a.rs'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(s.work, 'tests/a.rs'), 'utf8'), 'hidden A\n');
});

t('graft replaces a directory sitting where a hidden FILE belongs', () => {
  const s = graftScene({ 'tests/a.rs/inner.txt': 'x\n' }, { 'tests/a.rs': 'hidden A\n' });
  const r = runGraft(s, { files: ['tests/a.rs'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lstatSync(join(s.work, 'tests/a.rs')).isFile(), true);
  assert.equal(readFileSync(join(s.work, 'tests/a.rs'), 'utf8'), 'hidden A\n');
});

t('graft copes with names that need quoting and runs nothing from them', () => {
  const rels = ['tests/it\'s here.rs', 'tests/a b/$(touch canary1).rs', 'tests/`touch canary2`.rs', 'tests/*.rs', 'tests/-n.rs', 'tests/semi;colon.rs'];
  const s = graftScene({}, Object.fromEntries(rels.map((r) => [r, `body of ${r}\n`])));
  const r = runGraft(s, { files: rels });
  assert.equal(r.status, 0, r.stderr);
  for (const rel of rels) assert.equal(readFileSync(join(s.work, rel), 'utf8'), `body of ${rel}\n`, rel);
  assert.deepEqual(readdirSync(join(s.work, 'tests')).sort(), ['*.rs', '-n.rs', "it's here.rs", 'a b', 'semi;colon.rs', '`touch canary2`.rs'].sort());
  assert.equal(existsSync(join(s.dir, 'canary1')) || existsSync(join(s.dir, 'canary2')), false, 'no command substitution ran');
});

t('graft stops at the first failure: a missing hidden file fails the script and later files are not copied', () => {
  const s = graftScene({}, { 'b.rs': 'B\n' });
  const r = runGraft(s, { files: ['a.rs', 'b.rs'] });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(join(s.work, 'b.rs')), false);
});

t('graft fails, and does not copy NEXT TO the old entry, when the old entry cannot be removed', () => {
  if (process.getuid() === 0) return console.log('ok - (skipped as root: root can remove a read-only tree) # SKIP');
  const s = graftScene({ 'tests/a.rs/sub/inner.txt': 'x\n' }, { 'tests/a.rs': 'hidden A\n' });
  chmodSync(join(s.work, 'tests/a.rs/sub'), 0o555);
  try {
    const r = runGraft(s, { files: ['tests/a.rs'] });
    assert.notEqual(r.status, 0);
    assert.equal(lstatSync(join(s.work, 'tests/a.rs')).isDirectory(), true);
    assert.equal(existsSync(join(s.work, 'tests/a.rs/a.rs')), false, 'the hidden file was copied INTO the directory that could not be removed');
  } finally {
    chmodSync(join(s.work, 'tests/a.rs/sub'), 0o755);
  }
});

t('graftLines: a line is appended once, a second graft adds nothing, and a comment, an indented line or another name is not the declaration', () => {
  const s = graftScene({ 'src/lib.rs': 'pub fn a() {}' }, { 'tests/a.rs': 'A\n' });
  const lines = [{ file: 'src/lib.rs', line: 'mod hidden_support;' }];
  assert.equal(runGraft(s, { files: ['tests/a.rs'], graftLines: lines }).status, 0);
  assert.equal(readFileSync(join(s.work, 'src/lib.rs'), 'utf8'), 'pub fn a() {}\nmod hidden_support;\n', 'a missing final newline is repaired before the append');
  assert.equal(runGraft(s, { files: ['tests/a.rs'], graftLines: lines }).status, 0);
  assert.equal(runGraft(s, { files: ['tests/a.rs'], graftLines: lines }).status, 0);
  assert.equal(readFileSync(join(s.work, 'src/lib.rs'), 'utf8'), 'pub fn a() {}\nmod hidden_support;\n', 'three grafts, one line');

  const near = graftScene({ 'src/lib.rs': '// mod hidden_support;\n  mod hidden_support;\nxmod hidden_support;\nmod hidden_support2;\nmod hidden_supportx {\nmod other;\nmodule hidden_support;\nuse hidden_support;\n' }, { 'tests/a.rs': 'A\n' });
  assert.equal(runGraft(near, { files: ['tests/a.rs'], graftLines: lines }).status, 0);
  assert.equal(readFileSync(join(near.work, 'src/lib.rs'), 'utf8').split('\n').filter((l) => l === 'mod hidden_support;').length, 1, 'a comment, an indented line, another name and prose do not declare the module: the line is appended');
});

t('graftLines: a file that already declares the module (any visibility, attribute, form or line ending) is left byte for byte as it is', () => {
  const lines = [{ file: 'src/lib.rs', line: 'mod hidden_support;' }];
  const declared = {
    'file form': 'pub fn a() {}\nmod hidden_support;\n',
    'pub': 'pub mod hidden_support;\n',
    'pub(crate)': 'pub(crate) mod hidden_support;\n',
    'pub(in path)': 'pub(in crate::a) mod hidden_support;\n',
    'attribute on the line': '#[cfg(test)] mod hidden_support;\n',
    'rustfmt two-line form': '#[cfg(test)]\nmod hidden_support;\n',
    'two attributes': '#[cfg(test)]\n#[allow(dead_code)]\npub mod hidden_support;\n',
    'inline module': 'mod hidden_support {\n    pub fn x() {}\n}\n',
    'inline, brace glued': 'mod hidden_support{\n}\n',
    'space before the semicolon': 'mod hidden_support ;\n',
    'CRLF file': 'pub fn a() {}\r\nmod hidden_support;\r\n',
    'CRLF two-line form': '#[cfg(test)]\r\nmod hidden_support;\r\n',
    'trailing comment': 'mod hidden_support; // the hidden tests\n',
    'no final newline': 'mod hidden_support;',
  };
  for (const [what, content] of Object.entries(declared)) {
    const s = graftScene({ 'src/lib.rs': content }, { 'tests/a.rs': 'A\n' });
    assert.equal(runGraft(s, { files: ['tests/a.rs'], graftLines: lines }).status, 0, what);
    assert.equal(readFileSync(join(s.work, 'src/lib.rs'), 'utf8'), content, `${what}: nothing appended`);
  }
  // the attribute-carrying line itself is idempotent, and is skipped when the agent has the plain form
  const attr = [{ file: 'src/lib.rs', line: '#[cfg(test)] mod hidden_support;' }];
  const s = graftScene({ 'src/lib.rs': 'pub fn a() {}\n' }, { 'tests/a.rs': 'A\n' });
  for (let i = 0; i < 3; i++) assert.equal(runGraft(s, { files: ['tests/a.rs'], graftLines: attr }).status, 0);
  assert.equal(readFileSync(join(s.work, 'src/lib.rs'), 'utf8'), 'pub fn a() {}\n#[cfg(test)] mod hidden_support;\n');
  const plain = graftScene({ 'src/lib.rs': 'mod hidden_support;\n' }, { 'tests/a.rs': 'A\n' });
  assert.equal(runGraft(plain, { files: ['tests/a.rs'], graftLines: attr }).status, 0);
  assert.equal(readFileSync(join(plain.work, 'src/lib.rs'), 'utf8'), 'mod hidden_support;\n');
});

t('graftLines: two modules in one file, a hostile attribute kept verbatim, and an absent file or directory is created', () => {
  const s = graftScene({ 'src/lib.rs': 'x\n' }, { 'tests/a.rs': 'A\n' });
  const lines = [
    { file: 'src/lib.rs', line: 'mod first;' },
    { file: 'src/lib.rs', line: '#[path = "it\'s $HOME `id` %s \\t.rs"] pub mod second;' },
    { file: 'gen/new/mod.rs', line: 'pub mod hidden;' },
  ];
  assert.equal(runGraft(s, { files: ['tests/a.rs'], graftLines: lines }).status, 0);
  assert.equal(readFileSync(join(s.work, 'src/lib.rs'), 'utf8'), 'x\nmod first;\n#[path = "it\'s $HOME `id` %s \\t.rs"] pub mod second;\n');
  assert.equal(readFileSync(join(s.work, 'gen/new/mod.rs'), 'utf8'), 'pub mod hidden;\n');
  assert.equal(runGraft(s, { files: ['tests/a.rs'], graftLines: lines }).status, 0);
  assert.equal(readFileSync(join(s.work, 'src/lib.rs'), 'utf8'), 'x\nmod first;\n#[path = "it\'s $HOME `id` %s \\t.rs"] pub mod second;\n', 'idempotent for hostile text too');
});

t('graftLines: a graftLines file behind a symlinked parent is repaired too, and nothing is appended through the link', () => {
  const s = graftScene({}, { 'tests/a.rs': 'A\n' });
  put(s.dir, 'escape/keep.txt', 'mine\n');
  symlinkSync(join(s.dir, 'escape'), join(s.work, 'src'));
  assert.equal(runGraft(s, { files: ['tests/a.rs'], graftLines: [{ file: 'src/lib.rs', line: 'mod h;' }] }).status, 0);
  assert.deepEqual(readdirSync(join(s.dir, 'escape')), ['keep.txt'], 'the line was not appended through the link');
  assert.equal(readFileSync(join(s.work, 'src/lib.rs'), 'utf8'), 'mod h;\n');
});

// =====================================================================================
// driverScript: text, then run with sh on fixture directories
// =====================================================================================

const GIT_TEXT = "git -c safe.directory='*' -c core.fsmonitor=false";

t('driverScript: the diff stats come before the graft, the graft before the build, the build before the tests', () => {
  const script = driverScript(manifestOf());
  const add = idx(script, `timeout -k 10 120 ${GIT_TEXT} add -A`);
  const diff = idx(script, `timeout -k 10 120 ${GIT_TEXT} diff --cached --shortstat '${BASE}'`);
  const graftStart = idx(script, "timeout -k 10 120 sh -s > '/results/graft.log' 2>&1 <<'S5_GRAFT_EOF'");
  const graft = idx(script, "rm -rf -- '/work/tests/hidden.rs'");
  const graftEnd = idx(script, '\nS5_GRAFT_EOF\n');
  const build = idx(script, "'cargo' 'test' '--no-run' '--no-default-features'");
  const f2p = idx(script, "'hidden'");
  const p2p = idx(script, "'--no-default-features' < /dev/null", f2p);
  assert.ok(add < diff && diff < graftStart && graftStart < graft && graft < graftEnd && graftEnd < build && build < f2p && f2p < p2p, 'order');
  assert.match(script, /timeout -k 10 600 'cargo'/, 'the build limit');
  assert.match(script, /timeout -k 10 300 'cargo'/, 'the test limit');
  assert.ok(!script.includes('HEAD'), 'the diff base is the task commit, never HEAD');
});

t('driverScript takes the build and test limits from its options; the diff and the graft always run under the fixed 120 s, whatever the test limit', () => {
  const lineIn = (script, needle) => {
    const hits = script.split('\n').filter((l) => l.includes(needle));
    assert.equal(hits.length, 1, `${needle} is on one line`);
    return hits[0];
  };
  for (const testSec of [9, 400]) {
    const script = driverScript(manifestOf(), { buildSec: 7, testSec });
    assert.match(lineIn(script, '/results/build.out'), /^ *timeout -k 10 7 'cargo'/);
    assert.match(lineIn(script, '/results/f2p.out'), new RegExp(`^ *timeout -k 10 ${testSec} 'cargo'`));
    assert.match(lineIn(script, '/results/p2p.out'), new RegExp(`^ *timeout -k 10 ${testSec} 'cargo'`));
    assert.match(lineIn(script, '/results/graft.log'), /^timeout -k 10 120 sh -s /, `graft, test limit ${testSec}`);
    assert.match(lineIn(script, '/results/diff.txt'), /^timeout -k 10 120 git .*add -A .* && timeout -k 10 120 git .*diff --cached/, `diff, test limit ${testSec}`);
    assert.equal(script.split('timeout -k 10 7 ').length - 1, 1, 'nothing else runs under the build limit');
    assert.equal(script.split('timeout -k 10 120 ').length - 1, 3, 'add, diff and graft, and nothing else, run under 120 s');
  }
  // the seam the host-run tests use
  const quick = driverScript(manifestOf(), { buildSec: 7, testSec: 9, prepSec: 5 });
  assert.equal(quick.split('timeout -k 10 5 ').length - 1, 3);
  assert.ok(!quick.includes('timeout -k 10 120 '));
});

t('driverScript refuses a manifest without a 40-hex baseCommit', () => {
  for (const baseCommit of [undefined, '', 'HEAD', 'b'.repeat(39), 'B'.repeat(40), `${'b'.repeat(40)}\n`, 7]) {
    assert.throws(() => driverScript({ ...manifestOf(), baseCommit }), TypeError, JSON.stringify(baseCommit));
  }
});

function driverScene(workFiles = {}, hiddenFiles = {}) {
  const dir = tmp('s5-grade-driver-');
  const s = { dir, work: join(dir, 'work'), hidden: join(dir, 'hidden'), results: join(dir, 'results') };
  for (const d of [s.work, s.hidden, s.results]) mkdirSync(d);
  for (const [rel, c] of Object.entries(workFiles)) put(s.work, rel, c);
  for (const [rel, c] of Object.entries(hiddenFiles)) put(s.hidden, rel, c);
  return s;
}
const IDENT = ['-c', 'user.name=s5', '-c', 'user.email=s5@localhost'];
const gitOk = (dir, args) => {
  const r = git(dir, args);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.toString().trim();
};
// Make the directory a repository with ONE commit and return that commit's id (the task's baseCommit).
function commitAll(dir) {
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], [...IDENT, 'commit', '-q', '--no-verify', '--no-gpg-sign', '-m', 'task']]) gitOk(dir, args);
  return gitOk(dir, ['rev-parse', 'HEAD']);
}
// What an agent does when it commits its own work: HEAD moves.
function agentCommits(dir) {
  gitOk(dir, ['add', '-A']);
  gitOk(dir, [...IDENT, 'commit', '-q', '--no-verify', '--no-gpg-sign', '-m', 'the agent\'s own commit']);
  return gitOk(dir, ['rev-parse', 'HEAD']);
}

function runDriver(s, manifest, opts = {}) {
  const script = driverScript(manifest, { work: s.work, hidden: s.hidden, results: s.results, ...opts.driver });
  const env = { PATH: opts.path ?? process.env.PATH, HOME: s.dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  return spawnSync('sh', ['-c', script], { cwd: s.dir, encoding: 'utf8', env, input: opts.input ?? '', timeout: 60_000 });
}
const res = (s, name) => readOr(join(s.results, name));
const sh = (script) => ['sh', '-c', script];

const TRIVIAL = { buildCommand: ['true'], f2p: { command: ['true'], names: ['x'] }, p2p: { command: ['true'], names: [] } };

t('the diff stats are taken BEFORE the hidden tests are grafted, new files included', () => {
  const s = driverScene({ 'src/lib.rs': 'a\n' }, { 'tests/h.rs': '1\n2\n3\n4\n5\n' });
  const baseCommit = commitAll(s.work);
  put(s.work, 'src/lib.rs', 'a\nb\n');
  put(s.work, 'src/new.rs', 'n1\nn2\n');
  const m = { ...manifestOf({ hidden: { files: ['tests/h.rs'] }, ...TRIVIAL }), baseCommit };
  const r = runDriver(s, m);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(res(s, 'diff.status').trim(), '0');
  assert.deepEqual(parseShortstat(res(s, 'diff.txt')), { files: 2, insertions: 3, deletions: 0 }, 'the grafted tests/h.rs (5 lines) is not in the stats');
  assert.equal(readFileSync(join(s.work, 'tests/h.rs'), 'utf8'), '1\n2\n3\n4\n5\n', 'and it was grafted afterwards');
});

t('an agent that COMMITS its change still shows its real stats: the diff is against the task commit, not HEAD', () => {
  const s = driverScene({ 'src/lib.rs': 'a\n' }, { 'tests/h.rs': 'h\n' });
  const baseCommit = commitAll(s.work);
  put(s.work, 'src/lib.rs', 'a\nb\n');
  put(s.work, 'src/new.rs', 'n1\nn2\n');
  const head = agentCommits(s.work);
  assert.notEqual(head, baseCommit);
  const hiddenDef = { hidden: { files: ['tests/h.rs'] }, ...TRIVIAL };
  const again = driverScene({}, { 'tests/h.rs': 'h\n' });
  cpSync(s.work, again.work, { recursive: true });
  assert.equal(runDriver(s, { ...manifestOf(hiddenDef), baseCommit }).status, 0);
  assert.equal(res(s, 'diff.status').trim(), '0');
  assert.deepEqual(parseShortstat(res(s, 'diff.txt')), { files: 2, insertions: 3, deletions: 0 }, 'the committed change is counted');

  // the same tree measured against HEAD (what the old driver did) reads zero
  assert.equal(runDriver(again, { ...manifestOf(hiddenDef), baseCommit: head }).status, 0);
  assert.deepEqual(parseShortstat(res(again, 'diff.txt')), { files: 0, insertions: 0, deletions: 0 }, 'against HEAD the committed work is invisible');
});

t('a base commit git cannot resolve fails only the diff step: the status is non-zero and the grade goes on', () => {
  const s = driverScene({ 'src/lib.rs': 'a\n' }, { 'tests/h.rs': 'h\n' });
  commitAll(s.work);
  put(s.work, 'src/lib.rs', 'a\nb\n');
  assert.equal(runDriver(s, { ...manifestOf({ hidden: { files: ['tests/h.rs'] }, ...TRIVIAL }), baseCommit: 'f'.repeat(40) }).status, 0);
  assert.notEqual(res(s, 'diff.status').trim(), '0');
  assert.equal(res(s, 'graft.status').trim(), '0');
  assert.equal(res(s, 'build.status').trim(), '0');
  assert.ok(res(s, 'done') !== null);
});

t('git in the driver runs with core.fsmonitor=false: a hook in the agent\'s .git/config does not run', () => {
  const s = driverScene({ 'src/lib.rs': 'a\n' }, { 'tests/h.rs': 'h\n' });
  const baseCommit = commitAll(s.work);
  const marker = join(s.dir, 'fsmonitor-ran');
  const hook = join(s.dir, 'hook.sh');
  writeFileSync(hook, `#!/bin/sh\necho ran >> ${shq(marker)}\nprintf '\\0'\n`);
  chmodSync(hook, 0o755);
  gitOk(s.work, ['config', 'core.fsmonitor', hook]);
  put(s.work, 'src/lib.rs', 'a\nchanged\n');
  // control: without the override git runs the hook on `git add -A`
  spawnSync('git', ['-C', s.work, '-c', 'safe.directory=*', 'add', '-A'], { env: { PATH: process.env.PATH, HOME: s.dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.ok(existsSync(marker), 'control: the hook is live when nothing overrides it');
  writeFileSync(marker, '');
  put(s.work, 'src/lib.rs', 'a\nchanged again\n');
  assert.equal(runDriver(s, { ...manifestOf({ hidden: { files: ['tests/h.rs'] }, ...TRIVIAL }), baseCommit }).status, 0);
  assert.equal(readFileSync(marker, 'utf8'), '', 'the driver\'s git did not run the hook');
  assert.equal(res(s, 'diff.status').trim(), '0');
});

t('a diff that hangs is cut off with status 124 and the grade goes on', () => {
  const s = driverScene({ 'src/lib.rs': 'a\n' }, { 'tests/h.rs': 'h\n' });
  const shim = tmp('s5-grade-hanggit-');
  writeFileSync(join(shim, 'git'), '#!/bin/sh\nsleep 30\n');
  chmodSync(join(shim, 'git'), 0o755);
  const started = Date.now();
  runDriver(s, manifestOf({ hidden: { files: ['tests/h.rs'] }, ...TRIVIAL }), { path: `${shim}${delimiter}${process.env.PATH}`, driver: { prepSec: 1 } });
  assert.equal(res(s, 'diff.status').trim(), '124');
  assert.equal(res(s, 'graft.status').trim(), '0');
  assert.equal(res(s, 'build.status').trim(), '0');
  assert.ok(Date.now() - started < 20_000);
});

t('a graft that hangs (a FIFO where a graftLines file belongs) is cut off with status 124: the build does not run', () => {
  const s = driverScene({}, { 'tests/h.rs': 'h\n' });
  mkdirSync(join(s.work, 'src'));
  assert.equal(spawnSync('mkfifo', [join(s.work, 'src/lib.rs')]).status, 0);
  const m = manifestOf({ hidden: { files: ['tests/h.rs'], graftLines: [{ file: 'src/lib.rs', line: 'mod hidden_support;' }] }, ...TRIVIAL });
  const started = Date.now();
  runDriver(s, m, { driver: { prepSec: 1 } });
  assert.equal(res(s, 'graft.status').trim(), '124');
  assert.equal(res(s, 'build.status'), null);
  assert.ok(res(s, 'done') !== null);
  assert.ok(Date.now() - started < 20_000);
});

t('the driver records each step\'s status and output, merges stderr, and writes done last', () => {
  const s = driverScene({}, { 'tests/h.rs': 'h\n' });
  const doneFile = join(s.results, 'done');
  const m = manifestOf({
    hidden: { files: ['tests/h.rs'] },
    buildCommand: sh('echo built; echo build-err >&2; exit 0'),
    f2p: { command: sh('echo f2p-out; exit 3'), names: ['x'] },
    // exits 0 only while "done" is not yet written: the driver writes it last
    p2p: { command: ['sh', '-c', 'echo p2p-err >&2; test ! -e "$0"', doneFile], names: [] },
  });
  const r = runDriver(s, m);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(res(s, 'graft.status').trim(), '0');
  assert.equal(res(s, 'build.status').trim(), '0');
  assert.match(res(s, 'build.out'), /^built\nbuild-err\n$/);
  assert.equal(res(s, 'f2p.status').trim(), '3');
  assert.equal(res(s, 'f2p.out'), 'f2p-out\n');
  assert.equal(res(s, 'p2p.status').trim(), '0', '"done" did not exist while the last step ran');
  assert.equal(res(s, 'p2p.out'), 'p2p-err\n');
  assert.ok(res(s, 'done') !== null);
  assert.notEqual(res(s, 'diff.status').trim(), '0', 'a work directory that is not a repository only loses the diff stats');
});

t('a failed build skips both test steps; a failed graft skips the build and the tests', () => {
  const s = driverScene({}, { 'tests/h.rs': 'h\n' });
  const base = { hidden: { files: ['tests/h.rs'] }, f2p: { command: sh('echo ran'), names: ['x'] }, p2p: { command: sh('echo ran'), names: [] } };
  runDriver(s, manifestOf({ ...base, buildCommand: sh('exit 2') }));
  assert.equal(res(s, 'build.status').trim(), '2');
  assert.equal(res(s, 'f2p.status'), null);
  assert.equal(res(s, 'p2p.status'), null);
  assert.ok(res(s, 'done') !== null, 'done is written even so');

  const g = driverScene({}, {});
  runDriver(g, manifestOf({ ...base, buildCommand: sh('echo built') }));
  assert.equal(res(g, 'graft.status').trim(), '1', 'the hidden file is missing');
  assert.equal(res(g, 'build.status'), null);
  assert.equal(res(g, 'f2p.status'), null);
  assert.ok(res(g, 'done') !== null);
});

t('a build over its limit is cut off with status 124 and the tests are not run', () => {
  const s = driverScene({}, { 'tests/h.rs': 'h\n' });
  const m = manifestOf({ hidden: { files: ['tests/h.rs'] }, buildCommand: ['sleep', '30'], f2p: { command: sh('echo ran'), names: ['x'] }, p2p: { command: sh('echo ran'), names: [] } });
  const started = Date.now();
  runDriver(s, m, { driver: { buildSec: 1 } });
  assert.equal(res(s, 'build.status').trim(), '124');
  assert.equal(res(s, 'f2p.status'), null);
  assert.ok(Date.now() - started < 15_000);
});

t('a test step over its limit is cut off with status 124; the other test step still runs', () => {
  const s = driverScene({}, { 'tests/h.rs': 'h\n' });
  const m = manifestOf({ hidden: { files: ['tests/h.rs'] }, buildCommand: ['true'], f2p: { command: ['sleep', '30'], names: ['x'] }, p2p: { command: sh('echo p2p ran'), names: [] } });
  runDriver(s, m, { driver: { testSec: 1 } });
  assert.equal(res(s, 'f2p.status').trim(), '124');
  assert.equal(res(s, 'p2p.out'), 'p2p ran\n');
});

t('commands run in the work directory, with no stdin, and each argv word arrives verbatim', () => {
  const s = driverScene({}, { 'tests/h.rs': 'h\n' });
  const weird = ['a b', "it's", '$HOME', '`id`', 'a\nb', '', '*', ';', '"q"', '\\x', '-n', '$(touch canary)', '--', "'"];
  const argsOut = join(s.dir, 'args.bin');
  const m = manifestOf({
    hidden: { files: ['tests/h.rs'] },
    buildCommand: ['sh', '-c', `printf '%s\\0' "$@" > '${argsOut}'; pwd > '${join(s.dir, 'cwd.txt')}'; if read x; then echo got > '${join(s.dir, 'stdin.txt')}'; else echo eof > '${join(s.dir, 'stdin.txt')}'; fi`, 'sh-name', ...weird],
    f2p: { command: ['true'], names: ['x'] },
    p2p: { command: ['true'], names: [] },
  });
  const r = runDriver(s, m, { input: 'data typed at the keyboard\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(argsOut, 'utf8').split('\0').slice(0, -1), weird);
  assert.equal(existsSync(join(s.dir, 'canary')), false);
  assert.equal(readFileSync(join(s.dir, 'cwd.txt'), 'utf8').trim(), s.work);
  assert.equal(readFileSync(join(s.dir, 'stdin.txt'), 'utf8').trim(), 'eof');
});

// =====================================================================================
// gradeTree against a fake docker (reflink needs btrfs: the test directories are on the work filesystem)
// =====================================================================================

const WORK = join(homedir(), 'work', 'claude', 's5-work');
const TMP_BASE = join(WORK, 'tmp-tests');
const fsType = (p) => spawnSync('stat', ['-f', '-c', '%T', p], { encoding: 'utf8' }).stdout.trim();
const NO_REFLINK_HERE = !existsSync(WORK) ? `${WORK} does not exist` : !['btrfs', 'xfs'].includes(fsType(WORK)) ? `${WORK} is on ${fsType(WORK)}, which cannot reflink` : '';
// A skip is printed as a skip, never as a pass.
async function taIf(name, skipReason, fn) {
  if (skipReason) console.log(`ok - ${name} # SKIP ${skipReason}`);
  else await ta(name, fn);
}

// A wrapper that exports the fake's two control variables (dockerRun hands docker a whitelisted
// environment, so a test cannot set them any other way) and execs fixtures/fake-docker.mjs.
function fakeDocker(config = {}) {
  const dir = tmp('s5-grade-fake-');
  const log = join(dir, 'log.jsonl');
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify(config));
  const bin = join(dir, 'docker');
  writeFileSync(bin, `#!/bin/sh\nexport FAKE_DOCKER_LOG=${shq(log)}\nexport FAKE_DOCKER_CONFIG=${shq(cfg)}\nexec ${shq(process.execPath)} ${shq(FAKE)} "$@"\n`);
  chmodSync(bin, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { bin, dir, calls };
}
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const OURS_ID = 'ab'.repeat(32);
const ours = (name, over = {}) => ({ id: OURS_ID, name, labels: { s5: '1', 's5.run': name }, ...over });
const OK_RESULTS = {
  'diff.status': '0\n',
  'diff.txt': ' 2 files changed, 3 insertions(+), 1 deletion(-)\n',
  'graft.status': '0\n',
  'build.status': '0\n',
  'build.out': '    Finished `test` profile\n',
  'f2p.status': '0\n',
  'f2p.out': 'running 1 test\ntest hidden::it_works ... ok\n',
  'p2p.status': '0\n',
  'p2p.out': 'running 1 test\ntest existing::stays ... ok\n',
  done: 'done\n',
};
// OK_RESULTS with some files replaced; a null value removes the file.
const results = (over = {}) => Object.fromEntries(Object.entries({ ...OK_RESULTS, ...over }).filter(([, v]) => v !== null));

function makeScene(over = {}) {
  const dir = tmp('grade-', TMP_BASE);
  const workRoot = join(dir, 'work-root');
  const manifest = manifestOf(over);
  const hidden = join(workRoot, 'tasks', manifest.id, 'hidden');
  for (const rel of [...manifest.def.hidden.files, ...(manifest.def.hidden.extra ?? [])]) put(hidden, rel, `hidden ${rel}\n`);
  const agent = join(dir, 'agent');
  put(agent, 'src/lib.rs', 'pub fn a() {}\n');
  put(agent, 'tests/old.rs', 'the agent\'s test\n');
  put(agent, '.gitattributes', '* filter=evil\n');
  put(agent, '.git/config', '[filter "evil"]\n\tclean = touch /tmp/s5-grade-should-never-exist\n');
  put(agent, '.git/HEAD', 'ref: refs/heads/main\n');
  symlinkSync('src/lib.rs', join(agent, 'link-to-lib'));
  return { dir, workRoot, manifest, hidden, agent };
}
// path, mode, mtime and content (or link target) of everything under root, directories included.
function snapshot(root) {
  const out = [];
  const rec = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      const st = lstatSync(join(root, r));
      const body = st.isSymbolicLink() ? `-> ${readlinkSync(join(root, r))}` : st.isDirectory() ? 'dir' : sha256(readFileSync(join(root, r)));
      out.push(`${r} ${st.mode} ${st.mtimeMs} ${body}`);
      if (st.isDirectory()) rec(r);
    }
  };
  rec('');
  return out;
}

// grade(scene, { results, config, opts, runId }) -> { r, f, name }. `config` is the fake docker's config
// (its `run` is merged over { results }); `opts` goes to gradeTree.
async function grade(scene, { results: files = OK_RESULTS, config = {}, opts = {}, runId = 'r1', image = 's5/codescout' } = {}) {
  const name = `s5-grade-${runId}`;
  const f = fakeDocker({ containers: [ours(name)], ...config, run: { results: files, ...(config.run ?? {}) } });
  const r = await gradeTree(scene.manifest, scene.agent, { workRoot: scene.workRoot, image, runId, dockerBin: f.bin, ...opts });
  return { r, f, name };
}
const runCall = (f) => f.calls().find((c) => c.argv[0] === 'run');
const flagValue = (argv, flag) => argv[argv.indexOf(flag) + 1];
const mountsOf = (argv) => argv.flatMap((a, i) => {
  if (argv[i - 1] !== '--mount') return [];
  const fields = a.split(',');
  return [{ source: fields.find((x) => x.startsWith('source=')).slice(7), target: fields.find((x) => x.startsWith('target=')).slice(7), readonly: fields.includes('readonly') }];
});
const mountAt = (argv, target) => mountsOf(argv).find((m) => m.target === target);
const gradesDir = (scene) => join(scene.workRoot, 'grades');
const noGrades = (scene) => !existsSync(gradesDir(scene)) || readdirSync(gradesDir(scene)).length === 0;

await taIf('gradeTree passes a run whose every name is ok, and asks docker for one container: network none, user agent, workdir /work, --pull=never', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const { r, f, name } = await grade(sc);
  assert.equal(r.infra, null);
  assert.equal(r.graft, 'ok');
  assert.equal(r.build, 'ok');
  assert.deepEqual(r.f2p, { passed: ['hidden::it_works'], failed: [], notRun: [] });
  assert.deepEqual(r.p2p, { passed: ['existing::stays'], failed: [], notRun: [] });
  assert.equal(r.pass, true);
  assert.deepEqual(r.diff, { files: 2, insertions: 3, deletions: 1 });
  assert.equal(r.detail, null);
  assert.equal(r.leftover, null);

  const runs = f.calls().filter((c) => c.argv[0] === 'run');
  assert.equal(runs.length, 1, 'one grade is ONE container');
  const { argv } = runs[0];
  assert.ok(argv.includes('--pull=never'));
  assert.equal(flagValue(argv, '--name'), name);
  assert.equal(flagValue(argv, '--network'), 'none');
  assert.equal(flagValue(argv, '--user'), 'agent');
  assert.equal(flagValue(argv, '--workdir'), '/work');
  assert.ok(argv.includes('s5.task=task-one'));
  const image = argv.indexOf('s5/codescout');
  assert.deepEqual(argv.slice(image + 1, image + 3), ['sh', '-c']);
  assert.equal(argv.length, image + 4, 'the driver script is the whole command');
  assert.ok(!argv.includes('--cpus') && !argv.includes('--memory'), 'no resource flags unless asked for');
});

await taIf('the mounts: hidden read-only, a private work copy, a private results directory, and no target or cargo home when there are none', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const { f } = await grade(sc);
  const { argv } = runCall(f);
  const mounts = mountsOf(argv);
  assert.deepEqual(mounts.map((m) => m.target).sort(), ['/hidden', '/results', '/work']);
  assert.deepEqual(mountAt(argv, '/hidden'), { source: join(sc.workRoot, 'tasks', 'task-one', 'hidden'), target: '/hidden', readonly: true });
  const work = mountAt(argv, '/work');
  assert.equal(work.readonly, false);
  assert.notEqual(work.source, sc.agent, 'the agent tree itself is never mounted');
  assert.ok(work.source.startsWith(`${gradesDir(sc)}/`), work.source);
  const resultsMount = mountAt(argv, '/results');
  assert.equal(resultsMount.readonly, false);
  assert.ok(resultsMount.source.startsWith(`${gradesDir(sc)}/`));
  assert.ok(!runCall(f).envNames.includes('CARGO_TARGET_DIR'));
});

await taIf('a cargo task gets a private rw copy of the warm target at /target (CARGO_TARGET_DIR) and the cargo home read-only at /cargo; other runners get neither', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const warm = join(sc.workRoot, 'tasks', 'task-one', 'target');
  put(warm, 'debug/marker', 'warm\n');
  const cargoHome = join(sc.workRoot, 'cargo-home');
  put(cargoHome, 'registry/x', 'crate\n');
  const before = [snapshot(warm), snapshot(cargoHome)];
  const { f } = await grade(sc, { config: { expectEnv: { CARGO_TARGET_DIR: '/target' } } });
  const { argv, envMatches } = runCall(f);
  assert.equal(envMatches.CARGO_TARGET_DIR, true);
  assert.ok(argv.includes('CARGO_TARGET_DIR'), 'passed as -e NAME');
  const target = mountAt(argv, '/target');
  assert.equal(target.readonly, false);
  assert.notEqual(target.source, warm, 'the warm target is copied, never mounted');
  assert.ok(target.source.startsWith(`${gradesDir(sc)}/`));
  assert.deepEqual(mountAt(argv, '/cargo'), { source: cargoHome, target: '/cargo', readonly: true });
  assert.deepEqual([snapshot(warm), snapshot(cargoHome)], before, 'neither was written');

  const node = makeScene({ testRunner: 'node' });
  put(join(node.workRoot, 'tasks', 'task-one', 'target'), 'x', 'x\n');
  put(join(node.workRoot, 'cargo-home'), 'x', 'x\n');
  const other = await grade(node, { image: 's5/plugins' });
  assert.deepEqual(mountsOf(runCall(other.f).argv).map((m) => m.target).sort(), ['/hidden', '/results', '/work']);
  assert.ok(!runCall(other.f).argv.includes('CARGO_TARGET_DIR'));
});

await taIf('cpus and memory reach docker when given', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const { f } = await grade(sc, { opts: { cpus: 2, memoryGb: 6 } });
  const { argv } = runCall(f);
  assert.equal(flagValue(argv, '--cpus'), '2');
  assert.equal(flagValue(argv, '--memory'), '6g');
});

await taIf('the step limits reach the script: build limit on the build, test limit on both test steps, the fixed 120 s on the diff and the graft', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const { f } = await grade(sc, { opts: { timeouts: { build: 7, test: 9 } } });
  const script = runCall(f).argv.at(-1);
  const lineWith = (needle) => script.split('\n').find((l) => l.includes(needle));
  assert.match(lineWith('/results/build.out'), /^ *timeout -k 10 7 'cargo'/);
  assert.match(lineWith('/results/f2p.out'), /^ *timeout -k 10 9 'cargo'/);
  assert.match(lineWith('/results/p2p.out'), /^ *timeout -k 10 9 'cargo'/);
  assert.match(lineWith('/results/graft.log'), /^timeout -k 10 120 sh -s /);
  assert.match(lineWith('/results/diff.txt'), /^timeout -k 10 120 git .*add -A .* && timeout -k 10 120 git .*diff --cached/);
  assert.equal(script.split('timeout -k 10 7 ').length - 1, 1);
  assert.equal(script.split('timeout -k 10 9 ').length - 1, 2);
  const defaults = runCall((await grade(makeScene(), { runId: 'r2' })).f).argv.at(-1);
  assert.match(defaults, /timeout -k 10 600 'cargo'/, 'the task def\'s own limits when none are given');
  assert.match(defaults, /timeout -k 10 300 'cargo'/);
  assert.match(defaults, /^timeout -k 10 120 sh -s /m, 'and 120 s for the graft however long the tests may run');
});

await taIf('the container limit is in seconds: 3 s is not 3 ms, and a 1.5 s run under it is not a timeout', NO_REFLINK_HERE, async () => {
  const { r } = await grade(makeScene(), { config: { run: { sleepMs: 1500 } }, opts: { timeouts: { container: 3 } } });
  assert.equal(r.infra, null);
  assert.equal(r.pass, true);
});

await taIf('the diff runs in the container before the graft; no host git runs; the agent tree is byte-identical afterwards', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const before = snapshot(sc.agent);
  const shimDir = tmp('s5-grade-gitshim-');
  const shimLog = join(shimDir, 'calls.log');
  writeFileSync(join(shimDir, 'git'), `#!/bin/sh\necho "$PWD $*" >> ${shq(shimLog)}\nexit 99\n`);
  chmodSync(join(shimDir, 'git'), 0o755);
  const { r, f } = await withEnv({ PATH: `${shimDir}${delimiter}${process.env.PATH}` }, () => grade(sc));
  assert.equal(r.pass, true);
  assert.equal(readOr(shimLog, ''), '', 'a git process ran on the host');
  assert.equal(existsSync('/tmp/s5-grade-should-never-exist'), false, 'the agent\'s filter driver did not run on the host');
  assert.deepEqual(snapshot(sc.agent), before, 'the agent tree is untouched');

  const script = runCall(f).argv.at(-1);
  const add = idx(script, `${GIT_TEXT} add -A`);
  const diff = idx(script, `${GIT_TEXT} diff --cached --shortstat '${BASE}'`);
  const graft = idx(script, "cp -- '/hidden/tests/hidden.rs'");
  assert.ok(add < diff && diff < graft, 'the diff stats are taken before the graft');
  assert.ok(!f.calls().some((c) => c.argv[0] === 'git'));
});

await taIf('the per-grade directory is removed after parsing, and kept (with its results) under S5_KEEP_GRADES=1', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const { r } = await withEnv({ S5_KEEP_GRADES: undefined }, () => grade(sc));
  assert.equal(r.kept, null);
  assert.ok(noGrades(sc), 'removed');

  const keep = makeScene();
  const kept = await withEnv({ S5_KEEP_GRADES: '1' }, () => grade(keep));
  assert.equal(kept.r.kept, join(gradesDir(keep), 'r1'));
  assert.ok(existsSync(join(kept.r.kept, 'work', 'src', 'lib.rs')));
  assert.equal(readFileSync(join(kept.r.kept, 'results', 'done'), 'utf8'), 'done\n');

  const other = makeScene();
  const notOne = await withEnv({ S5_KEEP_GRADES: 'yes' }, () => grade(other));
  assert.equal(notOne.r.kept, null, 'only "1" keeps a grade');
});

// ---- infrastructure state ----

const INFRA = [
  ['create_failed', () => ({ containers: [], run: { status: 125, stderr: 'docker: image not found (fake)\n' } }), {}],
  ['oom', (name) => ({ containers: [ours(name, { oomKilled: true })] }), {}],
  ['inspect_failed', () => ({ inspect: { status: 1 } }), {}],
  ['rm_failed', () => ({ rm: { status: 1 } }), {}],
  ['timeout', () => ({ run: { sleepMs: 8000 } }), { timeouts: { container: 1 } }],
];
for (const [infra, config, opts] of INFRA) {
  await taIf(`infra ${infra}: pass is false although every name is ok, and the caller is told to re-run`, NO_REFLINK_HERE, async () => {
    const sc = makeScene();
    const { r } = await grade(sc, { config: config('s5-grade-r1'), opts });
    assert.equal(r.infra, infra);
    assert.equal(r.pass, false);
    assert.equal(typeof r.detail, 'string');
    if (infra === 'create_failed') assert.match(r.detail, /image not found/);
    assert.ok(noGrades(sc));
  });
}

await taIf('infra: a container whose driver never wrote "done" is incomplete, not a model failure', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const { r } = await grade(sc, { results: results({ done: null }) });
  assert.equal(r.infra, 'incomplete');
  assert.equal(r.pass, false);
  const fine = await grade(makeScene(), { results: results() });
  assert.equal(fine.r.infra, null);
});

await taIf('infra is derived from the whole docker outcome: a clean container with a hit wall clock is a timeout even when the results look complete', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const { r } = await grade(sc, { config: { run: { sleepMs: 8000 } }, opts: { timeouts: { container: 1 } } });
  assert.equal(r.infra, 'timeout');
  assert.equal(r.pass, false);
  const slow = await grade(makeScene(), { config: { run: { sleepMs: 1500 } } });
  assert.equal(slow.r.infra, null, 'the default container limit is far above this');
  assert.equal(slow.r.pass, true);
});

// ---- the pass rule, end to end ----

const NAMES = { f2p: ['hidden::it_works'], p2p: ['existing::stays'] };
const NOT_PASSED = [
  ['an F2P name absent from the output', { 'f2p.out': 'test some::other ... ok\n' }, (r) => assert.deepEqual(r.f2p, { passed: [], failed: [], notRun: NAMES.f2p })],
  ['an F2P name reported ignored', { 'f2p.out': 'test hidden::it_works ... ignored\n' }, (r) => assert.deepEqual(r.f2p.notRun, NAMES.f2p)],
  ['an F2P name reported FAILED', { 'f2p.out': 'test hidden::it_works ... FAILED\n' }, (r) => assert.deepEqual(r.f2p.failed, NAMES.f2p)],
  ['an F2P name reported ok in one binary and FAILED in another', { 'f2p.out': 'test hidden::it_works ... ok\ntest hidden::it_works ... FAILED\n' }, (r) => assert.deepEqual(r.f2p.failed, NAMES.f2p)],
  ['a P2P name absent from the output', { 'p2p.out': 'running 0 tests\n' }, (r) => assert.deepEqual(r.p2p.notRun, NAMES.p2p)],
  ['a P2P name reported FAILED', { 'p2p.out': 'test existing::stays ... FAILED\n' }, (r) => assert.deepEqual(r.p2p.failed, NAMES.p2p)],
  ['a compile error in the F2P step: cargo ran no test, every name is absent', { 'f2p.out': fixture('cargo-compile-error.txt'), 'f2p.status': '101\n' }, (r) => assert.deepEqual(r.f2p.notRun, NAMES.f2p)],
  ['a compile error in the P2P step: cargo ran no test, every name is absent', { 'p2p.out': fixture('cargo-compile-error.txt'), 'p2p.status': '101\n' }, (r) => assert.deepEqual(r.p2p.notRun, NAMES.p2p)],
  ['an F2P name reported only inside a failed test\'s failure section', { 'f2p.out': 'running 1 test\ntest other ... FAILED\n\nfailures:\n\n---- other stdout ----\ntest hidden::it_works ... ok\n\nfailures:\n    other\n' }, (r) => assert.deepEqual(r.f2p.notRun, NAMES.f2p)],
  ['a graft that timed out (exit 124), although the build and tests say ok', { 'graft.status': '124\n' }, (r) => {
    assert.equal(r.graft, 'failed');
    assert.equal(r.build, 'not_run');
  }],
  ['an F2P step that never ran', { 'f2p.status': null, 'f2p.out': null }, (r) => assert.deepEqual(r.f2p.notRun, NAMES.f2p)],
  ['a P2P step that never ran', { 'p2p.status': null, 'p2p.out': null }, (r) => assert.deepEqual(r.p2p.notRun, NAMES.p2p)],
  ['a failed build, although every test output says ok', { 'build.status': '101\n' }, (r) => {
    assert.equal(r.build, 'failed');
    assert.deepEqual(r.f2p, { passed: [], failed: [], notRun: NAMES.f2p }, 'tests behind a failed build count as not run');
    assert.deepEqual(r.p2p, { passed: [], failed: [], notRun: NAMES.p2p });
  }],
  ['a build over its limit (exit 124)', { 'build.status': '124\n' }, (r) => assert.equal(r.build, 'timeout')],
  ['a build whose status file is missing', { 'build.status': null }, (r) => assert.equal(r.build, 'not_run')],
  ['a graft that failed, although the build and tests say ok', { 'graft.status': '1\n' }, (r) => {
    assert.equal(r.graft, 'failed');
    assert.equal(r.build, 'not_run', 'a build after a failed graft is not trusted');
  }],
];
for (const [what, over, check] of NOT_PASSED) {
  await taIf(`pass is false for ${what}`, NO_REFLINK_HERE, async () => {
    const { r } = await grade(makeScene(), { results: results(over) });
    assert.equal(r.infra, null, 'a model failure, not an infrastructure one');
    assert.equal(r.pass, false);
    check(r);
  });
}

await taIf('a P2P exit status does not matter when every P2P name is ok; an F2P name ok after a FAILED unlisted test passes', NO_REFLINK_HERE, async () => {
  const { r } = await grade(makeScene(), { results: results({ 'f2p.out': 'test unlisted ... FAILED\ntest hidden::it_works ... ok\n', 'f2p.status': '101\n', 'p2p.status': '101\n' }) });
  assert.equal(r.pass, true, 'the rule is about the listed names');
});

await taIf('sh runner: the exit status of each step decides, and an empty P2P list ignores the P2P status', NO_REFLINK_HERE, async () => {
  const sh = { testRunner: 'sh', f2p: { command: ['sh', 'tests/hidden.sh'], names: ['tests/hidden.sh'] }, p2p: { command: ['true'], names: [] }, hidden: { files: ['tests/hidden.sh'] } };
  const pass = await grade(makeScene(sh), { results: results({ 'f2p.out': 'FAIL: nothing\n', 'p2p.status': '1\n' }), image: 's5/plugins' });
  assert.equal(pass.r.pass, true);
  assert.deepEqual(pass.r.f2p, { passed: ['tests/hidden.sh'], failed: [], notRun: [] });
  const fail = await grade(makeScene(sh), { results: results({ 'f2p.out': 'PASS: all\n', 'f2p.status': '1\n' }), image: 's5/plugins' });
  assert.equal(fail.r.pass, false);
  assert.deepEqual(fail.r.f2p, { passed: [], failed: ['tests/hidden.sh'], notRun: [] });
  const timedOut = await grade(makeScene(sh), { results: results({ 'f2p.status': '124\n' }), image: 's5/plugins' });
  assert.equal(timedOut.r.pass, false);
  const p2pFails = await grade(makeScene({ ...sh, p2p: { command: ['sh', 'tests/old.sh'], names: ['tests/old.sh'] } }), { results: results({ 'p2p.status': '2\n' }), image: 's5/plugins' });
  assert.equal(p2pFails.r.pass, false);
});

await taIf('node runner: ok and not ok lines decide, a ReferenceError is a failure, a skipped name is not run', NO_REFLINK_HERE, async () => {
  const node = { testRunner: 'node', f2p: { command: ['node', 'tests/hidden.test.mjs'], names: ['adds'] }, p2p: { command: ['node', 'tests/old.test.mjs'], names: ['existing'] }, hidden: { files: ['tests/hidden.test.mjs'] } };
  const good = await grade(makeScene(node), { results: results({ 'f2p.out': 'ok - adds\n', 'p2p.out': 'ok - existing\n' }), image: 's5/plugins' });
  assert.equal(good.r.pass, true);
  const ref = await grade(makeScene(node), { results: results({ 'f2p.out': 'not ok - adds\nReferenceError: add is not defined\n    at x\n', 'f2p.status': '1\n', 'p2p.out': 'ok - existing\n' }), image: 's5/plugins' });
  assert.equal(ref.r.pass, false);
  assert.deepEqual(ref.r.f2p.failed, ['adds']);
  const skipped = await grade(makeScene(node), { results: results({ 'f2p.out': 'ok - adds # SKIP later\n', 'p2p.out': 'ok - existing\n' }), image: 's5/plugins' });
  assert.equal(skipped.r.pass, false);
  assert.deepEqual(skipped.r.f2p.notRun, ['adds']);
});

await taIf('nonAssertion (R32): the listed node names that failed by something other than an assertion, F2P then P2P; [] for every other outcome', NO_REFLINK_HERE, async () => {
  const node = {
    testRunner: 'node',
    f2p: { command: ['node', 'tests/hidden.test.mjs'], names: ['adds', 'subtracts', 'skipped'] },
    p2p: { command: ['node', 'tests/old.test.mjs'], names: ['existing', 'old one'] },
    hidden: { files: ['tests/hidden.test.mjs'] },
  };
  const f2pOut = 'not ok - adds\nReferenceError: add is not defined\n    at x\nnot ok - subtracts\nAssertionError [ERR_ASSERTION]: 1 !== 2\n    at y\n'
    + 'not ok - unlisted\nReferenceError: z is not defined\n    at z\nok - skipped # SKIP later\n';
  const p2pOut = 'ok - existing\nnot ok - old one\nTypeError: cannot read\n    at w\n';
  const mixed = await grade(makeScene(node), { results: results({ 'f2p.out': f2pOut, 'f2p.status': '1\n', 'p2p.out': p2pOut, 'p2p.status': '1\n' }), image: 's5/plugins' });
  assert.deepEqual(mixed.r.nonAssertion, ['adds', 'old one'], 'the ReferenceError in F2P, then the TypeError in P2P; not the assertion, not the unlisted name, not the skipped one');
  assert.deepEqual(mixed.r.f2p.failed, ['adds', 'subtracts']);
  assert.deepEqual(mixed.r.f2p.notRun, ['skipped']);

  const behaviour = await grade(makeScene(node), { results: results({ 'f2p.out': 'not ok - adds\nAssertionError [ERR_ASSERTION]: no\n    at y\nok - subtracts\nok - skipped\n', 'p2p.out': 'ok - existing\nok - old one\n' }), image: 's5/plugins' });
  assert.deepEqual(behaviour.r.nonAssertion, [], 'an assertion is a behaviour failure');

  const both = await grade(makeScene({ ...node, p2p: { command: node.p2p.command, names: ['adds'] } }), { results: results({ 'f2p.out': 'not ok - adds\nReferenceError: q\n', 'p2p.out': 'not ok - adds\nReferenceError: q\n' }), image: 's5/plugins' });
  assert.deepEqual(both.r.nonAssertion, ['adds'], 'a name listed in both phases is named once');

  const noBuild = await grade(makeScene(node), { results: results({ 'build.status': '1\n', 'f2p.out': f2pOut, 'p2p.out': p2pOut }), image: 's5/plugins' });
  assert.equal(noBuild.r.build, 'failed');
  assert.deepEqual(noBuild.r.nonAssertion, [], 'no test step ran: nothing failed by any reason');

  const cargo = await grade(makeScene(), { results: results({ 'f2p.out': 'running 1 test\ntest hidden::it_works ... FAILED\n\nfailures:\n\n---- hidden::it_works stdout ----\nthread panicked at src/lib.rs:1:1:\nboom\n', 'f2p.status': '101\n' }) });
  assert.deepEqual(cargo.r.f2p.failed, ['hidden::it_works']);
  assert.deepEqual(cargo.r.nonAssertion, [], 'cargo has no classifier: a panic is a behaviour failure');

  const sh = { testRunner: 'sh', f2p: { command: ['sh', 'tests/hidden.sh'], names: ['tests/hidden.sh'] }, p2p: { command: ['true'], names: [] }, hidden: { files: ['tests/hidden.sh'] } };
  const shRun = await grade(makeScene(sh), { results: results({ 'f2p.out': 'not ok - tests/hidden.sh\nReferenceError: x\n', 'f2p.status': '1\n' }), image: 's5/plugins' });
  assert.deepEqual(shRun.r.f2p.failed, ['tests/hidden.sh']);
  assert.deepEqual(shRun.r.nonAssertion, [], 'sh cannot tell');

  const incomplete = await grade(makeScene(node), { results: results({ done: null, 'f2p.out': f2pOut, 'p2p.out': p2pOut }), image: 's5/plugins' });
  assert.equal(incomplete.r.infra, 'incomplete');
  assert.ok(Array.isArray(incomplete.r.nonAssertion), 'the field is always an array');
});

await taIf('a result file left as a symlink is never followed: the names behind it are not run', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const secret = join(sc.dir, 'forged-f2p.txt');
  writeFileSync(secret, 'test hidden::it_works ... ok\n');
  const { r } = await grade(sc, { results: results({ 'f2p.out': null }), config: { run: { resultLinks: { 'f2p.out': secret } } } });
  assert.equal(r.pass, false);
  assert.deepEqual(r.f2p.notRun, NAMES.f2p);
  const done = await grade(makeScene(), { results: results({ done: null }), config: { run: { resultLinks: { done: secret } } } });
  assert.equal(done.r.infra, 'incomplete', 'a "done" that is a link does not count');
});

await taIf('diff stats: git\'s forms are read, an empty diff is zero changes, and a failed diff is null (never zero)', NO_REFLINK_HERE, async () => {
  const cases = [
    [{ 'diff.txt': ' 1 file changed, 1 insertion(+)\n' }, { files: 1, insertions: 1, deletions: 0 }],
    [{ 'diff.txt': ' 4 files changed, 9 deletions(-)\n' }, { files: 4, insertions: 0, deletions: 9 }],
    [{ 'diff.txt': '' }, { files: 0, insertions: 0, deletions: 0 }],
    [{ 'diff.status': '128\n' }, null],
    [{ 'diff.status': null, 'diff.txt': null }, null],
    [{ 'diff.txt': null }, null],
  ];
  for (const [over, expected] of cases) {
    const { r } = await grade(makeScene(), { results: results(over) });
    assert.deepEqual(r.diff, expected, JSON.stringify(over));
    assert.equal(r.pass, true, 'the diff stats never decide the verdict');
  }
});

// ---- inputs ----

await taIf('gradeTree refuses what it cannot grade honestly, before anything is copied or started', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const f = fakeDocker({});
  const call = (manifest, agent = sc.agent, opts = {}) => gradeTree(manifest, agent, { workRoot: sc.workRoot, image: 's5/codescout', runId: 'v1', dockerBin: f.bin, ...opts });
  const bad = [
    ['an id that could leave the tasks directory', { ...sc.manifest, id: '../x' }],
    ['an id with a capital letter', { ...sc.manifest, id: 'Task' }],
    ['no def', { id: 'task-one' }],
    ['an unknown test runner', manifestOf({ testRunner: 'ruby' })],
    ['an empty F2P list (it would pass vacuously)', manifestOf({ f2p: { command: ['true'], names: [] } })],
    ['F2P names that are not strings', manifestOf({ f2p: { command: ['true'], names: [1] } })],
    ['no build command', manifestOf({ buildCommand: [] })],
    ['a P2P list that is not a list', manifestOf({ p2p: { command: ['true'], names: 'x' } })],
    ['a hidden file the task does not hold', manifestOf({ hidden: { files: ['tests/not-there.rs'] } })],
    ['no hidden files at all', manifestOf({ hidden: { files: [] } })],
    ['no baseCommit', { ...sc.manifest, baseCommit: undefined }],
    ['a baseCommit that is not 40 lower-case hex', { ...sc.manifest, baseCommit: 'HEAD' }],
    ['a short baseCommit', { ...sc.manifest, baseCommit: 'b'.repeat(39) }],
    ['an upper-case baseCommit', { ...sc.manifest, baseCommit: 'B'.repeat(40) }],
    ['a graftLines line that is code, not a module', manifestOf({ hidden: { files: ['tests/hidden.rs'], graftLines: [{ file: 'src/lib.rs', line: 'fn main() {}' }] } })],
    ['a graftLines line with two modules', manifestOf({ hidden: { files: ['tests/hidden.rs'], graftLines: [{ file: 'src/lib.rs', line: 'mod a; mod b;' }] } })],
    ['a graftLines line with a trailing comment', manifestOf({ hidden: { files: ['tests/hidden.rs'], graftLines: [{ file: 'src/lib.rs', line: 'mod a; // c' }] } })],
    ['a graftLines inline module', manifestOf({ hidden: { files: ['tests/hidden.rs'], graftLines: [{ file: 'src/lib.rs', line: 'mod a {}' }] } })],
  ];
  for (const [what, manifest] of bad) await assert.rejects(call(manifest), (e) => e instanceof Error, what);
  await assert.rejects(call({ ...sc.manifest, baseCommit: undefined }), /baseCommit/);
  await assert.rejects(call(manifestOf({ hidden: { files: ['tests/hidden.rs'], graftLines: [{ file: 'src/lib.rs', line: 'use x;' }] } })), /exactly one Rust module/);
  await assert.rejects(call(sc.manifest, join(sc.dir, 'no-such-agent-tree')), /agent tree/i, 'a missing agent tree');
  await assert.rejects(call(sc.manifest, join(sc.agent, 'link-to-lib')), /agent tree/i, 'a link is not a tree');
  for (const runId of ['', '..', 'a/b', '.hidden', 'x y', 'a'.repeat(200)]) await assert.rejects(call(sc.manifest, sc.agent, { runId }), TypeError, `runId ${JSON.stringify(runId)}`);
  await assert.rejects(call(sc.manifest, sc.agent, { image: '' }), TypeError);
  await assert.rejects(call(sc.manifest, sc.agent, { workRoot: '' }), TypeError);
  await assert.rejects(call(sc.manifest, sc.agent, { timeouts: { build: -1 } }), TypeError);
  assert.equal(f.calls().length, 0, 'docker was never called');
  assert.equal(existsSync(gradesDir(sc)), false, 'every one of these was refused before anything was created: not even the grades directory');
  await assert.rejects(call(sc.manifest, sc.agent, { dockerBin: join(sc.dir, 'no-such-docker') }), /could not start/);
  assert.ok(noGrades(sc), 'a docker that cannot start still leaves no grade directory');
});

await taIf('the container name is s5-grade-<runId>, or random and different each time', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const f = fakeDocker({ containers: [] });
  for (let i = 0; i < 2; i++) await gradeTree(sc.manifest, sc.agent, { workRoot: sc.workRoot, image: 's5/codescout', dockerBin: f.bin });
  const names = f.calls().filter((c) => c.argv[0] === 'run').map((c) => flagValue(c.argv, '--name'));
  assert.equal(names.length, 2);
  for (const n of names) assert.match(n, /^s5-grade-[0-9a-f]{12}$/);
  assert.notEqual(names[0], names[1]);
});

await taIf('a runId that is already being graded is refused, not merged into', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  mkdirSync(join(gradesDir(sc), 'dup'), { recursive: true });
  const f = fakeDocker({});
  await assert.rejects(gradeTree(sc.manifest, sc.agent, { workRoot: sc.workRoot, image: 's5/codescout', runId: 'dup', dockerBin: f.bin }), /already exists/);
  assert.equal(f.calls().length, 0);
  assert.ok(existsSync(join(gradesDir(sc), 'dup')), 'the other grade\'s directory is not removed by this one');
});

await taIf('a hidden path or a graftLines path that is not a plain relative path is refused even when it would resolve to a real file', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  put(join(sc.workRoot, 'tasks', 'task-one'), 'escape.rs', 'outside the hidden dir\n');
  const f = fakeDocker({});
  const call = (hidden) => gradeTree(manifestOf({ hidden }), sc.agent, { workRoot: sc.workRoot, image: 's5/codescout', runId: 'p1', dockerBin: f.bin });
  await assert.rejects(call({ files: ['../escape.rs'] }), /relative path/);
  await assert.rejects(call({ files: ['tests/./hidden.rs'] }), /relative path/);
  await assert.rejects(call({ files: ['/etc/passwd'] }), /relative path/);
  await assert.rejects(call({ files: ['tests/hidden.rs'], graftLines: [{ file: '../x', line: 'l' }] }), /relative path/);
  await assert.rejects(call({ files: ['tests/hidden.rs'], graftLines: [{ file: 'src/lib.rs', line: 'two\nlines' }] }), /one non-empty line/);
  assert.equal(f.calls().length, 0);
});

t('removeGradeDir removes a tree the container made read-only, and reports a directory it cannot remove as leftover', () => {
  const d = tmp('s5-grade-rm-');
  const dir = join(d, 'grade');
  put(dir, 'work/locked/inner/file.txt', 'x\n');
  put(dir, 'work/ok.txt', 'y\n');
  chmodSync(join(dir, 'work/locked/inner'), 0o555);
  chmodSync(join(dir, 'work/locked'), 0o555);
  assert.deepEqual(removeGradeDir(dir), { kept: null, leftover: null });
  assert.equal(existsSync(dir), false);
  assert.deepEqual(removeGradeDir(join(d, 'never-existed')), { kept: null, leftover: null });
  // A link in the tree is removed as a link: what it points at survives.
  put(d, 'outside.txt', 'keep\n');
  put(dir, 'x.txt', 'x\n');
  symlinkSync(join(d, 'outside.txt'), join(dir, 'link'));
  assert.deepEqual(removeGradeDir(dir), { kept: null, leftover: null });
  assert.equal(readFileSync(join(d, 'outside.txt'), 'utf8'), 'keep\n');
});

// =====================================================================================
// real Docker (S5_DOCKER_TESTS=1): the images from images/build.sh, a tiny offline crate, a tiny node package
// =====================================================================================

if (process.env.S5_DOCKER_TESTS !== '1') {
  console.log('skip - the grade tests against real Docker need S5_DOCKER_TESTS=1');
} else if (NO_REFLINK_HERE) {
  console.log(`not ok - the grade tests against real Docker need a reflink filesystem: ${NO_REFLINK_HERE}`);
  process.exitCode = 1;
} else {
  await dockerTests();
}

async function dockerTests() {
  let seq = 0;
  const runIdOf = () => `t6-${process.pid}-${++seq}`;
  const escapes = [];
  process.on('exit', () => {
    for (const p of escapes) rmSync(p, { recursive: true, force: true });
  });
  const escapePath = (suffix = '') => {
    const p = `/tmp/s5-grade-escape-${process.pid}-${Math.random().toString(36).slice(2, 10)}${suffix}`;
    escapes.push(p);
    return p;
  };

  // ---- a tiny crate with no dependencies; the bug is `a - b` ----
  const CRATE = {
    'Cargo.toml': '[package]\nname = "tiny"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 {\n    a - b\n}\n',
    'tests/visible.rs': 'use tiny::add;\n\n#[test]\nfn existing_passes() {\n    assert_eq!(add(0, 0), 0);\n}\n',
  };
  const lib = (body) => `pub fn add(a: i32, b: i32) -> i32 {\n    ${body}\n}\n`;
  const HIDDEN_CRATE = {
    'tests/sub/main.rs': 'use tiny::add;\n\n#[test]\nfn add_works() {\n    assert_eq!(add(2, 3), 5);\n}\n',
    'src/hidden_support.rs': '#[test]\nfn support_works() {\n    assert_eq!(super::add(1, 1), 2);\n}\n',
  };
  const cargoDef = (over = {}) => ({
    testRunner: 'cargo',
    buildCommand: ['cargo', 'test', '--no-run'],
    f2p: { command: ['cargo', 'test', '--no-fail-fast', '--lib', '--test', 'sub'], names: ['add_works', 'hidden_support::support_works'] },
    p2p: { command: ['cargo', 'test', '--no-fail-fast', '--test', 'visible'], names: ['existing_passes'] },
    hidden: { files: ['tests/sub/main.rs'], extra: ['src/hidden_support.rs'], graftLines: [{ file: 'src/lib.rs', line: 'mod hidden_support;' }] },
    timeoutsSec: { build: 300, test: 120 },
    ...over,
  });

  function dockerScene({ id, runner = 'cargo', def, base, hiddenFiles, edits = {}, prepare = () => {} }) {
    const dir = tmp('grade-docker-', TMP_BASE);
    const workRoot = join(dir, 'work-root');
    const manifest = { id, repo: runner === 'cargo' ? 'codescout' : 'claude-plugins', baseCommit: null, def };
    for (const [rel, c] of Object.entries(hiddenFiles)) put(join(workRoot, 'tasks', id, 'hidden'), rel, c);
    const agent = join(dir, 'agent');
    for (const [rel, c] of Object.entries(base)) put(agent, rel, c);
    manifest.baseCommit = commitAll(agent);
    for (const [rel, c] of Object.entries(edits)) {
      if (c === null) rmSync(join(agent, rel), { recursive: true, force: true });
      else put(agent, rel, c);
    }
    prepare(agent);
    return { dir, workRoot, manifest, agent };
  }
  const gradeReal = (sc, { image = 's5/codescout', ...opts } = {}) => gradeTree(sc.manifest, sc.agent, {
    workRoot: sc.workRoot, image, runId: runIdOf(), cpus: 2, memoryGb: 4, ...opts,
  });
  const crate = (edits = {}, extra = {}) => dockerScene({ id: 'tiny', def: cargoDef(), base: CRATE, hiddenFiles: HIDDEN_CRATE, edits, ...extra });
  const F2P_NAMES = ['add_works', 'hidden_support::support_works'];
  const model = (r, why) => {
    assert.equal(r.infra, null, `${why}: infrastructure state ${r.infra}: ${r.detail}`);
  };

  await ta('docker: the right fix passes; the hidden tests ran (including the graftLines module), and the diff stats do not count them', async () => {
    const sc = crate({ 'src/lib.rs': lib('a + b') });
    const r = await gradeReal(sc);
    model(r, 'right fix');
    assert.equal(r.graft, 'ok');
    assert.equal(r.build, 'ok');
    assert.deepEqual(r.f2p, { passed: F2P_NAMES, failed: [], notRun: [] });
    assert.deepEqual(r.p2p, { passed: ['existing_passes'], failed: [], notRun: [] });
    assert.equal(r.pass, true);
    assert.deepEqual(r.diff, { files: 1, insertions: 1, deletions: 1 });
    assert.equal(r.kept, null);
    assert.ok(!existsSync(join(sc.workRoot, 'grades')) || readdirSync(join(sc.workRoot, 'grades')).length === 0);
  });

  await ta('docker: a wrong fix fails its F2P names and still passes the P2P name', async () => {
    const r = await gradeReal(crate({ 'src/lib.rs': lib('a * b') }));
    model(r, 'wrong fix');
    assert.equal(r.build, 'ok');
    assert.deepEqual(r.f2p, { passed: [], failed: F2P_NAMES, notRun: [] });
    assert.deepEqual(r.p2p.passed, ['existing_passes']);
    assert.equal(r.pass, false);
  });

  await ta('docker: without --no-fail-fast cargo stops at the first failing test binary, and the names behind it are NOT RUN (a failure, labelled as such)', async () => {
    const def = cargoDef({ f2p: { command: ['cargo', 'test', '--lib', '--test', 'sub'], names: F2P_NAMES } });
    const r = await gradeReal(dockerScene({ id: 'tiny', def, base: CRATE, hiddenFiles: HIDDEN_CRATE, edits: { 'src/lib.rs': lib('a * b') } }));
    model(r, 'fail-fast');
    assert.deepEqual(r.f2p, { passed: [], failed: ['hidden_support::support_works'], notRun: ['add_works'] });
    assert.equal(r.pass, false);
  });

  await ta('docker: an agent that COMMITS its fix still has real diff stats (against the task commit), and an unresolvable base is a null diff, not a zero one', async () => {
    const committed = await gradeReal(crate({ 'src/lib.rs': lib('a + b'), 'src/extra.rs': 'pub fn extra() {}\n' }, { prepare: (agent) => agentCommits(agent) }));
    model(committed, 'committed fix');
    assert.equal(committed.pass, true);
    assert.deepEqual(committed.diff, { files: 2, insertions: 2, deletions: 1 }, 'HEAD moved, the stats did not read zero');

    const lost = crate({ 'src/lib.rs': lib('a + b') });
    lost.manifest.baseCommit = 'f'.repeat(40);
    const r = await gradeReal(lost);
    model(r, 'unresolvable base');
    assert.equal(r.diff, null);
    assert.equal(r.pass, true, 'the diff never decides the verdict');
  });

  await ta('docker: an agent\'s own declaration of the grafted module (any visibility, rustfmt\'s two-line form, a CRLF file) is not declared twice: no E0428', async () => {
    const right = 'pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n';
    const variants = {
      'pub mod': `${right}pub mod hidden_support;\n`,
      'rustfmt two-line form': `${right}#[cfg(test)]\nmod hidden_support;\n`,
      'CRLF file with the declaration': `${right.replaceAll('\n', '\r\n')}mod hidden_support;\r\n`,
      'CRLF file without it': right.replaceAll('\n', '\r\n'),
    };
    for (const [what, libText] of Object.entries(variants)) {
      const r = await gradeReal(crate({ 'src/lib.rs': libText }));
      model(r, what);
      assert.equal(r.build, 'ok', `${what}: the crate compiles`);
      assert.deepEqual(r.f2p, { passed: F2P_NAMES, failed: [], notRun: [] }, `${what}: the module's test ran`);
      assert.equal(r.pass, true, what);
    }
  });

  await ta('docker: no fix at all fails, and the diff is empty', async () => {
    const r = await gradeReal(crate());
    model(r, 'no fix');
    assert.deepEqual(r.f2p.failed, F2P_NAMES);
    assert.equal(r.pass, false);
    assert.deepEqual(r.diff, { files: 0, insertions: 0, deletions: 0 });
  });

  await ta('docker: agent code that does not compile is a failed build; no test counts as run', async () => {
    const r = await gradeReal(crate({ 'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 {\n    a +\n}\n' }));
    model(r, 'no compile');
    assert.equal(r.build, 'failed');
    assert.deepEqual(r.f2p, { passed: [], failed: [], notRun: F2P_NAMES });
    assert.deepEqual(r.p2p, { passed: [], failed: [], notRun: ['existing_passes'] });
    assert.equal(r.pass, false);
  });

  await ta('docker: hidden tests the agent forged (a trivial test of the same name, the module line already present) are overwritten, and the real ones fail a wrong fix', async () => {
    const r = await gradeReal(crate({
      'src/lib.rs': `${lib('a * b')}mod hidden_support;\n`,
      'src/hidden_support.rs': '#[test]\nfn support_works() {}\n',
      'tests/sub/main.rs': '#[test]\nfn add_works() {}\n',
    }));
    model(r, 'forged tests');
    assert.deepEqual(r.f2p.failed, F2P_NAMES, 'the graft put the real tests back');
    assert.equal(r.pass, false);
  });

  await ta('docker: SYMLINK ATTACK on a parent directory of a hidden test: the graft runs in the container, and the host path behind the link is never touched', async () => {
    const escape = escapePath();
    const sc = crate({ 'src/lib.rs': lib('a + b') }, { prepare: (agent) => symlinkSync(escape, join(agent, 'tests', 'sub')) });
    assert.ok(lstatSync(join(sc.agent, 'tests', 'sub')).isSymbolicLink());
    const r = await gradeReal(sc);
    model(r, 'symlinked parent');
    assert.equal(existsSync(escape), false, `${escape} exists on the host: a graft wrote through the link`);
    assert.equal(r.pass, true, 'the link was replaced by a real directory in the container and the right fix passes');
  });

  await ta('docker: SYMLINK ATTACK: a link to an existing host directory, a link in place of the tests directory, and a link in place of the hidden file all leave the host untouched', async () => {
    const dirTarget = escapePath();
    mkdirSync(dirTarget);
    writeFileSync(join(dirTarget, 'sentinel.txt'), 'mine\n');
    const fileTarget = escapePath('.rs');
    writeFileSync(fileTarget, 'host file\n');
    const missing = escapePath('-missing');
    const check = { command: ['sh', '-c', 'test -f /work/tests/sub/main.rs && test ! -L /work/tests/sub/main.rs && test ! -L /work/tests/sub && echo "test grafted ... ok"'], names: ['grafted'] };
    const cheap = cargoDef({ buildCommand: ['true'], f2p: check, p2p: { command: ['true'], names: [] }, hidden: { files: ['tests/sub/main.rs'] } });
    const attacks = {
      'the hidden file is a link to a host file': (agent) => {
        mkdirSync(join(agent, 'tests', 'sub'), { recursive: true });
        symlinkSync(fileTarget, join(agent, 'tests', 'sub', 'main.rs'));
      },
      'the parent directory is a link to an existing host directory': (agent) => symlinkSync(dirTarget, join(agent, 'tests', 'sub')),
      'the tests directory is a link to an existing host directory': (agent) => {
        rmSync(join(agent, 'tests'), { recursive: true });
        symlinkSync(dirTarget, join(agent, 'tests'));
      },
      'two levels of dangling links': (agent) => {
        symlinkSync(join(missing, 'deeper'), join(agent, 'tests', 'sub'));
      },
    };
    for (const [what, prepare] of Object.entries(attacks)) {
      const sc = dockerScene({ id: 'tiny', def: cheap, base: CRATE, hiddenFiles: HIDDEN_CRATE, prepare });
      const r = await gradeReal(sc);
      model(r, what);
      assert.equal(r.graft, 'ok', what);
      assert.equal(r.pass, true, `${what}: the hidden file is a real file in a real directory when the tests run`);
      assert.deepEqual(readdirSync(dirTarget), ['sentinel.txt'], `${what}: the host directory gained a file`);
      assert.equal(readFileSync(join(dirTarget, 'sentinel.txt'), 'utf8'), 'mine\n');
      assert.equal(readFileSync(fileTarget, 'utf8'), 'host file\n', `${what}: the host file was written through`);
      assert.equal(existsSync(missing), false, `${what}: a path behind a dangling link was created`);
    }
  });

  await ta('docker: the environment is what a grade promises (private rw warm target, read-only cargo home and hidden, no network, user agent, workdir /work)', async () => {
    const script = [
      'ok() { echo "test $1 ... ok"; }; bad() { echo "test $1 ... FAILED"; }',
      '[ "$CARGO_TARGET_DIR" = /target ] && [ -f /target/debug/marker ] && ok warm_target || bad warm_target',
      'touch /target/scratch && ok target_rw || bad target_rw',
      'touch /cargo/x 2>/dev/null && bad cargo_ro || ok cargo_ro',
      'touch /hidden/x 2>/dev/null && bad hidden_ro || ok hidden_ro',
      '[ "$(ls /sys/class/net)" = lo ] && ok net_none || bad net_none',
      '[ "$(id -un)" = agent ] && ok user_agent || bad user_agent',
      '[ "$PWD" = /work ] && ok workdir || bad workdir',
      '[ -f /work/tests/sub/main.rs ] && ok graft_before_tests || bad graft_before_tests',
      'touch /work/scratch && ok work_rw || bad work_rw',
      '[ -d /results ] && ok results_dir || bad results_dir',
    ].join('\n');
    const names = ['warm_target', 'target_rw', 'cargo_ro', 'hidden_ro', 'net_none', 'user_agent', 'workdir', 'graft_before_tests', 'work_rw', 'results_dir'];
    const def = cargoDef({ buildCommand: ['true'], f2p: { command: ['sh', '-c', script], names }, p2p: { command: ['true'], names: [] }, hidden: { files: ['tests/sub/main.rs'] } });
    const sc = dockerScene({ id: 'tiny', def, base: CRATE, hiddenFiles: HIDDEN_CRATE });
    const warm = join(sc.workRoot, 'tasks', 'tiny', 'target');
    put(warm, 'debug/marker', 'warm\n');
    const cargoHome = join(sc.workRoot, 'cargo-home');
    put(cargoHome, 'registry/crate', 'x\n');
    const hiddenDir = join(sc.workRoot, 'tasks', 'tiny', 'hidden');
    const before = [snapshot(warm), snapshot(cargoHome), snapshot(hiddenDir), snapshot(sc.agent)];
    const r = await gradeReal(sc);
    model(r, 'environment');
    assert.deepEqual(r.f2p, { passed: names, failed: [], notRun: [] });
    assert.equal(r.pass, true);
    assert.deepEqual([snapshot(warm), snapshot(cargoHome), snapshot(hiddenDir), snapshot(sc.agent)], before, 'the warm target, cargo home, hidden dir and agent tree are all untouched');
  });

  await ta('docker: a build that hangs is a MODEL failure (build "timeout", no infra state), and the tests do not run', async () => {
    const def = cargoDef({ buildCommand: ['sleep', '60'] });
    const r = await gradeReal(dockerScene({ id: 'tiny', def, base: CRATE, hiddenFiles: HIDDEN_CRATE }), { timeouts: { build: 2 } });
    model(r, 'hanging build');
    assert.equal(r.build, 'timeout');
    assert.equal(r.pass, false);
    assert.deepEqual(r.f2p.notRun, F2P_NAMES);
  });

  await ta('docker: a build that ignores SIGTERM is killed after the grace period, and is still a model failure, not the harness\'s wall clock', async () => {
    const def = cargoDef({ buildCommand: ['sh', '-c', 'trap "" TERM; while :; do sleep 1; done'] });
    const r = await gradeReal(dockerScene({ id: 'tiny', def, base: CRATE, hiddenFiles: HIDDEN_CRATE }), { timeouts: { build: 2 } });
    model(r, 'TERM-proof build');
    assert.notEqual(r.build, 'ok');
    assert.equal(r.pass, false);
  });

  await ta('docker: a test step that hangs leaves its names not run, and the other test step still runs', async () => {
    const def = cargoDef({ buildCommand: ['true'], f2p: { command: ['sleep', '60'], names: ['add_works'] }, p2p: { command: ['sh', '-c', 'echo "test existing_passes ... ok"'], names: ['existing_passes'] } });
    const r = await gradeReal(dockerScene({ id: 'tiny', def, base: CRATE, hiddenFiles: HIDDEN_CRATE }), { timeouts: { build: 30, test: 2 } });
    model(r, 'hanging test');
    assert.deepEqual(r.f2p.notRun, ['add_works']);
    assert.deepEqual(r.p2p.passed, ['existing_passes']);
    assert.equal(r.pass, false);
  });

  // ---- node (plugins image) ----
  const NODE_HEAD = "import assert from 'node:assert/strict';\nimport { add } from '../lib.mjs';\nconst t = (name, fn) => {\n  try { fn(); console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); console.log(String(e.stack)); process.exitCode = 1; }\n};\n";
  const nodeDef = {
    testRunner: 'node',
    buildCommand: ['node', '--check', 'lib.mjs'],
    f2p: { command: ['node', 'tests/hidden.test.mjs'], names: ['adds'] },
    p2p: { command: ['node', 'tests/visible.test.mjs'], names: ['existing'] },
    hidden: { files: ['tests/hidden.test.mjs'] },
    timeoutsSec: { build: 60, test: 60 },
  };
  const nodeScene = (libBody, edits = {}) => dockerScene({
    id: 'tiny-node',
    runner: 'node',
    def: nodeDef,
    base: { 'lib.mjs': 'export const add = (a, b) => a - b;\n', 'tests/visible.test.mjs': `${NODE_HEAD}t('existing', () => assert.equal(add(0, 0), 0));\n` },
    hiddenFiles: { 'tests/hidden.test.mjs': `${NODE_HEAD}t('adds', () => assert.equal(add(2, 3), 5));\n` },
    edits: { 'lib.mjs': libBody, ...edits },
  });

  await ta('docker (plugins image, node): the right fix passes; a wrong fix fails with an assertion; a lib the test cannot import means the test did not run', async () => {
    const right = await gradeReal(nodeScene('export const add = (a, b) => a + b;\n'), { image: 's5/plugins' });
    model(right, 'node right');
    assert.deepEqual(right.f2p, { passed: ['adds'], failed: [], notRun: [] });
    assert.equal(right.pass, true);
    assert.deepEqual(right.diff, { files: 1, insertions: 1, deletions: 1 });

    const wrong = await gradeReal(nodeScene('export const add = (a, b) => a * b;\n'), { image: 's5/plugins' });
    model(wrong, 'node wrong');
    assert.deepEqual(wrong.f2p.failed, ['adds']);
    assert.equal(wrong.pass, false);

    const noExport = await gradeReal(nodeScene('export const plus = (a, b) => a + b;\n'), { image: 's5/plugins' });
    model(noExport, 'node no export');
    assert.equal(noExport.build, 'ok');
    assert.deepEqual(noExport.f2p.notRun, ['adds'], 'a test file that cannot load reports nothing, and that is a failure');
    assert.equal(noExport.pass, false);

    const syntax = await gradeReal(nodeScene('export const add = (a, b) => a +;\n'), { image: 's5/plugins' });
    model(syntax, 'node syntax');
    assert.equal(syntax.build, 'failed');
    assert.equal(syntax.pass, false);
  });

  await ta('docker (plugins image, node --test --test-reporter=tap): a name with # and \\ is un-escaped and matched; a wrong fix fails; a test\'s own raw "ok" print is only a comment', async () => {
    const hiddenTest = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../lib.mjs';\n\n"
      + "test('adds #1 and a \\\\ backslash', () => {\n  assert.equal(add(2, 3), 5);\n});\n"
      + "test('prints a forged report', () => {\n  console.log('ok 99 - the forged name');\n});\n";
    const scene = (libBody) => dockerScene({
      id: 'tiny-node',
      runner: 'node',
      def: {
        ...nodeDef,
        f2p: { command: ['node', '--test', '--test-reporter=tap', 'tests/hidden.test.mjs'], names: ['adds #1 and a \\ backslash'] },
        p2p: { command: ['node', 'tests/visible.test.mjs'], names: ['existing'] },
      },
      base: { 'lib.mjs': 'export const add = (a, b) => a - b;\n', 'tests/visible.test.mjs': `${NODE_HEAD}t('existing', () => assert.equal(add(0, 0), 0));\n` },
      hiddenFiles: { 'tests/hidden.test.mjs': hiddenTest },
      edits: { 'lib.mjs': libBody },
    });
    const right = await gradeReal(scene('export const add = (a, b) => a + b;\n'), { image: 's5/plugins' });
    model(right, 'tap right');
    assert.deepEqual(right.f2p, { passed: ['adds #1 and a \\ backslash'], failed: [], notRun: [] });
    assert.equal(right.pass, true);
    const wrong = await gradeReal(scene('export const add = (a, b) => a * b;\n'), { image: 's5/plugins' });
    model(wrong, 'tap wrong');
    assert.deepEqual(wrong.f2p, { passed: [], failed: ['adds #1 and a \\ backslash'], notRun: [] });
    assert.equal(wrong.pass, false);
  });

  // ---- sh (plugins image) ----
  const shScene = (answer, edits = {}) => dockerScene({
    id: 'tiny-sh',
    runner: 'sh',
    def: {
      testRunner: 'sh',
      buildCommand: ['true'],
      f2p: { command: ['sh', 'tests/hidden.sh'], names: ['tests/hidden.sh'] },
      p2p: { command: ['true'], names: [] },
      hidden: { files: ['tests/hidden.sh'] },
      timeoutsSec: { build: 60, test: 60 },
    },
    base: { 'answer.txt': '1\n', 'tests/keep.txt': 'x\n' },
    hiddenFiles: { 'tests/hidden.sh': 'test "$(cat answer.txt)" = 5\n' },
    edits: { 'answer.txt': answer, ...edits },
  });

  await ta('docker (plugins image, sh): the exit status of the hidden script decides, and a forged always-passing script is overwritten', async () => {
    const right = await gradeReal(shScene('5\n'), { image: 's5/plugins' });
    model(right, 'sh right');
    assert.deepEqual(right.f2p, { passed: ['tests/hidden.sh'], failed: [], notRun: [] });
    assert.equal(right.pass, true);
    const wrong = await gradeReal(shScene('4\n'), { image: 's5/plugins' });
    model(wrong, 'sh wrong');
    assert.deepEqual(wrong.f2p.failed, ['tests/hidden.sh']);
    assert.equal(wrong.pass, false);
    const forged = await gradeReal(shScene('4\n', { 'tests/hidden.sh': 'exit 0\n' }), { image: 's5/plugins' });
    model(forged, 'sh forged');
    assert.equal(forged.pass, false, 'the graft replaced the forged script');
  });

  await ta('docker: no grade container is left behind', async () => {
    const r = spawnSync('docker', ['ps', '-aq', '--filter', `name=s5-grade-t6-${process.pid}-`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '', `leftover containers: ${r.stdout}`);
  });
}
