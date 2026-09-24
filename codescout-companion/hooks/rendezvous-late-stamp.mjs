// Detached from session-start.mjs when its scan finds no rendezvous slot owned
// by our own Claude process. Interactive Claude Code fires SessionStart about
// 220 ms BEFORE its codescout server publishes its slot (measured 2026-09-24:
// hook at +763 ms, slot at +982 ms). So the scan runs too early, and without
// this the server would never be stamped: the liveness refresher never opens a
// null gate.
//
// Waits for a slot whose ppid is the Claude pid it was handed, stamps it by the
// same rule as the scan (`stampSlotIfStale`), and exits. It is given that pid
// rather than walking its own ancestry, because a detached process is
// reparented and has none left to walk. The deadline bounds the process if no
// server ever publishes, for example when codescout fails to start.
// codescout:docs/issues/archive/2026-09-24-sessionstart-can-run-before-the-resumed-servers-slot-exists.md
//
// argv: <claudePid> <sessionId> <source> <rvDir> <stampedAt>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stampSlotIfStale } from './lib.mjs';

const [claudePidArg, sessionId, source, rvDir, stampedAt] = process.argv.slice(2);
const claudePid = Number.parseInt(claudePidArg, 10);
const DEADLINE_MS = 30_000;
const POLL_MS = 100;
const deadline = Date.now() + DEADLINE_MS;

// One pass over the slots; true once a slot of our Claude has been seen.
function scan() {
  if (!existsSync(rvDir)) return false;
  let found = false;
  for (const name of readdirSync(rvDir)) {
    if (!name.endsWith('.json')) continue;
    const f = join(rvDir, name);
    try {
      const e = JSON.parse(readFileSync(f, 'utf8'));
      if (e.ppid !== claudePid) continue;
      found = true;
      stampSlotIfStale(f, e, sessionId, source, stampedAt);
    } catch {
      /* skip unreadable, unparseable, or concurrently-removed slots */
    }
  }
  return found;
}

if (Number.isNaN(claudePid) || !sessionId || !rvDir) process.exit(0);
(function poll() {
  if (scan() || Date.now() > deadline) process.exit(0);
  setTimeout(poll, POLL_MS);
})();
