// Spike S3 (throwaway): offline replay. For each real user prompt in past Claude
// Code transcripts, how many thinking tokens did the turn use, and does any prompt
// feature separate thinking depth? Reports aggregates only. It never prints or
// stores prompt or assistant text; a turn keeps a SHA-256 of its prompt and the
// extracted features.
//
// Usage: node --experimental-strip-types effort-steering/spikes/s3-replay.mjs [projectDir]
// Output: ${SPIKE_OUT:-${TMPDIR:-/tmp}/effort-steering-spikes}/s3-report.json

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { extractFeatures } from '../core/features.mjs';
import { recordFromObject } from './s2-usage-report.mjs';

const DEFAULT_DIR = path.join(os.homedir(), '.claude-sdd/projects/-home-marius-work-claude-codescout');

// Text that appears in `type: "user"` records which a person did not type: command
// echoes, local command output, task notifications, system reminders, and the
// marker written when a turn is interrupted.
const NON_PROMPT_TEXT = /^\s*(<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|system-reminder)[\s>]|\[Request interrupted)/;

// Returns the typed prompt text of a parsed record, or null when the record is not
// a real user prompt. Fields found in real transcripts (S3 Step 1):
//   type === 'user'
//   isSidechain !== true        sidechain records
//   isMeta !== true             injected context, peer messages, command caveats
//   toolUseResult === undefined and no tool_result block: tool results (39k of 44k user records)
//   isCompactSummary !== true   compaction summaries (also isVisibleInTranscriptOnly)
//   origin absent or origin.kind === 'human': not 'peer' or 'task-notification'
//   text not starting with a command echo / output / notification tag or an interrupt marker
export function realPromptText(obj) {
  if (!obj || obj.type !== 'user') return null;
  if (obj.isSidechain === true || obj.isMeta === true || obj.isCompactSummary === true) return null;
  if (obj.toolUseResult !== undefined) return null;
  if (obj.origin != null && obj.origin.kind !== 'human') return null;
  const content = obj.message && obj.message.content;
  let text;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((b) => !b || (b.type !== 'text' && b.type !== 'image'))) return null;
    text = content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('\n');
  } else {
    return null;
  }
  if (text.trim() === '' || NON_PROMPT_TEXT.test(text)) return null;
  return text;
}

function nz(v) {
  return typeof v === 'number' ? v : 0;
}

// Incremental builder so a CLI can feed one line at a time without loading a file.
// One collector per transcript file: turns never span files.
export function createTurnCollector(dedupeKey) {
  const turns = [];
  const seen = new Set();
  let cur = null;
  return {
    push(text) {
      if (!text.includes('"user"') && !text.includes('"assistant"')) return;
      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        return;
      }
      const prompt = realPromptText(obj);
      if (prompt !== null) {
        cur = {
          promptSha256: crypto.createHash('sha256').update(prompt).digest('hex'),
          features: extractFeatures(prompt),
          thinkingTokens: 0,
          outputTokens: 0,
          cacheCreation: 0,
          effort: null,
          messages: 0,
        };
        turns.push(cur);
        return;
      }
      if (cur === null || !obj || obj.type !== 'assistant' || obj.isSidechain === true) return;
      const rec = recordFromObject(obj, 0);
      if (!rec) return;
      const id = rec.ids[dedupeKey];
      if (id !== undefined) {
        if (seen.has(id)) return;
        seen.add(id);
      }
      cur.thinkingTokens += nz(rec.thinkingTokens);
      cur.outputTokens += nz(rec.outputTokens);
      cur.cacheCreation += nz(rec.cacheCreation);
      cur.messages += 1;
      if (cur.effort === null && typeof obj.effort === 'string') cur.effort = obj.effort;
    },
    turns() {
      return turns;
    },
  };
}

// A turn starts at a real user prompt and ends at the next one. Assistant messages
// before the first prompt are ignored. Messages are deduplicated on `dedupeKey`
// (S2 found 'message.id'); a record without that key is never deduplicated.
export function turnsFromTranscript(lines, dedupeKey) {
  const c = createTurnCollector(dedupeKey);
  for (const line of lines) c.push(line);
  return c.turns();
}

// Sorted-copy statistics. Empty input gives 0 so an empty bucket prints as n=0.
export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function p90(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.9 * s.length) - 1];
}

const BUCKETS = [
  ['all', () => true],
  ['chars<=40', (f) => f.chars <= 40],
  ['chars41-400', (f) => f.chars > 40 && f.chars <= 400],
  ['chars>400', (f) => f.chars > 400],
  ['isQuestion', (f) => f.isQuestion],
  ['hasStackTrace', (f) => f.hasStackTrace],
  ['startsWithSlash', (f) => f.startsWithSlash],
  ['explicitDeep', (f) => f.explicitDeep],
];

// Statistics are over thinkingTokens. Buckets overlap: a turn can be in several.
export function bucketReport(turns) {
  return BUCKETS.map(([name, pred]) => {
    const vals = turns.filter((x) => pred(x.features)).map((x) => x.thinkingTokens);
    return { name, n: vals.length, median: median(vals), p90: p90(vals) };
  });
}

// Group turns by effort level; a turn with no recorded effort goes under 'unknown'.
export function byEffort(turns) {
  const out = {};
  for (const x of turns) {
    const k = x.effort === null || x.effort === undefined ? 'unknown' : x.effort;
    (out[k] ||= []).push(x);
  }
  return out;
}

// ---- CLI

const CONFOUNDERS = [
  'Adaptive thinking is on: the model decides its own thinking depth, so thinking_tokens is an outcome of the model, not a controlled variable.',
  'Effort level is read from the top-level `effort` field of assistant records (found by S2). It varies within 26 of 59 sessions, so the per-effort tables separate it; the pooled table mixes prompt type with effort.',
  'Buckets overlap (one turn can be in several) and the features are weak labels; a bucket median is not a causal effect of the prompt.',
];

function table(title, rows) {
  console.log(`\n${title}`);
  console.log('bucket'.padEnd(18) + 'n'.padStart(7) + 'median'.padStart(9) + 'p90'.padStart(9));
  for (const r of rows) console.log(r.name.padEnd(18) + String(r.n).padStart(7) + String(r.median).padStart(9) + String(r.p90).padStart(9));
}

async function main() {
  const dir = process.argv[2] || DEFAULT_DIR;
  // Top-level transcripts only: skip *.jsonl.bak-* files and subagents/ subdirectories.
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort();
  const all = [];
  for (const f of files) {
    const c = createTurnCollector('message.id');
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
    for await (const text of rl) c.push(text);
    all.push(...c.turns());
  }
  // A turn with no assistant message (interrupted before any reply) has no thinking
  // measurement; counting it as 0 would bias every median down, so it is excluded.
  const measured = all.filter((x) => x.messages > 0);
  const groups = byEffort(measured);
  const report = {
    files: files.length,
    turnsTotal: all.length,
    turnsWithoutAssistantMessage: all.length - measured.length,
    turnsMeasured: measured.length,
    effortCounts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    statistic: 'thinkingTokens per turn (sum over deduped assistant messages)',
    buckets: { all: bucketReport(measured), byEffort: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, bucketReport(v)])) },
    confounders: CONFOUNDERS,
  };
  const outDir = process.env.SPIKE_OUT || path.join(process.env.TMPDIR || '/tmp', 'effort-steering-spikes');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 's3-report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');

  console.log(`files=${report.files} turns=${report.turnsTotal} measured=${report.turnsMeasured} withoutAssistantMessage=${report.turnsWithoutAssistantMessage}`);
  console.log(`effort counts: ${JSON.stringify(report.effortCounts)}`);
  table('ALL EFFORT LEVELS (thinking tokens per turn)', report.buckets.all);
  for (const [k, rows] of Object.entries(report.buckets.byEffort)) table(`effort=${k}`, rows);
  console.log('\nCONFOUNDERS');
  for (const c of CONFOUNDERS) console.log(`- ${c}`);
  console.log(`\nwrote ${outFile}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
