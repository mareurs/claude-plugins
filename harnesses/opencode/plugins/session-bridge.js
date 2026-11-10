// session-bridge for OpenCode — list this machine's OpenCode sessions and ask one a question.
//
// WHAT CLAUDE CODE AND PI DO
//
// Claude Code's session-bridge is a Rust MCP server that answers by spawning
// `claude -p --resume <id> --fork-session …`. Pi's (harnesses/pi/extensions/
// session-bridge.ts) forks a Pi session read-only and throws the fork away. Each harness
// gets its own native bridge; neither can reach the other's sessions.
//
// WHAT THIS DOES
//
//   session_bridge_list_sessions  OpenCode's own session store, via ctx.session.list —
//                                 no registry file: OpenCode already knows every session.
//   session_bridge_ask_session    `opencode run --fork -s <id> --agent session-bridge-reader`
//                                 in the session's directory, then deletes the fork.
//
// READ-ONLY, FOR REAL. OpenCode's built-in `plan` agent is NOT read-only: on 2.1.3 its
// permissions are `* allow` with only `edit` denied, so it can still run shell commands
// (measured). The fork therefore runs under `session-bridge-reader`, registered here:
// everything denied, then the reading tools allowed. The producer session is never
// written: `--fork` copies it, and the copy is removed after the answer. Like Pi's bridge,
// there is no bidirectional mode.
//
// NO RECURSION. The forked run loads this plugin too. It sees OPENCODE_SESSION_BRIDGE_CHILD
// and registers the reader agent but not the tools, so a fork cannot ask another session.
import { spawn } from 'node:child_process';
import { resolveDir } from '../lib/host.mjs';

export const READER = 'session-bridge-reader';
export const CHILD_ENV = 'OPENCODE_SESSION_BRIDGE_CHILD';
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 600;
const OUTPUT_LIMIT = 1 << 20;

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

// The opencode binary to fork with. Inside the host, process.execPath IS opencode (a
// compiled Bun binary — the same fact that broke hook spawning in codescout-companion.js),
// which is exactly what is wanted here.
export function opencodeBin(execPath = process.execPath, env = process.env) {
  if (env.OPENCODE_SESSION_BRIDGE_BIN) return env.OPENCODE_SESSION_BRIDGE_BIN;
  const base = String(execPath || '').split(/[\\/]/).pop().toLowerCase();
  return /^opencode(\.exe)?$/.test(base) ? execPath : 'opencode';
}

const textOf = (r) => ({ output: r, content: [{ type: 'text', text: r }] });
const unwrap = (r) => r?.data ?? r;

// The first user message, as a label: the plugin API's session records carry no title.
async function labelOf(ctx, s) {
  try {
    const msgs = unwrap(await ctx.session.context({ sessionID: s.id }));
    const first = Array.isArray(msgs) ? msgs.find((m) => m?.type === 'user' || m?.role === 'user') : null;
    const text = first?.text ?? first?.content?.find?.((p) => p?.type === 'text')?.text ?? '';
    return String(text).replace(/\s+/g, ' ').trim().slice(0, 80);
  } catch {
    return '';
  }
}

export async function listSessions(ctx, { directory, limit = 20, includeChildren = false } = {}) {
  const all = unwrap(await ctx.session.list({ directory }));
  const rows = (Array.isArray(all) ? all : [])
    .filter((s) => includeChildren || !s.parentID)
    .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    .slice(0, Math.max(1, Math.min(100, limit)));
  for (const s of rows) s.label = await labelOf(ctx, s);
  return rows;
}

export function resolveRef(rows, ref) {
  const r = String(ref || '').trim();
  if (!r) throw new Error('ref is required: a session id, id prefix, or words from its first message');
  const exact = rows.find((s) => s.id === r);
  if (exact) return exact;
  const lc = r.toLowerCase();
  const hits = rows.filter((s) => s.id.startsWith(r) || (s.label && s.label.toLowerCase().includes(lc)));
  if (!hits.length) throw new Error(`no OpenCode session matches '${r}'`);
  if (hits.length > 1) throw new Error(`'${r}' is ambiguous: ${hits.map((s) => `${s.id} (${s.label || 'no label'})`).join(', ')}`);
  return hits[0];
}

// Run the fork and collect its answer. Resolves {answer, forkId}.
export function runFork({ bin, sessionId, directory, prompt, timeoutS, signal }) {
  return new Promise((resolveP, reject) => {
    const args = ['run', '--standalone', '--format', 'json', '--agent', READER, '--fork', '-s', sessionId, prompt];
    let child;
    try {
      child = spawn(bin, args, { cwd: directory, env: { ...process.env, [CHILD_ENV]: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out = (out + d).slice(-OUTPUT_LIMIT); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-OUTPUT_LIMIT); });
    const kill = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
    const timer = setTimeout(kill, timeoutS * 1000);
    signal?.addEventListener?.('abort', kill, { once: true });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', kill);
      let forkId = null;
      const texts = [];
      for (const line of out.split('\n')) {
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev?.sessionID && ev.sessionID !== sessionId && !forkId) forkId = ev.sessionID;
        if (ev?.type === 'text' && ev.part?.text?.trim()) texts.push(ev.part.text.trim());
      }
      if (signal?.aborted) return reject(Object.assign(new Error('ask cancelled'), { forkId }));
      if (code !== 0 && !texts.length) {
        return reject(Object.assign(new Error(`opencode fork failed (exit ${code}): ${(err || out).trim().slice(-800)}`), { forkId }));
      }
      resolveP({ answer: texts.at(-1) || '(the snapshot gave no text answer)', forkId });
    });
  });
}

export function buildSessionBridge(ctx, dir, { fork = runFork, bin = opencodeBin() } = {}) {
  return {
    async list(args = {}) {
      const rows = await listSessions(ctx, { directory: args.directory || dir, limit: args.limit, includeChildren: !!args.include_children });
      if (!rows.length) return textOf(`No OpenCode sessions in ${args.directory || dir}.`);
      const now = Date.now();
      const age = (t) => (t ? `${Math.round((now - t) / 60000)} min ago` : '?');
      return textOf(rows.map((s) => `${s.id}  ${age(s.time?.updated)}  ${s.label || '(no messages)'}`).join('\n'));
    },

    async ask(args = {}, tctx = {}) {
      const directory = args.directory || dir;
      const rows = await listSessions(ctx, { directory, limit: 100, includeChildren: true });
      const target = resolveRef(rows, args.ref);
      if (target.id === tctx.sessionID) throw new Error('that is this session — ask your own context instead');
      const prompt = String(args.prompt || '').trim();
      if (!prompt) throw new Error('prompt is required');
      const timeoutS = Math.max(1, Math.min(MAX_TIMEOUT_S, Number(args.timeout_s) || DEFAULT_TIMEOUT_S));
      let res;
      let forkId = null;
      try {
        res = await fork({ bin, sessionId: target.id, directory: target.location?.directory || directory, prompt, timeoutS, signal: tctx.signal });
        forkId = res?.forkId ?? null;
      } catch (e) {
        forkId = e?.forkId ?? null; // runFork attaches it, so a failed ask is cleaned up too
        throw e;
      } finally {
        // The fork is a full copy of the producer; never leave it behind.
        if (forkId && forkId !== target.id) {
          try { await ctx.session.remove({ sessionID: forkId }); } catch { /* best effort */ }
        }
      }
      return textOf(`[snapshot of ${target.id}${target.label ? ` — ${target.label}` : ''}]\n\n${res.answer}`);
    },
  };
}

export async function SessionBridge(ctx) {
  const c = ctx || {};
  try {
    await c.agent.transform(registerReader);
  } catch (e) {
    process.stderr.write(`session-bridge: could not register ${READER} — ${e?.message || e}\n`);
  }
  if (process.env[CHILD_ENV] === '1') return; // a fork never gets the tools: no recursion
  const b = buildSessionBridge(c, resolveDir(c));
  try {
    await c.tool.transform((T) => {
      T.add({
        name: 'list_sessions',
        options: { namespace: 'session_bridge', codemode: false },
        description: 'List OpenCode sessions on this machine for a project (default: the current one), newest first, with the first user message as a label.',
        input: {
          type: 'object',
          properties: {
            directory: { type: 'string', description: 'Project directory whose sessions to list. Default: the current project.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max sessions (default 20).' },
            include_children: { type: 'boolean', description: 'Also list subagent sessions.' },
          },
        },
        output: {},
        execute: (args) => b.list(args),
      });
      T.add({
        name: 'ask_session',
        options: { namespace: 'session_bridge', codemode: false },
        description: 'Ask another OpenCode session a question. It answers from a read-only fork of that session (it cannot edit, write or run commands); the original session is never modified and the fork is deleted afterwards.',
        input: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Session id, id prefix, or words from its first message.' },
            prompt: { type: 'string', description: 'The question for that session.' },
            directory: { type: 'string', description: 'Project directory of that session. Default: the current project.' },
            timeout_s: { type: 'integer', minimum: 1, maximum: MAX_TIMEOUT_S, description: 'Timeout in seconds (default 120).' },
          },
          required: ['ref', 'prompt'],
        },
        output: {},
        execute: (args, tctx) => b.ask(args, tctx),
      });
    });
  } catch (e) {
    process.stderr.write(`session-bridge: could not register tools — ${e?.message || e}\n`);
  }
}

export default { id: 'session-bridge', setup: SessionBridge };
