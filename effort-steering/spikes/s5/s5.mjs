// s5.mjs — the S5 operator CLI. It wires the existing modules together and adds nothing of its own beyond argument parsing, the token file,
// exit codes and printing. The README next to it is the runbook; this header is the contract of the CLI itself.
//
//   node effort-steering/spikes/s5/s5.mjs <subcommand> [options]
//
//   mine --repo <name>=<dir> ... [--since <date>] [--out <file>]    mineCommits over each repo -> tasks/candidates.json
//   build <taskDir> | warm <taskId> | gate <taskId>                 buildTask | warmTask | gateTask   (all take --work-root)
//   images                                                          images/build.sh, then prints images/digests.json
//   proxy up (--log-all | --prereg <file> [--mode <m>]) | down | log
//   run --mode <measure|pilot|calibrate|smoke> --prereg <file> [--tasks <ids>] [--rows <file>] [--concurrency <n>] [--stop-at-cost <usd>]
//       [--retry-exhausted] [--keep-run-dirs] [--open-network] [--token-file <file>]
//   grade <runId> | select --rows <file> | analyze --prereg <file> --rows <file> | simulate [...]
//
// EXIT CODES. 0 the command did what it was asked (for `run`: the batch ran to its end or stopped by a rule; Summary.stopped and Summary.smoke say
// which and how it went); 1 a module threw or refused, a file or manifest could not be read, the token file was refused, or the answer was no (a
// `gate` that is not ok, a `warm` whose build failed); 64 (EX_USAGE, as effort-policy) a malformed command line: usage on stderr, NOTHING on stdout.
// A message goes to stderr as `s5: <subcommand>: <text>`; never a stack.
//
// SEAMS. main(argv, io) -> Promise<number>. io = { stdout, stderr, env, cwd, home, here?, imagesDir?, modules? }: stdout and stderr have
// write(text); env is process.env in real life (the token is put there for runBatch, which reads process.env); cwd resolves relative paths;
// home holds ~/.config/s5/token; here is this directory (tasks/candidates.json); imagesDir holds build.sh and digests.json; modules replaces
// any of MODULES by name (a name that is not one is a TypeError, so a typo cannot fall back to a real module, and with it to Docker).
// The file starts main() only when it is the entry point (realpath of argv[1], as s4-run.mjs does), so importing it runs nothing.
//
// THE TOKEN (`run` only; no other subcommand reads it). An already-set CLAUDE_CODE_OAUTH_TOKEN (not empty) is used, after the same value check as
// the file's (R145: trimEnd, no inner whitespace or control character; the message names the variable), and the file is not touched; runBatch gets the
// validated value. Otherwise ~/.config/s5/token (or --token-file) is opened with O_NOFOLLOW and O_NONBLOCK (a FIFO is refused, not waited on) and judged on the open descriptor: a symlink, anything
// that is not a regular file, a mode with a group or other permission bit (mode & 0o077), a missing file and an empty one (after ALL trailing whitespace is dropped, R143) are refused, and so is a value with whitespace or a
// control character inside; each with a message that names the path (and the mode) and never a value; the mode is checked BEFORE the bytes
// are read. The value goes into io.env for the duration of runBatch and is put back (removed, or restored) afterwards; it is never in an
// argument list, an option, a file, or the printed Summary: everything `run` writes after the token is known passes through a redaction
// of its bytes (`[REDACTED]`) as a last line of defence.
//
// FILES. Loaders: measure -> loadS5Prereg (the committed registration); smoke, pilot, calibrate -> loadS5Config(file, { mode }). `proxy up --prereg`
// picks its loader the same way (--mode, default measure). The rows file of `run` is <workRoot>/rows-<mode>.jsonl unless --rows (one file per
// mode, R133). select and analyze read a rows file line by line: a blank line is skipped, a line with a `type` key is not a Row, a line without a
// string runId is not a Row, an unparsable LAST line is torn (ignored, said on stderr, as runBatch ignores it), an unparsable line anywhere else
// is an error naming the line. A Row of another mode than the command reads (analyze: measure, select: calibrate) or with none is an error
// naming the line and the mode (R142).

import { spawn } from 'node:child_process';
import {
  lstatSync, mkdirSync, openSync, closeSync, constants, fstatSync, readdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeS5, DEFAULT_METHOD, METHODS, selectCalibrated, simulate,
} from './analyze.mjs';
import { buildTask } from './build-task.mjs';
import { DOCKER_PASSTHROUGH } from './docker.mjs';
import { gateTask, warmTask } from './gate-task.mjs';
import { gradeTree, RUN_ID_RE } from './grade.mjs';
import { mineCommits } from './mine.mjs';
import { loadS5Config, loadS5Prereg } from './prereg.mjs';
import {
  DEFAULT_WORK_ROOT, proxyDown, proxyLog, proxyUp,
} from './proxy.mjs';
import { runBatch } from './run.mjs';
import { IMAGE_FOR_REPO, TASK_ID_RE } from './task-def.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// The modules the subcommands call. io.modules replaces them by name.
const MODULES = Object.freeze({
  mineCommits, buildTask, warmTask, gateTask, proxyUp, proxyDown, proxyLog, loadS5Prereg, loadS5Config, runBatch, gradeTree, analyzeS5, selectCalibrated, simulate,
});

const MODES = ['measure', 'pilot', 'calibrate', 'smoke'];
const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
const DEFAULT_SINCE = '2026-09-28';
const REGISTERED_SIM_SEED = 20261008;
const REDACTED = '[REDACTED]';

class UsageError extends Error {}
const usage = (message) => new UsageError(message);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const messageOf = (err) => (err instanceof Error ? err.message : String(err));
const printJson = (io, value) => io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const abs = (io, p) => path.resolve(io.cwd, p);

// ---- argument parsing ----

// spec.flags: name -> 'string' | 'bool' | 'list'. `--name value` and `--name=value`. A value flag needs a non-empty value that does not start with
// `--`; a flag given twice (a list excepted) is refused, as is any `-x` option and a stray positional.
function parseArgs(tokens, spec) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      if (!Object.hasOwn(spec.flags, name)) throw usage(`unknown option --${name}`);
      const kind = spec.flags[name];
      if (kind === 'bool') {
        if (eq !== -1) throw usage(`--${name} takes no value`);
        if (Object.hasOwn(flags, name)) throw usage(`--${name} given twice`);
        flags[name] = true;
        continue;
      }
      let value;
      if (eq !== -1) {
        value = tok.slice(eq + 1);
      } else {
        const next = tokens[i + 1];
        if (next === undefined || next.startsWith('--')) throw usage(`--${name} needs a value`);
        value = next;
        i += 1;
      }
      if (value === '') throw usage(`--${name} needs a non-empty value`);
      if (kind === 'list') {
        (flags[name] ??= []).push(value);
      } else {
        if (Object.hasOwn(flags, name)) throw usage(`--${name} given twice`);
        flags[name] = value;
      }
    } else if (tok.startsWith('-') && tok.length > 1) {
      throw usage(`unknown option ${tok}`);
    } else {
      positionals.push(tok);
    }
  }
  if (positionals.length < spec.positionals.length) throw usage(`missing <${spec.positionals[positionals.length]}>`);
  if (positionals.length > spec.positionals.length) throw usage(`unexpected argument ${positionals[spec.positionals.length]}`);
  return { flags, positionals };
}

const need = (flags, name) => {
  if (flags[name] === undefined) throw usage(`--${name} is required`);
  return flags[name];
};
const intFlag = (flags, name, fallback, min) => {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min) throw usage(`--${name} must be an integer >= ${min}, got ${raw}`);
  return n;
};
const seedFlag = (flags, name, fallback) => {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(n)) throw usage(`--${name} must be a safe integer, got ${raw}`);
  return n;
};
// A strict decimal: Number() alone would accept '', ' ', '0x1' and 'Infinity'.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const numberFlag = (flags, name, fallback, { above } = {}) => {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!DECIMAL.test(raw) || !Number.isFinite(n) || (above !== undefined && !(n > above))) throw usage(`--${name} must be a number${above === undefined ? '' : ` above ${above}`}, got ${raw}`);
  return n;
};
const taskIdArg = (id) => {
  if (!TASK_ID_RE.test(id)) throw usage(`<taskId> must match ${TASK_ID_RE}, got ${id}`);
  return id;
};
const modeFlag = (flags, fallback) => {
  const mode = flags.mode ?? fallback;
  if (!MODES.includes(mode)) throw usage(`--mode must be one of ${MODES.join(', ')}, got ${mode}`);
  return mode;
};
const workRootOf = (io, flags) => abs(io, flags['work-root'] ?? DEFAULT_WORK_ROOT);

// ---- reading what the subcommands share ----

function loadManifest(workRoot, taskId) {
  const file = path.join(workRoot, 'tasks', taskId, 'manifest.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read the manifest ${file} (build the task first): ${err.message}`);
  }
}

// The registration (measure) or a config (the other modes): the same choice for `run` and for `proxy up`.
const loadPrereg = (m, io, mode, file) => (mode === 'measure' ? m.loadS5Prereg(abs(io, file)) : m.loadS5Config(abs(io, file), { mode }));

// -> { rows, typed, noRunId, torn }. `mode` is the one mode the caller reads (R142: analyze reads 'measure', select 'calibrate'): a row of another
// mode, or with none, is refused naming the line, because run ids are the same in every mode and a pilot row counted as a measured one would
// corrupt the Report.
function readRows(io, file, mode) {
  const p = abs(io, file);
  let text;
  try {
    text = readFileSync(p, 'utf8');
  } catch (err) {
    throw new Error(`cannot read the rows file ${p}: ${err.message}`);
  }
  const entries = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    entries.push({ no: i + 1, value: isObject(value) ? value : undefined });
  });
  const bad = entries.filter((e) => e.value === undefined);
  const torn = bad.length === 1 && bad[0] === entries.at(-1);
  if (bad.length > 0 && !torn) throw new Error(`the rows file ${p} line ${bad[0].no} is not a JSON object; only the LAST line can be a torn write, so the file is damaged`);
  const rows = [];
  let typed = 0;
  let noRunId = 0;
  for (const { no, value } of entries) {
    if (value === undefined) continue;
    if (Object.hasOwn(value, 'type')) typed += 1;
    else if (typeof value.runId !== 'string') noRunId += 1;
    else if (value.mode !== mode) {
      throw new Error(`the rows file ${p} line ${no} holds ${value.mode === undefined ? 'a row with no mode' : `a row of mode ${JSON.stringify(value.mode)}`}, but this command reads ${mode} rows only (R142); to use rows of another mode on purpose, copy them into a new file with the mode changed (see the README)`);
    } else rows.push(value);
  }
  return {
    rows, typed, noRunId, torn,
  };
}

const rowsNote = (label, file, r) => `s5: ${label}: read ${r.rows.length} row(s) from ${file}; skipped ${r.typed} typed line(s) and ${r.noRunId} line(s) without a runId${r.torn ? '; ignored a torn last line' : ''}\n`;

// ---- the token ----

// R143, R145: the one check of a token value, for the file and for the environment. ALL trailing whitespace goes (a pasted token ends in newlines,
// CRLF or a space); a token never holds whitespace or a control character, and one that does would fail authentication in every run, looking like
// infrastructure: refused, `what` named (a path or a variable), the value never. -> the validated value.
function checkTokenValue(raw, what) {
  const value = raw.trimEnd();
  if (value === '') throw new Error(`${what} is empty`);
  if (/[\s\p{Cc}]/u.test(value)) throw new Error(`${what} holds whitespace or a control character inside the value (a token has none); check what was pasted`);
  return value;
}


// -> the token, from the file. Throws an Error that names the path (and the mode) and never a value.
function readTokenFile(file) {
  let fd;
  try {
    // O_NONBLOCK: opening a FIFO for reading would otherwise block until a writer comes; the isFile check below then refuses it.
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    if (err.code === 'ELOOP') throw new Error(`token file ${file} is a symlink; refusing to follow it`);
    if (err.code === 'ENOENT') throw new Error(`token file ${file} does not exist (run \`claude setup-token\` and store the token there with mode 600)`);
    throw new Error(`cannot open token file ${file}: ${err.code ?? err.message}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`token file ${file} is not a regular file`);
    if ((st.mode & 0o077) !== 0) {
      throw new Error(`token file ${file} has mode ${(st.mode & 0o777).toString(8).padStart(4, '0')}: a group or other permission bit is set; run chmod 600 on it`);
    }
    return checkTokenValue(readFileSync(fd, 'utf8'), `token file ${file}`);
  } finally {
    closeSync(fd);
  }
}

// ---- subcommands ----

async function cmdMine({ io, m, flags }) {
  const repos = [];
  for (const entry of flags.repo ?? []) {
    const eq = entry.indexOf('=');
    if (eq <= 0 || eq === entry.length - 1) throw usage(`--repo needs <name>=<dir>, got ${entry}`);
    const name = entry.slice(0, eq);
    if (repos.some((r) => r.name === name)) throw usage(`--repo ${name} given twice`);
    repos.push({ name, dir: entry.slice(eq + 1) });
  }
  if (repos.length === 0) throw usage('--repo is required (once per repository)');
  const since = flags.since ?? DEFAULT_SINCE;
  const out = abs(io, flags.out ?? path.join(io.here ?? HERE, 'tasks', 'candidates.json'));
  const candidates = [];
  const perRepo = {};
  for (const { name, dir } of repos) {
    const list = await m.mineCommits(abs(io, dir), { since, repo: name });
    perRepo[name] = list.length;
    candidates.push(...list);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(candidates, null, 2)}\n`);
  printJson(io, { out, count: candidates.length, perRepo });
  return 0;
}

async function cmdBuild({ io, m, flags, positionals }) {
  const { def, ...manifest } = await m.buildTask(abs(io, positionals[0]), { workRoot: workRootOf(io, flags) });
  printJson(io, manifest);
  return 0;
}

async function cmdWarm({ io, m, flags, positionals }) {
  const workRoot = workRootOf(io, flags);
  const result = await m.warmTask(loadManifest(workRoot, taskIdArg(positionals[0])), { workRoot });
  printJson(io, result);
  return result.skipped !== undefined || result.ok === true ? 0 : 1;
}

async function cmdGate({ io, m, flags, positionals }) {
  const workRoot = workRootOf(io, flags);
  const taskId = taskIdArg(positionals[0]);
  const result = await m.gateTask(loadManifest(workRoot, taskId), { workRoot });
  printJson(io, {
    taskId, ok: result.ok, reasons: result.reasons, gatedAt: result.gatedAt, leftover: result.leftover,
  });
  return result.ok === true ? 0 : 1;
}

async function cmdImages({ io }) {
  const dir = io.imagesDir ?? path.join(HERE, 'images');
  // docker's own environment only (the same list as docker.mjs), so that nothing else reaches the script.
  const env = {};
  for (const key of DOCKER_PASSTHROUGH) if (io.env[key] !== undefined) env[key] = io.env[key];
  const { code, signal } = await new Promise((resolve, reject) => {
    const child = spawn('bash', [path.join(dir, 'build.sh')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (chunk) => io.stderr.write(chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (c, s) => resolve({ code: c, signal: s }));
  });
  if (code !== 0) {
    io.stderr.write(`s5: images: build.sh ${signal === null ? `exited with status ${code}` : `was killed by ${signal}`}\n`);
    return 1;
  }
  io.stdout.write(readFileSync(path.join(dir, 'digests.json'), 'utf8'));
  return 0;
}

async function cmdProxyUp({ io, m, flags }) {
  const logAll = flags['log-all'] === true;
  if (logAll === (flags.prereg !== undefined)) throw usage('give exactly one of --log-all and --prereg <file>');
  if (logAll && flags.mode !== undefined) throw usage('--mode goes with --prereg');
  const mode = modeFlag(flags, 'measure');
  const workRoot = workRootOf(io, flags);
  const options = logAll
    ? { mode: 'log-all', workRoot }
    : { mode: 'allowlist', allowlist: [...loadPrereg(m, io, mode, flags.prereg).proxyAllowlist], workRoot };
  printJson(io, await m.proxyUp(options));
  return 0;
}

async function cmdProxyDown({ io, m }) {
  printJson(io, await m.proxyDown());
  return 0;
}

async function cmdProxyLog({ io, m }) {
  io.stdout.write(await m.proxyLog());
  return 0;
}

async function cmdRun({ io, m, flags }) {
  const mode = modeFlag({ mode: need(flags, 'mode') });
  const file = need(flags, 'prereg');
  const taskIds = flags.tasks === undefined ? undefined : flags.tasks.split(',');
  if (taskIds !== undefined && taskIds.some((id) => !TASK_ID_RE.test(id))) throw usage(`--tasks must be task ids separated by commas, got ${flags.tasks}`);
  const concurrency = intFlag(flags, 'concurrency', undefined, 1);
  const stopAtCostUsd = numberFlag(flags, 'stop-at-cost', undefined, { above: 0 });
  if (flags['open-network'] === true && mode !== 'pilot') throw usage('--open-network (the proxy control) is for --mode pilot only');
  const workRoot = workRootOf(io, flags);

  const prereg = loadPrereg(m, io, mode, file);

  // The token: the environment first, then the file. Nothing else in this process reads it.
  const previous = io.env[TOKEN_ENV];
  const fromEnv = typeof previous === 'string' && previous !== '';
  const token = fromEnv ? checkTokenValue(previous, `environment variable ${TOKEN_ENV}`) : readTokenFile(abs(io, flags['token-file'] ?? path.join(io.home, '.config', 's5', 'token')));
  // The validated value is a substring of the operator's raw one, so redacting it covers both.
  const redact = (text) => text.replaceAll(token, REDACTED);

  const options = {
    mode,
    workRoot,
    rowsFile: abs(io, flags.rows ?? path.join(workRoot, `rows-${mode}.jsonl`)),
    ...(taskIds === undefined ? {} : { taskIds }),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(stopAtCostUsd === undefined ? {} : { stopAtCostUsd }),
    retryExhausted: flags['retry-exhausted'] === true,
    ctx: { keepRunDirs: flags['keep-run-dirs'] === true, ...(flags['open-network'] === true ? { network: 'bridge', proxyUrl: null } : {}) },
  };
  io.env[TOKEN_ENV] = token;
  try {
    const summary = await m.runBatch(prereg, options);
    io.stdout.write(redact(`${JSON.stringify(summary, null, 2)}\n`));
    return 0;
  } catch (err) {
    io.stderr.write(redact(`s5: run: ${messageOf(err)}\n`));
    return 1;
  } finally {
    if (previous === undefined) delete io.env[TOKEN_ENV];
    else io.env[TOKEN_ENV] = previous;
  }
}

async function cmdGrade({ io, m, flags, positionals }) {
  const runId = positionals[0];
  const parts = /^(.+)\.[ABC]\.\d+$/.exec(runId);
  if (parts === null || !RUN_ID_RE.test(runId) || !TASK_ID_RE.test(parts[1])) throw usage(`<runId> must read <taskId>.<arm>.<rep> (arm A, B or C), got ${runId}`);
  const workRoot = workRootOf(io, flags);
  const manifest = loadManifest(workRoot, parts[1]);
  const runsDir = path.join(workRoot, 'runs');
  let names = [];
  try {
    names = readdirSync(runsDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const prefix = `${runId}-a`;
  const attempts = names
    .filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
    .map((name) => ({ name, n: Number(name.slice(prefix.length)) }))
    .sort((a, b) => b.n - a.n);
  let workDir = null;
  for (const { name } of attempts) {
    const candidate = path.join(runsDir, name, 'work');
    let st = null;
    try {
      st = lstatSync(candidate);
    } catch {
      st = null;
    }
    if (st !== null && st.isDirectory()) {
      workDir = candidate;
      break;
    }
  }
  if (workDir === null) {
    throw new Error(`no work directory is left for run ${runId} under ${runsDir}: runOne removes it after every run, so a run to be re-graded must have been started with \`run --keep-run-dirs\``);
  }
  printJson(io, await m.gradeTree(manifest, workDir, { workRoot, image: IMAGE_FOR_REPO[manifest.repo] }));
  return 0;
}

async function cmdSelect({ io, m, flags }) {
  const read = readRows(io, need(flags, 'rows'), 'calibrate');
  io.stderr.write(rowsNote('select', flags.rows, read));
  const { kept, dropped } = await m.selectCalibrated(read.rows);
  printJson(io, { kept, dropped });
  return 0;
}

// The two secondary mechanism analyses are descriptive (R62): their numbers, never a verdict.
const descriptive = (part) => ({ signedDelta: part?.signedDelta ?? null, pValue: part?.pValue ?? null });

async function cmdAnalyze({ io, m, flags }) {
  // Both required flags are checked before anything is loaded: a usage error reaches no module.
  const prereg = need(flags, 'prereg');
  const rowsFile = need(flags, 'rows');
  const registration = m.loadS5Prereg(abs(io, prereg));
  const read = readRows(io, rowsFile, 'measure');
  io.stderr.write(rowsNote('analyze', rowsFile, read));
  const report = await m.analyzeS5(read.rows, registration);
  printJson(io, {
    ...report,
    mechanism: { ...report.mechanism, output: descriptive(report.mechanism?.output), total: descriptive(report.mechanism?.total) },
  });
  return 0;
}

const SCENARIOS = Object.freeze([{ deltaB: -0.15, deltaC: 0 }, { deltaB: 0, deltaC: -0.3 }]);

async function cmdSimulate({ io, m, flags }) {
  if (flags.method !== undefined && !METHODS.includes(flags.method)) throw usage(`--method must be one of ${METHODS.join(', ')}, got ${flags.method}`);
  const params = {
    nTasks: intFlag(flags, 'n-tasks', 32, 0),
    runs: { A: intFlag(flags, 'runs-a', 3, 0), B: intFlag(flags, 'runs-b', 3, 0), C: intFlag(flags, 'runs-c', 2, 0) },
    pA: [numberFlag(flags, 'pa-lo', 0.3), numberFlag(flags, 'pa-hi', 0.95)],
    trials: intFlag(flags, 'trials', 1000, 0),
    resamples: intFlag(flags, 'resamples', 1000, 0),
    seed: seedFlag(flags, 'seed', REGISTERED_SIM_SEED),
    method: flags.method ?? DEFAULT_METHOD,
    margin: numberFlag(flags, 'margin', 0.15),
    alpha: numberFlag(flags, 'alpha', 0.05),
  };
  const scenarios = [];
  for (const scenario of SCENARIOS) {
    const { niRate, gateRate } = await m.simulate({ ...params, ...scenario });
    scenarios.push({ ...scenario, niRate, gateRate });
  }
  printJson(io, { params, scenarios });
  return 0;
}

// ---- the table ----

const WORK_ROOT = { 'work-root': 'string' };
const COMMANDS = Object.freeze({
  mine: {
    summary: 'List candidate fix commits (structural rules) of each repo into tasks/candidates.json',
    synopsis: 'mine --repo <name>=<dir> [--repo ...] [--since <date>] [--out <file>]',
    positionals: [],
    flags: { repo: 'list', since: 'string', out: 'string' },
    run: cmdMine,
  },
  build: {
    summary: 'Build one task from its task directory into <work-root>/tasks/<id>/ and print its hashes',
    synopsis: 'build <taskDir> [--work-root <dir>]',
    positionals: ['taskDir'],
    flags: WORK_ROOT,
    run: cmdBuild,
  },
  warm: {
    summary: 'First (cold) cargo build of a built task: the warm target every grade and run starts from',
    synopsis: 'warm <taskId> [--work-root <dir>]',
    positionals: ['taskId'],
    flags: WORK_ROOT,
    run: cmdWarm,
  },
  gate: {
    summary: 'Run the task gate (hidden tests fail at the parent, pass at the fix three times); exit 0 when ok',
    synopsis: 'gate <taskId> [--work-root <dir>]',
    positionals: ['taskId'],
    flags: WORK_ROOT,
    run: cmdGate,
  },
  images: {
    summary: 'Build the three S5 images (images/build.sh) and print images/digests.json',
    synopsis: 'images',
    positionals: [],
    flags: {},
    run: cmdImages,
  },
  'proxy up': {
    summary: 'Start the allowlisting proxy: --log-all (pilot discovery) or the allowlist of --prereg <file>',
    synopsis: 'proxy up (--log-all | --prereg <file> [--mode <measure|pilot|calibrate|smoke>]) [--work-root <dir>]',
    positionals: [],
    flags: { 'log-all': 'bool', prereg: 'string', mode: 'string', ...WORK_ROOT },
    run: cmdProxyUp,
  },
  'proxy down': {
    summary: 'Remove the proxy container and its network (only what carries the s5=1 label)',
    synopsis: 'proxy down',
    positionals: [],
    flags: {},
    run: cmdProxyDown,
  },
  'proxy log': {
    summary: 'Print the proxy container log (in log-all mode: every CONNECT host)',
    synopsis: 'proxy log',
    positionals: [],
    flags: {},
    run: cmdProxyLog,
  },
  run: {
    summary: 'Run a batch (measure, pilot, calibrate or smoke) from a registration or a config; prints the Summary',
    synopsis: 'run --mode <measure|pilot|calibrate|smoke> --prereg <file> [--tasks <ids>] [--rows <file>] [--concurrency <n>] [--stop-at-cost <usd>] [--retry-exhausted] [--keep-run-dirs] [--open-network] [--token-file <file>] [--work-root <dir>]',
    positionals: [],
    flags: {
      mode: 'string', prereg: 'string', tasks: 'string', rows: 'string', concurrency: 'string', 'stop-at-cost': 'string', 'retry-exhausted': 'bool', 'keep-run-dirs': 'bool', 'open-network': 'bool', 'token-file': 'string', ...WORK_ROOT,
    },
    run: cmdRun,
  },
  grade: {
    summary: 'Re-grade a kept run directory (needs `run --keep-run-dirs`); writes no rows',
    synopsis: 'grade <runId> [--work-root <dir>]',
    positionals: ['runId'],
    flags: WORK_ROOT,
    run: cmdGrade,
  },
  select: {
    summary: 'Apply the calibration drop rule to a rows file; prints kept and dropped tasks',
    synopsis: 'select --rows <file>',
    positionals: [],
    flags: { rows: 'string' },
    run: cmdSelect,
  },
  analyze: {
    summary: 'Analyse the measured rows against the committed registration; prints the Report',
    synopsis: 'analyze --prereg <file> --rows <file>',
    positionals: [],
    flags: { prereg: 'string', rows: 'string' },
    run: cmdAnalyze,
  },
  simulate: {
    summary: 'Planted-truth simulation of the registered bounds (defaults: the registered numbers)',
    synopsis: 'simulate [--n-tasks <n>] [--trials <n>] [--resamples <n>] [--seed <n>] [--method <paired-t|percentile>] [--margin <x>] [--alpha <x>] [--runs-a|--runs-b|--runs-c <n>] [--pa-lo <x>] [--pa-hi <x>]',
    positionals: [],
    flags: {
      'n-tasks': 'string', trials: 'string', resamples: 'string', seed: 'string', method: 'string', margin: 'string', alpha: 'string', 'runs-a': 'string', 'runs-b': 'string', 'runs-c': 'string', 'pa-lo': 'string', 'pa-hi': 'string',
    },
    run: cmdSimulate,
  },
});

const helpText = () => {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  const lines = Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(width)}  ${spec.summary}`);
  return `usage: s5 <subcommand> [options]   (the options of each subcommand: the README; a usage error prints the synopsis of the subcommand)\n\n${lines.join('\n')}\n`;
};

function resolveCommand(argv) {
  if (argv.length === 0) throw usage('a subcommand is required');
  let key = argv[0];
  let rest = argv.slice(1);
  if (key === 'proxy') {
    key = `proxy ${argv[1]}`;
    rest = argv.slice(2);
    if (!Object.hasOwn(COMMANDS, key)) throw usage('proxy needs one of: up, down, log');
  }
  if (!Object.hasOwn(COMMANDS, key)) throw usage(`unknown subcommand ${argv[0]}`);
  return { key, spec: COMMANDS[key], rest };
}

function resolveModules(overrides) {
  if (overrides === undefined) return MODULES;
  for (const name of Object.keys(overrides)) {
    if (!Object.hasOwn(MODULES, name)) throw new TypeError(`s5: io.modules names no module called ${name} (the modules are ${Object.keys(MODULES).join(', ')})`);
  }
  return { ...MODULES, ...overrides };
}

export async function main(argv, io) {
  const m = resolveModules(io.modules);
  if (argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
    io.stdout.write(helpText());
    return 0;
  }
  let label = argv[0] ?? 's5';
  let synopsis = 's5 <subcommand> [options]  (s5 --help lists the subcommands)';
  try {
    const { key, spec, rest } = resolveCommand(argv);
    label = key;
    synopsis = `s5 ${spec.synopsis}`;
    const { flags, positionals } = parseArgs(rest, spec);
    return await spec.run({ io, m, flags, positionals });
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr.write(`s5: ${err.message}\nusage: ${synopsis}\n`);
      return 64;
    }
    io.stderr.write(`s5: ${label}: ${messageOf(err)}\n`);
    return 1;
  }
}

// ---- the entry point ----

function isMainModule() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  // A closed stdout pipe must not turn into a crash.
  process.stdout.on('error', () => {});
  main(process.argv.slice(2), {
    stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd(), home: os.homedir(),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`s5: internal error: ${messageOf(err)}\n`);
      process.exitCode = 1;
    },
  );
}
