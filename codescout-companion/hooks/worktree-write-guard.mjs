// PreToolUse hook — block codescout write tools when in a worktree without
// workspace() having been called. Port of worktree-write-guard.sh.
// State: .cs-worktree-pending in worktree root (created by worktree-activate,
// deleted by cs-activate-project).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, git, denyPreToolUse } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const toolName = input.tool_name || '';
// Only act on codescout write tools (mcp__<server>__<tool>).
if (!/__(edit_code|edit_file|edit_markdown|create_file)$/.test(toolName)) process.exit(0);

const cwd = input.cwd || '';
if (!cwd) process.exit(0);

// Must be inside a git work tree.
if (git(cwd, ['rev-parse', '--is-inside-work-tree']) === null) process.exit(0);

// In a worktree, git-common-dir != git-dir.
const gitCommon = git(cwd, ['rev-parse', '--git-common-dir']);
const gitDir = git(cwd, ['rev-parse', '--git-dir']);
if (gitCommon === null || gitCommon === gitDir) process.exit(0);

const wtRoot = git(cwd, ['rev-parse', '--show-toplevel']);
if (!wtRoot) process.exit(0);

if (!existsSync(join(wtRoot, '.cs-worktree-pending'))) process.exit(0);

const reason = `⛔ WORKTREE WRITE BLOCKED: workspace must be called first.

You are in a worktree at: ${wtRoot}
CE is still pointing at the main repo — a write now would silently modify the wrong file.

Fix: call workspace(action="activate", path="${wtRoot}") then retry this tool.
If CE is no longer configured, delete ${wtRoot}/.cs-worktree-pending manually to unblock.

To clean up a finished worktree: use git worktree prune (not git worktree remove —
that requires the directory to still exist). Run prune from the main repo, then
start a new session from the main repo directory.`;

denyPreToolUse(reason);
process.exit(0);
