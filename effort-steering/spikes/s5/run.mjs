// run.mjs — the S5 runner. This file holds the PLAN, the ONE RUN and the BATCH:
//
//   planRunsS5(prereg, { mode, taskIds? }) -> Run[]            (below, ruling R84)
//   runOne(run, ctx) -> Promise<Row>                           (one agent run in a container, classified and graded: see "runOne")
//   scrubRunDirs(runsRoot, token) -> { dirs, files, failed }   (the scrub of runOne's step 5 over the run directories of earlier batches, R117)
//   runBatch(prereg, { mode, workRoot, rowsFile, ... }) -> Promise<Summary>   (the batch layer: preflight, the rows file, resume, retries, the cost stop rule, signals, smoke; see "runBatch")
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

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, createReadStream, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, truncateSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng, shuffle } from '../s4-prng.mjs';
import { decisionFromLog } from '../s4-rows.mjs';
import { hashBuiltTask, hashHidden, reflinkCopy } from './build-task.mjs';
import { costOf } from './cost.mjs';
import { DOCKER_PASSTHROUGH, dockerRun, removeLabeled } from './docker.mjs';
import {
  gradeTree, infraOf, readResultFile, removeGradeDir, RUN_ID_RE,
} from './grade.mjs';
import { writeHookCopy } from './hook-copy.mjs';
import { checkTasksMatch } from './prereg.mjs';
import {
  NETWORK, PROXY_IMAGE, PROXY_NAME, PROXY_URL,
} from './proxy.mjs';
import { IMAGE_FOR_REPO, TASK_ID_RE } from './task-def.mjs';
import {
  finalTextTail, firstUserText, hookContexts, readRunUsage, testsRunBeforeDone,
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
//     images       { repo: image reference }, default IMAGE_FOR_REPO[manifest.repo]. When it is given it must name the task's repo (R112:
//                  a TypeError otherwise, no fall back to IMAGE_FOR_REPO). The grade runs in the same image.
//     tokenEnv     the variable of THIS process that holds the OAuth token, default CLAUDE_CODE_OAUTH_TOKEN.
//     keepRunDirs  keep the copies of the tree and the target after the run (debugging). Default false.
//
// BEFORE anything is made, runOne throws (no row, no run directory, no container) on: inputs it cannot use, a token variable that is
// not set (the message names the variable, never a value), a prompt.txt whose sha256 is not the manifest's promptHash (R99), that is not
// valid UTF-8 (R111) or that holds a NUL byte (R118: a process argument cannot), and a run directory that already exists (it is never
// reused). A docker that cannot start also throws, after the cleanup below.
//
// WHAT IT DOES, in this order.
//   1. The run directory: `work` and, when the task has a warm target, `target` are reflink copies of tasks/<id>/tree and
//      tasks/<id>/target (the agent edits the copies; NOTHING under tasks/<id>/ is ever mounted or written); `config` and `state` are
//      empty directories.
//   2. The container, via dockerRun, with the grader's own paths (R74): /work, /target (CARGO_TARGET_DIR), /cargo read-only, user
//      agent. The Claude binary, the hook copy and the cargo home are read-only; config and state are /run/config and /run/state. Every
//      environment variable goes by NAME (the value lives only in the docker process's environment, never in argv).
//   3. The invocation (R93, R75), with the prompt as ONE argv element after `--`, the exact text of prompt.txt (R99).
//   4. The classification, FIRST MATCH WINS; every infrastructure value gives a non-final row without a grade:
//        (1) (2) the container, by grade.mjs's infraOf on the dockerRun result with timedOut forced false (R105, which revises R87's
//            order): create_failed, then oom (OOMKilled, whatever the exit status), then inspect_failed, then rm_failed, so a failed
//            removal never hides an OOM kill
//        (2b) interrupted                                   the container's exit status is 130, 137 or 143 and it did not time out (R132): cut off by a
//                                                           signal that was not the harness's own timeout, a partial run, never graded
//        (3) transcript_unreadable (readRunUsage threw) | no_transcript | ambiguous_transcript
//        (4) api_error                                      an API-error record in the MAIN transcript (a subagent's is recorded only)
//        (5) no_log | arm_mismatch                          the decision log (R89): B must be treated and steered, A and C held out
//        (6) effort_mismatch                                the transcript's efforts are not exactly [run.effort]
//        (6b) steer_mismatch                                (R147) the steer did not reach the model as the arm says: the UserPromptSubmit hook contexts of the main
//                                                           transcript (hookContexts) are not exactly [the shallow sentence] for B, or are not none for A and C. The sentence
//                                                           is phrases.shallow of the hook copy's core/steer.table.json, read when the run starts. The decision log (5) is
//                                                           written BEFORE the policy CLI prints, and the hook kills the CLI after 500 ms and fails open, so it cannot show
//                                                           that the steer arrived; the transcript can.
//        (7) a timeout is a FINAL model failure (R90): infra null, grade null, never graded, whatever its tree would score
//        (8) hidden_changed                                 the hidden dir no longer hashes to manifest.hiddenHash (R101), through
//                                                           hashHidden: a run does not read the whole tree (R109); the tree and the prompt
//                                                           are the batch preflight's business
//            grade_failed                                   gradeTree threw, or returned something that is no grade
//            grade_<infra>                                  the grade's own infra, after the grade and two re-grades on the SAME tree
//   5. The scrub (R108), on every path that reached the container, a throw included, after the usage was read and before the row guard:
//      every regular file under `config` and `state` (never following a link) has every occurrence of the token's bytes replaced by
//      [REDACTED]; a file that does not hold the token is not rewritten. The Row's `tokenScrubbed` counts the files that held it: 0
//      normally, and above 0 in the pilot it is the measurement that the CLI exposes the token to its tools. A file that cannot be
//      rewritten stops the row. runOne never sets CLAUDE_CODE_SUBPROCESS_ENV_SCRUB (the CLI's opt-in scrub of its subprocess
//      environment: it switches off --dangerously-skip-permissions and needs bubblewrap in the image, a different instrument) nor
//      GITHUB_ACTIONS; the exact list of the container's variables is pinned by a test.
//   6. The cleanup, on EVERY path including a throw: `work` and `target` are removed (removeGradeDir handles a directory the container
//      made read-only) unless keepRunDirs; `config` and `state` stay, the transcript is the evidence. A directory that could not be
//      removed is reported as the Row's `leftover` (a list). When docker never ran the container, the run directory is removed
//      altogether, so the same attempt can be made again.
//
// THE ROW. The brief's Row { runId, taskId, taskIndex, arm, effort, rep, round, sessionId, startedAt, wallMs, exit, infra, final,
// decision, usage, efforts, costUsd, numTurns, firstUserTextOk, testsRunBeforeDone, finalTextTail, grade }, plus `isError` (R88, from
// the stdout JSON), `steerContexts` (R147: how many UserPromptSubmit hook contexts the main transcript holds; null without a transcript),
// `tokenScrubbed` (R108), `infraDetail` (R110: only on an infrastructure row a caught error made, that is
// transcript_unreadable, grade_failed and a hidden_changed whose hash threw: the error's message, the token redacted before the line is
// cut to 300 characters) and, only when something is left over, `leftover`.
//   exit     { code: dockerRun's status, timedOut, oomKilled }.         final   infra === null (R100: the batch decides exhaustion).
//   usage    what readRunUsage returned, with transcriptPath and every subagentFiles entry RELATIVE to the run directory; null when it
//            threw. costUsd, numTurns, isError: the stdout JSON's total_cost_usd, num_turns and is_error (R88); null when stdout is not
//            one JSON object or the field is not a usable number / boolean. Never infrastructure.
//   firstUserTextOk   the transcript's first user message equals the prompt after trimEnd() on both sides (R99); null without a transcript.
//   testsRunBeforeDone, finalTextTail   from the transcript, with the task's testPatterns and the last 300 characters; null / '' without one.
//   grade    the grade that stood, or null (a timeout, R90, or any infrastructure row).
// A row never holds the token. The transcript text is scrubbed of it before finalTextTail is cut, config/ and state/ are scrubbed in place
// (step 5), and a row that would still hold it is never returned (runOne throws, after the cleanup). The row guard sees a WHOLE,
// contiguous token only: a token split over two text blocks could leave a fragment in finalTextTail (R113).
//
// WHAT runs/ HOLDS AFTERWARDS (R116). When runOne returns a row, `config` and `state` hold no whole token. These are NOT scrubbed, so a
// whole token can be on disk in four cases:
//   1. `work` and `target` kept by keepRunDirs (the agent can write the token into /work; they are the operator's debugging copies);
//   2. a `work` or `target` that could not be removed (the Row's `leftover`);
//   3. a file the scrub could not rewrite (the row is then not returned, and the thrown error names the count and the first path);
//   4. an attempt that was interrupted (a signal, a crash during the container or the grade): it never reached the scrub and has no row.
// For case 4 the batch calls scrubRunDirs (below, R117) at its start, before the first run, and refuses to start when it returns `failed`.

const AGENT_USER = 'agent';
// R132: the exit statuses of a container cut off by SIGINT, SIGKILL and SIGTERM (128 + the signal).
const INTERRUPTED_EXITS = Object.freeze([130, 137, 143]);
const WORKDIR = '/work';
// A grade, and up to two re-grades on the same tree when the grade itself ends in infrastructure (R87).
const GRADE_ATTEMPTS = 3;
const FINAL_TEXT_CHARS = 300;
const MAX_LOG_BYTES = 1024 * 1024;
const REDACTED = '[REDACTED]';
// A caught error's message in a row (infraDetail, R110) is cut to this many characters.
const MAX_DETAIL_CHARS = 300;
// A transcript or a log larger than this is not read into memory to be scrubbed (it is reported as a file the scrub failed on).
const MAX_SCRUB_BYTES = 1 << 30;
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
// R147: the sentence arm B must have been given, as the hook is told to say it: phrases.shallow of the steer table in the hook copy (the
// copy of effort-steering/core/steer.table.json the container mounts at /opt/es), read when the run starts and never written in this file.
// A copy whose table cannot give one refuses the run before anything is made.
function steerPhraseOf(hookCopyDir) {
  const file = path.join(hookCopyDir, 'core', 'steer.table.json');
  let table;
  try {
    table = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw refuse(`cannot read ${file}, the steer table of the hook copy (R147: the sentence B must have been given is read from it): ${err.message}`);
  }
  const phrase = isObject(table) && isObject(table.phrases) ? table.phrases.shallow : undefined;
  if (typeof phrase !== 'string' || phrase === '') throw refuse(`${file} has no non-empty phrases.shallow (R147: it is the sentence B must have been given)`);
  return phrase;
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
  const steerPhrase = steerPhraseOf(hookCopy.copyDir);
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
    attemptId, prereg, workRoot: path.resolve(ctx.workRoot), hookCopy, steerPhrase, claudeBin, tokenEnv, token, network, proxyUrl, images: ctx.images,
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
  // R111: the prompt reaches the CLI as text on argv. Bytes that are not UTF-8 would come out as U+FFFD, the argv would not be the file,
  // and firstUserTextOk would compare against the decoded text. buildTask refuses such a prompt; this is the defence for a task built before.
  const prompt = bytes.toString('utf8');
  if (!Buffer.from(prompt, 'utf8').equals(bytes)) throw new Error(`runOne: ${promptFile} is not valid UTF-8; the prompt must reach the CLI byte for byte (R111)`);
  // R118: a NUL byte is valid UTF-8, but a process argument cannot hold one: spawn would throw after the run directory and the copies exist.
  if (bytes.includes(0)) throw new Error(`runOne: ${promptFile} contains a NUL byte; the prompt is passed to the CLI as one process argument, which cannot hold one (R118)`);
  // Copies are made of tree/ and target/ with cp -a, which would copy a link as a link: they are real directories or nothing.
  const tree = statOrNull(path.join(taskDir, 'tree'), lstatSync);
  if (tree === null || !tree.isDirectory()) throw new Error(`runOne: ${path.join(taskDir, 'tree')} is not a directory (a link is not a tree)`);
  const target = statOrNull(path.join(taskDir, 'target'), lstatSync);
  if (target !== null && !target.isDirectory()) throw new Error(`runOne: ${path.join(taskDir, 'target')} exists but is not a directory`);
  return { manifest, prompt, hasTarget: target !== null };
}

// The image of the task's repo: ctx.images when it is given (and then it must name the repo, R112: a registration that pins images does
// not silently run a repo in the tag IMAGE_FOR_REPO happens to hold), else IMAGE_FOR_REPO.
function imageFor(repo, images) {
  const table = images === undefined ? IMAGE_FOR_REPO : images;
  if (!Object.hasOwn(table, repo)) {
    throw refuse(`no image for repo ${show(repo)}: ${images === undefined ? 'IMAGE_FOR_REPO has none' : `ctx.images is given and has no entry for it (it has ${show(Object.keys(images))})`}`);
  }
  const chosen = table[repo];
  if (typeof chosen !== 'string' || chosen === '') throw refuse(`the image for repo ${show(repo)} must be a non-empty string, got ${show(chosen)}`);
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

// R87 steps (3) to (6b), what the run left behind: the infrastructure value, or null. First match wins. (The container's own state, steps
// (1) and (2), is grade.mjs's infraOf, called on the dockerRun result: R105.)
function evidenceInfra(run, evidence) {
  if (evidence.usage === null) return 'transcript_unreadable';
  if (evidence.usage.reason !== null) return evidence.usage.reason;
  if (evidence.usage.apiError) return 'api_error';
  if (evidence.decision === null) return 'no_log';
  const want = EXPECTED_DECISION[run.arm];
  if (evidence.decision.arm !== want.arm || evidence.decision.steered !== want.steered) return 'arm_mismatch';
  const { efforts } = evidence.usage;
  if (efforts.length !== 1 || efforts[0] !== run.effort) return 'effort_mismatch';
  // (6b) R147: the steer must have REACHED the model. The decision log is written before the policy CLI prints its result, and the hook kills
  // the CLI after 500 ms and then fails open with no steer, so a log that says steered proves nothing about the transcript. B: exactly one
  // UserPromptSubmit hook context, equal to the shallow sentence; A and C: none. A context of any other shape is a mismatch too.
  const wantSteer = run.arm === 'B' ? [evidence.steerPhrase] : [];
  const { contexts } = evidence;
  if (contexts.length !== wantSteer.length || contexts.some((context, i) => context !== wantSteer[i])) return 'steer_mismatch';
  return null;
}

// An error as one short line for a row (infraDetail, R110): its message, else its code, else its name. The token is redacted FIRST, so that
// the cut cannot leave the front of one behind, and the line is then cut to MAX_DETAIL_CHARS.
function detailOf(err, token) {
  const said = err instanceof Error ? (err.message || err.code || err.name) : err;
  return String(said).split(token).join(REDACTED).slice(0, MAX_DETAIL_CHARS);
}

// R108: one file of config/ or state/, scrubbed in place. A regular file only (opened with O_NOFOLLOW: a link is skipped, never followed);
// every occurrence of the token's bytes becomes [REDACTED]; a file that does not hold the token is only read, never rewritten, so its
// time and its inode stay. -> true when it held the token. Throws when it held it and could not be rewritten.
function scrubFile(file, tokenBytes) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    if (err.code === 'ELOOP' || err.code === 'ENOENT') return false;
    throw err;
  }
  let bytes;
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return false;
    if (st.size > MAX_SCRUB_BYTES) throw new Error(`${file} is larger than ${MAX_SCRUB_BYTES} bytes`);
    bytes = readFileSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!bytes.includes(tokenBytes)) return false;
  const parts = [];
  let from = 0;
  for (let at = bytes.indexOf(tokenBytes); at !== -1; at = bytes.indexOf(tokenBytes, from)) {
    parts.push(bytes.subarray(from, at), Buffer.from(REDACTED));
    from = at + tokenBytes.length;
  }
  parts.push(bytes.subarray(from));
  const out = openSync(file, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(out).isFile()) throw new Error(`${file} is no longer a regular file`);
    writeFileSync(out, Buffer.concat(parts));
  } finally {
    closeSync(out);
  }
  return true;
}

// R108: scrubFile over every regular file below each root. -> { files: how many held the token, failed: the paths it could not handle }.
function scrubTree(roots, token) {
  const tokenBytes = Buffer.from(token, 'utf8');
  let files = 0;
  const failed = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      failed.push(dir);
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try {
          if (scrubFile(p, tokenBytes)) files += 1;
        } catch {
          failed.push(p);
        }
      }
    }
  };
  for (const root of roots) walk(root);
  return { files, failed };
}


// scrubRunDirs(runsRoot, token) -> { dirs, files, failed }      (R117)
//
// The scrub of step 5, over the run directories an earlier batch left behind: scrubTree over config/ and state/ of every directory
// DIRECTLY under runsRoot (<workRoot>/runs). An attempt that was interrupted (a signal, a crash of the harness, during the container or the
// grade) never reached runOne's own scrub and left its config/ and state/ as the container wrote them, with no row; Task 10c calls this at
// the start of every batch, after the preflight and before the first run, and refuses to start when `failed` is not empty (the token would
// stay on disk). It is the same scrub, idempotent, never follows a link (not a link to a run directory, not a config/ or state/ that is a
// link, not a link inside them), never throws for a file it cannot rewrite (that file is returned in `failed`), and leaves work/ and
// target/ alone: those of a keepRunDirs run are the operator's debugging copies.
//   dirs     how many run directories had at least one file that held the token
//   files    how many files held it, in all of them
//   failed   the paths it could not list or rewrite (the first reason is not kept; the paths are the diagnosis)
// A runsRoot that does not exist is nothing to scrub: { dirs: 0, files: 0, failed: [] }.
export function scrubRunDirs(runsRoot, token) {
  if (typeof runsRoot !== 'string' || runsRoot === '') throw new TypeError(`scrubRunDirs: runsRoot must be a non-empty string, got ${show(runsRoot)}`);
  if (typeof token !== 'string' || token === '') throw new TypeError('scrubRunDirs: token must be a non-empty string');
  let entries;
  try {
    entries = readdirSync(runsRoot, { withFileTypes: true });
  } catch (err) {
    return { dirs: 0, files: 0, failed: err.code === 'ENOENT' || err.code === 'ENOTDIR' ? [] : [runsRoot] };
  }
  let dirs = 0;
  let files = 0;
  const failed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // a file, or a link (a link to a directory is not a run directory)
    const roots = [];
    for (const name of ['config', 'state']) {
      const root = path.join(runsRoot, entry.name, name);
      try {
        if (lstatSync(root).isDirectory()) roots.push(root); // a real directory: a link is not followed
      } catch (err) {
        if (err.code !== 'ENOENT') failed.push(root);
      }
    }
    const scrubbed = scrubTree(roots, token);
    if (scrubbed.files > 0) dirs += 1;
    files += scrubbed.files;
    failed.push(...scrubbed.failed);
  }
  return { dirs, files, failed };
}

// R87 step (8): the hidden dir is what the manifest hashed (R101, through hashHidden: a run does not read the whole tree, R109), then the
// grade, re-graded on the same tree while it ends in infrastructure of its own.
// -> { infra, grade, detail }: grade is the one that stood, null on any infrastructure; detail is what a caught error said (R110), else null.
async function gradeRun(o) {
  let hiddenHash = null;
  let hashError = null;
  try {
    hiddenHash = hashHidden(o.taskDir);
  } catch (err) {
    hashError = err; // hidden/ is gone or unreadable: not the one that was built
  }
  if (hiddenHash !== o.manifest.hiddenHash) return { infra: 'hidden_changed', grade: null, detail: hashError === null ? null : detailOf(hashError, o.token) };
  let last = null;
  for (let n = 1; n <= GRADE_ATTEMPTS; n += 1) {
    let g;
    try {
      g = await o.grade(o.manifest, o.workDir, { ...o.gradeOptions, runId: `${o.attemptId}-g${n}` });
    } catch (err) {
      return { infra: 'grade_failed', grade: null, detail: detailOf(err, o.token) };
    }
    if (!isGrade(g)) return { infra: 'grade_failed', grade: null, detail: 'the grader returned something that is no grade (an object with infra null or a reason, and a boolean pass)' };
    if (g.infra === null) return { infra: null, grade: g, detail: null };
    last = g;
  }
  return { infra: `grade_${last.infra}`, grade: null, detail: null };
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
    let usageError = null;
    try {
      usage = readRunUsage(dir.config, sessionId);
      // The agent's words can hold anything it printed, the token included. It is scrubbed here, before any of it is cut or stored.
      if (usage.transcriptPath !== null) text = readFileSync(usage.transcriptPath, 'utf8').split(o.token).join(REDACTED);
    } catch (err) {
      usage = null;
      text = null;
      usageError = err;
    }
    // R147: the UserPromptSubmit hook contexts of the MAIN transcript; null without one.
    const contexts = text === null ? null : hookContexts(text);
    // R87 (1), (2): the container, by grade.mjs's infraOf (R105: created, oom, inspect_failed, rm_failed, in that order, so a failed
    // removal never hides an OOM kill). timedOut is forced false: for the agent container a timeout is the model's failure (R90), not
    // the harness's. Then (2b) R132, and (3) to (6): what the run left behind.
    let infra = infraOf({ ...docker, timedOut: false });
    // (2b) R132: a container cut off by a signal that was not the harness's own timeout (SIGINT, SIGKILL, SIGTERM: 130, 137, 143) left a
    // partial run, whatever its transcript and decision log look like: never graded, never the model's failure. A timeout (137 with
    // timedOut) stays R90's.
    if (infra === null && !docker.timedOut && INTERRUPTED_EXITS.includes(docker.status)) infra = 'interrupted';
    infra ??= evidenceInfra(run, { usage, decision, contexts, steerPhrase: o.steerPhrase });
    let detail = infra === 'transcript_unreadable' ? detailOf(usageError, o.token) : null;
    let grade = null;
    // R90: a timed-out run is the model's failure and is not graded. R87 puts every infrastructure step before this one.
    if (infra === null && !docker.timedOut) {
      ({ infra, grade, detail } = await gradeRun({
        taskDir,
        manifest,
        grade: o.grade,
        token: o.token,
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
      ...(detail === null ? {} : { infraDetail: detail }),
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
      steerContexts: contexts === null ? null : contexts.length,
      tokenScrubbed: 0, // set below, after the scrub of config/ and state/
    };
  } catch (err) {
    failure = err;
  }
  // R108: whatever the container wrote under config/ and state/ is scrubbed of the token in place, on EVERY path that reached the
  // container (a throw included), after the usage was read and before the row guard. A file that cannot be scrubbed leaves the
  // token in the kept evidence, so it stops the row.
  if (state.ran) {
    const scrubbed = scrubTree([dir.config, dir.state], o.token);
    if (scrubbed.failed.length > 0) {
      // R116: a file that kept the token is said in the error that is thrown, whether or not another failure was already set (then that
      // one comes first and stays the cause). The first path is named with any token in it redacted: a file NAME can hold the token too.
      const said = `could not scrub the token from ${scrubbed.failed.length} file(s) of ${runDir} (the first: ${scrubbed.failed[0]})`;
      failure = failure === null
        ? new Error(`runOne: ${said.split(o.token).join(REDACTED)}; the row of ${o.attemptId} is not returned`)
        : new Error(`${failure instanceof Error ? failure.message : String(failure)} (and ${said})`.split(o.token).join(REDACTED), { cause: failure });
    } else if (failure === null) row.tokenScrubbed = scrubbed.files;
  }
  // The last line of defence: whatever else was stored, the token is not in the row (a whole, contiguous token; R113).
  if (failure === null && JSON.stringify(row).includes(o.token)) {
    failure = new Error(`runOne: the row of ${o.attemptId} would hold the token (the value of ${o.tokenEnv}); it is not returned`);
  }
  const leftover = o.keepRunDirs ? [] : dispose(runDir, { ran: state.ran, threw: failure !== null });
  if (failure !== null) throw failure;
  return leftover.length === 0 ? row : { ...row, leftover };
}

// ---- runBatch ----
//
//   runBatch(prereg, { mode, workRoot, rowsFile, concurrency, stopAtCostUsd, taskIds, retryExhausted, ctx }) -> Promise<Summary>
//
// The batch layer. It decides which runs start, in what order, how often an infrastructure failure is re-run, when the batch stops to save
// money, and what is written. The ROWS FILE is the study's only memory (R100): every rule below is recomputed from it, so a batch that was
// stopped, killed or resumed finds where it was and plans the same runs (planRunsS5 is a function of the registration alone).
//
//   prereg        what loadS5Prereg (mode measure) or loadS5Config (smoke, pilot, calibrate) returned. Read, never written.
//   concurrency   runOne calls in flight at most; default prereg.limits.concurrency.   stopAtCostUsd   default prereg.stopAtCostUsd.
//   retryExhausted   boolean, default false (R125): see "THE ROWS FILE".
//   ctx           runOne's ctx (claudeBin, dockerBin, network, proxyUrl, tokenEnv, keepRunDirs, grade, ...), passed on with prereg, workRoot,
//                 hookCopy, attempt, claudeBin and images added. Batch seams, optional, real by default, never passed on: runOne;
//                 imageIdOf(ref) -> id (`docker image inspect --format {{.Id}}`); sha256File(path) -> hex; proxyRunning() -> boolean (a
//                 running container labelled s5=1 and s5.run=s5-proxy); esRoot (the effort-steering directory the hook copy is made from);
//                 kill(pid, signal) (process.kill). A ctx.images of the caller is replaced by the ids below.
//   images        the ids the registration pins, for the repos of the planned tasks: after the preflight proved the images hold them, runOne
//                 runs ON the id (docker run sha256:...), so a tag moved during a 90-minute run changes nothing (R112 is why runOne takes it).
//
// BEFORE ANYTHING IS TOUCHED (read-only; a failure throws, names the item or the task, and writes nothing, not even the lock):
//   1  planRunsS5 owns the mode rules (R2, R59): measure needs prereg.registered === true and refuses taskIds.
//   2  each planned task (R91, R35, R101): gate.json exists, has ok === true and the manifest's treeHash and hiddenHash; tree/ (all but the
//      top-level .git), hidden/ and prompt.txt hash, through hashBuiltTask, to the manifest's treeHash, hiddenHash and promptHash.
//   3  checkTasksMatch is empty for the planned tasks; the id of each planned repo's image (IMAGE_FOR_REPO) and, on the default proxy network,
//      of the proxy image equal prereg.images; 'sha256:' + the Claude binary's hex equals prereg.cli.sha256 (R49, R75), hashed once.
//   4  <workRoot>/cargo-home is a directory when a planned task is a cargo task (R106b).   5  the proxy is running, when ctx.proxyUrl is not
//      null and ctx.network is the default.   6  the token variable (ctx.tokenEnv) is set and not empty.
//   The rows file is parsed once here as well: a damaged one, or one that holds a row of another mode (R133), refuses before the lock, the
//   sweep or the scrub.
//
// THEN, IN THIS ORDER (R123, R122, R117, R93):
//   the lock <workRoot>/batch.lock ({ pid, startedAt, mode, rowsFile }, taken with O_EXCL; a live holder, or one the batch cannot read,
//   refuses; a dead holder's lock is stale and replaced; a write that fails after the create removes the empty file (R134 d); released in a
//   finally, only if it still names us). The sweep and the scrub both
//   destroy a LIVE batch's work (its containers, the token in its config/ and state/), hence one batch per work root.
//   the signal handlers (R119; installed here, so that a signal during the read-only preflight, which has written nothing, keeps its default
//   action); the rows file read again (the lock makes this read the true one);
//   the sweep: removeLabeled(['s5=1', 's5.task']), both labels, which docker ANDs (R122, R134 c). NOT s5=1 alone: the proxy container carries
//   s5=1 and s5.run=s5-proxy, and sweeping s5=1 would remove the proxy the preflight just found running; NOT s5.task alone: the runner removes
//   only s5=1 containers. Every container runOne, gradeTree and warmTask start carries both;
//   scrubRunDirs(<workRoot>/runs, token): the token an interrupted attempt left in config/ or state/ (R117); a path it cannot clean refuses the
//   batch, naming the count and the first path with the token redacted; writeHookCopy(<workRoot>/hook, esRoot): once, for every run; then,
//   when the real runOne is used, runOne's own checks of its ctx on the first run (an unusable ctx is refused once, instead of making every
//   runOne throw: each throw is an attempt, and the whole plan would end as final infra_exhausted lines).
//   Before the workers start the batch yields TWICE (setImmediate, R136): the start-up above is synchronous, so a signal that arrived during it is
//   only queued, and without the yield the first `concurrency` runs would start before the stop is seen (R129). One yield is not enough when the
//   start-up ends inside a poll-phase callback (an fs callback, the default sha256File's stream): libuv reads the signal pipe in the poll phase.
//
// THE ROWS FILE (R100): JSONL, appended to, one line per ATTEMPT (open, write, fsync, close). A line with a `type` key is not a Row (the stopped
// line). Every other line must be a Row (R134 b: runId a string, final a boolean, infra null or a string) with the `mode` of THIS batch (R133),
// else the batch refuses, naming the line: run ids are the same in smoke, pilot, calibrate and measure, so a measure batch on a file with smoke
// rows would skip them as final and the analysis would count them. Every line the batch appends, the stopped line too, carries `mode`.
// A final row (final === true) makes its run done. attemptsUsed = the rows with that runId and
// final === false AFTER its last final row (R125: for a run that was never final, all of them); 1 + prereg.limits.infraRetries attempts are
// allowed. A run with no row starts at attemptsUsed 0.
//   infra null               the row is appended as it is, final: true.
//   infra, attempts left     appended with final: false; the next attempt of that run starts at once.
//   infra, the last attempt  appended as ONE line { ...row, final: true, infra: 'infra_exhausted', lastInfra: <the reason> }.
//   hidden_changed (R101)    appended final: false, never re-run, and it stops the batch.
//   a thrown runOne (R114), a result that is no Row of that run, or a Row that holds the token: an attempt `run_failed` with infraDetail (the
//   message, the token redacted, at most 300 characters) and a Row of the Row's keys with null / empty values where nothing is known.
//   earlier attempts already used the allowance (the file says so): the exhausted line is appended without a new attempt, with costUsd null so
//   that the cost of that attempt, which its own line already holds, is not summed twice, and with noAttempt: true (R137 c) so that the
//   streak seed of the next batch does not count it as an attempt.
//   retryExhausted (R125): a run whose LATEST final row is infra_exhausted is planned again (Summary.retriedExhausted counts them) with a fresh
//   allowance, counted from the non-final rows after that last exhausted row; the exhausted row stays in the file as evidence, the rule above
//   about an allowance already used applies to the rows after it, and a later counted row makes the run final. Without the option an exhausted
//   row is final like any other: an outage is recovered by this explicit act, never by editing the rows file. analyze.mjs never counts an
//   infra_exhausted row and drops a task with no counted run in an arm, so a lost run that is not recovered shrinks the task set.
// The attempt number is 1 + the highest N of the existing runs/<runId>-aN entries (0 when none), chosen per attempt, never reused (R106a).
// A torn LAST line (a crash during an append) is ignored (Summary.tornLine) and cut off before the first append; a bad line anywhere else
// refuses the batch. This cut is the only write that is not an append.
// A write that fails part-way (R128) is rolled back: the size is recorded after the open and on any failure of the write or the fsync the file is
// cut back to it and the error rethrown; if that cut fails too, the appender is broken for good (every later append throws the first error at
// once and writes nothing, so nothing is glued to the fragment, which the next batch cuts as a torn tail). The state changes only after a
// successful append (updated right after the fsync, before the close; a close error after a durable write is ignored, R137 a). A rows-file write
// failure makes runBatch throw after the runs in flight have finished.
//
// ORDER, THE STOP RULE, SIGNALS. Runs start in the order of planRunsS5, at most `concurrency` at a time. Before every start, a retry included,
// the costUsd of EVERY Row of the file (a typed line is no Row) is summed, a null one adding 0 EXCEPT a row that reached the container and timed out
// (exit.timedOut) or ended infra `interrupted`, which prints no JSON and is among the most expensive runs: it counts as the LARGEST costUsd known in the
// file (0 when none; R148, no price table; Summary.costEstimatedRows counts them, the stopped line carries the sum). When the sum is >= stopAtCostUsd
// nothing starts, the
// runs in flight finish and are recorded, and ONE line { type: 'stopped', at, reason: 'cost' | 'hidden_changed' | 'signal', costUsd, limit, mode } is
// appended after them (the first reason wins; a 'signal' line also carries signalName, R138). The sum is read from the file at start, so a resumed
// batch with the limit reached starts nothing and says so; a batch with nothing left to start says nothing. The first SIGINT, SIGTERM or SIGHUP is
// such a stop (SIGHUP because a closed terminal would otherwise leave the detached containers to run on unread); the second removes the handlers
// and raises that signal on the process, so the default action ends it at once (a hard kill mid-run loses that paid run without a row, and the
// container it leaves is swept by the next batch). dockerRun spawns every agent and grade docker client in a process group of its own (R131), so
// a terminal's Ctrl+C reaches the harness only: the first signal really lets the containers in flight finish. A container that is cut off all the
// same (exit 130, 137 or 143 without a timeout) is infra `interrupted` in runOne (R132), never a graded model failure.
// THE CIRCUIT BREAKER (R124, R127). An outage fails attempt after attempt of run after run, and an exhausted line is final: left alone it would turn the
// plan into infra_exhausted lines in seconds. The infrastructure attempts are counted in completion order across all workers (a thrown runOne
// is one; an attempt with infra null resets the count to 0), and the count STARTS from the rows file (R127): the number of consecutive trailing
// attempt rows with an infrastructure value (typed lines and noAttempt lines skipped, an exhausted row counts), so a resume while the outage persists stops at its
// first further failure; at 2 * (1 + infraRetries) in a row the batch stops with reason 'infra_streak' and
// the line is { type: 'stopped', at, reason: 'infra_streak', streak, lastInfra, costUsd, limit: null, mode } (streak: the count that tripped it).
// After ANY stop (cost, hidden_changed, signal, infra_streak) a run in flight finishes its CURRENT attempt and starts no retry: with attempts
// left it stays non-final and a resume continues it; on its last allowed attempt it is still written infra_exhausted. At most about two runs
// are falsely exhausted by an outage, and retryExhausted recovers them.
//
// SMOKE: Summary.smoke = { ok, checks: { firstUserText, decisionLogs, bSteered, steerDelivered }, rows } from the FINAL rows of the planned runs (one rep-0 run
// per arm on one task): firstUserTextOk === true in every arm; a decision in every arm; the decision's steered true in B and false in A and C (a missing
// decision is the decisionLogs check's, not this one's); steerContexts (R147, counted in the transcript) 1 in B and 0 in A and C. A planned run without a
// final row makes every check false. ok also needs that no run ended infra_exhausted.
//
// Summary { mode, planned, skippedFinal, ran, attempts, infraAttempts, exhausted, retriedExhausted, costUsd, costEstimatedRows, concurrency, stopAtCostUsd, stopped, rowsFile, smoke, scrubbed, tornLine }:
//   ran   runs that got a final row in this batch (counted rows and exhausted lines)   attempts   runOne calls made   infraAttempts   attempts that
//   ended in infrastructure   exhausted   runs that ended infra_exhausted   retriedExhausted   runs re-opened by retryExhausted   costUsd   the sum
//   over the whole file at the end, the estimate of R148 included   costEstimatedRows   how many rows of the file are estimated (no JSON: a timeout, an
//   interruption)   concurrency, stopAtCostUsd   the values the batch ACTUALLY used (the registered ones, or the options that override them)   stopped   null or { reason, costUsd, limit } (reason 'signal': plus signalName; reason 'infra_streak':
//   { reason, streak, lastInfra, costUsd, limit: null })   scrubbed   { dirs, files } of the start-of-batch scrub   tornLine   a torn last line was ignored.
// Nothing is printed. The batch never starts a model itself: runOne starts the agent container, with the real Claude binary mounted.

// R122, R134 (c): every container runOne, gradeTree and warmTask start carries s5=1 AND s5.task; the proxy container carries s5=1 and s5.run=s5-proxy
// but not s5.task, so it is not swept. Both labels are filtered on (docker ANDs them): the runner removes only s5=1 containers (the global constraint).
const SWEEP_LABELS = Object.freeze(['s5=1', 's5.task']);
const LOCK_FILE = 'batch.lock';
const LOCK_TRIES = 3;
const DEFAULT_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
const DOCKER_HELPER_TIMEOUT_MS = 60_000;
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const BATCH_SEAMS = ['runOne', 'imageIdOf', 'sha256File', 'proxyRunning', 'esRoot', 'kill'];
const SEAM_FUNCTIONS = ['runOne', 'imageIdOf', 'sha256File', 'proxyRunning', 'kill'];
// The effort-steering directory this file lives under: the hook copy is made from it.
const ES_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const batchInput = (message) => new TypeError(`runBatch: ${message}`);
const preflightFailure = (item, message) => new Error(`runBatch: preflight item ${item}: ${message}`);

// The arguments, checked before anything is read. Throws a TypeError.
function resolveBatch(prereg, options) {
  if (!isObject(prereg)) throw batchInput(`prereg must be the object loadS5Prereg or loadS5Config returns, got ${show(prereg)}`);
  if (!isObject(options)) throw batchInput(`options must be an object, got ${show(options)}`);
  const { mode, workRoot, rowsFile, taskIds } = options;
  for (const [what, value] of [['workRoot', workRoot], ['rowsFile', rowsFile]]) {
    if (typeof value !== 'string' || value === '') throw batchInput(`${what} must be a non-empty string, got ${show(value)}`);
  }
  const { limits } = prereg;
  if (!isObject(limits)) throw batchInput('prereg.limits must be an object');
  const concurrency = options.concurrency ?? limits.concurrency;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw batchInput(`concurrency must be a positive integer, got ${show(concurrency)}`);
  const stopAtCostUsd = options.stopAtCostUsd ?? prereg.stopAtCostUsd;
  if (typeof stopAtCostUsd !== 'number' || !(stopAtCostUsd > 0)) throw batchInput(`stopAtCostUsd must be a number above 0, got ${show(stopAtCostUsd)}`);
  const { infraRetries } = limits;
  if (!Number.isSafeInteger(infraRetries) || infraRetries < 0) throw batchInput(`prereg.limits.infraRetries must be a non-negative integer, got ${show(infraRetries)}`);
  const ctx = options.ctx === undefined ? {} : options.ctx;
  if (!isObject(ctx)) throw batchInput(`ctx must be an object when given, got ${show(ctx)}`);
  for (const name of SEAM_FUNCTIONS) {
    if (ctx[name] !== undefined && typeof ctx[name] !== 'function') throw batchInput(`ctx.${name} must be a function when given, got ${show(ctx[name])}`);
  }
  if (ctx.esRoot !== undefined && (typeof ctx.esRoot !== 'string' || ctx.esRoot === '')) throw batchInput(`ctx.esRoot must be a non-empty string when given, got ${show(ctx.esRoot)}`);
  const tokenEnv = ctx.tokenEnv ?? DEFAULT_TOKEN_ENV;
  if (typeof tokenEnv !== 'string' || !ENV_NAME_RE.test(tokenEnv) || OWN_ENV.includes(tokenEnv)) {
    throw batchInput(`ctx.tokenEnv must be an environment variable name that runOne does not set itself, got ${show(tokenEnv)}`);
  }
  const retryExhausted = options.retryExhausted === undefined ? false : options.retryExhausted;
  if (typeof retryExhausted !== 'boolean') throw batchInput(`retryExhausted must be a boolean when given, got ${show(options.retryExhausted)}`);
  return {
    mode, taskIds, workRoot: path.resolve(workRoot), rowsFile: path.resolve(rowsFile), concurrency, stopAtCostUsd, infraRetries, retryExhausted, ctx, tokenEnv, esRoot: ctx.esRoot ?? ES_ROOT,
    kill: ctx.kill ?? ((pid, signal) => process.kill(pid, signal)),
  };
}

// `docker <args>` with docker's own environment only; its stdout. Throws on a docker that cannot run or exits non-zero.
function dockerText(dockerBin, args) {
  const bin = dockerBin ?? 'docker';
  const env = {};
  for (const key of DOCKER_PASSTHROUGH) if (process.env[key] !== undefined) env[key] = process.env[key];
  const r = spawnSync(bin, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: DOCKER_HELPER_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (r.error) throw new Error(`${bin} ${args[0]} could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed (${r.status === null ? `signal ${r.signal}` : `exit ${r.status}`}): ${String(r.stderr).trim()}`);
  return r.stdout;
}

const defaultImageIdOf = (dockerBin) => async (ref) => {
  if (typeof ref !== 'string' || ref === '' || ref.startsWith('-')) throw new TypeError(`not an image reference: ${show(ref)}`);
  return dockerText(dockerBin, ['image', 'inspect', '--format', '{{.Id}}', ref]).trim();
};
// `docker ps` without -a lists running containers only.
const defaultProxyRunning = (dockerBin) => async () => dockerText(dockerBin, ['ps', '-q', '--no-trunc', '--filter', 'label=s5=1', '--filter', `label=s5.run=${PROXY_NAME}`]).trim() !== '';
const defaultSha256File = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

// Preflight item 2 for one task: -> its manifest.
function checkBuiltTask(workRoot, id) {
  const taskDir = path.join(workRoot, 'tasks', id);
  const fail = (message) => preflightFailure(2, `task ${id}: ${message}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(taskDir, 'manifest.json'), 'utf8'));
  } catch (err) {
    throw fail(`cannot read manifest.json (the task is not built, or the file is damaged): ${err.message}`);
  }
  if (!isObject(manifest) || manifest.id !== id || ['repo', 'treeHash', 'hiddenHash', 'promptHash'].some((key) => typeof manifest[key] !== 'string')
    || !isObject(manifest.def) || typeof manifest.def.testRunner !== 'string') {
    throw fail('manifest.json is not the manifest of this task that buildTask writes');
  }
  let gate;
  try {
    gate = JSON.parse(readFileSync(path.join(taskDir, 'gate.json'), 'utf8'));
  } catch (err) {
    throw fail(err.code === 'ENOENT' ? 'gate.json is missing: run the gate first, only gated tasks run (R91)' : `gate.json cannot be read: ${err.message}`);
  }
  if (!isObject(gate) || gate.ok !== true) throw fail(`gate.json is not ok (ok: ${show(gate?.ok)}, reasons: ${show(gate?.reasons)}): the task did not pass its gate (R91)`);
  for (const key of ['treeHash', 'hiddenHash']) {
    if (gate[key] !== manifest[key]) throw fail(`gate.json says ${key} ${show(gate[key])}, manifest.json says ${manifest[key]}: the task was changed after it was gated (R35)`);
  }
  let actual;
  try {
    actual = hashBuiltTask(taskDir);
  } catch (err) {
    throw fail(`cannot hash the built task: ${err.message}`);
  }
  for (const [key, part] of [['treeHash', 'tree/'], ['hiddenHash', 'hidden/'], ['promptHash', 'prompt.txt']]) {
    if (actual[key] !== manifest[key]) throw fail(`${part} hashes to ${actual[key]}, not to the manifest's ${key} ${manifest[key]} (R101): it was changed after the task was built`);
  }
  return manifest;
}

// Preflight items 2 to 6, for the tasks of the plan. -> { claudeBin, images, token }
async function batchPreflight(prereg, o, plan) {
  const { workRoot, ctx, tokenEnv } = o;
  const manifests = new Map();
  for (const id of new Set(plan.map((run) => run.taskId))) manifests.set(id, checkBuiltTask(workRoot, id));

  const mismatched = checkTasksMatch(prereg, workRoot).filter((id) => manifests.has(id));
  if (mismatched.length > 0) {
    throw preflightFailure(3, `the built manifest of task${mismatched.length === 1 ? '' : 's'} ${mismatched.join(', ')} is not the registered one (checkTasksMatch: a hash of the registration differs from manifest.json)`);
  }
  const network = ctx.network ?? NETWORK;
  const proxyUrl = ctx.proxyUrl === undefined ? PROXY_URL : ctx.proxyUrl;
  const usesProxy = proxyUrl !== null && network === NETWORK;
  const imageIdOf = ctx.imageIdOf ?? defaultImageIdOf(ctx.dockerBin);
  const checkImage = async (name, ref, pinned) => {
    let actual;
    try {
      actual = await imageIdOf(ref);
    } catch (err) {
      throw preflightFailure(3, `the image ${ref} (${name}) cannot be inspected: ${err.message}`);
    }
    if (actual !== pinned) throw preflightFailure(3, `the image ${ref} (${name}) is ${show(actual)}, the registration pins images.${name} ${show(pinned)}`);
    return actual;
  };
  const images = {};
  for (const repo of new Set([...manifests.values()].map((manifest) => manifest.repo))) {
    if (!Object.hasOwn(IMAGE_FOR_REPO, repo)) throw preflightFailure(3, `no image for repo ${show(repo)}: IMAGE_FOR_REPO has none`);
    images[repo] = await checkImage(repo, IMAGE_FOR_REPO[repo], prereg.images?.[repo]);
  }
  if (usesProxy) await checkImage('proxy', PROXY_IMAGE, prereg.images?.proxy);

  const claudeBin = ctx.claudeBin ?? path.join(os.homedir(), '.local', 'share', 'claude', 'versions', String(prereg.cli?.version));
  let hash;
  try {
    hash = `sha256:${await (ctx.sha256File ?? defaultSha256File)(claudeBin)}`;
  } catch (err) {
    throw preflightFailure(3, `cannot hash the Claude binary ${claudeBin}: ${err.message}`);
  }
  if (hash !== prereg.cli?.sha256) throw preflightFailure(3, `the Claude binary ${claudeBin} hashes to ${hash}, the registration pins cli.sha256 ${show(prereg.cli?.sha256)}`);

  const cargoTasks = [...manifests.values()].filter((manifest) => manifest.def.testRunner === 'cargo').map((manifest) => manifest.id);
  if (cargoTasks.length > 0 && statOrNull(path.join(workRoot, 'cargo-home'))?.isDirectory() !== true) {
    throw preflightFailure(4, `${path.join(workRoot, 'cargo-home')} is not a directory, and ${cargoTasks.join(', ')} ${cargoTasks.length === 1 ? 'is a cargo task' : 'are cargo tasks'} (runOne mounts it read-only at /cargo, for grader parity, R106)`);
  }
  if (usesProxy) {
    let up;
    try {
      up = await (ctx.proxyRunning ?? defaultProxyRunning(ctx.dockerBin))();
    } catch (err) {
      throw preflightFailure(5, `cannot tell whether the proxy container ${PROXY_NAME} is running: ${err.message}`);
    }
    if (up !== true) throw preflightFailure(5, `the proxy container ${PROXY_NAME} is not running (the agent containers reach the API only through it): start it with the proxy control first`);
  }
  const token = process.env[tokenEnv];
  if (typeof token !== 'string' || token === '') throw preflightFailure(6, `the environment variable ${tokenEnv} is not set (it holds the Claude Code OAuth token)`);
  return { claudeBin, images, token };
}

// ---- the rows file ----

// -> { rows, tornLine, tornAt, needsNewline }. rows: the Rows of the file, in order (a line with a `type` key is none). An unparsable last line is
// torn (tornAt: where it starts); an unparsable line anywhere else throws, naming the line. Every other line must be a Row (R134 b: runId a
// string, final a boolean, infra null or a string) of THIS batch's mode (R133: run ids are the same in every mode, so a measure batch on a
// file with smoke rows would skip them as final and the analysis would count them), else the batch refuses, naming the line.
function readRowsFile(file, mode) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return { rows: [], tornLine: false, tornAt: null, needsNewline: false };
    throw new Error(`runBatch: cannot read the rows file ${file}: ${err.message}`);
  }
  const lines = [];
  let no = 0;
  for (let start = 0; start < buf.length;) {
    const newline = buf.indexOf(0x0a, start);
    const end = newline === -1 ? buf.length : newline;
    no += 1;
    const text = buf.toString('utf8', start, end);
    if (text.trim() !== '') {
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        value = undefined;
      }
      lines.push({ no, start, value: isObject(value) ? value : undefined });
    }
    start = newline === -1 ? buf.length : newline + 1;
  }
  const bad = lines.filter((line) => line.value === undefined);
  const torn = bad.length === 1 && bad[0] === lines.at(-1) ? bad[0] : null;
  for (const line of bad) {
    if (line !== torn) throw new Error(`runBatch: the rows file ${file} line ${line.no} is not a JSON object; only the LAST line can be a torn write, so the file is damaged and the batch does not start`);
  }
  const rows = [];
  for (const { no: lineNo, value } of lines) {
    if (value === undefined || Object.hasOwn(value, 'type')) continue;
    if (typeof value.runId !== 'string' || typeof value.final !== 'boolean' || !(value.infra === null || typeof value.infra === 'string')) {
      throw new Error(`runBatch: the rows file ${file} line ${lineNo} is not a Row (runId a string, final a boolean, infra null or a string), so the file is damaged and the batch does not start`);
    }
    if (value.mode !== mode) {
      throw new Error(`runBatch: the rows file ${file} line ${lineNo} carries ${value.mode === undefined ? 'no mode' : `mode ${show(value.mode)}`} but this batch is ${show(mode)}: a rows file belongs to one mode (R133), because the same run id exists in every mode`);
    }
    rows.push(value);
  }
  return {
    rows,
    tornLine: torn !== null,
    tornAt: torn === null ? null : torn.start,
    needsNewline: torn === null && buf.length > 0 && buf[buf.length - 1] !== 0x0a,
  };
}

// The writer of the rows file: one line per call, one open-write-fsync-close. The first call cuts a torn last line off (and a last line
// that lacks its newline gets one in front of the new line), so the file always parses completely afterwards.
//
// R128: a write that fails part-way (ENOSPC on the disk that also holds every run's work/ and target/) must not leave a fragment for the
// next append to glue a complete, paid row onto. The size is recorded after the open; on ANY failure of the write or the fsync the file is
// cut back to it and the error rethrown. If that cut fails too the appender is broken for good: every later call throws the FIRST error at
// once and writes nothing (a fragment left alone is a torn tail, which the next batch cuts; a row glued after it is a lost row). The state
// (the torn tail to cut, the missing newline) changes only after a successful append: it is updated right after the fsync succeeded,
// BEFORE the close, and a close error after that is ignored (R137 a): the line is durable, and a thrown close would leave the state
// stale, so that the next append cut a complete, paid row off the front of the file.
function rowsAppender(file, state) {
  const pending = { tornAt: state.tornAt, needsNewline: state.needsNewline };
  let broken = null;
  return (value) => {
    if (broken !== null) throw broken;
    if (pending.tornAt !== null) truncateSync(file, pending.tornAt);
    const bytes = Buffer.from(`${pending.needsNewline ? '\n' : ''}${JSON.stringify(value)}\n`);
    const fd = openSync(file, 'a');
    try {
      const size = fstatSync(fd).size;
      try {
        for (let off = 0; off < bytes.length;) off += writeSync(fd, bytes, off);
        fsyncSync(fd);
      } catch (err) {
        try {
          ftruncateSync(fd, size);
        } catch {
          broken = err;
        }
        throw err;
      }
      pending.tornAt = null;
      pending.needsNewline = false;
    } finally {
      try {
        closeSync(fd);
      } catch {
        // After a durable write the line is there whatever the close says; after a failure the error in flight is the one that matters.
      }
    }
  };
}

// R148: the cost the stop rule sees is cost.mjs's costOf (shared with the analysis): the known costs of the rows, plus, for each row that
// printed none because it timed out or was interrupted, the LARGEST known cost (0 when none; no price table).
const isRowOf = (row, run) => isObject(row) && row.runId === run.runId && (row.infra === null || (typeof row.infra === 'string' && row.infra !== ''));

// 1 + the highest N of the entries named `<runId>-aN` in runsDir (0 when there are none).
function nextAttemptNumber(runsDir, runId) {
  let names;
  try {
    names = readdirSync(runsDir);
  } catch (err) {
    if (err.code === 'ENOENT') return 1;
    throw err;
  }
  const own = new RegExp(`^${runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-a(\\d{1,9})$`);
  let highest = 0;
  for (const name of names) {
    const match = own.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

// R114: the Row of an attempt whose runOne threw (or returned no Row): the Row's keys, null / empty where nothing is known.
function failedAttemptRow(run, startedAt, err, token) {
  return {
    runId: run.runId,
    taskId: run.taskId,
    taskIndex: run.taskIndex,
    arm: run.arm,
    effort: run.effort,
    rep: run.rep,
    round: run.round,
    sessionId: null,
    startedAt,
    wallMs: null,
    exit: null,
    infra: 'run_failed',
    final: false,
    infraDetail: detailOf(err, token),
    decision: null,
    usage: null,
    efforts: [],
    costUsd: null,
    numTurns: null,
    isError: null,
    tokenScrubbed: null,
    firstUserTextOk: null,
    testsRunBeforeDone: null,
    finalTextTail: '',
    grade: null,
    steerContexts: null,
  };
}

// ---- the lock (R123) ----

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH'; // EPERM: it exists, we may not signal it
  }
};

// -> the holder { pid, ... }; null when the file is gone; undefined when it cannot be read as a lock.
function readLock(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let holder;
  try {
    holder = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isObject(holder) && Number.isSafeInteger(holder.pid) && holder.pid > 0 ? holder : undefined;
}

function acquireLock(workRoot, info) {
  const file = path.join(workRoot, LOCK_FILE);
  for (let tries = 0; tries < LOCK_TRIES; tries += 1) {
    let fd;
    try {
      fd = openSync(file, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readLock(file);
      if (holder === undefined) throw new Error(`runBatch: ${file} exists and cannot be read as a lock ({ pid, startedAt, mode, rowsFile }); if no batch is running on ${workRoot}, remove it`);
      if (holder !== null && pidAlive(holder.pid)) {
        throw new Error(`runBatch: another batch holds ${file} (pid ${holder.pid}, mode ${show(holder.mode)}, started ${show(holder.startedAt)}, rows file ${show(holder.rowsFile)}); one batch at a time per work root (R123)`);
      }
      if (holder !== null) {
        try {
          unlinkSync(file); // a dead holder: its lock is stale
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
      continue;
    }
    try {
      writeSync(fd, `${JSON.stringify(info)}\n`);
      fsyncSync(fd);
    } catch (err) {
      // R134 (d): an empty or half lock would refuse every later batch as unreadable until someone removes it by hand.
      try {
        unlinkSync(file);
      } catch {
        // the original error is the one that matters
      }
      throw err;
    } finally {
      closeSync(fd);
    }
    return { file, info };
  }
  throw new Error(`runBatch: could not take ${file}: another batch is taking it at the same time`);
}

// Only a lock that still names us is removed; a failure to remove it is not worth masking the batch's own outcome (the next batch finds the pid dead).
function releaseLock({ file, info }) {
  try {
    const holder = readLock(file);
    if (holder && holder.pid === info.pid && holder.startedAt === info.startedAt) unlinkSync(file);
  } catch {
    // stale by pid
  }
}

// ---- signals (R119) ----

// The first signal calls onFirst(signal); the second removes the handlers and raises that signal on the process. -> remove().
function stopOnSignals(onFirst, kill) {
  let seen = 0;
  const handlers = STOP_SIGNALS.map((signal) => [signal, () => {
    seen += 1;
    if (seen === 1) {
      onFirst(signal);
      return;
    }
    remove();
    kill(process.pid, signal);
  }]);
  const remove = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
  for (const [signal, handler] of handlers) process.on(signal, handler);
  return remove;
}

// R136: yields to the event loop twice, so that a signal that arrived while the code was busy has had its handler run when this resolves.
// Why TWO: libuv reads the signal pipe in the POLL phase of the loop, and a setImmediate callback runs in the CHECK phase that follows it.
// An immediate scheduled from inside a poll-phase callback (any fs callback, a for-await over a stream: the default sha256File leaves the
// start-up there) runs in that same iteration, BEFORE the next poll has read the pipe; an immediate scheduled from inside the check phase
// runs in the next iteration, after a poll. From a timer or an immediate one yield is enough; from a poll-phase callback it is not.
async function yieldToSignals() {
  await new Promise((resolve) => { setImmediate(resolve); });
  await new Promise((resolve) => { setImmediate(resolve); });
}

// ---- smoke ----

function smokeSummary(plan, rows) {
  const finals = plan.map((run) => rows.findLast((row) => row.runId === run.runId && row.final === true) ?? null);
  const complete = plan.length > 0 && finals.every((row) => row !== null);
  const checks = {
    firstUserText: complete && finals.every((row) => row.firstUserTextOk === true),
    decisionLogs: complete && finals.every((row) => isObject(row.decision)),
    bSteered: complete && plan.every((run, i) => !isObject(finals[i].decision) || finals[i].decision.steered === (run.arm === 'B')),
    // R147: the steer reached the model as the arm says, counted in the transcript: one hook context in B, none in A and C.
    steerDelivered: complete && plan.every((run, i) => finals[i].steerContexts === (run.arm === 'B' ? 1 : 0)),
  };
  const exhausted = finals.some((row) => row !== null && row.infra === 'infra_exhausted');
  return { ok: checks.firstUserText && checks.decisionLogs && checks.bSteered && checks.steerDelivered && !exhausted, checks, rows: finals.filter((row) => row !== null).length };
}

export async function runBatch(prereg, options) {
  const o = resolveBatch(prereg, options);
  const plan = planRunsS5(prereg, { mode: o.mode, taskIds: o.taskIds }); // item 1: the planner owns the mode rules
  const checked = await batchPreflight(prereg, o, plan);
  readRowsFile(o.rowsFile, o.mode); // a damaged rows file, or one of another mode, refuses before the lock, the sweep and the scrub

  const lock = acquireLock(o.workRoot, { pid: process.pid, startedAt: new Date().toISOString(), mode: o.mode, rowsFile: o.rowsFile });
  let removeHandlers = () => {};
  try {
    const stop = { reason: null };
    // The first reason wins. `detail` is what a reason adds to the stopped line (the infra_streak's streak and lastInfra).
    const requestStop = (reason, detail = {}) => {
      if (stop.reason === null) Object.assign(stop, detail, { reason });
    };
    removeHandlers = stopOnSignals((signalName) => requestStop('signal', { signalName }), o.kill);

    mkdirSync(path.dirname(o.rowsFile), { recursive: true });
    const file = readRowsFile(o.rowsFile, o.mode);
    removeLabeled([...SWEEP_LABELS], { dockerBin: o.ctx.dockerBin });
    const runsDir = path.join(o.workRoot, 'runs');
    const scrubbed = scrubRunDirs(runsDir, checked.token);
    if (scrubbed.failed.length > 0) {
      const said = `the start-of-batch scrub could not clean ${scrubbed.failed.length} path(s) under ${runsDir} (the first: ${scrubbed.failed[0]}); the token could stay on disk there, so the batch does not start (R117)`;
      throw new Error(`runBatch: ${said}`.split(checked.token).join(REDACTED));
    }
    const hookCopy = writeHookCopy(path.join(o.workRoot, 'hook'), o.esRoot);

    // ---- the runs ----
    const appendLine = rowsAppender(o.rowsFile, file);
    const rows = file.rows; // every Row of the file; each Row appended by this batch is pushed
    // R133: every line carries the mode of the batch (run ids are the same in every mode, so a line must say which study it belongs to).
    const append = (row) => {
      const line = { ...row, mode: o.mode };
      appendLine(line);
      rows.push(line);
    };
    // R127: the streak does not restart from 0 at a resume. It starts at the number of consecutive trailing attempt rows of the file with an
    // infrastructure value (typed lines are not in `rows`; an exhausted row counts), so a resume while the outage persists stops at its first
    // further failure, and a first good attempt resets it. A line written WITHOUT an attempt (noAttempt, R137 c) is no attempt: skipped.
    let streak = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].noAttempt === true) continue;
      if (rows[i].infra === null) break;
      streak += 1;
    }
    const allowed = 1 + o.infraRetries;
    // R124: this many infrastructure attempts in a row, across all runs, in completion order, stop the batch.
    const streakLimit = 2 * allowed;
    const spent = () => costOf(rows).costUsd;
    // The attempts a run has used UP: its non-final rows after its last final row. A run that was never final has all of its non-final rows
    // counted; a run that retryExhausted re-opened has a fresh allowance, counted after its last infra_exhausted row (R125).
    const attemptsUsed = (runId) => {
      const from = rows.findLastIndex((row) => row.runId === runId && row.final === true);
      return rows.filter((row, i) => i > from && row.runId === runId && row.final === false).length;
    };
    const counts = { skippedFinal: 0, ran: 0, attempts: 0, infraAttempts: 0, exhausted: 0, retriedExhausted: 0 };

    const queue = [];
    for (const run of plan) {
      const latestFinal = rows.findLast((row) => row.runId === run.runId && row.final === true);
      // R125: only an infra_exhausted latest final row can be re-opened, and only on request. A counted row is final for good.
      const reopen = o.retryExhausted && latestFinal?.infra === 'infra_exhausted';
      if (latestFinal !== undefined && !reopen) {
        counts.skippedFinal += 1;
        continue;
      }
      if (reopen) counts.retriedExhausted += 1;
      if (attemptsUsed(run.runId) >= allowed) {
        // The earlier attempts used up the allowance: the exhausted line, without a new attempt. Its cost is already in its own line, and it
        // says it is no attempt (noAttempt), so that the streak seed of the next batch does not count it as one.
        const last = rows.findLast((row) => row.runId === run.runId && row.final === false);
        append({ ...last, final: true, infra: 'infra_exhausted', lastInfra: last.infra, costUsd: null, noAttempt: true });
        counts.ran += 1;
        counts.exhausted += 1;
      } else {
        queue.push(run);
      }
    }

    const runOneFn = o.ctx.runOne ?? runOne;
    const runCtx = {
      ...Object.fromEntries(Object.entries(o.ctx).filter(([key]) => !BATCH_SEAMS.includes(key))),
      prereg,
      workRoot: o.workRoot,
      hookCopy,
      claudeBin: checked.claudeBin,
      images: checked.images,
    };
    // runOne's own checks of its ctx, once, before the first start. A ctx it cannot use would make EVERY runOne throw, and each throw is an
    // infrastructure attempt (R114): the whole plan would end as infra_exhausted lines, which are final, before anyone noticed. An injected
    // runOne is the caller's own business.
    if (o.ctx.runOne === undefined && plan.length > 0) resolveInputs(plan[0], { ...runCtx, attempt: 1 });
    let fatal = null;
    // A start, a retry included, needs no stop requested and a summed cost below the limit.
    const mayStart = () => {
      if (stop.reason !== null || fatal !== null) return false;
      if (spent() >= o.stopAtCostUsd) {
        requestStop('cost');
        return false;
      }
      return true;
    };
    const attempt = async (run) => {
      const startedAt = new Date().toISOString();
      counts.attempts += 1;
      try {
        const row = await runOneFn(run, { ...runCtx, attempt: nextAttemptNumber(runsDir, run.runId) });
        if (!isRowOf(row, run)) throw new Error(`runOne returned something that is no Row of run ${run.runId} (an object with this runId and an infra that is null or a reason)`);
        if (JSON.stringify(row).includes(checked.token)) throw new Error(`runOne returned a row that holds the token (the value of ${o.tokenEnv}); it is not stored`);
        return row;
      } catch (err) {
        return failedAttemptRow(run, startedAt, err, checked.token);
      }
    };
    const runToEnd = async (run) => {
      for (let first = true; ; first = false) {
        if (!first && !mayStart()) return; // the retry is a start like any other, and after ANY stop none starts (R124)
        const row = await attempt(run);
        if (row.infra === null) {
          streak = 0;
          append({ ...row, final: true });
          counts.ran += 1;
          return;
        }
        counts.infraAttempts += 1;
        streak += 1;
        if (row.infra === 'hidden_changed') {
          append({ ...row, final: false }); // every later grade would fail the same way: not retried, and the batch stops (R101)
          requestStop('hidden_changed');
          return;
        }
        // R124: an outage fails attempt after attempt of run after run. Without this the whole plan would end as final infra_exhausted lines.
        if (streak >= streakLimit) requestStop('infra_streak', { streak, lastInfra: row.infra });
        if (attemptsUsed(run.runId) + 1 < allowed) {
          append({ ...row, final: false });
          continue;
        }
        append({ ...row, final: true, infra: 'infra_exhausted', lastInfra: row.infra });
        counts.ran += 1;
        counts.exhausted += 1;
        return;
      }
    };
    const worker = async () => {
      try {
        while (queue.length > 0) {
          if (!mayStart()) return;
          await runToEnd(queue.shift());
        }
      } catch (err) {
        fatal ??= err; // the others start nothing more; the first failure is thrown once they have finished
      }
    };
    // R129, R136: the start-up above is synchronous (the sweep is a spawnSync), so a signal that arrived during it is only queued. Yield so that
    // its handler runs and mayStart sees the stop BEFORE the first `concurrency` runs start (each of which is paid for and may last 90 minutes).
    await yieldToSignals();
    await Promise.all(Array.from({ length: Math.min(o.concurrency, queue.length) }, () => worker()));
    if (fatal !== null) throw fatal;

    let stopped = null;
    if (stop.reason !== null) {
      const costUsd = spent();
      // The infra_streak line says what tripped it and has no cost limit (limit null); the others carry the cost limit they were run with.
      const detail = { infra_streak: { streak: stop.streak, lastInfra: stop.lastInfra }, signal: { signalName: stop.signalName } }[stop.reason] ?? {};
      const limit = stop.reason === 'infra_streak' ? null : o.stopAtCostUsd;
      appendLine({ type: 'stopped', at: new Date().toISOString(), reason: stop.reason, ...detail, costUsd, limit, mode: o.mode });
      stopped = { reason: stop.reason, ...detail, costUsd, limit };
    }
    return {
      mode: o.mode,
      planned: plan.length,
      skippedFinal: counts.skippedFinal,
      ran: counts.ran,
      attempts: counts.attempts,
      infraAttempts: counts.infraAttempts,
      exhausted: counts.exhausted,
      retriedExhausted: counts.retriedExhausted,
      costUsd: spent(),
      costEstimatedRows: costOf(rows).estimatedRows,
      concurrency: o.concurrency,
      stopAtCostUsd: o.stopAtCostUsd,
      stopped,
      rowsFile: o.rowsFile,
      smoke: o.mode === 'smoke' ? smokeSummary(plan, rows) : null,
      scrubbed: { dirs: scrubbed.dirs, files: scrubbed.files },
      tornLine: file.tornLine,
    };
  } finally {
    removeHandlers();
    releaseLock(lock);
  }
}
