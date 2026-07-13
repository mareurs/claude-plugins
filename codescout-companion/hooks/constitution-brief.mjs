// UserPromptSubmit hook — surface global (path-less) constitution rules once
// per epoch via additionalContext. Port of constitution-brief.sh. Calls
// `codescout constitution-check --project <cwd>` (no --path) on PATH.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readInput, emit } from './lib.mjs';

const DEFAULT_STATE = { epoch: 0, seen_path_rules: [], global_surfaced_epoch: -1 };

const input = readInput();
if (!input) process.exit(0);

const sessionId = input.session_id || '';
if (!sessionId) process.exit(0);

const cwd = input.cwd || process.cwd();
const stateFile = join(cwd, '.codescout', 'constitution-seen', `${sessionId}.json`);
try {
  mkdirSync(dirname(stateFile), { recursive: true });
} catch {
  /* best-effort */
}

let state = { ...DEFAULT_STATE };
if (existsSync(stateFile)) {
  try {
    const p = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (p && typeof p === 'object' && !Array.isArray(p)) state = { ...DEFAULT_STATE, ...p };
  } catch {
    /* keep default */
  }
} else {
  try {
    writeFileSync(stateFile, JSON.stringify(DEFAULT_STATE));
  } catch {
    /* best-effort */
  }
}

const epoch = state.epoch ?? 0;
if (epoch === (state.global_surfaced_epoch ?? -1)) process.exit(0); // already surfaced this epoch

let raw;
try {
  raw = execFileSync('codescout', ['constitution-check', '--project', cwd], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  process.exit(0); // codescout absent → no enforcement
}

let rules;
try {
  rules = JSON.parse(raw);
} catch {
  process.exit(0);
}
if (!Array.isArray(rules) || rules.length === 0) process.exit(0);

const digest = rules.map((r) => `[${r.id}] ${r.title}\n${r.rule}`).join('\n\n');

try {
  writeFileSync(stateFile, JSON.stringify({ ...state, global_surfaced_epoch: epoch }));
} catch {
  /* best-effort */
}

emit({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: `Constitution rules — must follow no matter what:\n\n${digest}`,
  },
});
process.exit(0);
