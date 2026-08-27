// PostToolUse hook on Agent — the other half of agent-guide-snapshot.mjs.
// Restores codescout's guide-hints ledger to its pre-dispatch snapshot,
// undoing whatever the just-finished subagent's own tool calls marked
// delivered. codescout:docs/issues/2026-08-26-subagent-guide-fetch-starves-parent.md
//
// Degrades safely in every direction:
//  - a missing snapshot (Pre never ran, e.g. hooks updated mid-session, or
//    codescout was not detected at dispatch time) is a silent no-op — the
//    subagent's marks simply survive, same as before this fix existed;
//  - any write failure leaves the ledger as the subagent left it, never
//    torn — the restore write goes through the same write-tmp-then-rename
//    pattern codescout's own Rust side uses (util::fs::write_utf8), so a
//    reader can never observe a partial file.
import { readFileSync, existsSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
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

if (ledgerPath && snapPath && existsSync(snapPath)) {
  try {
    const snapshot = readFileSync(snapPath);
    if (snapshot.toString('utf8') === '__ABSENT__') {
      if (existsSync(ledgerPath)) unlinkSync(ledgerPath);
    } else {
      const tmpPath = `${ledgerPath}.tmp-${process.pid}`;
      writeFileSync(tmpPath, snapshot);
      renameSync(tmpPath, ledgerPath);
    }
  } catch {
    /* best-effort: worst case the subagent's marks survive, same as before this fix */
  } finally {
    try {
      unlinkSync(snapPath);
    } catch {
      /* best-effort cleanup */
    }
  }
}

emit({});
process.exit(0);
