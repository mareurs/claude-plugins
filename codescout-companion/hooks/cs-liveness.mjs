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
import { unlinkSync } from 'node:fs';
import { readInput, breakerFile } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const f = breakerFile(input.session_id || '');
if (f) {
  try {
    unlinkSync(f);
  } catch {
    // Already absent (the common case — no strikes outstanding), or unremovable.
    // Either way there is nothing to reset and nothing worth reporting.
  }
}

process.exit(0);
