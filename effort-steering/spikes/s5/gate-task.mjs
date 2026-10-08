// gate-task.mjs — the S5 warm build and the task gate.
//
//   warmTask(manifest, { workRoot, baseTarget, image, dockerBin, cpus, memoryGb, timeouts, runId })
//     -> Promise<{ skipped: 'not cargo' } | { ok, fetch, build, buildCommand, target, leftover }>
//   gateTask(manifest, { workRoot, image, dockerBin, cpus, memoryGb, timeouts, grade })
//     -> Promise<{ ok, reasons, atParent, atFix, treeHash, hiddenHash, gatedAt }>
//   gateReasons(runner, atParent, atFix) -> string[]       (the mapping, a pure function)
//
// `image` defaults to IMAGE_FOR_REPO[manifest.repo] (a caller that pins image ids passes its own). Every function
// that starts a container takes `dockerBin`. `timeouts` and `cpus`/`memoryGb` go through to the grades and containers.
//
// ---- warmTask: the first build of a cargo task, so that no grade pays for a cold one ----
//
// Cargo fingerprints are path-sensitive, so the warm target is built in the same image, as the same user, with the tree
// at /work and CARGO_TARGET_DIR=/target: the paths a grade has. Two containers, both labelled s5=1 and s5.task=<id>:
//   (1) fetch  s5-warm-fetch-<id>: the default bridge network (the only container with a route out), CARGO_NET_OFFLINE=false,
//              `cargo fetch --locked` in a reflink copy of the task tree at /work, <workRoot>/cargo-home rw at /cargo
//              (CARGO_HOME=/cargo). No model and no build script runs here.
//   (2) build  s5-warm-build-<id>: network none, a fresh reflink copy of the P tree at /work (no graft), the task's target
//              <workRoot>/tasks/<id>/target rw at /target (CARGO_TARGET_DIR=/target; reflinked from `baseTarget` when
//              given, and refused if it already exists), /cargo read-only, and def.buildCommand.
// The build runs whatever the fetch did: a failed fetch leaves the build to say what is missing. warmTask RETURNS on a
// failed build (ok false: the gate then reports it) and throws only for a caller's error or a docker that cannot start.
// `ok` is: the build container exited 0 with no infrastructure state. The warm target stays only then (a half-built
// one is removed, so `target exists` means `warmed`, and a retry can warm again). Each of fetch and build is
// { exit, wallMs, tail, infra }: the container's exit status, its wall time, the last 2000 characters of its output,
// and grade.mjs's infraOf of it. `buildCommand` is def.buildCommand, the feature set the target was built with (R21).
// The reflink copies are removed afterwards.
//
// ---- gateTask: the three gates of the spec ("Gates for each built task"), through gradeTree only ----
//
// The gate grades the P tree once (at the parent: the hidden tests grafted in) and the fix tree three times, each grade
// being gradeTree's one container, so the gate and the measured run share one grader. The fix tree is built by
// treeAtFix under <workRoot>/gate/<id>-<12 hex>/ and removed afterwards (kept under S5_KEEP_GRADES=1); the files the
// fix changes are stamped as new as the call, or cargo would call them fresh against the warm target built from the
// P tree and grade the parent's artifacts. A grade that
// ends in infrastructure (or throws) is retried up to twice, with a fresh run id; one that still does is `infra`.
// The series stops at the first grade that stays infra: the gate cannot judge, and says so.
//
// Reasons (a fixed order, each once). The gate is ok when none but `manual_review_needed` is present.
//   infra                  a grade stayed in infrastructure after its retries
//   build_timeout          a build timed out at the parent or at the fix: the task's timeoutsSec is too low to judge
//   compile_at_parent      the hidden tests do not compile at the parent (they name a symbol it lacks)
//   f2p_passes_at_parent   an F2P name passes at the parent
//   non_assertion_failure  an F2P or P2P name fails at the parent by something other than an assertion (node only)
//   hidden_test_not_run    an F2P or P2P name did not run: at the parent with an ok build, or in a fix run; also when
//                          nothing was built at the parent because the graft failed
//   p2p_fails_at_parent    a P2P name fails at the parent
//   fails_at_fix           all three runs at the fix fail
//   flaky_at_fix           one or two of the three runs fail
//   manual_review_needed   (sh) an sh test cannot tell an assertion from another failure: a person reads it
//
// gate.json, <workRoot>/tasks/<id>/gate.json = { ok, reasons, atParent, atFix, treeHash, hiddenHash, gatedAt }, is
// written atomically (a temp file, then rename over the old one) and is also what gateTask returns. atParent and each
// atFix entry are gradeTree's result plus `attempts`. The hashes are the manifest's: a runner refuses a task whose
// gate.json is missing, not ok, or whose hashes differ from the manifest's. Each fix run's wallMs is the whole grade
// (graft, build, tests), the warm-hit check: a cold build would show as minutes.

import { randomBytes } from 'node:crypto';
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { reflinkCopy, treeAtFix } from './build-task.mjs';
import { dockerRun } from './docker.mjs';
import { gradeTree, infraOf, removeGradeDir } from './grade.mjs';
import { IMAGE_FOR_REPO } from './task-def.mjs';

const ID_RE = /^[a-z0-9-]+$/;
const RUN_ID_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/;
export const FIX_RUNS = 3;
// A grade, and up to two more when it ends in infrastructure.
export const MAX_ATTEMPTS = 3;
// The warm containers' own wall clocks. The build is a COLD build of the whole task, far longer than the warm builds
// the task's timeoutsSec is sized for.
const FETCH_SEC = 15 * 60;
const WARM_BUILD_SEC = 60 * 60;
const TAIL_CHARS = 2000;
const DETAIL_CHARS = 500;

const lstatOrNull = (p) => {
  try {
    return lstatSync(p);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};
const isDir = (p) => lstatOrNull(p)?.isDirectory() === true;
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

// ---- the reasons ----

export const GATE_REASONS = Object.freeze([
  'infra', 'build_timeout', 'compile_at_parent', 'f2p_passes_at_parent', 'non_assertion_failure', 'hidden_test_not_run', 'p2p_fails_at_parent', 'fails_at_fix', 'flaky_at_fix', 'manual_review_needed',
]);
const NON_FAILING = new Set(['manual_review_needed']);
const notRun = (g) => g.f2p.notRun.length + g.p2p.notRun.length > 0;

// gateReasons(runner, atParent, atFix) -> the reasons, deduplicated, in GATE_REASONS' order. atParent is a grade result,
// atFix the list of fix runs (all three, unless the series stopped at an infrastructure run). A grade whose `infra` is
// anything but null is not judged by its names: it is `infra`, and nothing else is read from it.
export function gateReasons(runner, atParent, atFix) {
  const found = new Set();
  const judged = (g) => g.infra === null;
  if (!judged(atParent) || atFix.some((g) => !judged(g))) found.add('infra');

  if (judged(atParent)) {
    if (atParent.build === 'failed') found.add('compile_at_parent');
    else if (atParent.build === 'timeout') found.add('build_timeout');
    else if (atParent.build !== 'ok') found.add('hidden_test_not_run'); // the graft failed: no hidden test was put in place
    else {
      if (atParent.f2p.passed.length > 0) found.add('f2p_passes_at_parent');
      if (notRun(atParent)) found.add('hidden_test_not_run');
      if (atParent.nonAssertion.length > 0) found.add('non_assertion_failure');
      if (atParent.p2p.failed.length > 0) found.add('p2p_fails_at_parent');
    }
  }

  const runs = atFix.filter(judged);
  for (const run of runs) {
    if (run.build === 'timeout') found.add('build_timeout');
    if (notRun(run)) found.add('hidden_test_not_run');
  }
  // fails or flaky is only told from three judged runs: a series that stopped early says `infra` instead.
  if (atFix.length === FIX_RUNS && runs.length === FIX_RUNS) {
    const failed = runs.filter((run) => run.pass !== true).length;
    if (failed === FIX_RUNS) found.add('fails_at_fix');
    else if (failed > 0) found.add('flaky_at_fix');
  }

  if (runner === 'sh') found.add('manual_review_needed');
  return GATE_REASONS.filter((reason) => found.has(reason));
}

// ---- inputs ----

function requireManifest(who, manifest) {
  if (manifest === null || typeof manifest !== 'object') throw new TypeError(`${who}: the manifest must be an object`);
  if (typeof manifest.id !== 'string' || !ID_RE.test(manifest.id)) throw new TypeError(`${who}: manifest.id must match ${ID_RE}, got ${JSON.stringify(manifest.id)}`);
  const { def } = manifest;
  if (def === null || typeof def !== 'object') throw new TypeError(`${who}: the manifest has no def`);
  if (typeof def.testRunner !== 'string') throw new TypeError(`${who}: def.testRunner must be a string`);
}
function requireWorkRoot(who, workRoot) {
  if (typeof workRoot !== 'string' || workRoot === '') throw new TypeError(`${who}: workRoot must be a non-empty string`);
  return resolve(workRoot);
}
function imageFor(who, manifest, image) {
  const chosen = image ?? IMAGE_FOR_REPO[manifest.repo]; // a prototype member (`constructor`) is not a string either
  if (typeof chosen !== 'string' || chosen === '') {
    throw new TypeError(`${who}: no image: repo ${JSON.stringify(manifest.repo)} has none in IMAGE_FOR_REPO and the image option is ${JSON.stringify(image)}`);
  }
  return chosen;
}
// The options that go through to a container or a grade, left out when not given.
const passed = (options) => Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));

// ---- grading with retries ----

const isNames = (p) => p !== null && typeof p === 'object' && ['passed', 'failed', 'notRun'].every((k) => Array.isArray(p[k]));
const isGrade = (g) => g !== null && typeof g === 'object' && 'infra' in g && typeof g.build === 'string' && isNames(g.f2p) && isNames(g.p2p) && Array.isArray(g.nonAssertion);

// What stands in for a grade that never came back (it threw, or answered with something else): in a grade's own shape,
// with nothing run, so that nothing reads it as a pass.
function stillborn(def, infra, detail) {
  return {
    infra,
    graft: 'not_run',
    build: 'not_run',
    f2p: { passed: [], failed: [], notRun: [...(def.f2p?.names ?? [])] },
    p2p: { passed: [], failed: [], notRun: [...(def.p2p?.names ?? [])] },
    nonAssertion: [],
    pass: false,
    diff: null,
    wallMs: 0,
    detail: String(detail).slice(0, DETAIL_CHARS),
    kept: null,
    leftover: null,
  };
}

async function tryGrade(grade, manifest, treeDir, options) {
  let r;
  try {
    r = await grade(manifest, treeDir, options);
  } catch (err) {
    return stillborn(manifest.def, 'grade_failed', err?.message ?? err);
  }
  return isGrade(r) ? r : stillborn(manifest.def, 'bad_grade_result', `the grade returned ${JSON.stringify(r) ?? String(r)}`);
}

// One grade, retried while it ends in infrastructure: -> the grade that stood, plus `attempts`.
async function gradeWithRetries(ctx, manifest, treeDir, label) {
  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    last = await tryGrade(ctx.grade, manifest, treeDir, { ...ctx.options, runId: `gate-${ctx.gateId}-${label}-${attempt}` });
    if (last.infra === null) return { ...last, attempts: attempt };
  }
  return { ...last, attempts: MAX_ATTEMPTS };
}

// tmp + rename: a reader sees the old record or the whole new one, and a gate.json that is a symlink is replaced, never written through.
function writeGateJson(taskDir, result) {
  const final = join(taskDir, 'gate.json');
  const tmp = join(taskDir, `.gate.json.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'wx');
    try {
      writeSync(fd, `${JSON.stringify(result, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, final);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// ---- the gate ----

export async function gateTask(manifest, options = {}) {
  const { workRoot, image: imageOption, dockerBin, cpus, memoryGb, timeouts, grade = gradeTree } = options ?? {};
  requireManifest('gateTask', manifest);
  for (const key of ['treeHash', 'hiddenHash']) {
    if (typeof manifest[key] !== 'string' || manifest[key] === '') throw new TypeError(`gateTask: manifest.${key} must be a non-empty string`);
  }
  const root = requireWorkRoot('gateTask', workRoot);
  if (typeof grade !== 'function') throw new TypeError('gateTask: the grade option must be a function');
  const image = imageFor('gateTask', manifest, imageOption);
  const taskDir = join(root, 'tasks', manifest.id);
  const tree = join(taskDir, 'tree');
  for (const dir of [tree, join(taskDir, 'hidden')]) {
    if (!isDir(dir)) throw new Error(`gateTask: ${dir} is not a directory (build the task first)`);
  }

  const ctx = { grade, gateId: randomBytes(6).toString('hex'), options: passed({ workRoot: root, image, dockerBin, cpus, memoryGb, timeouts }) };
  const atParent = await gradeWithRetries(ctx, manifest, tree, 'p');
  const atFix = [];
  if (atParent.infra === null) {
    const gateDir = join(root, 'gate', `${manifest.id}-${ctx.gateId}`);
    mkdirSync(gateDir, { recursive: true });
    try {
      const fixTree = join(gateDir, 'tree');
      // Graded against its own one commit, as the P tree is against the task commit.
      const fixManifest = { ...manifest, baseCommit: treeAtFix(manifest, tree, fixTree) };
      for (let i = 1; i <= FIX_RUNS; i += 1) {
        const run = await gradeWithRetries(ctx, fixManifest, fixTree, `f${i}`);
        atFix.push(run);
        if (run.infra !== null) break;
      }
    } finally {
      if (process.env.S5_KEEP_GRADES !== '1') removeGradeDir(gateDir);
    }
  }

  const reasons = gateReasons(manifest.def.testRunner, atParent, atFix);
  const result = {
    ok: reasons.every((reason) => NON_FAILING.has(reason)),
    reasons,
    atParent,
    atFix,
    treeHash: manifest.treeHash,
    hiddenHash: manifest.hiddenHash,
    gatedAt: new Date().toISOString(),
  };
  writeGateJson(taskDir, result);
  return result;
}

// ---- the warm build ----

export async function warmTask(manifest, options = {}) {
  const { workRoot, baseTarget, image: imageOption, dockerBin, cpus, memoryGb, timeouts = {}, runId } = options ?? {};
  requireManifest('warmTask', manifest);
  const root = requireWorkRoot('warmTask', workRoot);
  if (runId !== undefined && (typeof runId !== 'string' || !RUN_ID_RE.test(runId))) throw new TypeError(`warmTask: runId must match ${RUN_ID_RE}, got ${JSON.stringify(runId)}`);
  for (const [what, value] of [['timeouts.fetch', timeouts?.fetch], ['timeouts.build', timeouts?.build], ['cpus', cpus], ['memoryGb', memoryGb]]) {
    if (value !== undefined && !positive(value)) throw new TypeError(`warmTask: ${what} must be a positive number when given, got ${JSON.stringify(value)}`);
  }
  const { def } = manifest;
  if (def.testRunner !== 'cargo') return { skipped: 'not cargo' };
  if (!Array.isArray(def.buildCommand) || def.buildCommand.length === 0 || def.buildCommand.some((a) => typeof a !== 'string' || a === '')) {
    throw new TypeError('warmTask: def.buildCommand must be a non-empty array of non-empty strings');
  }
  const image = imageFor('warmTask', manifest, imageOption);
  const taskDir = join(root, 'tasks', manifest.id);
  const tree = join(taskDir, 'tree');
  const target = join(taskDir, 'target');
  if (!isDir(tree)) throw new Error(`warmTask: ${tree} is not a directory (build the task first)`);
  if (lstatOrNull(target) !== null) throw new Error(`warmTask: ${target} already exists; remove it first (a warm target is never built over)`);
  if (baseTarget !== undefined && !isDir(baseTarget)) throw new Error(`warmTask: baseTarget ${JSON.stringify(baseTarget)} is not a directory`);

  const cargoHome = join(root, 'cargo-home');
  mkdirSync(cargoHome, { recursive: true });
  const warmId = runId ?? randomBytes(6).toString('hex');
  mkdirSync(join(root, 'warm'), { recursive: true });
  const scratch = join(root, 'warm', `${manifest.id}-${warmId}`);
  mkdirSync(scratch); // atomic: a warm in progress is never merged into

  const run = async (name, extra, seconds) => {
    const r = await dockerRun({
      image, name, labels: { 's5.task': manifest.id }, ...passed({ cpus, memoryGb }), workdir: '/work', user: 'agent', stdin: 'null', timeoutMs: seconds * 1000, ...extra,
    }, { dockerBin });
    return { exit: r.status, wallMs: r.wallMs, tail: `${r.stdout}${r.stderr}`.trim().slice(-TAIL_CHARS), infra: infraOf(r) };
  };

  let outcome = null;
  let failure = null;
  let madeTarget = false;
  try {
    const fetchWork = join(scratch, 'fetch-work');
    reflinkCopy(tree, fetchWork);
    const fetch = await run(`s5-warm-fetch-${warmId}`, {
      network: 'bridge',
      mounts: [{ host: fetchWork, container: '/work' }, { host: cargoHome, container: '/cargo' }],
      env: { CARGO_NET_OFFLINE: 'false', CARGO_HOME: '/cargo' },
      cmd: ['cargo', 'fetch', '--locked'],
    }, timeouts?.fetch ?? FETCH_SEC);

    const buildWork = join(scratch, 'build-work');
    reflinkCopy(tree, buildWork);
    if (baseTarget === undefined) mkdirSync(target);
    else reflinkCopy(baseTarget, target);
    madeTarget = true;
    const build = await run(`s5-warm-build-${warmId}`, {
      network: 'none',
      mounts: [{ host: buildWork, container: '/work' }, { host: target, container: '/target' }, { host: cargoHome, container: '/cargo', readOnly: true }],
      env: { CARGO_TARGET_DIR: '/target' },
      cmd: def.buildCommand,
    }, timeouts?.build ?? WARM_BUILD_SEC);
    outcome = { ok: build.exit === 0 && build.infra === null, fetch, build };
  } catch (err) {
    failure = err;
  }
  const disposal = removeGradeDir(scratch);
  if (madeTarget && outcome?.ok !== true) removeGradeDir(target);
  if (failure !== null) throw failure;
  return { ...outcome, buildCommand: def.buildCommand, target: outcome.ok ? target : null, leftover: disposal.leftover };
}
