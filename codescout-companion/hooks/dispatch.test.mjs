import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectHooks, mergeResults, dispatch } from './dispatch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(readFileSync(join(HERE, 'dispatch-table.json'), 'utf8'));
const hooksJson = JSON.parse(readFileSync(join(HERE, 'hooks.json'), 'utf8'));

const r = (out, code = 0, err = '') => ({ hook: 'h', code, out: typeof out === 'string' ? out : JSON.stringify(out), err });
const ctx = (event, additionalContext) => ({ hookSpecificOutput: { hookEventName: event, additionalContext } });
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const parsed = (m) => JSON.parse(m.stdout);

// ---- selection --------------------------------------------------------------------

test('a matcher is anchored: Bash does not select BashOutput', () => {
  const t = { PreToolUse: [{ matcher: 'Bash', hook: 'a.mjs' }, { matcher: 'Edit|Write', hook: 'b.mjs' }] };
  assert.deepEqual(selectHooks(t, 'PreToolUse', 'Bash').map((h) => h.hook), ['a.mjs']);
  assert.deepEqual(selectHooks(t, 'PreToolUse', 'BashOutput'), []);
  assert.deepEqual(selectHooks(t, 'PreToolUse', 'Write').map((h) => h.hook), ['b.mjs']);
  assert.deepEqual(selectHooks(t, 'PostToolUse', 'Bash'), []);
});

// ---- merge rules ------------------------------------------------------------------

test('one hook output passes through unchanged', () => {
  const one = deny('no');
  assert.deepEqual(parsed(mergeResults([r(one), r('')])), one);
});

test('no output at all merges to nothing', () => {
  assert.deepEqual(mergeResults([r(''), r('  \n')]), { code: 0, stdout: '', stderr: '' });
});

test('deny beats advisory context, and the deny reason survives', () => {
  const m = parsed(mergeResults([r(ctx('PreToolUse', 'hint')), r(deny('blocked: why'))]));
  assert.equal(m.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(m.hookSpecificOutput.permissionDecisionReason, 'blocked: why');
  assert.equal(m.hookSpecificOutput.additionalContext, 'hint');
});

test('deny > ask > allow, whatever the order', () => {
  const dec = (d, reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d, permissionDecisionReason: reason } });
  for (const order of [['allow', 'ask', 'deny'], ['deny', 'allow', 'ask'], ['ask', 'deny', 'allow']]) {
    const m = parsed(mergeResults(order.map((d) => r(dec(d, `why-${d}`)))));
    assert.equal(m.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(m.hookSpecificOutput.permissionDecisionReason, 'why-deny');
  }
  const m = parsed(mergeResults([r(dec('allow', 'a')), r(dec('ask', 'k'))]));
  assert.equal(m.hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(m.hookSpecificOutput.permissionDecisionReason, 'k');
});

test('additionalContext of every hook is kept, in order', () => {
  const m = parsed(mergeResults([r(ctx('PostToolUse', 'first')), r(''), r(ctx('PostToolUse', 'second'))]));
  assert.equal(m.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(m.hookSpecificOutput.additionalContext, 'first\nsecond');
});

test('updatedInput and other fields come from the first hook that sets them', () => {
  const a = { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { prompt: 'A' } }, systemMessage: 'sa' };
  const b = { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { prompt: 'B' } }, systemMessage: 'sb' };
  const m = parsed(mergeResults([r(a), r(b)]));
  assert.deepEqual(m.hookSpecificOutput.updatedInput, { prompt: 'A' });
  assert.equal(m.systemMessage, 'sa');
});

test('exit code 2 blocks with that hook\'s stderr and drops the other outputs', () => {
  const m = mergeResults([r(ctx('PreToolUse', 'hint')), r('', 2, 'stop: reason\n')]);
  assert.deepEqual(m, { code: 2, stdout: '', stderr: 'stop: reason\n' });
});

test('plain-text hook output is passed through, not dropped', () => {
  const m = mergeResults([r('note to the model'), r(ctx('PreToolUse', 'hint'))]);
  assert.equal(m.code, 0);
  assert.match(m.stdout, /note to the model/);
  assert.match(m.stdout, /"additionalContext":"hint"/);
});

// ---- running hooks in workers -----------------------------------------------------

function fixtureDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
const EVENT = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'x' } });
const T = (hooks) => ({ PreToolUse: hooks.map((h) => ({ matcher: 'Bash', ...h })) });

test('a hook receives the event, and output written just before process.exit() survives', async () => {
  const dir = fixtureDir({
    // Reads the input through the same call the real hooks use: workerData, not stdin.
    'echo.mjs': `import { workerData } from 'node:worker_threads';
      const ev = JSON.parse(workerData.hookInput);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
        permissionDecision: 'deny', permissionDecisionReason: 'saw ' + ev.tool_input.command } }));
      process.exit(0);`,
  });
  const m = await dispatch('PreToolUse', EVENT, T([{ hook: 'echo.mjs' }]), dir);
  assert.equal(parsed(m).hookSpecificOutput.permissionDecisionReason, 'saw x');
});

test('a large output is delivered whole', async () => {
  const dir = fixtureDir({ 'big.mjs': `process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'z'.repeat(300000) } })); process.exit(0);` });
  const m = await dispatch('PreToolUse', EVENT, T([{ hook: 'big.mjs' }]), dir);
  assert.equal(parsed(m).hookSpecificOutput.additionalContext.length, 300000);
});

test('a hook that throws contributes nothing and does not hide the others (fail open)', async () => {
  const dir = fixtureDir({
    'boom.mjs': `throw new Error('boom');`,
    'ok.mjs': `process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'still here' } }));`,
  });
  const m = await dispatch('PreToolUse', EVENT, T([{ hook: 'boom.mjs' }, { hook: 'ok.mjs' }]), dir);
  assert.equal(m.code, 0);
  assert.equal(parsed(m).hookSpecificOutput.additionalContext, 'still here');
});

test('a hook past its timeout is cut off and contributes nothing', async () => {
  const dir = fixtureDir({
    'hang.mjs': `process.stdout.write('{"systemMessage":"partial"}'); setInterval(() => {}, 1000);`,
    'ok.mjs': `process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'fast' } }));`,
  });
  const t0 = Date.now();
  const m = await dispatch('PreToolUse', EVENT, T([{ hook: 'hang.mjs', timeout: 0.3 }, { hook: 'ok.mjs' }]), dir);
  assert.ok(Date.now() - t0 < 5000, 'the dispatcher must not wait for the hung hook');
  assert.equal(m.code, 0);
  assert.deepEqual(parsed(m), { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'fast' } });
});

test('a hook that exits 2 blocks the call', async () => {
  const dir = fixtureDir({ 'two.mjs': `process.stderr.write('no way'); process.exit(2);` });
  const m = await dispatch('PreToolUse', EVENT, T([{ hook: 'two.mjs' }]), dir);
  assert.equal(m.code, 2);
  assert.equal(m.stderr, 'no way');
});

test('a missing hook file and a non-JSON event both fail open', async () => {
  assert.equal((await dispatch('PreToolUse', EVENT, T([{ hook: 'nope.mjs' }]), tmpdir())).code, 0);
  assert.deepEqual(await dispatch('PreToolUse', 'not json', T([{ hook: 'x.mjs' }]), tmpdir()), { code: 0, stdout: '', stderr: '' });
  assert.deepEqual(await dispatch('PreToolUse', '', T([{ hook: 'x.mjs' }]), tmpdir()), { code: 0, stdout: '', stderr: '' });
});

// ---- registration -----------------------------------------------------------------

test('every hook in the table exists on disk and parses', () => {
  for (const hooks of Object.values(table)) {
    for (const { hook } of hooks) assert.ok(existsSync(join(HERE, hook)), `${hook} is missing`);
  }
});

test('hooks.json routes PreToolUse and PostToolUse to the daemon with a matcher that covers every table matcher', () => {
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const entries = hooksJson.hooks[event].filter((g) => g.hooks.some((h) => h.type === 'http'));
    assert.equal(entries.length, 1, `${event} has exactly one daemon entry`);
    const [entry] = entries;
    assert.equal(entry.hooks.length, 1);
    assert.deepEqual(entry.hooks[0], {
      type: 'http',
      url: `http://127.0.0.1:47615/${event}`,
      headers: { Authorization: 'Bearer $CLAUDE_PLUGINS_HOOKD_TOKEN' },
      allowedEnvVars: ['CLAUDE_PLUGINS_HOOKD_TOKEN'],
      timeout: 10,
    });
    const union = new RegExp(`^(?:${entry.matcher})$`);
    const names = ['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob', 'Agent', 'EnterWorktree',
      'mcp__codescout__symbols', 'mcp__codescout__edit_code', 'mcp__codescout__workspace',
      'mcp__plugin_x_codescout__workspace', 'mcp__codescout__doc', 'ToolSearch', 'Skill', 'BashOutput'];
    for (const name of names) {
      const wanted = selectHooks(table, event, name).length > 0;
      assert.equal(union.test(name), wanted, `${event}: dispatcher matcher and table disagree on ${name}`);
    }
  }
});

// A session can outlive the daemon (idle exit, a crash). Every hook of a tool call then fails with
// ECONNREFUSED and the guards are silently off, so the daemon is ensured at the start of a session
// AND at every prompt, not only once.
test('the daemon is ensured at SessionStart and at every UserPromptSubmit', () => {
  for (const event of ['SessionStart', 'UserPromptSubmit']) {
    const cmds = hooksJson.hooks[event].flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(cmds.includes('node ${CLAUDE_PLUGIN_ROOT}/hooks/hookd.mjs --ensure'), `${event} runs hookd.mjs --ensure`);
  }
});

test('no table hook is also registered on its own in hooks.json', () => {
  const direct = JSON.stringify(hooksJson.hooks);
  for (const [event, hooks] of Object.entries(table)) {
    for (const { hook } of hooks) {
      assert.ok(!direct.includes(`/hooks/${hook}"`), `${event}: ${hook} would run twice`);
    }
  }
});
