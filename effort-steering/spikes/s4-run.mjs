// s4-run.mjs — the S4 experiment runner. Turns the registered, committed preregistration
// into prompts x repeats `claude -p` runs (one scratch session each), joins each session's
// decision-log arm with its transcript tokens (s4-rows.mjs), calls analyzeArms, and returns
// a verdict plus a `stop` list.
//
// SAFETY GATES. `main` calls loadPrereg FIRST, so an incomplete, uncommitted or edited
// prereg stops everything before any spawn. runExperiment spawns nothing unless
// confirm === true. Every run is isolated: the scratch settings register one hook that
// points at a COPY of effort-steering/ (one rule that matches every prompt), and the child
// gets its own XDG_STATE_HOME, so nothing lands in the real ~/.local/state.
//
// Tests inject `spawn`; the default is the real thing. Nothing here runs at import.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeArms } from './s4-analyze.mjs';
import { loadPrereg } from './s4-prereg.mjs';
import { buildRow } from './s4-rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ES_ROOT = path.join(HERE, '..');
const HOOK_REL = path.join('adapter', 'claude-code', 'user-prompt-submit.mjs');
const DEFAULT_PREREG = path.join(HERE, 's4-prereg.json');
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

const defaultSpawn = (cmd, args, opts) => spawnSync(cmd, args, opts);

export function planRuns(prereg) {
  const runs = [];
  for (const prompt of prereg.prompts) {
    for (let i = 0; i < prereg.repeats; i++) runs.push({ sessionId: randomUUID(), prompt });
  }
  return runs;
}

// Nearest rank: sorted[ceil(0.95 * n) - 1].
export function measureHookLatency(prereg, opts = {}) {
  const spawn = opts.spawn ?? defaultSpawn;
  const now = opts.now ?? (() => performance.now());
  const root = mkdtempSync(path.join(os.tmpdir(), 's4-latency-'));
  const times = [];
  try {
    const hook = path.join(ES_ROOT, HOOK_REL);
    const env = { ...process.env, XDG_STATE_HOME: path.join(root, 'state'), EFFORT_STEERING_HOLDOUT_RATE: String(prereg.holdoutRate) };
    for (const prompt of prereg.prompts) {
      for (let i = 0; i < prereg.repeats; i++) {
        const input = JSON.stringify({
          session_id: randomUUID(),
          prompt_id: randomUUID(),
          prompt,
          hook_event_name: 'UserPromptSubmit',
          cwd: root,
          transcript_path: '',
          permission_mode: 'default',
        });
        const t0 = now();
        spawn(process.execPath, [hook], { input, env, cwd: root, encoding: 'utf8', timeout: 30000 });
        times.push(now() - t0);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  const p95Ms = n === 0 ? null : sorted[Math.ceil(0.95 * n) - 1];
  return { n, p95Ms, ok: p95Ms !== null && p95Ms <= prereg.latencyBudgetMs };
}

// Copy bin/, core/, adapter/ into the scratch root, give the copy a one-rule rules.json,
// and write the settings file that registers the copy's hook. Returns the settings path.
function writeScratch(prereg, root) {
  const copy = path.join(root, 'es');
  for (const dir of ['bin', 'core', 'adapter']) {
    cpSync(path.join(ES_ROOT, dir), path.join(copy, dir), { recursive: true, filter: (src) => !src.endsWith('.test.mjs') });
  }
  const rule = {
    id: 's4-all',
    level: prereg.steerLevel,
    confidence: prereg.steerLevel === 'shallow' ? 'high' : 'medium',
    reason: 's4',
    when: { minChars: 0 },
  };
  writeFileSync(path.join(copy, 'core', 'rules.json'), `${JSON.stringify({ version: 1, rules: [rule] })}\n`);
  const hook = path.join(copy, HOOK_REL);
  const settings = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `"${process.execPath}" "${hook}"` }] }] } };
  const file = path.join(root, 'settings.json');
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return file;
}

function gitHead(file) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.dirname(file), encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

export function stopReasons(analysis, latency) {
  const stop = [];
  if (analysis.verdict === 'mechanism_fail') stop.push('mechanism_fail');
  if (analysis.verdict === 'insufficient_data') stop.push('insufficient_data');
  if (analysis.cacheOk !== true) stop.push('cache_not_ok');
  if (latency.ok !== true) stop.push('latency_not_ok');
  return stop;
}

// deps (tests): spawn, confirm, configDir, now, out, preregFile, gitCommit.
export async function runExperiment(prereg, opts = {}) {
  const spawn = opts.spawn ?? defaultSpawn;
  const out = opts.out ?? ((s) => console.log(s));
  const preregFile = opts.preregFile ?? DEFAULT_PREREG;
  const runs = planRuns(prereg);
  const gitCommit = opts.gitCommit ?? gitHead(preregFile);
  if (opts.confirm !== true) {
    out(`s4-run: ${runs.length} model calls (model ${prereg.model}); nothing spawned, pass --confirm to run`);
    return { verdict: 'not_run', analysis: null, latency: null, excluded: 0, stop: ['not_confirmed'], calls: runs.length, gitCommit };
  }

  const root = mkdtempSync(path.join(os.tmpdir(), 's4-run-'));
  try {
    const settings = writeScratch(prereg, root);
    const stateHome = path.join(root, 'state');
    const cwd = path.join(root, 'work');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(stateHome, { recursive: true });
    const env = { ...process.env, EFFORT_STEERING_HOLDOUT_RATE: String(prereg.holdoutRate), XDG_STATE_HOME: stateHome };
    for (const run of runs) {
      const args = ['-p', run.prompt, '--model', prereg.model, '--session-id', run.sessionId, '--setting-sources', 'local', '--settings', settings];
      await spawn('claude', args, { cwd, env, encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
    }
    const rows = [];
    let excluded = 0;
    for (const run of runs) {
      const row = buildRow(run.sessionId, { stateDir: path.join(stateHome, 'effort-steering'), configDir: opts.configDir });
      if (row === null) excluded++;
      else rows.push(row);
    }
    const analysis = analyzeArms(rows, prereg);
    const latency = measureHookLatency(prereg, { spawn, now: opts.now });
    return { verdict: analysis.verdict, analysis, latency, excluded, stop: stopReasons(analysis, latency), gitCommit };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The entry point: loadPrereg runs BEFORE anything can spawn.
export async function main(argv, deps = {}) {
  const prereg = loadPrereg(deps.preregFile ?? DEFAULT_PREREG);
  return runExperiment(prereg, { ...deps, confirm: argv.includes('--confirm') });
}

function isMainModule() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).then(
    (result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.stop.length > 0) process.exitCode = 2;
    },
    (err) => {
      console.error(`s4-run: ${err.message}`);
      process.exitCode = 1;
    },
  );
}
