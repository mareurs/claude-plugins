// r1-prereg.mjs — the R1 registration, in the S5 prereg shape so that S5's loader and runner take it unchanged.
//
//   makeR1Prereg({ base, tasks, orderSeed, bound }) -> object
//   serializePrereg(obj) -> string        the canonical text (JSON.stringify(obj, null, 2) + '\n') the S5 loaders require
//   stageConfig(prereg, stage) -> object  stage 1: arm A runs 0 (C only); stage 2: arm C runs 0 (A only). Nothing else changes.
//   verifyRegistered(file) -> void        throws unless the file's bytes equal its HEAD blob
//
// The experiment runs through `s5.mjs run --mode calibrate`: loadS5Config allows an arm with `runs: 0`, and the registration
// (loadS5Prereg, mode measure) would refuse arm B at 0 runs. "Registered" for R1 therefore means: this file is committed before
// stage 1, and verifyRegistered says so. `base` carries the values the experiment shares with S5 (model, cli, mechanism, limits,
// images, proxyAllowlist): the caller reads them from an S5 config such as configs/calibrate-batch2.json.

import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireCommitted } from '../s4-prereg.mjs';

const HASH_FIELDS = ['treeHash', 'hiddenHash', 'promptHash'];
const BASE_KEYS = ['model', 'cli', 'mechanism', 'limits', 'images', 'proxyAllowlist'];
// Stage 2 costs about $34 (spec); stage 1 is capped lower on the command line (--stop-at-cost).
const STOP_AT_COST_USD = 60;

export function makeR1Prereg({ base, tasks, orderSeed, bound }) {
  for (const key of BASE_KEYS) if (base?.[key] === undefined) throw new TypeError(`makeR1Prereg: base.${key} is missing`);
  if (!Array.isArray(tasks) || tasks.length === 0) throw new TypeError('makeR1Prereg: tasks must be a non-empty array');
  const checked = tasks.map((task) => {
    for (const field of ['id', ...HASH_FIELDS]) {
      if (typeof task?.[field] !== 'string') throw new TypeError(`makeR1Prereg: a task lacks ${field}`);
    }
    return { id: task.id, treeHash: task.treeHash, hiddenHash: task.hiddenHash, promptHash: task.promptHash };
  });
  return {
    model: base.model,
    cli: base.cli,
    arms: {
      A: { effort: 'xhigh', steer: false, runs: 2 },
      B: { effort: 'xhigh', steer: true, runs: 0 },
      C: { effort: 'low', steer: false, runs: 2 },
    },
    tasks: checked,
    margin: 0.15,
    alpha: 0.05,
    bound,
    orderSeed,
    mechanism: base.mechanism,
    limits: base.limits,
    images: base.images,
    proxyAllowlist: base.proxyAllowlist,
    stopAtCostUsd: STOP_AT_COST_USD,
  };
}

export const serializePrereg = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

export function stageConfig(prereg, stage) {
  if (stage !== 1 && stage !== 2) throw new RangeError(`stageConfig: stage must be 1 or 2, got ${String(stage)}`);
  const copy = JSON.parse(JSON.stringify(prereg));
  copy.arms[stage === 1 ? 'A' : 'C'].runs = 0;
  return copy;
}

export function verifyRegistered(file) {
  const abs = resolve(file);
  if (lstatSync(abs).isSymbolicLink()) throw new Error(`prereg: ${abs} is not committed: it is a symlink`);
  requireCommitted(abs, readFileSync(abs));
}
