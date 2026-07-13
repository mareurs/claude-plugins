// PostToolUse hook — after a codescout workspace/activate_project call:
//   1. write the session-scoped codescout-active marker (statusline truth)
//   2. delete the .cs-worktree-pending marker (unblocks write tools) + confirm
// Port of cs-activate-project.sh.
import { existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readInput, emit } from './lib.mjs';

const input = readInput();
if (!input) process.exit(0);

const toolName = input.tool_name || '';
if (!/__(workspace|activate_project)$/.test(toolName)) process.exit(0);

// Activated path (strip trailing slash so it matches the marker location).
const activatedPath = ((input.tool_input && input.tool_input.path) || '').replace(/\/+$/, '');
if (!activatedPath) process.exit(0);

// Session-scoped codescout-active marker (statusline reads the declared workspace).
const sessionId = input.session_id || '';
if (sessionId) {
  let isDir = false;
  try {
    isDir = statSync(activatedPath).isDirectory();
  } catch {
    /* not a dir */
  }
  if (isDir) {
    const cfg = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || process.env.USERPROFILE || homedir(), '.claude');
    try {
      mkdirSync(join(cfg, 'codescout-active'), { recursive: true });
      writeFileSync(join(cfg, 'codescout-active', sessionId), activatedPath);
    } catch {
      /* best-effort */
    }
  }
}

// Unblock write tools if this was a pending worktree.
const marker = join(activatedPath, '.cs-worktree-pending');
if (existsSync(marker)) {
  try {
    rmSync(marker, { force: true });
  } catch {
    /* best-effort */
  }
  emit({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `✓ codescout switched to: ${activatedPath}\nWrite tools (edit_code, edit_file, edit_markdown, create_file) are now unblocked for this worktree.`,
    },
  });
}
process.exit(0);
