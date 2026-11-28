import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeVersion } from './hookd.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(HERE, 'hookd.mjs');
const TOKEN = 'test-token';

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const call = async (port, method, path, { token = TOKEN, body } = {}) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body,
    });
    return { status: r.status, text: await r.text() };
  } catch { return null; }
};
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  return null;
};
const env = (port) => ({ ...process.env, COMPANION_HOOKD_PORT: String(port), CLAUDE_PLUGINS_HOOKD_TOKEN: TOKEN, COMPANION_HOOKD_IDLE_MS: '60000' });

test('codeVersion is a stable 12-hex identifier', () => {
  assert.match(codeVersion(), /^[0-9a-f]{12}$/);
  assert.equal(codeVersion(), codeVersion());
});

test('the daemon reports its version, demands the token, ignores unknown events and quits on request', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [DAEMON], { env: env(port), stdio: 'ignore' });
  try {
    const health = await until(async () => { const r = await call(port, 'GET', '/health'); return r?.status === 200 ? r : null; });
    assert.ok(health, 'daemon answers /health');
    assert.deepEqual(JSON.parse(health.text), { ok: true, version: codeVersion() });

    const event = JSON.stringify({ session_id: 's', cwd: HERE, hook_event_name: 'PreToolUse', tool_name: 'ToolSearch', tool_input: {} });
    assert.equal((await call(port, 'POST', '/PreToolUse', { body: event })).status, 200, 'no hook matches ToolSearch: an empty 200');
    assert.equal((await call(port, 'POST', '/PreToolUse', { token: '', body: event })).status, 401);
    assert.equal((await call(port, 'POST', '/PreToolUse', { token: 'wrong', body: event })).status, 401);
    assert.equal((await call(port, 'POST', '/Stop', { body: event })).status, 404);

    assert.equal((await call(port, 'POST', '/quit', { token: 'wrong' })).status, 401, 'quit needs the token');
    assert.equal((await call(port, 'POST', '/quit')).status, 200);
    assert.ok(await until(async () => (await call(port, 'GET', '/health')) === null), 'daemon is gone after /quit');
  } finally { child.kill(); }
});

// ---- POST /wake: the asyncRewake hook served by the daemon ------------------------------

const fixtureHook = (body) => {
  const dir = mkdtempSync(join(tmpdir(), 'wake-'));
  const file = join(dir, 'wake-hook.mjs');
  writeFileSync(file, body);
  return { dir, file };
};
const startDaemon = async (extraEnv) => {
  const port = await freePort();
  const child = spawn(process.execPath, [DAEMON], { env: { ...env(port), ...extraEnv }, stdio: 'ignore' });
  await until(async () => (await call(port, 'GET', '/health'))?.status === 200);
  return { port, child };
};
const EVENT = JSON.stringify({ session_id: 's', cwd: HERE, hook_event_name: 'PostToolUse', tool_name: 'mcp__codescout__run_command', tool_input: { command: 'x' } });

test('/wake answers empty at once when the hook has nothing to wait for, and the wake text when it exits 2', async () => {
  const fg = fixtureHook(`process.exit(0);`);
  const bg = fixtureHook(`import { workerData } from 'node:worker_threads';
    setTimeout(() => process.stderr.write('job @bg_1 finished (' + JSON.parse(workerData.hookInput).tool_name + ')\\n', () => process.exit(2)), 300);`);
  for (const [name, hook, expected] of [['foreground', fg, ''], ['background', bg, 'job @bg_1 finished (mcp__codescout__run_command)\n']]) {
    const { port, child } = await startDaemon({ COMPANION_WAKE_HOOK: hook.file });
    try {
      const t0 = Date.now();
      const r = await call(port, 'POST', '/wake', { body: EVENT });
      assert.equal(r.status, 200, name);
      assert.equal(r.text, expected, name);
      if (name === 'foreground') assert.ok(Date.now() - t0 < 2000, 'a foreground call is not held');
      else assert.ok(Date.now() - t0 >= 250, 'a background job holds the answer until it ends');
    } finally { child.kill(); }
  }
});

test('/wake accepts the token in X-Hookd-Token and refuses a wrong one', async () => {
  const hook = fixtureHook(`process.exit(0);`);
  const { port, child } = await startDaemon({ COMPANION_WAKE_HOOK: hook.file });
  try {
    const post = (headers) => fetch(`http://127.0.0.1:${port}/wake`, { method: 'POST', headers, body: EVENT }).then((r) => r.status);
    assert.equal(await post({ 'x-hookd-token': TOKEN }), 200);
    assert.equal(await post({ 'x-hookd-token': 'wrong' }), 401);
    assert.equal(await post({}), 401);
  } finally { child.kill(); }
});

test('/wake stops the watcher when the client goes away', async () => {
  const beat = join(mkdtempSync(join(tmpdir(), 'beat-')), 'beat.txt');
  const hook = fixtureHook(`import { appendFileSync } from 'node:fs';
    setInterval(() => appendFileSync(${JSON.stringify(beat)}, 'x'), 50);`);
  const { port, child } = await startDaemon({ COMPANION_WAKE_HOOK: hook.file });
  try {
    const ac = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/wake`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: EVENT, signal: ac.signal }).catch(() => null);
    await until(async () => existsSync(beat));
    await new Promise((r) => setTimeout(r, 300));
    ac.abort(); await pending;
    await new Promise((r) => setTimeout(r, 300));
    const size = statSync(beat).size;
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(size > 0, 'the watcher ran while the client waited');
    assert.equal(statSync(beat).size, size, 'the watcher stopped after the client left');
  } finally { child.kill(); }
});

test('--ensure replaces a daemon that runs another code version', async () => {
  const port = await freePort();
  let quitCalls = 0;
  const old = createHttpServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return res.end(JSON.stringify({ ok: true, version: 'old-version' }));
    if (req.method === 'POST' && req.url === '/quit' && req.headers.authorization === `Bearer ${TOKEN}`) {
      quitCalls++;
      res.end();
      return old.close();
    }
    res.statusCode = 404; res.end();
  }).listen(port, '127.0.0.1');
  try {
    await new Promise((r) => old.once('listening', r));
    // Async spawn: the fake daemon lives in this process, so a blocking spawnSync would starve it.
    const code = await new Promise((resolve) => spawn(process.execPath, [DAEMON, '--ensure'], { env: env(port), stdio: 'ignore' }).on('close', resolve));
    assert.equal(code, 0);
    assert.equal(quitCalls, 1, 'the old daemon was asked to quit');
    const health = await until(async () => { const h = await call(port, 'GET', '/health'); return h?.status === 200 ? h : null; });
    assert.equal(JSON.parse(health.text).version, codeVersion(), 'a daemon of the current version took the port');
  } finally {
    old.close();
    await call(port, 'POST', '/quit');
    await until(async () => (await call(port, 'GET', '/health')) === null);
  }
});

test('--ensure starts a detached daemon of this version, and a second --ensure leaves it alone', async () => {
  const port = await freePort();
  try {
    const first = spawnSync(process.execPath, [DAEMON, '--ensure'], { env: env(port), timeout: 15000 });
    assert.equal(first.status, 0);
    const h1 = JSON.parse((await call(port, 'GET', '/health')).text);
    assert.equal(h1.version, codeVersion());
    const second = spawnSync(process.execPath, [DAEMON, '--ensure'], { env: env(port), timeout: 15000 });
    assert.equal(second.status, 0);
    assert.equal(JSON.parse((await call(port, 'GET', '/health')).text).version, codeVersion());
  } finally {
    await call(port, 'POST', '/quit');
    await until(async () => (await call(port, 'GET', '/health')) === null);
  }
});
