// Trace prompts for the R1 experiment: the failing test's output at the parent commit plus one line.
// Pure: no I/O. Design: docs/superpowers/specs/2026-10-13-effort-routing-first-rule-design.md ("The lab prompt").

import { compileRules, decide } from '../../core/decide.mjs';
import { extractFeatures } from '../../core/features.mjs';
import { R1_RULES } from './r1-rule.mjs';

const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_INSTRUCTION = 'This is the failing test output. Please fix it.';
// The operator's build hint (R1 decision, 2026-10-13, option A): one sentence, identical on every task and in every arm, with nothing
// about the bug, the files or the cause. The conditional form is true for all 12 tasks: cs-p18 and cs-p20 are graded with the default
// features (their hidden tests live under the `librarian` feature), and the 8 tasks whose default features hold local-embed fail to
// link ONNX Runtime once in the offline container and then take the flag.
export const TEST_COMMAND_SENTENCE = 'Run the tests with `cargo test`; if the build fails to link ONNX Runtime, add `--no-default-features`.';
const FAILURE_HEADER = /^---- .+ stdout ----$/;
const FAILURES_LIST = 'failures:';
// No regex in R1, so the wall-clock probe has nothing to measure (same reasoning as hook-copy.mjs's HOOK_RULE_SET).
const R1_COMPILED = compileRules(R1_RULES, { probe: false });

// The text of the failure blocks of a libtest run: from the first `---- <name> stdout ----` header up to the
// `failures:` list that follows the blocks (or the end). Cut at a line boundary to `maxChars`. null when there is no header.
export function traceFromTestOutput(output, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const lines = String(output).split('\n');
  const start = lines.findIndex((line) => FAILURE_HEADER.test(line));
  if (start === -1) return null;
  let end = lines.findIndex((line, i) => i > start && line === FAILURES_LIST);
  if (end === -1) end = lines.length;
  const kept = lines.slice(start, end);
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  const out = [];
  let size = 0;
  for (const line of kept) {
    const next = size + line.length + (out.length > 0 ? 1 : 0);
    if (next > maxChars) break;
    out.push(line);
    size = next;
  }
  return out.join('\n');
}

export function buildTracePrompt(trace, instruction = DEFAULT_INSTRUCTION) {
  return `${trace.trimEnd()}\n\n${instruction} ${TEST_COMMAND_SENTENCE}\n`;
}

// Reasons, each at most once, in a fixed order. `f2pNamesShown` is information for the leak review, never a reason.
export function checkTracePrompt(prompt, def) {
  const reasons = [];
  const features = extractFeatures(prompt);
  if (!features.hasStackTrace) reasons.push('no_stack_trace');
  if (!features.explicitDeep && decide({ prompt }, R1_COMPILED).level !== 'shallow') reasons.push('not_shallow');
  if (features.explicitDeep) reasons.push('ultrathink');
  if (prompt.split(TEST_COMMAND_SENTENCE).length - 1 !== 1) reasons.push('test_command_sentence');
  const lower = prompt.toLowerCase();
  for (const term of def?.scrub?.terms ?? []) {
    if (lower.includes(term.toLowerCase())) reasons.push(`leak:${term}`);
  }
  if (prompt.includes('\0') || Buffer.from(prompt, 'utf8').toString('utf8') !== prompt) reasons.push('not_utf8_or_nul');
  const f2pNamesShown = (def?.f2p?.names ?? []).some((name) => prompt.includes(name));
  return { ok: reasons.length === 0, reasons, f2pNamesShown };
}
