// s4-run.mjs — the S4 experiment runner. Turns the registered, committed preregistration
// into prompts x repeats `claude -p` runs (one scratch session each), joins each session's
// decision-log arm with its transcript tokens (s4-rows.mjs), calls analyzeArms, and returns
// a verdict plus a `stop` list.
//
// SAFETY GATES. runExperiment takes the prereg FILE PATH and calls loadPrereg on it FIRST
// (ruling R21), so an incomplete, uncommitted or edited prereg stops everything before any
// spawn, whoever the caller is. Nothing spawns unless confirm === true, and the hook
// latency gate (no model call) runs before the first `claude` call: a slow hook costs
// nothing. Every run is isolated: the scratch settings register one hook that points at a
// COPY of effort-steering/ (one rule that matches every prompt), the child gets its own
// XDG_STATE_HOME, and every temp directory is resolved to an absolute real path (a relative
// TMPDIR would make log.mjs ignore the state dir and write to the real ~/.local/state).
//
// KNOWN RESIDUE: each run leaves its transcript in the REAL config dir,
// <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<slug of the temp cwd>/<sessionId>.jsonl.
// That is how the tokens are measured (no --no-session-persistence), and nothing here
// cleans it up.
//
// Failed runs never become measurements (R22): a spawn error, signal or non-zero exit, a
// missing log/transcript, an ambiguous transcript, or an API-error transcript EXCLUDES the
// run; `excluded` counts them, `excludedByReason` splits them, and any exclusion puts
// `runs_excluded` in `stop`.
//
// Tests inject `spawn`; the default is the real thing. Nothing here runs at import.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeArms } from './s4-analyze.mjs';
import { loadPrereg, runGit } from './s4-prereg.mjs';
import { makeRng, shuffle } from './s4-prng.mjs';
import { buildRow } from './s4-rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ES_ROOT = path.join(HERE, '..');
const HOOK_REL = path.join('adapter', 'claude-code', 'user-prompt-submit.mjs');
const DEFAULT_PREREG = path.join(HERE, 's4-prereg.json');
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const HOOK_TIMEOUT_MS = 30 * 1000;
const REASONS = ['no_log', 'arm_mismatch', 'not_steered', 'steered_holdout', 'no_transcript', 'ambiguous_transcript', 'spawn_failed', 'api_error', 'no_thinking_field'];
const PLAN_STREAM = 0;
// The holdout rate a run's hook reads: '1' always holds the turn out, '0' always steers it.
const RATE_FOR = { holdout: '1', treated: '0' };

const defaultSpawn = (cmd, args, opts) => spawnSync(cmd, args, opts);
const failed = (res) => !res || Boolean(res.error) || Boolean(res.signal) || res.status !== 0;
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// An absolute, symlink-resolved temp dir; a relative TMPDIR cannot leak through.
function makeRoot(prefix, base) {
  const dir = realpathSync(mkdtempSync(path.join(base ?? os.tmpdir(), prefix)));
  if (!path.isAbsolute(dir)) throw new Error(`s4-run: temp dir ${dir} is not absolute`);
  return dir;
}

// Ruling R24: the RUNNER assigns the arms, balanced within each prompt. Per prompt,
// holdoutCountFor(repeats, holdoutRate) of the repeats are holdout; which ones, and the
// global run order (prompts and arms interleaved), come from the registered seed (stream 0;
// the permutation test uses stream 1). Session ids are fresh UUIDs, never derived from the
// seed: a re-run must not collide with an earlier run's transcript.
export function holdoutCountFor(repeats, holdoutRate) {
  return Math.min(repeats - 1, Math.max(1, Math.round(repeats * holdoutRate)));
}

export function planRuns(prereg) {
  const rng = makeRng(prereg.seed, PLAN_STREAM);
  const holdoutCount = holdoutCountFor(prereg.repeats, prereg.holdoutRate);
  const runs = [];
  prereg.prompts.forEach((prompt, promptIndex) => {
    const held = new Set(shuffle([...Array(prereg.repeats).keys()], rng).slice(0, holdoutCount));
    for (let r = 0; r < prereg.repeats; r++) {
      runs.push({ sessionId: randomUUID(), promptIndex, prompt, arm: held.has(r) ? 'holdout' : 'treated' });
    }
  });
  return shuffle(runs, rng);
}

// Nearest rank: sorted[ceil(0.95 * n) - 1]. A hook run that errors, is killed or exits
// non-zero fails the gate whatever its time.
export function measureHookLatency(prereg, opts = {}) {
  const spawn = opts.spawn ?? defaultSpawn;
  const now = opts.now ?? (() => performance.now());
  const root = makeRoot('s4-latency-', opts.tmpDir);
  const times = [];
  let failures = 0;
  try {
    const hook = path.join(ES_ROOT, HOOK_REL);
    const env = { ...process.env, XDG_STATE_HOME: path.join(root, 'state'), EFFORT_STEERING_HOLDOUT_RATE: RATE_FOR.treated };
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
        const res = spawn(process.execPath, [hook], { input, env, cwd: root, encoding: 'utf8', timeout: HOOK_TIMEOUT_MS, killSignal: 'SIGKILL' });
        times.push(now() - t0);
        if (failed(res)) failures++;
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  const p95Ms = n === 0 ? null : sorted[Math.ceil(0.95 * n) - 1];
  return { n, p95Ms, failures, ok: p95Ms !== null && failures === 0 && p95Ms <= prereg.latencyBudgetMs };
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
  const settings = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${shellQuote(process.execPath)} ${shellQuote(hook)}` }] }] } };
  const file = path.join(root, 'settings.json');
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return file;
}

// The prereg's repo HEAD, through loadPrereg's own git runner (every GIT_* variable dropped).
function gitHead(file) {
  const r = runGit(path.resolve(file), ['rev-parse', 'HEAD']);
  return !r.error && r.status === 0 ? String(r.stdout).trim() : null;
}

// Gate on "is a clean pass" rather than listing the bad verdicts: an unknown verdict stops.
export function stopReasons(analysis, latency, excluded = 0) {
  const stop = [];
  const v = analysis.verdict;
  if (v !== 'mechanism_pass') {
    if (v === 'mechanism_fail') stop.push('mechanism_fail');
    else if (v === 'insufficient_data') stop.push('insufficient_data');
    else stop.push('verdict_unknown');
  }
  if (analysis.cacheOk !== true) stop.push('cache_not_ok');
  if (latency.ok !== true) stop.push('latency_not_ok');
  if (excluded > 0) stop.push('runs_excluded');
  return stop;
}

const zeroReasons = () => Object.fromEntries(REASONS.map((r) => [r, 0]));

// opts (tests): spawn, confirm, configDir, now, out, tmpDir.
export async function runExperiment(preregFile, opts = {}) {
  // R21: the registration gate comes before planning, latency or any spawn.
  const prereg = loadPrereg(preregFile);
  const spawn = opts.spawn ?? defaultSpawn;
  const out = opts.out ?? ((s) => console.log(s));
  const runs = planRuns(prereg);
  const gitCommit = gitHead(preregFile);
  if (opts.confirm !== true) {
    out(`s4-run: ${runs.length} model calls (model ${prereg.model}); nothing spawned, pass --confirm to run`);
    return { verdict: 'not_run', analysis: null, latency: null, excluded: 0, excludedByReason: zeroReasons(), stop: ['not_confirmed'], calls: runs.length, gitCommit };
  }

  // The latency gate costs no model call: a slow hook stops here, before any claude call.
  const latency = measureHookLatency(prereg, { spawn, now: opts.now, tmpDir: opts.tmpDir });
  if (latency.ok !== true) {
    return { verdict: 'not_run', analysis: null, latency, excluded: 0, excludedByReason: zeroReasons(), stop: ['latency_not_ok'], calls: 0, gitCommit };
  }

  const root = makeRoot('s4-run-', opts.tmpDir);
  try {
    const settings = writeScratch(prereg, root);
    const stateHome = path.join(root, 'state');
    const cwd = path.join(root, 'work');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(stateHome, { recursive: true });
    const spawnFailed = new Set();
    for (const run of runs) {
      // R24: the planned arm reaches the hook as a rate it cannot misread, '1' or '0'.
      const env = { ...process.env, EFFORT_STEERING_HOLDOUT_RATE: RATE_FOR[run.arm], XDG_STATE_HOME: stateHome };
      // `--` ends option parsing: a prompt that starts with `-` is still a prompt.
      const args = ['-p', '--model', prereg.model, '--session-id', run.sessionId, '--setting-sources', 'local', '--settings', settings, '--strict-mcp-config', '--', run.prompt];
      const res = await spawn('claude', args, { cwd, env, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' });
      if (failed(res)) spawnFailed.add(run.sessionId);
    }
    const rows = [];
    const byReason = zeroReasons();
    let excluded = 0;
    for (const run of runs) {
      const built = spawnFailed.has(run.sessionId)
        ? { reason: 'spawn_failed' }
        : buildRow(run.sessionId, { stateDir: path.join(stateHome, 'effort-steering'), configDir: opts.configDir, plannedArm: run.arm, promptIndex: run.promptIndex });
      if (built.row) {
        rows.push(built.row);
      } else {
        excluded++;
        byReason[built.reason]++;
      }
    }
    const analysis = analyzeArms(rows, prereg);
    return { verdict: analysis.verdict, analysis, latency, excluded, excludedByReason: byReason, stop: stopReasons(analysis, latency, excluded), gitCommit };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The entry point. The only flag is the exact string --confirm; deps.confirm is ignored.
export async function main(argv, deps = {}) {
  if (!Array.isArray(argv)) throw new TypeError('s4-run: argv must be an array');
  return runExperiment(deps.preregFile ?? DEFAULT_PREREG, { ...deps, confirm: argv.includes('--confirm') });
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
