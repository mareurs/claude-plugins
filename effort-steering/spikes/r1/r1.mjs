// r1.mjs — the CLI of the R1 experiment (docs/superpowers/specs/2026-10-13-effort-routing-first-rule-design.md).
// Usage errors exit 64, a refusal or a "no" answer exits 1, as spikes/s5/s5.mjs does. See README.md for the runbook.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadS5Config } from '../s5/prereg.mjs';
import { analyzeR1 } from './r1-analyze.mjs';
import { MIN_USABLE, runStage0 } from './r1-stage0.mjs';

const DEFAULT_WORK_ROOT = join(homedir(), 'work', 'claude', 's5-work');
const DEFAULT_OUT_ROOT = join(homedir(), 'work', 'claude', 's5-work-r1');

class UsageError extends Error {}

// parseFlags(argv, { name: 'string' | 'number' | 'list' }) -> { name: value }. `list` flags repeat.
export function parseFlags(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const name = arg.startsWith('--') ? arg.slice(2) : null;
    if (name === null || !Object.hasOwn(spec, name)) throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
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
  const f = parseFlags(argv, { 'work-root': 'string', 'out-root': 'string', tasks: 'string', cpus: 'number', 'memory-gb': 'number' });
  const workRoot = resolve(f['work-root'] ?? DEFAULT_WORK_ROOT);
  const outRoot = resolve(f['out-root'] ?? DEFAULT_OUT_ROOT);
  const taskIds = f.tasks === undefined ? builtTaskIds(workRoot) : f.tasks.split(',');
  const { report, usable } = await runStage0({ workRoot, outRoot, taskIds, cpus: f.cpus ?? 4, memoryGb: f['memory-gb'] ?? 8, log: io.log });
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

const COMMANDS = { stage0: cmdStage0, analyze: cmdAnalyze };

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
