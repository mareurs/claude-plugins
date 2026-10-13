// r1.mjs — the CLI of the R1 experiment (docs/superpowers/specs/2026-10-13-effort-routing-first-rule-design.md).
// Usage errors exit 64, a refusal or a "no" answer exits 1, as spikes/s5/s5.mjs does. See README.md for the runbook.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadS5Config } from '../s5/prereg.mjs';
import { analyzeR1 } from './r1-analyze.mjs';
import { makeR1Prereg, serializePrereg, stageConfig, verifyRegistered } from './r1-prereg.mjs';
import { simulateR1 } from './r1-sim.mjs';
import { MIN_USABLE, runStage0, savedOutputCapture } from './r1-stage0.mjs';
import { buildR1Root } from './r1-workroot.mjs';

const DEFAULT_WORK_ROOT = join(homedir(), 'work', 'claude', 's5-work');
const DEFAULT_OUT_ROOT = join(homedir(), 'work', 'claude', 's5-work-r1');

class UsageError extends Error {}

// parseFlags(argv, { name: 'string' | 'number' | 'list' | 'switch' }) -> { name: value }. `list` flags repeat; a `switch` takes no value.
export function parseFlags(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const name = arg.startsWith('--') ? arg.slice(2) : null;
    if (name === null || !Object.hasOwn(spec, name)) throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
    if (spec[name] === 'switch') {
      out[name] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
    i += 1;
    if (spec[name] === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${name} must be a number above 0, got ${JSON.stringify(value)}`);
      out[name] = n;
    } else if (spec[name] === 'list') {
      out[name] = [...(out[name] ?? []), value];
    } else {
      out[name] = value;
    }
  }
  return out;
}

// The built tasks of a work root that passed the gate; a `-thin` variant belongs to the S5 thin-spec probe, not to this study.
export function builtTaskIds(workRoot) {
  const tasks = join(workRoot, 'tasks');
  return readdirSync(tasks)
    .filter((id) => !id.endsWith('-thin') && existsSync(join(tasks, id, 'gate.json')))
    .filter((id) => JSON.parse(readFileSync(join(tasks, id, 'gate.json'), 'utf8')).ok === true)
    .sort();
}

async function cmdStage0(argv, io) {
  const f = parseFlags(argv, { 'work-root': 'string', 'out-root': 'string', tasks: 'string', cpus: 'number', 'memory-gb': 'number', 'reuse-output': 'switch' });
  const workRoot = resolve(f['work-root'] ?? DEFAULT_WORK_ROOT);
  const outRoot = resolve(f['out-root'] ?? DEFAULT_OUT_ROOT);
  const taskIds = f.tasks === undefined ? builtTaskIds(workRoot) : f.tasks.split(',');
  const { report, usable } = await runStage0({
    workRoot, outRoot, taskIds, cpus: f.cpus ?? 4, memoryGb: f['memory-gb'] ?? 8, log: io.log,
    // --reuse-output: no Docker, no new capture; the prompts are rebuilt from the f2p.out files an earlier run saved.
    ...(f['reuse-output'] ? { capture: savedOutputCapture(outRoot) } : {}),
  });
  io.log(`usable ${usable} of ${report.length}`);
  if (f.tasks === undefined && usable < MIN_USABLE) {
    io.err(`r1: stage0: ${usable} usable of ${report.length} is below the floor of ${MIN_USABLE}; stop and ask the operator (spec: Stages and decision rule)`);
    return 1;
  }
  return 0;
}

// JSON lines of a rows file. An object that is not a run row (a `stopped` line) stays: analyzeR1 ignores it.
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

async function cmdAnalyze(argv, io) {
  const f = parseFlags(argv, { prereg: 'string', rows: 'list' });
  if (f.prereg === undefined || f.rows === undefined) throw new UsageError('analyze needs --prereg <file> and at least one --rows <file>');
  const prereg = loadS5Config(resolve(f.prereg), { mode: 'calibrate' });
  const rows = f.rows.flatMap((file) => parseRows(readFileSync(resolve(file), 'utf8'), file));
  io.log(JSON.stringify(analyzeR1(rows, prereg), null, 2));
  return 0;
}

// The planted-truth study that picks the registered bound method: support rate at no true difference (power) and at the
// margin (false support), for both methods. Prints one JSON object.
async function cmdSim(argv, io) {
  const f = parseFlags(argv, { 'p-a': 'number', trials: 'number', seed: 'number', 'n-tasks': 'number' });
  const pA = [f['p-a'] ?? 31 / 32];
  const common = { nTasks: f['n-tasks'] ?? 16, runs: 2, pA, trials: f.trials ?? 2000, seed: f.seed ?? 20261013 };
  const out = { params: { ...common }, scenarios: [] };
  for (const method of ['paired-t', 'percentile']) {
    for (const trueDelta of [0, -0.15]) {
      out.scenarios.push({ method, trueDelta, ...simulateR1({ ...common, method, trueDelta }) });
    }
  }
  io.log(JSON.stringify(out, null, 2));
  return 0;
}

// The tasks that go into the work root: ok in the stage 0 report AND `ok` in the Opus leak review. A task the report already
// dropped needs no verdict; a kept one without a verdict is refused, so an unreviewed prompt cannot slip through.
export function usableTasks(report, review) {
  const usable = [];
  for (const entry of report) {
    if (!entry.ok) continue;
    const verdict = review[entry.id];
    if (verdict === undefined) throw new Error(`no review verdict for ${entry.id}`);
    if (!['ok', 'leak', 'unfair'].includes(verdict)) throw new Error(`the review verdict for ${entry.id} must be ok, leak or unfair, got ${JSON.stringify(verdict)}`);
    if (verdict === 'ok') usable.push(entry.id);
  }
  return usable;
}

async function cmdWorkroot(argv, io) {
  const f = parseFlags(argv, { 'src-root': 'string', 'dst-root': 'string' });
  const srcRoot = resolve(f['src-root'] ?? DEFAULT_WORK_ROOT);
  const dstRoot = resolve(f['dst-root'] ?? DEFAULT_OUT_ROOT);
  const stage0 = join(dstRoot, 'stage0');
  const report = JSON.parse(readFileSync(join(stage0, 'report.json'), 'utf8'));
  const review = JSON.parse(readFileSync(join(stage0, 'review.json'), 'utf8'));
  const ids = usableTasks(report, review);
  if (ids.length < MIN_USABLE) throw new Error(`${ids.length} usable tasks is below the floor of ${MIN_USABLE}; stop and ask the operator`);
  const { tasks } = buildR1Root({ srcRoot, dstRoot, tasks: ids.map((id) => ({ id, promptFile: join(stage0, `${id}.prompt.txt`) })) });
  writeFileSync(join(dstRoot, 'workroot-tasks.json'), `${JSON.stringify(tasks, null, 2)}\n`);
  for (const task of tasks) io.log(`${task.id} promptHash=${task.promptHash}`);
  return 0;
}

async function cmdPrereg(argv, io) {
  const f = parseFlags(argv, { base: 'string', 'tasks-file': 'string', method: 'string', resamples: 'number', 'bound-seed': 'number', 'order-seed': 'number', out: 'string' });
  for (const name of ['base', 'tasks-file', 'out']) if (f[name] === undefined) throw new UsageError(`prereg needs --${name} <file>`);
  const method = f.method ?? 'paired-t';
  const bound = { method, resamples: method === 'percentile' ? (f.resamples ?? 4000) : 0, seed: f['bound-seed'] ?? 1 };
  const prereg = makeR1Prereg({
    base: JSON.parse(readFileSync(resolve(f.base), 'utf8')),
    tasks: JSON.parse(readFileSync(resolve(f['tasks-file']), 'utf8')),
    orderSeed: f['order-seed'] ?? 20261013,
    bound,
  });
  writeFileSync(resolve(f.out), serializePrereg(prereg));
  loadS5Config(resolve(f.out), { mode: 'calibrate' });
  io.log(`wrote ${f.out}: ${prereg.tasks.length} tasks, bound ${method}`);
  return 0;
}

async function cmdStageConfig(argv, io) {
  const f = parseFlags(argv, { prereg: 'string', stage: 'number', out: 'string' });
  for (const name of ['prereg', 'stage', 'out']) if (f[name] === undefined) throw new UsageError(`stage-config needs --${name}`);
  const config = stageConfig(JSON.parse(readFileSync(resolve(f.prereg), 'utf8')), f.stage);
  mkdirSync(dirname(resolve(f.out)), { recursive: true });
  writeFileSync(resolve(f.out), serializePrereg(config));
  loadS5Config(resolve(f.out), { mode: 'calibrate' });
  io.log(`wrote ${f.out} (stage ${f.stage})`);
  return 0;
}

async function cmdVerifyRegistered(argv, io) {
  const f = parseFlags(argv, { prereg: 'string' });
  if (f.prereg === undefined) throw new UsageError('verify-registered needs --prereg <file>');
  verifyRegistered(f.prereg);
  io.log(`${f.prereg} equals its HEAD blob`);
  return 0;
}

const COMMANDS = {
  stage0: cmdStage0, workroot: cmdWorkroot, prereg: cmdPrereg, 'stage-config': cmdStageConfig, 'verify-registered': cmdVerifyRegistered, analyze: cmdAnalyze, sim: cmdSim,
};

export async function main(argv, io = { log: console.log, err: console.error }) {
  const [name, ...rest] = argv;
  const command = COMMANDS[name];
  if (command === undefined) {
    io.err(`usage: r1.mjs <${Object.keys(COMMANDS).join('|')}> [flags]`);
    return 64;
  }
  try {
    return await command(rest, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`r1: ${name}: ${err.message}`);
      return 64;
    }
    io.err(`r1: ${name}: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
