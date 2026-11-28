import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
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

test('the daemon exits after its idle time, and a request keeps it alive', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [DAEMON], { env: { ...env(port), COMPANION_HOOKD_IDLE_MS: '1200' }, stdio: 'ignore' });
  try {
    assert.ok(await until(async () => (await call(port, 'GET', '/health'))?.status === 200), 'daemon is up');
    for (let i = 0; i < 4; i++) { // 4 x 500 ms: longer than the idle time in total, never idle for 1200 ms
      await new Promise((r) => setTimeout(r, 500));
      assert.equal((await call(port, 'GET', '/health'))?.status, 200, `still up after request ${i + 1}`);
    }
    // Probe with a bare TCP connect: an HTTP request would count as activity and keep it alive.
    const listening = () => new Promise((resolve) => {
      const s = connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
    });
    assert.ok(await until(async () => !(await listening()), 8000), 'daemon exits once idle');
  } finally { child.kill(); }
});

test('--ensure brings a stopped daemon back (a session outliving the daemon)', async () => {
  const port = await freePort();
  try {
    assert.equal((await call(port, 'GET', '/health')), null, 'nothing listens yet');
    assert.equal(spawnSync(process.execPath, [DAEMON, '--ensure'], { env: env(port), timeout: 15000 }).status, 0);
    assert.equal((await call(port, 'GET', '/health'))?.status, 200);
    await call(port, 'POST', '/quit');
    await until(async () => (await call(port, 'GET', '/health')) === null);
    assert.equal(spawnSync(process.execPath, [DAEMON, '--ensure'], { env: env(port), timeout: 15000 }).status, 0);
    assert.equal((await call(port, 'GET', '/health'))?.status, 200, 'ensure started it again');
  } finally {
    await call(port, 'POST', '/quit');
    await until(async () => (await call(port, 'GET', '/health')) === null);
  }
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
