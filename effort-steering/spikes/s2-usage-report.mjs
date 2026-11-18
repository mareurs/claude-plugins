// Spike S2 (throwaway): which id field lets us deduplicate repeated usage lines
// of one assistant message in a Claude Code transcript, and is the effort level
// recorded anywhere? Reports aggregates, key names and counts only. It never
// prints or stores prompt or assistant text.
//
// Usage: node --experimental-strip-types effort-steering/spikes/s2-usage-report.mjs [projectDir]
// Output: ${SPIKE_OUT:-${TMPDIR:-/tmp}/effort-steering-spikes}/s2-report.json

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const DEFAULT_DIR = path.join(os.homedir(), '.claude-sdd/projects/-home-marius-work-claude-codescout');
const MAX_ID_DEPTH = 4;

function isIdKey(name) {
  return /^(id|uuid)$/i.test(name) || /(Id|ID|Uuid|UUID)$/.test(name) || /_id$/i.test(name);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Subtrees keyed by dynamic tool-use ids (observed: wireToolInputs.<toolu_...>.id).
// They hold tool inputs, not record identity, and would add one bogus "key" per call.
const SKIP_SUBTREES = new Set(['wireToolInputs']);

// Collect string-valued id-like fields as dotted paths. Arrays are not entered:
// ids inside content blocks (tool_use ids) are per block, not per record.
function collectIds(v, prefix, depth, out) {
  if (depth > MAX_ID_DEPTH || v === null || typeof v !== 'object' || Array.isArray(v)) return;
  for (const [k, val] of Object.entries(v)) {
    if (SKIP_SUBTREES.has(k)) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof val === 'string' && val !== '' && isIdKey(k)) out[p] = val;
    else collectIds(val, p, depth + 1, out);
  }
}

// Build a UsageRecord from an already parsed object, or null when it has no usage.
export function recordFromObject(obj, line) {
  const usage = obj && obj.message && obj.message.usage;
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const ids = {};
  collectIds(obj, '', 1, ids);
  const details = usage.output_tokens_details;
  return {
    line,
    ids,
    thinkingTokens: num(details && details.thinking_tokens),
    outputTokens: num(usage.output_tokens),
    cacheCreation: num(usage.cache_creation_input_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
  };
}

export function usageRecords(lines) {
  const out = [];
  lines.forEach((text, i) => {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return;
    }
    const rec = recordFromObject(obj, i + 1);
    if (rec) out.push(rec);
  });
  return out;
}

export function dedupeKeyReport(records) {
  const keys = new Set();
  for (const r of records) for (const k of Object.keys(r.ids)) keys.add(k);
  return [...keys].sort().map((key) => {
    const groups = new Map();
    for (const r of records) {
      const id = r.ids[key];
      if (id === undefined) continue;
      if (!groups.has(id)) groups.set(id, new Set());
      groups.get(id).add(r.thinkingTokens);
    }
    let consistent = true;
    for (const s of groups.values()) if (s.size > 1) consistent = false;
    return { key, groups: groups.size, consistent };
  });
}

// Add every key path matching /effort/i found in obj to acc (path -> count).
// Array indexes are normalised to [].
export function addEffortPaths(obj, acc) {
  const walk = (v, p) => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, `${p}[]`);
      return;
    }
    for (const [k, val] of Object.entries(v)) {
      const q = p ? `${p}.${k}` : k;
      if (/effort/i.test(k)) acc[q] = (acc[q] || 0) + 1;
      walk(val, q);
    }
  };
  walk(obj, '');
}

export function effortKeyPaths(lines) {
  const acc = {};
  for (const text of lines) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      continue;
    }
    addEffortPaths(obj, acc);
  }
  return acc;
}

// ---- CLI: scan every top-level *.jsonl of a project directory, line by line.

async function main() {
  const dir = process.argv[2] || DEFAULT_DIR;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  const records = [];
  const effortPaths = {};
  const effortOnUsage = { withEffortKey: 0, withoutEffortKey: 0 };
  const effortValues = {};
  const perTurnEffortValues = {};
  const effortByMessage = new Map(); // message.id -> Set of effort values
  const effortBySession = new Map(); // sessionId -> Set of effort values
  let lineCount = 0;
  let parseFailures = 0;

  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
    let n = 0;
    for await (const text of rl) {
      n++;
      lineCount++;
      const hasUsage = text.includes('"usage"');
      const hasEffort = /effort/i.test(text);
      if (!hasUsage && !hasEffort) continue;
      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        parseFailures++;
        continue;
      }
      if (hasEffort) addEffortPaths(obj, effortPaths);
      const rec = hasUsage ? recordFromObject(obj, n) : null;
      if (!rec) continue;
      records.push(rec);
      const eff = typeof obj.effort === 'string' ? obj.effort : null;
      if (eff !== null) {
        effortOnUsage.withEffortKey++;
        effortValues[eff] = (effortValues[eff] || 0) + 1;
      } else {
        effortOnUsage.withoutEffortKey++;
      }
      const pt = obj.perTurnEffort === undefined ? 'absent' : obj.perTurnEffort === null ? 'null' : String(obj.perTurnEffort);
      perTurnEffortValues[pt] = (perTurnEffortValues[pt] || 0) + 1;
      const mid = rec.ids['message.id'];
      if (mid !== undefined) {
        if (!effortByMessage.has(mid)) effortByMessage.set(mid, new Set());
        effortByMessage.get(mid).add(eff);
      }
      const sid = rec.ids['sessionId'];
      if (sid !== undefined) {
        if (!effortBySession.has(sid)) effortBySession.set(sid, new Set());
        effortBySession.get(sid).add(eff);
      }
    }
  }

  const keyReport = dedupeKeyReport(records).map((r) => {
    const groups = new Map();
    let recordsWithKey = 0;
    for (const rec of records) {
      const id = rec.ids[r.key];
      if (id === undefined) continue;
      recordsWithKey++;
      if (!groups.has(id)) groups.set(id, new Set());
      groups.get(id).add(rec.thinkingTokens);
    }
    let inconsistentGroups = 0;
    for (const s of groups.values()) if (s.size > 1) inconsistentGroups++;
    return { ...r, recordsWithKey, inconsistentGroups };
  });

  // Do the other usage fields also agree within a message.id group?
  const fieldVariation = { groups: 0, outputTokens: 0, cacheCreation: 0, cacheRead: 0 };
  const byMessage = new Map();
  for (const rec of records) {
    const id = rec.ids['message.id'];
    if (id === undefined) continue;
    if (!byMessage.has(id)) byMessage.set(id, []);
    byMessage.get(id).push(rec);
  }
  for (const recs of byMessage.values()) {
    fieldVariation.groups++;
    for (const f of ['outputTokens', 'cacheCreation', 'cacheRead']) {
      if (new Set(recs.map((r) => r[f])).size > 1) fieldVariation[f]++;
    }
  }

  const multi = (m) => [...m.values()].filter((s) => s.size > 1).length;
  const report = {
    files: files.length,
    lines: lineCount,
    parseFailures,
    usageRecords: records.length,
    dedupeKeys: keyReport,
    messageIdGroupsWhereFieldDiffers: fieldVariation,
    effortKeyPaths: effortPaths,
    effortOnUsageRecords: effortOnUsage,
    topLevelEffortValueCounts: effortValues,
    perTurnEffortValueCounts: perTurnEffortValues,
    messageIdsWithMoreThanOneEffortValue: multi(effortByMessage),
    sessionsWithMoreThanOneEffortValue: multi(effortBySession),
    sessions: effortBySession.size,
  };
  const outDir = process.env.SPIKE_OUT || path.join(process.env.TMPDIR || '/tmp', 'effort-steering-spikes');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 's2-report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${outFile}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
