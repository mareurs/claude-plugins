# Worktree-aware code-explorer activation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When EnterWorktree is called, automatically symlink `.code-explorer/` into the worktree and instruct the model to call `activate_project` on the new path.

**Architecture:** PostToolUse hook on EnterWorktree. Shell script symlinks `.code-explorer/` from original project, then injects `additionalContext` telling the model to call `activate_project`. Session-start auto-index is guarded to skip worktrees.

**Tech Stack:** Bash, jq, git (worktree detection), existing detect-tools.sh

---

### Task 1: Create worktree-activate.sh

**Files:**
- Create: `code-explorer-routing/hooks/worktree-activate.sh`

**Step 1: Write the hook script**

```bash
#!/bin/bash
# PostToolUse hook — after EnterWorktree, symlink .code-explorer/ and inject activate_project guidance
# No-op if code-explorer is not configured.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

[ "$TOOL_NAME" = "EnterWorktree" ] || exit 0

# CWD at this point is the ORIGINAL project (before worktree switch)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# --- Find the worktree path ---
# PostToolUse tool_response may contain the worktree path.
# Also try deriving from tool_input.name + standard location.
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.tool_response.worktree_path // .tool_response.path // empty')

if [ -z "$WORKTREE_PATH" ]; then
  # Fallback: try to find from git worktree list (newest entry)
  WORKTREE_PATH=$(git -C "$CWD" worktree list --porcelain 2>/dev/null \
    | grep '^worktree ' | tail -1 | sed 's/^worktree //')
fi

[ -z "$WORKTREE_PATH" ] && exit 0
[ -d "$WORKTREE_PATH" ] || exit 0

# --- Find .code-explorer/ in original project ---
CE_DIR=""
CHECK="$CWD"
while [ "$CHECK" != "/" ]; do
  if [ -d "$CHECK/.code-explorer" ]; then
    CE_DIR="$CHECK/.code-explorer"
    break
  fi
  CHECK=$(dirname "$CHECK")
done

[ -z "$CE_DIR" ] && exit 0

# --- Symlink .code-explorer/ into worktree ---
DEST="$WORKTREE_PATH/.code-explorer"
if [ ! -e "$DEST" ]; then
  ln -s "$CE_DIR" "$DEST" 2>/dev/null
fi

# --- Inject guidance ---
jq -n --arg ctx "WORKTREE DETECTED: code-explorer must switch to the worktree.
Call activate_project(\"$WORKTREE_PATH\") NOW as your next action.
Do NOT run index_project in worktrees — the shared index is read-only here." '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
```

**Step 2: Make it executable**

Run: `chmod +x code-explorer-routing/hooks/worktree-activate.sh`

**Step 3: Test with mock input**

Run: `mkdir -p /tmp/test-worktree && echo '{"tool_name":"EnterWorktree","cwd":"/home/marius/work/claude/claude-plugins","tool_response":{"worktree_path":"/tmp/test-worktree"}}' | bash code-explorer-routing/hooks/worktree-activate.sh | jq .`

Expected: JSON output with `additionalContext` containing the activate_project instruction, and `/tmp/test-worktree/.code-explorer` symlink created.

**Step 4: Clean up test artifacts**

Run: `rm -rf /tmp/test-worktree`

**Step 5: Commit**

```bash
git add code-explorer-routing/hooks/worktree-activate.sh
git commit -m "feat(routing): add worktree-activate PostToolUse hook"
```

---

### Task 2: Register hook in hooks.json

**Files:**
- Modify: `code-explorer-routing/hooks/hooks.json`

**Step 1: Add PostToolUse entry**

Add after the existing `PreToolUse` block:

```json
    "PostToolUse": [
      {
        "matcher": "EnterWorktree",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/worktree-activate.sh"
          }
        ]
      }
    ]
```

The full hooks.json should be:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/subagent-guidance.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Grep|Glob|Read",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/semantic-tool-router.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "EnterWorktree",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/worktree-activate.sh"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Validate JSON**

Run: `jq . code-explorer-routing/hooks/hooks.json`
Expected: Valid JSON, no parse errors.

**Step 3: Commit**

```bash
git add code-explorer-routing/hooks/hooks.json
git commit -m "feat(routing): register worktree-activate in hooks.json"
```

---

### Task 3: Guard session-start auto-index for worktrees

**Files:**
- Modify: `code-explorer-routing/hooks/session-start.sh`

**Step 1: Add worktree detection early in session-start.sh**

After the `source detect-tools.sh` line, add a worktree check:

```bash
# --- Worktree detection: skip auto-indexing if in a worktree ---
IN_WORKTREE=false
if git -C "$CWD" rev-parse --is-inside-work-tree &>/dev/null; then
  GIT_TOPLEVEL=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
  GIT_COMMON=$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null)
  GIT_DIR=$(git -C "$CWD" rev-parse --git-dir 2>/dev/null)
  # In a worktree, .git is a file (not dir) and git-common-dir != git-dir
  if [ "$GIT_COMMON" != "$GIT_DIR" ]; then
    IN_WORKTREE=true
  fi
fi
```

This uses `git rev-parse --git-common-dir` vs `--git-dir` — they differ only in worktrees.

If any future auto-index logic exists, guard it with `[ "$IN_WORKTREE" = "true" ] && skip`.

**Step 2: Test worktree detection**

Run (from main repo): `cd /home/marius/work/claude/claude-plugins && git rev-parse --git-common-dir && git rev-parse --git-dir`
Expected: Both return `.git` (same = not a worktree).

**Step 3: Commit**

```bash
git add code-explorer-routing/hooks/session-start.sh
git commit -m "feat(routing): detect worktrees in session-start, skip auto-index"
```

---

### Task 4: End-to-end manual test

**Step 1: Verify the plugin is live via symlink**

Run: `ls -la ~/.claude/plugins/cache/sdd-misc-plugins/code-explorer-routing/1.1.0`
Expected: Symlink to `/home/marius/work/claude/claude-plugins/code-explorer-routing`

**Step 2: Verify hooks.json includes PostToolUse**

Run: `jq '.hooks | keys' ~/.claude/plugins/cache/sdd-misc-plugins/code-explorer-routing/1.1.0/hooks/hooks.json`
Expected: `["PostToolUse", "PreToolUse", "SessionStart", "SubagentStart"]`

**Step 3: Simulate worktree hook with mock input**

Run:
```bash
mkdir -p /tmp/wt-test
echo '{"tool_name":"EnterWorktree","cwd":"/home/marius/work/claude/claude-plugins","tool_response":{"worktree_path":"/tmp/wt-test"}}' \
  | bash code-explorer-routing/hooks/worktree-activate.sh | jq .
ls -la /tmp/wt-test/.code-explorer
rm -rf /tmp/wt-test
```

Expected:
- JSON with `additionalContext` containing `activate_project("/tmp/wt-test")`
- Symlink from `/tmp/wt-test/.code-explorer` → `/home/marius/work/claude/claude-plugins/.code-explorer`

**Step 4: Verify non-worktree tools pass through**

Run: `echo '{"tool_name":"Write","cwd":"/tmp"}' | bash code-explorer-routing/hooks/worktree-activate.sh`
Expected: No output, exit 0 (passes through).
