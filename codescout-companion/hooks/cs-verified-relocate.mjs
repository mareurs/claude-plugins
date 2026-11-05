// codescout-companion/hooks/cs-verified-relocate.mjs
// PostToolUse (matcher mcp__codescout__.*): when a codescout result carries a
// top-level `advice` whose `verified` is the boolean `true`, remove `advice` from
// that one content block and deliver its text as `[cs-verified] <text>` hook
// context. In every other case print NOTHING (zero bytes) and exit 0.
//
// Contract (measured on Claude Code 2.1.318 and 2.1.311, see
// contracts/fixtures/cs-verified/results.md):
// - Host gate: the CLI sets CLAUDE_CODE_SESSION_ID over an inherited value and it
//   equals stdin `session_id`; CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, AI_AGENT and
//   CLAUDE_PLUGIN_ROOT are constant or inheritable and are not used.
// - `tool_response` is a list of content blocks; every block other than the one
//   holding the advice is echoed unchanged and in order.
// - Never `{}`, never exit 2, never stderr: exit 2 leaks hook text to the model.
// - The CLI stores hook stdout verbatim in the transcript; the size cap below
//   bounds that, and the input is never echoed when not acting.
//
// The hook never re-derives "verified": it reads the server's flag only.
// It changes nothing but the one block's text and, in it, the top-level `advice`.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readInput, emit } from './lib.mjs';

export const MARKER = '[cs-verified]';
export const MAX_ADVICE_CHARS = 1000; // code points
// Serialised size of `tool_response` above which the hook does nothing; the
// output repeats every block, so this also bounds what lands in the transcript.
export const MAX_TOOL_RESPONSE_CHARS = 256 * 1024;

// Cc (C0, DEL, C1: newline, \r, tab, NEL ...), Zl (U+2028), Zp (U+2029), Cs (a lone
// surrogate), and the bidi embedding/override (U+202A-U+202E) and isolate
// (U+2066-U+2069) controls. The text can carry a path or a symbol name from the
// user's code: refuse it rather than clean it.
const UNPRINTABLE = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}\u202A-\u202E\u2066-\u2069]/u;
// A canonical array index: JS orders such keys first, so a JSON round-trip moves them.
const INTEGER_LIKE_KEY = /^(?:0|[1-9][0-9]*)$/;
// `JSON.stringify(obj, null, 2)` layout (also serde's to_string_pretty and
// python's indent=2): an object whose first member is on its own line, 2 spaces in.
const PRETTY_2 = /^\{\n {2}"/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function hostGate(input, env) {
  return input.hook_event_name === 'PostToolUse' &&
    typeof input.session_id === 'string' &&
    input.session_id !== '' &&
    !!env && env.CLAUDE_CODE_SESSION_ID === input.session_id;
}

// True when JSON.parse -> JSON.stringify would not give back the same fields:
// an integer-like key (reordered) or a number outside the safe-integer range
// (precision already lost), an infinite number, or -0 (printed as 0).
// Recursive: a value nested deeper than the stack throws RangeError, which main
// turns into "print nothing".
function roundTripUnsafe(value) {
  if (typeof value === 'number') {
    return !Number.isFinite(value) || Object.is(value, -0) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.some(roundTripUnsafe);
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (INTEGER_LIKE_KEY.test(key) || roundTripUnsafe(value[key])) return true;
    }
  }
  return false;
}

function adviceTextOk(text) {
  if (typeof text !== 'string' || text.trim() === '') return false;
  if ([...text].length > MAX_ADVICE_CHARS) return false;
  if (UNPRINTABLE.test(text)) return false;
  if (text.toLowerCase().includes(MARKER)) return false;
  return true;
}

// The parsed JSON object of a text block, or null.
function parsedObject(block) {
  if (!isPlainObject(block) || block.type !== 'text' || typeof block.text !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return null;
  }
  return isPlainObject(parsed) ? parsed : null;
}

export function relocateVerifiedAdvice(input, env = process.env) {
  if (!isPlainObject(input) || !hostGate(input, env)) return null;
  const blocks = input.tool_response;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  if (JSON.stringify(blocks).length > MAX_TOOL_RESPONSE_CHARS) return null;

  // Exactly one block may carry a top-level `advice` (of any shape).
  let idx = -1;
  let obj = null;
  for (let i = 0; i < blocks.length; i++) {
    const parsed = parsedObject(blocks[i]);
    if (parsed === null || !Object.hasOwn(parsed, 'advice')) continue;
    if (idx !== -1) return null;
    idx = i;
    obj = parsed;
  }
  if (idx === -1) return null;

  const advice = obj.advice;
  if (!isPlainObject(advice) || advice.verified !== true || !adviceTextOk(advice.text)) return null;
  // The output re-serialises every block, and the edited block's JSON.
  if (roundTripUnsafe(blocks) || roundTripUnsafe(obj)) return null;

  const original = blocks[idx].text;
  const rest = { ...obj };
  delete rest.advice;
  const text = PRETTY_2.test(original) ? JSON.stringify(rest, null, 2) : JSON.stringify(rest);

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: blocks.map((b, i) => (i === idx ? { ...b, text } : b)),
      additionalContext: `${MARKER} ${advice.text}`,
    },
  };
}

async function main() {
  const out = relocateVerifiedAdvice(readInput());
  if (out) emit(out);
}

// Run only as the entry point, not when imported by tests. realpath: node resolves
// symlinks for the main module's import.meta.url but not for argv[1].
let isEntryPoint = false;
try {
  isEntryPoint = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch {
  isEntryPoint = false;
}
if (isEntryPoint) {
  // Fail-open for anything main().catch cannot see: an async stderr error, a throw in a timer.
  process.on('uncaughtException', () => process.exit(0));
  main().catch(() => process.exit(0));
}
