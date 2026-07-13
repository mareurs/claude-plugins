// codescout-companion/hooks/lib.mjs
// Shared helpers for the codescout-companion Node hooks. Node-only (no bash/jq),
// so hooks run on Windows and under GitHub Copilot without Git Bash.
//
// FAIL-OPEN CONTRACT: hooks must exit 0 even on error. Intended denials go
// through the JSON `permissionDecision` field (honored by Claude Code AND
// Copilot). A non-zero exit is never used to deny — on Copilot CLI a non-zero
// PreToolUse exit is itself a deny, so a crash would block the user's tool.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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

// Run codescout detection for a cwd, resolving home/config-dir from env
// (cross-platform: HOME on POSIX, USERPROFILE/os.homedir() on Windows).
export function detectFor(cwd) {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return detect(cwd || process.cwd(), home, process.env.CLAUDE_CONFIG_DIR || null);
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
