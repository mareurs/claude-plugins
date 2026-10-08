// gate-task.test.mjs — the S5 task gate and the warm build.
//
// What a green run here is evidence for: every way a built task can be wrongly ADMITTED (the hidden tests do not
// compile at the parent, or fail there for a reason that is not the bug, or pass already, or do not run, or the
// fix does not pass them every time) and every way it can be wrongly DROPPED is pinned by a case that fails when the
// reason mapping is mutated. The mapping itself (gateReasons) is tested as a pure function, one case per reason;
// gateTask is tested through its `grade` seam against a real built task (a fixture repository, buildTask, and the
// real fix tree), so what the grader is asked to grade is checked too; warmTask against the fake docker, which
// pins the argv of both its containers; and everything against real Docker with S5_DOCKER_TESTS=1.
//
// Test directories live under ~/work/claude/s5-work/tmp-tests-t7/ (btrfs: reflinkCopy never falls back to a full
// copy) and are removed afterwards. Nothing here starts a container unless S5_DOCKER_TESTS=1, and no model.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { buildTask } from './build-task.mjs';
import { makeRepo } from './fixtures/make-repo.mjs';
import { ta } from './fixtures/testkit-async.mjs';
import { FIX_RUNS, gateReasons, gateTask, GATE_REASONS, MAX_ATTEMPTS, warmTask } from './gate-task.mjs';
import { git } from './git.mjs';
import { IMAGE_FOR_REPO } from './task-def.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-docker.mjs');
const WORK = join(homedir(), 'work', 'claude', 's5-work');
const TMP_BASE = join(WORK, 'tmp-tests-t7');

const made = [];
process.on('exit', () => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
  try {
    rmdirSync(TMP_BASE);
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
const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const fsType = (p) => spawnSync('stat', ['-f', '-c', '%T', p], { encoding: 'utf8' }).stdout.trim();
const NO_REFLINK_HERE = !existsSync(WORK) ? `${WORK} does not exist` : !['btrfs', 'xfs'].includes(fsType(WORK)) ? `${WORK} is on ${fsType(WORK)}, which cannot reflink` : '';
// A skip is printed as a skip, never as a pass.
async function taIf(name, skipReason, fn) {
  if (skipReason) console.log(`ok - ${name} # SKIP ${skipReason}`);
  else await ta(name, fn);
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

// =====================================================================================
// gateReasons: the mapping, one case per reason
// =====================================================================================

const F2P = ['add_works'];
const P2P = ['existing_passes'];
const phase = (passed = [], failed = [], notRun = []) => ({ passed, failed, notRun });
// One grade result, green: F2P and P2P passed. `over` replaces keys.
const result = (over = {}) => ({
  infra: null, graft: 'ok', build: 'ok', f2p: phase(F2P), p2p: phase(P2P), nonAssertion: [], pass: true, diff: null, wallMs: 5, detail: null, kept: null, leftover: null, ...over,
});
// The right state at the parent: the F2P test fails (by assertion: nonAssertion is empty), P2P passes.
const atParentGood = (over = {}) => result({ f2p: phase([], F2P), pass: false, ...over });
// A failing run at the fix: the F2P test fails.
const failsAtFix = (over = {}) => result({ f2p: phase([], F2P), pass: false, ...over });
const green3 = () => [result(), result(), result()];
const noBuild = (build, over = {}) => ({ build, f2p: phase([], [], F2P), p2p: phase([], [], P2P), pass: false, ...over });

const CASES = [
  ['the ok case: F2P fails by assertion at the parent, P2P passes there, everything passes three times at the fix', 'cargo', atParentGood(), green3(), []],
  ['compile_at_parent: the hidden tests do not compile at the parent (and the not-run names are not reported on top)', 'cargo', atParentGood(noBuild('failed')), green3(), ['compile_at_parent']],
  ['build_timeout at the parent: the gate cannot judge', 'cargo', atParentGood(noBuild('timeout')), green3(), ['build_timeout']],
  ['build_timeout at the fix (every run of it; the run that timed out fails and has not-run names)', 'cargo', atParentGood(), [result(), result(noBuild('timeout')), result()], ['build_timeout', 'hidden_test_not_run', 'flaky_at_fix']],
  ['f2p_passes_at_parent: an F2P name passes at the parent', 'cargo', atParentGood({ f2p: phase(F2P), pass: true }), green3(), ['f2p_passes_at_parent']],
  ['f2p_passes_at_parent: one of two F2P names passes', 'cargo', atParentGood({ f2p: phase(['a'], ['b']) }), green3(), ['f2p_passes_at_parent']],
  ['hidden_test_not_run at the parent: an F2P name that did not run (the build was ok)', 'cargo', atParentGood({ f2p: phase([], [], F2P) }), green3(), ['hidden_test_not_run']],
  ['hidden_test_not_run at the parent: a P2P name that did not run', 'cargo', atParentGood({ p2p: phase([], [], P2P) }), green3(), ['hidden_test_not_run']],
  ['hidden_test_not_run at the parent: nothing was built because the graft failed', 'cargo', atParentGood({ graft: 'failed', ...noBuild('not_run') }), green3(), ['hidden_test_not_run']],
  ['a parent that never built says nothing about its names, even if a result lists some as passed', 'cargo', atParentGood({ graft: 'failed', build: 'not_run', f2p: phase(F2P), p2p: phase([], P2P), nonAssertion: F2P }), green3(), ['hidden_test_not_run']],
  ['hidden_test_not_run at the fix: a name that did not run in every run (the runs fail too)', 'cargo', atParentGood(), [0, 1, 2].map(() => result({ f2p: phase([], [], F2P), pass: false })), ['hidden_test_not_run', 'fails_at_fix']],
  ['non_assertion_failure: an F2P name fails at the parent by something other than an assertion (node)', 'node', atParentGood({ nonAssertion: F2P }), green3(), ['non_assertion_failure']],
  ['non_assertion_failure: a P2P name fails that way (and fails)', 'node', atParentGood({ p2p: phase([], P2P), nonAssertion: P2P }), green3(), ['non_assertion_failure', 'p2p_fails_at_parent']],
  ['p2p_fails_at_parent: a P2P name fails at the parent', 'cargo', atParentGood({ p2p: phase([], P2P) }), green3(), ['p2p_fails_at_parent']],
  ['fails_at_fix: all three runs at the fix fail', 'cargo', atParentGood(), [failsAtFix(), failsAtFix(), failsAtFix()], ['fails_at_fix']],
  ['fails_at_fix: a P2P name fails in all three runs', 'cargo', atParentGood(), [0, 1, 2].map(() => result({ p2p: phase([], P2P), pass: false })), ['fails_at_fix']],
  ['flaky_at_fix: one run of three fails', 'cargo', atParentGood(), [result(), failsAtFix(), result()], ['flaky_at_fix']],
  ['flaky_at_fix: two runs of three fail', 'cargo', atParentGood(), [failsAtFix(), result(), failsAtFix()], ['flaky_at_fix']],
  ['flaky_at_fix: the LAST run fails', 'cargo', atParentGood(), [result(), result(), failsAtFix()], ['flaky_at_fix']],
  ['flaky_at_fix: a pass flag that is not true fails the run, whatever the names say', 'cargo', atParentGood(), [result(), result({ pass: undefined }), result()], ['flaky_at_fix']],
  ['flaky_at_fix: nor is a truthy pass flag that is not the boolean true', 'cargo', atParentGood(), [result(), result({ pass: 'yes' }), result()], ['flaky_at_fix']],
  ['infra at the parent: the gate cannot judge, and says only that', 'cargo', atParentGood({ infra: 'oom', ...noBuild('not_run') }), [], ['infra']],
  ['infra in a fix run: the series stopped, so there is no flaky or fails reason', 'cargo', atParentGood(), [failsAtFix(), result({ infra: 'timeout' })], ['infra']],
  ['an infra run does not count as a pass either: the other runs\' reasons stand', 'cargo', atParentGood(), [result(), result(), result({ infra: 'rm_failed' })], ['infra']],
  ['infra undefined is not "no infra"', 'cargo', atParentGood({ infra: undefined }), green3(), ['infra']],
  ['sh: manual_review_needed is added and does not fail the gate', 'sh', atParentGood(), green3(), ['manual_review_needed']],
  ['sh with a failing reason: both', 'sh', atParentGood({ f2p: phase(F2P), pass: true }), green3(), ['f2p_passes_at_parent', 'manual_review_needed']],
  ['several reasons come out in the fixed order, each once', 'cargo', atParentGood({ f2p: phase(['a'], [], ['b']), p2p: phase([], P2P) }), [failsAtFix({ f2p: phase([], [], F2P) }), failsAtFix(), failsAtFix()],
    ['f2p_passes_at_parent', 'hidden_test_not_run', 'p2p_fails_at_parent', 'fails_at_fix']],
];

for (const [name, runner, atParent, atFix, expected] of CASES) {
  t(`gateReasons: ${name}`, () => {
    assert.deepEqual(gateReasons(runner, atParent, atFix), expected);
  });
}

t('gateReasons: cargo never yields non_assertion_failure from a grade that reports none, and a panic at the parent is only a behaviour failure', () => {
  // gradeTree's nonAssertion is [] for cargo; a runtime panic at the parent is an F2P name that FAILED, which is the right state
  assert.deepEqual(gateReasons('cargo', atParentGood(), green3()), []);
});

t('GATE_REASONS is the fixed order, and the cases above cover every reason in it', () => {
  assert.deepEqual(GATE_REASONS, [
    'infra', 'build_timeout', 'compile_at_parent', 'f2p_passes_at_parent', 'non_assertion_failure', 'hidden_test_not_run', 'p2p_fails_at_parent', 'fails_at_fix', 'flaky_at_fix', 'manual_review_needed',
  ]);
  const seen = new Set(CASES.flatMap((c) => c[4]));
  for (const reason of GATE_REASONS) assert.ok(seen.has(reason), `no case yields ${reason}`);
  assert.equal(FIX_RUNS, 3);
  assert.equal(MAX_ATTEMPTS, 3, 'a grade and up to two retries');
});

// =====================================================================================
// gateTask through its grade seam, against a real built task
// =====================================================================================

const ID_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/;
const LIB_P = 'pub fn add(a: i32, b: i32) -> i32 {\n    a - b\n}\n';
const LIB_FIX = 'pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n';
const CARGO_TOML = '[package]\nname = "tiny"\nversion = "0.1.0"\nedition = "2021"\n';
const VISIBLE_RS = 'use tiny::add;\n\n#[test]\nfn existing_passes() {\n    assert_eq!(add(0, 0), 0);\n}\n';
const HIDDEN_RS = 'use tiny::add;\n\n#[test]\nfn add_works() {\n    assert_eq!(add(2, 3), 5);\n}\n';

const cargoDef = (src, over = {}) => ({
  id: 'gate-one',
  repo: 'codescout',
  repoPath: src.dir,
  fix: src.shas.fix,
  parent: src.shas.parent,
  subsystem: 'math',
  testRunner: 'cargo',
  hidden: { files: ['tests/hidden.rs'] },
  buildCommand: ['cargo', 'test', '--no-run'],
  f2p: { command: ['cargo', 'test', '--no-fail-fast', '--test', 'hidden'], names: F2P },
  p2p: { command: ['cargo', 'test', '--no-fail-fast', '--test', 'visible'], names: P2P },
  testPatterns: [],
  scrub: { removePaths: [], terms: [] },
  timeoutsSec: { build: 300, test: 120 },
  ...over,
});
// A source repository (parent, fix) and the task built from it: { src, workRoot, manifest, taskDir }.
function makeScene({ parentFiles = {}, fixFiles = {}, defOver = {}, workRoot = tmp('gate-', TMP_BASE) } = {}) {
  const { dir, shas } = makeRepo([
    { label: 'parent', subject: 'chore: parent', date: '2026-10-02T10:00:00+00:00', files: { 'Cargo.toml': CARGO_TOML, 'src/lib.rs': LIB_P, 'tests/visible.rs': VISIBLE_RS, ...parentFiles } },
    { label: 'fix', subject: 'fix: add', date: '2026-10-03T10:00:00+00:00', files: { 'src/lib.rs': LIB_FIX, 'tests/hidden.rs': HIDDEN_RS, ...fixFiles } },
  ]);
  made.push(dir);
  const src = { dir, shas };
  const taskDir = tmp('s5-gate-taskdef-');
  writeFileSync(join(taskDir, 'task.json'), JSON.stringify(cargoDef(src, defOver)));
  writeFileSync(join(taskDir, 'TASK.md'), '# Task\n\nadd must add.\n');
  writeFileSync(join(taskDir, 'prompt.txt'), 'add returns the difference of its arguments.\n');
  const manifest = buildTask(taskDir, { workRoot });
  return { src, workRoot, manifest, taskDir: join(workRoot, 'tasks', manifest.id) };
}

// A grade seam that answers from a script and records what it was asked, and what the tree looked like at that moment.
// script: an array (the last entry repeats) or (index, call) => answer; an answer that is an Error is thrown.
function scripted(script) {
  const calls = [];
  const grade = async (manifest, treeDir, options) => {
    const call = {
      manifest, treeDir, options,
      treeExists: existsSync(treeDir),
      lib: existsSync(join(treeDir, 'src/lib.rs')) ? readFileSync(join(treeDir, 'src/lib.rs'), 'utf8') : null,
      hasHidden: existsSync(join(treeDir, 'tests/hidden.rs')),
      head: existsSync(join(treeDir, '.git')) ? git(treeDir, ['rev-parse', 'HEAD']).stdout.toString().trim() : null,
    };
    calls.push(call);
    const answer = typeof script === 'function' ? script(calls.length - 1, call) : script[Math.min(calls.length - 1, script.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { grade, calls };
}
const OK_SERIES = () => [atParentGood(), result(), result(), result()];
const gate = (sc, script, opts = {}) => {
  const seam = scripted(script);
  const run = gateTask(sc.manifest, { workRoot: sc.workRoot, grade: seam.grade, dockerBin: '/no/docker', ...opts });
  return run.then((r) => ({ r, ...seam }));
};
const gateDirs = (sc) => (existsSync(join(sc.workRoot, 'gate')) ? readdirSync(join(sc.workRoot, 'gate')) : []);

await ta('gateTask, the ok case: one grade at the parent, three at the fix tree, the result returned and written to gate.json', async () => {
  const sc = makeScene();
  const before = Date.now();
  const { r, calls } = await gate(sc, OK_SERIES(), { cpus: 2, memoryGb: 6, timeouts: { build: 50, test: 20 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reasons, []);
  assert.equal(calls.length, 1 + FIX_RUNS);

  // what was graded: the P tree itself, then the fix tree, three times
  const pTree = join(sc.taskDir, 'tree');
  assert.equal(calls[0].treeDir, pTree);
  assert.equal(calls[0].manifest, sc.manifest, 'the parent is graded with the manifest as it is');
  const fixTree = calls[1].treeDir;
  assert.ok(fixTree.startsWith(`${join(sc.workRoot, 'gate')}/${sc.manifest.id}-`), fixTree);
  assert.match(fixTree.slice(join(sc.workRoot, 'gate', `${sc.manifest.id}-`).length), /^[0-9a-f]{12}\/tree$/, '<workRoot>/gate/<id>-<12 hex>/tree');
  for (const c of calls.slice(1)) {
    assert.equal(c.treeDir, fixTree, 'the same fix tree for all three runs');
    assert.equal(c.treeExists, true);
    assert.equal(c.lib, LIB_FIX, 'the tree at the fix commit, not the parent');
    assert.equal(c.hasHidden, true, 'the fix commit holds the hidden test file itself');
  }
  assert.equal(calls[0].lib, LIB_P);
  assert.equal(calls[1].manifest.baseCommit, calls[1].head, 'the fix tree is graded against its own one commit');
  assert.notEqual(calls[1].manifest.baseCommit, sc.manifest.baseCommit);
  assert.deepEqual({ ...calls[1].manifest, baseCommit: sc.manifest.baseCommit }, sc.manifest, 'and is otherwise the same manifest');

  // how it was graded
  const runIds = calls.map((c) => c.options.runId);
  assert.equal(new Set(runIds).size, runIds.length, 'every grade has its own run id');
  for (const id of runIds) assert.match(id, ID_RE);
  for (const c of calls) {
    assert.equal(c.options.workRoot, resolve(sc.workRoot));
    assert.equal(c.options.image, 's5/codescout', 'IMAGE_FOR_REPO[codescout]');
    assert.equal(c.options.dockerBin, '/no/docker');
    assert.equal(c.options.cpus, 2);
    assert.equal(c.options.memoryGb, 6);
    assert.deepEqual(c.options.timeouts, { build: 50, test: 20 });
  }

  // the record
  assert.equal(r.atParent.attempts, 1);
  assert.equal(r.atFix.length, FIX_RUNS);
  assert.ok(r.atFix.every((g) => g.attempts === 1));
  assert.equal(r.treeHash, sc.manifest.treeHash);
  assert.equal(r.hiddenHash, sc.manifest.hiddenHash);
  assert.ok(Date.parse(r.gatedAt) >= before - 1000 && Date.parse(r.gatedAt) <= Date.now() + 1000, r.gatedAt);
  assert.equal(new Date(r.gatedAt).toISOString(), r.gatedAt);
  assert.deepEqual(Object.keys(r).sort(), ['atFix', 'atParent', 'gatedAt', 'hiddenHash', 'ok', 'reasons', 'treeHash']);
  const onDisk = JSON.parse(readFileSync(join(sc.taskDir, 'gate.json'), 'utf8'));
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(r)), 'gate.json is the returned object');
  assert.deepEqual(readdirSync(sc.taskDir).sort(), ['gate.json', 'hidden', 'manifest.json', 'tree'], 'no temp file is left');
  assert.deepEqual(gateDirs(sc), [], 'the fix tree is removed afterwards');
});

await ta('gateTask: the image comes from IMAGE_FOR_REPO unless an image option overrides it; an unknown repo needs an image', async () => {
  const sc = makeScene({ defOver: { repo: 'claude-plugins' } });
  const plugins = await gate(sc, OK_SERIES());
  assert.ok(plugins.calls.every((c) => c.options.image === IMAGE_FOR_REPO['claude-plugins']));
  const pinned = await gate(sc, OK_SERIES(), { image: 'sha256:0123' });
  assert.ok(pinned.calls.every((c) => c.options.image === 'sha256:0123'), 'a pinned image wins');

  const odd = { ...sc.manifest, repo: 'github' };
  await assert.rejects(gateTask(odd, { workRoot: sc.workRoot, grade: scripted(OK_SERIES()).grade }), (e) => e instanceof TypeError && /image/.test(e.message));
  for (const repo of ['constructor', 'toString', '__proto__']) {
    await assert.rejects(gateTask({ ...sc.manifest, repo }, { workRoot: sc.workRoot, grade: scripted(OK_SERIES()).grade }), (e) => e instanceof TypeError && /image/.test(e.message), repo);
  }
  const ok = await gateTask(odd, { workRoot: sc.workRoot, grade: scripted(OK_SERIES()).grade, image: 'x/y' });
  assert.equal(ok.ok, true);
});

await ta('gateTask grades the fix tree when the parent already fails every way: all four grades run, and every reason is reported', async () => {
  const sc = makeScene();
  const { r, calls } = await gate(sc, [atParentGood(noBuild('failed')), failsAtFix(), failsAtFix(), failsAtFix()]);
  assert.equal(calls.length, 4, 'a failing parent does not stop the fix runs');
  assert.deepEqual(r.reasons, ['compile_at_parent', 'fails_at_fix']);
  assert.equal(r.ok, false);
  assert.deepEqual(JSON.parse(readFileSync(join(sc.taskDir, 'gate.json'), 'utf8')).reasons, ['compile_at_parent', 'fails_at_fix']);
});

await ta('gateTask runs all three fix grades even after one fails (that is how flaky is told from broken)', async () => {
  const sc = makeScene();
  const { r, calls } = await gate(sc, [atParentGood(), failsAtFix(), result(), result()]);
  assert.equal(calls.length, 4);
  assert.deepEqual(r.reasons, ['flaky_at_fix']);
  assert.equal(r.ok, false);
});

await ta('gateTask, sh runner: manual_review_needed does not fail the gate', async () => {
  const sc = makeScene({ defOver: { testRunner: 'sh', f2p: { command: ['sh', 'tests/hidden.sh'], names: ['tests/hidden.sh'] }, p2p: { command: ['true'], names: [] }, buildCommand: ['true'], hidden: { files: ['tests/hidden.rs'] } } });
  const { r } = await gate(sc, OK_SERIES());
  assert.deepEqual(r.reasons, ['manual_review_needed']);
  assert.equal(r.ok, true);
});

await ta('gateTask retries a grade that ended in infrastructure, up to two more times, with a fresh run id each time', async () => {
  const sc = makeScene();
  const oom = () => atParentGood({ infra: 'oom' });
  const { r, calls } = await gate(sc, [oom(), oom(), atParentGood(), result(), result(), result()]);
  assert.equal(calls.length, 6);
  assert.equal(r.ok, true);
  assert.equal(r.atParent.attempts, 3);
  assert.equal(r.atParent.infra, null, 'the grade that stood is the third');
  assert.equal(new Set(calls.map((c) => c.options.runId)).size, 6);
  assert.ok(calls.slice(0, 3).every((c) => c.treeDir === join(sc.taskDir, 'tree')), 'the same tree each time');

  const fixRetry = await gate(sc, [atParentGood(), result({ infra: 'timeout' }), result(), result(), result()]);
  assert.equal(fixRetry.calls.length, 5);
  assert.deepEqual(fixRetry.r.atFix.map((g) => g.attempts), [2, 1, 1]);
  assert.equal(fixRetry.r.ok, true);
});

await ta('gateTask: infrastructure on all three attempts at the parent is the reason infra; nothing is graded after it and no fix tree is made', async () => {
  const sc = makeScene();
  const { r, calls } = await gate(sc, [atParentGood({ infra: 'create_failed' })]);
  assert.equal(calls.length, MAX_ATTEMPTS);
  assert.deepEqual(r.reasons, ['infra']);
  assert.equal(r.ok, false);
  assert.equal(r.atParent.infra, 'create_failed');
  assert.equal(r.atParent.attempts, 3);
  assert.deepEqual(r.atFix, []);
  assert.deepEqual(gateDirs(sc), []);
  assert.equal(JSON.parse(readFileSync(join(sc.taskDir, 'gate.json'), 'utf8')).ok, false, 'the failure is recorded: T10 refuses a task that is not ok');
});

await ta('gateTask: infrastructure in a fix run, three times, stops the series: infra only, whatever the earlier runs said', async () => {
  const sc = makeScene();
  const { r, calls } = await gate(sc, (i) => (i === 0 ? atParentGood() : i === 1 ? failsAtFix() : result({ infra: 'inspect_failed' })));
  assert.equal(calls.length, 1 + 1 + MAX_ATTEMPTS);
  assert.equal(r.atFix.length, 2);
  assert.deepEqual(r.reasons, ['infra']);
  assert.equal(r.ok, false);
});

await ta('gateTask: a grade that throws counts as infrastructure (retried), and its message is kept', async () => {
  const sc = makeScene();
  const boom = new Error('docker could not start: ENOENT');
  const retried = await gate(sc, [boom, atParentGood(), result(), result(), result()]);
  assert.equal(retried.r.ok, true);
  assert.equal(retried.r.atParent.attempts, 2);

  const dead = await gate(sc, [boom]);
  assert.deepEqual(dead.r.reasons, ['infra']);
  assert.equal(dead.calls.length, MAX_ATTEMPTS);
  assert.equal(dead.r.atParent.infra, 'grade_failed');
  assert.match(dead.r.atParent.detail, /docker could not start: ENOENT/);
  assert.deepEqual(dead.r.atParent.f2p, phase([], [], F2P), 'in the shape of a grade: nothing ran');
  assert.deepEqual(dead.r.atParent.nonAssertion, []);
  assert.equal(dead.r.atParent.pass, false);
});

await ta('gateTask: a grade result that is not the shape of one fails closed as infrastructure', async () => {
  const sc = makeScene();
  for (const bad of [undefined, null, {}, { ...atParentGood(), nonAssertion: undefined }, { ...atParentGood(), f2p: undefined }]) {
    const { r } = await gate(sc, [bad]);
    assert.deepEqual(r.reasons, ['infra'], JSON.stringify(bad));
    assert.equal(r.atParent.infra, 'bad_grade_result');
  }
});

await ta('gateTask removes the fix tree after every outcome, and keeps it under S5_KEEP_GRADES=1', async () => {
  const sc = makeScene();
  await gate(sc, [atParentGood(), result(), result(), result({ infra: 'oom' })]);
  assert.deepEqual(gateDirs(sc), [], 'removed after an infra stop');
  await gate(sc, [new Error('x')]);
  assert.deepEqual(gateDirs(sc), [], 'removed after throws');

  await withEnv({ S5_KEEP_GRADES: '1' }, async () => {
    await gate(sc, OK_SERIES());
  });
  const kept = gateDirs(sc);
  assert.equal(kept.length, 1);
  assert.ok(existsSync(join(sc.workRoot, 'gate', kept[0], 'tree', 'src', 'lib.rs')), 'the tree is there to look at');
  assert.ok(lstatSync(join(sc.workRoot, 'gate', kept[0])).isDirectory());
});

await ta('gateTask: a fix tree that cannot be built throws, writes no gate.json and leaves nothing', async () => {
  const sc = makeScene();
  const seam = scripted(OK_SERIES());
  const wrong = { ...sc.manifest, def: { ...sc.manifest.def, parent: sc.src.shas.fix } };
  await assert.rejects(gateTask(wrong, { workRoot: sc.workRoot, grade: seam.grade }), /first parent|parent/);
  assert.ok(!existsSync(join(sc.taskDir, 'gate.json')));
  assert.deepEqual(gateDirs(sc), []);
});

await ta('gateTask: gate.json replaces an older one atomically (tmp + rename), and is never written through a link', async () => {
  const sc = makeScene();
  const gatePath = join(sc.taskDir, 'gate.json');
  writeFileSync(gatePath, '{"ok":true,"old":1}\n');
  const seen = [];
  const seam = scripted((i) => {
    seen.push(readFileSync(gatePath, 'utf8'));
    return OK_SERIES()[i];
  });
  const r = await gateTask(sc.manifest, { workRoot: sc.workRoot, grade: seam.grade });
  assert.ok(seen.every((s) => s === '{"ok":true,"old":1}\n'), 'the old record stands until the new one is complete');
  assert.deepEqual(JSON.parse(readFileSync(gatePath, 'utf8')), JSON.parse(JSON.stringify(r)));

  // a gate.json that is a symlink is replaced by a regular file; what it pointed to is not written
  const outside = join(tmp('s5-gate-outside-'), 'target.json');
  writeFileSync(outside, 'ORIGINAL\n');
  rmSync(gatePath);
  symlinkSync(outside, gatePath);
  await gateTask(sc.manifest, { workRoot: sc.workRoot, grade: scripted(OK_SERIES()).grade });
  assert.equal(readFileSync(outside, 'utf8'), 'ORIGINAL\n');
  assert.ok(lstatSync(gatePath).isFile());
  assert.equal(JSON.parse(readFileSync(gatePath, 'utf8')).ok, true);
  assert.deepEqual(readdirSync(sc.taskDir).sort(), ['gate.json', 'hidden', 'manifest.json', 'tree']);
});

await ta('gateTask: a gate.json that cannot be written throws, leaves the old one and no temp file', async () => {
  const sc = makeScene();
  const gatePath = join(sc.taskDir, 'gate.json');
  mkdirSync(gatePath); // a rename of a file over a directory fails
  writeFileSync(join(gatePath, 'keep'), 'x');
  await assert.rejects(gateTask(sc.manifest, { workRoot: sc.workRoot, grade: scripted(OK_SERIES()).grade }));
  assert.ok(lstatSync(gatePath).isDirectory());
  assert.deepEqual(readdirSync(sc.taskDir).sort(), ['gate.json', 'hidden', 'manifest.json', 'tree'], 'the temp file is removed');
});

await ta('gateTask refuses bad inputs before grading anything', async () => {
  const sc = makeScene();
  const seam = scripted(OK_SERIES());
  const go = (manifest, opts = {}) => gateTask(manifest, { workRoot: sc.workRoot, grade: seam.grade, ...opts });
  await assert.rejects(go(null), TypeError);
  await assert.rejects(go({ ...sc.manifest, id: 'Bad Id' }), TypeError);
  await assert.rejects(go({ ...sc.manifest, def: null }), TypeError);
  await assert.rejects(go({ ...sc.manifest, treeHash: undefined }), TypeError);
  await assert.rejects(go({ ...sc.manifest, hiddenHash: '' }), TypeError);
  await assert.rejects(go(sc.manifest, { workRoot: '' }), TypeError);
  await assert.rejects(go(sc.manifest, { workRoot: undefined }), TypeError);
  await assert.rejects(go(sc.manifest, { image: '' }), TypeError);
  await assert.rejects(go(sc.manifest, { grade: 'no' }), TypeError);
  await assert.rejects(go({ ...sc.manifest, id: 'no-such-task' }), /tree/, 'a task that was never built');
  assert.equal(seam.calls.length, 0, 'nothing was graded');
  assert.ok(!existsSync(join(sc.taskDir, 'gate.json')));
  assert.deepEqual(gateDirs(sc), []);
});

// =====================================================================================
// warmTask against the fake docker
// =====================================================================================

// A wrapper that exports the fake's two control variables and execs fixtures/fake-docker.mjs.
function fakeDocker(config = {}) {
  const dir = tmp('s5-gate-fake-');
  const log = join(dir, 'log.jsonl');
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify(config));
  const bin = join(dir, 'docker');
  writeFileSync(bin, `#!/bin/sh\nexport FAKE_DOCKER_LOG=${shq(log)}\nexport FAKE_DOCKER_CONFIG=${shq(cfg)}\nexec ${shq(process.execPath)} ${shq(FAKE)} "$@"\n`);
  chmodSync(bin, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { bin, dir, calls };
}
const FETCH_ID = 'ab'.repeat(32);
const BUILD_ID = 'cd'.repeat(32);
const oursOf = (id, name) => ({ id, name, labels: { s5: '1', 's5.run': name } });
const flagValue = (argv, flag) => argv[argv.indexOf(flag) + 1];
const mountsOf = (argv) => argv.flatMap((a, i) => {
  if (argv[i - 1] !== '--mount') return [];
  const fields = a.split(',');
  return [{ source: fields.find((x) => x.startsWith('source=')).slice(7), target: fields.find((x) => x.startsWith('target=')).slice(7), readonly: fields.includes('readonly') }];
});
const mountAt = (argv, target) => mountsOf(argv).find((m) => m.target === target);
const envNamesOf = (argv) => argv.flatMap((a, i) => (argv[i - 1] === '-e' ? [a] : [])).sort();
const runCalls = (f) => f.calls().filter((c) => c.argv[0] === 'run');
const afterImage = (argv, image) => argv.slice(argv.indexOf(image) + 1);
const warmDocker = (over = {}) => fakeDocker({
  containers: [oursOf(FETCH_ID, 's5-warm-fetch-w1'), oursOf(BUILD_ID, 's5-warm-build-w1')],
  expectEnv: { CARGO_NET_OFFLINE: 'false', CARGO_HOME: '/cargo', CARGO_TARGET_DIR: '/target' },
  ...over,
  run: { calls: [{ status: 0, stdout: 'fetched\n' }, { status: 0, stderr: '    Finished `test` profile\n' }], ...(over.run ?? {}) },
});
const warm = (sc, f, opts = {}) => warmTask(sc.manifest, { workRoot: sc.workRoot, dockerBin: f.bin, runId: 'w1', ...opts });
const warmDirs = (sc) => (existsSync(join(sc.workRoot, 'warm')) ? readdirSync(join(sc.workRoot, 'warm')) : []);

await taIf('warmTask: a networked fetch container, then an offline build container, with the exact mounts, environment, user and paths of a grade', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const f = warmDocker();
  const r = await warm(sc, f);
  const [fetch, build] = runCalls(f);
  assert.equal(runCalls(f).length, 2, 'two containers, in that order');

  // (1) fetch
  const fa = fetch.argv;
  assert.equal(flagValue(fa, '--name'), 's5-warm-fetch-w1');
  assert.ok(fa.includes('--pull=never'));
  assert.equal(flagValue(fa, '--network'), 'bridge', 'the default bridge network: the only container here with a route out');
  assert.equal(flagValue(fa, '--user'), 'agent');
  assert.equal(flagValue(fa, '--workdir'), '/work');
  assert.ok(fa.includes(`s5.task=${sc.manifest.id}`));
  assert.deepEqual(afterImage(fa, 's5/codescout'), ['cargo', 'fetch', '--locked']);
  assert.ok(!fa.includes('--cpus') && !fa.includes('--memory'), 'no resource flags unless asked for');
  assert.deepEqual(envNamesOf(fa), ['CARGO_HOME', 'CARGO_NET_OFFLINE']);
  assert.equal(fetch.envMatches.CARGO_NET_OFFLINE, true, 'CARGO_NET_OFFLINE=false reached docker\'s environment');
  assert.equal(fetch.envMatches.CARGO_HOME, true, 'CARGO_HOME=/cargo');
  assert.equal(fetch.envMatches.CARGO_TARGET_DIR, false);
  assert.equal(fetch.stdinKind, 'null');
  const cargoHome = join(sc.workRoot, 'cargo-home');
  assert.deepEqual(mountsOf(fa).map((m) => m.target).sort(), ['/cargo', '/work']);
  assert.deepEqual(mountAt(fa, '/cargo'), { source: cargoHome, target: '/cargo', readonly: false }, 'the shared cargo home, rw: this is the one container that fills it');
  const fetchWork = mountAt(fa, '/work');
  assert.equal(fetchWork.readonly, false);
  assert.notEqual(fetchWork.source, join(sc.taskDir, 'tree'), 'a copy of the tree, never the tree');
  assert.ok(fetchWork.source.startsWith(`${join(sc.workRoot, 'warm')}/`), fetchWork.source);

  // (2) build
  const ba = build.argv;
  assert.equal(flagValue(ba, '--name'), 's5-warm-build-w1');
  assert.equal(flagValue(ba, '--network'), 'none');
  assert.equal(flagValue(ba, '--user'), 'agent');
  assert.equal(flagValue(ba, '--workdir'), '/work');
  assert.ok(ba.includes(`s5.task=${sc.manifest.id}`));
  assert.deepEqual(afterImage(ba, 's5/codescout'), ['cargo', 'test', '--no-run'], 'the task\'s buildCommand, as argv');
  assert.deepEqual(envNamesOf(ba), ['CARGO_TARGET_DIR'], 'the same environment a grade has');
  assert.equal(build.envMatches.CARGO_TARGET_DIR, true);
  assert.equal(build.envMatches.CARGO_NET_OFFLINE, false);
  assert.deepEqual(mountsOf(ba).map((m) => m.target).sort(), ['/cargo', '/target', '/work']);
  assert.deepEqual(mountAt(ba, '/cargo'), { source: cargoHome, target: '/cargo', readonly: true });
  const target = join(sc.taskDir, 'target');
  assert.deepEqual(mountAt(ba, '/target'), { source: target, target: '/target', readonly: false });
  const buildWork = mountAt(ba, '/work');
  assert.equal(buildWork.readonly, false);
  assert.ok(buildWork.source.startsWith(`${join(sc.workRoot, 'warm')}/`));
  assert.notEqual(buildWork.source, fetchWork.source, 'a fresh copy for the build');
  assert.notEqual(buildWork.source, join(sc.taskDir, 'tree'));
  assert.ok(!mountsOf(ba).some((m) => m.target === '/hidden'), 'no graft: the hidden tests are not mounted');

  // the result
  assert.equal(r.ok, true);
  assert.equal(r.fetch.exit, 0);
  assert.equal(r.build.exit, 0);
  assert.equal(r.fetch.tail, 'fetched');
  assert.match(r.build.tail, /Finished `test` profile/);
  assert.equal(typeof r.fetch.wallMs, 'number');
  assert.equal(typeof r.build.wallMs, 'number');
  assert.equal(r.fetch.infra, null);
  assert.equal(r.build.infra, null);
  assert.deepEqual(r.buildCommand, ['cargo', 'test', '--no-run'], 'R21: the feature set the warm target was built with');
  assert.equal(r.target, target);
  assert.ok(lstatSync(target).isDirectory(), 'the warm target stays');
  assert.deepEqual(warmDirs(sc), [], 'the copies are removed');
  assert.ok(lstatSync(cargoHome).isDirectory(), 'the cargo home was made');
});

await taIf('warmTask: cpus and memory limits reach both containers when given', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const f = warmDocker();
  await warm(sc, f, { cpus: 2, memoryGb: 6 });
  for (const { argv } of runCalls(f)) {
    assert.equal(flagValue(argv, '--cpus'), '2');
    assert.equal(flagValue(argv, '--memory'), '6g');
  }
});

await taIf('warmTask: a build failure is returned, not thrown, and the half-built target is not left as a warm one; the fetch failing does not stop the build', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const f = warmDocker({ run: { calls: [{ status: 101, stderr: 'error: failed to get `x`\n' }, { status: 101, stderr: `error: could not compile \`tiny\`\n${'x'.repeat(5000)}END\n` }] } });
  const r = await warm(sc, f);
  assert.equal(runCalls(f).length, 2, 'the build ran although the fetch failed');
  assert.equal(r.ok, false);
  assert.equal(r.fetch.exit, 101);
  assert.equal(r.build.exit, 101);
  assert.ok(r.build.tail.length <= 2000 && r.build.tail.endsWith('END'), 'the tail is the end of the output');
  assert.equal(r.target, null);
  assert.ok(!existsSync(join(sc.taskDir, 'target')), 'target exists only when the warm build succeeded: a retry can warm again');
  assert.deepEqual(warmDirs(sc), []);
});

await taIf('warmTask: an infrastructure outcome (an OOM-killed container) is named in the result and is not an ok, whatever the exit status says', NO_REFLINK_HERE, async () => {
  for (const status of [137, 0]) {
    const sc = makeScene();
    const f = warmDocker({ containers: [oursOf(FETCH_ID, 's5-warm-fetch-w1'), { ...oursOf(BUILD_ID, 's5-warm-build-w1'), oomKilled: true }], run: { calls: [{ status: 0 }, { status }] } });
    const r = await warm(sc, f);
    assert.equal(r.build.exit, status);
    assert.equal(r.build.infra, 'oom');
    assert.equal(r.fetch.infra, null);
    assert.equal(r.ok, false, `exit ${status}`);
    assert.equal(r.target, null);
    assert.ok(!existsSync(join(sc.taskDir, 'target')));
  }
});

await taIf('warmTask: the fetch and the build each have their own wall clock (timeouts.fetch, timeouts.build), and a timeout is infrastructure', NO_REFLINK_HERE, async () => {
  const slow = { status: 0, sleepMs: 4000 };
  const buildSlow = await warm(makeScene(), warmDocker({ run: { calls: [{ status: 0 }, slow] } }), { timeouts: { fetch: 600, build: 0.4 } });
  assert.equal(buildSlow.fetch.infra, null);
  assert.equal(buildSlow.build.infra, 'timeout', 'the build had 0.4 s');
  assert.equal(buildSlow.ok, false);
  assert.ok(buildSlow.build.wallMs < 3500, `the build was cut off, it ran ${buildSlow.build.wallMs} ms`);

  const fetchSlow = await warm(makeScene(), warmDocker({ run: { calls: [slow, { status: 0 }] } }), { timeouts: { fetch: 0.4, build: 600 } });
  assert.equal(fetchSlow.fetch.infra, 'timeout', 'the fetch had 0.4 s');
  assert.equal(fetchSlow.build.infra, null);
  assert.equal(fetchSlow.build.exit, 0, 'a fetch that timed out does not stop the build');
  assert.equal(fetchSlow.ok, true, 'the build container is what decides ok');
});

await taIf('warmTask: a baseTarget is reflinked into the task\'s target first (and left alone); an existing target is refused before any container runs', NO_REFLINK_HERE, async () => {
  const sc = makeScene();
  const base = tmp('base-target-', TMP_BASE);
  put(base, 'debug/deps/libdep.rlib', 'prebuilt\n');
  const f = warmDocker();
  const r = await warm(sc, f, { baseTarget: base });
  assert.equal(r.ok, true);
  assert.equal(readFileSync(join(sc.taskDir, 'target', 'debug/deps/libdep.rlib'), 'utf8'), 'prebuilt\n', 'the build started from the base target');
  assert.ok(existsSync(join(base, 'debug/deps/libdep.rlib')) && !existsSync(join(base, 'extra')));
  writeFileSync(join(sc.taskDir, 'target', 'only-in-task'), 'x');
  assert.ok(!existsSync(join(base, 'only-in-task')), 'a copy: writing the task target does not write the base');

  const again = warmDocker();
  await assert.rejects(warm(sc, again, { runId: 'w2' }), /already exists/);
  assert.equal(again.calls().length, 0, 'no container was started');
  assert.ok(existsSync(join(sc.taskDir, 'target', 'only-in-task')), 'the existing target is untouched');
  assert.deepEqual(warmDirs(sc), []);

  const sc2 = makeScene();
  await assert.rejects(warm(sc2, warmDocker(), { baseTarget: join(base, 'nope') }));
  assert.ok(!existsSync(join(sc2.taskDir, 'target')), 'a failed start leaves no target');
  assert.deepEqual(warmDirs(sc2), []);
});

await taIf('warmTask skips a task that is not a cargo task, and starts nothing', NO_REFLINK_HERE, async () => {
  const sc = makeScene({ defOver: { testRunner: 'node', f2p: { command: ['node', 'tests/hidden.test.mjs'], names: ['x'] }, p2p: { command: ['node', 'tests/v.test.mjs'], names: [] }, buildCommand: ['node', '--check', 'a.mjs'] } });
  const f = warmDocker();
  assert.deepEqual(await warm(sc, f), { skipped: 'not cargo' });
  assert.equal(f.calls().length, 0);
  assert.ok(!existsSync(join(sc.workRoot, 'cargo-home')));
});

await taIf('warmTask: image defaults to IMAGE_FOR_REPO and an image option wins; a bad input is refused before anything is made', NO_REFLINK_HERE, async () => {
  const sc = makeScene({ defOver: { repo: 'claude-plugins' } });
  const f = warmDocker();
  await warm(sc, f);
  assert.ok(runCalls(f).every((c) => c.argv.includes('s5/plugins')), 'IMAGE_FOR_REPO[claude-plugins]');
  const sc2 = makeScene();
  const f2 = warmDocker();
  await warm(sc2, f2, { image: 'sha256:0123' });
  assert.ok(runCalls(f2).every((c) => c.argv.includes('sha256:0123')));

  const sc3 = makeScene();
  const none = warmDocker();
  for (const bad of [{ workRoot: '' }, { image: '' }, { runId: 'a b' }, { timeouts: { fetch: 0 } }, { timeouts: { build: 'x' } }, { cpus: 0 }]) {
    await assert.rejects(warm(sc3, none, bad), TypeError, JSON.stringify(bad));
  }
  await assert.rejects(warmTask(null, { workRoot: sc3.workRoot, dockerBin: none.bin }), TypeError);
  await assert.rejects(warm({ ...sc3, manifest: { ...sc3.manifest, id: 'no-such-task' } }, none), /tree/);
  assert.equal(none.calls().length, 0);
  assert.ok(!existsSync(join(sc3.taskDir, 'target')));
});

// =====================================================================================
// real Docker (S5_DOCKER_TESTS=1): the images from images/build.sh, tiny dependency-free crates and node packages
// =====================================================================================

if (process.env.S5_DOCKER_TESTS !== '1') {
  console.log('skip - the gate tests against real Docker need S5_DOCKER_TESTS=1');
} else if (NO_REFLINK_HERE) {
  console.log(`not ok - the gate tests against real Docker need a reflink filesystem: ${NO_REFLINK_HERE}`);
  process.exitCode = 1;
} else {
  await dockerTests();
}

async function dockerTests() {
  let seq = 0;
  const idOf = (what) => `t7-${process.pid}-${what}-${++seq}`;
  const CARGO_LOCK = '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "tiny"\nversion = "0.1.0"\n';
  const cratePlain = { 'Cargo.toml': CARGO_TOML, 'Cargo.lock': CARGO_LOCK, 'tests/visible.rs': VISIBLE_RS };
  const leftover = (id) => {
    const r = spawnSync('docker', ['ps', '-aq', '--filter', `label=s5.task=${id}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  // The task for a tiny crate: `parent` and `fix` are the two commits' files.
  const crate = ({ id, parent, fix, hidden = HIDDEN_RS, defOver = {} }) => makeScene({
    parentFiles: { ...cratePlain, ...parent },
    fixFiles: { ...fix, 'tests/hidden.rs': hidden },
    defOver: { id, ...defOver },
  });

  await ta('docker, cargo: the gate passes a task whose test fails by assertion at the parent and passes three times at the fix; the warm target is used', async () => {
    const id = idOf('ok');
    const sc = crate({ id, parent: { 'src/lib.rs': LIB_P }, fix: { 'src/lib.rs': LIB_FIX } });
    const w = await warmTask(sc.manifest, { workRoot: sc.workRoot, cpus: 2, memoryGb: 4 });
    assert.equal(w.ok, true, JSON.stringify(w));
    assert.ok(lstatSync(join(sc.taskDir, 'target')).isDirectory());
    assert.ok(existsSync(join(sc.taskDir, 'target', 'debug')), 'the build container wrote the warm target');
    assert.ok(existsSync(join(sc.workRoot, 'cargo-home')));
    assert.deepEqual(warmDirs(sc), []);

    const g = await gateTask(sc.manifest, { workRoot: sc.workRoot, cpus: 2, memoryGb: 4 });
    assert.deepEqual(g.reasons, [], JSON.stringify(g, null, 1));
    assert.equal(g.ok, true);
    assert.deepEqual(g.atParent.f2p, phase([], F2P), 'at the parent the F2P test fails');
    assert.deepEqual(g.atParent.p2p, phase(P2P));
    assert.equal(g.atFix.length, 3);
    for (const run of g.atFix) {
      assert.equal(run.pass, true);
      assert.deepEqual(run.f2p, phase(F2P));
    }
    assert.deepEqual(JSON.parse(readFileSync(join(sc.taskDir, 'gate.json'), 'utf8')).reasons, []);
    assert.deepEqual(gateDirs(sc), []);
    assert.equal(leftover(id), '', 'no container of this task is left');
  });

  await ta('docker, cargo: an F2P test that already passes at the parent is dropped (f2p_passes_at_parent)', async () => {
    const id = idOf('passes');
    const sc = crate({ id, parent: { 'src/lib.rs': LIB_FIX }, fix: { 'src/lib.rs': `${LIB_FIX}pub fn unrelated() {}\n` } });
    const g = await gateTask(sc.manifest, { workRoot: sc.workRoot, cpus: 2, memoryGb: 4 });
    assert.deepEqual(g.reasons, ['f2p_passes_at_parent'], JSON.stringify(g, null, 1));
    assert.equal(g.ok, false);
    assert.equal(g.atParent.f2p.passed.length, 1);
    assert.equal(g.atFix.length, 3, 'the fix runs still ran');
    assert.equal(leftover(id), '');
  });

  await ta('docker, cargo: hidden tests that do not compile at the parent are dropped (compile_at_parent), and still pass at the fix', async () => {
    const id = idOf('compile');
    const hidden = 'use tiny::add_checked;\n\n#[test]\nfn add_works() {\n    assert_eq!(add_checked(2, 3), Some(5));\n}\n';
    const sc = crate({
      id, hidden, parent: { 'src/lib.rs': LIB_FIX }, fix: { 'src/lib.rs': `${LIB_FIX}pub fn add_checked(a: i32, b: i32) -> Option<i32> {\n    a.checked_add(b)\n}\n` },
    });
    const g = await gateTask(sc.manifest, { workRoot: sc.workRoot, cpus: 2, memoryGb: 4 });
    assert.deepEqual(g.reasons, ['compile_at_parent'], JSON.stringify(g, null, 1));
    assert.equal(g.atParent.build, 'failed');
    assert.ok(g.atFix.every((run) => run.pass === true), 'the fix compiles and passes');
    assert.equal(leftover(id), '');
  });

  await ta('docker, cargo: a fix that does not pass the hidden test fails the gate three times (fails_at_fix)', async () => {
    const id = idOf('broken');
    const sc = crate({ id, parent: { 'src/lib.rs': LIB_P }, fix: { 'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 {\n    a * b\n}\n' } });
    const g = await gateTask(sc.manifest, { workRoot: sc.workRoot, cpus: 2, memoryGb: 4 });
    assert.deepEqual(g.reasons, ['fails_at_fix'], JSON.stringify(g, null, 1));
    assert.equal(g.atFix.length, 3);
    assert.equal(leftover(id), '');
  });

  // ---- node (plugins image) ----
  const NODE_HEAD = "import assert from 'node:assert/strict';\nconst t = (name, fn) => {\n  try { fn(); console.log(`ok - ${name}`); } catch (e) { console.log(`not ok - ${name}`); console.log(String(e.stack)); process.exitCode = 1; }\n};\n";
  const nodeTask = ({ id, parentLib, fixLib, hidden }) => makeScene({
    parentFiles: { 'Cargo.toml': null, 'src/lib.rs': null, 'tests/visible.rs': null, 'lib.mjs': parentLib, 'tests/visible.test.mjs': `${NODE_HEAD}import { add } from '../lib.mjs';\nt('existing', () => assert.equal(add(0, 0), 0));\n` },
    fixFiles: { 'src/lib.rs': null, 'tests/hidden.rs': null, 'lib.mjs': fixLib, 'tests/hidden.test.mjs': hidden },
    defOver: {
      id,
      repo: 'claude-plugins',
      testRunner: 'node',
      hidden: { files: ['tests/hidden.test.mjs'] },
      buildCommand: ['node', '--check', 'lib.mjs'],
      f2p: { command: ['node', 'tests/hidden.test.mjs'], names: ['plus'] },
      p2p: { command: ['node', 'tests/visible.test.mjs'], names: ['existing'] },
    },
  });

  await ta('docker, node: a test that fails by assertion at the parent passes the gate', async () => {
    const id = idOf('node-ok');
    const sc = nodeTask({
      id,
      parentLib: 'export const add = (a, b) => a - b;\nexport const plus = add;\n',
      fixLib: 'export const add = (a, b) => a + b;\nexport const plus = add;\n',
      hidden: `${NODE_HEAD}import { plus } from '../lib.mjs';\nt('plus', () => assert.equal(plus(2, 3), 5));\n`,
    });
    const g = await gateTask(sc.manifest, { workRoot: sc.workRoot, cpus: 2, memoryGb: 4 });
    assert.deepEqual(g.reasons, [], JSON.stringify(g, null, 1));
    assert.equal(g.ok, true);
    assert.deepEqual(g.atParent.nonAssertion, []);
    assert.deepEqual(g.atParent.f2p.failed, ['plus']);
    assert.equal(leftover(id), '');
  });

  await ta('docker, node: a ReferenceError at the parent is dropped (non_assertion_failure): the test names a symbol the parent lacks', async () => {
    const id = idOf('node-ref');
    const sc = nodeTask({
      id,
      parentLib: 'export const add = (a, b) => a + b;\n',
      fixLib: 'export const add = (a, b) => a + b;\nglobalThis.plus = add;\n',
      hidden: `${NODE_HEAD}import '../lib.mjs';\nt('plus', () => assert.equal(plus(2, 3), 5));\n`,
    });
    const g = await gateTask(sc.manifest, { workRoot: sc.workRoot, cpus: 2, memoryGb: 4 });
    assert.deepEqual(g.reasons, ['non_assertion_failure'], JSON.stringify(g, null, 1));
    assert.deepEqual(g.atParent.nonAssertion, ['plus']);
    assert.ok(g.atFix.every((run) => run.pass === true));
    assert.equal(leftover(id), '');
  });

  await ta('docker: no container of these tests is left behind', async () => {
    const r = spawnSync('docker', ['ps', '-aq', '--filter', 'label=s5=1', '--filter', `name=${process.pid}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '');
  });
}
