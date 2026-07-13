// PreToolUse hook — deny worktree-ambiguous git mutations from Bash.
// Port of git-worktree-guard.sh. Each Bash call spawns a fresh shell from CC's
// frozen PWD; a bare destructive git verb lands on whatever branch PWD points
// at, not the worktree the agent thinks they're in. Fires only when the repo
// has ≥2 worktrees (single-worktree carve-out).
import { readInput, git, denyPreToolUse } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

if ((input.tool_name || '') !== 'Bash') process.exit(0);

const cmd = (input.tool_input && input.tool_input.command) || '';
if (!cmd) process.exit(0);

const cwd = input.cwd || '';
if (!cwd) process.exit(0);

// Destructive git verbs (bare `git checkout <ref>` is read-mostly, skipped).
if (!/git\s+(commit|push|reset\s+--hard|rebase|merge|checkout\s+-b)\b/.test(cmd)) process.exit(0);

// Allow: explicit `git -C <path> <verb>`.
if (/git\s+-C\s+\S+\s+(commit|push|reset|rebase|merge|checkout)\b/.test(cmd)) process.exit(0);

// Allow: chained `cd <path> && git ...` in the same command — intent explicit.
if (/(^|;|&&|\|\|)\s*cd\s+\S+\s*&&\s*git\b/.test(cmd)) process.exit(0);

// Skip if cwd is not inside a git repo.
if (git(cwd, ['rev-parse', '--is-inside-work-tree']) === null) process.exit(0);

// Single-worktree carve-out: count `worktree <path>` porcelain lines.
const porcelain = git(cwd, ['worktree', 'list', '--porcelain']) || '';
const wtCount = (porcelain.match(/^worktree /gm) || []).length;
if (wtCount < 2) process.exit(0);

const wtList = git(cwd, ['worktree', 'list']) || '';

const reason = `⛔ Worktree-ambiguous git mutation. BLOCKED.

Command: ${cmd}
CC PWD : ${cwd}
Worktrees (${wtCount}):
${wtList}

Each Bash call starts a fresh shell from CC's PWD — a prior 'cd' does NOT
carry over. Bare 'git commit/push/reset/rebase/merge/checkout -b' lands on
whatever branch CC's PWD points at, not the worktree you think you're in.

This regressed real work (MRV-poc 2026-05-18, commit landed on 'dev'
instead of the worktree branch).

Fix one of:
  • Use explicit path:      git -C /full/worktree/path commit ...
  • Chain cd in same call:  cd /full/worktree/path && git commit ...

The carve-out skips single-worktree repos — this only fires when ambiguity
actually exists.`;

denyPreToolUse(reason);
process.exit(0);
