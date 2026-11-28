// Hot view block for the SessionStart hook. Asks `codescout box --json` which collections
// declare a hot_cap, asks `codescout hot-view <name>` for each, and composes one text block.
// It builds no tracker path and reads no readme; everything comes from the binary. Fails
// open: any error gives '' (or a per-collection "not shown" line), never an exception.
// Spec: docs/superpowers/specs/2026-11-15-session-start-hot-view-design.md
import { spawnSync } from 'node:child_process';
import { codescoutJson } from './lib.mjs';

export const MAX_COLLECTIONS = 8;
export const TIMEOUT_MS = 3000;

const HEADER = 'HOT VIEW (codescout hot-view; this hook shows collections whose readme declares hot_cap):';
const NOT_SHOWN_PREFIX = 'NOT SHOWN — ';
const UNAVAILABLE = 'hot-view unavailable';

// The names to pass to `codescout hot-view`, sorted: every item of `collections` in
// `codescout box --project <root> --json` whose `hot_cap` is a number and that has no
// `problem`. `address` is the name once codescout groups collections into boxes, else `key`.
// Any other answer selects nothing: no binary, a timeout, a failed call, an old binary whose
// items have no `hot_cap`, and the old-layout refusal `{"done":false,...}` a repository
// gets before `codescout box migrate`.
export function findHotCollections(root, binary, timeoutMs = TIMEOUT_MS) {
  const answer = codescoutJson(binary, ['box', '--project', root, '--json'], timeoutMs);
  const items = Array.isArray(answer?.collections) ? answer.collections : [];
  const names = new Set();
  for (const item of items) {
    if (!item || typeof item.hot_cap !== 'number' || item.problem) continue;
    const name = item.address ?? item.key;
    if (typeof name === 'string' && name) names.add(name);
  }
  return [...names].sort();
}

// -> { kind: 'shown' | 'quiet', text } | { kind: 'not_shown', reason }
function ask(binary, key, root, timeoutMs) {
  if (!binary) return { kind: 'not_shown', reason: UNAVAILABLE };
  const r = spawnSync(binary, ['hot-view', key, '--project', root], {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
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
    const keys = findHotCollections(root, binary, timeoutMs);
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
