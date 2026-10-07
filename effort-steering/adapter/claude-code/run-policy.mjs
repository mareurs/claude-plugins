// runPolicy: call the effort-policy CLI once, with a wall-clock timeout, and never throw.
//
// Any failure returns a fail-open result (default level, low confidence, no steer,
// arm 'treated') with one adapter reason:
//   adapter_timeout     the CLI was killed at the timeout
//   adapter_cli_failed  the ctx could not be sent, the CLI could not be spawned, or it exited non-zero
//   adapter_bad_output  stdout is not exactly one JSON object line with the five keys

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The latency budget registered in spikes/s4-prereg.json (G2). run-policy.test.mjs loads that
// file and fails if the two differ, so the hook cannot run on a budget nobody registered.
export const POLICY_TIMEOUT_MS = 500;

// Resolved from this file, never from CLAUDE_PLUGIN_ROOT: scratch runs do not set it.
const DEFAULT_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'effort-policy.mjs');
const MAX_BUFFER = 1024 * 1024;
const KEYS = ['level', 'confidence', 'reasons', 'steer', 'arm'];

const failOpen = (reason) => ({
  level: 'default',
  confidence: 'low',
  reasons: [reason],
  steer: null,
  arm: 'treated',
});

// Only a positive safe integer is a timeout. 0 would disable spawnSync's timeout, and a
// negative, fractional, string, Infinity or NaN value makes spawnSync throw, so every call
// would fail open as adapter_cli_failed. Anything else means the default.
export function effectiveTimeoutMs(t) {
  return Number.isSafeInteger(t) && t > 0 ? t : POLICY_TIMEOUT_MS;
}

function parseOutput(stdout) {
  if (typeof stdout !== 'string' || !stdout.endsWith('\n')) return null;
  const lines = stdout.slice(0, -1).split('\n');
  if (lines.length !== 1) return null;
  let value;
  try {
    value = JSON.parse(lines[0]);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return null;
  return value;
}

export function runPolicy(ctx, opts = {}) {
  try {
    const cliPath = opts.cliPath ?? DEFAULT_CLI;
    const timeout = effectiveTimeoutMs(opts.timeoutMs);
    const args = Array.isArray(opts.args) ? opts.args : [];
    const input = JSON.stringify(ctx);
    if (typeof input !== 'string') return failOpen('adapter_cli_failed');
    const res = spawnSync(process.execPath, [cliPath, 'decide', ...args], {
      input,
      timeout,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    if (res.error && res.error.code === 'ETIMEDOUT') return failOpen('adapter_timeout');
    if (res.error || res.status !== 0) return failOpen('adapter_cli_failed');
    return parseOutput(res.stdout) ?? failOpen('adapter_bad_output');
  } catch {
    return failOpen('adapter_cli_failed');
  }
}
