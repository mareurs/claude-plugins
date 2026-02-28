# Worktree Write Guard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hard-block code-explorer write tools (edit_lines, replace_symbol, etc.) when the agent is in a worktree but has not yet called activate_project, turning a silent wrong-file write into an immediate error.

**Architecture:** State machine via marker file `$WORKTREE/.ce-worktree-pending`. The file is created by the existing PostToolUse/EnterWorktree hook and deleted by a new PostToolUse/activate_project hook. A new PreToolUse hook blocks MCP write tools while the marker exists.

**Tech Stack:** Bash, jq, git (worktree detection). No external dependencies beyond what already exists.

---

### Task 1: Fix `worktree-activate.sh` — early-exit bug + marker creation

**Files:**
- Modify: `code-explorer-routing/hooks/worktree-activate.sh`

The bug: `[ -z "$CE_DIR" ] && exit 0` exits *before* guidance injection, so projects without `.code-explorer/` get no guidance at all. Fix: inject guidance first, then attempt symlink as best-effort. Also add marker file creation.

**Step 1: Read current file to confirm line numbers**

Run: `cat -n code-explorer-routing/hooks/worktree-activate.sh`

**Step 2: Rewrite the file**

Replace the entire file with:

```bash
#!/bin/bash
# PostToolUse hook — after EnterWorktree:
#   1. Inject activate_project guidance (always)
#   2. Create .ce-worktree-pending marker (blocks writes until activate_project called)
#   3. Symlink .code-explorer/ into worktree (best-effort)
# No-op if code-explorer is not configured.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

[ "$TOOL_NAME" = "EnterWorktree" ] || exit 0

# CWD at this point is the ORIGINAL project (before worktree switch)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

[ "$HAS_CODE_EXPLORER" = "false" ] && exit 0

# --- Find the worktree path ---
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.tool_response.worktree_path // .tool_response.path // empty')

if [ -z "$WORKTREE_PATH" ]; then
  # Fallback: newest entry from git worktree list
  WORKTREE_PATH=$(git -C "$CWD" worktree list --porcelain 2>/dev/null \
    | grep '^worktree ' | tail -1 | sed 's/^worktree //')
fi

[ -z "$WORKTREE_PATH" ] && exit 0
[ -d "$WORKTREE_PATH" ] || exit 0

# --- Create pending marker BEFORE injecting guidance ---
# Marker signals: worktree entered, activate_project not yet called.
# worktree-write-guard.sh checks this; ce-activate-project.sh clears it.
touch "$WORKTREE_PATH/.ce-worktree-pending" 2>/dev/null

# --- Inject guidance (always, regardless of symlink success) ---
jq -n --arg ctx "WORKTREE DETECTED: code-explorer must switch to the worktree.
Call activate_project(\"$WORKTREE_PATH\") NOW as your next action.
MCP write tools (edit_lines, replace_symbol, insert_code, create_file) are BLOCKED
until activate_project is called — they would otherwise silently write to the wrong repo.
Do NOT run index_project in worktrees — the shared index is read-only here." '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'

# --- Symlink .code-explorer/ into worktree (best-effort) ---
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

DEST="$WORKTREE_PATH/.code-explorer"
if [ ! -e "$DEST" ]; then
  ln -s "$CE_DIR" "$DEST" 2>/dev/null
fi
```

**Step 3: Make executable**

Run: `chmod +x code-explorer-routing/hooks/worktree-activate.sh`

**Step 4: Test — guidance fires even without .code-explorer/**

Run:
```bash
mkdir -p /tmp/wt-test-no-ce
echo '{"tool_name":"EnterWorktree","cwd":"/tmp","tool_response":{"worktree_path":"/tmp/wt-test-no-ce"}}' \
  | CLAUDE_CONFIG_DIR=/nonexistent bash code-explorer-routing/hooks/worktree-activate.sh
```
Expected: no output (HAS_CODE_EXPLORER=false exits early) — that's fine, the fix is for projects that DO have code-explorer. If you have a project with code-explorer configured, test with that CWD.

**Step 5: Test with a project that has code-explorer**

Run:
```bash
mkdir -p /tmp/wt-test
echo '{"tool_name":"EnterWorktree","cwd":"/home/marius/work/claude/code-explorer","tool_response":{"worktree_path":"/tmp/wt-test"}}' \
  | bash code-explorer-routing/hooks/worktree-activate.sh | jq .
ls /tmp/wt-test/.ce-worktree-pending && echo "marker created" || echo "marker missing"
rm -rf /tmp/wt-test
```
Expected:
- JSON with `additionalContext` mentioning activate_project and BLOCKED
- `marker created`

**Step 6: Test — non-EnterWorktree tool is a no-op**

Run: `echo '{"tool_name":"Read","cwd":"/tmp"}' | bash code-explorer-routing/hooks/worktree-activate.sh`
Expected: no output, exit 0.

**Step 7: Commit**

```bash
git add code-explorer-routing/hooks/worktree-activate.sh
git commit -m "fix(routing): fix worktree-activate early-exit bug, add write-guard marker"
```

---

### Task 2: Create `worktree-write-guard.sh` — PreToolUse block

**Files:**
- Create: `code-explorer-routing/hooks/worktree-write-guard.sh`

**Step 1: Verify PreToolUse blocking format**

Claude Code PreToolUse hooks block a tool by outputting JSON with `decision: "block"` and exiting 2, OR by just printing a reason and exiting 2. Test which format Claude Code uses:

```bash
# Create minimal test hook
cat > /tmp/test-block-hook.sh << 'EOF'
#!/bin/bash
jq -n '{"decision":"block","reason":"test block message"}'
exit 2
EOF
chmod +x /tmp/test-block-hook.sh
# Add to local hooks config temporarily and observe behavior in a real session
# OR: trust exit-2-with-JSON-reason is the correct format (standard Claude Code pattern)
rm /tmp/test-block-hook.sh
```

The correct format for blocking in Claude Code PreToolUse hooks is:
```json
{"decision": "block", "reason": "message shown to agent"}
```
Output this JSON to stdout and exit 2.

**Step 2: Write the guard hook**

Create `code-explorer-routing/hooks/worktree-write-guard.sh`:

```bash
#!/bin/bash
# PreToolUse hook — block code-explorer write tools when in a worktree
# without activate_project having been called.
#
# Triggered by: any tool whose name contains 'edit_lines', 'replace_symbol',
# 'insert_code', 'create_file', or 'create_or_update_file' (filtered below).
#
# State: .ce-worktree-pending in worktree root (created by worktree-activate.sh,
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
[ -f "$WT_ROOT/.ce-worktree-pending" ] || exit 0

# Block the write
jq -n --arg reason "⛔ WORKTREE WRITE BLOCKED: activate_project must be called first.

You are in a worktree at: $WT_ROOT
code-explorer is still pointing at the main repo — a write now would silently modify the wrong file.

Fix: call activate_project(\"$WT_ROOT\") then retry this tool." \
  '{"decision":"block","reason":$reason}'
exit 2
```

**Step 3: Make executable**

Run: `chmod +x code-explorer-routing/hooks/worktree-write-guard.sh`

**Step 4: Test — non-write tool passes through**

Run:
```bash
echo '{"tool_name":"mcp__code-explorer__list_symbols","cwd":"/tmp"}' \
  | bash code-explorer-routing/hooks/worktree-write-guard.sh
echo "exit: $?"
```
Expected: no output, exit 0.

**Step 5: Test — write tool outside worktree passes through**

Run:
```bash
echo '{"tool_name":"mcp__code-explorer__edit_lines","cwd":"/home/marius/work/claude/claude-plugins"}' \
  | bash code-explorer-routing/hooks/worktree-write-guard.sh
echo "exit: $?"
```
Expected: no output, exit 0 (not a worktree).

**Step 6: Test — write tool in worktree WITH marker is blocked**

Run:
```bash
# Set up a fake worktree (just use the actual git worktree mechanism)
cd /home/marius/work/claude/claude-plugins
git worktree add /tmp/guard-test-wt HEAD 2>/dev/null || true
touch /tmp/guard-test-wt/.ce-worktree-pending

echo '{"tool_name":"mcp__code-explorer__edit_lines","cwd":"/tmp/guard-test-wt"}' \
  | bash code-explorer-routing/hooks/worktree-write-guard.sh | jq .
echo "exit: $?"

# Cleanup
git worktree remove /tmp/guard-test-wt --force 2>/dev/null || rm -rf /tmp/guard-test-wt
git worktree prune
```
Expected: JSON with `decision: "block"` and `reason` explaining the problem. Exit 2.

**Step 7: Test — write tool in worktree WITHOUT marker is allowed**

Run (same worktree setup but no marker file):
```bash
git worktree add /tmp/guard-test-wt2 HEAD 2>/dev/null || true
# NOTE: do NOT create .ce-worktree-pending

echo '{"tool_name":"mcp__code-explorer__edit_lines","cwd":"/tmp/guard-test-wt2"}' \
  | bash code-explorer-routing/hooks/worktree-write-guard.sh
echo "exit: $?"

git worktree remove /tmp/guard-test-wt2 --force 2>/dev/null || rm -rf /tmp/guard-test-wt2
git worktree prune
```
Expected: no output, exit 0 (marker absent = activate_project already called).

**Step 8: Commit**

```bash
git add code-explorer-routing/hooks/worktree-write-guard.sh
git commit -m "feat(routing): add worktree-write-guard PreToolUse hook"
```

---

### Task 3: Create `ce-activate-project.sh` — marker cleanup

**Files:**
- Create: `code-explorer-routing/hooks/ce-activate-project.sh`

**Step 1: Discover activate_project tool_input schema**

The hook receives `tool_input` from what the agent called. For `activate_project`, the agent passes a `path` argument. Verify by reading the PostToolUse hook input format — the key to look for is `tool_input.path`.

**Step 2: Write the hook**

Create `code-explorer-routing/hooks/ce-activate-project.sh`:

```bash
#!/bin/bash
# PostToolUse hook — after activate_project is called:
#   1. Delete .ce-worktree-pending marker (unblocks write tools)
#   2. Inject confirmation via additionalContext

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only fire on activate_project calls
case "$TOOL_NAME" in
  *__activate_project) ;;
  *) exit 0 ;;
esac

# Extract the activated path from tool_input (what the agent passed in)
ACTIVATED_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // empty')

[ -z "$ACTIVATED_PATH" ] && exit 0

# Remove marker if it exists
MARKER="$ACTIVATED_PATH/.ce-worktree-pending"
if [ -f "$MARKER" ]; then
  rm -f "$MARKER"
  jq -n --arg ctx "✓ code-explorer switched to: $ACTIVATED_PATH
Write tools (edit_lines, replace_symbol, etc.) are now unblocked for this worktree." '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi
# If no marker, exit silently (normal activate_project on main project)
```

**Step 3: Make executable**

Run: `chmod +x code-explorer-routing/hooks/ce-activate-project.sh`

**Step 4: Test — activate_project clears marker**

Run:
```bash
mkdir -p /tmp/ce-clear-test
touch /tmp/ce-clear-test/.ce-worktree-pending

echo '{"tool_name":"mcp__code-explorer__activate_project","tool_input":{"path":"/tmp/ce-clear-test"}}' \
  | bash code-explorer-routing/hooks/ce-activate-project.sh | jq .

ls /tmp/ce-clear-test/.ce-worktree-pending 2>/dev/null && echo "marker still exists (BUG)" || echo "marker cleared (OK)"
rm -rf /tmp/ce-clear-test
```
Expected: JSON with `additionalContext` confirming unblock. `marker cleared (OK)`.

**Step 5: Test — activate_project without marker is silent**

Run:
```bash
mkdir -p /tmp/ce-clear-test2
# No marker created

echo '{"tool_name":"mcp__code-explorer__activate_project","tool_input":{"path":"/tmp/ce-clear-test2"}}' \
  | bash code-explorer-routing/hooks/ce-activate-project.sh
echo "exit: $?"
rm -rf /tmp/ce-clear-test2
```
Expected: no output, exit 0.

**Step 6: Test — non-activate_project tool is a no-op**

Run:
```bash
echo '{"tool_name":"mcp__code-explorer__list_symbols","tool_input":{}}' \
  | bash code-explorer-routing/hooks/ce-activate-project.sh
echo "exit: $?"
```
Expected: no output, exit 0.

**Step 7: Commit**

```bash
git add code-explorer-routing/hooks/ce-activate-project.sh
git commit -m "feat(routing): add ce-activate-project PostToolUse hook to clear write guard"
```

---

### Task 4: Update `hooks.json` — register new hooks

**Files:**
- Modify: `code-explorer-routing/hooks/hooks.json`

The PreToolUse matcher needs to catch all code-explorer write tools. Since the server name varies, we match on the tool name suffix using a pattern. The hooks matcher in Claude Code supports regex.

**Step 1: Read current hooks.json**

Run: `cat code-explorer-routing/hooks/hooks.json`

**Step 2: Add PreToolUse and new PostToolUse entries**

Replace the full file with:

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
        "matcher": "mcp__.*__(edit_lines|replace_symbol|insert_code|create_file|create_or_update_file)",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/worktree-write-guard.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Grep|Glob|Read|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-guidance.sh"
          }
        ]
      },
      {
        "matcher": "EnterWorktree",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/worktree-activate.sh"
          }
        ]
      },
      {
        "matcher": "mcp__.*__activate_project",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/ce-activate-project.sh"
          }
        ]
      }
    ]
  }
}
```

**Step 3: Validate JSON**

Run: `jq . code-explorer-routing/hooks/hooks.json`
Expected: valid JSON, no errors.

**Step 4: Commit**

```bash
git add code-explorer-routing/hooks/hooks.json
git commit -m "feat(routing): register worktree-write-guard and ce-activate-project hooks"
```

---

### Task 5: Update `guidance.txt` and `session-start.sh`

**Files:**
- Modify: `code-explorer-routing/hooks/guidance.txt`
- Modify: `code-explorer-routing/hooks/session-start.sh`

**Step 1: Add WORKTREES section to guidance.txt**

Append to `code-explorer-routing/hooks/guidance.txt`:

```
WORKTREES:
  After EnterWorktree, ALWAYS call activate_project("/abs/worktree/path") before
  using any code-explorer tools. code-explorer tracks its own active project
  independently of Bash CWD — they are NOT automatically coupled.
  MCP write tools are HARD-BLOCKED until activate_project is called.
```

**Step 2: Inject worktree guidance at SessionStart when already inside a worktree**

In `session-start.sh`, the `IN_WORKTREE` variable is already detected. Find the `MSG="${MSG}${GUIDANCE}"` line (near end of file) and add a worktree reminder BEFORE it:

```bash
# --- Worktree reminder (session resumed inside a worktree) ---
if [ "$IN_WORKTREE" = "true" ]; then
  WT_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
  MSG="${MSG}WORKTREE SESSION: You are inside a git worktree at: ${WT_ROOT:-$CWD}
→ Call activate_project(\"${WT_ROOT:-$CWD}\") before using any code-explorer write tools.

"
fi
```

**Step 3: Verify guidance.txt looks correct**

Run: `cat code-explorer-routing/hooks/guidance.txt`
Expected: WORKTREES section at the bottom.

**Step 4: Test session-start with worktree detection**

Run:
```bash
git worktree add /tmp/ss-test-wt HEAD 2>/dev/null || true
echo '{"cwd":"/tmp/ss-test-wt"}' | bash code-explorer-routing/hooks/session-start.sh 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext' | grep -A3 "WORKTREE SESSION" || echo "worktree guidance missing"
git worktree remove /tmp/ss-test-wt --force 2>/dev/null || rm -rf /tmp/ss-test-wt
git worktree prune
```
Expected: Output includes "WORKTREE SESSION" guidance.

**Step 5: Commit**

```bash
git add code-explorer-routing/hooks/guidance.txt code-explorer-routing/hooks/session-start.sh
git commit -m "feat(routing): add worktree guidance to guidance.txt and session-start"
```

---

### Task 6: Update `using-git-worktrees` SKILL.md

**Files:**
- Modify: `~/.claude/plugins/superpowers-local/skills/using-git-worktrees/SKILL.md`

Note: this file is outside the claude-plugins repo. Commit it separately in its own repo, or just edit in place (the local version is what Claude Code loads).

**Step 1: Read current file**

Run: `cat ~/.claude/plugins/superpowers-local/skills/using-git-worktrees/SKILL.md`

**Step 2: Add code-explorer step after "Create Worktree" section**

Find the `### 2. Create Worktree` section. Add a new subsection immediately after it:

```markdown
### 2b. Activate code-explorer (if configured)

If the project uses [code-explorer](https://github.com/oraios/serena) semantic intelligence:

```bash
# After EnterWorktree, call activate_project with the ABSOLUTE worktree path
activate_project("/absolute/path/to/worktree")
```

**Why:** code-explorer tracks its own active project independently of Bash CWD.
Without this call, all symbol navigation and file edits target the main repo, not the worktree.
MCP write tools (edit_lines, replace_symbol, etc.) are hard-blocked until this is called.
```

**Step 3: Also add to "Common Mistakes" section**

Append to the Common Mistakes section:

```markdown
### Forgetting activate_project (when code-explorer is configured)

- **Problem:** code-explorer writes silently target the main repo instead of the worktree
- **Fix:** Always call `activate_project("/abs/worktree/path")` immediately after `EnterWorktree`
```

**Step 4: Save and verify**

Run: `grep -A8 "2b\. Activate" ~/.claude/plugins/superpowers-local/skills/using-git-worktrees/SKILL.md`
Expected: the new section appears correctly.

**Step 5: Commit in claude-plugins (document the update)**

```bash
git add code-explorer-routing/  # already staged above; just note the skill update in commit message
git commit -m "docs(routing): note using-git-worktrees skill updated with activate_project step"
```

---

### Task 7: End-to-end integration test

**Step 1: Full state machine simulation**

Run this sequence to verify the full flow:

```bash
# Setup: real worktree in the claude-plugins repo
cd /home/marius/work/claude/claude-plugins
git worktree add /tmp/e2e-wt HEAD
CWD_MAIN="/home/marius/work/claude/claude-plugins"
WT="/tmp/e2e-wt"

# 1. Simulate EnterWorktree (worktree-activate.sh)
echo "=== Step 1: EnterWorktree fires ==="
echo "{\"tool_name\":\"EnterWorktree\",\"cwd\":\"$CWD_MAIN\",\"tool_response\":{\"worktree_path\":\"$WT\"}}" \
  | bash code-explorer-routing/hooks/worktree-activate.sh | jq -r '.hookSpecificOutput.additionalContext'
ls "$WT/.ce-worktree-pending" && echo "marker: created" || echo "marker: MISSING (bug)"

# 2. Simulate write attempt before activate_project (should BLOCK)
echo ""
echo "=== Step 2: Write attempt before activate_project (expect BLOCK) ==="
echo "{\"tool_name\":\"mcp__code-explorer__edit_lines\",\"cwd\":\"$WT\"}" \
  | bash code-explorer-routing/hooks/worktree-write-guard.sh | jq -r '.reason'
echo "guard exit: $?"

# 3. Simulate activate_project call
echo ""
echo "=== Step 3: activate_project fires ==="
echo "{\"tool_name\":\"mcp__code-explorer__activate_project\",\"tool_input\":{\"path\":\"$WT\"}}" \
  | bash code-explorer-routing/hooks/ce-activate-project.sh | jq -r '.hookSpecificOutput.additionalContext'
ls "$WT/.ce-worktree-pending" 2>/dev/null && echo "marker: still present (bug)" || echo "marker: cleared"

# 4. Simulate write attempt after activate_project (should ALLOW)
echo ""
echo "=== Step 4: Write attempt after activate_project (expect ALLOW) ==="
echo "{\"tool_name\":\"mcp__code-explorer__edit_lines\",\"cwd\":\"$WT\"}" \
  | bash code-explorer-routing/hooks/worktree-write-guard.sh
echo "guard exit: $? (expect 0)"

# Cleanup
git worktree remove /tmp/e2e-wt --force 2>/dev/null || rm -rf /tmp/e2e-wt
git worktree prune
```

Expected output:
- Step 1: guidance text + "marker: created"
- Step 2: block reason explaining activate_project needed + non-zero exit
- Step 3: confirmation text + "marker: cleared"
- Step 4: no output + exit 0

**Step 2: Commit if any adjustments were needed**

```bash
git add -A
git commit -m "fix(routing): e2e test corrections" # only if changes were made
```

---

### Task 8: Version bump + final commit

**Files:**
- Modify: `code-explorer-routing/.claude-plugin/plugin.json`
- Modify: `README.md`

**Step 1: Read current version**

Run: `jq .version code-explorer-routing/.claude-plugin/plugin.json`
Expected: `"1.2.3"` (current version from last commit).

**Step 2: Bump to 1.3.0** (minor bump — new behavior/features)

Update `code-explorer-routing/.claude-plugin/plugin.json`:
```json
"version": "1.3.0"
```

**Step 3: Update README.md version table**

Find the table row for code-explorer-routing and update from `1.2.3` to `1.3.0`.

**Step 4: Run version check**

Run: `./scripts/check-versions.sh`
Expected: all versions consistent, no errors.

**Step 5: Final commit**

```bash
git add code-explorer-routing/.claude-plugin/plugin.json README.md
git commit -m "feat(code-explorer-routing): worktree write guard, v1.3.0

- Fix early-exit bug in worktree-activate.sh (guidance now always fires)
- Add .ce-worktree-pending marker state machine
- New worktree-write-guard.sh: PreToolUse blocks write tools until activate_project called
- New ce-activate-project.sh: PostToolUse clears marker when activate_project fires
- guidance.txt + session-start.sh: worktree section for resumed sessions
- using-git-worktrees skill: add activate_project step

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
