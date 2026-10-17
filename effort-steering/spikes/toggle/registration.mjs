// registration.mjs — the effort-toggle registration: the file the operator commits before a step runs, and the S5 configs staged from it.
// Reads the file and git; never reaches the network and never calls a model.
//
//   loadRegistration(file) -> Registration   shape, arms, tool text, then "committed and unchanged" (refuses on the first failure)
//   stageArmConfig(registration, armName, runs = arm.runs) -> object   the S5 config for one arm: `base` with the arms A, B and C at
//                                              `runs: 0` except arm.s5Arm at `runs`, `tasks` filtered to the arm's tasks, `mod` = the arm's mod
//   serializeConfig(obj) -> string             the canonical text S5's loaders require (JSON.stringify(obj, null, 2) + '\n')
//   TOOL_TEXT_SHA256                           sha256 (hex) of the mod's TOOL_DESCRIPTION: the value the file's toolTextSha256 must hold
//   ARM_MODES                                  the mod mode each arm name must carry
//
// The file (JSON, spec "Step 0" / "Step 1"):
//   { step: 0 | 1,
//     base: a complete S5 config (spikes/s5/prereg.mjs), its arms' `runs` ignored,
//     arms: { <name>: { s5Arm: 'A' | 'C', runs: integer >= 0, tasks: string[] (non-empty, distinct, ids of base.tasks), mod: <S5 mod object> } },
//     toolTextSha256: 64 lowercase hex,
//     step 0 also: switchAt: integer >= 1, n: integer >= 1, extension: integer >= 0      (the keys step0Verdict reads)
//     step 1 also: verdict: { qualityTask, qualityRuns, otherRuns, costEstimator: 'run' | 'task' }   (ruling P4 as amended by P12) }
// A key that is not listed, a missing key and a key of the other step are refused. Arm names: step 0 holds exactly F-L, F-X, F-LX, F-XL;
// step 1 holds L, X, T and P and may hold R (the random arm's parameters are computed from T's runs, so R can come later). Each name has
// its mod mode (ruling P7): the fixed arms F-L, F-X, F-LX, F-XL, L, X are `schedule` (F-L, F-X, L and X with a one-level schedule of
// their own level, ruling P7), T `toggle`, P `placebo`, R `random`. The arm's CLI `--effort` is the level it STARTS at (the first
// schedule entry, else `low`: "You start at low reasoning effort"), so base.arms[s5Arm].effort must equal it.
//
// Every arm's staged config must load with loadS5Config(..., { mode: 'calibrate' }): that is how base, tasks and mod (Task 2's checker)
// are validated, and the loader runs on a file in a temporary directory that is removed afterwards. The tool text is checked against the
// TOOL_DESCRIPTION the mod registers (./mod/hooks/register.ts). "Committed" is s4-prereg's requireCommitted, as r1-prereg's
// verifyRegistered uses it: the file is tracked by git and its bytes equal the HEAD blob (git runs in the file's own directory); a
// symlink is refused. The bytes checked are the bytes parsed.

import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { requireCommitted } from '../s4-prereg.mjs';
import { loadS5Config } from '../s5/prereg.mjs';
import { TOOL_DESCRIPTION } from './mod/hooks/register.ts';

export const TOOL_TEXT_SHA256 = createHash('sha256').update(TOOL_DESCRIPTION).digest('hex');

// name -> { step, mode, level }: `level` is set for the arms whose schedule is one level throughout.
export const ARM_MODES = Object.freeze({
  'F-L': { step: 0, mode: 'schedule', level: 'low' },
  'F-X': { step: 0, mode: 'schedule', level: 'xhigh' },
  'F-LX': { step: 0, mode: 'schedule', level: null },
  'F-XL': { step: 0, mode: 'schedule', level: null },
  L: { step: 1, mode: 'schedule', level: 'low' },
  X: { step: 1, mode: 'schedule', level: 'xhigh' },
  T: { step: 1, mode: 'toggle', level: null },
  P: { step: 1, mode: 'placebo', level: null },
  R: { step: 1, mode: 'random', level: null },
});
const REQUIRED_ARMS = { 0: ['F-L', 'F-X', 'F-LX', 'F-XL'], 1: ['L', 'X', 'T', 'P'] };
const STEP_KEYS = { 0: ['switchAt', 'n', 'extension'], 1: ['verdict'] };
const COMMON_KEYS = ['step', 'base', 'arms', 'toolTextSha256'];
const ARM_KEYS = ['s5Arm', 'runs', 'tasks', 'mod'];
const VERDICT_KEYS = ['qualityTask', 'qualityRuns', 'otherRuns', 'costEstimator'];
const HEX64 = /^[0-9a-f]{64}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => JSON.stringify(v) ?? String(v);
const fail = (field, why) => {
  throw new Error(`registration: field ${field} ${why}`);
};
const need = (cond, field, why, got) => {
  if (!cond) fail(field, `must ${why}, got ${show(got)}`);
};
// `value` must be an object holding exactly `keys`.
function shape(field, value, keys) {
  if (!isObject(value)) fail(field, `must be an object, got ${show(value)}`);
  for (const k of Object.keys(value)) if (!keys.includes(k)) fail(field === '' ? k : `${field}.${k}`, 'is not a known field here');
  for (const k of keys) if (!Object.hasOwn(value, k) || value[k] === null) fail(field === '' ? k : `${field}.${k}`, 'is required and must not be null');
}

export const serializeConfig = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// The S5 config of one arm. `runs` replaces the arm's registered run count (an extension or a replacement batch) and nothing else.
export function stageArmConfig(registration, armName, runs) {
  const arm = isObject(registration?.arms) && Object.hasOwn(registration.arms, armName) ? registration.arms[armName] : undefined;
  if (arm === undefined) throw new RangeError(`stageArmConfig: the registration has no arm ${show(armName)}`);
  const count = runs === undefined ? arm.runs : runs;
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`stageArmConfig: runs must be an integer >= 0, got ${show(count)}`);
  const config = JSON.parse(JSON.stringify(registration.base));
  if (!isObject(config.arms) || !isObject(config.arms[arm.s5Arm])) throw new TypeError(`stageArmConfig: base.arms.${arm.s5Arm} must be an object`);
  if (!Array.isArray(config.tasks)) throw new TypeError('stageArmConfig: base.tasks must be an array');
  for (const key of ['A', 'B', 'C']) if (isObject(config.arms[key])) config.arms[key].runs = 0;
  config.arms[arm.s5Arm].runs = count;
  const missing = arm.tasks.filter((id) => !config.tasks.some((task) => task?.id === id));
  if (missing.length > 0) throw new RangeError(`stageArmConfig: arm ${armName} names tasks that base.tasks lacks: ${missing.join(', ')}`);
  config.tasks = config.tasks.filter((task) => arm.tasks.includes(task.id));
  config.mod = JSON.parse(JSON.stringify(arm.mod));
  return config;
}

function checkShape(reg) {
  need(isObject(reg), 'registration', 'be a JSON object', reg);
  need(reg.step === 0 || reg.step === 1, 'step', 'be 0 or 1', reg.step);
  const step = reg.step;
  shape('', reg, [...COMMON_KEYS, ...STEP_KEYS[step]]);
  need(isObject(reg.base), 'base', 'be an S5 config object', reg.base);
  need(typeof reg.toolTextSha256 === 'string' && HEX64.test(reg.toolTextSha256), 'toolTextSha256', 'be 64 lowercase hex characters', reg.toolTextSha256);
  need(reg.toolTextSha256 === TOOL_TEXT_SHA256, 'toolTextSha256', `equal the sha256 of the mod's TOOL_DESCRIPTION (${TOOL_TEXT_SHA256})`, reg.toolTextSha256);

  if (step === 0) {
    need(Number.isSafeInteger(reg.switchAt) && reg.switchAt >= 1, 'switchAt', 'be an integer >= 1', reg.switchAt);
    need(Number.isSafeInteger(reg.n) && reg.n >= 1, 'n', 'be an integer >= 1', reg.n);
    need(Number.isSafeInteger(reg.extension) && reg.extension >= 0, 'extension', 'be an integer >= 0', reg.extension);
  } else {
    shape('verdict', reg.verdict, VERDICT_KEYS);
    const v = reg.verdict;
    need(typeof v.qualityTask === 'string' && v.qualityTask.trim() !== '', 'verdict.qualityTask', 'be a non-blank string', v.qualityTask);
    need(Number.isSafeInteger(v.qualityRuns) && v.qualityRuns >= 1, 'verdict.qualityRuns', 'be an integer >= 1', v.qualityRuns);
    need(Number.isSafeInteger(v.otherRuns) && v.otherRuns >= 1, 'verdict.otherRuns', 'be an integer >= 1', v.otherRuns);
    need(v.costEstimator === 'run' || v.costEstimator === 'task', 'verdict.costEstimator', "be 'run' or 'task'", v.costEstimator);
  }

  need(isObject(reg.arms), 'arms', 'be an object', reg.arms);
  for (const name of Object.keys(reg.arms)) {
    need(Object.hasOwn(ARM_MODES, name) && ARM_MODES[name].step === step, `arms.${name}`, `be an arm of step ${step}: ${Object.keys(ARM_MODES).filter((k) => ARM_MODES[k].step === step).join(', ')}`, name);
  }
  for (const name of REQUIRED_ARMS[step]) if (!Object.hasOwn(reg.arms, name)) fail(`arms.${name}`, 'is required');
  for (const [name, arm] of Object.entries(reg.arms)) checkArm(name, arm);
  if (step === 1) {
    need(reg.arms.T.tasks.includes(reg.verdict.qualityTask), 'verdict.qualityTask', 'be one of arms.T.tasks', reg.verdict.qualityTask);
  }
}

function checkArm(name, arm) {
  const field = `arms.${name}`;
  shape(field, arm, ARM_KEYS);
  need(arm.s5Arm === 'A' || arm.s5Arm === 'C', `${field}.s5Arm`, "be 'A' or 'C'", arm.s5Arm);
  need(Number.isSafeInteger(arm.runs) && arm.runs >= 0, `${field}.runs`, 'be an integer >= 0', arm.runs);
  need(Array.isArray(arm.tasks) && arm.tasks.length > 0 && arm.tasks.every((id) => typeof id === 'string' && id !== ''), `${field}.tasks`, 'be a non-empty array of task ids', arm.tasks);
  need(new Set(arm.tasks).size === arm.tasks.length, `${field}.tasks`, 'hold distinct task ids', arm.tasks);
  // The mod's own fields are checked by S5's loader (checkStaged); the name's mode and one-level schedule are the registration's.
  need(isObject(arm.mod), `${field}.mod`, 'be an object', arm.mod);
  const rule = ARM_MODES[name];
  need(arm.mod.mode === rule.mode, `${field}.mod.mode`, `be '${rule.mode}' for arm ${name} (ruling P7)`, arm.mod.mode);
  if (rule.level !== null) {
    const s = arm.mod.schedule;
    need(Array.isArray(s) && s.length > 0 && s.every((level) => level === rule.level), `${field}.mod.schedule`, `be a one-level schedule of '${rule.level}'`, s);
  }
}

// Each arm's staged config loads with S5's loader, and the CLI effort is the level the arm starts at.
function checkStaged(reg) {
  const dir = mkdtempSync(join(tmpdir(), 'toggle-registration-'));
  try {
    for (const [name, arm] of Object.entries(reg.arms)) {
      const file = join(dir, `${name}.json`);
      let config;
      try {
        config = stageArmConfig(reg, name);
        writeFileSync(file, serializeConfig(config));
        loadS5Config(file, { mode: 'calibrate' });
      } catch (err) {
        throw new Error(`registration: arm ${name}: ${err.message.split(file).join('<staged config>')}`);
      }
      const start = arm.mod.mode === 'schedule' ? arm.mod.schedule[0] : 'low';
      const effort = config.arms[arm.s5Arm].effort;
      if (effort !== start) fail(`arms.${name}.s5Arm`, `must name an S5 arm whose effort is the level arm ${name} starts at (${start}), but base.arms.${arm.s5Arm}.effort is ${show(effort)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function loadRegistration(file) {
  const abs = resolve(file);
  if (lstatSync(abs).isSymbolicLink()) throw new Error(`registration: ${abs} is not committed: it is a symlink`);
  const bytes = readFileSync(abs);
  let reg;
  try {
    reg = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new Error(`registration: ${abs} is not valid JSON: ${err.message}`);
  }
  checkShape(reg);
  checkStaged(reg);
  requireCommitted(abs, bytes);
  return reg;
}
