// codescout-companion/hooks/lib.mjs
// Shared helpers for the codescout-companion Node hooks. Node-only (no bash/jq),
// so hooks run on Windows and under GitHub Copilot without Git Bash.
//
// FAIL-OPEN CONTRACT: hooks must exit 0 even on error. Intended denials go
// through the JSON `permissionDecision` field (honored by Claude Code AND
// Copilot). A non-zero exit is never used to deny — on Copilot CLI a non-zero
// PreToolUse exit is itself a deny, so a crash would block the user's tool.
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { detect } from './detect.mjs';

// Read the hook event JSON from stdin. Returns null on empty/parse error.
export function readInput() {
  try {
    const raw = readFileSync(0, 'utf8'); // fd 0 = stdin
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// PreToolUse hard block with a reason.
export function denyPreToolUse(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

// PreToolUse advisory context injection (the call still proceeds).
export function contextPreToolUse(context) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: context,
    },
  });
}

// --- Redirect circuit breaker: shared state key -------------------------
//
// pre-tool-guard's whole contract is "don't use X, use codescout Y instead".
// That contract is VOID the moment Y is unreachable: an MCP disconnect removes
// every codescout tool from the tool list while leaving the guard armed, so the
// deny reason names tools that cannot be called and the session loses every
// route to a shell at once — including the ones needed to diagnose it.
// See docs/issues/archive/2026-08-26-companion-blocks-bash-after-codescout-disconnect.md.
//
// Detection is by PROOF OF LIFE, not by polling the server: cs-liveness.mjs
// (PostToolUse on the codescout tool names) clears the counter whenever any
// codescout tool answers. An error payload still counts — what is measured is
// whether the tool surface is REACHABLE, not whether the call succeeded.
// Consecutive denies with no codescout answer in between are the evidence that
// the redirect is going nowhere.
//
// Returns null when there is no session id, which DISABLES the breaker. That is
// deliberate: a cwd-keyed counter would be shared by two concurrent sessions in
// the same repo, so one session's denies would stand down the other's guard.
export function breakerFile(sessionId) {
  if (!sessionId) return null;
  const key = createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 12);
  return join(tmpdir(), `cs-redirect-${key}`);
}


// Run codescout detection for a cwd, resolving home/config-dir from env
// (cross-platform: HOME on POSIX, USERPROFILE/os.homedir() on Windows).
export function detectFor(cwd) {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  try {
    return detect(cwd || process.cwd(), home, process.env.CLAUDE_CONFIG_DIR || null);
  } catch {
    // Fail-open: any detection error → behave as if codescout is absent so the
    // hook exits 0 without denying. A crash must never block the user's tool
    // (on Copilot CLI a non-zero PreToolUse exit is itself a deny). Every hook
    // gates on HAS_CODESCOUT/BLOCK_READS before doing anything else.
    return { HAS_CODESCOUT: 'false', BLOCK_READS: 'false' };
  }
}

// `git -C <cwd> <args...>` → trimmed stdout, or null on error / non-zero exit.
export function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// One-shot, session-scoped skill pointer. Emits the hint the first time for
// <topic> this session (touching a marker); emits {} otherwise. Mirrors
// skill-hints.sh: marker at <cwd>/.buddy/<sessionId>/hint-emitted-<topic>.
export function emitSkillHint(cwd, sessionId, topic, hint) {
  if (!sessionId || !cwd) {
    emit({});
    return;
  }
  const markerDir = join(cwd, '.buddy', sessionId);
  const marker = join(markerDir, `hint-emitted-${topic}`);
  if (existsSync(marker)) {
    emit({});
    return;
  }
  try {
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(marker, '');
  } catch {
    /* best-effort */
  }
  emit({ hookSpecificOutput: { additionalContext: hint } });
}

// --- Guide-hints ledger path: mirrors codescout's own resolution --------
//
// codescout's src/tools/guide_ledger.rs persists the get_guide auto-inject
// ledger at <state_dir>/codescout/guide_hints/<sanitize(session_id)>.json.
// Both sides MUST agree on this path, or a snapshot/restore hook silently
// operates on the wrong file. `sanitizeSessionId` mirrors guide_ledger.rs's
// `sanitize()` char-for-char: anything outside [A-Za-z0-9_-] becomes '_'.
export function sanitizeSessionId(sessionId) {
  return String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_');
}

// XDG basedir spec: a relative XDG_STATE_HOME must be treated as unset —
// mirrors src/util/fs.rs's state_dir_from() (see session-start.mjs's
// identical rendezvous-dir resolution), so both sides agree on which
// directory they mean rather than silently looking in different places.
export function guideLedgerPath(sessionId, home) {
  if (!sessionId) return null;
  const xdgStateHome = process.env.XDG_STATE_HOME;
  const stateHome = xdgStateHome && isAbsolute(xdgStateHome) ? xdgStateHome : join(home, '.local', 'state');
  return join(stateHome, 'codescout', 'guide_hints', `${sanitizeSessionId(sessionId)}.json`);
}

// --- Agent-dispatch guide-ledger snapshot: shared state key -------------
//
// A subagent shares its parent's Claude Code session_id (no separate MCP
// identity exists for it), so the guide_hints ledger above is one keyspace
// for both. A subagent's own first get_guide-triggering tool call marks a
// topic delivered FOR THE WHOLE SESSION, silently starving the parent of
// guidance the server believes it already handed over.
// codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md
//
// SCOPE, measured 2026-08-27: the bracket these helpers serve does NOT undo
// that starvation within the session it runs in. codescout loads the ledger
// once, at server construction, and the in-memory map is authoritative for the
// process's life — `persist` is deliberately not read-modify-write — so a hook's
// file edit is invisible to the running server. The bracket's real benefit is
// the NEXT server: a reconnect loads the file, and a cleaned one starts without
// the subagent's marks. Everything below is correct file-state engineering for
// that narrower purpose.
// docs/issues/archive/2026-08-27-guide-ledger-bracket-is-inert-within-its-own-session.md
//
// Keyed by BOTH session_id and agent_id: concurrent subagent dispatches
// share one session_id, so session_id alone (like breakerFile above) would
// let siblings clobber each other's snapshot.
//
// agent_id, NOT tool_use_id. The bracket runs SubagentStart -> SubagentStop,
// which is the AGENT lifecycle; tool_use_id belongs to the TOOL lifecycle
// (PreToolUse/PostToolUse:Agent) and is absent from both agent events. The
// two lifecycles share no identifier at all, and they are not the same
// interval: measured 2026-08-27, PostToolUse:Agent fires in the SAME
// MILLISECOND as SubagentStart, ~17s before the subagent finishes, because
// Agent dispatch is asynchronous and the tool call returns at launch.
// docs/issues/archive/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md
//
// The session hash and the agent hash are SEPARATE segments, rather than one
// hash of "session:agent" as shipped in 1.19.0, because restore has to consult
// its live SIBLINGS and a single combined hash cannot be globbed by session.
// docs/issues/archive/2026-08-27-concurrent-subagent-restores-discard-parent-guide-marks.md
const SNAP_PREFIX = 'cs-guide-snapshot-';

// Debris from a crashed session: the only deleter is a SubagentStop that may
// never have fired, so nothing else ever collects these.
const SNAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function shortHash(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

export function agentGuideSnapshotPrefix(sessionId) {
  if (!sessionId) return null;
  return `${SNAP_PREFIX}${shortHash(sessionId)}-`;
}

export function agentGuideSnapshotFile(sessionId, agentId) {
  if (!sessionId || !agentId) return null;
  return join(tmpdir(), `${agentGuideSnapshotPrefix(sessionId)}${shortHash(agentId)}`);
}

// --- Snapshot payload ----------------------------------------------------
//
// A snapshot records the ledger's KEY SET at SubagentStart, not the ledger's
// bytes. Restore is SUBTRACTIVE — it removes the keys that appeared during
// this agent's lifetime — so it never writes a stamp back, and every
// surviving topic keeps the parent's real delivery time. (The 1.19.0 restore
// overwrote the whole file, rewinding every stamp to snapshot time, which is
// the input to codescout's idle-expiry.)
//
// `done` marks a snapshot whose agent has already stopped. It is retained
// rather than deleted while any sibling is still live, because "key K existed
// when agent X started" stays true forever and a later-finishing sibling
// still needs to consult it.
export function encodeGuideSnapshot(keys, done = false) {
  return JSON.stringify({ v: 1, keys: [...new Set(keys)].sort(), done: !!done });
}

// Tolerates every shape a snapshot file has ever had, so a mid-session plugin
// upgrade degrades to a slightly stale key set rather than to a crash:
//   {v:1,keys:[…],done:bool}   current
//   "__ABSENT__"               1.19.0 sentinel for "no ledger at dispatch"
//   {"topic":"<stamp>", …}     1.19.0 raw ledger bytes
//   ["topic", …]               codescout's own legacy ledger shape
// Returns null only when the text is none of them.
export function decodeGuideSnapshot(text) {
  const raw = String(text ?? '');
  if (raw === '__ABSENT__') return { keys: [], done: false };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { keys: parsed.map(String), done: false };
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.keys)) return { keys: parsed.keys.map(String), done: !!parsed.done };
      return { keys: Object.keys(parsed), done: false };
    }
  } catch {
    /* fall through */
  }
  return null;
}

// The ledger's own on-disk shapes, mirroring guide_ledger.rs's `LedgerFile`:
// a JSON object of topic -> RFC3339 stamp, or the legacy bare array. An
// unparseable file yields no keys — which is what read_entries() does too.
export function guideLedgerKeys(text) {
  try {
    const parsed = JSON.parse(String(text ?? ''));
    if (Array.isArray(parsed)) return parsed.map(String);
    if (parsed && typeof parsed === 'object') return Object.keys(parsed);
  } catch {
    /* an empty ledger, same as guide_ledger.rs's read_entries */
  }
  return [];
}

// Every snapshot for this session except `selfPath`. Best-effort in every
// direction: an unreadable or unparseable sibling contributes nothing rather
// than aborting the restore, since losing one sibling's evidence costs a
// re-injected guide while aborting costs the whole undo.
export function listSiblingGuideSnapshots(sessionId, selfPath, now = Date.now()) {
  const prefix = agentGuideSnapshotPrefix(sessionId);
  if (!prefix) return [];
  const dir = tmpdir();
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const path = join(dir, name);
    if (path === selfPath) continue;
    try {
      if (now - statSync(path).mtimeMs > SNAP_MAX_AGE_MS) {
        unlinkSync(path);
        continue;
      }
      const snap = decodeGuideSnapshot(readFileSync(path, 'utf8'));
      if (snap) out.push({ path, ...snap });
    } catch {
      /* best-effort */
    }
  }
  return out;
}

// Marker for the mis-wiring diagnostic below. Exported so the hook tests can
// assert on it rather than on prose that a later edit would silently reword.
export const MISWIRED_MARKER = 'cs-guide-bracket-miswired';

// The agent-lifecycle bracket — agent-guide-snapshot.mjs on SubagentStart,
// agent-guide-restore.mjs on SubagentStop — is keyed by agent_id. Tool-lifecycle
// payloads (PreToolUse/PostToolUse with matcher Agent) carry tool_use_id and NO
// agent_id, so a hook wired to the wrong event has nothing to key on.
//
// This is the structural gate for exactly that mis-wiring, and it exists because
// the previous wiring was wrong for a week and nothing could tell. Restore was on
// PostToolUse:Agent, which fires in the same millisecond as SubagentStart — ~17s
// before the subagent finishes, since Agent dispatch is async and the tool call
// returns at launch. Its only observable was an absent snapshot file, which is
// ALSO what correct, already-completed operation looks like: one reading, six
// causes. A green test suite sat on top of it the whole time.
//
// So: refuse to guess, and say so on stderr. Still fail-open — a hook that
// blocked a dispatch over its own misconfiguration would be a worse bug than the
// one it guards.
// docs/issues/archive/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md
export function agentIdOrComplain(input, hookName) {
  const agentId = input.agent_id || '';
  if (!agentId) {
    process.stderr.write(
      `${MISWIRED_MARKER}: ${hookName} received hook_event_name=` +
        `${input.hook_event_name || '?'} with no agent_id. It must be wired to an ` +
        `agent lifecycle event (SubagentStart / SubagentStop), not a tool event. ` +
        `Doing nothing.\n`
    );
  }
  return agentId;
}

// ── Rendezvous liveness stamp ────────────────────────────────────────────────
//
// INSTRUMENTATION ONLY. Nothing in codescout gates on this yet, deliberately.
//
// The server's `/clear`-detection gate latches open on the first SessionStart
// stamp and never closes, so a companion that goes quiet mid-process leaves a
// conversation change invisible. The obvious remedy — expire the gate when
// `hook_at` gets old — was refuted by measurement: the companion stamps ONLY on
// SessionStart, so `hook_at` records "when did this conversation last start or
// resume", not "is the hook still answering". Measured 2026-08-27 across four
// healthy stamped slots, `hook_at` predated its own server's start by 5.9-10.0
// hours in every case (an `/mcp` reconnect inherits the predecessor's stamp), so
// no threshold on it can separate a dead hook from a long conversation.
//
// This creates the missing quantity and gates nothing on it. After it has been
// deployed a while, `hook_at` age becomes time-since-last-proof-of-life, and the
// frequency question ("does a hook ever actually go quiet?") becomes answerable
// with data instead of argument.
//
// codescout:docs/issues/2026-08-19-rendezvous-gate-latches-open-when-the-hook-goes-quiet.md
const LIVENESS_THROTTLE_MS = 60_000;

/// Refresh `hook_at` on rendezvous slots owned by our own process ancestry.
///
/// Two invariants make this a no-op for behaviour, and both are load-bearing:
///
/// 1. **Never opens the gate.** A slot with `hook_at: null` is skipped. The
///    server reads any non-null `hook_at` as "a companion is present"
///    (`Rendezvous::poll` sets `active = true` on it), so stamping an unstamped
///    slot would flip a session from the blunt-clear path to the surgical one —
///    a real behaviour change. Measured 2026-08-27: 3 of 7 live slots were
///    unstamped, so that is not a hypothetical population. Opening the gate
///    stays SessionStart's job.
/// 2. **Never writes `session`.** Doing so would make a `/clear` visible without
///    a SessionStart, which would FIX the latch bug rather than measure it —
///    out of scope until the frequency data says it is worth the change.
///
/// Throttled to one write per minute per slot: the server's `poll()` skips
/// read+parse on an unchanged mtime, so an unthrottled stamp would turn a
/// metadata-only check into a parse on every tool call. A repeated stamp of the
/// same session is already silent server-side
/// (`poll_ignores_a_stamp_repeating_the_session_we_already_have`), which is what
/// makes the extra writes safe.
export function refreshLivenessStamp(now = Date.now()) {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || homedir();
    const xdgStateHome = process.env.XDG_STATE_HOME;
    const stateHome = xdgStateHome && isAbsolute(xdgStateHome)
      ? xdgStateHome
      : join(home, '.local', 'state');
    const rvDir = join(stateHome, 'codescout', 'servers');
    if (!existsSync(rvDir)) return;
    const ancestry = ownAncestry();
    for (const name of readdirSync(rvDir)) {
      if (!name.endsWith('.json')) continue;
      const f = join(rvDir, name);
      try {
        const e = JSON.parse(readFileSync(f, 'utf8'));
        if (!ancestry.has(e.ppid)) continue;
        if (!e.hook_at) continue;            // invariant 1 — never open the gate
        const age = now - Date.parse(e.hook_at);
        if (age >= 0 && age < LIVENESS_THROTTLE_MS) continue;
        e.hook_at = new Date(now).toISOString();
        // Atomic: stage beside the target, then rename. A bare write let the
        // server's poll land mid-write and read truncated JSON.
        const tmp = `${f}.tmp`;
        writeFileSync(tmp, JSON.stringify(e));
        renameSync(tmp, f);
      } catch {
        /* skip unreadable, unparseable, or concurrently-removed slots */
      }
    }
  } catch {
    /* best-effort — never let the rendezvous break a hook */
  }
}

// Our own pid chain, capped at 10 hops: a corrupt or cyclic chain must not spin
// inside a hook. Mirrors session-start.mjs's copy; kept separate so the
// load-bearing SessionStart path is untouched by this instrumentation.
function ownAncestry() {
  const seen = new Set();
  let pid = process.pid;
  for (let hop = 0; hop < 10; hop++) {
    if (pid <= 1 || seen.has(pid)) break;
    seen.add(pid);
    const parent = parentOf(pid);
    if (parent === null) break;
    pid = parent;
  }
  return seen;
}

function parentOf(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ppid = Number.parseInt(rest[1], 10);
      return Number.isNaN(ppid) ? null : ppid;
    }
    const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2000,
    });
    const ppid = Number.parseInt(out.trim(), 10);
    return Number.isNaN(ppid) ? null : ppid;
  } catch {
    return null;
  }
}
