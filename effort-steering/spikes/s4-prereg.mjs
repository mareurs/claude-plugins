import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

// S4 preregistration loader. The S4 runner calls this FIRST and spawns nothing
// if it throws: a gate number may not be changed after it was registered.
// Reads and runs read-only git queries only; never calls a model, never writes.
//
// Authority for "unchanged since registration" (ruling R15): the bytes read here
// must equal the HEAD blob byte for byte. git's own change detection (index
// flags, mtimes, filters, textconv) is never trusted. Those bytes are then the
// ones parsed.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isSafeInteger(v);
const blank = (s) => typeof s !== 'string' || s.trim().length === 0;

function validate(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new Error('prereg: file must hold a JSON object');
  const need = (cond, field, why) => {
    if (!cond) throw new Error(`prereg: field ${field} ${why}`);
  };
  for (const k of ['direction', 'effectSizeThinkingTokens', 'latencyBudgetMs', 'holdoutRate', 'repeats', 'minPerArm', 'model', 'prompts', 'steerLevel', 'alpha', 'permutations', 'seed']) {
    need(p[k] !== undefined && p[k] !== null, k, 'is required and must not be null');
  }
  need(isNum(p.effectSizeThinkingTokens) && p.effectSizeThinkingTokens > 0, 'effectSizeThinkingTokens', 'must be a finite number > 0');
  // An integer: run-policy's timeout must be one, or spawnSync throws and every hook call fails open.
  need(isInt(p.latencyBudgetMs) && p.latencyBudgetMs > 0, 'latencyBudgetMs', 'must be a safe integer > 0');
  // R24: the fraction of each prompt's repeats the RUNNER withholds (holdout arm).
  need(isNum(p.holdoutRate) && p.holdoutRate > 0 && p.holdoutRate < 1, 'holdoutRate', 'must be a number strictly between 0 and 1');
  need(isInt(p.repeats) && p.repeats >= 3, 'repeats', 'must be an integer >= 3');
  need(isInt(p.minPerArm) && p.minPerArm >= 3, 'minPerArm', 'must be an integer >= 3');
  need(!blank(p.model), 'model', 'must be a non-blank string');
  need(
    Array.isArray(p.prompts) && p.prompts.every((s) => !blank(s)) && new Set(p.prompts.map((s) => s.trim())).size >= 4 && new Set(p.prompts.map((s) => s.trim())).size === p.prompts.length,
    'prompts',
    'must be an array of at least 4 distinct, non-blank strings',
  );
  // Each prompt is the last argv element of `claude -p`: a bare word can equal a claude
  // subcommand (`update`, `install`, `purge`, `ultrareview`; `--` does not stop subcommand
  // dispatch), a leading `-` parses as a flag, a leading `/` is a slash command.
  p.prompts.forEach((s, i) => {
    const lead = s.trimStart();
    need(lead.trim().split(/\s+/).length >= 2, `prompts[${i}]`, 'must be at least two whitespace-separated words');
    need(!lead.startsWith('-') && !lead.startsWith('/'), `prompts[${i}]`, "must not start with '-' or '/'");
  });
  need(p.steerLevel === 'shallow' || p.steerLevel === 'deep', 'steerLevel', "must be 'shallow' or 'deep'");
  need(p.direction === 'down' || p.direction === 'up', 'direction', "must be 'down' or 'up'");
  need(p.direction === (p.steerLevel === 'shallow' ? 'down' : 'up'), 'direction', `'${p.direction}' does not match steerLevel '${p.steerLevel}' (shallow is down, deep is up)`);
  // R24: the one-sided permutation test and the seeded arm plan.
  need(isNum(p.alpha) && p.alpha > 0 && p.alpha < 1, 'alpha', 'must be a finite number strictly between 0 and 1');
  need(isInt(p.permutations) && p.permutations >= 1, 'permutations', 'must be a safe integer >= 1');
  need(isInt(p.seed), 'seed', 'must be a safe integer');
}

// Git runs in the file's own directory, never the process cwd. EVERY GIT_*
// variable is dropped (GIT_DIR, GIT_CONFIG_COUNT/KEY/VALUE injection, ...) and
// global/system config is switched off, so nothing outside the repo steers it.
export function runGit(file, args) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  env.HOME = '/nonexistent';
  env.XDG_CONFIG_HOME = '/nonexistent';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  // Set AFTER the scrub: never prompt for credentials, never lazy-fetch a missing
  // object (a partial clone would otherwise hang, then write into .git/objects).
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_LAZY_FETCH = '1';
  // --no-replace-objects: `git replace` must not be able to forge the HEAD blob.
  // core.fsmonitor=false: a repo-local fsmonitor hook must not run commands.
  const argv = ['--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-C', dirname(file), ...args];
  return spawnSync('git', argv, { env, maxBuffer: 64 * 1024 * 1024 });
}

function requireCommitted(file, bytes) {
  const name = basename(file);
  const tracked = runGit(file, ['ls-files', '--error-unmatch', '--', name]);
  if (tracked.error || tracked.status !== 0) {
    throw new Error(`prereg: ${file} is not committed (not tracked by git, or not in a git repository)`);
  }
  const blob = runGit(file, ['cat-file', 'blob', `HEAD:./${name}`]);
  if (blob.error || blob.status !== 0) {
    throw new Error(`prereg: ${file} is not committed (no HEAD version: ${blob.error ? blob.error.message : String(blob.stderr).trim()})`);
  }
  if (!bytes.equals(blob.stdout)) {
    throw new Error(`prereg: ${file} differs from HEAD (a registered value was changed after commit)`);
  }
}

export function loadPrereg(file) {
  const abs = resolve(file);
  let bytes;
  try {
    if (lstatSync(abs).isSymbolicLink()) throw new Error(`prereg: ${abs} is not committed: it is a symlink`);
    bytes = readFileSync(abs);
  } catch (err) {
    if (/not committed/.test(err.message)) throw err;
    throw new Error(`prereg: cannot read ${abs}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new Error(`prereg: ${abs} is not valid JSON: ${err.message}`);
  }
  validate(parsed);
  requireCommitted(abs, bytes);
  return parsed;
}
