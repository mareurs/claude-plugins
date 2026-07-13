// PreCompact hook — bump the per-session constitution epoch so path-scoped
// (constitution-guard) and global (constitution-brief) rules re-surface after
// compaction. Port of constitution-epoch-bump.sh. No-op if no state file exists.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInput } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const sessionId = input.session_id || '';
if (!sessionId) process.exit(0);

const cwd = input.cwd || process.cwd();
const stateFile = join(cwd, '.codescout', 'constitution-seen', `${sessionId}.json`);
if (!existsSync(stateFile)) process.exit(0); // nothing has fired this session

let state;
try {
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
} catch {
  process.exit(0); // leave a corrupt file untouched rather than overwrite
}
if (!state || typeof state !== 'object' || Array.isArray(state)) process.exit(0);

const newState = {
  epoch: (state.epoch || 0) + 1,
  seen_path_rules: [],
  global_surfaced_epoch: state.global_surfaced_epoch ?? -1,
};
try {
  writeFileSync(stateFile, JSON.stringify(newState));
} catch {
  /* best-effort */
}
process.exit(0);
