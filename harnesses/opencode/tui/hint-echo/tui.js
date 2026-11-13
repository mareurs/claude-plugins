// hint-echo for OpenCode — TUI part. Port of hint-echo/ (a Claude Code mod).
//
// On Claude Code, hint-echo hooks PreToolUse/PostToolUse/PostToolUseFailure and writes each
// `additionalContext` entry as a dim transcript row, because Claude Code shows that text to
// the model but not to the user. On OpenCode the same advisories are pushed onto a tool
// result's `content` by the bridges (codescout-companion.js, sdd.js, buddy.js), inside the
// background service — a different process from this TUI. So the bridges also append each
// advisory to a JSONL channel (lib/host.mjs → echoHint) and this plugin tails it.
//
//   Claude Code hint-echo                 here
//   ───────────────────────────────────── ────────────────────────────────────────────────
//   dim transcript row                    a toast: "hook told the model after <tool>: …"
//   text over 400 characters is cut       same
//   SessionStart blocks are not echoed    same: only tool-call advisories enter the channel
//   only reads; never changes what the    same: the channel is written after the advisory
//   model receives                        is already on the result
//
// Only advisories for the session family on screen are shown; with no session open, all
// are. Lines written before this TUI started are not replayed.
import { closeSync, existsSync, mkdirSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// No static import outside this directory: see lib/tui.mjs (symlinked plugin dirs).
const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const lib = (name) => import(pathToFileURL(join(HERE, '..', '..', 'lib', name)).href);

export const MAX_CHARS = 400;

export function hintMessage(rec) {
  const text = String(rec?.text || '').replace(/\s+/g, ' ').trim();
  const cut = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
  return `hook told the model after ${rec?.tool || 'a tool'}: ${cut}`;
}

// Should a record be shown, given the session on screen? Same family = same root.
// `rootOf(sid)` maps a session to its family root.
export function relevant(rec, viewing, rootOf = (s) => s) {
  if (!viewing) return true;
  if (!rec?.sessionID) return true;
  return rootOf(rec.sessionID) === rootOf(viewing);
}

// Read the bytes appended since `offset`; returns {records, offset}. A file that shrank
// was rotated (lib/host.mjs renames it to .1), so reading restarts at 0.
export function readNew(file, offset) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return { records: [], offset: 0 };
  }
  if (size < offset) offset = 0;
  if (size === offset) return { records: [], offset };
  const len = Math.min(size - offset, 1 << 20);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, len, offset);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString('utf8');
  const end = text.lastIndexOf('\n');
  if (end < 0) return { records: [], offset }; // a half-written line: wait for the rest
  const records = [];
  for (const line of text.slice(0, end).split('\n')) {
    try {
      if (line.trim()) records.push(JSON.parse(line));
    } catch {
      /* skip a corrupt line */
    }
  }
  return { records, offset: offset + Buffer.byteLength(text.slice(0, end + 1)) };
}

export default {
  id: 'sdd-misc.hint-echo',
  async setup(api) {
    let hintEchoDir, hintEchoFile, currentSessionID, rootOf;
    try {
      ({ hintEchoDir, hintEchoFile } = await lib('host.mjs'));
      ({ currentSessionID, rootOf } = await lib('tui.mjs'));
    } catch (e) {
      process.stderr.write(`hint-echo: shared lib unavailable — ${e?.message || e}\n`);
      return;
    }
    try {
      mkdirSync(hintEchoDir(), { recursive: true }); // turns the bridges' channel on
    } catch {
      /* cannot create: the bridges stay silent, nothing breaks */
    }
    const file = hintEchoFile();
    let offset = 0;
    try {
      offset = existsSync(file) ? statSync(file).size : 0; // no replay of old hints
    } catch {
      offset = 0;
    }
    const poll = () => {
      let res;
      try {
        res = readNew(file, offset);
      } catch {
        return;
      }
      offset = res.offset;
      const viewing = currentSessionID(api);
      for (const rec of res.records) {
        if (!relevant(rec, viewing, (s) => rootOf(api, s))) continue;
        try {
          api.ui.toast.show({ title: rec.source || 'hook', message: hintMessage(rec), variant: 'info', duration: 8000 });
        } catch {
          /* no toast surface */
        }
      }
    };
    const timer = setInterval(poll, 750);
    return () => clearInterval(timer);
  },
};
