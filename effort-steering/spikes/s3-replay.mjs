// Spike S3 (throwaway): offline replay. For each real user prompt in past Claude
// Code transcripts, how many thinking tokens did the turn use, and does any prompt
// feature separate thinking depth? Reports aggregates only. It never prints or
// stores prompt or assistant text; a turn keeps a SHA-256 of its prompt and the
// extracted features.
//
// Usage: node --experimental-strip-types effort-steering/spikes/s3-replay.mjs [projectDir ...]
// Default input: the top-level *.jsonl of the codescout project directory in each of
// the three profiles (.claude-sdd, .claude, .claude-kat). One message.id seen-set
// spans the whole run.
// Output: ${SPIKE_OUT:-${TMPDIR:-/tmp}/effort-steering-spikes}/s3-report.json

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { extractFeatures } from '../core/features.mjs';
import { recordFromObject } from './s2-usage-report.mjs';

const PROJECT_FOLDER = 'projects/-home-marius-work-claude-codescout';
const DEFAULT_DIRS = ['.claude-sdd', '.claude', '.claude-kat'].map((p) => path.join(os.homedir(), p, PROJECT_FOLDER));

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
// Returns 'peer', 'task-notification' or 'command' for a user record that sets off
// an assistant response on its own (so the reply belongs to no human prompt), else
// null. Tool results are never triggers. Command invocations are recognised by the
// `<command-name>` / `<command-message>` echo; other non-prompt records (local
// command output, caveats, interrupt markers, compaction summaries) are not.
export function turnTrigger(obj) {
  if (!obj || obj.type !== 'user' || obj.isSidechain === true) return null;
  if (obj.toolUseResult !== undefined) return null;
  const kind = obj.origin != null ? obj.origin.kind : undefined;
  if (kind === 'peer') return 'peer';
  if (kind === 'task-notification') return 'task-notification';
  if (kind !== undefined && kind !== 'human') return null;
  if (obj.isMeta === true || obj.isCompactSummary === true) return null;
  const content = obj.message && obj.message.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    if (content.some((b) => b && b.type === 'tool_result')) return null;
    const first = content.find((b) => b && b.type === 'text');
    text = first ? String(first.text ?? '') : '';
  }
  return /^\s*<(command-name|command-message)[\s>]/.test(text) ? 'command' : null;
}

function nz(v) {
  return typeof v === 'number' ? v : 0;
}

// Incremental builder so a CLI can feed one line at a time without loading a file.
// One collector per transcript file: turns never span files.
// Incremental builder so a CLI can feed one line at a time without loading a file.
// `opts.seen` is the dedupe set; pass one shared Set to several collectors so a
// message that appears in more than one file counts once across all of them.
//
// A trigger record (see turnTrigger) ends the open turn: assistant messages that
// follow it answer the trigger, not the human prompt, so they are dropped from
// every turn and tallied in dropped() instead. Dropping continues until the next
// real prompt. Tool results do not end a turn.
export function createTurnCollector(dedupeKey, opts = {}) {
  const turns = [];
  const seen = opts.seen || new Set();
  const dropped = {};
  const droppedTurns = {}; // trigger -> Set of human turns that lost replies
  let cur = null; // the open measured turn, or null
  let sink = null; // trigger label while replies are being dropped
  let sinkTurn = null; // the last human turn open when the trigger fired
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
        sink = null;
        sinkTurn = null;
        return;
      }
      const trigger = turnTrigger(obj);
      if (trigger !== null) {
        if (cur !== null) sinkTurn = cur;
        cur = null;
        sink = trigger;
        return;
      }
      if (!obj || obj.type !== 'assistant' || obj.isSidechain === true) return;
      if (cur === null && sink === null) return; // before the first prompt
      const rec = recordFromObject(obj, 0);
      if (!rec) return;
      const id = rec.ids[dedupeKey];
      if (id !== undefined) {
        if (seen.has(id)) return;
        seen.add(id);
      }
      if (cur === null) {
        const d = (dropped[sink] ||= { messages: 0, thinkingTokens: 0, turns: 0 });
        d.messages += 1;
        d.thinkingTokens += nz(rec.thinkingTokens);
        if (sinkTurn !== null) {
          const set = (droppedTurns[sink] ||= new Set());
          if (!set.has(sinkTurn)) {
            set.add(sinkTurn);
            d.turns += 1;
          }
        }
        return;
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
    // trigger -> { messages, thinkingTokens, turns } for replies dropped after a
    // trigger; `turns` counts human turns that lost at least one reply to it.
    dropped() {
      return dropped;
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

// Profile folder name of a project directory (".claude", ".claude-sdd", ...), never
// a full path. Falls back to the directory's own name for a path outside a profile.
export function profileName(dir) {
  const m = /(?:^|[\\/])(\.claude[^\\/]*)[\\/]projects(?:[\\/]|$)/.exec(dir);
  return m ? m[1] : path.basename(dir.replace(/[\\/]+$/, ''));
}

// Turns that carry a measurement: a turn with no deduped assistant message has no
// thinking figure, and counting it as 0 would drag every median down.
export function measuredTurns(turns) {
  return turns.filter((x) => x.messages > 0);
}

// Replay every top-level *.jsonl of each directory, line by line. One message.id
// seen-set spans all files and directories, so a message copied into a resumed
// session counts once. *.jsonl.bak-* files and subdirectories (subagents/) are not
// read. A missing directory counts as 0 files.
export async function replay(dirs, dedupeKey) {
  const seen = new Set();
  const profiles = {};
  const turns = [];
  const dropped = {};
  for (const dir of dirs) {
    const prof = (profiles[profileName(dir)] ||= { files: 0, turns: 0, measured: 0 });
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort();
    } catch {
      continue;
    }
    for (const f of names) {
      const c = createTurnCollector(dedupeKey, { seen });
      const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
      for await (const text of rl) c.push(text);
      prof.files += 1;
      prof.turns += c.turns().length;
      prof.measured += measuredTurns(c.turns()).length;
      turns.push(...c.turns());
      for (const [k, v] of Object.entries(c.dropped())) {
        const d = (dropped[k] ||= { messages: 0, thinkingTokens: 0, turns: 0 });
        d.messages += v.messages;
        d.thinkingTokens += v.thinkingTokens;
        d.turns += v.turns;
      }
    }
  }
  return { profiles, turns, dropped };
}

async function main() {
  const dirs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_DIRS;
  const { profiles, turns: all, dropped } = await replay(dirs, 'message.id');
  const measured = measuredTurns(all);
  const groups = byEffort(measured);
  const report = {
    profiles,
    turnsTotal: all.length,
    turnsWithoutAssistantMessage: all.length - measured.length,
    turnsMeasured: measured.length,
    thinkingTokensMeasured: measured.reduce((s, x) => s + x.thinkingTokens, 0),
    droppedAfterTriggers: dropped,
    effortCounts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    statistic: 'thinkingTokens per turn (sum over deduped assistant messages); replies to peer / task-notification / command records are dropped, not attributed to the previous prompt',
    buckets: { all: bucketReport(measured), byEffort: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, bucketReport(v)])) },
    confounders: CONFOUNDERS,
  };
  const outDir = process.env.SPIKE_OUT || path.join(process.env.TMPDIR || '/tmp', 'effort-steering-spikes');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 's3-report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');

  console.log(`profiles: ${JSON.stringify(report.profiles)}`);
  console.log(`turns=${report.turnsTotal} measured=${report.turnsMeasured} withoutAssistantMessage=${report.turnsWithoutAssistantMessage} thinkingTokensMeasured=${report.thinkingTokensMeasured}`);
  console.log(`dropped after triggers: ${JSON.stringify(report.droppedAfterTriggers)}`);
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
