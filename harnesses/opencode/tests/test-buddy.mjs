// buddy OpenCode bridge — unit + integration tests. Run: node harnesses/opencode/tests/test-buddy.mjs
//
// Unit cases drive buildBuddyBridge with a fake launcher and pin the translation. The
// integration cases run the REAL launcher (buddy/hooks/run.mjs → Python) in a throwaway
// project with HOME and BUDDY_HOME pointed at a temp dir, so they prove the payload shape
// buddy actually reads — a renamed field there is the silent-no-op this suite exists for.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DEF, {
  adviceOf,
  buildBuddyBridge,
  ccToolName,
  contextText,
  hookPrompt,
  postToolPayload,
  preToolActive,
  readJudgeEnv,
  rehostBuddy,
  runBuddyHook,
  LAUNCHER,
} from '../plugins/buddy.js';
import { codescoutBareTool, runProcess, sessionFamily } from '../lib/host.mjs';

let pass = 0;
const ok = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    process.exitCode = 1;
    console.log(`  FAIL: ${name}\n        ${String(e?.message || e).split('\n').join('\n        ')}`);
  }
};

// A fake launcher: records every call, answers from a table keyed by event name.
function fakeRun(answers = {}) {
  const calls = [];
  const run = async (event, payload) => {
    calls.push({ event, payload });
    const a = answers[event];
    return typeof a === 'function' ? a(payload) : a ?? { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}
const ctxEvent = (sid, messages) => ({ sessionID: sid, messages, system: [] });
const userMsg = (id, text) => ({ id, role: 'user', content: [{ type: 'text', text }] });
const OFF = () => ({ judge: false, csJudge: false, block: false });

await ok('default export matches the v2 loader union {id, setup}', () => {
  assert.equal(DEF.id, 'buddy');
  assert.equal(typeof DEF.setup, 'function');
});

await ok('the launcher the bridge spawns exists', () => {
  assert.ok(existsSync(LAUNCHER), LAUNCHER);
});

await ok('ccToolName maps OpenCode tool names onto the Claude Code names buddy reads', () => {
  assert.equal(ccToolName('shell'), 'Bash');
  assert.equal(ccToolName('bash'), 'Bash');
  assert.equal(ccToolName('edit'), 'Edit');
  assert.equal(ccToolName('patch'), 'Edit');
  assert.equal(ccToolName('write'), 'Write');
  assert.equal(ccToolName('codescout_read_file'), 'mcp__codescout__read_file');
  assert.equal(ccToolName('codescout.symbols'), 'mcp__codescout__symbols');
  assert.equal(ccToolName('mcp__codescout__grep'), 'mcp__codescout__grep');
  assert.equal(ccToolName('something_else'), 'something_else');
});

await ok('ccToolName agrees with codescout-companion on every codescout spelling', () => {
  // The two bridges must classify a call the same way: one saw codescout where the other
  // saw an unknown tool (mcp_codescout_x unmapped, codescout__x → mcp__codescout___x).
  for (const t of ['codescout_symbols', 'mcp_codescout_symbols', 'mcp.codescout.symbols', 'codescout/symbols', 'mcp__codescout__symbols', 'codescout__symbols']) {
    assert.equal(codescoutBareTool(t), 'symbols', t);
    assert.equal(ccToolName(t), 'mcp__codescout__symbols', t);
  }
  assert.equal(ccToolName('codescouthood_symbols'), 'codescouthood_symbols');
  assert.equal(ccToolName('subagent'), 'Task', "v2's name for task");
});

await ok('postToolPayload: a codescout JSON answer reaches buddy as an object (output_id, project_root)', () => {
  const body = { output_id: '@cmd_ab12', stdout: 'x' };
  const ev = {
    sessionID: 's1',
    tool: 'codescout_run_command',
    input: { command: 'cargo test' },
    result: { content: [{ type: 'text', text: JSON.stringify(body) }, { type: 'text', text: '[cs-hint] from another bridge' }] },
  };
  const p = postToolPayload(ev, '/x');
  assert.deepEqual(p.tool_response, body, "only the first text part is the tool's answer");
  assert.match(p.tool_output, /from another bridge/, 'tool_output stays the whole text');
  const plain = postToolPayload({ ...ev, result: { content: [{ type: 'text', text: 'not json' }] } }, '/x');
  assert.equal(plain.tool_response, 'not json');
  const native = postToolPayload({ sessionID: 's1', tool: 'read', input: {}, result: { content: [{ type: 'text', text: '{"a":1}' }] } }, '/x');
  assert.equal(native.tool_response, '{"a":1}', "a native tool's answer stays text");
});

await ok('postToolPayload: snake_case args, result text from content, error text', () => {
  const p = postToolPayload(
    {
      sessionID: 's1',
      tool: 'edit',
      input: { filePath: '/x/a.py', oldString: 'a', newString: 'b' },
      result: { content: [{ type: 'text', text: 'done' }], output: { not: 'a string' } },
    },
    '/x',
  );
  assert.equal(p.hook_event_name, 'PostToolUse');
  assert.equal(p.session_id, 's1');
  assert.equal(p.cwd, '/x');
  assert.equal(p.tool_name, 'Edit');
  assert.equal(p.tool_input.file_path, '/x/a.py');
  assert.equal(p.tool_input.new_string, 'b');
  assert.equal(p.tool_output, 'done');
  assert.equal(p.tool_response, 'done');
  assert.equal(p.tool_error, undefined);
  const e = postToolPayload({ sessionID: 's1', tool: 'shell', status: 'error', error: { message: 'boom' } }, '/x');
  assert.equal(e.tool_error, 'boom');
});

await ok('contextText accepts plain stdout and a JSON additionalContext', () => {
  assert.equal(contextText('  → memory: nudge\n'), '→ memory: nudge');
  assert.equal(contextText(JSON.stringify({ hookSpecificOutput: { additionalContext: 'ctx' } })), 'ctx');
  assert.equal(contextText('{not json'), '{not json');
  assert.equal(contextText(''), '');
});

await ok('adviceOf keeps only additionalContext lines', () => {
  const out = [
    'noise',
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: '[cs-hint] one' } }),
    JSON.stringify({ other: 1 }),
    JSON.stringify({ hookSpecificOutput: { additionalContext: '[cs-hint] two' } }),
  ].join('\n');
  assert.deepEqual(adviceOf(out), ['[cs-hint] one', '[cs-hint] two']);
});

await ok('rehostBuddy rewrites codescout tool names and /buddy: commands, not markers', () => {
  assert.equal(rehostBuddy('use mcp__codescout__read_file'), 'use codescout_read_file');
  assert.equal(rehostBuddy('run /buddy:summon debug'), 'run /buddy-summon debug');
  assert.equal(rehostBuddy('<!-- buddy:summon-payload x -->'), '<!-- buddy:summon-payload x -->');
});

await ok('hookPrompt hands a summon only its typed first line', () => {
  assert.equal(hookPrompt('/buddy:summon testing\n\nYou are resolving a summon request.'), '/buddy:summon testing');
  assert.equal(hookPrompt('  fix the bug\nplease  '), 'fix the bug\nplease');
});

await ok('readJudgeEnv: the file sets the switches, the caller env wins over the file', () => {
  const d = mkdtempSync(join(tmpdir(), 'buddy-judge-'));
  try {
    const f = join(d, 'judge.env');
    writeFileSync(f, '# c\nBUDDY_JUDGE_ENABLED=true\nexport BUDDY_JUDGE_BLOCK="true"\nBUDDY_CS_JUDGE_ENABLED=false\n');
    const j = readJudgeEnv(f, {});
    assert.deepEqual(j, { judge: true, csJudge: false, block: true });
    assert.equal(preToolActive(j), true);
    const j2 = readJudgeEnv(f, { BUDDY_JUDGE_BLOCK: 'false' });
    assert.equal(preToolActive(j2), false, 'caller env must override the file');
    assert.equal(preToolActive(readJudgeEnv(join(d, 'missing.env'), {})), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

await ok("readJudgeEnv resolves judge.env's own `${VAR:-default}` form, as Python's load_judge_env does", () => {
  const d = mkdtempSync(join(tmpdir(), 'buddy-judge-'));
  try {
    const f = join(d, 'judge.env');
    writeFileSync(f, [
      'export BUDDY_JUDGE_ENABLED="${BUDDY_JUDGE_ENABLED:-true}"',
      'export BUDDY_CS_JUDGE_ENABLED="${BUDDY_CS_JUDGE_ENABLED:-false}"',
      'export BUDDY_JUDGE_BLOCK="${BUDDY_JUDGE_BLOCK:-true}"',
      '',
    ].join('\n'));
    assert.deepEqual(readJudgeEnv(f, {}), { judge: true, csJudge: false, block: true }, 'unset → the default');
    assert.equal(preToolActive(readJudgeEnv(f, {})), true, 'the blocking judge must run');
    writeFileSync(f, 'BUDDY_JUDGE_ENABLED=true\nBUDDY_JUDGE_BLOCK="${MY_BLOCK:-true}"\n');
    assert.equal(readJudgeEnv(f, { MY_BLOCK: 'false' }).block, false, 'the named variable wins when set');
    assert.equal(readJudgeEnv(f, { MY_BLOCK: '' }).block, false, "set but empty is kept (os.environ.get)");
    writeFileSync(f, 'BUDDY_JUDGE_ENABLED=true\nMY_BLOCK=false\nBUDDY_JUDGE_BLOCK=${MY_BLOCK:-true}\n');
    assert.equal(readJudgeEnv(f, {}).block, false, 'an earlier line of the file counts, as in os.environ');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

await ok('sessionFamily: answers are cached, failures (thrown or an SDK {error}) are asked again', async () => {
  const seen = [];
  const answers = { a: [new Error('down'), { error: { name: 'NotFound' } }, { data: { parentID: 'p' } }], p: [{ data: { parentID: null } }] };
  const fam = sessionFamily(async (id) => {
    seen.push(id);
    const a = answers[id].shift();
    if (a instanceof Error) throw a;
    return a;
  });
  assert.equal(await fam.parent('a'), undefined, 'a throw is unknown');
  assert.equal(await fam.parent('a'), undefined, 'an SDK {error} result is unknown, not "top-level"');
  assert.equal(await fam.parent('a'), 'p');
  assert.equal(await fam.parent('a'), 'p');
  assert.equal(await fam.root('a'), 'p');
  assert.deepEqual(seen, ['a', 'a', 'a', 'p'], 'failures retried, answers cached');
  let n = 0;
  const fam2 = sessionFamily(async () => {
    n++;
    await new Promise((r) => setTimeout(r, 10));
    return { parentID: null };
  });
  await Promise.all([fam2.parent('s'), fam2.parent('s'), fam2.root('s')]);
  assert.equal(n, 1, 'concurrent lookups of one id share one request');
});

await ok('onContext: a failed parent lookup is retried, not remembered as "top-level"', async () => {
  let n = 0;
  const getSession = async () => {
    if (n++ === 0) throw new Error('transient');
    return { parentID: 'parent' };
  };
  const f = fakeRun();
  const b = buildBuddyBridge('/proj', { run: f.run, getSession });
  await b.onContext(ctxEvent('child', [userMsg('m1', 'first')])); // unknown → top-level, this once
  const before = f.calls.length;
  await b.onContext(ctxEvent('child', [userMsg('m1', 'first'), userMsg('m2', 'second')]));
  assert.equal(f.calls.length, before, 'the lookup now answers "child": no UserPromptSubmit may run for it');
});

await ok('onContext: overlapping requests of one session run SessionStart and UserPromptSubmit once', async () => {
  const slow = (text) => () => new Promise((r) => setTimeout(() => r({ code: 0, stdout: text, stderr: '' }), 20));
  const f = fakeRun({ 'session-start': slow('BANNER'), 'user-prompt-submit': slow('PROMPT') });
  const b = buildBuddyBridge('/proj', { run: f.run, getSession: async () => ({ parentID: null }) });
  const e1 = ctxEvent('s1', [userMsg('m1', 'hello')]);
  const e2 = ctxEvent('s1', [userMsg('m1', 'hello')]);
  await Promise.all([b.onContext(e1), b.onContext(e2)]);
  assert.equal(f.calls.filter((c) => c.event === 'session-start').length, 1);
  assert.equal(f.calls.filter((c) => c.event === 'user-prompt-submit').length, 1);
  for (const e of [e1, e2]) assert.deepEqual(e.system.map((p) => p.text), ['BANNER', 'PROMPT']);
});

await ok('onContext: SessionStart once per session, UserPromptSubmit once per message', async () => {
  const f = fakeRun({
    'session-start': { code: 0, stdout: 'BANNER\n', stderr: '' },
    'user-prompt-submit': (p) => ({ code: 0, stdout: `PROMPT:${p.prompt}`, stderr: '' }),
  });
  const b = buildBuddyBridge('/proj', { run: f.run, getSession: async () => ({ parentID: null }) });
  const e1 = ctxEvent('s1', [userMsg('m1', 'hello')]);
  await b.onContext(e1);
  assert.deepEqual(e1.system.map((p) => p.text), ['BANNER', 'PROMPT:hello']);
  const e2 = ctxEvent('s1', [userMsg('m1', 'hello'), { role: 'assistant', content: [] }]);
  await b.onContext(e2); // same message, a later request in the same turn
  assert.deepEqual(e2.system.map((p) => p.text), ['BANNER', 'PROMPT:hello'], 'cached text must be re-pushed');
  assert.equal(f.calls.filter((c) => c.event === 'session-start').length, 1);
  assert.equal(f.calls.filter((c) => c.event === 'user-prompt-submit').length, 1);
  await b.onContext(ctxEvent('s1', [userMsg('m1', 'hello'), userMsg('m2', 'again')]));
  assert.equal(f.calls.filter((c) => c.event === 'user-prompt-submit').length, 2);
  const start = f.calls.find((c) => c.event === 'session-start').payload;
  assert.equal(start.session_id, 's1');
  assert.equal(start.source, 'startup');
  assert.equal(start.cwd, '/proj');
});

await ok('onContext: a summon message reaches the hook as its first line only', async () => {
  const f = fakeRun();
  const b = buildBuddyBridge('/proj', { run: f.run, getSession: async () => ({}) });
  await b.onContext(ctxEvent('s1', [userMsg('m1', '/buddy:summon debug\n\nYou are resolving a summon request.')]));
  const ups = f.calls.find((c) => c.event === 'user-prompt-submit');
  assert.equal(ups.payload.prompt, '/buddy:summon debug');
});

await ok('onContext: child sessions get nothing (no SubagentStart in buddy)', async () => {
  const f = fakeRun({ 'session-start': { code: 0, stdout: 'BANNER', stderr: '' } });
  const b = buildBuddyBridge('/proj', { run: f.run, getSession: async () => ({ parentID: 'parent' }) });
  const e = ctxEvent('child', [userMsg('m1', 'task')]);
  await b.onContext(e);
  assert.equal(e.system.length, 0);
  assert.equal(f.calls.length, 0);
});

await ok('onCompaction: SessionStart(compact) replaces the banner', async () => {
  const f = fakeRun({ 'session-start': (p) => ({ code: 0, stdout: p.source === 'compact' ? 'RESUMMON' : 'BANNER', stderr: '' }) });
  const b = buildBuddyBridge('/proj', { run: f.run, getSession: async () => ({}) });
  await b.onContext(ctxEvent('s1', []));
  const c = { sessionID: 's1', system: [] };
  await b.onCompaction(c);
  assert.deepEqual(c.system.map((p) => p.text), ['RESUMMON']);
  const e = ctxEvent('s1', []);
  await b.onContext(e);
  assert.deepEqual(e.system.map((p) => p.text), ['RESUMMON']);
});

await ok('onToolBefore: no spawn while judge.env does not ask for blocking', async () => {
  const f = fakeRun({ 'pre-tool-use': { code: 2, stdout: '', stderr: 'BLOCKED' } });
  const b = buildBuddyBridge('/proj', { run: f.run, judgeEnv: OFF });
  await b.onToolBefore({ sessionID: 's1', tool: 'shell', input: { command: 'ls' } });
  assert.equal(f.calls.length, 0);
});

await ok('onToolBefore: exit 2 denies the call with buddy\'s stderr message', async () => {
  const f = fakeRun({ 'pre-tool-use': { code: 2, stdout: '', stderr: 'judge: use mcp__codescout__symbols\n' } });
  const b = buildBuddyBridge('/proj', { run: f.run, judgeEnv: () => ({ judge: true, csJudge: false, block: true }) });
  await assert.rejects(() => b.onToolBefore({ sessionID: 's1', tool: 'shell', input: { command: 'ls' } }), /judge: use codescout_symbols/);
  assert.equal(f.calls[0].payload.tool_name, 'Bash');
  const g = fakeRun({ 'pre-tool-use': { code: 0, stdout: '', stderr: '' } });
  const b2 = buildBuddyBridge('/proj', { run: g.run, judgeEnv: () => ({ judge: true, csJudge: false, block: true }) });
  await b2.onToolBefore({ sessionID: 's1', tool: 'shell', input: { command: 'ls' } }); // exit 0 → allowed
});

await ok('onToolAfter: advisories are appended to result.content and echoed', async () => {
  const advice = JSON.stringify({ hookSpecificOutput: { additionalContext: '[cs-hint] use mcp__codescout__read_file' } });
  const f = fakeRun({ 'post-tool-use': { code: 0, stdout: `${advice}\n`, stderr: '' } });
  const echoed = [];
  const b = buildBuddyBridge('/proj', { run: f.run, echo: (r) => echoed.push(r) });
  const ev = { sessionID: 's1', tool: 'shell', input: { command: 'cat a.py' }, result: { content: [{ type: 'text', text: 'x' }] } };
  await b.onToolAfter(ev);
  assert.equal(ev.result.content.length, 2);
  assert.equal(ev.result.content[1].text, '[cs-hint] use codescout_read_file');
  assert.equal(echoed.length, 1);
  assert.equal(echoed[0].tool, 'shell');
  assert.equal(echoed[0].sessionID, 's1');
  const quiet = fakeRun();
  const b2 = buildBuddyBridge('/proj', { run: quiet.run, echo: (r) => echoed.push(r) });
  const ev2 = { sessionID: 's1', tool: 'read', input: {}, result: { content: [{ type: 'text', text: 'x' }] } };
  await b2.onToolAfter(ev2);
  assert.equal(ev2.result.content.length, 1, 'no advice → result untouched');
  assert.equal(echoed.length, 1, 'no advice → nothing echoed');
});

await ok('subagent tool calls carry the ROOT session id and the child id as agent_id, as on Claude Code', async () => {
  const parents = { root: null, child: 'root', grandchild: 'child' };
  const getSession = async (id) => ({ data: { parentID: parents[id] } });
  const f = fakeRun();
  const on = () => ({ judge: true, csJudge: false, block: true });
  const b = buildBuddyBridge('/proj', { run: f.run, getSession, judgeEnv: on, echo: () => {} });
  const tool = (sid) => ({ sessionID: sid, tool: 'shell', input: { command: 'ls' }, result: { content: [] } });
  await b.onToolAfter(tool('grandchild'));
  await b.onToolBefore(tool('child'));
  await b.onToolAfter(tool('root'));
  assert.deepEqual(
    f.calls.map((c) => [c.event, c.payload.session_id, c.payload.agent_id]),
    [
      ['post-tool-use', 'root', 'grandchild'],
      ['pre-tool-use', 'root', 'child'],
      ['post-tool-use', 'root', undefined],
    ],
  );
  const g = fakeRun();
  const down = async () => {
    throw new Error('down');
  };
  const b2 = buildBuddyBridge('/proj', { run: g.run, getSession: down, echo: () => {} });
  await b2.onToolAfter(tool('child'));
  assert.equal(g.calls[0].payload.session_id, 'child', 'a failed lookup keeps the id it has');
  assert.equal(g.calls[0].payload.agent_id, undefined);
});

await ok('runProcess: a timeout ends the whole process tree, not only the direct child', async () => {
  if (process.platform === 'win32') {
    console.log('        (process groups are POSIX; the taskkill /T path is not exercised here)');
    return;
  }
  const d = mkdtempSync(join(tmpdir(), 'buddy-tree-'));
  const pidFile = join(d, 'pid');
  // run.mjs's shape: the child starts a grandchild with inherited stdio, then waits.
  const script = [
    "const { spawn } = require('node:child_process');",
    "const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'inherit' });",
    `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
    'setTimeout(() => {}, 20000);',
  ].join('\n');
  let gpid;
  try {
    let failure;
    const res = await runProcess(process.execPath, ['-e', script], {
      timeoutMs: 1500,
      label: 'test-tree',
      onFail: (k) => {
        failure = k;
      },
    });
    assert.equal(res, null);
    assert.equal(failure, 'timeout', 'onFail names the timeout');
    gpid = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 400));
    assert.throws(() => process.kill(gpid, 0), /ESRCH/, `grandchild ${gpid} outlived the timeout`);
  } finally {
    try {
      if (gpid) process.kill(gpid, 'SIGKILL');
    } catch {
      /* gone, as it should be */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

// ── integration: the real launcher ────────────────────────────────────────────────────
const havePython = ['python3', 'python'].some((p) => spawnSync(p, ['-c', 'import yaml'], { stdio: 'ignore' }).status === 0);
if (!havePython) {
  console.log('  SKIP: no python with PyYAML — real-launcher cases NOT run');
} else {
  const root = mkdtempSync(join(tmpdir(), 'buddy-oc-'));
  const proj = join(root, 'proj');
  mkdirSync(proj);
  execFileSync('git', ['init', '-q', proj]);
  writeFileSync(join(proj, 'app.py'), 'def main():\n    return 1\n');
  const home = join(root, 'home');
  mkdirSync(home);
  const savedEnv = {
    HOME: process.env.HOME,
    BUDDY_HOME: process.env.BUDDY_HOME,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    BUDDY_JUDGE_ENABLED: process.env.BUDDY_JUDGE_ENABLED,
    BUDDY_CS_JUDGE_ENABLED: process.env.BUDDY_CS_JUDGE_ENABLED,
  };
  process.env.HOME = home;
  process.env.BUDDY_HOME = join(home, '.buddy');
  delete process.env.CLAUDE_CONFIG_DIR;
  // A codescout call takes buddy's judge-spawn path; a local judge.env must not start an LLM
  // judge from the test (the caller's env wins over judge.env).
  process.env.BUDDY_JUDGE_ENABLED = 'false';
  process.env.BUDDY_CS_JUDGE_ENABLED = 'false';
  try {
    const sid = 'ses_test_integration';
    const b = buildBuddyBridge(proj, { run: runBuddyHook, getSession: async () => ({ parentID: null }), judgeEnv: OFF, echo: () => {} });

    await ok('real launcher: the first context event creates .buddy/<OpenCode session id>/', async () => {
      await b.onContext(ctxEvent(sid, [userMsg('m1', 'hello')]));
      assert.ok(existsSync(join(proj, '.buddy', sid, 'state.json')), 'state.json missing');
      assert.equal(readFileSync(join(proj, '.buddy', '.current_session_id'), 'utf8').trim(), sid);
    });

    await ok('real launcher: a shell `cat app.py` counts as a tool call and yields a [cs-hint]', async () => {
      const ev = {
        sessionID: sid,
        tool: 'shell',
        input: { command: 'cat app.py' },
        result: { content: [{ type: 'text', text: 'def main():' }] },
      };
      await b.onToolAfter(ev);
      const st = JSON.parse(readFileSync(join(proj, '.buddy', sid, 'state.json'), 'utf8'));
      assert.equal(st.signals.tool_call_count, 1);
      const added = ev.result.content.slice(1).map((p) => p.text).join('\n');
      assert.match(added, /\[cs-hint\]/, 'expected buddy\'s native-bash-on-source advisory');
    });

    await ok('real launcher: a codescout run_command buffer is logged as "buffered" (tool_response is an object)', async () => {
      const ev = {
        sessionID: sid,
        tool: 'codescout_run_command',
        input: { command: 'cargo test' },
        result: { content: [{ type: 'text', text: JSON.stringify({ output_id: '@cmd_ab12cd34', summary: 'ok' }) }] },
      };
      await b.onToolAfter(ev);
      const log = readFileSync(join(proj, '.buddy', sid, 'cs_tool_log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(log.at(-1).tool, 'mcp__codescout__run_command');
      assert.equal(log.at(-1).outcome, 'buffered');
    });

    await ok('real launcher: /buddy-summon\'s message triggers the summon fast path', async () => {
      const e = ctxEvent(sid, [userMsg('m2', '/buddy:summon testing\n\nYou are resolving a summon request. The argument passed by the user is `testing`.')]);
      await b.onContext(e);
      const text = e.system.map((p) => p.text).join('\n');
      assert.match(text, /buddy:summon-payload specialist=testing-snow-leopard/);
      const st = JSON.parse(readFileSync(join(proj, '.buddy', sid, 'state.json'), 'utf8'));
      assert.deepEqual(st.active_specialists, ['testing-snow-leopard']);
    });
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed`);
