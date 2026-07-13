// codescout-companion/hooks/lib.mjs
// Shared helpers for the codescout-companion Node hooks. Node-only (no bash/jq),
// so hooks run on Windows and under GitHub Copilot without Git Bash.
//
// FAIL-OPEN CONTRACT: hooks must exit 0 even on error. Intended denials go
// through the JSON `permissionDecision` field (honored by Claude Code AND
// Copilot). A non-zero exit is never used to deny — on Copilot CLI a non-zero
// PreToolUse exit is itself a deny, so a crash would block the user's tool.
import { readFileSync } from 'node:fs';

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
