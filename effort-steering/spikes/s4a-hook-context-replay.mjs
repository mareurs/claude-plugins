// Spike S4a (throwaway): what do transcripts record for UserPromptSubmit hooks?
// Counts only; it never prints or stores prompt or hook text.
//
// Records read: {"type":"attachment","attachment":{"type":"hook_additional_context"|"hook_success",
// "hookName":..., "hookEvent":"UserPromptSubmit"}}. Measured 2026-10-05: in the real
// transcripts UserPromptSubmit output is recorded only as `hook_success` (71 records,
// 35 files); `hook_additional_context` appears there for PostToolUse, SessionStart and
// PreToolUse only. Both types are accepted. Only hookEvent === 'UserPromptSubmit'
// counts. An attachment belongs to the most recent context: a human prompt (a "turn"),
// or a non-human trigger (peer, task-notification, command; see turnTrigger). Same R9
// rule as the S3 collector: a command echo before any assistant reply of a human turn
// is that prompt's own expansion and does not open a new context.
//
// `orders` has an entry only for contexts with 2+ hooks, keyed "A>B" in record order.
//
// Usage: node --experimental-strip-types effort-steering/spikes/s4a-hook-context-replay.mjs [projectDir ...]
// Default input: the top-level *.jsonl of every project directory in each of the
// three profiles, resolved the way S3 does (home dir + .claude-sdd/.claude/.claude-kat).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { realPromptText, turnTrigger } from './s3-replay.mjs';

export function replayHookContext(lines) {
  const out = {
    turns: 0,
    withAttachment: 0,
    multiHookTurns: 0,
    orders: {},
    nonHumanWithAttachment: { peer: 0, 'task-notification': 0, command: 0 },
  };
  let ctx = null; // { kind: 'human' | trigger label, hooks: string[], replied: boolean }
  const close = () => {
    if (ctx === null || ctx.hooks.length === 0) return;
    out.withAttachment += 1;
    if (ctx.kind !== 'human') out.nonHumanWithAttachment[ctx.kind] += 1;
    if (ctx.hooks.length > 1) {
      out.multiHookTurns += 1;
      const key = ctx.hooks.join('>');
      out.orders[key] = (out.orders[key] || 0) + 1;
    }
  };
  for (const text of lines) {
    if (!text.includes('"user"') && !text.includes('"assistant"') && !text.includes('"attachment"')) continue;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      continue;
    }
    if (obj && obj.type === 'attachment') {
      const a = obj.attachment;
      if (ctx !== null && a && (a.type === 'hook_additional_context' || a.type === 'hook_success') && a.hookEvent === 'UserPromptSubmit') {
        ctx.hooks.push(String(a.hookName ?? ''));
      }
      continue;
    }
    if (realPromptText(obj) !== null) {
      close();
      out.turns += 1;
      ctx = { kind: 'human', hooks: [], replied: false };
      continue;
    }
    const trigger = turnTrigger(obj);
    if (trigger !== null) {
      if (trigger === 'command' && ctx !== null && ctx.kind === 'human' && !ctx.replied) continue;
      close();
      ctx = { kind: trigger, hooks: [], replied: false };
      continue;
    }
    if (obj && obj.type === 'assistant' && obj.isSidechain !== true && ctx !== null) ctx.replied = true;
  }
  close();
  return out;
}

function mergeInto(total, r) {
  total.turns += r.turns;
  total.withAttachment += r.withAttachment;
  total.multiHookTurns += r.multiHookTurns;
  for (const [k, v] of Object.entries(r.orders)) total.orders[k] = (total.orders[k] || 0) + v;
  for (const k of Object.keys(total.nonHumanWithAttachment)) total.nonHumanWithAttachment[k] += r.nonHumanWithAttachment[k];
}

function defaultDirs() {
  const dirs = [];
  for (const p of ['.claude-sdd', '.claude', '.claude-kat']) {
    const root = path.join(os.homedir(), p, 'projects');
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) if (e.isDirectory()) dirs.push(path.join(root, e.name));
  }
  return dirs;
}

function main() {
  const dirs = process.argv.length > 2 ? process.argv.slice(2) : defaultDirs();
  const total = {
    files: 0,
    turns: 0,
    withAttachment: 0,
    multiHookTurns: 0,
    orders: {},
    nonHumanWithAttachment: { peer: 0, 'task-notification': 0, command: 0 },
  };
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      total.files += 1;
      mergeInto(total, replayHookContext(fs.readFileSync(path.join(dir, name), 'utf8').split('\n')));
    }
  }
  console.log(JSON.stringify(total, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
