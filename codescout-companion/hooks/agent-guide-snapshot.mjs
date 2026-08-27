// PreToolUse hook on Agent — snapshot codescout's guide-hints ledger before a
// subagent dispatch, so agent-guide-restore.mjs (PostToolUse) can undo
// whatever the subagent's OWN tool calls mark delivered, without touching
// anything the PARENT already fetched before this dispatch.
//
// Why: codescout's guide_hints_emitted ledger is keyed by Claude Code
// session_id, which a subagent shares with its parent — no separate MCP
// identity exists for it. A subagent's first get_guide-triggering tool call
// therefore marks that topic delivered FOR THE WHOLE SESSION, silently
// starving the parent of guidance the server believes it already handed
// over. codescout:docs/issues/2026-08-26-subagent-guide-fetch-starves-parent.md
//
// Fail-open, matching every other hook in this file: any error here degrades
// to "no protection for this dispatch", never to blocking the dispatch or
// corrupting the ledger.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { readInput, detectFor, guideLedgerPath, agentGuideSnapshotFile, emit } from './lib.mjs';

const input = readInput();
if (!input) {
  emit({});
  process.exit(0);
}

const cwd = input.cwd || '';
if (detectFor(cwd).HAS_CODESCOUT === 'false') {
  emit({});
  process.exit(0);
}

const sessionId = input.session_id || '';
const toolUseId = input.tool_use_id || '';
const home = process.env.HOME || process.env.USERPROFILE || homedir();
const ledgerPath = guideLedgerPath(sessionId, home);
const snapPath = agentGuideSnapshotFile(sessionId, toolUseId);

if (ledgerPath && snapPath) {
  try {
    if (existsSync(ledgerPath)) {
      writeFileSync(snapPath, readFileSync(ledgerPath));
    } else {
      // Absence is itself the state to restore — a sentinel distinct from
      // "no snapshot file" (Pre never ran), which restore treats as a no-op.
      // Safe: the real ledger is always JSON the server writes, never this
      // literal string.
      writeFileSync(snapPath, '__ABSENT__');
    }
  } catch {
    /* best-effort: a failed snapshot means restore no-ops for this dispatch */
  }
}

emit({});
process.exit(0);
