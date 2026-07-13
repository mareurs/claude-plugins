// PreToolUse hook — enforce path-scoped constitution rules via a one-time-
// per-session deny. Port of constitution-guard.sh. The first time a tool
// touches a path matching a constitution rule this session, the call is denied
// with the rule text (the channel that reliably reaches the model); subsequent
// touches of already-surfaced rules are allowed. constitution-epoch-bump resets
// exposure after a compaction.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readInput, denyPreToolUse } from './lib.mjs';

const DEFAULT_STATE = { epoch: 0, seen_path_rules: [], global_surfaced_epoch: -1 };

const input = readInput();
if (!input) process.exit(0);

const sessionId = input.session_id || '';
if (!sessionId) process.exit(0);

const targetPath = (input.tool_input && (input.tool_input.path || input.tool_input.file_path)) || '';
if (!targetPath) process.exit(0);

const cwd = input.cwd || process.cwd();

// Resolve rules via the codescout binary on PATH (matches the original
// `command -v codescout`). Absent/failed → no enforcement (fail-open).
let raw;
try {
  raw = execFileSync('codescout', ['constitution-check', '--path', targetPath, '--project', cwd], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  process.exit(0);
}

let matches;
try {
  matches = JSON.parse(raw);
} catch {
  process.exit(0);
}
if (!Array.isArray(matches) || matches.length === 0) process.exit(0);

const stateFile = join(cwd, '.codescout', 'constitution-seen', `${sessionId}.json`);
let state = { ...DEFAULT_STATE };
if (existsSync(stateFile)) {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      state = { ...DEFAULT_STATE, ...parsed };
      if (!Array.isArray(state.seen_path_rules)) state.seen_path_rules = [];
    }
  } catch {
    state = { ...DEFAULT_STATE };
  }
}

const key = (m) => `${m.tracker_id}/${m.id}`;
const seen = new Set(state.seen_path_rules);
const unseen = matches.filter((m) => !seen.has(key(m)));
if (unseen.length === 0) process.exit(0);

const reason = unseen.map((m) => `[${m.id}] ${m.title}\n${m.rule}`).join('\n\n');

const newState = { ...state, seen_path_rules: [...state.seen_path_rules, ...unseen.map(key)] };
try {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(newState));
} catch {
  /* best-effort persistence */
}

denyPreToolUse(reason);
process.exit(0);
