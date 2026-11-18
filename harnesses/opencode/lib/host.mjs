// Shared host plumbing for every OpenCode bridge in this directory (codescout-companion,
// sdd, legible, session-bridge). One copy of the parts that were learned the hard way:
// which binary runs a hook, how a hook failure is surfaced, how a hook answer is read, and
// which ctx key holds the project directory. Plugin entry files import this by a relative
// path; that works through install.sh's symlinks because the host loads each plugin by its
// real path (import.meta.url resolves into the repo — measured on 2.1.3).
import { spawn } from 'node:child_process';

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
export function runHook(script, payload, { forceArmed = false, runtime = resolveRuntime(), label = 'codescout-companion' } = {}) {
  return new Promise((resolveP) => {
    const env = { ...process.env };
    if (forceArmed) env.CS_COMPANION_HOST_ARMED = '1';
    let out = '';
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolveP(v);
      }
    };
    let child;
    try {
      child = spawn(runtime, [script], { cwd: payload.cwd || process.cwd(), env, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      reportOnce(label, 'spawn-failed', `${runtime}: ${e?.message || e}`);
      return done(null);
    }
    const timer = setTimeout(() => {
      reportOnce(label, 'timeout', `${script} exceeded ${HOOK_TIMEOUT_MS} ms`);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      done(null);
    }, HOOK_TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reportOnce(label, 'spawn-failed', `${runtime}: ${e?.message || e}`);
      done(null);
    });
    child.stdout.on('data', (d) => {
      if (out.length < 1 << 20) out += d;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // The hooks' contract is "always exit 0"; anything else is a crash, not a decision.
      if (code !== 0) reportOnce(label, 'crashed', `${script} exited ${code ?? signal}`);
      const text = out.trim();
      if (!text) return done(null);
      try {
        done(JSON.parse(text));
      } catch {
        reportOnce(label, 'bad-output', `${script} printed non-JSON`);
        done(null);
      }
    });
    child.stdin.on('error', () => {
      /* hook exited before reading stdin — its exit code tells the story */
    });
    child.stdin.end(JSON.stringify(payload));
  });
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
