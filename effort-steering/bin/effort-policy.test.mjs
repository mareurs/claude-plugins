// Tests for the effort-policy CLI. Every case runs the real script in a child
// process, because the contract is the process boundary: one JSON line on stdout,
// exit 0 from `decide`, diagnostics on stderr only.
//
// The CLI under test is the sibling file, resolved through import.meta.url. That
// is deliberate: a copy of the whole effort-steering/ tree (for a mutation probe)
// then tests its own CLI copy, never the real one.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { t } from '../core/testkit.mjs';

const CLI = fileURLToPath(new URL('./effort-policy.mjs', import.meta.url));
const SHALLOW = 'Answer directly without deliberating.';
const DEEP = 'Please think hard before responding.';

// One sandbox per run: root/state is XDG_STATE_HOME, root/work holds rules files
// and is the neutral cwd. A write outside root/state shows up as an extra file.
const ROOT = mkdtempSync(path.join(os.tmpdir(), 'effort-policy-test-'));
const STATE = path.join(ROOT, 'state');
const WORK = path.join(ROOT, 'work');
mkdirSync(STATE);
mkdirSync(WORK);
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

function run(args, input, opts = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    input,
    cwd: opts.cwd ?? WORK,
    env: { ...process.env, XDG_STATE_HOME: opts.state ?? STATE },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

// stdout must be exactly one line of JSON ending in a newline.
function decide(args, ctx, opts) {
  const input = typeof ctx === 'string' ? ctx : JSON.stringify(ctx);
  const res = run(['decide', ...args], input, opts);
  assert.equal(res.status, 0, `exit status; stderr: ${res.stderr}`);
  assert.match(res.stdout, /^[^\n]*\n$/, 'stdout is exactly one newline-terminated line');
  return { ...res, out: JSON.parse(res.stdout) };
}

let n = 0;
function writeJson(name, value) {
  const file = path.join(WORK, `${++n}-${name}`);
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

const rule = (over = {}) => ({ id: 'r-shallow', level: 'shallow', confidence: 'high', reason: 'test', when: { minChars: 0 }, ...over });
const rulesFile = (rules, version = 7) => writeJson('rules.json', { version, rules });
const freshState = () => mkdtempSync(path.join(ROOT, 'st-'));
const logLines = (state, session) => {
  const file = path.join(state, 'effort-steering', `${session}.jsonl`);
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const allFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const CTX = { prompt: 'rename foo to bar', session_id: 's1', turn_id: 'u1', harness: 'claude-code' };

t('shipped empty rules: default with no_rule, no steer, treated', () => {
  const { out } = decide([], CTX);
  assert.deepEqual(out, { level: 'default', confidence: 'low', reasons: ['no_rule'], steer: null, arm: 'treated' });
});

t('output has exactly the five keys, in order', () => {
  const { out } = decide([], CTX);
  assert.deepEqual(Object.keys(out), ['level', 'confidence', 'reasons', 'steer', 'arm']);
});

t('a high shallow rule gives shallow with the exact phrase', () => {
  const { out } = decide(['--rules', rulesFile([rule()])], CTX);
  assert.equal(out.level, 'shallow');
  assert.equal(out.confidence, 'high');
  assert.equal(out.steer, SHALLOW);
  assert.equal(out.arm, 'treated');
  assert.deepEqual(out.reasons, ['r-shallow']);
});

t('a medium deep rule gives deep with the exact phrase', () => {
  const { out } = decide(['--rules', rulesFile([rule({ id: 'r-deep', level: 'deep', confidence: 'medium' })])], CTX);
  assert.equal(out.level, 'deep');
  assert.equal(out.steer, DEEP);
});

t('explicit ultrathink beats a shallow rule: deep, user_override, no second sentence', () => {
  const { out } = decide(['--rules', rulesFile([rule()])], { ...CTX, prompt: 'ultrathink about the cache design' });
  assert.equal(out.level, 'deep');
  assert.deepEqual(out.reasons, ['user_override']);
  assert.equal(out.steer, null);
});

t('a failing previous turn blocks shallow (signals reach decide)', () => {
  const { out } = decide(['--rules', rulesFile([rule()])], { ...CTX, signals: { prevTurnFailed: true } });
  assert.equal(out.level, 'default');
  assert.equal(out.steer, null);
});

t('an invalid-regex rule is skipped and the valid rule still applies', () => {
  const bad = rule({ id: 'bad', when: { matchesAny: ['('] } });
  const { out, stderr } = decide(['--rules', rulesFile([bad, rule()])], CTX);
  assert.equal(out.level, 'shallow');
  assert.equal(out.steer, SHALLOW);
  assert.ok(!stderr.includes('rename foo'), 'stderr never carries prompt text');
});

// ---- bad input -------------------------------------------------------------

const BAD_INPUT = { level: 'default', confidence: 'low', reasons: ['bad_input'], steer: null, arm: 'treated' };

for (const [name, input] of [
  ['invalid JSON', '{not json'],
  ['empty stdin', ''],
  ['whitespace only', '  \n'],
  ['a JSON array', '[1,2]'],
  ['a JSON string', '"hello"'],
  ['a JSON number', '42'],
  ['JSON null', 'null'],
]) {
  t(`stdin ${name}: bad_input, exit 0, one line`, () => {
    const { out } = decide([], input);
    assert.deepEqual(out, BAD_INPUT);
  });
}

t('bad input with --log writes nothing', () => {
  const state = freshState();
  decide(['--log'], '{oops', { state });
  assert.deepEqual(allFiles(state), []);
});

t('a 1 MB prompt still works', () => {
  const { out } = decide([], { ...CTX, prompt: 'a'.repeat(1_000_000) });
  assert.deepEqual(out.reasons, ['no_rule']);
});

t('a non-string prompt does not crash and logs the hash of the empty prompt', () => {
  const state = freshState();
  const { out } = decide(['--log'], { ...CTX, prompt: 42 }, { state });
  assert.equal(out.level, 'default');
  const [rec] = logLines(state, 's1');
  assert.equal(rec.prompt_sha256, createHash('sha256').update('', 'utf8').digest('hex'));
});

// ---- holdout ---------------------------------------------------------------

t('--holdout-rate 1 gives holdout and null steer even though a rule says shallow', () => {
  const { out } = decide(['--rules', rulesFile([rule()]), '--holdout-rate', '1'], CTX);
  assert.equal(out.arm, 'holdout');
  assert.equal(out.level, 'shallow');
  assert.equal(out.steer, null);
});

t('holdout logs steered:false, treated logs steered:true', () => {
  const rules = rulesFile([rule()]);
  const a = freshState();
  decide(['--rules', rules, '--holdout-rate', '1', '--log'], CTX, { state: a });
  assert.equal(logLines(a, 's1')[0].arm, 'holdout');
  assert.equal(logLines(a, 's1')[0].steered, false);
  const b = freshState();
  decide(['--rules', rules, '--log'], CTX, { state: b });
  assert.equal(logLines(b, 's1')[0].arm, 'treated');
  assert.equal(logLines(b, 's1')[0].steered, true);
});

t('a treated turn with nothing to say logs steered:false', () => {
  const state = freshState();
  decide(['--log'], CTX, { state });
  assert.equal(logLines(state, 's1')[0].steered, false);
});

t('--holdout-rate 0 is never a holdout and is a valid rate (no reason); rate 1 without ids stays treated with no log reason', () => {
  const zero = decide(['--holdout-rate', '0'], CTX).out;
  assert.equal(zero.arm, 'treated');
  assert.deepEqual(zero.reasons, ['no_rule'], '0 is inside [0, 1]');
  const one = decide(['--holdout-rate', '1'], { prompt: 'x' }).out;
  assert.equal(one.arm, 'treated');
  assert.deepEqual(one.reasons, ['no_rule'], 'no --log, so no log_skipped_no_ids');
});

t('a valid fractional rate adds no reason', () => {
  const { out } = decide(['--holdout-rate', '0.25'], CTX);
  assert.deepEqual(out.reasons, ['no_rule']);
});

for (const bad of ['abc', '-1', '2', '1.0001', '', 'NaN', 'Infinity', '0x1', '1,5']) {
  t(`R3: invalid --holdout-rate ${JSON.stringify(bad)} is rate 1 (held out, not steered) with bad_holdout_rate`, () => {
    const { out } = decide(['--rules', rulesFile([rule()]), '--holdout-rate', bad], CTX);
    assert.equal(out.arm, 'holdout');
    assert.equal(out.steer, null);
    assert.equal(out.level, 'shallow', 'the decision itself is unchanged; only the steering text is withheld');
    assert.deepEqual(out.reasons, ['r-shallow', 'bad_holdout_rate']);
  });
}

// ---- logging ---------------------------------------------------------------

t('--log with ids writes one file with one line, with the right keys, and no prompt text', () => {
  const state = freshState();
  const prompt = 'SECRETPROMPT-9f3a rename foo to bar';
  const { out } = decide(['--rules', rulesFile([rule()]), '--log'], { ...CTX, prompt }, { state });
  const files = allFiles(state);
  assert.equal(files.length, 1);
  assert.equal(files[0], path.join(state, 'effort-steering', 's1.jsonl'));
  const raw = readFileSync(files[0], 'utf8');
  assert.equal(raw.split('\n').filter(Boolean).length, 1);
  assert.ok(!raw.includes('SECRETPROMPT'), 'the log never holds prompt text');
  const [rec] = logLines(state, 's1');
  assert.deepEqual(Object.keys(rec).sort(), [
    'arm', 'confidence', 'features', 'harness', 'level', 'policy_version', 'prompt_sha256', 'reasons',
    'rules_version', 'session_id', 'steer_version', 'steered', 'ts', 'turn_id',
  ]);
  assert.equal(rec.prompt_sha256, createHash('sha256').update(prompt, 'utf8').digest('hex'));
  assert.equal(rec.session_id, 's1');
  assert.equal(rec.turn_id, 'u1');
  assert.equal(rec.harness, 'claude-code');
  assert.equal(rec.rules_version, 7);
  assert.equal(rec.steer_version, 1);
  assert.equal(rec.level, 'shallow');
  assert.deepEqual(rec.reasons, out.reasons);
});

t('a slash-prefixed secret prompt never reaches the log or stdout (R: log holds no prompt text)', () => {
  const state = freshState();
  const prompt = '/deploy-secret-project now';
  const { out, stdout, stderr } = decide(['--rules', rulesFile([rule()]), '--log'], { ...CTX, prompt }, { state });
  assert.equal(out.level, 'shallow', 'the rule ran, so the whole path was exercised');
  const raw = readFileSync(path.join(state, 'effort-steering', 's1.jsonl'), 'utf8');
  for (const [where, text] of [['log', raw], ['stdout', stdout], ['stderr', stderr]]) {
    assert.ok(!text.includes('deploy-secret-project'), `${where} holds prompt text`);
  }
  // Every logged feature is a finite number or a boolean.
  const [rec] = logLines(state, 's1');
  for (const [k, v] of Object.entries(rec.features)) {
    assert.ok(typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)), `feature ${k} is ${typeof v}`);
  }
});

t('a second --log call appends a second line to the same session file', () => {
  const state = freshState();
  decide(['--log'], CTX, { state });
  decide(['--log'], { ...CTX, turn_id: 'u2' }, { state });
  assert.equal(logLines(state, 's1').length, 2);
});

t('--log without ids creates no file and adds log_skipped_no_ids', () => {
  const state = freshState();
  const { out } = decide(['--log'], { prompt: 'x' }, { state });
  assert.deepEqual(out.reasons, ['no_rule', 'log_skipped_no_ids']);
  assert.deepEqual(allFiles(state), []);
  const half = decide(['--log'], { prompt: 'x', session_id: 's1' }, { state });
  assert.deepEqual(half.out.reasons, ['no_rule', 'log_skipped_no_ids']);
  const num = decide(['--log'], { prompt: 'x', session_id: 5, turn_id: 6 }, { state });
  assert.deepEqual(num.out.reasons, ['no_rule', 'log_skipped_no_ids']);
  assert.deepEqual(allFiles(state), []);
});

t('without --log nothing is written', () => {
  const state = freshState();
  decide([], CTX, { state });
  assert.deepEqual(allFiles(state), []);
});

t("--log with session_id '../x' exits 0, writes nothing, adds log_failed, stderr has no prompt", () => {
  const root = freshState();
  const state = path.join(root, 'state');
  mkdirSync(state);
  const { out, stderr } = decide(['--log'], { ...CTX, session_id: '../x', prompt: 'SECRETPROMPT-77 hi' }, { state });
  assert.deepEqual(out.reasons, ['no_rule', 'log_failed']);
  assert.equal(out.level, 'default');
  assert.deepEqual(allFiles(root), [], 'no file anywhere under the sandbox');
  assert.ok(stderr.length > 0, 'the error goes to stderr');
  assert.ok(!stderr.includes('SECRETPROMPT'));
});

t('--log into an unwritable state dir exits 0 with log_failed', () => {
  const blocker = path.join(ROOT, 'a-file');
  writeFileSync(blocker, 'x');
  const { out } = decide(['--log'], CTX, { state: blocker });
  assert.ok(out.reasons.includes('log_failed'));
});

// ---- fail-open on the config files ------------------------------------------

t('an unreadable --rules path gives rules_unreadable and default, logged with rules_version 0', () => {
  const state = freshState();
  const { out } = decide(['--rules', path.join(WORK, 'does-not-exist.json'), '--log'], CTX, { state });
  assert.equal(out.level, 'default');
  assert.deepEqual(out.reasons, ['no_rule', 'rules_unreadable']);
  assert.equal(logLines(state, 's1')[0].rules_version, 0);
  assert.deepEqual(logLines(state, 's1')[0].reasons, out.reasons, 'the log holds the final reasons array');
});

t('a rules file that is not JSON gives rules_unreadable', () => {
  const { out } = decide(['--rules', writeJson('garbage.json', '{{{')], CTX);
  assert.deepEqual(out.reasons, ['no_rule', 'rules_unreadable']);
});

t('--rules with no value counts as an unreadable rules file', () => {
  const { out } = decide(['--rules'], CTX);
  assert.deepEqual(out.reasons, ['no_rule', 'rules_unreadable']);
});

t('--rules followed by another flag does not swallow the flag', () => {
  const state = freshState();
  const { out } = decide(['--rules', '--log'], CTX, { state });
  assert.deepEqual(out.reasons, ['no_rule', 'rules_unreadable']);
  assert.equal(allFiles(state).length, 1, '--log still took effect');
});

t('R15c: an unreadable table gives table_unreadable, null steer, steer_version 0', () => {
  const state = freshState();
  const { out } = decide(['--rules', rulesFile([rule()]), '--table', path.join(WORK, 'nope.json'), '--log'], CTX, { state });
  assert.equal(out.level, 'shallow');
  assert.equal(out.steer, null);
  assert.deepEqual(out.reasons, ['r-shallow', 'table_unreadable']);
  const [rec] = logLines(state, 's1');
  assert.equal(rec.steer_version, 0);
  assert.equal(rec.steered, false);
});

t('R15c: an unreadable table: the logged reasons are the final reasons array', () => {
  const state = freshState();
  const { out } = decide(['--rules', rulesFile([rule()]), '--table', path.join(WORK, 'nope.json'), '--log'], CTX, { state });
  assert.deepEqual(logLines(state, 's1')[0].reasons, out.reasons);
});

t('R15c: a table that is not JSON, or not an object, gives table_unreadable', () => {
  for (const content of ['{{{', '[]', 'null']) {
    const { out } = decide(['--rules', rulesFile([rule()]), '--table', writeJson('table.json', content)], CTX);
    assert.equal(out.steer, null, content);
    assert.ok(out.reasons.includes('table_unreadable'), content);
  }
});

t('--table with no value counts as an unreadable table', () => {
  const { out } = decide(['--rules', rulesFile([rule()]), '--table'], CTX);
  assert.equal(out.steer, null);
  assert.ok(out.reasons.includes('table_unreadable'));
});

t('a custom --table changes the phrase', () => {
  const table = writeJson('table.json', { version: 3, phrases: { shallow: 'Be brief.', deep: 'Think.' } });
  const state = freshState();
  const { out } = decide(['--rules', rulesFile([rule()]), '--table', table, '--log'], CTX, { state });
  assert.equal(out.steer, 'Be brief.');
  assert.equal(logLines(state, 's1')[0].steer_version, 3);
});

// R17: a file that cannot be USED is unreadable, whatever the cause. Its own
// version must never reach the log, or the experiment would attribute "no
// steering" to rules version N while every rule was dropped.
for (const content of ['{"version":2,"rules":"x"}', '{"version":3}', '{"version":4,"rules":{}}', '[]', 'null', '42', '"text"']) {
  t(`R17: rules file ${content} is rules_unreadable, logged with rules_version 0`, () => {
    const state = freshState();
    const { out } = decide(['--rules', writeJson('shape.json', content), '--log'], CTX, { state });
    assert.equal(out.level, 'default');
    assert.equal(out.steer, null);
    assert.deepEqual(out.reasons, ['no_rule', 'rules_unreadable']);
    const [rec] = logLines(state, 's1');
    assert.equal(rec.rules_version, 0);
    assert.deepEqual(rec.reasons, out.reasons);
  });
}

t('R17: a rules file with some bad rules is NOT unreadable: good rule applies, file version logged', () => {
  const state = freshState();
  // The bad rule is named "(file)" on purpose: the check is on the error code, not on that id.
  const bad = rule({ id: '(file)', when: { matchesAny: ['('] } });
  const { out } = decide(['--rules', rulesFile([bad, rule()], 7), '--log'], CTX, { state });
  assert.equal(out.level, 'shallow');
  assert.equal(out.steer, SHALLOW);
  assert.deepEqual(out.reasons, ['r-shallow', 'rules_skipped:(file):invalid_regex'], 'the skipped rule is visible (ES-8), and its id "(file)" is kept verbatim');
  const [rec] = logLines(state, 's1');
  assert.equal(rec.rules_version, 7);
  assert.deepEqual(rec.reasons, out.reasons);
});

t('R17: a valid rules file with an empty rules array is usable and keeps its version', () => {
  const state = freshState();
  const { out } = decide(['--rules', rulesFile([], 9), '--log'], CTX, { state });
  assert.deepEqual(out.reasons, ['no_rule']);
  assert.equal(logLines(state, 's1')[0].rules_version, 9);
});

for (const content of ['{"version":2,"phrases":"x"}', '{"version":2}', '{"version":2,"phrases":[]}', '{"version":2,"phrases":null}', '[]', 'null', '42']) {
  t(`R17: table ${content} is table_unreadable: null steer, steer_version 0, reasons logged`, () => {
    const state = freshState();
    const { out } = decide(['--rules', rulesFile([rule()]), '--table', writeJson('table.json', content), '--log'], CTX, { state });
    assert.equal(out.level, 'shallow');
    assert.equal(out.steer, null);
    assert.deepEqual(out.reasons, ['r-shallow', 'table_unreadable']);
    const [rec] = logLines(state, 's1');
    assert.equal(rec.steer_version, 0);
    assert.equal(rec.steered, false);
    assert.deepEqual(rec.reasons, out.reasons);
  });
}

t('R17: a table with an empty phrases object is usable (it just has no phrase) and keeps its version', () => {
  const state = freshState();
  const { out } = decide(['--rules', rulesFile([rule()]), '--table', writeJson('table.json', { version: 5, phrases: {} }), '--log'], CTX, { state });
  assert.deepEqual(out.reasons, ['r-shallow']);
  assert.equal(out.steer, null);
  assert.equal(logLines(state, 's1')[0].steer_version, 5);
});

// ---- flags and subcommands --------------------------------------------------

// R19: an unknown flag no longer vanishes silently. It adds unknown_arg once. A
// trailing --holdout-rate with no value at all is still just ignored.
// R19: an unknown flag no longer vanishes silently. It adds unknown_arg once.
// R22: a trailing --holdout-rate with no value is bad_holdout_rate, not ignored.
t('unknown flags add unknown_arg; a trailing --holdout-rate with no value is bad_holdout_rate', () => {
  const { out } = decide(['--bogus', '--holdout-rate'], CTX);
  assert.deepEqual(out.reasons, ['no_rule', 'unknown_arg', 'bad_holdout_rate']);
  assert.equal(out.arm, 'holdout');
});

// ---- R22: a value flag with no usable value is visible ----------------------

t('R22: --holdout-rate as the last token is bad_holdout_rate, held out, exit 0', () => {
  const { out } = decide(['--rules', rulesFile([rule()]), '--holdout-rate'], CTX);
  assert.equal(out.arm, 'holdout');
  assert.equal(out.steer, null);
  assert.deepEqual(out.reasons, ['r-shallow', 'bad_holdout_rate']);
});

t('R22: --holdout-rate followed by --log still turns logging on and adds bad_holdout_rate', () => {
  const state = freshState();
  const { out } = decide(['--holdout-rate', '--log'], CTX, { state });
  assert.equal(out.arm, 'holdout');
  assert.deepEqual(out.reasons, ['no_rule', 'bad_holdout_rate']);
  const lines = logLines(state, 's1');
  assert.equal(lines.length, 1, 'a log line was written');
  assert.equal(lines[0].arm, 'holdout', 'the log holds the arm that was used');
  assert.deepEqual(lines[0].reasons, out.reasons);
});

t('R22: --rules as the last token is rules_unreadable, not the shipped rules', () => {
  const { out } = decide(['--rules'], CTX);
  assert.equal(out.arm, 'treated');
  assert.deepEqual(out.reasons, ['no_rule', 'rules_unreadable']);
});

t('R22: --table followed by --log is table_unreadable, and the log is still written', () => {
  const state = freshState();
  const { out } = decide(['--rules', rulesFile([rule()]), '--table', '--log'], CTX, { state });
  assert.equal(out.arm, 'treated');
  assert.equal(out.steer, null);
  assert.deepEqual(out.reasons, ['r-shallow', 'table_unreadable']);
  const lines = logLines(state, 's1');
  assert.equal(lines.length, 1, 'a log line was written');
  assert.deepEqual(lines[0].reasons, out.reasons);
  assert.equal(lines[0].steer_version, 0);
});

t('R22: the = form is explicit: --rules=--x takes --x as the file name', () => {
  const { out } = decide(['--rules=--x', '--log'], CTX, { state: freshState() });
  assert.deepEqual(out.reasons, ['no_rule', 'rules_unreadable'], 'no unknown_arg: --x was consumed as the value');
  const holdout = decide(['--holdout-rate=--x'], CTX).out;
  assert.deepEqual(holdout.reasons, ['no_rule', 'bad_holdout_rate']);
});

// ---- R19: --flag=value ------------------------------------------------------

t('R19: --holdout-rate=1 is a holdout, exactly like the spaced form', () => {
  const rules = rulesFile([rule()]);
  const eq = decide(['--rules', rules, '--holdout-rate=1'], CTX).out;
  assert.equal(eq.arm, 'holdout');
  assert.equal(eq.steer, null);
  assert.equal(eq.level, 'shallow');
  assert.deepEqual(eq.reasons, ['r-shallow']);
  assert.deepEqual(eq, decide(['--rules', rules, '--holdout-rate', '1'], CTX).out);
});

t('R19: --holdout-rate=0 and a fractional =0.25 are valid rates with no reason', () => {
  assert.deepEqual(decide(['--holdout-rate=0'], CTX).out.reasons, ['no_rule']);
  assert.deepEqual(decide(['--holdout-rate=0.25'], CTX).out.reasons, ['no_rule']);
});

t('R19: --holdout-rate= (empty) and --holdout-rate=abc are bad_holdout_rate with rate 1', () => {
  for (const flag of ['--holdout-rate=', '--holdout-rate=abc', '--holdout-rate=2', '--holdout-rate=-1']) {
    const { out } = decide(['--rules', rulesFile([rule()]), flag], CTX);
    assert.equal(out.arm, 'holdout', flag);
    assert.equal(out.steer, null, flag);
    assert.deepEqual(out.reasons, ['r-shallow', 'bad_holdout_rate'], flag);
  }
});

t('R19: --rules=<file> and --table=<file> work like the spaced forms', () => {
  const table = writeJson('table.json', { version: 3, phrases: { shallow: 'Be brief.', deep: 'Think.' } });
  const state = freshState();
  const { out } = decide([`--rules=${rulesFile([rule()], 5)}`, `--table=${table}`, '--log'], CTX, { state });
  assert.equal(out.level, 'shallow');
  assert.equal(out.steer, 'Be brief.');
  assert.deepEqual(out.reasons, ['r-shallow']);
  const [rec] = logLines(state, 's1');
  assert.equal(rec.rules_version, 5);
  assert.equal(rec.steer_version, 3);
});

t('R19: --rules= and --table= (empty value) are an unreadable file, not the default', () => {
  const a = decide(['--rules='], CTX).out;
  assert.deepEqual(a.reasons, ['no_rule', 'rules_unreadable']);
  const b = decide(['--rules', rulesFile([rule()]), '--table='], CTX).out;
  assert.equal(b.steer, null);
  assert.deepEqual(b.reasons, ['r-shallow', 'table_unreadable']);
});

t('R19: --rules=/nonexistent is rules_unreadable, not a silent fallback to the shipped rules', () => {
  const { out } = decide([`--rules=${path.join(WORK, 'nonexistent.json')}`], CTX);
  assert.deepEqual(out.reasons, ['no_rule', 'rules_unreadable']);
});

t('R19: the value is everything after the FIRST =, so a path may contain =', () => {
  const dir = path.join(WORK, 'a=b');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rules=1.json');
  writeFileSync(file, JSON.stringify({ version: 7, rules: [rule()] }));
  const { out } = decide([`--rules=${file}`], CTX);
  assert.equal(out.level, 'shallow');
  assert.deepEqual(out.reasons, ['r-shallow']);
});

t('R19: an unconsumed --log=x adds unknown_arg and writes NO log', () => {
  const state = freshState();
  const { out } = decide(['--log=x'], CTX, { state });
  assert.deepEqual(out.reasons, ['no_rule', 'unknown_arg']);
  assert.deepEqual(allFiles(state), []);
  const real = freshState();
  const both = decide(['--log=true', '--log'], CTX, { state: real }).out;
  assert.deepEqual(both.reasons, ['no_rule', 'unknown_arg']);
  assert.equal(allFiles(real).length, 1, 'the exact --log still logs');
});

t('R19: an unknown flag and a stray positional each add unknown_arg, and only once per run', () => {
  assert.deepEqual(decide(['--foo'], CTX).out.reasons, ['no_rule', 'unknown_arg']);
  assert.deepEqual(decide(['stray'], CTX).out.reasons, ['no_rule', 'unknown_arg']);
  assert.deepEqual(decide(['--foo', 'stray', '--bar=1'], CTX).out.reasons, ['no_rule', 'unknown_arg']);
  // A name that is only a prototype key is unknown too.
  assert.deepEqual(decide(['--constructor', '--__proto__=x'], CTX).out.reasons, ['no_rule', 'unknown_arg']);
});

t('R19: unknown_arg is the first CLI reason, ahead of the file and rate reasons', () => {
  const { out } = decide(['--bogus', '--rules=', '--table', path.join(WORK, 'nope.json'), '--holdout-rate=abc', '--log'], { prompt: 'x' });
  assert.deepEqual(out.reasons, ['no_rule', 'unknown_arg', 'rules_unreadable', 'table_unreadable', 'bad_holdout_rate', 'log_skipped_no_ids']);
});

t('R19: unknown_arg is in the logged reasons too', () => {
  const state = freshState();
  const { out } = decide(['--nope', '--log'], CTX, { state });
  assert.deepEqual(logLines(state, 's1')[0].reasons, out.reasons);
  assert.ok(out.reasons.includes('unknown_arg'));
});

t('R19: a bad stdin is still bad_input, with no unknown_arg (args are not parsed yet)', () => {
  assert.deepEqual(decide(['--bogus'], '{oops').out, BAD_INPUT);
});

t('--holdout-rate followed by another flag does not swallow it (and is bad_holdout_rate, R22)', () => {
  const state = freshState();
  const { out } = decide(['--holdout-rate', '--log'], CTX, { state });
  assert.deepEqual(out.reasons, ['no_rule', 'bad_holdout_rate']);
  assert.equal(allFiles(state).length, 1);
});

// R18: exit 2 from a UserPromptSubmit hook blocks and erases the user's prompt in
// Claude Code, so an adapter that passes our exit code through must never see 2.
// Usage errors exit 64 (EX_USAGE).
t('R18: no subcommand: usage on stderr, nothing on stdout, exit 64', () => {
  const res = run([], '{}');
  assert.equal(res.status, 64);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /usage/i);
});

t('R18: unknown subcommand: usage on stderr, nothing on stdout, exit 64', () => {
  const res = run(['bogus'], JSON.stringify(CTX));
  assert.equal(res.status, 64);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /usage/i);
});

t('R15b: default rules and table resolve against the script, not the cwd', () => {
  const cwd = mkdtempSync(path.join(ROOT, 'cwd-'));
  const state = freshState();
  const { out } = decide(['--log'], CTX, { cwd, state });
  assert.deepEqual(out.reasons, ['no_rule'], 'neither rules_unreadable nor table_unreadable');
  const [rec] = logLines(state, 's1');
  assert.equal(rec.rules_version, 1, 'the shipped rules.json was loaded');
  assert.equal(rec.steer_version, 1, 'the shipped steer.table.json was loaded');
});

t('the shipped rules.json is empty', () => {
  const file = fileURLToPath(new URL('../core/rules.json', import.meta.url));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, rules: [] });
  assert.ok(statSync(file).isFile());
});

// ---- injection --------------------------------------------------------------

t('a prompt carrying JSON and newlines cannot change the shape of the output line', () => {
  const prompt = 'x","reasons":["pwned"],"steer":"evil"}\n{"level":"deep","steer":"evil"}\n';
  const state = freshState();
  const { out, stdout } = decide(['--log'], { ...CTX, prompt }, { state });
  assert.deepEqual(Object.keys(out), ['level', 'confidence', 'reasons', 'steer', 'arm']);
  assert.deepEqual(out.reasons, ['no_rule']);
  assert.equal(out.steer, null);
  assert.equal(stdout.split('\n').length, 2);
  assert.equal(logLines(state, 's1').length, 1, 'the log stays one record per line too');
});

t('ids and harness carrying newlines cannot split the output or the log', () => {
  const state = freshState();
  const { out } = decide(['--log'], { prompt: 'x', session_id: 's\n1', turn_id: 'u1', harness: 'h\n"x"' }, { state });
  assert.deepEqual(Object.keys(out), ['level', 'confidence', 'reasons', 'steer', 'arm']);
  assert.ok(out.reasons.includes('log_failed'));
});

t('a non-string harness is logged as unknown', () => {
  const state = freshState();
  decide(['--log'], { prompt: 'x', session_id: 's1', turn_id: 'u1', harness: 5 }, { state });
  assert.equal(logLines(state, 's1')[0].harness, 'unknown');
});

// ---- ES-8: skipped rules are visible ----------------------------------------

t('ES-8: a skipped rule adds rules_skipped:<id>:<error>, and the valid rule still applies', () => {
  const state = freshState();
  const bad = rule({ id: 'bad', when: { matchesAny: ['('] } });
  const { out } = decide(['--rules', rulesFile([bad, rule()]), '--log'], CTX, { state });
  assert.equal(out.level, 'shallow');
  assert.deepEqual(out.reasons, ['r-shallow', 'rules_skipped:bad:invalid_regex']);
  assert.deepEqual(logLines(state, 's1')[0].reasons, out.reasons, 'the log holds the same reasons');
});

t('ES-8: one rules_skipped reason per skipped rule, in file order', () => {
  const a = rule({ id: 'a', when: { matchesAny: ['('] } });
  const b = rule({ id: 'b', level: 'sideways' });
  const { out } = decide(['--rules', rulesFile([a, rule(), b])], CTX);
  assert.deepEqual(out.reasons, ['r-shallow', 'rules_skipped:a:invalid_regex', 'rules_skipped:b:invalid_level']);
});

t('ES-8: a slow regex in a --rules file is still skipped, and says slow_regex', () => {
  const slow = rule({ id: 'slow', when: { matchesAny: ['(a+)+$'] } });
  const { out } = decide(['--rules', rulesFile([slow])], CTX);
  assert.deepEqual(out.reasons, ['no_rule', 'rules_skipped:slow:slow_regex']);
});

t('ES-8: rules_skipped sits after unknown_arg and before table_unreadable', () => {
  const bad = rule({ id: 'bad', when: { matchesAny: ['('] } });
  const { out } = decide(['--bogus', '--rules', rulesFile([bad]), '--table', path.join(WORK, 'nope.json')], { prompt: 'x' });
  assert.deepEqual(out.reasons, ['no_rule', 'unknown_arg', 'rules_skipped:bad:invalid_regex', 'table_unreadable']);
});

t('ES-8: a file with no skipped rule adds no rules_skipped reason', () => {
  const { out } = decide(['--rules', rulesFile([rule()])], CTX);
  assert.deepEqual(out.reasons, ['r-shallow']);
});

t('ES-8: the DEFAULT rules file is loaded without the wall-clock probe, a --rules file with it', () => {
  // The shipped rules.json is empty, so the default path cannot be observed on the real
  // tree. Copy bin/ and core/, give the copy a slow regex as its default rules file, and
  // run the copy's CLI (it resolves its own rules.json through import.meta.url).
  const tree = mkdtempSync(path.join(ROOT, 'tree-'));
  cpSync(fileURLToPath(new URL('../bin', import.meta.url)), path.join(tree, 'bin'), { recursive: true });
  cpSync(fileURLToPath(new URL('../core', import.meta.url)), path.join(tree, 'core'), { recursive: true });
  const slow = rule({ id: 'slow', when: { matchesAny: ['(a+)+$'] } });
  writeFileSync(path.join(tree, 'core', 'rules.json'), JSON.stringify({ version: 3, rules: [slow] }));
  const copy = (args) => {
    const res = spawnSync(process.execPath, [path.join(tree, 'bin', 'effort-policy.mjs'), 'decide', ...args], {
      input: JSON.stringify({ prompt: 'x' }),
      cwd: WORK,
      env: { ...process.env, XDG_STATE_HOME: STATE },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  };
  assert.deepEqual(copy([]).reasons, ['no_rule'], 'default file: the slow rule loaded, so nothing was skipped');
  assert.deepEqual(copy(['--rules', path.join(tree, 'core', 'rules.json')]).reasons, ['no_rule'], 'the same path, spelled out, is still the default file');
  assert.deepEqual(copy(['--rules', rulesFile([slow])]).reasons, ['no_rule', 'rules_skipped:slow:slow_regex'], 'an override is probed');
});

t('R3 (ruled 2026-10-05): a bad rate withholds steering; an ABSENT rate still steers; a good rate is unchanged', () => {
  const rules = rulesFile([rule()]);
  assert.equal(decide(['--rules', rules], CTX).out.arm, 'treated', 'no flag is rate 0, not a bad rate');
  assert.equal(decide(['--rules', rules, '--holdout-rate', '0'], CTX).out.arm, 'treated', 'rate 0 is a valid rate');
  assert.equal(decide(['--rules', rules, '--holdout-rate', '1'], CTX).out.arm, 'holdout', 'rate 1 is a valid rate');
  const bad = decide(['--rules', rules, '--holdout-rate', 'abc'], CTX).out;
  assert.equal(bad.arm, 'holdout');
  assert.ok(bad.reasons.includes('bad_holdout_rate'), 'and it is visible');
});

t('R3: a bad rate with no session or turn id is still treated (no id means no arm to assign)', () => {
  // Pins an existing rule so the R3 ruling is not read as wider than it is: assignArm needs
  // both ids, so without them every rate gives 'treated'. This was true before R3.
  const { out } = decide(['--rules', rulesFile([rule()]), '--holdout-rate', 'abc'], { prompt: 'rename foo to bar' });
  assert.equal(out.arm, 'treated');
  assert.equal(out.steer, SHALLOW);
  assert.deepEqual(out.reasons, ['r-shallow', 'bad_holdout_rate']);
});
