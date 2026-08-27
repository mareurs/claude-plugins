// SubagentStop hook — the other half of agent-guide-snapshot.mjs.
// Restores codescout's guide-hints ledger to its pre-dispatch snapshot,
// undoing whatever the just-finished subagent's own tool calls marked
// delivered. codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md
//
// Why SubagentStop and not PostToolUse:Agent — which is where this lived until
// 2026-08-27, where it was a no-op: Agent dispatch is ASYNCHRONOUS, so the tool
// call returns at LAUNCH. Measured 2026-08-27, PostToolUse:Agent fired in the
// same millisecond as SubagentStart, 3.4s before the subagent's first tool call
// and 17.2s before SubagentStop. Every mark the subagent made landed after the
// restore meant to undo it. SubagentStop is the real completion signal; it
// carries agent_id and no tool_use_id, which is why the snapshot key moved too.
// docs/issues/archive/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md
//
// Degrades safely in every direction:
//  - a missing snapshot (SubagentStart never ran, e.g. hooks updated
//    mid-session, or codescout was not detected at dispatch time) is a silent
//    no-op — the subagent's marks simply survive, same as before this fix
//    existed;
//  - any write failure leaves the ledger as the subagent left it, never
//    torn — the restore write goes through the same write-tmp-then-rename
//    pattern codescout's own Rust side uses (util::fs::write_utf8), so a
//    reader can never observe a partial file.
//
// SUBTRACTIVE, not overwrite. Until 1.19.0 this wrote the snapshot over the
// whole ledger, so with two dispatches in flight the LAST restore to fire won
// and replayed the ledger as of ITS agent's start — discarding every mark the
// parent made in between, and (via the `__ABSENT__` sentinel) sometimes
// deleting the ledger outright. Now it removes only the keys that appeared
// during this agent's lifetime AND that no sibling snapshot vouches for.
//
// SCOPE — what this actually buys, measured 2026-08-27. The bracket does NOT
// undo that starvation within the session it runs in. codescout loads the
// ledger once, at server construction, and the in-memory map is authoritative
// for the process's life (`persist` is deliberately not read-modify-write), so
// this file edit is invisible to the running server and the next mark
// overwrites it from memory. What it buys is the NEXT server: a reconnect loads
// the file, and a cleaned one starts without the subagent's marks where an
// uncleaned one would carry them forward. Kept for that; do not re-broaden it.
// docs/issues/archive/2026-08-27-guide-ledger-bracket-is-inert-within-its-own-session.md
//
// Second known limit, stated rather than left to be found: a key added while EVERY
// live agent was already running is unattributable — no sibling snapshot
// predates it — so a parent mark landing in that window is still removed.
// Ledger keys carry no author, so no inspection of the ledger can fix this;
// it needs per-tool-call attribution. The cost is one re-injected guide body,
// and removal is the correct side to err on: keeping an unattributable key
// risks the starvation this whole bracket exists to stop.
// docs/issues/archive/2026-08-27-concurrent-subagent-restores-discard-parent-guide-marks.md
import { readFileSync, existsSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  readInput,
  detectFor,
  guideLedgerPath,
  agentGuideSnapshotFile,
  agentIdOrComplain,
  listSiblingGuideSnapshots,
  decodeGuideSnapshot,
  encodeGuideSnapshot,
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
const agentId = agentIdOrComplain(input, 'agent-guide-restore');
const home = process.env.HOME || process.env.USERPROFILE || homedir();
const ledgerPath = guideLedgerPath(sessionId, home);
const snapPath = agentGuideSnapshotFile(sessionId, agentId);

if (ledgerPath && snapPath && existsSync(snapPath)) {
  try {
    const self = decodeGuideSnapshot(readFileSync(snapPath, 'utf8'));
    const siblings = listSiblingGuideSnapshots(sessionId, snapPath);

    if (self && existsSync(ledgerPath)) {
      let ledger = null;
      try {
        ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      } catch {
        // Unparseable. guide_ledger.rs's read_entries reads it as empty and
        // the next mark overwrites it wholesale; touching it here could only
        // make things worse.
      }

      // A key is this agent's to remove only if it appeared after this agent
      // started AND no sibling vouches for it. A key in a sibling's
      // start-snapshot predates that sibling, so it is not ours to drop.
      const before = new Set(self.keys);
      const vouched = new Set(siblings.flatMap((s) => s.keys));
      const keep = (k) => before.has(k) || vouched.has(k);

      let next = null;
      if (Array.isArray(ledger)) {
        const kept = ledger.map(String).filter(keep);
        if (kept.length !== ledger.length) next = kept;
      } else if (ledger && typeof ledger === 'object') {
        const kept = Object.fromEntries(Object.entries(ledger).filter(([k]) => keep(k)));
        if (Object.keys(kept).length !== Object.keys(ledger).length) next = kept;
      }

      if (next !== null) {
        const empty = Array.isArray(next) ? next.length === 0 : Object.keys(next).length === 0;
        if (empty) {
          // `{}` is equivalent to a missing file for codescout's reader —
          // read_entries() returns an empty map for both (verified against
          // src/tools/guide_ledger.rs). Deleting anyway preserves the
          // observable contract this hook has always had, so nothing
          // downstream depends on that equivalence continuing to hold.
          unlinkSync(ledgerPath);
        } else {
          const tmpPath = `${ledgerPath}.tmp-${process.pid}`;
          writeFileSync(tmpPath, JSON.stringify(next));
          renameSync(tmpPath, ledgerPath);
        }
      }
    }

    // Retain as a tombstone while any sibling is still live: "key K existed
    // when this agent started" is evidence a later-finishing sibling needs,
    // and it stays true after this agent is gone. Once every sibling is done
    // too, nothing will ever consult them again.
    const remaining = listSiblingGuideSnapshots(sessionId, snapPath);
    if (remaining.every((s) => s.done)) {
      for (const s of remaining) {
        try {
          unlinkSync(s.path);
        } catch {
          /* best-effort cleanup */
        }
      }
      unlinkSync(snapPath);
    } else {
      writeFileSync(snapPath, encodeGuideSnapshot(self ? self.keys : [], true));
    }
  } catch {
    /* best-effort: worst case the subagent's marks survive, same as before this fix */
  }
}

emit({});
process.exit(0);
