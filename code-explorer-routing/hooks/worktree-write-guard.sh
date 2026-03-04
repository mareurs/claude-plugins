#!/bin/bash
# PreToolUse hook — block code-explorer write tools when in a worktree
# without activate_project having been called.
#
# Triggered by: any tool whose name ends with a code-explorer write tool name
# (hooks.json matcher regex confirmed to work; case statement adds defense-in-depth).
#
# State: .cs-worktree-pending in worktree root (created by worktree-activate.sh,
#         deleted by ce-activate-project.sh).

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Filter: only act on code-explorer write tools
# MCP tools have format: mcp__<server>__<tool>
case "$TOOL_NAME" in
  *__edit_lines|*__replace_symbol|*__insert_code|*__create_file|*__create_or_update_file)
    ;;
  *)
    exit 0
    ;;
esac

[ -z "$CWD" ] && exit 0

# Detect if CWD is inside a git worktree
git -C "$CWD" rev-parse --is-inside-work-tree &>/dev/null || exit 0

GIT_COMMON=$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$CWD" rev-parse --git-dir 2>/dev/null)

# In a worktree, git-common-dir != git-dir
[ "$GIT_COMMON" = "$GIT_DIR" ] && exit 0

# Find worktree root
WT_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
[ -z "$WT_ROOT" ] && exit 0

# Check marker
[ -f "$WT_ROOT/.cs-worktree-pending" ] || exit 0

# Block the write using the current (non-deprecated) PreToolUse deny format.
# Output JSON to stdout + exit 0. Claude sees permissionDecisionReason.
# (The old {"decision":"block"} + exit 2 hybrid was deprecated and broken:
#  exit 2 ignores stdout, so the reason was never shown to Claude.)
jq -n --arg reason "⛔ WORKTREE WRITE BLOCKED: activate_project must be called first.

You are in a worktree at: $WT_ROOT
CE is still pointing at the main repo — a write now would silently modify the wrong file.

Fix: call activate_project(\"$WT_ROOT\") then retry this tool.
If CE is no longer configured, delete $WT_ROOT/.cs-worktree-pending manually to unblock.

To clean up a finished worktree: use git worktree prune (not git worktree remove —
that requires the directory to still exist). Run prune from the main repo, then
start a new session from the main repo directory." \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
