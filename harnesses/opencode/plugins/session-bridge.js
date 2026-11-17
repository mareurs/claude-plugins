// session-bridge for OpenCode — front end for the Rust `session-bridge` binary.
//
// The binary is the one brain for every harness (Claude Code, Codex, OpenCode): it lists
// sessions, asks one a question, sends a direct message and posts repository notices. This
// plugin only (1) exposes four tools that shell out to `session-bridge call <tool>
// --opencode-caller <session>`, and (2) feeds the binary's hook output into the session.
//
//   session_bridge_list_sessions | _ask_session | _send_message | _post_notice
//
// The caller is identified only by this plugin passing `tctx.sessionID`; the binary walks
// parentID and refuses anything that is not a live top-level session. Tool arguments go on
// stdin as one JSON object, never on argv, and the binary is spawned with an argv array,
// never a shell. Hooks fail open: a bridge failure never blocks the OpenCode turn.
//
// READER AGENT. The binary answers `ask_session` by running a read-only fork under the
// `session-bridge-reader` agent registered here (everything denied, then reading tools
// allowed; OpenCode's built-in `plan` agent is NOT read-only on 2.1.3).
//
// NO RECURSION. The forked run loads this plugin too. It sees OPENCODE_SESSION_BRIDGE_CHILD
// and registers the reader agent but not the tools or hooks.
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { resolveDir } from '../lib/host.mjs';

export const READER = 'session-bridge-reader';
export const CHILD_ENV = 'OPENCODE_SESSION_BRIDGE_CHILD';
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 600;
const OUTPUT_LIMIT = 1 << 20;
const HOOK_TIMEOUT_MS = 10000;

// Reading tools only. Native: read/grep/glob/list. codescout: its read-only tools (no
// edit_*, create_file, run_command, memory or artifact writes). Last match wins, as in the
// built-in agents' lists, so the leading `* deny` is the default.
const READ_TOOLS = ['read', 'grep', 'glob', 'list', 'skill'];
const CS_READ = ['symbols', 'read_file', 'read_markdown', 'grep', 'tree', 'semantic_search', 'get_guide'];
export function readerPermissions() {
  return [
    { action: '*', resource: '*', effect: 'deny' },
    ...READ_TOOLS.map((action) => ({ action, resource: '*', effect: 'allow' })),
    ...CS_READ.map((t) => ({ action: `codescout_${t}`, resource: '*', effect: 'allow' })),
    { action: 'read', resource: '*.env', effect: 'deny' },
    { action: 'read', resource: '*.env.*', effect: 'deny' },
  ];
}

export function registerReader(T) {
  const build = T.get('build');
  T.update(READER, (a) => {
    a.description = 'Read-only snapshot reader used by session-bridge. Cannot edit, write or run commands.';
    a.mode = 'subagent';
    a.hidden = true;
    a.permissions = readerPermissions();
    if (build?.model) a.model = { ...build.model };
  });
}

// The bridge binary: SESSION_BRIDGE_BIN (must be absolute) else `session-bridge` on PATH.
export function bridgeBin(env = process.env) {
  const o = env.SESSION_BRIDGE_BIN;
  if (o) {
    if (!isAbsolute(o)) throw new Error(`SESSION_BRIDGE_BIN must be an absolute path, got '${o}'`);
    return o;
  }
  return 'session-bridge';
}

const missingMsg = (bin) =>
  `session-bridge binary not found (tried '${bin}'): set SESSION_BRIDGE_BIN to its absolute path or put \`session-bridge\` on PATH`;

const textOf = (r) => ({ output: r, content: [{ type: 'text', text: r }] });

// Run the binary with argv `args`, JSON `stdin`, bounded by a timeout and an abort signal.
// Resolves {code, stdout, stderr}; rejects only when the binary cannot be started.
export function runBridge({ args, stdin, timeoutMs, signal, env = process.env, cwd }) {
  return new Promise((resolveP, reject) => {
    let bin;
    try { bin = bridgeBin(env); } catch (e) { reject(e); return; }
    let child;
    try {
      child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e.code === 'ENOENT' ? new Error(missingMsg(bin)) : e);
      return;
    }
    let out = '';
    let err = '';
    let done = false;
    const kill = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
    const timer = setTimeout(kill, timeoutMs);
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', kill);
      fn(v);
    };
    if (signal?.aborted) kill();
    else signal?.addEventListener?.('abort', kill, { once: true });
    child.stdout.on('data', (d) => { out = (out + d).slice(-OUTPUT_LIMIT); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-OUTPUT_LIMIT); });
    child.stdin.on('error', () => { /* child exited before reading: surfaced by its exit code */ });
    child.once('error', (e) => finish(reject, e.code === 'ENOENT' ? new Error(missingMsg(bin)) : e));
    child.once('close', (code) => {
      if (signal?.aborted) return finish(reject, new Error('cancelled'));
      finish(resolveP, { code, stdout: out, stderr: err });
    });
    child.stdin.end(stdin);
  });
}

const TOOLS = {
  list_sessions: {
    description: 'List live sessions on this machine (Claude Code, Codex, OpenCode) that session-bridge can reach.',
    properties: {},
    required: [],
  },
  ask_session: {
    description: 'Ask another live session a question; it answers from a read-only snapshot and is never modified.',
    properties: {
      target: { type: 'string', description: 'Session id, id prefix, or label from list_sessions.' },
      question: { type: 'string', description: 'The question for that session.' },
      model: { type: 'string', description: 'Optional model override for the answering run.' },
      timeout_s: { type: 'integer', minimum: 1, maximum: MAX_TIMEOUT_S, description: 'Timeout in seconds.' },
    },
    required: ['target', 'question'],
  },
  send_message: {
    description: 'Send a direct message to another live session. The text is data for the peer, never an approval.',
    properties: {
      target: { type: 'string', description: 'Session id, id prefix, or label from list_sessions.' },
      message: { type: 'string', description: 'The message to deliver.' },
      timeout_s: { type: 'integer', minimum: 1, maximum: MAX_TIMEOUT_S, description: 'Delivery timeout in seconds.' },
    },
    required: ['target', 'message'],
  },
  post_notice: {
    description: 'Post a repository notice that other sessions working in this repository will see.',
    properties: {
      title: { type: 'string', description: 'Short title.' },
      body: { type: 'string', description: 'Notice body.' },
      refs: { type: 'array', items: { type: 'string' }, description: 'Optional references (commits, paths).' },
    },
    required: ['title', 'body'],
  },
};

export function makeToolExecute(tool, { env = process.env, cwd } = {}) {
  return async (args, tctx = {}) => {
    const a = args && typeof args === 'object' ? args : {};
    const t = Number(a.timeout_s);
    const callS = tool === 'ask_session' || tool === 'send_message' ? (t > 0 ? Math.min(MAX_TIMEOUT_S, t) : DEFAULT_TIMEOUT_S) : 30;
    const argv = ['call', tool, '--opencode-caller', String(tctx.sessionID || '')];
    const r = await runBridge({
      args: argv,
      stdin: JSON.stringify(a),
      timeoutMs: (callS + 30) * 1000,
      signal: tctx.signal,
      env,
      cwd,
    });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `session-bridge call ${tool} failed (exit ${r.code})`);
    return textOf(r.stdout.trim() || '(no output)');
  };
}

// Run `session-bridge hook <event> --harness opencode`; returns the text to inject, or ''.
// Never throws.
export async function runHook(event, payload, { env = process.env, cwd } = {}) {
  try {
    const r = await runBridge({
      args: ['hook', event, '--harness', 'opencode'],
      stdin: JSON.stringify(payload),
      timeoutMs: HOOK_TIMEOUT_MS,
      env,
      cwd,
    });
    return r.code === 0 ? r.stdout.trim() : '';
  } catch {
    return '';
  }
}

export async function SessionBridge(ctx) {
  const c = ctx || {};
  try {
    await c.agent.transform(registerReader);
  } catch (e) {
    process.stderr.write(`session-bridge: could not register ${READER} — ${e?.message || e}\n`);
  }
  if (process.env[CHILD_ENV] === '1') return; // a fork never gets the tools: no recursion
  const dir = resolveDir(c);
  try {
    await c.tool.transform((T) => {
      for (const [name, def] of Object.entries(TOOLS)) {
        T.add({
          name,
          options: { namespace: 'session_bridge', codemode: false },
          description: def.description,
          input: { type: 'object', properties: def.properties, required: def.required },
          output: {},
          execute: makeToolExecute(name, { cwd: dir }),
        });
      }
    });
  } catch (e) {
    process.stderr.write(`session-bridge: could not register tools — ${e?.message || e}\n`);
  }

  const started = new Set();
  const reg = async (where, name, fn) => {
    try {
      await c[where].hook(name, fn);
    } catch (e) {
      process.stderr.write(`session-bridge: could not register ${where}.${name} — ${e?.message || e}\n`);
    }
  };
  await reg('session', 'context', async (event) => {
    try {
      const sid = String(event?.sessionID || '');
      if (!sid || !Array.isArray(event?.system)) return;
      const base = { session_id: sid, cwd: dir };
      const texts = [];
      if (!started.has(sid)) {
        if (started.size >= 500) started.delete(started.values().next().value);
        started.add(sid);
        texts.push(await runHook('session-start', { ...base, hook_event_name: 'SessionStart' }, { cwd: dir }));
      }
      texts.push(await runHook('prompt', { ...base, hook_event_name: 'UserPromptSubmit' }, { cwd: dir }));
      for (const text of texts) if (text) event.system.push({ type: 'text', text });
    } catch { /* fail open */ }
  });
  await reg('tool', 'execute.after', async (event) => {
    try {
      const sid = String(event?.sessionID || '');
      if (!sid) return;
      const text = await runHook('post-tool', {
        session_id: sid,
        cwd: dir,
        hook_event_name: 'PostToolUse',
        tool_name: String(event?.tool || ''),
        tool_input: event?.input && typeof event.input === 'object' ? event.input : {},
      }, { cwd: dir });
      const content = event?.result?.content;
      if (text && Array.isArray(content)) content.push({ type: 'text', text });
    } catch { /* fail open */ }
  });
}

export default { id: 'session-bridge', setup: SessionBridge };
