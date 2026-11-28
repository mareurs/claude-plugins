import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The hook daemon (hookd.mjs) is detached, so it has no console. A console program it starts then
// makes Windows allocate a new console, and with Windows Terminal as the default terminal each one
// opens a window (a visible `git.exe` or `codescout.exe` for 1-2 s on every edit and every git
// command). A hook run as a child of Claude Code's shell inherited a hidden console and never showed
// it. Every process a hook starts therefore passes `windowsHide: true` (CREATE_NO_WINDOW), or is
// itself detached (a detached process gets no console at all).
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SOURCES = [HERE, join(ROOT, 'background-wake'), join(ROOT, 'background-wake', 'adapters')];

const SPAWN = /(?<![.\w])(execFileSync|execFile|spawnSync|spawn|execSync)\(/g;

// The text of a call, from its opening paren to the matching close paren.
function callText(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

const files = SOURCES.flatMap((dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.mjs') && !/\.test\./.test(f) && f !== 'test-support.mjs').map((f) => join(dir, f));
  } catch { return []; }
});

test('the scan finds the hook sources and the calls it must judge', () => {
  assert.ok(files.length > 20, `expected the hook sources, found ${files.length}`);
  const calls = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(SPAWN)]);
  assert.ok(calls.length >= 10, `expected the known spawn calls, found ${calls.length}`);
});

test('every process a hook starts hides its console window or is detached', () => {
  const offenders = [];
  for (const file of files) {
    // Comment lines are blanked (line numbers kept): a comment may name the call without making it.
    const src = readFileSync(file, 'utf8').split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
    for (const m of src.matchAll(SPAWN)) {
      const text = callText(src, m.index + m[0].length - 1);
      if (/windowsHide\s*:\s*true/.test(text) || /detached\s*:\s*true/.test(text)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${file.slice(ROOT.length + 1)}:${line} ${m[1]}(…)`);
    }
  }
  assert.deepEqual(offenders, [], 'these calls open a console window when the caller has no console');
});
