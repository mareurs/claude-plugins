// toggle.mjs — the CLI of the effort-toggle experiment (docs/superpowers/specs/2026-10-17-effort-toggle-design.md). Never calls a model.
// Usage errors exit 64, a refusal or a failure exits 1, as spikes/r1/r1.mjs and spikes/s5/s5.mjs do; verdicts go to stdout as JSON with
// two-space indentation, errors to stderr.
//
//   toggle stage-config --registration <file> --arm <name> --out <file> [--runs <n>]
//       writes the S5 config of one arm (registration.mjs stageArmConfig); `--runs` replaces the arm's registered run count (an
//       extension or a replacement batch) and changes nothing else. The output is checked with loadS5Config(out, { mode: 'calibrate' }).
//   toggle check-runs --work-root <dir> --rows <file> --mode <mode|none> --out <file>
//       one Run per final row (below); `--mode` is one of S5's mod modes, handed to checkRun (which does not read it), or `none` (ruling
//       P16): a run made without a mod (reused R1 V2 rows), whose log is neither expected nor read, so only the `audit` reason excludes it.
//       A `--work-root` without a `runs/` directory is an error (exit 1), not a work root whose every run is excluded.
//   toggle analyze0 --registration <file> --evidence <arm>=<file> ...
//   toggle analyze1 --registration <file> --evidence <arm>=<file> ...
//   toggle random-params --registration <file> --stratum quality|other --evidence <T evidence file>
//       the verdict JSON of analyze.mjs. An evidence file is a JSON array of Run objects (what check-runs writes). Ruling P18: it holds exactly
//       the keys of a Run with their types, a unique runId, and taskIds among the arm's registered tasks (errors name the file and the run, exit
//       1); evidence is required for every registered arm and refused for an unregistered one (exit 64). analyze1 merges the evidence of
//       R-quality and R-other into R (ruling P17); random-params keeps T's runs on the quality task (`quality`) or on the others (`other`).
//   toggle check-known [--low <runsDir>]... [--xhigh <runsDir>]... [--all <runsDir>]... [--task <id>]
//       the broad matcher, the blinding audit and firstEditIndex over run directories that hold a transcript and no mod log.
//
// The rows file (check-runs) is what `s5 run` appends to: JSON lines, each a Row (spikes/s5/run.mjs) or a typed line (`stopped`). Only
// final Rows are read: an object with a string runId, `final === true` and no `type`; of two final rows of one run the later one wins
// (R125's retried exhausted run). Fields read from a Row: runId, taskId, rep, sessionId, grade.pass (a boolean, else pass is null),
// costUsd (a finite number >= 0, else null). The row carries no attempt number, so the run directory is the
// `<workRoot>/runs/<runId>-a<N>` (run.mjs nextAttemptNumber's naming) with the highest N whose config/ holds the row's session.
// Its transcript is readRunUsage(<runDir>/config, sessionId).transcriptPath and its mod log <runDir>/state/effort-toggle/log.jsonl.
// Run = { runId, taskId, rep, pass, costUsd, excludedFor, secondTurn, broadAt, requests, shareXhigh, upSwitches }. excludedFor is
// 'audit' when checkRun lists it (ruling P10), else the first of checkRun's reasons, else null; a run without a readable transcript is
// excluded for readRunUsage's reason ('no_transcript', 'ambiguous_transcript') or 'transcript_unreadable', before any other reason.
//
// check-known prints one line per run: `<dir name> group=<xhigh|low> broad=<true|false> audit=<n> firstEditIndex=<n|none>`; `broad` is
// "some broad check anywhere" (broadAt not empty), `audit` the number of tool calls checkRun's audit flags. Then exactly:
//   xhigh broad: <k> of <n>      low broad: <k> of <n>      audit hits: <total over the runs>      switchAt: <value>
// with switchAt = max(3, min(firstEditIndex over the low runs) - 2), or `none` when no low run edits. Directories: `--low` and `--xhigh`
// hold runs of that group whatever their arm letter; `--all` classifies by the arm letter of `<task>.<arm>.<rep>-a<N>` (A xhigh, C low;
// any other letter is skipped). `--task` keeps the runs of that task. A run directory without exactly one main transcript
// (config/projects/*/*.jsonl) is an error, not a skip.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadS5Config, MOD_MODES } from '../s5/prereg.mjs';
import { readRunUsage } from '../s5/usage.mjs';
import { randomParams, step0Verdict, step1Verdict } from './analyze.mjs';
import { checkRun, firstEditIndex } from './evidence.mjs';
import { loadRegistration, serializeConfig, stageArmConfig } from './registration.mjs';

class UsageError extends Error {}

// parseFlags(argv, { name: 'string' | 'int' | 'list' }) -> { name: value }. `list` flags repeat; `int` is a non-negative integer.
export function parseFlags(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const name = arg.startsWith('--') ? arg.slice(2) : null;
    if (name === null || !Object.hasOwn(spec, name)) throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
    i += 1;
    if (spec[name] === 'int') {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new UsageError(`--${name} must be a non-negative integer, got ${JSON.stringify(value)}`);
      out[name] = Number(value);
    } else if (spec[name] === 'list') {
      out[name] = [...(out[name] ?? []), value];
    } else {
      out[name] = value;
    }
  }
  return out;
}

const needFlags = (flags, command, names) => {
  for (const name of names) if (flags[name] === undefined) throw new UsageError(`${command} needs --${name}`);
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const isDirectory = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const writeJson = (file, value) => {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(resolve(file), `${JSON.stringify(value, null, 2)}\n`);
};

// ---- stage-config ----

async function cmdStageConfig(argv, io) {
  const f = parseFlags(argv, { registration: 'string', arm: 'string', out: 'string', runs: 'int' });
  needFlags(f, 'stage-config', ['registration', 'arm', 'out']);
  if (f.runs !== undefined && f.runs < 1) throw new UsageError('--runs must be at least 1');
  const reg = loadRegistration(f.registration);
  if (!Object.hasOwn(reg.arms, f.arm)) throw new UsageError(`the registration has no arm ${JSON.stringify(f.arm)} (its arms: ${Object.keys(reg.arms).join(', ')})`);
  const config = stageArmConfig(reg, f.arm, f.runs);
  mkdirSync(dirname(resolve(f.out)), { recursive: true });
  writeFileSync(resolve(f.out), serializeConfig(config));
  loadS5Config(resolve(f.out), { mode: 'calibrate' });
  io.log(`wrote ${f.out} (arm ${f.arm}, ${config.arms[reg.arms[f.arm].s5Arm].runs} runs of S5 arm ${reg.arms[f.arm].s5Arm}, ${config.tasks.length} tasks)`);
  return 0;
}

// ---- check-runs ----

// JSON lines of a rows file (r1.mjs parseRows); a typed line stays and is ignored by finalRows.
export function parseRows(text, file) {
  const rows = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new Error(`${file} line ${i + 1} is not JSON`);
    }
  });
  return rows;
}

// The final Rows, one per run (the later of two), in the order the runs first appear.
export function finalRows(rows) {
  const byRun = new Map();
  for (const r of rows) {
    if (isObject(r) && r.type === undefined && typeof r.runId === 'string' && r.final === true) byRun.set(r.runId, r);
  }
  return [...byRun.values()];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The directory of a row's attempt and the transcript it holds: { runDir, usage } with runDir null when no `<runId>-aN` exists. Among the
// attempts, the highest N whose config/ holds the row's session; none does -> the highest N (its usage has reason 'no_transcript').
function findAttempt(runsDir, row) {
  let names = [];
  try {
    names = readdirSync(runsDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const own = new RegExp(`^${escapeRe(row.runId)}-a(\\d{1,9})$`);
  const attempts = names.map((name) => [own.exec(name), name]).filter(([m]) => m !== null).map(([m, name]) => [Number(m[1]), join(runsDir, name)]).sort((a, b) => b[0] - a[0]);
  let first = null;
  for (const [, runDir] of attempts) {
    const usage = readUsage(runDir, row);
    if (usage.transcriptPath !== null || usage.reason === 'ambiguous_transcript') return { runDir, usage };
    first ??= { runDir, usage };
  }
  return first ?? { runDir: null, usage: { transcriptPath: null, reason: 'no_transcript' } };
}

function readUsage(runDir, row) {
  if (typeof row.sessionId !== 'string' || row.sessionId === '') return { transcriptPath: null, reason: 'no_transcript' };
  try {
    return readRunUsage(join(runDir, 'config'), row.sessionId);
  } catch {
    return { transcriptPath: null, reason: 'transcript_unreadable' };
  }
}

function readIfExists(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// checkRuns({ workRoot, rows, mode }) -> Run[]
export function checkRuns({ workRoot, rows, mode }) {
  const runsDir = join(resolve(workRoot), 'runs');
  if (!isDirectory(runsDir)) throw new Error(`${runsDir} is not a directory: --work-root must be a work root that holds runs/`);
  return finalRows(rows).map((row) => {
    const { runDir, usage } = findAttempt(runsDir, row);
    let transcriptText = '';
    let transcriptReason = usage.reason;
    if (usage.transcriptPath !== null) {
      try {
        transcriptText = readFileSync(usage.transcriptPath, 'utf8');
        transcriptReason = null;
      } catch {
        transcriptReason = 'transcript_unreadable';
      }
    }
    // Mode `none` (ruling P16): a run without a mod; no log is expected and none is read, so only the audit can exclude it.
    const modLogText = runDir === null || mode === 'none' ? null : readIfExists(join(runDir, 'state', 'effort-toggle', 'log.jsonl'));
    const c = checkRun({ transcriptText, modLogText, mode });
    const reason = c.reasons.includes('audit') ? 'audit' : (mode === 'none' ? null : (c.reasons[0] ?? null));
    const excludedFor = transcriptReason ?? reason;
    return {
      runId: row.runId,
      taskId: row.taskId,
      rep: row.rep,
      pass: isObject(row.grade) && typeof row.grade.pass === 'boolean' ? row.grade.pass : null,
      costUsd: finite(row.costUsd) && row.costUsd >= 0 ? row.costUsd : null,
      excludedFor,
      secondTurn: c.secondTurn,
      broadAt: c.broadAt,
      requests: c.requests,
      shareXhigh: c.shareXhigh,
      upSwitches: c.upSwitches,
    };
  });
}

async function cmdCheckRuns(argv, io) {
  const f = parseFlags(argv, { 'work-root': 'string', rows: 'string', mode: 'string', out: 'string' });
  needFlags(f, 'check-runs', ['work-root', 'rows', 'mode', 'out']);
  if (f.mode !== 'none' && !MOD_MODES.includes(f.mode)) throw new UsageError(`--mode must be one of ${MOD_MODES.join(', ')} or none, got ${JSON.stringify(f.mode)}`);
  const rows = parseRows(readFileSync(resolve(f.rows), 'utf8'), f.rows);
  const runs = checkRuns({ workRoot: f['work-root'], rows, mode: f.mode });
  writeJson(f.out, runs);
  io.log(`wrote ${f.out}: ${runs.length} runs, ${runs.filter((r) => r.excludedFor !== null).length} excluded`);
  return 0;
}

// ---- the verdicts ----

const RUN_KEYS = ['runId', 'taskId', 'rep', 'pass', 'costUsd', 'excludedFor', 'secondTurn', 'broadAt', 'requests', 'shareXhigh', 'upSwitches'];
const isCount = (x) => Number.isInteger(x) && x >= 0;

// The first problem of one Run object (ruling P18: exactly the keys check-runs writes, with their types), or null.
function runProblem(r) {
  for (const k of Object.keys(r)) if (!RUN_KEYS.includes(k)) return `has an unknown key ${JSON.stringify(k)}`;
  for (const k of RUN_KEYS) if (!Object.hasOwn(r, k)) return `lacks the key ${k}`;
  if (typeof r.runId !== 'string' || r.runId === '') return 'has a runId that is not a non-empty string';
  if (typeof r.taskId !== 'string' || r.taskId === '') return 'has a taskId that is not a non-empty string';
  if (!isCount(r.rep)) return `has rep ${JSON.stringify(r.rep)}, not an integer >= 0`;
  if (r.pass !== null && typeof r.pass !== 'boolean') return `has pass ${JSON.stringify(r.pass)}, not a boolean or null`;
  if (r.costUsd !== null && !(finite(r.costUsd) && r.costUsd >= 0)) return `has costUsd ${JSON.stringify(r.costUsd)}, not null or a finite number >= 0`;
  if (r.excludedFor !== null && (typeof r.excludedFor !== 'string' || r.excludedFor === '')) return `has excludedFor ${JSON.stringify(r.excludedFor)}, not null or a string`;
  if (typeof r.secondTurn !== 'boolean') return `has secondTurn ${JSON.stringify(r.secondTurn)}, not a boolean`;
  if (!Array.isArray(r.broadAt) || !r.broadAt.every(isCount)) return 'has a broadAt that is not an array of integers >= 0';
  if (!finite(r.requests)) return `has requests ${JSON.stringify(r.requests)}, not a finite number`;
  if (!finite(r.shareXhigh) || r.shareXhigh < 0 || r.shareXhigh > 1) return `has shareXhigh ${JSON.stringify(r.shareXhigh)}, not a finite number in [0, 1]`;
  if (!finite(r.upSwitches)) return `has upSwitches ${JSON.stringify(r.upSwitches)}, not a finite number`;
  return null;
}

// An evidence file: a JSON array of valid Run objects with a unique runId, every taskId one of `tasks` (the arm's registered tasks).
// Errors name the file and the offending run.
function readEvidence(file, tasks) {
  let runs;
  try {
    runs = JSON.parse(readFileSync(resolve(file), 'utf8'));
  } catch (err) {
    throw new Error(`${file}: ${err.message}`);
  }
  if (!Array.isArray(runs)) throw new Error(`${file} must hold a JSON array of Run objects`);
  const seen = new Set();
  runs.forEach((r, i) => {
    if (!isObject(r)) throw new Error(`${file}: entry ${i} is not a Run object`);
    const problem = runProblem(r);
    const name = typeof r.runId === 'string' && r.runId !== '' ? r.runId : `#${i}`;
    if (problem !== null) throw new Error(`${file}: run ${name} ${problem}`);
    if (seen.has(r.runId)) throw new Error(`${file}: run ${r.runId} appears twice`);
    seen.add(r.runId);
    if (!tasks.includes(r.taskId)) throw new Error(`${file}: run ${r.runId} has taskId ${r.taskId}, which is not one of the registered tasks (${tasks.join(', ')})`);
  });
  return runs;
}

// `--evidence <arm>=<file>` (repeated) -> { arm: Run[] }; an arm the registration does not have, a repeated arm and a malformed value are usage errors.
function evidenceByArm(specs, reg) {
  const out = {};
  for (const spec of specs ?? []) {
    const eq = spec.indexOf('=');
    if (eq <= 0 || eq === spec.length - 1) throw new UsageError(`--evidence wants <arm>=<file>, got ${JSON.stringify(spec)}`);
    const arm = spec.slice(0, eq);
    if (!Object.hasOwn(reg.arms, arm)) throw new UsageError(`--evidence names arm ${JSON.stringify(arm)}, which the registration lacks (its arms: ${Object.keys(reg.arms).join(', ')})`);
    if (Object.hasOwn(out, arm)) throw new UsageError(`--evidence names arm ${JSON.stringify(arm)} twice`);
    out[arm] = readEvidence(spec.slice(eq + 1), reg.arms[arm].tasks);
  }
  const lacking = Object.keys(reg.arms).filter((arm) => !Object.hasOwn(out, arm));
  if (lacking.length > 0) throw new UsageError(`--evidence is missing for the registered arm(s) ${lacking.join(', ')}`);
  return out;
}

function loadStep(f, command, step) {
  needFlags(f, command, ['registration']);
  const reg = loadRegistration(f.registration);
  if (reg.step !== step) throw new UsageError(`${command} needs a step ${step} registration, ${f.registration} is step ${reg.step}`);
  return reg;
}

const isCounted = (r) => isObject(r) && typeof r.pass === 'boolean' && (r.excludedFor ?? null) === null;

async function cmdAnalyze0(argv, io) {
  const f = parseFlags(argv, { registration: 'string', evidence: 'list' });
  const reg = loadStep(f, 'analyze0', 0);
  const runs = evidenceByArm(f.evidence, reg);
  io.log(JSON.stringify(step0Verdict(runs, { switchAt: reg.switchAt, n: reg.n, extension: reg.extension }), null, 2));
  return 0;
}

// analyze1(reg, runs) -> step1Verdict plus ruling P14: every task in arms.T.tasks needs a counted T run, else
// `registered-task-missing:<task>` joins `incomplete` and `works` is null.
export function analyze1(reg, runs) {
  const verdict = step1Verdict(runs, reg.verdict);
  const have = new Set((runs.T ?? []).filter(isCounted).map((r) => r.taskId));
  const missing = reg.arms.T.tasks.filter((task) => !have.has(task));
  if (missing.length === 0) return verdict;
  return { ...verdict, works: null, incomplete: [...verdict.incomplete, ...missing.map((task) => `registered-task-missing:${task}`)] };
}

async function cmdAnalyze1(argv, io) {
  const f = parseFlags(argv, { registration: 'string', evidence: 'list' });
  const reg = loadStep(f, 'analyze1', 1);
  const byArm = evidenceByArm(f.evidence, reg);
  // Ruling P17: the random arm's two strata are one arm R for the verdict.
  const { 'R-quality': rq, 'R-other': ro, ...runs } = byArm;
  if (rq !== undefined || ro !== undefined) runs.R = [...(rq ?? []), ...(ro ?? [])];
  io.log(JSON.stringify(analyze1(reg, runs), null, 2));
  return 0;
}

// Ruling P13: only counted runs whose shareXhigh, upSwitches and requests are finite.
// Ruling P13: only counted runs whose shareXhigh, upSwitches and requests are finite. Ruling P17 (C10): the parameters are per stratum, from
// T's runs on the quality task (`--stratum quality`) or on the other tasks (`--stratum other`).
async function cmdRandomParams(argv, io) {
  const f = parseFlags(argv, { registration: 'string', stratum: 'string', evidence: 'string' });
  needFlags(f, 'random-params', ['registration', 'stratum', 'evidence']);
  if (f.stratum !== 'quality' && f.stratum !== 'other') throw new UsageError(`--stratum must be quality or other, got ${JSON.stringify(f.stratum)}`);
  const reg = loadStep(f, 'random-params', 1);
  const inStratum = (r) => (r.taskId === reg.verdict.qualityTask) === (f.stratum === 'quality');
  const usable = readEvidence(f.evidence, reg.arms.T.tasks).filter((r) => inStratum(r) && isCounted(r) && finite(r.shareXhigh) && finite(r.upSwitches) && finite(r.requests));
  io.log(JSON.stringify(randomParams(usable), null, 2));
  return 0;
}

// ---- check-known ----

const RUN_DIR_RE = /^(.+)\.([A-Za-z])\.(\d+)-a(\d+)$/;

// The one main transcript of a run directory: config/projects/*/*.jsonl (the subagent files sit one level deeper).
function mainTranscript(runDir) {
  const projects = join(runDir, 'config', 'projects');
  const found = [];
  if (existsSync(projects)) {
    for (const slug of readdirSync(projects, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue;
      for (const e of readdirSync(join(projects, slug.name), { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.jsonl')) found.push(join(projects, slug.name, e.name));
      }
    }
  }
  if (found.length !== 1) throw new Error(`${runDir} holds ${found.length} main transcripts under config/projects/*/*.jsonl, expected exactly 1`);
  return found[0];
}

// knownRuns({ low, xhigh, all, task }) -> { name, group, broad, audit, firstEditIndex }[]
export function knownRuns({ low = [], xhigh = [], all = [], task }) {
  const found = [];
  const add = (dir, groupOf) => {
    for (const name of readdirSync(resolve(dir)).sort()) {
      const m = RUN_DIR_RE.exec(name);
      if (m === null || (task !== undefined && m[1] !== task)) continue;
      const group = groupOf(m[2]);
      if (group === null) continue;
      const text = readFileSync(mainTranscript(join(resolve(dir), name)), 'utf8');
      const c = checkRun({ transcriptText: text, modLogText: null, mode: 'toggle' });
      found.push({ name, group, broad: c.broadAt.length > 0, audit: c.audit.length, firstEditIndex: firstEditIndex(text) });
    }
  };
  for (const dir of low) add(dir, () => 'low');
  for (const dir of xhigh) add(dir, () => 'xhigh');
  for (const dir of all) add(dir, (arm) => ({ A: 'xhigh', C: 'low' })[arm] ?? null);
  return found;
}

async function cmdCheckKnown(argv, io) {
  const f = parseFlags(argv, { low: 'list', xhigh: 'list', all: 'list', task: 'string' });
  if (f.low === undefined && f.xhigh === undefined && f.all === undefined) throw new UsageError('check-known needs --low, --xhigh or --all (a runs directory)');
  const runs = knownRuns({ low: f.low, xhigh: f.xhigh, all: f.all, task: f.task });
  for (const r of runs) io.log(`${r.name} group=${r.group} broad=${r.broad} audit=${r.audit} firstEditIndex=${r.firstEditIndex ?? 'none'}`);
  const of = (group) => runs.filter((r) => r.group === group);
  const edits = of('low').map((r) => r.firstEditIndex).filter((i) => i !== null);
  io.log(`xhigh broad: ${of('xhigh').filter((r) => r.broad).length} of ${of('xhigh').length}`);
  io.log(`low broad: ${of('low').filter((r) => r.broad).length} of ${of('low').length}`);
  io.log(`audit hits: ${runs.reduce((sum, r) => sum + r.audit, 0)}`);
  io.log(`switchAt: ${edits.length === 0 ? 'none' : Math.max(3, Math.min(...edits) - 2)}`);
  return 0;
}

const COMMANDS = {
  'stage-config': cmdStageConfig,
  'check-runs': cmdCheckRuns,
  analyze0: cmdAnalyze0,
  analyze1: cmdAnalyze1,
  'random-params': cmdRandomParams,
  'check-known': cmdCheckKnown,
};

export async function main(argv, io = { log: console.log, err: console.error }) {
  const [name, ...rest] = argv;
  const command = Object.hasOwn(COMMANDS, name ?? '') ? COMMANDS[name] : undefined;
  if (command === undefined) {
    io.err(`usage: toggle.mjs <${Object.keys(COMMANDS).join('|')}> [flags]`);
    return 64;
  }
  try {
    return await command(rest, io);
  } catch (err) {
    io.err(`toggle: ${name}: ${err.message}`);
    return err instanceof UsageError ? 64 : 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
