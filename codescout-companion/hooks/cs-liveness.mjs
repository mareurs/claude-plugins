// PostToolUse hook — proof of life for the codescout tool surface.
//
// Clears pre-tool-guard's redirect circuit breaker whenever a codescout tool
// answers, which re-arms the guard. Without this, the breaker would trip on the
// first three blocks of any normal session and never reset.
//
// An ERROR payload counts as proof of life on purpose. What is being measured is
// whether the tool surface is REACHABLE — an IL3 refusal or a "file not found"
// is a codescout process answering, which is exactly the condition under which
// the guard's redirect is sound advice. Only silence means the redirect points
// at nothing.
//
// Matched narrowly on codescout's own tool names rather than `mcp__.*__`: a
// reply from some UNRELATED MCP server is not evidence that codescout is up, and
// treating it as such would reset the counter and re-create the deadlock this
// exists to break.
//
// See docs/issues/archive/2026-08-26-companion-blocks-bash-after-codescout-disconnect.md.
import { unlinkSync, readFileSync } from 'node:fs';
import { readInput, breakerFile, refreshLivenessStamp } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

// PROOF OF REACHABILITY, not just of life. A session can expose only a SUBSET of
// codescout's tools (observed 2026-09-07: read_file/edit_file/create_file/edit_code
// gone while symbols/grep/doc/run_command answered). Clearing on ANY answer reset
// the counter on every call there, so the stand-down was unreachable in exactly the
// state it exists for. pre-tool-guard records, with each strike, the tools whose
// answer proves ITS redirect reachable (`<n>\t<tool,tool>`); only one of those
// answering clears it. No probes recorded (a Bash/Grep/Glob redirect, or an older
// bare-number file) or no tool_name in the payload keeps the original behaviour:
// any answer clears, i.e. the guard re-arms.
// codescout:docs/issues/2026-09-07-the-source-redirect-names-tools-a-partial-tool-set-does-not-have.md
const answered = String(input.tool_name || '').split('__').pop();

const f = breakerFile(input.session_id || '');
if (f) {
  let keep = false;
  try {
    const probes = readFileSync(f, 'utf8').split('\t')[1];
    keep = Boolean(probes && answered && !probes.split(',').includes(answered));
  } catch {
    // No marker (the common case — no strikes outstanding): nothing to keep.
  }
  if (!keep) {
    try {
      unlinkSync(f);
    } catch {
      // Already absent, or unremovable. Either way there is nothing to reset and
      // nothing worth reporting.
    }
  }
}

// Proof of life for the COMPANION, recorded beside the proof of life for the
// tool surface above. Instrumentation only — nothing gates on it yet; it exists
// so the rendezvous latch's frequency question can be answered with data rather
// than argument. Never opens the gate and never writes `session`; see
// `refreshLivenessStamp` in lib.mjs.
refreshLivenessStamp();

process.exit(0);
