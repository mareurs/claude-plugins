// UserPromptSubmit + SessionStart hook — report a codescout background job whose
// end wake never reached this session.
//
// wake-on-job-end.mjs ends its only watcher at the 30-minute heartbeat. A job that
// ends later wakes nobody unless the session read the job after the heartbeat.
// This hook is the safety net that does not depend on the model: at the next
// prompt (or session start) it looks at the jobs THIS session armed (the map
// files the spawn path wrote), and reports each one that has ended, has no
// `.delivered` and has no live watcher. The report claims `.delivered`, so each
// end is reported once.
//
// FAIL-OPEN: exits 0 on any error. Prints nothing unless a job was missed.
//
// Issue: docs/issues/2026-11-11-background-job-past-30-minutes-loses-its-end-wake-unless-the-handle-is-read-after-the-heartbeat.md
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readInput, emit, stateHome } from './lib.mjs';

const SAFE_SESSION = /^[A-Za-z0-9_-]+$/;
const MAP_NAME = /^map-([A-Za-z0-9_-]+)-(@bg_[0-9a-f]{8})$/;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Claim the one delivery of this job's end. false when someone else holds it.
function claim(record) {
  try {
    writeFileSync(`${record}.delivered`, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

// The [handle, record path] pairs this session armed. Never throws.
export function sessionMaps(sessionId, wakeDir) {
  if (typeof sessionId !== 'string' || !SAFE_SESSION.test(sessionId)) return [];
  let names;
  try {
    names = readdirSync(wakeDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const m = name.match(MAP_NAME);
    if (!m || m[1] !== sessionId) continue;
    try {
      const record = readFileSync(join(wakeDir, name), 'utf8').trim();
      if (record) out.push([m[2], record]);
    } catch {
      /* unreadable map: skip */
    }
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// One line per job that ended with no end wake, claiming each. `wake` is the
// module of wake-on-job-end.mjs (pidAlive, wakeMessage), loaded only when needed.
export function missedLines(maps, wake) {
  const lines = [];
  for (const [handle, record] of maps) {
    const rec = readJson(record);
    if (!rec || rec.schema !== 1 || typeof rec.server_pid !== 'number') continue;
    if (rec.state !== 'exited' && rec.state !== 'failed') continue;
    let owner = null;
    try {
      owner = Number(readFileSync(`${record}.watch`, 'utf8').trim());
    } catch {
      /* no watcher */
    }
    if (owner !== null && wake.pidAlive(owner)) continue; // it will deliver
    if (!claim(record)) continue; // delivered, or another reporter has it
    const durationMs = Date.parse(rec.finished_at) - Date.parse(rec.started_at);
    const ctx = { handle, exitCode: rec.exit_code, error: rec.error, durationMs };
    if (wake.pidAlive(rec.server_pid)) {
      lines.push(wake.wakeMessage(rec.state, ctx));
    } else {
      // The handle of a server that ended is no longer valid: do not offer a read.
      const full = wake.wakeMessage(rec.state, ctx);
      lines.push(full.replace(/ Read it with run_command\("tail -50 [^"]*"\)\.$/, '') + ` The server that ran ${handle} has ended, so ${handle} is no longer valid.`);
    }
  }
  return lines;
}

async function main() {
  const input = readInput();
  if (!input || input.agent_id) return;
  const wakeDir = join(stateHome(homedir()), 'codescout-companion', 'wake');
  const maps = sessionMaps(input.session_id, wakeDir);
  if (maps.length === 0) return;
  const wake = await import('./wake-on-job-end.mjs');
  const lines = missedLines(maps, wake);
  if (lines.length === 0) return;
  const event = input.hook_event_name === 'SessionStart' ? 'SessionStart' : 'UserPromptSubmit';
  emit({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext:
        'No end wake reached this session for these background jobs (the watcher ended at the 30-minute heartbeat, or the session was closed). ' +
        lines.join(' '),
    },
  });
}

// Run only as the entry point, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('uncaughtException', () => process.exit(0));
  main().then(() => process.exit(0), () => process.exit(0));
}
