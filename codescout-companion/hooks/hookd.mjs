// Companion hook daemon (SPIKE): serves the PreToolUse/PostToolUse hooks over loopback HTTP,
// so a tool call costs one HTTP round-trip instead of one process start per hook.
//
//   node hookd.mjs            run the daemon (foreground)
//   node hookd.mjs --ensure   make sure a daemon answers; start one detached if not
//
// Claude Code POSTs the hook event JSON to /<Event>; the body of the 200 answer is the
// merged hook output (the same object dispatch.mjs prints). The daemon reuses dispatch()
// from dispatch.mjs, so the hook scripts and their merge rules are unchanged.
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch } from './dispatch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env.COMPANION_HOOKD_PORT || 47615);
const TOKEN = process.env.CLAUDE_PLUGINS_HOOKD_TOKEN || '';
const IDLE_MS = Number(process.env.COMPANION_HOOKD_IDLE_MS || 30 * 60 * 1000);
const MAX_BODY = 8 * 1024 * 1024;
const EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const TIMING_LOG = process.env.COMPANION_HOOKD_TIMING_LOG || ''; // one line per request: handler time in ms

const get = (path) => new Promise((resolve) => {
  const req = http.get({ host: HOST, port: PORT, path, timeout: 400 }, (res) => {
    res.resume();
    resolve(res.statusCode === 200);
  });
  req.on('timeout', () => { req.destroy(); resolve(false); });
  req.on('error', () => resolve(false));
});

async function ensure() {
  if (await get('/health')) return;
  const child = spawn(process.execPath, [join(HERE, 'hookd.mjs')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (await get('/health')) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// A deny that an exit-code-2 hook cannot express over HTTP: PreToolUse gets the stderr as the reason.
function bodyFor(event, merged) {
  if (merged.code === 2) {
    if (event !== 'PreToolUse') return '';
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: merged.stderr || 'blocked by a companion hook' },
    });
  }
  const out = merged.stdout.trim();
  // HTTP needs a JSON object or nothing; plain text from a hook has no home here.
  return out.startsWith('{') ? out : '';
}

function serve() {
  const table = JSON.parse(readFileSync(join(HERE, 'dispatch-table.json'), 'utf8'));
  let last = Date.now();
  const server = http.createServer((req, res) => {
    last = Date.now();
    const done = (status, body = '') => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    };
    if (req.method === 'GET' && req.url === '/health') return done(200, '{"ok":true}');
    const event = (req.url || '').slice(1);
    if (req.method !== 'POST' || !EVENTS.has(event)) return done(404);
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return done(401);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { done(413); req.destroy(); } else chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (process.env.COMPANION_HOOKD_DUMP) appendFileSync(`${process.env.COMPANION_HOOKD_DUMP}-${event}.json`, raw + '\n');
        const t0 = performance.now();
        const merged = await dispatch(event, raw, table, HERE);
        done(200, bodyFor(event, merged));
        if (TIMING_LOG) {
          let tool = '?';
          try { tool = JSON.parse(raw).tool_name; } catch { /* keep ? */ }
          appendFileSync(TIMING_LOG, `${new Date().toISOString()} ${event} ${tool} ${(performance.now() - t0).toFixed(0)}ms [${merged.timings}]\n`);
        }
      } catch {
        done(200); // fail open
      }
    });
  });
  server.on('error', (e) => process.exit(e.code === 'EADDRINUSE' ? 0 : 1)); // another daemon already serves this port
  server.listen(PORT, HOST);
  setInterval(() => { if (Date.now() - last > IDLE_MS) process.exit(0); }, 60_000).unref();
}

if (process.argv[2] === '--ensure') ensure().then(() => process.exit(0), () => process.exit(0));
else serve();
