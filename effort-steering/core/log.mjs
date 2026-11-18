// log.mjs — the per-session decision log. One JSON line per prompt, one file
// per session, in a user-private state directory. It is the dataset for the
// later experiment, so two properties are load-bearing:
//   1. A record never holds prompt text. It holds a sha256 of the prompt and
//      the numeric/boolean features, nothing else derived from the prompt.
//   2. appendRecord never writes outside the state directory, whatever session
//      id it is given, and concurrent processes never corrupt each other's lines.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { POLICY_VERSION } from './decide.mjs';

// The session id becomes a file name, so it is whitelisted, not sanitized. No
// separator, NUL or whitespace can pass. '.' and '..' match the pattern and are
// refused separately, because as a bare name they are directory references.
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function hashPrompt(prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// $XDG_STATE_HOME/effort-steering, or ~/.local/state/effort-steering. The XDG
// Base Directory spec says a relative XDG_STATE_HOME is invalid and must be
// ignored; honoring it would put the log inside whatever project the hook ran in.
export function stateDirFor(env) {
  const xdg = env?.XDG_STATE_HOME;
  const base =
    typeof xdg === 'string' && xdg !== '' && path.isAbsolute(xdg)
      ? xdg
      : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'effort-steering');
}

// The record is exactly these fields, written out one by one, so nothing derived
// from the prompt can ride along by accident. The one pass-through is `features`,
// and it is filtered by VALUE TYPE: only a finite number or a boolean is kept. A
// string (or an object, array, null) could carry prompt text, so it is dropped,
// whatever key it has. The filter, not the current shape of extractFeatures, is
// what keeps prompt text out of the log.
function safeFeatures(features) {
  const out = {};
  if (typeof features !== 'object' || features === null || Array.isArray(features)) return out;
  for (const [key, value] of Object.entries(features)) {
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
  }
  return out;
}

export function buildRecord(a) {
  return {
    ts: (a.now ?? new Date()).toISOString(),
    session_id: a.sessionId,
    turn_id: a.turnId,
    harness: a.harness,
    policy_version: POLICY_VERSION,
    rules_version: a.rulesVersion,
    steer_version: a.steerVersion,
    level: a.decision.level,
    confidence: a.decision.confidence,
    reasons: [...a.decision.reasons],
    features: safeFeatures(a.features),
    prompt_sha256: hashPrompt(a.prompt),
    arm: a.arm,
    steered: a.steered,
  };
}

function assertSessionId(id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id) || id === '.' || id === '..') {
    throw new RangeError('session_id must match /^[A-Za-z0-9._-]{1,128}$/ and not be "." or ".."');
  }
}

// One appendFileSync per record: the file is opened O_APPEND and the line goes
// out in one write, so concurrent processes interleave whole lines, never parts.
export function appendRecord(stateDir, record) {
  if (typeof record !== 'object' || record === null) {
    throw new TypeError('record must be an object');
  }
  // Validation comes before any filesystem call, so a refused id leaves no trace.
  assertSessionId(record.session_id);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(stateDir, `${record.session_id}.jsonl`);
  appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return file;
}
