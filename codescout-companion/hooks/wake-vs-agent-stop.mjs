// VS Code/Copilot AgentStop wake bridge.
// PostToolUse records the @bg_<handle> -> record map. When an agent turn ends,
// this hook polls those records and forces one continuation when a job finishes.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInput, stateHome } from './lib.mjs';
import { pidAlive } from './wake-on-job-end.mjs';

const SAFE_SESSION = /^[A-Za-z0-9_-]+$/;
const MAP_NAME = /^map-([A-Za-z0-9_-]+)-(@bg_[0-9a-f]{8})$/;
const HOLD_CAP_MS = 1_780_000;

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function claim(record) {
  try { writeFileSync(`${record}.delivered`, String(process.pid), { flag: 'wx' }); return true; }
  catch { return false; }
}

function sessionMaps(sessionId) {
  if (typeof sessionId !== 'string' || !SAFE_SESSION.test(sessionId)) return [];
  const wakeDir = join(stateHome(homedir()), 'codescout-companion', 'wake');
  let names;
  try { names = readdirSync(wakeDir); } catch { return []; }
  const maps = [];
  for (const name of names) {
    const match = name.match(MAP_NAME);
    if (!match || match[1] !== sessionId) continue;
    try {
      const record = readFileSync(join(wakeDir, name), 'utf8').trim();
      if (record) maps.push([match[2], record]);
    } catch {}
  }
  return maps;
}

function fmtDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'an unknown time';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function wakeMessage(handle, rec) {
  const durationMs = Date.parse(rec.finished_at) - Date.parse(rec.started_at);
  if (rec.state === 'failed') return `codescout background job ${handle} failed: ${rec.error || 'unknown error'} after ${fmtDuration(durationMs)}.`;
  if (typeof rec.exit_code === 'number') return `codescout background job ${handle} ended: exited ${rec.exit_code} after ${fmtDuration(durationMs)}.`;
  return `codescout background job ${handle} ended: terminated by signal after ${fmtDuration(durationMs)}.`;
}

async function main() {
  // Claude/Codex own this channel; this script is Copilot VS only.
  if (process.env.CLAUDE_PROJECT_DIR) return;
  const input = readInput();
  if (!input || input.agent_id) return;
  if (!['Stop', 'AgentStop', 'agentStop'].includes(input.hook_event_name)) return;

  const maps = sessionMaps(input.session_id);
  if (maps.length === 0) return;

  // Stays below the hook's own timeoutSec in hooks.json, which kills the hold fail-open.
  const timeoutMs = Math.min(HOLD_CAP_MS, Number(process.env.COPILOT_WAKE_STOP_TIMEOUT_MS) > 0
    ? Number(process.env.COPILOT_WAKE_STOP_TIMEOUT_MS)
    : HOLD_CAP_MS);
  const started = Date.now();

  for (;;) {
    const lines = [];
    let pending = false;
    for (const [handle, record] of maps) {
      if (existsSync(`${record}.delivered`)) continue;
      const rec = readJson(record);
      if (!rec || rec.schema !== 1 || typeof rec.server_pid !== 'number') continue;
      if (rec.state === 'exited' || rec.state === 'failed') {
        if (claim(record)) lines.push(wakeMessage(handle, rec));
      } else if (pidAlive(rec.server_pid)) {
        pending = true;
      }
    }
    if (lines.length > 0) {
      // Local harness reads hookSpecificOutput, Copilot harness reads the top level.
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: lines.join(' '),
        hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason: lines.join(' ') },
      }));
      return;
    }
    if (!pending || Date.now() - started >= timeoutMs) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {}).finally(() => process.exit(0));
}

export { main, sessionMaps, wakeMessage };