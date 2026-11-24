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
// Claude Code only. Not registered in hooks.json: the refusal changed no behaviour in 0 of 16
// measured runs (where-agents-listen). Add a PreToolUse entry for `Bash|mcp__codescout__run_command`
// to run it. CS_SCRIBE_NUDGE=false turns it off. Fail open: an error, a missing field or
// a marker that cannot be written lets the call through (lib.mjs FAIL-OPEN CONTRACT).
// Test knobs: CS_SCRIBE_STATE_DIR (marker directory) and CS_SCRIBE_WINDOW_MS.
import { statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInput, denyPreToolUse, sanitizeSessionId, shortHash } from './lib.mjs';
import { boxHelpWriteVerb, boxWriteVerb, COMPLEX_VERBS, MESSAGE_NO_EXIT, MESSAGE_THRESHOLD, SCRIBE_MESSAGE } from './scribe-rules.mjs';

// One refusal per session in practice: the replay of real sessions showed that a refusal after the
// agent has chosen to work inline buys nothing. The knob lets a test shorten it.
const WINDOW_MS = 24 * 60 * 60 * 1000;
// Experiment arms, CS_SCRIBE_VARIANT: a (default) the repeat exit; b no exit for complex verbs,
// standing down after this many refusals; c the exit with the threshold quoted; e arm b plus a
// refusal of the first help call for a write verb, which comes before the agent reads anything.
const STAND_DOWN_AFTER = 3;

function main() {
  const input = readInput();
  if (!input) return;
  if (process.env.CS_SCRIBE_NUDGE === 'false') return;
  if (input.tool_name !== 'Bash' && input.tool_name !== 'mcp__codescout__run_command') return;
  if (input.agent_id) return;
  const command = input.tool_input && input.tool_input.command;
  const variant = process.env.CS_SCRIBE_VARIANT || 'a';
  // Arm e also acts on `box help <write verb>`: the same verb, a step earlier.
  const verb = boxWriteVerb(command) || (variant === 'e' ? boxHelpWriteVerb(command) : null);
  if (!verb) return;

  const dir = process.env.CS_SCRIBE_STATE_DIR || tmpdir();
  const key = shortHash(sanitizeSessionId(input.session_id || ''));

  if ((variant === 'b' || variant === 'e') && COMPLEX_VERBS.includes(verb)) {
    // No repeat exit for a complex verb. Count the refusals so a harness without a fork is not stuck.
    const counter = join(dir, `cs-scribe-n-${key}`);
    let n = 0;
    try {
      n = Number(readFileSync(counter, 'utf8')) || 0;
    } catch {
      // no counter yet
    }
    if (n >= STAND_DOWN_AFTER) return;
    writeFileSync(counter, String(n + 1));
    denyPreToolUse(MESSAGE_NO_EXIT);
    return;
  }

  const marker = join(dir, `cs-scribe-${key}`);
  const windowMs = Number(process.env.CS_SCRIBE_WINDOW_MS) || WINDOW_MS;
  try {
    if (Date.now() - statSync(marker).mtimeMs < windowMs) return;
  } catch {
    // no marker yet: this is the first box write of the window
  }
  writeFileSync(marker, '');
  denyPreToolUse(variant === 'c' ? MESSAGE_THRESHOLD : SCRIBE_MESSAGE);
}

try {
  main();
} catch {
  // fail open
}
process.exit(0);
