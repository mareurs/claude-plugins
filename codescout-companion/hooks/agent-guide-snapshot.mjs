// SubagentStart hook — snapshot codescout's guide-hints ledger before a
// subagent does any work, so agent-guide-restore.mjs (SubagentStop) can undo
// whatever the subagent's OWN tool calls mark delivered, without touching
// anything the PARENT already fetched before this dispatch. ALSO, for a fresh
// (non-`fork`) subagent, requests a LIVE re-arm of that same key set from the
// already-running server — see the second half of this file.
//
// Why: codescout's guide_hints_emitted ledger is keyed by Claude Code
// session_id, which a subagent shares with its parent — no separate MCP
// identity exists for it. A subagent's first get_guide-triggering tool call
// therefore marks that topic delivered FOR THE WHOLE SESSION, silently
// starving the parent of guidance the server believes it already handed
// over. codescout:docs/issues/archive/2026-08-26-subagent-guide-fetch-starves-parent.md
//
// SCOPE of the SNAPSHOT/RESTORE half — measured 2026-08-27. It does NOT undo
// that starvation within the session it runs in. codescout loads the ledger
// once, at server construction, and the in-memory map is authoritative for the
// process's life (`persist` is deliberately not read-modify-write), so a
// hook's file edit is invisible to the running server and the next mark
// overwrites it from memory. What the bracket buys is the NEXT server: a
// reconnect loads the file, and a cleaned one starts without the subagent's
// marks where an uncleaned one would carry them forward.
// docs/issues/archive/2026-08-27-guide-ledger-bracket-is-inert-within-its-own-session.md
//
// The LIVE RE-ARM half below is what actually reaches the running session —
// see codescout:docs/issues/archive/2026-08-31-subagents-receive-guides-their-parent-already-holds.md
// (Investigation 2026-09-11) and lib.mjs's own "Live in-session guide re-arm"
// comment for the full design. Short version: write a one-shot request file
// the server polls on its very next request, reaching the in-memory ledger
// the on-disk snapshot above cannot touch.
//
// Why SubagentStart and not PreToolUse:Agent — which is where the
// snapshot/restore bracket lived until 2026-08-27, doing nothing: Agent
// dispatch is ASYNCHRONOUS. The tool call returns as soon as the agent is
// launched, so its PostToolUse fires in the same millisecond as SubagentStart
// and ~17s before the subagent finishes. Bracketing the tool call therefore
// closes before the subagent has run a single tool. The agent lifecycle is
// the right interval, and its two ends share agent_id — the tool lifecycle's
// tool_use_id appears on neither.
// docs/issues/archive/2026-08-27-agent-guide-restore-fires-at-launch-not-completion.md
//
// SubagentStart fires before the subagent's first tool call (measured: 3.4s
// ahead in one run, 8s in another), so the ledger here is still pre-subagent.
//
// Fail-open, matching every other hook in this file: any error here degrades
// to "no protection for this dispatch", never to blocking the dispatch or
// corrupting the ledger.
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  readInput,
  detectFor,
  guideLedgerPath,
  agentGuideSnapshotFile,
  agentIdOrComplain,
  guideLedgerKeys,
  encodeGuideSnapshot,
  serversDir,
  guideRearmDir,
  guideRearmFile,
  resolveOwnServerPids,
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

// The KEY SET, not the bytes: restore subtracts what appeared during this
// agent's lifetime rather than overwriting, so it never needs the stamps. An
// absent ledger is simply an empty key set — the `__ABSENT__` sentinel this
// hook wrote until 1.19.0 existed only because restore-by-overwrite had no
// way to express "and there was no file", and its restore path (unlinkSync)
// is what deleted a whole ledger out from under the parent.
// docs/issues/archive/2026-08-27-concurrent-subagent-restores-discard-parent-guide-marks.md
//
// Computed once, best-effort, and shared by BOTH halves below: an unreadable
// or missing ledger degrades to an empty key set for each independently,
// never to a thrown error.
let keys = [];
try {
  keys = existsSync(ledgerPath) ? guideLedgerKeys(readFileSync(ledgerPath, 'utf8')) : [];
} catch {
  /* best-effort: an unreadable ledger yields an empty key set for both halves */
}

if (snapPath) {
  try {
    writeFileSync(snapPath, encodeGuideSnapshot(keys, false));
  } catch {
    /* best-effort: a failed snapshot means restore no-ops for this dispatch */
  }
}

// LIVE RE-ARM — see the module doc comment above and lib.mjs's "Live
// in-session guide re-arm" section for the design.
//
// `agent_type !== 'fork'` treats a MISSING agent_type as fresh (the safe
// default): a `fork` subagent inherits the parent's full conversation and
// already has this content, so re-arming for it would only cost a harmless
// redundant re-delivery to whichever party's next call lands first (still
// the correct direction to err in — see Decision #8 in
// codescout:docs/superpowers/specs/2026-08-18-guide-ledger-session-identity-design.md
// — but there is no reason to pay it when the dispatch type is known safe).
// A NON-fork subagent has zero inherited context, so re-arming is not an
// optimization there — it is the only way the guide ever reaches it.
if (agentId && keys.length > 0 && input.agent_type !== 'fork') {
  try {
    const rearmDir = guideRearmDir(home);
    // Never `mkdir` this ourselves — the server owns creating it at
    // construction (`GuideRearmInbox::new`), matching the existing
    // `existsSync(rvDir)` guard convention this file's sibling hooks use for
    // the rendezvous directory. A missing directory means either no
    // companion-aware server has started yet, or one predating this feature;
    // either way there is nothing to write to.
    if (existsSync(rearmDir)) {
      const rv = serversDir(home);
      for (const pid of resolveOwnServerPids(rv)) {
        try {
          const f = guideRearmFile(rearmDir, pid, agentId);
          const tmp = `${f}.tmp`;
          writeFileSync(tmp, JSON.stringify({ topics: keys, created_at: new Date().toISOString() }));
          renameSync(tmp, f);
        } catch {
          /* best-effort per-pid: one failed write must not block the others */
        }
      }
    }
  } catch {
    /* best-effort: a failed re-arm request means no live fix for this dispatch,
       same degradation as a failed snapshot above */
  }
}

emit({});
process.exit(0);
