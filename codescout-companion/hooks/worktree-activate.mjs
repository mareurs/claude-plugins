// PostToolUse hook — after EnterWorktree: inject workspace guidance, create the
// .cs-worktree-pending marker (blocks writes until workspace()), write the
// codescout-active marker, and best-effort symlink .codescout/ into the worktree.
// Port of worktree-activate.sh. No-op if codescout is not configured.
import { existsSync, statSync, lstatSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { readInput, detectFor, git, emit } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);
if ((input.tool_name || '') !== 'EnterWorktree') process.exit(0);

// CWD here is the ORIGINAL project (before the worktree switch).
const cwd = input.cwd || '';
if (detectFor(cwd).HAS_CODESCOUT === 'false') process.exit(0);

const tr = input.tool_response || {};
let worktreePath = tr.worktree_path || tr.path || '';

if (!worktreePath) {
  // Fallback: most recently created linked worktree (by mtime; list order is not creation order).
  const mainRoot = git(cwd, ['rev-parse', '--show-toplevel']);
  const porcelain = git(cwd, ['worktree', 'list', '--porcelain']) || '';
  let best = '';
  let bestMtime = -1;
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const wt = line.slice('worktree '.length);
    if (!wt || wt === mainRoot) continue;
    let st;
    try {
      st = statSync(wt);
    } catch {
      continue;
    }
    if (st.isDirectory() && st.mtimeMs > bestMtime) {
      bestMtime = st.mtimeMs;
      best = wt;
    }
  }
  worktreePath = best;
}

if (!worktreePath) process.exit(0);
try {
  if (!statSync(worktreePath).isDirectory()) process.exit(0);
} catch {
  process.exit(0);
}

// codescout-active marker (statusline reads the declared worktree).
const sessionId = input.session_id || '';
if (sessionId) {
  const cfg = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || process.env.USERPROFILE || homedir(), '.claude');
  try {
    mkdirSync(join(cfg, 'codescout-active'), { recursive: true });
    writeFileSync(join(cfg, 'codescout-active', sessionId), worktreePath);
  } catch {
    /* best-effort */
  }
}

// Pending marker (worktree entered, workspace not yet called).
try {
  writeFileSync(join(worktreePath, '.cs-worktree-pending'), '');
} catch {
  /* best-effort */
}

emit({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: `WORKTREE DETECTED: codescout must switch to the worktree.
Call workspace(action="activate", path="${worktreePath}") NOW as your next action.
MCP write tools (edit_code, edit_file, edit_markdown, create_file) are BLOCKED
until workspace is called — they would otherwise silently write to the wrong repo.
Do NOT run index in worktrees — the shared index is read-only here.`,
  },
});

// --- Symlink .codescout/ into the worktree (best-effort) ---
let ceDir = '';
let check = cwd;
while (check && check !== '/') {
  if (existsSync(join(check, '.codescout'))) {
    ceDir = join(check, '.codescout');
    break;
  }
  const parent = dirname(check);
  if (parent === check) break;
  check = parent;
}

if (!ceDir) {
  const mainRoot = git(cwd, ['rev-parse', '--show-toplevel']);
  if (mainRoot) {
    try {
      mkdirSync(join(mainRoot, '.codescout'), { recursive: true });
      ceDir = join(mainRoot, '.codescout');
    } catch {
      /* best-effort */
    }
  }
}

if (!ceDir) process.exit(0);

const dest = join(worktreePath, basename(ceDir));
if (!existsSync(dest)) {
  try {
    symlinkSync(ceDir, dest, 'junction'); // junction: Windows-safe (no admin), symlink on POSIX
  } catch {
    /* best-effort */
  }
}

// Fallback: worktree has a real .codescout dir (not a symlink) → link shared assets.
let destStat;
try {
  destStat = lstatSync(dest);
} catch {
  /* dest absent */
}
if (destStat && destStat.isDirectory() && !destStat.isSymbolicLink()) {
  for (const asset of ['embeddings']) {
    const src = join(ceDir, asset);
    const dst = join(dest, asset);
    if (!existsSync(src)) continue;
    let dstExists = false;
    try {
      lstatSync(dst);
      dstExists = true;
    } catch {
      /* absent */
    }
    if (dstExists) continue;
    try {
      symlinkSync(src, dst, 'junction');
    } catch {
      /* best-effort */
    }
  }
}
process.exit(0);
