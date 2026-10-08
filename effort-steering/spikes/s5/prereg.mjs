// prereg.mjs — the S5 preregistration loader.
//
//   loadS5Prereg(file)                 -> Prereg    the measure-mode loader: validates, then requires the committed bytes
//   loadS5Config(file, { mode })       -> Prereg    the same shape without the committed-bytes requirement, for the
//                                                   modes 'smoke', 'pilot' and 'calibrate' (ruling R2): an arm may have
//                                                   `runs: 0` and one task is enough
//   checkTasksMatch(prereg, workRoot)  -> string[]  ids of the tasks whose built manifest is not the registered one
//
// The runner (Task 10) and the analysis (Task 9) trust every registered number to come through here. Reads the file,
// parses and validates it, and never calls a model, runs Docker or writes. Authority for "unchanged since
// registration" is s4-prereg's requireCommitted: the bytes read here must equal the HEAD blob byte for byte, and
// those same bytes are the ones parsed.
//
// The file is exactly the text JSON.stringify(parsed, null, 2) + '\n' writes (ruling R65), compared on the bytes in parse(), before
// validation, in both loaders: a repeated key (JSON.parse keeps the last, so the committed text would read two ways) and any value
// not written canonically (0.10 for 0.1, another indent, no final newline) are refused, with a one-line command that rewrites it.
//
// The file is exactly this object. A key that is not listed is refused, as is a missing, null or wrong-typed one;
// a refusal names the field path (`arms.C.effort`, `tasks[3].id`, `proxyAllowlist[1]`):
//
//   model            non-blank string
//   cli              { version: non-blank string, sha256: 'sha256:<64 lowercase hex>' }      (ruling R49)
//   arms             { A: { effort, steer: false, runs }, B: { effort, steer: true, runs }, C: { effort, steer: false, runs } }
//                      effort  one of low < medium < high < xhigh < max (s4-prereg's EFFORTS, ruling R60)
//                      B.effort equals A.effort (the steer is their only difference); C.effort is strictly below A.effort
//                      runs    safe integers: loadS5Prereg wants A >= 2, B >= 2, C >= 1; loadS5Config wants >= 0
//   tasks            [{ id, treeHash, hiddenHash, promptHash }]: loadS5Prereg wants >= 8, loadS5Config >= 1; ids unique
//                    and matching task-def's TASK_ID_RE (ruling R51: an id becomes a path segment), hashes 64 lowercase hex
//   margin           0 < margin < 1
//   alpha            0 < alpha <= 0.1
//   bound            { method: 'percentile' | 'paired-t', resamples, seed }: resamples a safe integer, >= 2000 for
//                    'percentile' and >= 0 for 'paired-t' (which does not resample); seed a safe integer
//   orderSeed        safe integer
//   mechanism        { alpha, permutations, seed, effectSizeThinkingTokens }: 0 < alpha < 1;
//                    permutations a safe integer >= ceil(1 / alpha) - 1 (the smallest p an exact test can report is
//                    1 / (permutations + 1), which must reach alpha); seed a safe integer; effectSizeThinkingTokens > 0
//   limits           { timeoutMinutes: safe integer 1..240, cpus: > 0, memoryGb: > 0, concurrency: safe integer >= 1,
//                      infraRetries: safe integer 0..5 }
//   images           { codescout, 'claude-plugins', proxy }: each 'sha256:<64 lowercase hex>'; the keys are task-def's
//                    IMAGE_FOR_REPO keys plus proxy (ruling R22: copied from images/digests.json, whose keys are the
//                    image names s5/codescout, s5/plugins and s5/proxy)
//   proxyAllowlist   non-empty array of host names the proxy accepts (proxy.mjs's hostPattern, ruling R50), no duplicates
//   stopAtCostUsd    finite number > 0
//
// The `registered` marker (ruling R59) cannot come from the file: both loaders refuse a `registered` key. loadS5Prereg
// returns `registered: true`, loadS5Config `registered: false`, and Task 10's measure refusal trusts that. The returned
// object is plain data, frozen at every depth.

import { closeSync, constants, openSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EFFORTS, requireCommitted } from '../s4-prereg.mjs';
import { hostPattern } from './proxy.mjs';
import { IMAGE_FOR_REPO, TASK_ID_RE } from './task-def.mjs';

const CONFIG_MODES = ['smoke', 'pilot', 'calibrate'];
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const HASH_FIELDS = ['treeHash', 'hiddenHash', 'promptHash'];
const TOP_KEYS = ['model', 'cli', 'arms', 'tasks', 'margin', 'alpha', 'bound', 'orderSeed', 'mechanism', 'limits', 'images', 'proxyAllowlist', 'stopAtCostUsd'];
const IMAGE_KEYS = [...Object.keys(IMAGE_FOR_REPO), 'proxy'];
const STEER = { A: false, B: true, C: false };

// What loadS5Prereg and loadS5Config differ in (ruling R2): the least `runs` per arm and the fewest tasks.
const MEASURED = { minTasks: 8, minRuns: { A: 2, B: 2, C: 1 } };
const CONFIGURED = { minTasks: 1, minRuns: { A: 0, B: 0, C: 0 } };

// ---- validation ----

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const show = (v) => (typeof v === 'number' ? String(v) : (JSON.stringify(v) ?? String(v)));
const at = (parent, key) => (parent === '' ? key : `${parent}.${key}`);

const fail = (field, why) => {
  throw new Error(`prereg: field ${field} ${why}`);
};
// `cond` must hold, else the refusal reads `field <field> must <why>, got <got>`.
const need = (cond, field, why, got) => {
  if (!cond) fail(field, `must ${why}, got ${show(got)}`);
};

// `value` must be an object holding exactly `keys`: an unknown key, a missing key and a null one are each refused by path.
function shape(field, value, keys) {
  if (!isObject(value)) fail(field, `must be an object, got ${show(value)}`);
  for (const k of Object.keys(value)) if (!keys.includes(k)) fail(at(field, k), 'is not a known field');
  for (const k of keys) if (!Object.hasOwn(value, k) || value[k] === null) fail(at(field, k), 'is required and must not be null');
}
const text = (field, value) => need(typeof value === 'string' && value.trim().length > 0, field, 'be a non-blank string', value);
const safeInt = (field, value, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) =>
  need(Number.isSafeInteger(value) && value >= min && value <= max, field, `be a safe integer${min > Number.MIN_SAFE_INTEGER ? ` >= ${min}` : ''}${max < Number.MAX_SAFE_INTEGER ? ` and <= ${max}` : ''}`, value);
const positive = (field, value) => need(isNum(value) && value > 0, field, 'be a finite number > 0', value);
const digest = (field, value) => need(typeof value === 'string' && DIGEST_RE.test(value), field, "be 'sha256:' and 64 lowercase hex characters", value);

function checkArms(arms, minRuns) {
  shape('arms', arms, ['A', 'B', 'C']);
  for (const name of ['A', 'B', 'C']) {
    const arm = arms[name];
    const field = `arms.${name}`;
    shape(field, arm, ['effort', 'steer', 'runs']);
    need(EFFORTS.includes(arm.effort), `${field}.effort`, `be one of ${EFFORTS.join(', ')}`, arm.effort);
    need(arm.steer === STEER[name], `${field}.steer`, `be ${STEER[name]}`, arm.steer);
    safeInt(`${field}.runs`, arm.runs, minRuns[name]);
  }
  need(arms.B.effort === arms.A.effort, 'arms.B.effort', `equal arms.A.effort ${show(arms.A.effort)} (the steer is the only difference between A and B)`, arms.B.effort);
  need(EFFORTS.indexOf(arms.C.effort) < EFFORTS.indexOf(arms.A.effort), 'arms.C.effort', `be strictly below arms.A.effort ${show(arms.A.effort)} in ${EFFORTS.join(' < ')}`, arms.C.effort);
}

function checkTasks(tasks, minTasks) {
  need(Array.isArray(tasks), 'tasks', 'be an array', tasks);
  need(tasks.length >= minTasks, 'tasks', `hold at least ${minTasks} task${minTasks === 1 ? '' : 's'}`, tasks.length);
  const firstSeen = new Map();
  tasks.forEach((task, i) => {
    const field = `tasks[${i}]`;
    shape(field, task, ['id', ...HASH_FIELDS]);
    need(typeof task.id === 'string' && TASK_ID_RE.test(task.id), `${field}.id`, `match ${TASK_ID_RE}`, task.id);
    if (firstSeen.has(task.id)) fail(`${field}.id`, `repeats tasks[${firstSeen.get(task.id)}].id ${show(task.id)}: task ids are unique`);
    firstSeen.set(task.id, i);
    for (const k of HASH_FIELDS) need(typeof task[k] === 'string' && HASH_RE.test(task[k]), `${field}.${k}`, 'be 64 lowercase hex characters', task[k]);
  });
}

function checkBound(bound) {
  shape('bound', bound, ['method', 'resamples', 'seed']);
  need(bound.method === 'percentile' || bound.method === 'paired-t', 'bound.method', "be 'percentile' or 'paired-t'", bound.method);
  // Only the percentile bootstrap resamples; paired-t carries the field but has no floor for it.
  safeInt('bound.resamples', bound.resamples, bound.method === 'percentile' ? 2000 : 0);
  safeInt('bound.seed', bound.seed);
}

function checkMechanism(m) {
  shape('mechanism', m, ['alpha', 'permutations', 'seed', 'effectSizeThinkingTokens']);
  need(isNum(m.alpha) && m.alpha > 0 && m.alpha < 1, 'mechanism.alpha', 'be a number strictly between 0 and 1', m.alpha);
  // 1 / (permutations + 1) <= alpha: a test of fewer permutations cannot report a p-value as small as alpha.
  const floor = Math.ceil(1 / m.alpha) - 1;
  need(Number.isSafeInteger(m.permutations) && m.permutations >= floor, 'mechanism.permutations', `be a safe integer >= ceil(1 / mechanism.alpha) - 1 = ${floor}`, m.permutations);
  safeInt('mechanism.seed', m.seed);
  positive('mechanism.effectSizeThinkingTokens', m.effectSizeThinkingTokens);
}

function checkLimits(l) {
  shape('limits', l, ['timeoutMinutes', 'cpus', 'memoryGb', 'concurrency', 'infraRetries']);
  // An integer, as S4's latency budget: a timeout reaches spawn and docker as whole milliseconds or seconds.
  safeInt('limits.timeoutMinutes', l.timeoutMinutes, 1, 240);
  positive('limits.cpus', l.cpus);
  positive('limits.memoryGb', l.memoryGb);
  safeInt('limits.concurrency', l.concurrency, 1);
  safeInt('limits.infraRetries', l.infraRetries, 0, 5);
}

// One predicate, the proxy's own: the loader accepts exactly the entries proxy.mjs's hostPattern accepts (ruling R50).
// Two entries that make one pattern (the proxy lower-cases) are one entry written twice.
function checkAllowlist(list) {
  need(Array.isArray(list) && list.length > 0, 'proxyAllowlist', 'be a non-empty array of host names', list);
  const firstSeen = new Map();
  list.forEach((entry, i) => {
    const field = `proxyAllowlist[${i}]`;
    let pattern;
    try {
      pattern = hostPattern(entry);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      fail(field, `must be a host name the proxy accepts (${err.message})`);
    }
    if (firstSeen.has(pattern)) fail(field, `repeats proxyAllowlist[${firstSeen.get(pattern)}] (${show(entry)}): host names are unique`);
    firstSeen.set(pattern, i);
  });
}

function validate(p, { minTasks, minRuns }) {
  if (!isObject(p)) throw new Error('prereg: the file must hold a JSON object');
  if (Object.hasOwn(p, 'registered')) fail('registered', 'must not be in the file: only loadS5Prereg sets it, after the committed-bytes check');
  shape('', p, TOP_KEYS);
  text('model', p.model);
  shape('cli', p.cli, ['version', 'sha256']);
  text('cli.version', p.cli.version);
  digest('cli.sha256', p.cli.sha256);
  checkArms(p.arms, minRuns);
  checkTasks(p.tasks, minTasks);
  need(isNum(p.margin) && p.margin > 0 && p.margin < 1, 'margin', 'be a number strictly between 0 and 1', p.margin);
  need(isNum(p.alpha) && p.alpha > 0 && p.alpha <= 0.1, 'alpha', 'be a number above 0 and at most 0.1', p.alpha);
  checkBound(p.bound);
  safeInt('orderSeed', p.orderSeed);
  checkMechanism(p.mechanism);
  checkLimits(p.limits);
  shape('images', p.images, IMAGE_KEYS);
  for (const k of IMAGE_KEYS) digest(at('images', k), p.images[k]);
  checkAllowlist(p.proxyAllowlist);
  positive('stopAtCostUsd', p.stopAtCostUsd);
}

// ---- reading ----

const shellQuote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
// The one-line command that rewrites `abs` in canonical form. A repeated key collapses to its last value, the value JSON.parse read,
// which the registration commit then shows.
const rewriteCommand = (abs) =>
  `node -e "const fs=require('fs'),f=process.argv[1];fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')),null,2)+'\\n')" ${shellQuote(abs)}`;

function readBytes(abs, { refuseSymlink }) {
  const cannotRead = (err) => new Error(`prereg: cannot read ${abs}: ${err.message}`);
  let fd;
  try {
    // One fd, opened with O_NOFOLLOW where a link is refused: the open itself fails (ELOOP) on a symlink, so the bytes read are
    // the bytes of the file that was judged, not of whatever a link swapped in after a separate lstat would point at. git holds
    // a symlink as its target's name, so a link could never be the committed bytes it appears to be.
    fd = openSync(abs, refuseSymlink ? constants.O_RDONLY | constants.O_NOFOLLOW : constants.O_RDONLY);
    return readFileSync(fd);
  } catch (err) {
    if (refuseSymlink && err.code === 'ELOOP') throw new Error(`prereg: ${abs} is not committed: it is a symlink`);
    throw cannotRead(err);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// The one text a registration may have is the text JSON.stringify writes (ruling R65). JSON.parse keeps the last of a repeated key
// ("margin" twice, or once escaped), so a committed file could read two ways: a reviewer of the commit sees one number, the runner
// and the analysis use the other. One comparison refuses every such file, and every value not written canonically (0.10 for 0.1,
// another indent, no final newline), in both loaders, without a hand-written JSON tokenizer. The check is on the bytes, not the text.
function parse(abs, bytes) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new Error(`prereg: ${abs} is not valid JSON: ${err.message}`);
  }
  if (!bytes.equals(Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, 'utf8'))) {
    throw new Error(
      `prereg: ${abs} holds a repeated key or a value that is not in canonical form (a registration is exactly JSON.stringify(parsed, null, 2) and a newline, so that the committed text reads one way). Rewrite it with: ${rewriteCommand(abs)}`,
    );
  }
  return parsed;
}

const deepFreeze = (v) => {
  if (v !== null && typeof v === 'object') {
    for (const inner of Object.values(v)) deepFreeze(inner);
    Object.freeze(v);
  }
  return v;
};

// ---- the loaders ----

export function loadS5Prereg(file) {
  const abs = resolve(file);
  const bytes = readBytes(abs, { refuseSymlink: true });
  const parsed = parse(abs, bytes);
  validate(parsed, MEASURED);
  requireCommitted(abs, bytes);
  return deepFreeze({ ...parsed, registered: true });
}

export function loadS5Config(file, options) {
  const mode = options?.mode;
  if (!CONFIG_MODES.includes(mode)) {
    throw new Error(`prereg: loadS5Config mode must be one of ${CONFIG_MODES.join(', ')}, got ${show(mode)} (a measured run loads its committed registration with loadS5Prereg)`);
  }
  const abs = resolve(file);
  const parsed = parse(abs, readBytes(abs, { refuseSymlink: false }));
  validate(parsed, CONFIGURED);
  return deepFreeze({ ...parsed, registered: false });
}

// ---- the built tasks ----

// Does <workRoot>/tasks/<id>/manifest.json carry the registered hashes? Fails closed: an id outside the id rule (it would be
// a path segment), a manifest that is missing, unreadable, not a JSON object or short of a hash, and a hash that is not the
// registered string, all answer no.
function manifestMatches(task, workRoot) {
  if (typeof task.id !== 'string' || !TASK_ID_RE.test(task.id)) return false;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(workRoot, 'tasks', task.id, 'manifest.json'), 'utf8'));
  } catch {
    return false;
  }
  return isObject(manifest) && HASH_FIELDS.every((k) => typeof task[k] === 'string' && manifest[k] === task[k]);
}

// The ids of the prereg's tasks whose built manifest is not the registered one, in the registered order.
export function checkTasksMatch(prereg, workRoot) {
  return prereg.tasks.filter((task) => !manifestMatches(task, workRoot)).map((task) => task.id);
}
