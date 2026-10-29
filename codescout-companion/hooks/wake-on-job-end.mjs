// PostToolUse hook (asyncRewake) — wake the session when a codescout background
// job (run_command run_in_background) ends.
//
// The server writes one JSON record per background job, atomically, next to a
// 0700 record directory. The spawn response names that file (`record`). This
// hook arms on the spawn, then polls the record and exits 2 with a message on
// stderr: asyncRewake turns that into a wake-up of the idle session. Any other
// outcome exits 0.
//
// FAIL-OPEN: the entry point exits 0 on any error or unexpected input. Exit 2
// is only ever a deliberate wake-up.
//
// Spec (codescout repo): docs/superpowers/specs/2026-10-29-background-job-wake-design.md
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInput, stateHome } from './lib.mjs';

const RECORD_GRACE_MS = 5000; // the record may lag the spawn response by a few ms

// A pid is alive unless kill(pid, 0) says ESRCH. EPERM means it exists.
function pidAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !(e && e.code === 'ESRCH');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse the spawn response. Returns { handle, record } or null.
export function spawnOf(input) {
  try {
    const text = input && input.tool_response && input.tool_response[0] && input.tool_response[0].text;
    if (typeof text !== 'string') return null;
    const r = JSON.parse(text); // the response text is itself a JSON string
    if (!r || typeof r !== 'object') return null;
    if (typeof r.output_id !== 'string' || !r.output_id.startsWith('@bg_')) return null;
    if ('exit_code' in r) return null; // a read of a job, not a spawn
    if (typeof r.record !== 'string') return null;
    return { handle: r.output_id, record: r.record };
  } catch {
    return null;
  }
}

function fmtDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'an unknown time';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ctx: { handle, exitCode, error, durationMs, minutes, pid }
export function wakeMessage(kind, ctx) {
  const h = ctx.handle;
  const tail = `Read it with run_command("tail -50 ${h}").`;
  switch (kind) {
    case 'exited':
    case 'failed': {
      let what;
      if (kind === 'failed') what = `failed: ${ctx.error || 'unknown error'}`;
      else if (typeof ctx.exitCode === 'number') what = `exited ${ctx.exitCode}`;
      else what = 'terminated by signal';
      return `codescout background job ${h} ended: ${what} after ${fmtDuration(ctx.durationMs)}. ${tail}`;
    }
    case 'vanished':
      return `codescout background job ${h}: its record file vanished, so its end was not observed. ${tail}`;
    case 'heartbeat':
      return `codescout background job ${h} is still running after ${ctx.minutes} min. Read it with run_command("tail -50 ${h}") to keep waiting.`;
    case 'server-ended-job-ended':
    case 'server-ended-job-running':
    case 'server-ended-unknown': {
      const head =
        `The codescout server that ran ${h} has ended, so ${h} is no longer valid and may now name a different job. ` +
        `Do not read it with run_command.`;
      if (kind === 'server-ended-job-ended') return `${head} The job (pid ${ctx.pid}) has also ended; its exit code is unknown.`;
      if (kind === 'server-ended-job-running') return `${head} The job is still running as pid ${ctx.pid}.`;
      return `${head} The job's state is unknown.`;
    }
    default:
      return `codescout background job ${h}: ${kind}`;
  }
}

function readRecord(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // missing or unreadable
  }
}

// Claim the one delivery of this job's end. false when another watcher has it.
function claimDelivery(record) {
  try {
    writeFileSync(`${record}.delivered`, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    return !(e && e.code === 'EEXIST');
  }
}

export async function watch({ handle, record, deadlineSecs = 1800, pollMs = 1000 }) {
  const startedAt = Date.now();
  const deadline = startedAt + deadlineSecs * 1000;
  const minutes = Math.max(1, Math.round(deadlineSecs / 60));
  const watchFile = `${record}.watch`;
  try {
    writeFileSync(watchFile, String(process.pid));
  } catch {
    /* best-effort marker */
  }
  const finish = (exit, message) => {
    // Remove the marker only while it is still ours: a finished watcher must not
    // delete a live watcher's marker, or a duplicate watcher would be armed.
    try {
      if (readFileSync(watchFile, 'utf8').trim() === String(process.pid)) unlinkSync(watchFile);
    } catch {
      /* already gone */
    }
    return message === undefined ? { exit } : { exit, message };
  };
  // wake once, unless another watcher already delivered this end
  const deliver = (kind, ctx) =>
    claimDelivery(record) ? finish(2, wakeMessage(kind, { handle, ...ctx })) : finish(0);

  let seen = false;
  for (;;) {
    const rec = readRecord(record);
    if (!rec) {
      // Never seen: the record may still be landing. Seen then gone: vanished.
      if (seen || Date.now() - startedAt >= RECORD_GRACE_MS) return finish(2, wakeMessage('vanished', { handle }));
      await sleep(pollMs);
      continue;
    }
    seen = true;

    if (rec.state === 'exited' || rec.state === 'failed') {
      const durationMs = Date.parse(rec.finished_at) - Date.parse(rec.started_at);
      return deliver(rec.state, { exitCode: rec.exit_code, error: rec.error, durationMs });
    }

    if (!pidAlive(rec.server_pid)) {
      // Nothing writes a dead-server marker: the record will never change.
      if (!pidAlive(rec.job_pid)) {
        return deliver('server-ended-unknown', {});
      }
      // Server gone, job alive: poll the job pid only.
      for (;;) {
        if (!pidAlive(rec.job_pid)) return deliver('server-ended-job-ended', { pid: rec.job_pid });
        if (Date.now() >= deadline) return deliver('server-ended-job-running', { pid: rec.job_pid });
        await sleep(pollMs);
      }
    }

    if (Date.now() >= deadline) return finish(2, wakeMessage('heartbeat', { handle, minutes }));
    await sleep(pollMs);
  }
}

// Where a session remembers which record belongs to which job handle, so a later
// read of that job can re-arm a watcher after a heartbeat. null when an id is
// not path-safe: nothing is rewritten silently, the caller simply has no map.
export function mapPath(sessionId, handle) {
  const safe = /^[A-Za-z0-9_-]+$/;
  if (typeof sessionId !== 'string' || !safe.test(sessionId)) return null;
  if (typeof handle !== 'string' || !/^@bg_[0-9a-f]{8}$/.test(handle)) return null;
  return join(stateHome(homedir()), 'codescout-companion', 'wake', `map-${sessionId}-${handle}`);
}

// Fail-open: a map that cannot be written only costs the re-arm.
function writeMap(sessionId, handle, record) {
  try {
    const p = mapPath(sessionId, handle);
    if (!p) return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, record);
  } catch {
    /* fail-open */
  }
}

// A read of a job this session armed earlier, whose watcher has since ended
// (heartbeat) while the job still runs. Returns { handle, record } or null.
export function rearmTarget(input) {
  try {
    const text = input && input.tool_response && input.tool_response[0] && input.tool_response[0].text;
    if (typeof text !== 'string') return null;
    const r = JSON.parse(text);
    if (!r || typeof r !== 'object' || !('exit_code' in r)) return null; // not a read
    const command = input.tool_input && input.tool_input.command;
    const m = typeof command === 'string' ? command.match(/@bg_[0-9a-f]{8}/) : null;
    if (!m) return null;
    const handle = m[0];
    const map = mapPath(input.session_id, handle);
    if (!map) return null;
    const record = readFileSync(map, 'utf8').trim();
    if (!record) return null;
    const rec = readRecord(record);
    if (!rec || rec.state !== 'running') return null;
    // The end was already announced, or the server that served this handle is gone
    // (its record stays 'running' for good): a read now cannot refer to this job.
    if (existsSync(`${record}.delivered`) || !pidAlive(rec.server_pid)) return null;
    let owner = null;
    try {
      owner = Number(readFileSync(`${record}.watch`, 'utf8').trim());
    } catch {
      /* no watcher */
    }
    if (owner !== null && pidAlive(owner)) return null; // a live watcher already holds it
    return { handle, record };
  } catch {
    return null;
  }
}


async function main() {
  // Guard 1: a host that does not set CLAUDE_PROJECT_DIR for plugin hooks never blocks (verify in Task 5).
  if (!process.env.CLAUDE_PROJECT_DIR) process.exit(0);
  const input = readInput();
  if (!input) process.exit(0);
  // Guard 2: subagent jobs are out of scope (verify in Task 5).
  if (input.agent_id) process.exit(0);
  const spawn = spawnOf(input);
  const target = spawn || rearmTarget(input);
  if (!target) process.exit(0);
  if (spawn) writeMap(input.session_id, spawn.handle, spawn.record);
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const result = await watch({
    ...target,
    deadlineSecs: num(process.env.CODESCOUT_WAKE_DEADLINE_SECS, 1800),
    pollMs: num(process.env.CODESCOUT_WAKE_POLL_MS, 1000),
  });
  if (result.exit === 2 && result.message) {
    process.stderr.write(`${result.message}\n`, () => process.exit(2));
  } else {
    process.exit(0);
  }
}

// Run only as the entry point, not when imported by tests or other hooks.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => process.exit(0));
}
