// PreToolUse hook — warn before editing a file that carries uncommitted
// changes no edit through this hook accounts for.
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
import { join, relative, dirname, isAbsolute } from 'node:path';
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

// Resolved ONCE, immediately, so every downstream use agrees. `targetPath` is
// frequently project-relative, and `path.relative()` resolves a relative
// argument against `process.cwd()` -- the session's cwd, not `projectRoot` --
// so a session working from a subdirectory (e.g. this plugin's own `.buddy`)
// printed a path with a spurious cwd-offset prefix and hashed a different
// marker key per spelling of the same file (bare path vs. after a rename).
const absTargetPath = isAbsolute(targetPath) ? targetPath : join(projectRoot, targetPath);

// One marker per (session, path). Read BEFORE writing, or the first edit of a
// contested file would mark it and then find itself already marked.
const marker = join(
  projectRoot,
  '.buddy',
  sessionId,
  `edited-${createHash('sha256').update(absTargetPath).digest('hex').slice(0, 16)}`,
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

const rel = relative(projectRoot, absTargetPath) || targetPath;

// Claim only what the check can observe, and note that those are two different
// scopes. `git status` proves the content is uncommitted. The MARKER set proves
// something narrower and about ourselves: no write THROUGH THIS HOOK was
// recorded. Authorship is neither, and is not observable from a PreToolUse
// payload at all -- so the headline states the hook's own records and leaves the
// world alone.
//
// The earlier headline read "...that this session did not write", which fires on
// the session's OWN work whenever the write bypassed this hook: edit_code's LSP
// rename touches files the call never names, and a librarian `doc(...)` write
// happens server-side with no PreToolUse payload at all. On a docs-heavy session
// the librarian route dominates by call volume.
// codescout:docs/issues/2026-09-14-the-dirty-check-reports-any-write-it-did-not-mediate-as-another-sessions.md
//
// Why the wording is fixed here rather than the detection widened: marking the
// librarian route is not available to this hook. `doc()` addresses artifacts by
// ID, not by path -- `doc(action="update", id="dd98...")` carries no path to hash
// a marker from -- so mediating it needs catalog access the hook does not have.
// Softening the claim needs none of that and cannot be reopened by a write path
// nobody has invented yet.
contextPreToolUse(
  `[cs-hint] \`${rel}\` has uncommitted changes that no edit through this hook accounts for.\n` +
    `\n` +
    `That is a statement about THIS HOOK'S RECORDS, not about who wrote the file. It sees\n` +
    `Edit, Write, edit_code, edit_file and create_file, and nothing else. Your own writes via\n` +
    `a librarian \`doc(...)\` call, an edit_code rename touching files it did not name, or a\n` +
    `native \`sed\`/\`tee\`, all leave exactly this trace.\n` +
    `\n` +
    `Why it is worth a line anyway: on a shared checkout \`git commit -- <path>\` commits the\n` +
    `WORKING TREE there, so if the change IS a peer's, it lands under your message. Four such\n` +
    `captures are recorded in codescout's\n` +
    `docs/issues/2026-08-31-peer-commit-captures-another-sessions-working-tree.md.\n` +
    `\n` +
    `To find out whose — worth doing only if you do not already recognise the change as yours:\n` +
    `\n` +
    `    ./scripts/file-provenance.py ${rel}    # codescout repo; ~7s, scans transcripts\n` +
    `\n` +
    `Then ask the holder if it is theirs and live. Editing is fine once you know — this is\n` +
    `a check, not a refusal. Scope: this working tree's uncommitted state only; a peer in a\n` +
    `linked worktree, or one who already committed, cannot appear here.`,
);
process.exit(0);
