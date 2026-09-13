// PreToolUse hook — warn before editing a file that already carries
// uncommitted changes this session did not write.
//
// WHY, AND WHY AT EDIT TIME
// -------------------------
// `git commit -- <paths>` commits the WORKING TREE at those paths, not the
// index. On a shared checkout your edit and whatever a concurrent session
// already wrote to the same file land together, under your message. Four such
// captures are recorded in codescout's
// docs/issues/2026-08-31-peer-commit-captures-another-sessions-working-tree.md,
// and its remedy table shows explicit pathspecs do NOT defeat the co-edited-file
// layer (instance 5, e0525462): both diffs merge in the working tree before
// `add` ever runs.
//
// codescout's scripts/pre-commit-unreviewed-content.sh already covers COMMIT
// time. By then the diffs have entangled and the only move is to disentangle
// them. This fires at EDIT time, before entry into that state. The bug file's
// own words: "It narrows the window, it does not close it."
//
// WHAT IT DOES NOT COVER — say this plainly or it will be credited with
// coverage it does not have:
//   * Matchers see TOOL CALLS. `sed -i`, `tee` and heredoc redirects driven
//     through native `Bash` are invisible here, and that is a path agents
//     actually use.
//   * Linked worktrees share no working tree, so a peer in one cannot appear
//     in this check and is not a hazard it addresses.
//   * It reports UNCOMMITTED state only. A peer who has already committed is
//     silent here and always was.
//
// It warns; it never denies. Fail-open per lib.mjs: exit 0 on every path.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readInput, contextPreToolUse, inputPath, isWriteOperation, resolveProjectRoot, git } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);
if (!isWriteOperation(input)) process.exit(0);

const targetPath = inputPath(input);
if (!targetPath) process.exit(0);

const sessionId = input.session_id || '';
if (!sessionId) process.exit(0);

const cwd = input.cwd || process.cwd();
const projectRoot = resolveProjectRoot(cwd);

// One marker per (session, path). Read BEFORE writing, or the first edit of a
// contested file would mark it and then find itself already marked.
const marker = join(
  projectRoot,
  '.buddy',
  sessionId,
  `edited-${createHash('sha256').update(targetPath).digest('hex').slice(0, 16)}`,
);
const alreadySeen = existsSync(marker);

// Written on EVERY edit, clean or dirty — that is what makes dirt this session
// created distinguishable from dirt it inherited. Best-effort: a failed write
// re-warns later, which is the safe direction.
try {
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, '');
} catch {
  /* best-effort */
}

// Bounded noise: one warning per path per session. A guard that repeats itself
// on every keystroke trains the reader to skip it.
if (alreadySeen) process.exit(0);

// `git()` returns null on any failure — not a repo, git absent, path outside
// the tree. Null is UNKNOWN, never CLEAN, and an unknown must not warn either:
// a warning we cannot substantiate is the noise that kills the signal.
const status = git(projectRoot, ['status', '--porcelain', '--', targetPath]);
if (status === null || status === '') process.exit(0);

const rel = relative(projectRoot, targetPath) || targetPath;

// Claim only what the check proves. `git status` establishes that the content is
// uncommitted and that this session recorded no write to it. It does NOT
// establish a peer — a previous session of your own leaves an identical trace —
// and naming an unchecked cause ends the search for the real one.
contextPreToolUse(
  `[cs-hint] \`${rel}\` already has uncommitted changes that this session did not write.\n` +
    `\n` +
    `On a shared checkout \`git commit -- <path>\` commits the WORKING TREE there, so your\n` +
    `edit and the existing change would land together under your message. Four such\n` +
    `captures are recorded in codescout's\n` +
    `docs/issues/2026-08-31-peer-commit-captures-another-sessions-working-tree.md.\n` +
    `\n` +
    `This states only what \`git status --porcelain\` proves. It does NOT establish a peer:\n` +
    `an earlier session of your own leaves the same trace. To find out whose:\n` +
    `\n` +
    `    ./scripts/file-provenance.py ${rel}    # codescout repo; ~7s, scans transcripts\n` +
    `\n` +
    `Then ask the holder if it is theirs and live. Editing is fine once you know — this is\n` +
    `a check, not a refusal. Scope: this working tree's uncommitted state only; a peer in a\n` +
    `linked worktree, or one who already committed, cannot appear here.`,
);
process.exit(0);
