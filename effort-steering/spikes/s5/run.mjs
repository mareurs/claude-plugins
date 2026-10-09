// run.mjs — the S5 runner. This file holds the PLAN and the ONE RUN:
//
//   planRunsS5(prereg, { mode, taskIds? }) -> Run[]            (below, ruling R84)
//   runOne(run, ctx) -> Promise<Row>                           (one agent run in a container, classified and graded: see "runOne")
//
// The plan:
//
//   planRunsS5(prereg, { mode, taskIds? }) -> Run[]
//     Run = { runId, taskId, taskIndex, arm, effort, steer, rep, round }
//
// The order is what the batch runner executes and resumes from (ruling R84), and it is a function of the registration alone, so a
// resumed batch plans the same runs in the same order and matches its rows by runId.
//
//   runId      `<taskId>.<arm>.<rep>`: deterministic, so a row on disk names the run it belongs to. A task id is a letter or digit
//              and then letters, digits and dashes, 48 characters at most (task-def's TASK_ID_RE, ruling R92: it is a path segment,
//              and the run id with an attempt suffix must fit grade.mjs's 64-character run id), and an arm is one capital letter,
//              so the id reads back unambiguously from its right end. The id of one ATTEMPT (the session id of a re-run) is a
//              fresh UUID the runner chooses; it is not part of a Run.
//   taskIndex  the task's index in prereg.tasks, the registered order. A taskIds filter never renumbers it.
//   arm/effort/steer   A, B or C, and that arm's registered effort and steer.
//   rep        0-based, within the task and arm.   round   0-based position in the task's own order.
//
// ORDER. Each task's arm-reps are listed A's reps 0..runs-1, then B's, then C's, and shuffled by Fisher-Yates from the end,
// j = floor(rng() * (i + 1)), with rng = makeRng(prereg.orderSeed, 11 + taskIndex): one stream per task, so a task's order does
// not depend on which other tasks are planned. The plan is the rounds in turn; round k holds the k-th entry of every task that
// has one, the tasks in registered order. An arm with `runs: 0` has no entries (loadS5Config allows it, ruling R2).
//
// MODES.
//   measure    the registration itself: refused unless prereg.registered === true (the marker only loadS5Prereg sets, ruling R59),
//              and refused with taskIds.
//   pilot, calibrate   the same plan for the given arms, on prereg.tasks or the tasks named in taskIds (ids unique, order of the
//              registration). They accept what loadS5Prereg or loadS5Config returns.
//   smoke      one run, rep 0, per arm with runs > 0, on ONE task: the one task named in taskIds, else the first registered task.
//              More than one distinct id in taskIds is refused, naming them (ruling R94: whoever passes two expects two); a repeated
//              id is one task. It is ordered by the same shuffle as the other modes.
// An id in taskIds that prereg.tasks does not list is refused by name, in every mode that takes ids.
//
// `prereg` is trusted to be what a loader returns (shape and numbers are checked there); it is never written to: the loaders
// freeze it at every depth. planRunsS5 reads no file, runs no process and calls no model.

import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync, mkdirSync, readFileSync, statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRng, shuffle } from '../s4-prng.mjs';
import { decisionFromLog } from '../s4-rows.mjs';
import { hashBuiltTask, reflinkCopy } from './build-task.mjs';
import { dockerRun } from './docker.mjs';
import {
  gradeTree, readResultFile, removeGradeDir, RUN_ID_RE,
} from './grade.mjs';
import { NETWORK, PROXY_URL } from './proxy.mjs';
import { IMAGE_FOR_REPO, TASK_ID_RE } from './task-def.mjs';
import {
  finalTextTail, firstUserText, readRunUsage, testsRunBeforeDone,
} from './usage.mjs';

const MODES = ['measure', 'calibrate', 'pilot', 'smoke'];
const ARMS = ['A', 'B', 'C'];
// Task k's order is drawn from stream 11 + k of the registered orderSeed.
const ORDER_STREAM = 11;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => JSON.stringify(v) ?? String(v);

// The tasks to plan, as { task, taskIndex } in the registered order.
function selectTasks(prereg, mode, taskIds) {
  const all = prereg.tasks.map((task, taskIndex) => ({ task, taskIndex }));
  if (mode === 'smoke') return taskIds === undefined ? all.slice(0, 1) : all.filter(({ task }) => task.id === taskIds[0]);
  if (taskIds === undefined) return all;
  const wanted = new Set(taskIds);
  return all.filter(({ task }) => wanted.has(task.id));
}

export function planRunsS5(prereg, options) {
  if (!isObject(prereg)) throw new TypeError(`planRunsS5: prereg must be the object loadS5Prereg or loadS5Config returns, got ${show(prereg)}`);
  const mode = options?.mode;
  if (!MODES.includes(mode)) throw new TypeError(`planRunsS5: mode must be one of ${MODES.join(', ')}, got ${show(mode)}`);
  const taskIds = options.taskIds;

  if (mode === 'measure') {
    if (prereg.registered !== true) {
      throw new Error('planRunsS5: mode measure needs a registration (the object loadS5Prereg returns, registered true); this object is not one (a pilot or calibration config never is)');
    }
    if (taskIds !== undefined) throw new Error('planRunsS5: mode measure plans the whole registration, so taskIds is refused');
  }
  if (taskIds !== undefined) {
    if (!Array.isArray(taskIds) || taskIds.length === 0 || !taskIds.every((id) => typeof id === 'string')) {
      throw new TypeError(`planRunsS5: taskIds must be a non-empty array of task ids, got ${show(taskIds)}`);
    }
    const distinct = [...new Set(taskIds)];
    if (mode === 'smoke' && distinct.length > 1) {
      throw new Error(`planRunsS5: mode smoke plans one task, but taskIds names ${distinct.length}: ${distinct.map(show).join(', ')}`);
    }
    const registered = new Set(prereg.tasks.map((task) => task.id));
    const unknown = taskIds.filter((id) => !registered.has(id));
    if (unknown.length > 0) {
      throw new Error(`planRunsS5: taskIds names ${unknown.length === 1 ? 'a task' : 'tasks'} the prereg does not list: ${unknown.map(show).join(', ')}`);
    }
  }

  const perTask = selectTasks(prereg, mode, taskIds).map(({ task, taskIndex }) => {
    const entries = ARMS.flatMap((arm) => {
      const reps = mode === 'smoke' ? Math.min(prereg.arms[arm].runs, 1) : prereg.arms[arm].runs;
      return Array.from({ length: reps }, (_, rep) => ({ arm, rep }));
    });
    return { task, taskIndex, order: shuffle(entries, makeRng(prereg.orderSeed, ORDER_STREAM + taskIndex)) };
  });

  const rounds = Math.max(0, ...perTask.map(({ order }) => order.length));
  const plan = [];
  for (let round = 0; round < rounds; round++) {
    for (const { task, taskIndex, order } of perTask) {
      if (round >= order.length) continue;
      const { arm, rep } = order[round];
      const { effort, steer } = prereg.arms[arm];
      plan.push({ runId: `${task.id}.${arm}.${rep}`, taskId: task.id, taskIndex, arm, effort, steer, rep, round });
    }
  }
  return plan;
}

// ---- runOne ----
//
//   runOne(run, ctx) -> Promise<Row>       one agent run in a container, classified and graded.
//
// This is the one place where "what happened in this run" is decided: an infrastructure failure (re-run, never scored) versus a model
// failure (scored) versus a pass. A wrong classification silently biases the measured result, so the order of the decision is fixed
// (ruling R87) and every step of it is pinned by a test that fails when it is removed or reordered. runOne makes ONE attempt; the
// batch (Task 10c) decides what to do with an infrastructure row: re-run it, count it, stop.
//
//   run   a Run from planRunsS5.
//   ctx   { prereg, workRoot, hookCopy, claudeBin, attempt, dockerBin, grade, network, proxyUrl, images, tokenEnv, keepRunDirs }
//     prereg       the frozen object a loader returned: read, never mutated. The model, and limits.{timeoutMinutes, cpus, memoryGb}.
//     workRoot     <workRoot>/tasks/<id>/{tree,hidden,manifest.json,prompt.txt[,target]}, <workRoot>/cargo-home, <workRoot>/runs.
//     hookCopy     { copyDir, settingsFile } from writeHookCopy; copyDir is mounted read-only at /opt/es (R93).
//     claudeBin    host path of the Claude Code binary, mounted read-only at /opt/claude/claude. Default (R75):
//                  <HOME>/.local/share/claude/versions/<prereg.cli.version>.
//     attempt      1-based. The container is `s5-<runId>-a<attempt>` and the run directory `<workRoot>/runs/<runId>-a<attempt>`.
//     dockerBin    the docker executable (a seam for tests).        grade   the grader (a seam), default gradeTree.
//     network      default NETWORK (the proxy network); the proxy control passes 'bridge'.
//     proxyUrl     default PROXY_URL; null means no HTTPS_PROXY variable at all.
//     images       { repo: image reference }, default IMAGE_FOR_REPO[manifest.repo]. The grade runs in the same image.
//     tokenEnv     the variable of THIS process that holds the OAuth token, default CLAUDE_CODE_OAUTH_TOKEN.
//     keepRunDirs  keep the copies of the tree and the target after the run (debugging). Default false.
//
// BEFORE anything is made, runOne throws (no row, no run directory, no container) on: inputs it cannot use, a token variable that is
// not set (the message names the variable, never a value), a prompt.txt whose sha256 is not the manifest's promptHash (R99), and a run
// directory that already exists (it is never reused). A docker that cannot start also throws, after the cleanup below.
//
// WHAT IT DOES, in this order.
//   1. The run directory: `work` and, when the task has a warm target, `target` are reflink copies of tasks/<id>/tree and
//      tasks/<id>/target (the agent edits the copies; NOTHING under tasks/<id>/ is ever mounted or written); `config` and `state` are
//      empty directories.
//   2. The container, via dockerRun, with the grader's own paths (R74): /work, /target (CARGO_TARGET_DIR), /cargo read-only, user
//      agent. The Claude binary, the hook copy and the cargo home are read-only; config and state are /run/config and /run/state. Every
//      environment variable goes by NAME (the value lives only in the docker process's environment, never in argv).
//   3. The invocation (R93, R75), with the prompt as ONE argv element after `--`, the exact text of prompt.txt (R99).
//   4. The classification, FIRST MATCH WINS (R87); every infrastructure value gives a non-final row without a grade:
//        (1) create_failed | inspect_failed | rm_failed     what dockerRun reports about the container
//        (2) oom                                            OOMKilled, whatever the exit status
//        (3) transcript_unreadable (readRunUsage threw) | no_transcript | ambiguous_transcript
//        (4) api_error                                      an API-error record in the MAIN transcript (a subagent's is recorded only)
//        (5) no_log | arm_mismatch                          the decision log (R89): B must be treated and steered, A and C held out
//        (6) effort_mismatch                                the transcript's efforts are not exactly [run.effort]
//        (7) a timeout is a FINAL model failure (R90): infra null, grade null, never graded, whatever its tree would score
//        (8) hidden_changed                                 the hidden dir no longer hashes to manifest.hiddenHash (R101)
//            grade_failed                                   gradeTree threw, or returned something that is no grade
//            grade_<infra>                                  the grade's own infra, after the grade and two re-grades on the SAME tree
//   5. The cleanup, on EVERY path including a throw: `work` and `target` are removed (removeGradeDir handles a directory the container
//      made read-only) unless keepRunDirs; `config` and `state` stay, the transcript is the evidence. A directory that could not be
//      removed is reported as the Row's `leftover` (a list). When docker never ran the container, the run directory is removed
//      altogether, so the same attempt can be made again.
//
// THE ROW. The brief's Row { runId, taskId, taskIndex, arm, effort, rep, round, sessionId, startedAt, wallMs, exit, infra, final,
// decision, usage, efforts, costUsd, numTurns, firstUserTextOk, testsRunBeforeDone, finalTextTail, grade }, plus `isError` (R88, from
// the stdout JSON) and, only when something is left over, `leftover`.
//   exit     { code: dockerRun's status, timedOut, oomKilled }.         final   infra === null (R100: the batch decides exhaustion).
//   usage    what readRunUsage returned, with transcriptPath and every subagentFiles entry RELATIVE to the run directory; null when it
//            threw. costUsd, numTurns, isError: the stdout JSON's total_cost_usd, num_turns and is_error (R88); null when stdout is not
//            one JSON object or the field is not a usable number / boolean. Never infrastructure.
//   firstUserTextOk   the transcript's first user message equals the prompt after trimEnd() on both sides (R99); null without a transcript.
//   testsRunBeforeDone, finalTextTail   from the transcript, with the task's testPatterns and the last 300 characters; null / '' without one.
//   grade    the grade that stood, or null (a timeout, R90, or any infrastructure row).
// A row never holds the token. The transcript text is scrubbed of it before finalTextTail is cut, and a row that would still hold it is
// never returned (runOne throws, after the cleanup).

const AGENT_USER = 'agent';
const WORKDIR = '/work';
// A grade, and up to two re-grades on the same tree when the grade itself ends in infrastructure (R87).
const GRADE_ATTEMPTS = 3;
const FINAL_TEXT_CHARS = 300;
const MAX_LOG_BYTES = 1024 * 1024;
const REDACTED = '[redacted]';
// docker.mjs's rule for an environment variable name.
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
// The variables runOne sets itself; the token's variable may not be one of them.
const OWN_ENV = ['CLAUDE_CONFIG_DIR', 'XDG_STATE_HOME', 'EFFORT_STEERING_HOLDOUT_RATE', 'HTTPS_PROXY', 'CARGO_TARGET_DIR'];
// The decision each arm must have been given by the hook (R89): only B is steered.
const EXPECTED_DECISION = Object.freeze({ B: { arm: 'treated', steered: true }, A: { arm: 'holdout', steered: false }, C: { arm: 'holdout', steered: false } });

const refuse = (message) => new TypeError(`runOne: ${message}`);
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
function statOrNull(p, stat = statSync) {
  try {
    return stat(p);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}

// Everything runOne needs from its two arguments, checked before anything is made. Throws a TypeError (an input) or an Error (the
// world is not ready: no token, no binary).
function resolveInputs(run, ctx) {
  if (!isObject(run)) throw refuse(`run must be a Run from planRunsS5, got ${show(run)}`);
  if (!isObject(ctx)) throw refuse(`ctx must be an object, got ${show(ctx)}`);
  for (const key of ['runId', 'taskId', 'effort']) {
    if (typeof run[key] !== 'string' || run[key] === '') throw refuse(`run.${key} must be a non-empty string, got ${show(run[key])}`);
  }
  if (!TASK_ID_RE.test(run.taskId)) throw refuse(`run.taskId must match ${TASK_ID_RE} (it is a path segment), got ${show(run.taskId)}`);
  if (!ARMS.includes(run.arm)) throw refuse(`run.arm must be one of ${ARMS.join(', ')}, got ${show(run.arm)}`);
  if (run.steer !== (run.arm === 'B')) throw refuse(`run.steer must be ${run.arm === 'B'} for arm ${run.arm} (only B steers), got ${show(run.steer)}`);
  if (!Number.isSafeInteger(ctx.attempt) || ctx.attempt < 1) throw refuse(`ctx.attempt must be a positive integer, got ${show(ctx.attempt)}`);
  const attemptId = `${run.runId}-a${ctx.attempt}`;
  // The grade ids are `<attemptId>-g<n>`; gradeTree throws on one it does not accept, and that would look like a grader failure.
  if (!RUN_ID_RE.test(`${attemptId}-g${GRADE_ATTEMPTS}`)) {
    throw refuse(`run.runId ${show(run.runId)} with the attempt and grade suffixes must match ${RUN_ID_RE}, got ${show(`${attemptId}-g${GRADE_ATTEMPTS}`)}`);
  }

  const { prereg } = ctx;
  if (!isObject(prereg) || typeof prereg.model !== 'string' || prereg.model === '' || !isObject(prereg.limits)) {
    throw refuse('ctx.prereg must be the object a loader returns (a model and limits)');
  }
  const { timeoutMinutes, cpus, memoryGb } = prereg.limits;
  for (const [what, value] of [['timeoutMinutes', timeoutMinutes], ['cpus', cpus], ['memoryGb', memoryGb]]) {
    if (!positive(value)) throw refuse(`ctx.prereg.limits.${what} must be a positive number, got ${show(value)}`);
  }
  if (typeof ctx.workRoot !== 'string' || ctx.workRoot === '') throw refuse(`ctx.workRoot must be a non-empty string, got ${show(ctx.workRoot)}`);
  if (typeof ctx.grade !== 'function' && ctx.grade !== undefined) throw refuse(`ctx.grade must be a function when given, got ${show(ctx.grade)}`);
  const network = ctx.network ?? NETWORK;
  const proxyUrl = ctx.proxyUrl === undefined ? PROXY_URL : ctx.proxyUrl;
  if (typeof network !== 'string' || network === '') throw refuse(`ctx.network must be a non-empty string, got ${show(network)}`);
  if (proxyUrl !== null && (typeof proxyUrl !== 'string' || proxyUrl === '')) throw refuse(`ctx.proxyUrl must be a non-empty string or null, got ${show(proxyUrl)}`);
  if (ctx.images !== undefined && !isObject(ctx.images)) throw refuse(`ctx.images must be an object of repo to image, got ${show(ctx.images)}`);

  const { hookCopy } = ctx;
  if (!isObject(hookCopy) || typeof hookCopy.copyDir !== 'string' || statOrNull(hookCopy.copyDir)?.isDirectory() !== true) {
    throw refuse(`ctx.hookCopy.copyDir must be the directory writeHookCopy made, got ${show(hookCopy?.copyDir)}`);
  }
  const claudeBin = ctx.claudeBin ?? path.join(os.homedir(), '.local', 'share', 'claude', 'versions', String(prereg.cli?.version));
  if (typeof claudeBin !== 'string' || statOrNull(claudeBin)?.isFile() !== true) {
    throw refuse(`the Claude binary ${show(claudeBin)} is not a file (ctx.claudeBin, or <HOME>/.local/share/claude/versions/<prereg.cli.version>)`);
  }

  // The token: its VALUE is read here and goes nowhere but dockerRun's env option. No message below names it.
  const tokenEnv = ctx.tokenEnv ?? 'CLAUDE_CODE_OAUTH_TOKEN';
  if (typeof tokenEnv !== 'string' || !ENV_NAME_RE.test(tokenEnv) || OWN_ENV.includes(tokenEnv)) {
    throw refuse(`ctx.tokenEnv must be an environment variable name that runOne does not set itself, got ${show(tokenEnv)}`);
  }
  const token = process.env[tokenEnv];
  if (typeof token !== 'string' || token === '') throw new Error(`runOne: the environment variable ${tokenEnv} is not set (it holds the Claude Code OAuth token)`);

  return {
    attemptId, prereg, workRoot: path.resolve(ctx.workRoot), hookCopy, claudeBin, tokenEnv, token, network, proxyUrl, images: ctx.images,
    dockerBin: ctx.dockerBin, grade: ctx.grade ?? gradeTree, keepRunDirs: ctx.keepRunDirs === true, attempt: ctx.attempt,
  };
}

// The built task as the batch left it: its manifest, the prompt (checked against the manifest, R99), and which directories it has.
function loadTask(taskDir, run) {
  const manifestFile = path.join(taskDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch (err) {
    throw new Error(`runOne: cannot read ${manifestFile} (the task is not built, or the file is damaged): ${err.message}`);
  }
  if (!isObject(manifest) || manifest.id !== run.taskId || typeof manifest.repo !== 'string' || !isObject(manifest.def) || !Array.isArray(manifest.def.testPatterns)
    || typeof manifest.promptHash !== 'string' || typeof manifest.hiddenHash !== 'string') {
    throw new Error(`runOne: ${manifestFile} is not the manifest of task ${show(run.taskId)} that buildTask writes`);
  }
  const promptFile = path.join(taskDir, 'prompt.txt');
  let bytes;
  try {
    bytes = readFileSync(promptFile);
  } catch (err) {
    throw new Error(`runOne: cannot read ${promptFile} (buildTask writes it, ruling R98): ${err.message}`);
  }
  const actual = sha256Hex(bytes);
  if (actual !== manifest.promptHash) {
    throw new Error(`runOne: ${promptFile} hashes to ${actual}, not to the manifest's promptHash ${manifest.promptHash} (R99): the task is not the one that was built`);
  }
  // Copies are made of tree/ and target/ with cp -a, which would copy a link as a link: they are real directories or nothing.
  const tree = statOrNull(path.join(taskDir, 'tree'), lstatSync);
  if (tree === null || !tree.isDirectory()) throw new Error(`runOne: ${path.join(taskDir, 'tree')} is not a directory (a link is not a tree)`);
  const target = statOrNull(path.join(taskDir, 'target'), lstatSync);
  if (target !== null && !target.isDirectory()) throw new Error(`runOne: ${path.join(taskDir, 'target')} exists but is not a directory`);
  return { manifest, prompt: bytes.toString('utf8'), hasTarget: target !== null };
}

function imageFor(repo, images) {
  const own = (map) => (map !== undefined && Object.hasOwn(map, repo) ? map[repo] : undefined);
  const chosen = own(images) ?? own(IMAGE_FOR_REPO);
  if (typeof chosen !== 'string' || chosen === '') {
    throw refuse(`no image for repo ${show(repo)}: IMAGE_FOR_REPO has none and ctx.images gives ${show(chosen)}`);
  }
  return chosen;
}

// R88: the JSON object `claude --output-format json` prints. Anything else is null, and never an infrastructure failure.
function resultOf(stdout) {
  let obj;
  try {
    obj = JSON.parse(stdout);
  } catch {
    obj = null;
  }
  if (!isObject(obj)) return { costUsd: null, numTurns: null, isError: null };
  return {
    costUsd: Number.isFinite(obj.total_cost_usd) && obj.total_cost_usd >= 0 ? obj.total_cost_usd : null,
    numTurns: Number.isInteger(obj.num_turns) && obj.num_turns >= 0 ? obj.num_turns : null,
    isError: typeof obj.is_error === 'boolean' ? obj.is_error : null,
  };
}

// A grade is what gradeTree returns: an object with an `infra` (null or a reason) and a boolean `pass`. Anything else did not come
// from a grader that finished.
const isGrade = (g) => isObject(g) && (g.infra === null || (typeof g.infra === 'string' && g.infra !== '')) && typeof g.pass === 'boolean';

// R87 steps (1) to (6): the infrastructure value of a run that ended in a container, or null. First match wins.
function infraOf(run, docker, evidence) {
  if (!docker.created) return 'create_failed';
  if (!docker.inspectOk) return 'inspect_failed'; // dockerRun: oomKilled is null exactly when the inspect did not answer (or no container)
  if (!docker.rmOk) return 'rm_failed';
  if (docker.oomKilled === true) return 'oom';
  if (evidence.usage === null) return 'transcript_unreadable';
  if (evidence.usage.reason !== null) return evidence.usage.reason;
  if (evidence.usage.apiError) return 'api_error';
  if (evidence.decision === null) return 'no_log';
  const want = EXPECTED_DECISION[run.arm];
  if (evidence.decision.arm !== want.arm || evidence.decision.steered !== want.steered) return 'arm_mismatch';
  const { efforts } = evidence.usage;
  if (efforts.length !== 1 || efforts[0] !== run.effort) return 'effort_mismatch';
  return null;
}

// R87 step (8): the hidden dir is what the manifest hashed (R101), then the grade, re-graded on the same tree while it ends in
// infrastructure of its own. -> { infra, grade }: grade is the one that stood, null on any infrastructure.
async function gradeRun(o) {
  let hiddenHash = null;
  try {
    hiddenHash = hashBuiltTask(o.taskDir).hiddenHash;
  } catch {
    // a built task that cannot be hashed (hidden/ is gone) is not the one that was built
  }
  if (hiddenHash !== o.manifest.hiddenHash) return { infra: 'hidden_changed', grade: null };
  let last = null;
  for (let n = 1; n <= GRADE_ATTEMPTS; n += 1) {
    let g;
    try {
      g = await o.grade(o.manifest, o.workDir, { ...o.gradeOptions, runId: `${o.attemptId}-g${n}` });
    } catch {
      return { infra: 'grade_failed', grade: null };
    }
    if (!isGrade(g)) return { infra: 'grade_failed', grade: null };
    if (g.infra === null) return { infra: null, grade: g };
    last = g;
  }
  return { infra: `grade_${last.infra}`, grade: null };
}

// The cleanup of a run directory. -> the directories that could not be removed.
function dispose(runDir, { ran, threw }) {
  const leftover = [];
  for (const name of ['work', 'target']) {
    const dir = path.join(runDir, name);
    if (removeGradeDir(dir).leftover !== null) leftover.push(dir);
  }
  // A container that never ran left no evidence: the whole directory goes, and the attempt can be made again.
  if (threw && !ran) removeGradeDir(runDir);
  return leftover;
}

export async function runOne(run, ctx) {
  const o = resolveInputs(run, ctx);
  const taskDir = path.join(o.workRoot, 'tasks', run.taskId);
  const { manifest, prompt, hasTarget } = loadTask(taskDir, run);
  const image = imageFor(manifest.repo, o.images);
  const cargoHome = path.join(o.workRoot, 'cargo-home');
  const hasCargoHome = statOrNull(cargoHome)?.isDirectory() === true;

  const runsDir = path.join(o.workRoot, 'runs');
  const runDir = path.join(runsDir, o.attemptId);
  mkdirSync(runsDir, { recursive: true });
  try {
    mkdirSync(runDir); // atomic: an attempt's directory is never reused, and a second runOne for it cannot pass
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`runOne: the run directory ${runDir} already exists; an attempt is never made twice (the batch asks for the next attempt)`);
    throw err;
  }
  const dir = { work: path.join(runDir, 'work'), target: path.join(runDir, 'target'), config: path.join(runDir, 'config'), state: path.join(runDir, 'state') };

  const state = { ran: false };
  let row;
  let failure = null;
  try {
    reflinkCopy(path.join(taskDir, 'tree'), dir.work);
    if (hasTarget) reflinkCopy(path.join(taskDir, 'target'), dir.target);
    mkdirSync(dir.config);
    mkdirSync(dir.state);

    const sessionId = randomUUID();
    const { limits, model } = o.prereg;
    const mounts = [
      { host: dir.work, container: WORKDIR },
      ...(hasTarget ? [{ host: dir.target, container: '/target' }] : []),
      ...(hasCargoHome ? [{ host: cargoHome, container: '/cargo', readOnly: true }] : []),
      { host: dir.config, container: '/run/config' },
      { host: dir.state, container: '/run/state' },
      { host: o.hookCopy.copyDir, container: '/opt/es', readOnly: true },
      { host: o.claudeBin, container: '/opt/claude/claude', readOnly: true },
    ];
    const env = {
      CLAUDE_CONFIG_DIR: '/run/config',
      XDG_STATE_HOME: '/run/state',
      EFFORT_STEERING_HOLDOUT_RATE: run.arm === 'B' ? '0' : '1',
      ...(o.proxyUrl === null ? {} : { HTTPS_PROXY: o.proxyUrl }),
      ...(hasTarget ? { CARGO_TARGET_DIR: '/target' } : {}),
      [o.tokenEnv]: o.token,
    };
    const cmd = [
      '/opt/claude/claude', '-p', '--model', model, '--effort', run.effort, '--session-id', sessionId, '--setting-sources', 'local',
      '--settings', '/opt/es/settings.json', '--strict-mcp-config', '--thinking-display', 'summarized', '--dangerously-skip-permissions',
      '--disallowedTools', 'WebFetch', 'WebSearch', '--output-format', 'json', '--', prompt,
    ];
    const startedAt = new Date().toISOString();
    const docker = await dockerRun({
      image,
      name: `s5-${o.attemptId}`,
      labels: { 's5.task': run.taskId, 's5.arm': run.arm },
      cpus: limits.cpus,
      memoryGb: limits.memoryGb,
      network: o.network,
      mounts,
      env,
      workdir: WORKDIR,
      user: AGENT_USER,
      cmd,
      timeoutMs: Math.round(limits.timeoutMinutes * 60_000),
      stdin: 'null',
    }, { dockerBin: o.dockerBin });
    state.ran = true;

    // What the run left behind. Read whatever there is, then classify: the row of an infrastructure failure carries the evidence too.
    const logText = readResultFile(path.join(dir.state, 'effort-steering', `${sessionId}.jsonl`), MAX_LOG_BYTES);
    const decision = logText === null ? null : decisionFromLog(logText);
    let usage = null;
    let text = null;
    try {
      usage = readRunUsage(dir.config, sessionId);
      // The agent's words can hold anything it printed, the token included. It is scrubbed here, before any of it is cut or stored.
      if (usage.transcriptPath !== null) text = readFileSync(usage.transcriptPath, 'utf8').split(o.token).join(REDACTED);
    } catch {
      usage = null;
      text = null;
    }
    let infra = infraOf(run, docker, { usage, decision });
    let grade = null;
    // R90: a timed-out run is the model's failure and is not graded. R87 puts every infrastructure step before this one.
    if (infra === null && !docker.timedOut) {
      ({ infra, grade } = await gradeRun({
        taskDir,
        manifest,
        grade: o.grade,
        workDir: dir.work,
        attemptId: o.attemptId,
        gradeOptions: { workRoot: o.workRoot, image, ...(o.dockerBin === undefined ? {} : { dockerBin: o.dockerBin }), cpus: limits.cpus, memoryGb: limits.memoryGb },
      }));
    }

    const first = text === null ? null : firstUserText(text);
    row = {
      runId: run.runId,
      taskId: run.taskId,
      taskIndex: run.taskIndex,
      arm: run.arm,
      effort: run.effort,
      rep: run.rep,
      round: run.round,
      sessionId,
      startedAt,
      wallMs: docker.wallMs,
      exit: { code: docker.status, timedOut: docker.timedOut, oomKilled: docker.oomKilled },
      infra,
      final: infra === null,
      decision,
      usage: usage === null ? null : {
        ...usage,
        transcriptPath: usage.transcriptPath === null ? null : path.relative(runDir, usage.transcriptPath),
        subagentFiles: usage.subagentFiles.map((file) => path.relative(runDir, file)),
      },
      efforts: usage === null ? [] : usage.efforts,
      ...resultOf(docker.stdout),
      firstUserTextOk: text === null ? null : first !== null && first.trimEnd() === prompt.trimEnd(),
      testsRunBeforeDone: text === null ? null : testsRunBeforeDone(text, manifest.def.testPatterns),
      finalTextTail: text === null ? '' : finalTextTail(text, FINAL_TEXT_CHARS),
      grade,
    };
    // The last line of defence: whatever else was stored, the token is not in the row.
    if (JSON.stringify(row).includes(o.token)) throw new Error(`runOne: the row of ${o.attemptId} would hold the token (the value of ${o.tokenEnv}); it is not returned`);
  } catch (err) {
    failure = err;
  }
  const leftover = o.keepRunDirs ? [] : dispose(runDir, { ran: state.ran, threw: failure !== null });
  if (failure !== null) throw failure;
  return leftover.length === 0 ? row : { ...row, leftover };
}
