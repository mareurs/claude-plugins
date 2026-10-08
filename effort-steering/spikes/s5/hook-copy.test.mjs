// hook-copy.test.mjs — writeHookCopy (Task 10a, rulings R83 and R86).
//
// Two kinds of test. The structural ones run on a small fixture tree, so every boundary of the copy is a file
// the test chose: which files are dropped, which are kept, what is overwritten, and that the source is untouched.
// The behavioural ones run on THIS checkout's effort-steering/ and execute the COPIED hook with the host node, the
// way a B container does with the container's node: a copy that cannot load its rules would make every B run an
// arm_mismatch at 256-run scale (R83). No model is called and no Docker is used.
//
// Fixtures live under one mkdtemp directory in os.tmpdir(), removed on process exit (also after a failed test).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { writeHookCopy } from './hook-copy.mjs';

const ES = fileURLToPath(new URL('../..', import.meta.url));
const HOOK_INPUT = JSON.parse(readFileSync(path.join(ES, 'adapter', 'claude-code', 'fixtures', 'hook-input.json'), 'utf8'));

const ROOT = mkdtempSync(path.join(os.tmpdir(), 's5-hook-copy-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));
let dirN = 0;
const fresh = (label) => {
  const dir = path.join(ROOT, `${label}-${dirN++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Every file under `dir` as a '/'-separated path relative to it, sorted.
function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}
// { relative path: bytes } of every file under `dir`.
const bytesOf = (dir) => Object.fromEntries(listFiles(dir).map((f) => [f, readFileSync(path.join(dir, f))]));

const HOOK_DIRS = ['bin', 'core', 'adapter'];
const isTestFile = (f) => f.endsWith('.test.mjs');
const RULES_JSON = 'core/rules.json';

const THE_RULE = { id: 's5-all', level: 'shallow', confidence: 'high', reason: 's5', when: { minChars: 0 } };
const THE_SETTINGS = {
  hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node /opt/es/adapter/claude-code/user-prompt-submit.mjs' }] }] },
};

// A tree shaped like effort-steering/, with every case the file filter and the copy must get right.
const FIXTURE_FILES = {
  'README.md': 'outside the three directories',
  'spikes/s5/run.mjs': 'outside the three directories',
  'docs/x.md': 'outside the three directories',
  'bin/a.mjs': 'a',
  'bin/a.test.mjs': 'a test',
  'core/b.mjs': Buffer.from([0x00, 0xff, 0x10, 0x80, 0x0a]),
  'core/testkit.mjs': 'a helper, not a test: its name does not end in .test.mjs',
  'core/test.mjs': 'no dot before test: not *.test.mjs',
  'core/data.test.mjs.json': 'ends in .json, not .test.mjs',
  'core/rules.json': '{"version":9,"rules":[{"id":"shipped"}]}\n',
  'core/deep/c.mjs': 'c',
  'core/deep/c.test.mjs': 'a nested test',
  'core/deep/er/d.test.mjs': 'a deeper test',
  'adapter/claude-code/d.mjs': 'd',
  'adapter/claude-code/d.test.mjs': 'a test',
  'adapter/claude-code/fixtures/in.json': '{"k":1}\n',
};
function fixtureTree() {
  const es = fresh('es-src');
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    const abs = path.join(es, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return es;
}

t('writeHookCopy: the settings command uses /opt/es; rules.json holds the one shallow rule; no *.test.mjs is copied', () => {
  const { copyDir, settingsFile } = writeHookCopy(fresh('root'), ES);

  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), THE_SETTINGS);
  assert.deepEqual(JSON.parse(readFileSync(path.join(copyDir, RULES_JSON), 'utf8')), { version: 1, rules: [THE_RULE] });

  // The copy is exactly the source's bin/, core/ and adapter/ without *.test.mjs, plus the one rewritten file.
  const source = Object.fromEntries(HOOK_DIRS.flatMap((d) => Object.entries(bytesOf(path.join(ES, d))).map(([f, b]) => [`${d}/${f}`, b])));
  const testFiles = Object.keys(source).filter(isTestFile);
  assert.ok(testFiles.length >= 5, `the source has test files to leave out (found ${testFiles.length})`);
  for (const d of HOOK_DIRS) assert.ok(testFiles.some((f) => f.startsWith(`${d}/`)), `${d}/ has a test file the copy must not carry`);
  const copy = bytesOf(copyDir);
  assert.deepEqual(Object.keys(copy).filter(isTestFile), [], 'no *.test.mjs in the copy');
  const expected = Object.fromEntries(Object.entries(source).filter(([f]) => !isTestFile(f)));
  expected[RULES_JSON] = copy[RULES_JSON];
  assert.deepEqual(copy, expected, 'every other file is copied byte for byte');
});

t('writeHookCopy: on a fixture tree, only *.test.mjs files are dropped, only bin/ core/ adapter/ are copied, and rules.json is replaced', () => {
  const es = fixtureTree();
  const { copyDir } = writeHookCopy(fresh('root'), es);

  assert.deepEqual(readdirSync(copyDir).sort(), ['adapter', 'bin', 'core']);
  const expected = {};
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    if (!HOOK_DIRS.some((d) => rel.startsWith(`${d}/`)) || isTestFile(rel)) continue;
    expected[rel] = Buffer.from(content);
  }
  expected[RULES_JSON] = Buffer.from(`${JSON.stringify({ version: 1, rules: [THE_RULE] })}\n`);
  assert.deepEqual(Object.keys(expected).sort(), [
    'adapter/claude-code/d.mjs',
    'adapter/claude-code/fixtures/in.json',
    'bin/a.mjs',
    'core/b.mjs',
    'core/data.test.mjs.json',
    'core/deep/c.mjs',
    'core/rules.json',
    'core/test.mjs',
    'core/testkit.mjs',
  ]);
  assert.deepEqual(bytesOf(copyDir), expected);
});

t('writeHookCopy: the source tree is not touched (its shipped rules.json stays, and nothing is added)', () => {
  const es = fixtureTree();
  const before = bytesOf(es);
  writeHookCopy(fresh('root'), es);
  assert.deepEqual(bytesOf(es), before);
  assert.equal(readFileSync(path.join(es, RULES_JSON), 'utf8'), FIXTURE_FILES[RULES_JSON]);
});

t('writeHookCopy: the paths returned are absolute and exist; the settings file is outside the copy that is mounted at /opt/es', () => {
  const root = fresh('root');
  // A relative root is resolved: docker -v needs absolute paths, and the caller's cwd may change.
  const { copyDir, settingsFile } = writeHookCopy(path.relative(process.cwd(), root), path.relative(process.cwd(), ES));
  assert.ok(path.isAbsolute(copyDir) && path.isAbsolute(settingsFile), `${copyDir} ${settingsFile}`);
  assert.ok(statSync(copyDir).isDirectory());
  assert.ok(statSync(settingsFile).isFile());
  assert.equal(copyDir, path.join(root, 'es'));
  assert.equal(settingsFile, path.join(root, 'settings.json'));
  assert.ok(!settingsFile.startsWith(`${copyDir}${path.sep}`), 'the settings file is not inside the copy');
  assert.ok(!listFiles(copyDir).includes('settings.json'), 'the copy holds no settings file');
});

t('writeHookCopy: a second call into the same root rebuilds the copy: a stale file is gone, a changed file is back', () => {
  const es = fixtureTree();
  const root = fresh('root');
  const first = writeHookCopy(root, es);
  writeFileSync(path.join(first.copyDir, 'core', 'stale.mjs'), 'left over');
  writeFileSync(path.join(first.copyDir, 'bin', 'a.mjs'), 'edited in the copy');
  writeFileSync(first.settingsFile, '{}');
  const second = writeHookCopy(root, es);
  assert.deepEqual(second, first);
  assert.ok(!existsSync(path.join(second.copyDir, 'core', 'stale.mjs')));
  assert.equal(readFileSync(path.join(second.copyDir, 'bin', 'a.mjs'), 'utf8'), 'a');
  assert.deepEqual(JSON.parse(readFileSync(second.settingsFile, 'utf8')), THE_SETTINGS);
});

t('writeHookCopy: a source directory that is missing is refused by name before anything is written', () => {
  for (const dir of HOOK_DIRS) {
    const es = fixtureTree();
    rmSync(path.join(es, dir), { recursive: true });
    const root = fresh('root');
    assert.throws(() => writeHookCopy(root, es), (e) => e instanceof Error && e.message.includes(path.join(es, dir)), dir);
    assert.deepEqual(readdirSync(root), [], `${dir}: nothing was written`);
  }
  // A file where the directory should be is not a directory.
  const es = fixtureTree();
  rmSync(path.join(es, 'core'), { recursive: true });
  writeFileSync(path.join(es, 'core'), 'a file');
  assert.throws(() => writeHookCopy(fresh('root'), es), (e) => e instanceof Error && e.message.includes(path.join(es, 'core')));

  // A call that is refused leaves what a good call wrote: every check comes before the first removal or write.
  const keptRoot = fresh('root');
  const good = writeHookCopy(keptRoot, fixtureTree());
  const kept = { copy: bytesOf(good.copyDir), settings: readFileSync(good.settingsFile) };
  const broken = fixtureTree();
  rmSync(path.join(broken, 'adapter'), { recursive: true });
  assert.throws(() => writeHookCopy(keptRoot, broken), (e) => e instanceof Error && e.message.includes(path.join(broken, 'adapter')));
  assert.throws(() => writeHookCopy(keptRoot, ''), TypeError);
  assert.deepEqual(bytesOf(good.copyDir), kept.copy);
  assert.deepEqual(readFileSync(good.settingsFile), kept.settings);
});

t('writeHookCopy: a blank or non-string root or esRoot is a TypeError that names the argument', () => {
  const es = fixtureTree();
  for (const bad of ['', '  ', undefined, null, 7, {}]) {
    assert.throws(() => writeHookCopy(bad, es), (e) => e instanceof TypeError && e.message.includes('root') && !e.message.includes('esRoot'), `root ${String(bad)}`);
    assert.throws(() => writeHookCopy(fresh('root'), bad), (e) => e instanceof TypeError && e.message.includes('esRoot'), `esRoot ${String(bad)}`);
  }
});

// ---- the copy works: the copied hook, run with the host node ----

// The command the settings register, mapped from the container path to the copy on the host: the test runs the file the
// settings name, so a settings command that points at a file the copy does not hold fails here.
function copiedHookPath({ copyDir, settingsFile }) {
  const { command } = JSON.parse(readFileSync(settingsFile, 'utf8')).hooks.UserPromptSubmit[0].hooks[0];
  const [bin, script, ...rest] = command.split(' ');
  assert.equal(bin, 'node');
  assert.deepEqual(rest, []);
  assert.ok(script.startsWith('/opt/es/'), script);
  return path.join(copyDir, script.slice('/opt/es/'.length));
}

// One UserPromptSubmit run of the copied hook under a fresh XDG_STATE_HOME, as a container does (rate is the arm's).
function runCopiedHook(copy, { rate, sessionId }) {
  const state = fresh('state');
  const res = spawnSync(process.execPath, [copiedHookPath(copy)], {
    input: JSON.stringify({ ...HOOK_INPUT, session_id: sessionId }),
    env: { PATH: process.env.PATH, HOME: fresh('home'), XDG_STATE_HOME: state, EFFORT_STEERING_HOLDOUT_RATE: rate },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.ok(!res.error, `the hook did not finish: ${res.error}`);
  const logFile = path.join(state, 'effort-steering', `${sessionId}.jsonl`);
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : [];
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, log, stateFiles: listFiles(state) };
}

t("writeHookCopy: the copied hook steers at holdout rate '0' and logs a steered decision; at '1' it holds out and logs that", () => {
  const copy = writeHookCopy(fresh('root'), ES);

  const steered = runCopiedHook(copy, { rate: '0', sessionId: 'b-session' });
  assert.equal(steered.status, 0, steered.stderr);
  assert.equal(steered.stderr, '', 'no alert: the copy loaded its rules, its table and its CLI');
  const lines = steered.stdout.split('\n');
  assert.equal(lines.length, 2, 'exactly one JSON line');
  assert.equal(lines[1], '');
  const out = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(typeof out.hookSpecificOutput.additionalContext === 'string' && out.hookSpecificOutput.additionalContext.length > 0);
  assert.deepEqual(steered.stateFiles, ['effort-steering/b-session.jsonl']);
  assert.equal(steered.log.length, 1);
  assert.equal(steered.log[0].session_id, 'b-session');
  assert.equal(steered.log[0].level, 'shallow');
  assert.equal(steered.log[0].arm, 'treated');
  assert.equal(steered.log[0].steered, true);
  assert.ok(steered.log[0].reasons.includes('s5-all'), `the rule that matched is the copy's: ${JSON.stringify(steered.log[0].reasons)}`);

  const held = runCopiedHook(copy, { rate: '1', sessionId: 'a-session' });
  assert.equal(held.status, 0, held.stderr);
  assert.equal(held.stderr, '');
  assert.equal(held.stdout, '', 'a held-out turn gets no steer');
  assert.equal(held.log.length, 1, 'a held-out turn still leaves its decision-log line');
  assert.equal(held.log[0].session_id, 'a-session');
  assert.equal(held.log[0].level, 'shallow', 'the decision is the same, only its application is withheld');
  assert.equal(held.log[0].arm, 'holdout');
  assert.equal(held.log[0].steered, false);
  assert.ok(held.log[0].reasons.includes('s5-all'));
});
