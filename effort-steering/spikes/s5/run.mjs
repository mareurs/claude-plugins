// run.mjs — the S5 batch runner. This file holds the PLAN:
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
// freeze it at every depth. Nothing here reads a file, runs a process or calls a model.

import { makeRng, shuffle } from '../s4-prng.mjs';

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
