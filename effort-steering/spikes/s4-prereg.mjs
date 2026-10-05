import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

// S4 preregistration loader. The S4 runner calls this FIRST and spawns nothing
// if it throws: a gate number may not be changed after it was registered.
// Reads and runs read-only git queries only; never calls a model, never writes.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

function validate(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new Error('prereg: file must hold a JSON object');
  const need = (cond, field, why) => {
    if (!cond) throw new Error(`prereg: field ${field} ${why}`);
  };
  for (const k of ['direction', 'effectSizeThinkingTokens', 'latencyBudgetMs', 'holdoutRate', 'repeats', 'minPerArm', 'model', 'prompts', 'steerLevel']) {
    need(p[k] !== undefined && p[k] !== null, k, 'is required and must not be null');
  }
  need(isNum(p.effectSizeThinkingTokens) && p.effectSizeThinkingTokens > 0, 'effectSizeThinkingTokens', 'must be a finite number > 0');
  need(isNum(p.latencyBudgetMs) && p.latencyBudgetMs > 0, 'latencyBudgetMs', 'must be a finite number > 0');
  need(isNum(p.holdoutRate) && p.holdoutRate > 0 && p.holdoutRate < 1, 'holdoutRate', 'must be a number strictly between 0 and 1');
  need(isInt(p.repeats) && p.repeats >= 3, 'repeats', 'must be an integer >= 3');
  need(isInt(p.minPerArm) && p.minPerArm >= 3, 'minPerArm', 'must be an integer >= 3');
  need(typeof p.model === 'string' && p.model.length > 0, 'model', 'must be a non-empty string');
  need(
    Array.isArray(p.prompts) && p.prompts.length >= 4 && p.prompts.every((s) => typeof s === 'string' && s.length > 0),
    'prompts',
    'must be an array of at least 4 non-empty strings',
  );
  need(p.steerLevel === 'shallow' || p.steerLevel === 'deep', 'steerLevel', "must be 'shallow' or 'deep'");
  need(p.direction === 'down' || p.direction === 'up', 'direction', "must be 'down' or 'up'");
  need(p.direction === (p.steerLevel === 'shallow' ? 'down' : 'up'), 'direction', `'${p.direction}' does not match steerLevel '${p.steerLevel}' (shallow is down, deep is up)`);
}

// Git runs in the file's own directory, never the process cwd. The environment
// is cleaned so a hook's GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE cannot redirect it.
function runGit(file, args) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return spawnSync('git', ['-C', dirname(file), ...args, '--', basename(file)], { env, encoding: 'utf8' });
}

function requireCommitted(file) {
  const tracked = runGit(file, ['ls-files', '--error-unmatch']);
  if (tracked.error || tracked.status !== 0) {
    throw new Error(`prereg: ${file} is not committed (not tracked by git, or not in a git repository)`);
  }
  const diff = runGit(file, ['diff', '--quiet', 'HEAD']);
  if (diff.error) throw new Error(`prereg: ${file} is not committed (git failed: ${diff.error.message})`);
  if (diff.status === 1) throw new Error(`prereg: ${file} differs from HEAD (a registered value was changed after commit)`);
  if (diff.status !== 0) throw new Error(`prereg: ${file} is not committed (git diff exited ${diff.status}: ${String(diff.stderr).trim()})`);
}

export function loadPrereg(file) {
  const abs = resolve(file);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`prereg: cannot read ${abs} as JSON: ${err.message}`);
  }
  validate(parsed);
  requireCommitted(abs);
  return parsed;
}
