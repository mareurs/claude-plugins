// Hot view block for the SessionStart hook. Finds lifecycle collections whose
// readme declares `hot_cap`, asks `codescout hot-view <key>` for each, and
// composes one text block. It reads one frontmatter key; everything shown comes
// from the binary. Fails open: any error gives '' (or a per-collection
// "not shown" line), never an exception.
// Spec: docs/superpowers/specs/2026-11-15-session-start-hot-view-design.md
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const LIFECYCLE_DIRS = ['ledgers', 'streams', 'temp'];
export const MAX_COLLECTIONS = 8;
export const TIMEOUT_MS = 3000;

const HEADER = 'HOT VIEW (codescout hot-view; this hook shows collections whose readme declares hot_cap):';
const NOT_SHOWN_PREFIX = 'NOT SHOWN — ';
const UNAVAILABLE = 'hot-view unavailable';

// True when the readme text has a `hot_cap:` key inside its leading frontmatter.
function declaresHotCap(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines[0] !== '---') return false;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return false;
    if (/^hot_cap\s*:/.test(lines[i])) return true;
  }
  return false;
}

export function findHotCollections(root) {
  const keys = new Set();
  for (const lifecycle of LIFECYCLE_DIRS) {
    const base = join(root, 'docs', 'trackers', lifecycle);
    let children;
    try {
      children = readdirSync(base);
    } catch {
      continue;
    }
    for (const key of children) {
      if (key === 'archive') continue;
      try {
        if (!statSync(join(base, key)).isDirectory()) continue;
        if (declaresHotCap(readFileSync(join(base, key, 'readme.md'), 'utf8'))) keys.add(key);
      } catch {
        /* not a collection, or unreadable: not selected */
      }
    }
  }
  return [...keys].sort();
}

// -> { kind: 'shown' | 'quiet', text } | { kind: 'not_shown', reason }
function ask(binary, key, root, timeoutMs) {
  if (!binary) return { kind: 'not_shown', reason: UNAVAILABLE };
  const r = spawnSync(binary, ['hot-view', key, '--project', root], {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const out = typeof r.stdout === 'string' ? r.stdout : '';
  if (r.status === 0 && out.trim()) {
    const text = out.trimEnd();
    // Quiet only when the view is the header line alone. Extra lines (entries, a problems line,
    // an unclassified line) carry information and must reach the agent verbatim.
    const lines = text.split('\n');
    return { kind: lines.length === 1 && lines[0].includes(': 0 of ') ? 'quiet' : 'shown', text };
  }
  const first = out.split('\n')[0];
  if (r.status === 2 && first.startsWith(NOT_SHOWN_PREFIX)) {
    return { kind: 'not_shown', reason: first.slice(NOT_SHOWN_PREFIX.length).trim() || UNAVAILABLE };
  }
  return { kind: 'not_shown', reason: UNAVAILABLE };
}

export function hotViewBlock({ root, binary, timeoutMs = TIMEOUT_MS, maxCollections = MAX_COLLECTIONS }) {
  try {
    const keys = findHotCollections(root);
    if (keys.length === 0) return '';
    const checked = keys.slice(0, maxCollections);
    const rest = keys.slice(maxCollections);
    const views = [];
    const quiet = [];
    const notShown = [];
    for (const key of checked) {
      const a = ask(binary, key, root, timeoutMs);
      if (a.kind === 'shown') views.push(a.text);
      else if (a.kind === 'quiet') quiet.push(key);
      else notShown.push(`${key} (${a.reason})`);
    }
    const lines = [HEADER, ...views];
    if (quiet.length) lines.push(`quiet (0 hot): ${quiet.join(', ')}`);
    if (notShown.length) lines.push(`not shown: ${notShown.join('; ')}`);
    if (rest.length) lines.push(`not checked: ${rest.join(', ')} (limit ${maxCollections} per session start)`);
    return lines.join('\n') + '\n\n';
  } catch {
    return '';
  }
}
