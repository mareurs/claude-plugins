// codescout-companion/hooks/lib.mjs
// Shared helpers for the codescout-companion Node hooks. Node-only (no bash/jq),
// so hooks run on Windows and under GitHub Copilot without Git Bash.
//
// FAIL-OPEN CONTRACT: hooks must exit 0 even on error. Intended denials go
// through the JSON `permissionDecision` field (honored by Claude Code AND
// Copilot). A non-zero exit is never used to deny — on Copilot CLI a non-zero
// PreToolUse exit is itself a deny, so a crash would block the user's tool.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
// See docs/issues/2026-08-26-companion-blocks-bash-after-codescout-disconnect.md.
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
// guidance the server believes it already handed over. Keyed by BOTH
// session_id and tool_use_id (not session_id alone, like breakerFile above)
// because concurrent subagent dispatches share one session_id but each gets
// its own tool_use_id — matching PreToolUse/PostToolUse pairs for the SAME
// dispatch without colliding with a sibling dispatch's own snapshot.
// codescout:docs/issues/2026-08-26-subagent-guide-fetch-starves-parent.md
export function agentGuideSnapshotFile(sessionId, toolUseId) {
  if (!sessionId || !toolUseId) return null;
  const key = createHash('sha256')
    .update(`${sessionId}:${toolUseId}`)
    .digest('hex')
    .slice(0, 16);
  return join(tmpdir(), `cs-guide-snapshot-${key}`);
}
