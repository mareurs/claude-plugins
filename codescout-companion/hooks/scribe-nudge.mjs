// PreToolUse hook — refuse the main agent's first `codescout box` write in a window, once, and
// name the scribe fork that can file it while the agent keeps working.
//
// The signal is the edit call itself: a Bash or codescout run_command whose command runs
// `codescout box` with a write verb (scribe-rules.mjs). The hook does not guess when a finding
// appears. A fork or subagent carries `agent_id` in the payload and the main thread does not
// (measured 2026-11-02, see pre-tool-guard.mjs), so the scribe fork's own box writes are never
// refused. The refusal comes once per session and window: the first call claims a marker file,
// and a repeat inside the window passes. A one-line note repeats the call; a larger edit forks.
//
// Claude Code only. CS_SCRIBE_NUDGE=false turns it off. Fail open: an error, a missing field or
// a marker that cannot be written lets the call through (lib.mjs FAIL-OPEN CONTRACT).
// Test knobs: CS_SCRIBE_STATE_DIR (marker directory) and CS_SCRIBE_WINDOW_MS.
import { statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInput, denyPreToolUse, sanitizeSessionId, shortHash } from './lib.mjs';
import { boxWriteVerb, SCRIBE_MESSAGE } from './scribe-rules.mjs';

const WINDOW_MS = 30 * 60 * 1000;

function main() {
  const input = readInput();
  if (!input) return;
  if (process.env.CS_SCRIBE_NUDGE === 'false') return;
  if (input.tool_name !== 'Bash' && input.tool_name !== 'mcp__codescout__run_command') return;
  if (input.agent_id) return;
  if (!boxWriteVerb(input.tool_input && input.tool_input.command)) return;

  const dir = process.env.CS_SCRIBE_STATE_DIR || tmpdir();
  const marker = join(dir, `cs-scribe-${shortHash(sanitizeSessionId(input.session_id || ''))}`);
  const windowMs = Number(process.env.CS_SCRIBE_WINDOW_MS) || WINDOW_MS;
  try {
    if (Date.now() - statSync(marker).mtimeMs < windowMs) return;
  } catch {
    // no marker yet: this is the first box write of the window
  }
  writeFileSync(marker, '');
  denyPreToolUse(SCRIBE_MESSAGE);
}

try {
  main();
} catch {
  // fail open
}
process.exit(0);
