// s4-run.mjs — the S4 experiment runner. Turns the registered, committed preregistration
// into ONE canary plus prompts x repeats `claude -p` runs (one scratch session each),
// assigns every run's arm itself (balanced within each prompt, ruling R24), joins each
// session's decision log with its transcript tokens (s4-rows.mjs), calls analyzeArms, and
// returns a verdict plus a `stop` list.
//
// ORDER. Each step refuses before the next one can spend anything:
//   1. loadPrereg(preregFile) (R21): an incomplete, uncommitted or edited prereg throws.
//   2. Read-only git, with loadPrereg's own GIT_* scrub (runGit): treeCommit (HEAD of the
//      repo holding effort-steering/), preregCommit (the last commit that touched the
//      prereg file), and `git status --porcelain --ignored -- effort-steering`. Any
//      modified, untracked or ignored file refuses (dirty_tree): the scratch copy below is
//      taken from the WORKING TREE, so it equals treeCommit only when the tree is clean.
//   3. The scratch copy (bin/ core/ adapter/, one rule matching every prompt) and the
//      steerability preflight (I-1): the copied CLI decides every registered prompt with
//      --holdout-rate=0 (no --log); a prompt that gets no steer (an "ultrathink" logs
//      user_override) refuses with prompt_not_steerable and the prompt INDEXES.
//   4. The confirm check: without opts.confirm === true, print the call count and return
//      (not_confirmed). Steps 1-3 run BEFORE it: they read files, run git and run the copied
//      CLI with node in a temp dir; they never run the hook and never call a model.
//   5. The hook latency gate on the scratch copy's hook (no model call): latency_not_ok.
//   6. ONE canary `claude` run: prompt 0, treated, a fresh session id, EXCLUDED from the
//      rows. It must leave a log line (treated, steered), exactly one transcript, a usable row
//      and the REGISTERED effort on every assistant record (effort_mismatch); anything else refuses with canary_failed and NO further claude call.
//   7. The planned runs, in the seeded order (prompts and arms interleaved); the analysis.
//
// STOP REASONS. A not_run result holds one of: dirty_tree, prompt_not_steerable,
// not_confirmed, latency_not_ok, canary_failed. A completed run holds any of:
// mechanism_fail, insufficient_data, verdict_unknown, cache_not_ok, latency_not_ok,
// runs_excluded. `stop` is empty only for mechanism_pass with cacheOk true, the latency
// gate held and no run excluded.
//
// WHAT IS ISOLATED. Each run has a fresh session id, its own cwd and a temp XDG_STATE_HOME
// under one temp root (decision logs never reach ~/.local/state; every temp dir is an
// absolute real path, because log.mjs ignores a relative XDG_STATE_HOME). Settings come only
// from the scratch file (--setting-sources local --settings <file> --strict-mcp-config).
// The child environment is a WHITELIST (I-2): PATH HOME USER LANG LC_* TERM SHELL, and
// CLAUDE_CONFIG_DIR when set and non-empty, plus EFFORT_STEERING_HOLDOUT_RATE ('1' holdout,
// '0' treated), the temp XDG_STATE_HOME and TMPDIR (the resolved temp dir). Nothing else is
// passed: no ANTHROPIC_* (so ANTHROPIC_BASE_URL, e.g. a local llm-proxy, is never used and
// the endpoint is Claude Code's default), no CLAUDECODE, CLAUDE_CODE_*, CLAUDE_PROJECT_DIR.
// The result records the passed NAMES (childEnvKeys), never values, and endpoint 'default'.
// The latency hooks get PATH, HOME, the temp XDG_STATE_HOME and rate '0' only.
//
// WHAT IS NOT ISOLATED. The runs use the operator's real profile (CLAUDE_CONFIG_DIR, or
// ~/.claude through HOME) for credentials and billing, so each run leaves its transcript in
// <config dir>/projects/<slug of the temp cwd>/<sessionId>.jsonl (that is the measurement:
// no --no-session-persistence; nothing here cleans it) and may add a project entry to
// .claude.json. TMPDIR is the real temp dir. The hook inside each run inherits Claude
// Code's environment, which Claude Code builds from the whitelist above.
//
// Failed runs never become measurements (R22, R24): a spawn error, signal or non-zero exit,
// a missing or ambiguous log/transcript, an arm that differs from the plan, a treated run
// that was not steered, a steered holdout run, an API-error transcript or one that never
// reports thinking_tokens EXCLUDES the run; `excluded` counts them, `excludedByReason`
// splits them, and any exclusion puts `runs_excluded` in `stop`.
//
// Tests inject `spawn` for the claude and hook runs, and `esRoot` for the tree that is
// checked and copied; the defaults are the real thing. Nothing here runs at import. No
// prompt text is ever printed or returned: only counts, indexes, verdicts and names.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../adapter/claude-code/build-context.mjs';
import { runPolicy } from '../adapter/claude-code/run-policy.mjs';
import { stateDirFor } from '../core/log.mjs';
import { analyzeArms } from './s4-analyze.mjs';
import { holdoutCountFor, loadPrereg, runGit } from './s4-prereg.mjs';
import { makeRng, shuffle } from './s4-prng.mjs';
import { buildRow } from './s4-rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ES_ROOT = path.join(HERE, '..');
const HOOK_REL = path.join('adapter', 'claude-code', 'user-prompt-submit.mjs');
const CLI_REL = path.join('bin', 'effort-policy.mjs');
const DEFAULT_PREREG = path.join(HERE, 's4-prereg.json');
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const HOOK_TIMEOUT_MS = 30 * 1000;
const REASONS = ['no_log', 'arm_mismatch', 'not_steered', 'steered_holdout', 'no_transcript', 'ambiguous_transcript', 'spawn_failed', 'api_error', 'no_thinking_field', 'effort_mismatch'];
const PLAN_STREAM = 0;
// The holdout rate a run's hook reads: '1' always holds the turn out, '0' always steers it.
const RATE_FOR = { holdout: '1', treated: '0' };
// I-2: the only parent variables a claude child gets (plus LC_*).
const PASSED_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'TERM', 'SHELL', 'CLAUDE_CONFIG_DIR'];
// A hook's alert line (user-prompt-submit.mjs writes `effort-steering: <reason>`).
const ALERT_LINE = /^effort-steering:/m;

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
// holdoutCountFor(repeats, holdoutRate) of the repeats are holdout (the rule lives in
// s4-prereg.mjs, where the loader's feasibility checks read it too); which ones, and the
// global run order (prompts and arms interleaved), come from the registered seed (stream 0;
// the permutation test uses stream 1). Session ids are fresh UUIDs, never derived from the
// seed: a re-run must not collide with an earlier run's transcript.
export { holdoutCountFor };

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

// The claude child's environment: the whitelist, never `{ ...process.env }`.
function childEnv(parent, { holdoutRate, stateHome, tmpDir }) {
  const env = {};
  for (const [k, v] of Object.entries(parent)) {
    if (typeof v === 'string' && (PASSED_ENV.includes(k) || k.startsWith('LC_'))) env[k] = v;
  }
  // "when set": an empty CLAUDE_CONFIG_DIR means the default profile, as in findTranscripts.
  if (env.CLAUDE_CONFIG_DIR === '') delete env.CLAUDE_CONFIG_DIR;
  env.EFFORT_STEERING_HOLDOUT_RATE = holdoutRate;
  env.XDG_STATE_HOME = stateHome;
  env.TMPDIR = tmpDir;
  return env;
}
const childEnvKeys = (parent) => Object.keys(childEnv(parent, { holdoutRate: '0', stateHome: '/', tmpDir: '/' })).sort();

// A latency hook's environment: what the hook needs and nothing else; always the steering path.
function hookEnv(parent, stateHome) {
  const env = {};
  for (const k of ['PATH', 'HOME']) if (typeof parent[k] === 'string') env[k] = parent[k];
  env.XDG_STATE_HOME = stateHome;
  env.EFFORT_STEERING_HOLDOUT_RATE = RATE_FOR.treated;
  return env;
}

// True when the hook's decision log in `stateHome` holds a line for `sessionId`.
function loggedFor(stateHome, sessionId) {
  let text;
  try {
    text = readFileSync(path.join(stateDirFor({ XDG_STATE_HOME: stateHome }), `${sessionId}.jsonl`), 'utf8');
  } catch {
    return false;
  }
  return text.split('\n').some((line) => {
    try {
      const rec = JSON.parse(line);
      return rec !== null && typeof rec === 'object' && rec.session_id === sessionId;
    } catch {
      return false;
    }
  });
}

const alerted = (res) => ALERT_LINE.test(typeof res.stderr === 'string' ? res.stderr : String(res.stderr ?? ''));

// Copy bin/, core/, adapter/ of `esRoot` into the scratch root, give the copy a one-rule
// rules.json, and write the settings file that registers the copy's hook.
function writeScratch(prereg, root, esRoot) {
  const copy = path.join(root, 'es');
  for (const dir of ['bin', 'core', 'adapter']) {
    cpSync(path.join(esRoot, dir), path.join(copy, dir), { recursive: true, filter: (src) => !src.endsWith('.test.mjs') });
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
  return { settings: file, hook, cli: path.join(copy, CLI_REL) };
}

// Nearest rank: sorted[ceil(0.95 * n) - 1]. A hook run FAILS the gate whatever its time when
// it errors, is killed or exits non-zero, writes an alert line to stderr (it fell back:
// adapter_cli_failed, adapter_timeout, ...), or leaves no log line for its own session id.
// opts: spawn, now, tmpDir, and hook (the copy to measure) or esRoot (to copy one here).
export function measureHookLatency(prereg, opts = {}) {
  const spawn = opts.spawn ?? defaultSpawn;
  const now = opts.now ?? (() => performance.now());
  const root = makeRoot('s4-latency-', opts.tmpDir);
  const times = [];
  let failures = 0;
  try {
    // M-5: the measured hook is the steering copy, so the measured path is the steering path.
    const hook = opts.hook ?? writeScratch(prereg, root, opts.esRoot ?? ES_ROOT).hook;
    const stateHome = path.join(root, 'state');
    const env = hookEnv(process.env, stateHome);
    for (const prompt of prereg.prompts) {
      for (let i = 0; i < prereg.repeats; i++) {
        const sessionId = randomUUID();
        const input = JSON.stringify({
          session_id: sessionId,
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
        if (failed(res) || alerted(res) || !loggedFor(stateHome, sessionId)) failures++;
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

const gitOut = (r) => (!r.error && r.status === 0 ? String(r.stdout).trim() : null);

// M-1: is the tree that will be copied exactly its HEAD? runGit runs `git -C <parent of
// esRoot>`, so the pathspec is the directory's own name (effort-steering). A git failure
// (no repo, no git) counts as dirty: fail closed.
function treeState(esRoot) {
  const status = runGit(esRoot, ['--no-optional-locks', 'status', '--porcelain', '--ignored', '--', path.basename(esRoot)]);
  return {
    clean: !status.error && status.status === 0 && String(status.stdout) === '',
    treeCommit: gitOut(runGit(esRoot, ['rev-parse', 'HEAD'])),
  };
}

// The commit that registered the prereg: the last one that touched the file.
function preregCommitOf(file) {
  const abs = path.resolve(file);
  return gitOut(runGit(abs, ['log', '-1', '--format=%H', '--', path.basename(abs)])) || null;
}

// I-1: the indexes of the registered prompts the copied CLI does not steer at rate 0.
// I-1: the indexes of the registered prompts the copied CLI does not steer at rate 0. The
// CLI runs with the same whitelisted environment a claude child gets: runPolicy merges its
// `env` over process.env, and an undefined value unsets a variable, so every other parent
// variable is unset first.
function unsteerablePrompts(prereg, cli, stateHome, tmpDir) {
  const env = Object.fromEntries(Object.keys(process.env).map((k) => [k, undefined]));
  Object.assign(env, childEnv(process.env, { holdoutRate: RATE_FOR.treated, stateHome, tmpDir }));
  const bad = [];
  prereg.prompts.forEach((prompt, i) => {
    const ctx = buildContext({ session_id: randomUUID(), prompt_id: randomUUID(), prompt, hook_event_name: 'UserPromptSubmit' });
    const res = runPolicy(ctx, { cliPath: cli, args: [`--holdout-rate=${RATE_FOR.treated}`], env });
    if (typeof res.steer !== 'string' || res.steer === '') bad.push(i);
  });
  return bad;
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

// opts (tests): spawn, confirm, configDir, now, out, tmpDir, esRoot.
export async function runExperiment(preregFile, opts = {}) {
  // R21: the registration gate comes before planning, git, latency or any spawn.
  const prereg = loadPrereg(preregFile);
  const spawn = opts.spawn ?? defaultSpawn;
  const out = opts.out ?? ((s) => console.log(s));
  const esRoot = opts.esRoot ?? ES_ROOT;
  const runs = planRuns(prereg);
  const tree = treeState(esRoot);
  const base = {
    plannedCalls: runs.length + 1,
    claudeCalls: 0,
    treeCommit: tree.treeCommit,
    preregCommit: preregCommitOf(preregFile),
    endpoint: 'default',
    childEnvKeys: childEnvKeys(process.env),
  };
  const notRun = (stop, extra = {}) => ({ verdict: 'not_run', analysis: null, latency: null, canary: null, excluded: 0, excludedByReason: zeroReasons(), stop, ...base, ...extra });

  if (!tree.clean) {
    out('s4-run: refused: effort-steering/ has uncommitted, untracked or ignored files (the scratch copy is taken from the working tree)');
    return notRun(['dirty_tree']);
  }

  const root = makeRoot('s4-run-', opts.tmpDir);
  try {
    const scratch = writeScratch(prereg, root, esRoot);
    const tmpDir = path.dirname(root);
    const bad = unsteerablePrompts(prereg, scratch.cli, path.join(root, 'preflight-state'), tmpDir);
    if (bad.length > 0) {
      out(`s4-run: refused: ${bad.length} registered prompt(s) do not steer (indexes ${bad.join(', ')})`);
      return notRun(['prompt_not_steerable'], { notSteerable: bad });
    }
    if (opts.confirm !== true) {
      out(`s4-run: ${runs.length + 1} model calls (${runs.length} runs + 1 canary, model ${prereg.model}); no hook run and no model call made, pass --confirm to run`);
      return notRun(['not_confirmed']);
    }

    // The latency gate costs no model call: a slow or failing hook stops here.
    const latency = measureHookLatency(prereg, { spawn, now: opts.now, tmpDir: opts.tmpDir, hook: scratch.hook });
    if (latency.ok !== true) return notRun(['latency_not_ok'], { latency });

    const stateHome = path.join(root, 'state');
    const stateDir = stateDirFor({ XDG_STATE_HOME: stateHome });
    const cwd = path.join(root, 'work');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(stateHome, { recursive: true });
    let claudeCalls = 0;
    const runClaude = async (sessionId, prompt, arm) => {
      claudeCalls++;
      // `--thinking-display summarized`: without it a headless run under these settings sends
      // `display: "omitted"` and the transcript keeps signed thinking blocks with no text. The flag
      // changes visibility only; Anthropic's docs say the billed thinking tokens are the same either
      // way. Direct runs on Sonnet 5.5 and Opus 5.5 (2026-10-07, ES-16) showed text with the flag and
      // none without. Both arms get it, so it is not a confound.
      // `--effort <registered>`: a saved /model or settings default never reaches a
      // `--setting-sources local` child, so without it every run uses the default `medium`, where
      // Sonnet 5.5 thinks 0 tokens on most prompts (ES-18). The registered level is what the arms differ from.
      // `--` ends option parsing (loadPrereg also refuses a prompt that starts with - or /).
      const args = ['-p', '--model', prereg.model, '--session-id', sessionId, '--setting-sources', 'local', '--settings', scratch.settings, '--strict-mcp-config', '--thinking-display', 'summarized', '--effort', prereg.effort, '--', prompt];
      const env = childEnv(process.env, { holdoutRate: RATE_FOR[arm], stateHome, tmpDir });
      return spawn('claude', args, { cwd, env, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' });
    };
    const rowOf = (res, sessionId, arm, promptIndex) =>
      failed(res) ? { reason: 'spawn_failed' } : buildRow(sessionId, { stateDir, configDir: opts.configDir, plannedArm: arm, promptIndex, effort: prereg.effort });

    // I-4: one canary, excluded from the rows; it proves the log, the transcript and the join.
    const canaryId = randomUUID();
    const canaryRow = rowOf(await runClaude(canaryId, prereg.prompts[0], 'treated'), canaryId, 'treated', 0);
    if (!canaryRow.row) {
      return notRun(['canary_failed'], { latency, canary: { ok: false, reason: canaryRow.reason }, claudeCalls });
    }

    const results = [];
    for (const run of runs) results.push(await runClaude(run.sessionId, run.prompt, run.arm));
    const rows = [];
    const byReason = zeroReasons();
    let excluded = 0;
    runs.forEach((run, i) => {
      const built = rowOf(results[i], run.sessionId, run.arm, run.promptIndex);
      if (built.row) {
        rows.push(built.row);
      } else {
        excluded++;
        byReason[built.reason]++;
      }
    });
    const analysis = analyzeArms(rows, prereg);
    return {
      verdict: analysis.verdict,
      analysis,
      latency,
      canary: { ok: true },
      excluded,
      excludedByReason: byReason,
      stop: stopReasons(analysis, latency, excluded),
      ...base,
      claudeCalls,
    };
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
