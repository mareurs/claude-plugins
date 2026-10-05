// s4-rows.mjs — joins one S4 session's decision-log arm with its transcript tokens.
//
// Pure parsing plus two small file lookups; no model call, no spawn. Ruling R3: a row's
// input_total is input_tokens + cache_creation_input_tokens + cache_read_input_tokens,
// thinking_tokens is usage.output_tokens_details.thinking_tokens, cache_creation is
// usage.cache_creation_input_tokens; all summed over assistant messages deduped by
// message.id. s2-usage-report.mjs exports a UsageRecord with no input_tokens field, so
// it cannot carry input_total; this module has its own small dedupe by message.id
// (S2 measured that usage fields agree inside one message.id group, so the first
// record of a group is kept).
//
// Ruling R22: Claude Code writes an API failure as an assistant record with
// model "<synthetic>", all-zero usage and isApiErrorMessage:true. Such a record is never
// a usage row, and a session holding one is excluded (reason api_error): zeros from a
// failed call must not look like a thinking-token measurement.
//
// buildRow returns { row } or { reason }; a reason means the run is EXCLUDED and counted.
// It is never treated as holdout.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ARMS = new Set(['treated', 'holdout']);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

function parseLines(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn or non-JSON line carries no usable record
    }
  }
  return out;
}

const isApiError = (obj) =>
  obj !== null && typeof obj === 'object' && (obj.isApiErrorMessage === true || (obj.message && obj.message.model === '<synthetic>'));

// The arm of a session's decision log; null when there is no usable line. One prompt per
// S4 session, so the first line with a valid arm decides.
export function armFromLog(text) {
  for (const rec of parseLines(text)) {
    if (rec !== null && typeof rec === 'object' && ARMS.has(rec.arm)) return rec.arm;
  }
  return null;
}

// True when the transcript holds an API-error record (R22).
export function hasApiError(text) {
  return parseLines(text).some(isApiError);
}

// Token sums over assistant messages deduped by message.id; null when none were found.
// A record without a message.id cannot be deduped and is not counted; neither is an
// API-error record.
export function tokensFromTranscript(text) {
  const seen = new Map();
  for (const obj of parseLines(text)) {
    if (isApiError(obj)) continue;
    const msg = obj && obj.message;
    if (msg === null || typeof msg !== 'object' || typeof msg.id !== 'string' || msg.id === '') continue;
    if (msg.role !== undefined && msg.role !== 'assistant') continue;
    const usage = msg.usage;
    if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) continue;
    if (!seen.has(msg.id)) seen.set(msg.id, usage);
  }
  if (seen.size === 0) return null;
  let thinking = 0;
  let creation = 0;
  let inputTotal = 0;
  for (const u of seen.values()) {
    thinking += count(u.output_tokens_details && u.output_tokens_details.thinking_tokens);
    creation += count(u.cache_creation_input_tokens);
    inputTotal += count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens);
  }
  return { thinking_tokens: thinking, cache_creation: creation, input_total: inputTotal };
}

// Ruling R6: glob <config dir>/projects/*/<sessionId>.jsonl; never compute the slug.
// Returns every match. An empty CLAUDE_CONFIG_DIR means the default (|| not ??).
export function findTranscripts(sessionId, configDir) {
  const base = configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const root = path.join(base, 'projects');
  let dirs;
  try {
    dirs = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const file = path.join(root, d.name, `${sessionId}.jsonl`);
    if (existsSync(file)) out.push(file);
  }
  return out;
}

// { row } for analyzeArms, or { reason } when the run must be excluded.
export function buildRow(sessionId, { stateDir, configDir }) {
  const logFile = path.join(stateDir, `${sessionId}.jsonl`);
  if (!existsSync(logFile)) return { reason: 'no_log' };
  const arm = armFromLog(readFileSync(logFile, 'utf8'));
  if (arm === null) return { reason: 'no_log' };
  const found = findTranscripts(sessionId, configDir);
  if (found.length === 0) return { reason: 'no_transcript' };
  if (found.length > 1) return { reason: 'ambiguous_transcript' };
  let text;
  try {
    text = readFileSync(found[0], 'utf8');
  } catch {
    return { reason: 'no_transcript' };
  }
  if (hasApiError(text)) return { reason: 'api_error' };
  const tokens = tokensFromTranscript(text);
  if (tokens === null) return { reason: 'no_transcript' };
  return { row: { arm, ...tokens } };
}
