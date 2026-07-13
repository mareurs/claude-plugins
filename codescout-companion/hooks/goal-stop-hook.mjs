// Stop hook for codescout goal-trackers. Port of goal-stop-hook.sh.
// Queries the active goal-tracker via `codescout artifact find/get` and emits
// {continue: bool, reason|reason_to_continue}. Fail-open on every error path so
// the hook never deadlocks the agent loop. Disable via
// .claude/codescout-companion.json {"goal_stop_hook": false}.
import { existsSync, readFileSync, accessSync, mkdirSync, appendFileSync, constants } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readInput, emit } from './lib.mjs';

const input = readInput() || {};
const cwd = input.cwd || '.';

function log(msg) {
  try {
    const dir = join(cwd, '.claude');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'codescout-companion.log'), `goal-stop-hook: ${msg}\n`);
  } catch {
    /* best-effort */
  }
}

// 1. Disable flag.
const configFile = join(cwd, '.claude', 'codescout-companion.json');
if (existsSync(configFile)) {
  try {
    const v = JSON.parse(readFileSync(configFile, 'utf8')).goal_stop_hook;
    if (v === false || v === 'false') {
      emit({ continue: true, reason: 'goal_stop_hook disabled in .claude/codescout-companion.json' });
      process.exit(0);
    }
  } catch {
    /* fall through */
  }
}

// 2. Locate codescout binary (PATH, then fallbacks).
function resolveCodescout() {
  const exe = process.platform === 'win32' ? 'codescout.exe' : 'codescout';
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    try {
      const p = join(dir, exe);
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* not here */
    }
  }
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  for (const cand of [join(home, '.cargo', 'bin', 'codescout'), join(cwd, 'target', 'release', 'codescout')]) {
    try {
      accessSync(cand, constants.X_OK);
      return cand;
    } catch {
      /* not here */
    }
  }
  return null;
}

const cs = resolveCodescout();
if (!cs) {
  log('codescout binary not found on PATH or in fallback locations');
  emit({ continue: true, reason: 'codescout binary not found — fail-open' });
  process.exit(0);
}

function run(args) {
  try {
    return execFileSync(cs, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}
function parseJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 3. Find active goal(s).
const findRaw = run(['artifact', 'find', '--kind', 'tracker', '--tag', 'goal', '--status', 'active', '--project', cwd, '--limit', '5', '--json']);
if (!findRaw) {
  log('codescout artifact find failed or returned empty');
  emit({ continue: true, reason: 'codescout query failed — fail-open' });
  process.exit(0);
}
const findOut = parseJson(findRaw);
let count = 0;
if (findOut) {
  if (typeof findOut.count === 'number') count = findOut.count;
  else if (Array.isArray(findOut.items)) count = findOut.items.length;
}
if (count === 0) {
  emit({ continue: true, reason: 'no active goal' });
  process.exit(0);
}
if (count > 1) {
  emit({ continue: true, reason: `multiple active goals (${count}) — ambiguous, deferring` });
  process.exit(0);
}

// 4. Drill into the one goal's augmentation params.
const goalId = (findOut.items && findOut.items[0] && findOut.items[0].id) || '';
if (!goalId) {
  log('goal id missing from find envelope');
  emit({ continue: true, reason: 'goal id missing — fail-open' });
  process.exit(0);
}
const getOut = parseJson(run(['artifact', 'get', goalId, '--full', '--project', cwd, '--json']));
if (!getOut) {
  log(`codescout artifact get ${goalId} failed`);
  emit({ continue: true, reason: 'codescout get failed — fail-open' });
  process.exit(0);
}
const params = getOut.augmentation && getOut.augmentation.params;
if (!params || typeof params !== 'object') {
  log(`goal ${goalId} has no augmentation.params — treating as active`);
  emit({ continue: true, reason: 'goal has no params — fail-open' });
  process.exit(0);
}

const status = params.status || 'unknown';
const criterion = String(params.criterion || '').slice(0, 120);
const blockedReason = String(params.blocked_reason || '').slice(0, 120);
const lastRefreshed = (getOut.augmentation && getOut.augmentation.last_refreshed_at) || 'never';

switch (status) {
  case 'done': {
    const gateOut = parseJson(run(['artifact-event', 'list', '--artifact-id', goalId, '--kinds', 'note', '--limit', '20', '--project', cwd, '--json']));
    let gateText = '';
    if (Array.isArray(gateOut)) {
      const ev = gateOut.find((e) => e && e.payload && e.payload.tag === 'gate_check' && e.payload.gate_passed === true);
      if (ev) gateText = String(ev.payload.text || '').slice(0, 200);
    }
    emit({
      continue: false,
      reason: gateText
        ? `goal done: ${criterion} — ${gateText} (last refreshed: ${lastRefreshed})`
        : `goal done: ${criterion} (last refreshed: ${lastRefreshed})`,
    });
    break;
  }
  case 'blocked':
    emit({ continue: false, reason: `goal blocked: ${blockedReason || criterion} (last refreshed: ${lastRefreshed})` });
    break;
  case 'abandoned':
    emit({ continue: false, reason: `goal abandoned: ${criterion} (last refreshed: ${lastRefreshed})` });
    break;
  case 'unknown':
  case '':
    emit({ continue: true, reason: `goal params malformed (status=${status}) — fail-open; please refresh (last refreshed: ${lastRefreshed})` });
    break;
  default: {
    const signals = Array.isArray(params.acceptance_signals) ? params.acceptance_signals : [];
    const unmet = signals.find((s) => s && s.met === false);
    const next = unmet ? String(unmet.description || '').slice(0, 120) : '';
    const target = next || criterion || 'active goal in progress';
    emit({ continue: true, reason_to_continue: `next acceptance signal: ${target} (last refreshed: ${lastRefreshed})` });
    break;
  }
}
process.exit(0);
