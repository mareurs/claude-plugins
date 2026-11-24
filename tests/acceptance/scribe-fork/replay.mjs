// Replay real transcripts through the scribe-nudge detector. Offline, no model calls.
//
// usage: node tests/acceptance/scribe-fork/replay.mjs <files.txt> [out.jsonl]
//   files.txt  one transcript path per line (relative to $HOME or absolute); prefilter with
//              grep -rl 'codescout box' so only candidate files are read
//   out.jsonl  every extracted box command with its verdicts (default: $HOME/.cache/scribe-acc/replay.jsonl)
//
// Reads every tool call of those transcripts (deduplicated by tool_use id: a resumed session repeats
// its history) and keeps each Bash / codescout run_command call that holds `codescout box`. Reports:
//   - the detector's verdict against a naive regex baseline;
//   - the verb mix for the main agent and for subagents (`isSidechain` or a /subagents/ path);
//   - the refusals the hook would have made per main-agent session, with a 30-minute window and with
//     one refusal per session, split by the share of the session's tool calls that were box writes.
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { boxWriteVerb, WRITE_VERBS } = await import(join(here, '../../../codescout-companion/hooks/scribe-rules.mjs'));

const files = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)
  .map((f) => (isAbsolute(f) ? f : join(homedir(), f)));
const outPath = process.argv[3] || join(homedir(), '.cache/scribe-acc/replay.jsonl');
const WINDOW_MS = 30 * 60 * 1000;
const NAIVE = new RegExp(`\\bcodescout\\s+box\\b[^\\n]*?\\b(${WRITE_VERBS.join('|')})\\b`);

const seen = new Set();
const rows = [];
const totals = new Map(); // main-agent tool calls per session, box or not
for (const file of files) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"tool_use"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const content = e.message && e.message.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type !== 'tool_use' || seen.has(c.id)) continue;
      seen.add(c.id);
      const side = e.isSidechain === true || file.includes('/subagents/') ? 'sub' : 'main';
      const session = e.sessionId || file;
      if (side === 'main') totals.set(session, (totals.get(session) || 0) + 1);
      if (!['Bash', 'mcp__codescout__run_command'].includes(c.name)) continue;
      const cmd = c.input && c.input.command;
      if (typeof cmd !== 'string' || !cmd.includes('codescout') || !cmd.includes('box')) continue;
      rows.push({
        id: c.id, side, tool: c.name, session, ts: Date.parse(e.timestamp) || 0,
        verb: boxWriteVerb(cmd), naive: (NAIVE.exec(cmd) || [])[1] || null, cmd: cmd.slice(0, 600),
      });
    }
  }
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
console.log(`files read: ${files.length}; box commands (deduplicated): ${rows.length}`);
console.log('by side:', count(rows, (r) => r.side));
console.log('detector verb, main:', count(rows.filter((r) => r.side === 'main'), (r) => r.verb || 'none'));
console.log('detector verb, sub: ', count(rows.filter((r) => r.side === 'sub'), (r) => r.verb || 'none'));
const agree = rows.filter((r) => r.verb === r.naive).length;
const detOnly = rows.filter((r) => r.verb && !r.naive).length;
const naiveOnly = rows.filter((r) => !r.verb && r.naive).length;
const differ = rows.filter((r) => r.verb && r.naive && r.verb !== r.naive).length;
console.log(`detector vs naive: agree ${agree}, detector-only ${detOnly}, naive-only ${naiveOnly}, different verb ${differ}`);

// Per main-agent session: the hook's refusals under two rules, bucketed by the box-write share.
const bySession = new Map();
for (const r of rows.filter((r) => r.side === 'main' && r.verb && r.ts)) {
  if (!bySession.has(r.session)) bySession.set(r.session, []);
  bySession.get(r.session).push(r);
}
const BUCKETS = [['<5%', 0.05], ['5-20%', 0.2], ['20-50%', 0.5], ['>=50%', Infinity]];
const stat = BUCKETS.map(([name]) => ({ name, sessions: 0, calls: 0, writes: 0, window: 0, once: 0 }));
const firstVerb = {};
for (const writes of bySession.values()) {
  writes.sort((a, b) => a.ts - b.ts);
  const total = totals.get(writes[0].session) || writes.length;
  const share = writes.length / total;
  const b = stat[BUCKETS.findIndex(([, hi]) => share < hi)];
  let marker = -Infinity;
  let refusals = 0;
  for (const w of writes) {
    if (w.ts - marker >= WINDOW_MS) { refusals += 1; marker = w.ts; }
  }
  b.sessions += 1; b.calls += total; b.writes += writes.length; b.window += refusals; b.once += 1;
  firstVerb[writes[0].verb] = (firstVerb[writes[0].verb] || 0) + 1;
}
console.log(`main sessions with a box write: ${bySession.size}`);
console.log('box-write share of the session\'s tool calls:');
for (const b of stat) console.log(`  ${b.name.padEnd(7)} sessions ${String(b.sessions).padStart(3)}  tool calls ${String(b.calls).padStart(6)}  box writes ${String(b.writes).padStart(4)}  refusals: 30-min window ${String(b.window).padStart(3)}, once per session ${String(b.once).padStart(3)}`);
console.log('verb of the first write in each session:', firstVerb);
console.log('detail written to', outPath);
