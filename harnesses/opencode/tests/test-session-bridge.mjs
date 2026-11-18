// session-bridge OpenCode plugin — unit tests. Run: node harnesses/opencode/tests/test-session-bridge.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DEF, {
  READER, CHILD_ENV, readerPermissions, registerReader, opencodeBin, resolveRef, runFork, buildSessionBridge,
} from '../plugins/session-bridge.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'oc-sb-test-'));
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

// Permission evaluation as the built-in agents' lists imply: last matching rule wins.
const allowed = (perms, action, resource = '*') => {
  let eff = 'ask';
  for (const p of perms) if ((p.action === '*' || p.action === action) && (p.resource === '*' || p.resource === resource)) eff = p.effect;
  return eff === 'allow';
};

const sessions = [
  { id: 'ses_aaa111', time: { updated: 3000 }, location: { directory: '/p' } },
  { id: 'ses_bbb222', time: { updated: 2000 }, location: { directory: '/p' } },
  { id: 'ses_ccc333', parentID: 'ses_aaa111', time: { updated: 1000 }, location: { directory: '/p' } },
];
const labels = { ses_aaa111: 'fix the login bug', ses_bbb222: 'write the release notes', ses_ccc333: 'subagent task' };
const fakeCtx = (removed = []) => ({
  session: {
    list: async () => ({ data: sessions.map((s) => ({ ...s })) }),
    context: async ({ sessionID }) => ({ data: [{ type: 'user', text: labels[sessionID] }] }),
    remove: async ({ sessionID }) => { removed.push(sessionID); },
  },
});

await ok('default export matches the v2 loader union {id, setup}', () => {
  assert.equal(DEF.id, 'session-bridge');
  assert.equal(typeof DEF.setup, 'function');
});

// `plan` can run shell on 2.1.3; the reader must not.
await ok('the reader agent denies edit, write, shell and every other non-reading tool', () => {
  const p = readerPermissions();
  for (const a of ['edit', 'write', 'patch', 'bash', 'shell', 'webfetch', 'task', 'subagent', 'codescout_edit_file', 'codescout_run_command', 'codescout_memory']) {
    assert.equal(allowed(p, a), false, `${a} must be denied`);
  }
  for (const a of ['read', 'grep', 'glob', 'codescout_read_file', 'codescout_symbols']) assert.equal(allowed(p, a), true, `${a} must be allowed`);
  assert.equal(allowed(p, 'read', '*.env'), false, '.env files stay unreadable');
});

await ok('registerReader creates a hidden subagent with the read-only permissions', () => {
  const agents = { build: { id: 'build', model: { id: 'm', providerID: 'p' } } };
  registerReader({ get: (id) => agents[id], update: (id, fn) => fn(agents[id] ?? (agents[id] = { id, permissions: [] })) });
  const a = agents[READER];
  assert.equal(a.mode, 'subagent');
  assert.equal(a.hidden, true);
  assert.deepEqual(a.permissions, readerPermissions());
  assert.equal(a.system, undefined);
});

await ok('opencodeBin uses the host binary inside OpenCode, `opencode` elsewhere, and honours the override', () => {
  assert.equal(opencodeBin('/x/bin/opencode.exe', {}), '/x/bin/opencode.exe');
  assert.equal(opencodeBin('/usr/bin/node', {}), 'opencode');
  assert.equal(opencodeBin('/usr/bin/node', { OPENCODE_SESSION_BRIDGE_BIN: '/o' }), '/o');
});

await ok('resolveRef: exact id, prefix, label words; ambiguity and misses are errors', () => {
  const rows = sessions.map((s) => ({ ...s, label: labels[s.id] }));
  assert.equal(resolveRef(rows, 'ses_bbb222').id, 'ses_bbb222');
  assert.equal(resolveRef(rows, 'ses_aaa').id, 'ses_aaa111');
  assert.equal(resolveRef(rows, 'release NOTES').id, 'ses_bbb222');
  assert.throws(() => resolveRef(rows, 'ses_'), /ambiguous/);
  assert.throws(() => resolveRef(rows, 'nothing like it'), /no OpenCode session/);
  assert.throws(() => resolveRef(rows, ''), /required/);
});

await ok('list hides subagent sessions by default and labels each session', async () => {
  const b = buildSessionBridge(fakeCtx(), '/p', { fork: async () => ({}) });
  const out = (await b.list({})).output;
  assert.match(out, /ses_aaa111 .*fix the login bug/);
  assert.match(out, /ses_bbb222 .*write the release notes/);
  assert.doesNotMatch(out, /ses_ccc333/);
  assert.match((await b.list({ include_children: true })).output, /ses_ccc333/);
});

await ok('ask forks the target read-only and deletes the fork afterwards', async () => {
  const removed = [];
  let call;
  const b = buildSessionBridge(fakeCtx(removed), '/p', { fork: async (a) => { call = a; return { answer: 'the bug was a typo', forkId: 'ses_fork9' }; } });
  const r = await b.ask({ ref: 'release', prompt: 'what is left?' }, { sessionID: 'ses_aaa111' });
  assert.equal(call.sessionId, 'ses_bbb222');
  assert.equal(call.directory, '/p');
  assert.match(r.output, /snapshot of ses_bbb222/);
  assert.match(r.output, /the bug was a typo/);
  assert.deepEqual(removed, ['ses_fork9']);
});

await ok('the fork is deleted even when the ask fails', async () => {
  const removed = [];
  const b = buildSessionBridge(fakeCtx(removed), '/p', {
    fork: async () => { throw Object.assign(new Error('boom'), { forkId: 'ses_forkX' }); },
  });
  await assert.rejects(b.ask({ ref: 'release', prompt: 'q' }, {}), /boom/);
  assert.deepEqual(removed, ['ses_forkX'], 'a failed ask must still delete its fork');
});

await ok('asking your own session is refused', async () => {
  const b = buildSessionBridge(fakeCtx(), '/p', { fork: async () => ({ answer: 'x' }) });
  await assert.rejects(b.ask({ ref: 'ses_aaa111', prompt: 'q' }, { sessionID: 'ses_aaa111' }), /this session/);
});

// The real launcher, against a fake opencode that prints the JSON events `opencode run
// --format json` prints and records its argv and env.
const fakeBin = join(SANDBOX, 'opencode');
writeFileSync(fakeBin, `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(join(SANDBOX, 'argv.json'))}, JSON.stringify({ argv: process.argv.slice(2), child: process.env.${CHILD_ENV} || null, cwd: process.cwd() }));
const ev = (o) => console.log(JSON.stringify(o));
ev({ type: 'step_start', sessionID: 'ses_fork77', part: {} });
ev({ type: 'text', sessionID: 'ses_fork77', part: { type: 'text', text: 'answer from the snapshot' } });
`);
chmodSync(fakeBin, 0o755);

await ok('runFork passes --fork, the reader agent and the child flag, and parses the answer and fork id', async () => {
  const r = await runFork({ bin: fakeBin, sessionId: 'ses_orig', directory: SANDBOX, prompt: 'what changed?', timeoutS: 30 });
  assert.deepEqual(r, { answer: 'answer from the snapshot', forkId: 'ses_fork77' });
  const rec = JSON.parse(readFileSync(join(SANDBOX, 'argv.json'), 'utf8'));
  assert.deepEqual(rec.argv, ['run', '--standalone', '--format', 'json', '--agent', READER, '--fork', '-s', 'ses_orig', 'what changed?']);
  assert.equal(rec.child, '1', 'the fork must see the child flag (no recursion)');
});

await ok('runFork rejects when the binary is missing', async () => {
  await assert.rejects(runFork({ bin: join(SANDBOX, 'nope'), sessionId: 's', directory: SANDBOX, prompt: 'q', timeoutS: 5 }));
});

await ok('inside a fork (child flag set) the plugin registers the reader but no tools', async () => {
  const prev = process.env[CHILD_ENV];
  process.env[CHILD_ENV] = '1';
  let toolsAdded = 0;
  const agents = {};
  try {
    await DEF.setup({
      agent: { transform: async (fn) => fn({ get: () => undefined, update: (id, f) => f(agents[id] = { id }) }) },
      tool: { transform: async () => { toolsAdded++; } },
      session: {},
    });
  } finally {
    if (prev === undefined) delete process.env[CHILD_ENV];
    else process.env[CHILD_ENV] = prev;
  }
  assert.ok(agents[READER]);
  assert.equal(toolsAdded, 0);
});

// Measured on 2.1.3: without options.codemode=false a plugin tool is only reachable from
// inside OpenCode's code-mode `execute` tool, not as a direct tool.
await ok('outside a fork, setup adds both tools as DIRECT tools (codemode: false)', async () => {
  const added = [];
  await DEF.setup({
    agent: { transform: async (fn) => fn({ get: () => undefined, update: (id, f) => f({ id }) }) },
    tool: { transform: async (fn) => fn({ add: (t) => added.push(t) }) },
    session: {},
  });
  assert.deepEqual(added.map((t) => t.name).sort(), ['ask_session', 'list_sessions']);
  for (const t of added) {
    assert.equal(t.options.namespace, 'session_bridge');
    assert.equal(t.options.codemode, false, `${t.name} must be a direct tool`);
    assert.equal(typeof t.execute, 'function');
  }
});

console.log(`\nResults: ${pass} passed, ${process.exitCode ? 'FAILURES above' : '0 failed'}`);
