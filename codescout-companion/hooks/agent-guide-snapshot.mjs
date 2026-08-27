// SubagentStart hook — snapshot codescout's guide-hints ledger before a
// subagent does any work, so agent-guide-restore.mjs (SubagentStop) can undo
// whatever the subagent's OWN tool calls mark delivered, without touching
// anything the PARENT already fetched before this dispatch.
//
// Why: codescout's guide_hints_emitted ledger is keyed by Claude Code
// session_id, which a subagent shares with its parent — no separate MCP
// identity exists for it. A subagent's first get_guide-triggering tool call
// therefore marks that topic delivered FOR THE WHOLE SESSION, silently
// starving the parent of guidance the server believes it already handed
// over. codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md
//
// Why SubagentStart and not PreToolUse:Agent — which is where this lived until
// 2026-08-27, doing nothing: Agent dispatch is ASYNCHRONOUS. The tool call
// returns as soon as the agent is launched, so its PostToolUse fires in the same
// millisecond as SubagentStart and ~17s before the subagent finishes. Bracketing
// the tool call therefore closes before the subagent has run a single tool. The
// agent lifecycle is the right interval, and its two ends share agent_id — the
// tool lifecycle's tool_use_id appears on neither.
// docs/issues/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md
//
// SubagentStart fires before the subagent's first tool call (measured: 3.4s
// ahead in one run, 8s in another), so the ledger here is still pre-subagent.
//
// Fail-open, matching every other hook in this file: any error here degrades
// to "no protection for this dispatch", never to blocking the dispatch or
// corrupting the ledger.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  readInput,
  detectFor,
  guideLedgerPath,
  agentGuideSnapshotFile,
  agentIdOrComplain,
  emit,
} from './lib.mjs';

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
const agentId = agentIdOrComplain(input, 'agent-guide-snapshot');
const home = process.env.HOME || process.env.USERPROFILE || homedir();
const ledgerPath = guideLedgerPath(sessionId, home);
const snapPath = agentGuideSnapshotFile(sessionId, agentId);

if (ledgerPath && snapPath) {
  try {
    if (existsSync(ledgerPath)) {
      writeFileSync(snapPath, readFileSync(ledgerPath));
    } else {
      // Absence is itself the state to restore — a sentinel distinct from
      // "no snapshot file" (SubagentStart never ran), which restore treats as
      // a no-op. Safe: the real ledger is always JSON the server writes, never
      // this literal string.
      writeFileSync(snapPath, '__ABSENT__');
    }
  } catch {
    /* best-effort: a failed snapshot means restore no-ops for this dispatch */
  }
}

emit({});
process.exit(0);
