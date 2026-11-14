// Shared host plumbing for every OpenCode bridge in this directory (codescout-companion,
// sdd, legible, session-bridge). One copy of the parts that were learned the hard way:
// which binary runs a hook, how a hook failure is surfaced, how a hook answer is read, and
// which ctx key holds the project directory. Plugin entry files import this by a relative
// path; that works through install.sh's symlinks because the host loads each plugin by its
// real path (import.meta.url resolves into the repo — measured on 2.1.3).
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOOK_TIMEOUT_MS = 5000;

// Which binary runs the hook scripts. NOT blindly process.execPath: OpenCode ships as a
// compiled Bun executable, so inside the host execPath is `opencode.exe` itself, and
// spawning it with a script path ran `opencode <script>` — the CLI took the path as a
// project dir, died with ENOTDIR, printed nothing, and every guard call failed OPEN.
// Measured in opencode.log on 2.1.3. Under the unit tests execPath IS node, which is why
// they never saw it. Order: explicit override → execPath when it really is node/bun →
// `node` from PATH (install.sh already refuses to install without it).
export function resolveRuntime(execPath = process.execPath, env = process.env) {
  if (env.CS_COMPANION_NODE) return env.CS_COMPANION_NODE;
  const base = String(execPath || '').split(/[\\/]/).pop().toLowerCase();
  if (/^(node|nodejs|bun)(\.exe)?$/.test(base)) return execPath;
  return 'node';
}

// A hook that cannot run must fail OPEN — but never SILENTLY: live bug #2 (the opencode
// binary spawned as the interpreter) loaded clean, printed nothing and blocked nothing.
// Each failure kind is reported once per process on stderr (which lands in opencode.log),
// so a missing `node` on the service's PATH is visible instead of looking like "allowed".
const reported = new Set();
function reportOnce(label, kind, detail) {
  const key = `${label}:${kind}`;
  if (reported.has(key)) return;
  reported.add(key);
  process.stderr.write(`${label}: hook ${kind} — ${detail} (failing open)\n`);
}

// Async on purpose: the plugin runs inside the long-lived `opencode serve` process, and a
// spawnSync there froze the event loop for EVERY session for the length of the hook.
// CLAUDE_CONFIG_DIR is passed through unchanged: detect.mjs resolves Claude config via
// `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` (repo rule), and stripping it made a multi-profile
// machine read the default profile instead of the one in use.
//
// Built on runProcess (below), so a timeout ends the hook's whole process TREE: detect.mjs
// can start the codescout or sqlite3 binaries, and killing only `node <hook>` left them
// running. This used to be a second copy of the spawn, timeout and settle code that killed
// the direct child alone.
export async function runHook(script, payload, { forceArmed = false, runtime = resolveRuntime(), label = 'codescout-companion', timeoutMs = HOOK_TIMEOUT_MS } = {}) {
  const env = { ...process.env };
  if (forceArmed) env.CS_COMPANION_HOST_ARMED = '1';
  const res = await runProcess(runtime, [script], { input: JSON.stringify(payload), cwd: payload.cwd, env, timeoutMs, label });
  if (!res) return null; // spawn failure or timeout, already reported
  // The hooks' contract is "always exit 0"; anything else is a crash, not a decision.
  if (res.code !== 0) reportOnce(label, 'crashed', `${script} exited ${res.code}`);
  const text = res.stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    reportOnce(label, 'bad-output', `${script} printed non-JSON`);
    return null;
  }
}

export function decisionOf(payload) {
  const h = payload?.hookSpecificOutput;
  if (!h) return null;
  if (h.permissionDecision === 'deny') return { deny: h.permissionDecisionReason || 'blocked' };
  if (h.additionalContext) return { context: h.additionalContext };
  return null;
}

// Which project this bridge speaks for. Measured on the 2.1.3 binary: the setup shim
// (`pZ`) builds ctx as `{app, location, options, agent, …, worktree: {list, …}, …}`, and
// the host's own internal plugins read `e.location.directory`. So `location.directory`
// comes first — and every candidate must be a STRING, because v2 ctx carries API groups
// under names that used to be paths: `ctx.worktree` is the worktree *API*, an object.
// Returning it crashed setup with `ERR_INVALID_ARG_TYPE: "paths[0]" … got object` the
// first time the plugin got past the loader. The older v1 keys stay as fallbacks only.
export function resolveDir(ctx) {
  const c = ctx || {};
  const candidates = [
    c.location?.directory,
    c.location?.worktree,
    c.directory,
    c.worktree,
    c.app?.directory,
  ];
  return candidates.find((v) => typeof v === 'string' && v.length > 0) || process.cwd();
}

// The raw sibling of runHook, for hooks that do not answer in one JSON object. buddy's
// launcher (buddy/hooks/run.mjs) is one: SessionStart and UserPromptSubmit print PLAIN text
// that Claude Code injects as context, PostToolUse prints one JSON object per advisory line,
// and PreToolUse asks for a block by EXITING 2 with the reason on stderr. runHook can carry
// none of those (it parses one JSON object and drops stderr), so this returns
// {code, stdout, stderr} and leaves the reading to the bridge. Same failure rules: async,
// bounded by a timeout, a spawn failure or a timeout resolves null and is reported once.
// `onFail(kind)` ('spawn-failed' | 'timeout') tells a caller WHICH null it got: an
// interpreter fallback moves on after a spawn failure, but must not re-run a script that
// started and then timed out.
//
// A timeout ends the whole process TREE, not only the direct child. buddy's launcher
// (run.mjs) starts Python with spawnSync and inherited stdio, so killing `node run.mjs`
// alone orphaned the interpreter: it kept writing .buddy/<sid>/state.json while the next
// hook wrote the same file. POSIX: the child leads its own process group (detached) and the
// group is signalled. Windows: taskkill /T walks the tree.
const POSIX = process.platform !== 'win32';
function killTree(child) {
  try {
    if (!child.pid) throw new Error('no pid');
    if (POSIX) process.kill(-child.pid, 'SIGTERM');
    else spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
  } catch {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}
export function runProcess(command, args, { input = '', cwd, env = process.env, timeoutMs = HOOK_TIMEOUT_MS, label = 'opencode-bridge', onFail } = {}) {
  return new Promise((resolveP) => {
    let out = '';
    let err = '';
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolveP(v);
      }
    };
    const fail = (kind, detail) => {
      if (settled) return;
      reportOnce(label, kind, detail);
      try {
        onFail?.(kind);
      } catch {
        /* a caller's bookkeeping must not break the run */
      }
      done(null);
    };
    let child;
    try {
      child = spawn(command, args, { cwd: cwd || process.cwd(), env, stdio: ['pipe', 'pipe', 'pipe'], detached: POSIX });
    } catch (e) {
      return fail('spawn-failed', `${command}: ${e?.message || e}`);
    }
    const timer = setTimeout(() => {
      killTree(child);
      fail('timeout', `${args?.[0] ?? command} exceeded ${timeoutMs} ms`);
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      fail('spawn-failed', `${command}: ${e?.message || e}`);
    });
    child.stdout.on('data', (d) => {
      if (out.length < 1 << 20) out += d;
    });
    child.stderr.on('data', (d) => {
      if (err.length < 1 << 16) err += d;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ code: code ?? (signal ? -1 : 0), stdout: out, stderr: err });
    });
    child.stdin.on('error', () => {
      /* exited before reading stdin */
    });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

// OpenCode spells tool arguments in camelCase (edit: filePath/oldString/newString/
// replaceAll, measured from the tool descriptions); the Claude-side hooks read Claude Code's
// snake_case. Without the aliases, sdd's spec-guard never saw an edit's new text, so an edit
// writing `status: approved` was NOT denied on OpenCode (caught by test-sdd.mjs). The
// original keys stay, so nothing a hook already reads moves. Shared by sdd.js and buddy.js.
const CC_KEYS = { filePath: 'file_path', oldString: 'old_string', newString: 'new_string', replaceAll: 'replace_all' };
export function ccInput(input) {
  const out = { ...(input || {}) };
  for (const [oc, cc] of Object.entries(CC_KEYS)) {
    if (out[oc] !== undefined && out[cc] === undefined) out[cc] = out[oc];
  }
  if (Array.isArray(out.edits)) {
    out.edits = out.edits.map((e) => (e && typeof e === 'object' ? ccInput(e) : e));
  }
  return out;
}

// The bare codescout tool name in any spelling OpenCode may give an MCP tool, else null.
// Shared by codescout-companion.js (proof-of-life, guard routing) and buddy.js (the codescout
// log, heuristics and judge), so the two bridges agree on which calls are codescout's. Which
// spellings are accepted, and why the tolerance is safe: see codescout-companion.js.
const CODESCOUT_BARE = /^(?:mcp[._]+)?codescout[._/]+([a-z][a-z0-9_]*)$/i;
export function codescoutBareTool(name) {
  const m = CODESCOUT_BARE.exec(String(name || ''));
  return m ? m[1] : null;
}

// ── session family ─────────────────────────────────────────────────────────────────────
// `getSession(id)` resolves a session's info ({parentID?}), or throws, or (the SDK client's
// default) resolves {error} without data. parent(sid) resolves the parentID, null for a
// top-level session, or undefined when the lookup failed. Only ANSWERS are cached: a failed
// lookup is asked again next time. Caching `undefined` made one transient error permanent:
// for buddy a subagent then counted as top-level and rewrote .current_session_id, for sdd
// approvals stayed off for that session until the service restarted. Concurrent lookups of
// one id share one request. root(sid) climbs to the top of the family (the session Claude
// Code names as session_id); where a lookup fails it stops at the highest id it knows.
//
// A lookup that has not answered after `timeoutMs` is a failure, so it is not cached. The
// shared pending promise is what makes that necessary: one getSession that never settled
// (service busy or deadlocked) left a pending promise in `known`, and every later lookup of
// that session, so every buddy and sdd hook for it, waited on it forever.
export const SESSION_LOOKUP_TIMEOUT_MS = 3000;
export function sessionFamily(getSession, { timeoutMs = SESSION_LOOKUP_TIMEOUT_MS } = {}) {
  const known = new Map(); // session id → Promise<parentID | null>
  function parent(sid) {
    if (!known.has(sid)) {
      const lookup = Promise.resolve()
        .then(() => getSession(sid))
        .then((r) => {
          if (r && r.error && !r.data) throw r.error;
          return (r?.data ?? r)?.parentID ?? null;
        });
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`session lookup exceeded ${timeoutMs} ms`)), timeoutMs);
      });
      const p = Promise.race([lookup, late]).finally(() => clearTimeout(timer));
      known.set(sid, p);
      p.catch(() => {
        if (known.get(sid) === p) known.delete(sid);
      });
    }
    return known.get(sid).catch(() => undefined);
  }
  async function root(sid) {
    let cur = sid;
    for (let depth = 0; depth < 16; depth++) {
      const up = await parent(cur);
      if (!up) return cur;
      cur = up;
    }
    return cur;
  }
  return { parent, root };
}

// The context event's messages are `{id, role, content:[{type:"text", text}], …}` (measured
// for sdd.js). Returns the latest USER message, or null. Shared by sdd.js and buddy.js.
export function lastUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const text = Array.isArray(m.content)
      ? m.content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n')
      : typeof m.content === 'string' ? m.content : '';
    return { id: m.id ?? `idx-${i}`, text };
  }
  return null;
}

// ── hint-echo channel ──────────────────────────────────────────────────────────────────
// Claude Code's hint-echo mod shows the user the text a tool hook handed the MODEL. On
// OpenCode that text is pushed onto a tool result's `content` by the bridges, inside the
// background service, and the TUI that would show it is a different process. So every
// bridge that delivers an advisory also appends it here, and the hint-echo TUI plugin
// (harnesses/opencode/tui/hint-echo/) tails the file and shows each line as a toast.
//
// Off unless the directory exists: install.sh --plugins hint-echo creates it, and so does
// the TUI plugin at setup. Nothing here ever creates it, so without it nothing is written
// (appendFileSync into a missing dir fails with ENOENT, caught below); the existsSync check
// is only the cheap early exit — a mutation check confirmed removing it changes nothing.
// The file is rotated at 256 KiB (one .1 generation), so it cannot grow without bound.
//
// Private to the user: the lines hold file paths, shell commands and session ids from every
// project the service hosts. The dir is 0700 (ensureHintEchoDir, which also tightens a dir
// an older install made 0755) and the file is created 0600. With default modes, a 022 umask
// left both readable by every local user.
export const HINT_ECHO_MAX_BYTES = 256 * 1024;
export function hintEchoDir(env = process.env) {
  if (env.OPENCODE_HINT_ECHO_DIR) return env.OPENCODE_HINT_ECHO_DIR;
  const state = env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(state, 'opencode-hint-echo');
}
export function hintEchoFile(env = process.env) {
  return join(hintEchoDir(env), 'hints.jsonl');
}
// Creates the channel dir (turning the channel on) as 0700. Returns false when it cannot.
export function ensureHintEchoDir(env = process.env) {
  try {
    const dir = hintEchoDir(env);
    mkdirSync(dir, { recursive: true }); // parents keep their usual mode; the channel dir:
    chmodSync(dir, 0o700);
    return true;
  } catch {
    return false;
  }
}
export function echoHint({ sessionID = '', tool = '', source = '', text = '' } = {}, env = process.env) {
  try {
    if (!text || !existsSync(hintEchoDir(env))) return false;
    const file = hintEchoFile(env);
    try {
      if (statSync(file).size > HINT_ECHO_MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {
      /* no file yet */
    }
    appendFileSync(file, `${JSON.stringify({ ts: Date.now(), sessionID, tool, source, text })}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false; // an echo must never break the bridge that called it
  }
}
