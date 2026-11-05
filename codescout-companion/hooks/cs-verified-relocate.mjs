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
// - Only the codescout server is trusted to say "verified": the tool name must
//   start with exactly `mcp__codescout__`.
// - `tool_response` is a list of content blocks; every block other than the one
//   holding the advice is echoed unchanged and in order.
// - Never `{}`, never exit 2, never stderr: exit 2 leaks hook text to the model.
// - The CLI stores hook stdout verbatim in the transcript; the size cap below
//   bounds that, and the input is never echoed when not acting.
//
// The hook never re-derives "verified": it reads the server's flag only.
// It changes nothing but the one block's text and, in it, the top-level `advice`.
//
// Accepted limits of the JSON.parse/JSON.stringify edit:
// - Duplicate keys: JSON.parse keeps the last one, so a block with two `advice`
//   keys is judged on the last. serde (the codescout server) never emits duplicates.
// - Numbers are re-printed by JS: field-equal as IEEE doubles (1.0 becomes 1,
//   1E5 becomes 100000). Values a round-trip would change are refused (see
//   roundTripUnsafe).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readInput, emit } from './lib.mjs';

export const MARKER = '[cs-verified]';
export const CODESCOUT_TOOL_PREFIX = 'mcp__codescout__';
export const MAX_ADVICE_CHARS = 1000; // code points
// Size of `JSON.stringify(tool_response)` above which the hook does nothing,
// counted in UTF-16 code units (String length), not bytes. The output repeats
// every block, so this also bounds what lands in the transcript.
export const MAX_TOOL_RESPONSE_CHARS = 256 * 1024;

// The advice text is relocated into context the user endorses, and it can carry a
// path or a symbol name from the user's code: refuse it rather than clean it.
// Refused:
// - Cc (C0, DEL, C1: newline, \r, tab, NEL), Cf (format: zero-width, bidi
//   controls, BOM, soft hyphen, TAG characters U+E0000-E007F, U+FFF9-FFFB),
//   Co (private use), Cn (unassigned and noncharacters), Cs (a lone surrogate),
//   Zl (U+2028), Zp (U+2029);
// - Default_Ignorable_Code_Point (variation selectors, CGJ, Hangul fillers ...);
// - U+2800 BRAILLE PATTERN BLANK (renders as nothing, not ignorable);
// - every Zs space separator except U+0020 (NBSP, U+3000, em space, U+1680);
// - nine or more combining marks in a row (a mark flood).
// Known cost, accepted: ZWJ emoji sequences, emoji with VS16, subdivision flags,
// Persian/Indic text that needs ZWNJ/ZWJ, NBSP or ideographic spaces and
// private-use glyph names in a path all make the advice stay in the result,
// unendorsed. Plain and skin-tone emoji, accented, CJK, Devanagari, Hangul, Thai
// and Arabic text pass.
const UNPRINTABLE =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u{2800}]|[^\P{Zs} ]|\p{M}{9}/u;
// Visible authority spoofing, checked on the NFKC + lower-case form so fullwidth
// or compatibility look-alikes are caught. `<` and `>` alone stay allowed
// (generics in Rust/C++ names).
const SPOOF_MARKS = ['[cs-', 'system-reminder'];
// A canonical array index: JS orders such keys first, so a JSON round-trip moves them.
const INTEGER_LIKE_KEY = /^(?:0|[1-9][0-9]*)$/;
// `JSON.stringify(obj, null, 2)` layout (also serde's to_string_pretty and
// python's indent=2): an object whose first member is on its own line, 2 spaces in.
const PRETTY_2 = /^\{\n {2}"/;

// A JSON object as JSON.parse produces it: not null, not an array.
const isJsonObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function hostGate(input, env) {
  return input.hook_event_name === 'PostToolUse' &&
    typeof input.tool_name === 'string' &&
    input.tool_name.startsWith(CODESCOUT_TOOL_PREFIX) &&
    typeof input.session_id === 'string' &&
    input.session_id !== '' &&
    env.CLAUDE_CODE_SESSION_ID === input.session_id;
}

// True when JSON.parse -> JSON.stringify would not give back the same fields:
// an integer-like key (reordered) or a number outside the safe-integer range
// (precision already lost), an infinite number, or -0 (printed as 0).
// Recursive: a value nested deeper than the stack throws RangeError, which
// relocateVerifiedAdvice turns into null.
function roundTripUnsafe(value) {
  if (typeof value === 'number') {
    return !Number.isFinite(value) || Object.is(value, -0) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value));
  }
  if (Array.isArray(value)) return value.some(roundTripUnsafe);
  if (isJsonObject(value)) {
    for (const key of Object.keys(value)) {
      if (INTEGER_LIKE_KEY.test(key) || roundTripUnsafe(value[key])) return true;
    }
  }
  return false;
}

function adviceTextOk(text) {
  if (typeof text !== 'string' || text === '' || text !== text.trim()) return false;
  if ([...text].length > MAX_ADVICE_CHARS) return false;
  if (UNPRINTABLE.test(text)) return false;
  const folded = text.normalize('NFKC').toLowerCase();
  if (SPOOF_MARKS.some((mark) => folded.includes(mark))) return false;
  return true;
}

// The parsed JSON object of a text block, or null.
function parsedObject(block) {
  if (!isJsonObject(block) || block.type !== 'text' || typeof block.text !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return null;
  }
  return isJsonObject(parsed) ? parsed : null;
}

function decide(input, env) {
  if (!isJsonObject(input) || !hostGate(input, env)) return null;
  const blocks = input.tool_response;
  if (!Array.isArray(blocks)) return null;
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
  if (!isJsonObject(advice) || advice.verified !== true || !adviceTextOk(advice.text)) return null;
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

// The output object, or null when the hook must print nothing. Never throws:
// any error (a missing env, a block nested deeper than the stack) is null.
export function relocateVerifiedAdvice(input, env = process.env) {
  try {
    return decide(input, env);
  } catch {
    return null;
  }
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
  // Load-bearing: a failed write to stdout (EPIPE when the reader is gone) is an
  // async 'error' event on process.stdout that main().catch cannot see; unhandled,
  // node would exit 1 and print the stack on stderr.
  process.on('uncaughtException', () => process.exit(0));
  main().catch(() => process.exit(0));
}
