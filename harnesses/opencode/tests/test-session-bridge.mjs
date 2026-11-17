// session-bridge OpenCode plugin — unit tests. Run: node harnesses/opencode/tests/test-session-bridge.mjs
// The Rust binary is replaced by the committed fixture fixtures/fake-bridge/session-bridge.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import DEF, { READER, CHILD_ENV, readerPermissions, registerReader, bridgeBin, makeToolExecute } from '../plugins/session-bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_DIR = join(HERE, 'fixtures', 'fake-bridge');
const FAKE = join(FAKE_DIR, 'session-bridge');
const SANDBOX = mkdtempSync(join(tmpdir(), 'oc-sb-test-'));
const LOG = join(SANDBOX, 'log.json');
process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));

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

// Run fn with env vars set (undefined deletes), restoring afterwards.
const withEnv = async (vars, fn) => {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};
const fake = (extra = {}) => ({ SESSION_BRIDGE_BIN: FAKE, FAKE_SB_LOG: LOG, FAKE_SB_OUT: undefined, FAKE_SB_ERR: undefined, FAKE_SB_EXIT: undefined, ...extra });
const logged = (which) => JSON.parse(readFileSync(which ? `${LOG}.${which}` : LOG, 'utf8'));

// Set up the plugin against a recording ctx; returns the registered tools and hooks.
const setup = async (opts = {}) => {
  const tools = {};
  const hooks = {};
  const agents = {};
  await DEF.setup({
    location: { directory: opts.dir || SANDBOX },
    agent: { transform: async (fn) => fn({ get: () => undefined, update: (id, f) => f(agents[id] = { id }) }) },
    tool: {
      transform: async (fn) => fn({ add: (t) => { tools[t.name] = t; } }),
      hook: async (n, f) => { hooks[`tool.${n}`] = f; },
    },
    session: { hook: async (n, f) => { hooks[`session.${n}`] = f; } },
  });
  return { tools, hooks, agents };
};

const allowed = (perms, action, resource = '*') => {
  let eff = 'ask';
  for (const p of perms) if ((p.action === '*' || p.action === action) && (p.resource === '*' || p.resource === resource)) eff = p.effect;
  return eff === 'allow';
};

await ok('default export matches the v2 loader union {id, setup}', () => {
  assert.equal(DEF.id, 'session-bridge');
  assert.equal(typeof DEF.setup, 'function');
});

await ok('the reader agent denies edit, write, shell and every other non-reading tool', () => {
  const p = readerPermissions();
  for (const a of ['edit', 'write', 'patch', 'bash', 'shell', 'webfetch', 'task', 'codescout_edit_file', 'codescout_run_command']) {
    assert.equal(allowed(p, a), false, `${a} must be denied`);
  }
  for (const a of ['read', 'grep', 'glob', 'codescout_read_file', 'codescout_symbols']) assert.equal(allowed(p, a), true, `${a} must be allowed`);
  assert.equal(allowed(p, 'read', '*.env'), false);
});

await ok('reader_agent_still_registered: hidden subagent with the read-only permissions', async () => {
  const agents = { build: { id: 'build', model: { id: 'm', providerID: 'p' } } };
  registerReader({ get: (id) => agents[id], update: (id, fn) => fn(agents[id] ?? (agents[id] = { id, permissions: [] })) });
  const a = agents[READER];
  assert.equal(a.mode, 'subagent');
  assert.equal(a.hidden, true);
  assert.deepEqual(a.permissions, readerPermissions());
  const s = await withEnv(fake(), () => setup());
  assert.ok(s.agents[READER], 'setup registers the reader');
});

await ok('outside a fork, setup adds the four tools as DIRECT tools in the session_bridge namespace', async () => {
  const { tools } = await withEnv(fake({ [CHILD_ENV]: undefined }), () => setup());
  assert.deepEqual(Object.keys(tools).sort(), ['ask_session', 'list_sessions', 'post_notice', 'send_message']);
  for (const t of Object.values(tools)) {
    assert.equal(t.options.namespace, 'session_bridge');
    assert.equal(t.options.codemode, false);
  }
  assert.deepEqual(tools.ask_session.input.required, ['target', 'question']);
  assert.ok(tools.send_message.input.properties.message);
  assert.ok(tools.post_notice.input.properties.refs);
});

await ok('child_env_registers_no_tools: reader yes, tools and hooks no', async () => {
  const s = await withEnv(fake({ [CHILD_ENV]: '1' }), () => setup());
  assert.ok(s.agents[READER]);
  assert.deepEqual(Object.keys(s.tools), []);
  assert.deepEqual(Object.keys(s.hooks), []);
});

await ok('tool_passes_tctx_session_id_as_caller', async () => {
  await withEnv(fake({ FAKE_SB_OUT: 'ses_a  live\n' }), async () => {
    const { tools } = await setup();
    const r = await tools.list_sessions.execute({}, { sessionID: 'ses_caller9' });
    assert.equal(r.output, 'ses_a  live');
    assert.equal(r.content[0].text, 'ses_a  live');
    assert.deepEqual(logged().argv, ['call', 'list_sessions', '--opencode-caller', 'ses_caller9']);
  });
});

await ok('args_go_on_stdin_not_argv', async () => {
  await withEnv(fake({ FAKE_SB_OUT: 'answer' }), async () => {
    const { tools } = await setup();
    const args = { target: 'ses_b', question: 'what; rm -rf / $(x) "q"?', timeout_s: 5 };
    await tools.ask_session.execute(args, { sessionID: 'ses_c' });
    const l = logged();
    assert.deepEqual(JSON.parse(l.stdin), args);
    assert.deepEqual(l.argv, ['call', 'ask_session', '--opencode-caller', 'ses_c']);
    assert.ok(!l.argv.join(' ').includes('rm -rf'));
  });
});

await ok('a failing call (exit 2) throws with the binary stderr', async () => {
  await withEnv(fake({ FAKE_SB_EXIT: '2', FAKE_SB_ERR: 'no such session\n' }), async () => {
    const { tools } = await setup();
    await assert.rejects(tools.send_message.execute({ target: 'x', message: 'm' }, { sessionID: 's' }), /no such session/);
  });
});

await ok('missing_binary_error_names_override: names SESSION_BRIDGE_BIN and PATH', async () => {
  await withEnv(fake({ SESSION_BRIDGE_BIN: undefined, PATH: SANDBOX }), async () => {
    const { tools } = await setup();
    await assert.rejects(tools.list_sessions.execute({}, { sessionID: 's' }), (e) => /SESSION_BRIDGE_BIN/.test(e.message) && /PATH/.test(e.message));
  });
  await withEnv(fake({ SESSION_BRIDGE_BIN: join(SANDBOX, 'nope') }), async () => {
    const { tools } = await setup();
    await assert.rejects(tools.list_sessions.execute({}, { sessionID: 's' }), /SESSION_BRIDGE_BIN/);
  });
});

await ok('bridgeBin: absolute override, PATH fallback, relative override rejected', () => {
  assert.equal(bridgeBin({ SESSION_BRIDGE_BIN: '/x/sb' }), '/x/sb');
  assert.equal(bridgeBin({}), 'session-bridge');
  assert.throws(() => bridgeBin({ SESSION_BRIDGE_BIN: 'rel/sb' }), /absolute/);
});

await ok('PATH lookup finds the binary when no override is set', async () => {
  await withEnv(fake({ SESSION_BRIDGE_BIN: undefined, PATH: `${FAKE_DIR}:${process.env.PATH}`, FAKE_SB_OUT: 'via path' }), async () => {
    const { tools } = await setup();
    assert.equal((await tools.list_sessions.execute({}, { sessionID: 's' })).output, 'via path');
  });
});

await ok('context_hook_injects_hook_output: session-start once, then prompt each turn', async () => {
  await withEnv(fake({ FAKE_SB_OUT: 'NOTICE: hello' }), async () => {
    const { hooks } = await setup({ dir: '/proj' });
    const ev = () => ({ sessionID: 'ses_h1', system: [] });
    const e1 = ev();
    await hooks['session.context'](e1);
    assert.deepEqual(e1.system, [{ type: 'text', text: 'NOTICE: hello' }, { type: 'text', text: 'NOTICE: hello' }]);
    // Last call was the prompt hook; check its argv and payload.
    const l = logged('hook.prompt');
    assert.deepEqual(l.argv, ['hook', 'prompt', '--harness', 'opencode']);
    assert.deepEqual(JSON.parse(l.stdin), { session_id: 'ses_h1', cwd: '/proj', hook_event_name: 'UserPromptSubmit' });
    const e2 = ev();
    await hooks['session.context'](e2);
    assert.equal(e2.system.length, 1, 'session-start only on the first context of a session');
  });
});

await ok('context_hook_injects_nothing_when_the_hook_prints_nothing', async () => {
  await withEnv(fake(), async () => {
    const { hooks } = await setup();
    const e = { sessionID: 'ses_h2', system: [] };
    await hooks['session.context'](e);
    assert.deepEqual(e.system, []);
  });
});

await ok('context_hook_swallows_failure: missing binary, nonzero exit', async () => {
  await withEnv(fake({ SESSION_BRIDGE_BIN: join(SANDBOX, 'nope') }), async () => {
    const { hooks } = await setup();
    const e = { sessionID: 'ses_h3', system: [] };
    await hooks['session.context'](e);
    assert.deepEqual(e.system, []);
    await hooks['tool.execute.after']({ sessionID: 'ses_h3', tool: 'read', input: {}, result: { content: [] } });
  });
  await withEnv(fake({ FAKE_SB_EXIT: '1', FAKE_SB_OUT: 'garbage' }), async () => {
    const { hooks } = await setup();
    const e = { sessionID: 'ses_h4', system: [] };
    await hooks['session.context'](e);
    assert.deepEqual(e.system, [], 'a failing hook injects nothing');
  });
});

await ok('post-tool hook sends tool name and input, appends output to the result content', async () => {
  await withEnv(fake({ FAKE_SB_OUT: '[sb] heads up' }), async () => {
    const { hooks } = await setup({ dir: '/proj' });
    const result = { content: [{ type: 'text', text: 'orig' }] };
    await hooks['tool.execute.after']({ sessionID: 'ses_p', tool: 'bash', input: { command: 'ls' }, result });
    assert.deepEqual(logged('hook.post-tool').argv, ['hook', 'post-tool', '--harness', 'opencode']);
    assert.deepEqual(JSON.parse(logged('hook.post-tool').stdin), { session_id: 'ses_p', cwd: '/proj', hook_event_name: 'PostToolUse', tool_name: 'bash', tool_input: { command: 'ls' } });
    assert.deepEqual(result.content[1], { type: 'text', text: '[sb] heads up' });
  });
});

await ok('hard_bound: a bridge that ignores SIGTERM cannot hang a tool call', async () => {
  await withEnv(fake({ FAKE_SB_HANG: '1' }), async () => {
    const exec = makeToolExecute('list_sessions', { timeoutMs: 300 });
    const t0 = Date.now();
    await assert.rejects(exec({}, { sessionID: 'ses_x' }), /timed out/);
    assert.ok(Date.now() - t0 < 1500, `rejected after ${Date.now() - t0} ms`);
  });
});

await ok('hard_bound: a hanging bridge bounds one context event by ~one hook timeout, injecting nothing', async () => {
  await withEnv(fake({ FAKE_SB_HANG: '1' }), async () => {
    const { hooks } = await setup();
    const e = { sessionID: 'ses_hang', system: [] };
    const t0 = Date.now();
    await hooks['session.context'](e); // session-start + prompt run in parallel
    const dt = Date.now() - t0;
    assert.deepEqual(e.system, []);
    assert.ok(dt < 4500, `context event took ${dt} ms (sequential would be ~6000)`);
    const t1 = Date.now();
    await hooks['tool.execute.after']({ sessionID: 'ses_hang', tool: 'read', input: {}, result: { content: [] } });
    assert.ok(Date.now() - t1 < 4500);
  });
});

await ok('context hook emits session-start and prompt output on the first event', async () => {
  await withEnv(fake({ FAKE_SB_OUT: 'X' }), async () => {
    const { hooks } = await setup();
    const e = { sessionID: 'ses_ord', system: [] };
    await hooks['session.context'](e);
    assert.equal(e.system.length, 2);
  });
});

await ok('post-tool hook is not run when the result has no content array (notices would be lost)', async () => {
  const log = join(SANDBOX, 'nocontent.json');
  await withEnv(fake({ FAKE_SB_LOG: log, FAKE_SB_OUT: '[sb] notice' }), async () => {
    const { hooks } = await setup();
    await hooks['tool.execute.after']({ sessionID: 'ses_nc', tool: 'read', input: {}, result: { output: 'x' } });
    await hooks['tool.execute.after']({ sessionID: 'ses_nc', tool: 'read', input: {} });
    await hooks['tool.execute.after']({ sessionID: 'ses_nc', tool: 'read', input: {}, result: { content: 'text' } });
    assert.equal(existsSync(`${log}.hook.post-tool`), false, 'the hook ran and marked notices delivered');
  });
});

await ok('timeout_s limits match the binary: ask at most 300, send at most 30', async () => {
  const { tools } = await withEnv(fake(), () => setup());
  assert.equal(tools.ask_session.input.properties.timeout_s.maximum, 300);
  assert.equal(tools.send_message.input.properties.timeout_s.maximum, 30);
  assert.match(tools.ask_session.input.properties.timeout_s.description, /300/);
  assert.match(tools.send_message.input.properties.timeout_s.description, /30/);
});

await ok('missing tctx.sessionID is a clear tool error and spawns nothing', async () => {
  await withEnv(fake({ FAKE_SB_LOG: join(SANDBOX, 'never.json') }), async () => {
    const { tools } = await setup();
    await assert.rejects(tools.list_sessions.execute({}, {}), /no calling session id/);
    await assert.rejects(tools.list_sessions.execute({}), /no calling session id/);
    assert.equal(existsSync(join(SANDBOX, 'never.json')), false);
  });
});

console.log(`\nResults: ${pass} passed, ${process.exitCode ? 'FAILURES above' : '0 failed'}`);
