# Design: Worktree Write Guard

**Date:** 2026-02-28
**Status:** Approved
**Plugin:** code-explorer-routing

## Problem

When `EnterWorktree` is called, two independent systems track "current directory":

| Tool | Current directory | How it changes |
|------|-------------------|----------------|
| Bash tool | Resets each call; must use absolute paths or `-C` | `cd`, `-C`, absolute paths |
| code-explorer MCP | Main repo (set at startup) | Only via `activate_project` |

This split-brain causes code-explorer write tools (`edit_lines`, `replace_symbol`, etc.)
to silently resolve relative paths against the **main repo root**, not the worktree.
The tool returns the absolute path it actually wrote, but agents don't notice.

There is also a **bug in the existing `worktree-activate.sh`**: it exits early with
`[ -z "$CE_DIR" ] && exit 0` before the guidance injection block. Any project without
a `.code-explorer/` directory gets **no guidance at all** after `EnterWorktree`.

## Design

### State machine: one marker file

A marker file `$WORKTREE_PATH/.ce-worktree-pending` is used to track whether
`activate_project` has been called for the current worktree session.

```
EnterWorktree fires
       │
       ▼
worktree-activate.sh creates $WT/.ce-worktree-pending
       │
       ├─ Agent calls activate_project($WT)
       │         │
       │         ▼
       │  ce-activate-project.sh deletes $WT/.ce-worktree-pending
       │         │
       │         ▼
       │  MCP write tools: allowed
       │
       └─ Agent calls write tool before activate_project
                 │
                 ▼
       worktree-write-guard.sh detects marker → BLOCK
```

### Piece 1: Fix `worktree-activate.sh`

**Bug fix:** Move guidance injection before the `CE_DIR` check so guidance always fires.

**New behaviour:**
1. Detect worktree path (existing logic)
2. Inject `additionalContext` with activate_project instruction **(always)**
3. Create `$WORKTREE_PATH/.ce-worktree-pending` marker
4. Attempt symlink `.code-explorer/` (best-effort, skip if CE_DIR missing)

### Piece 2: New `worktree-write-guard.sh` (PreToolUse)

Fires before MCP write tools. Tool name matcher (regex):
```
mcp__.*__(edit_lines|replace_symbol|insert_code|create_file|create_or_update_file)
```

Logic:
1. Extract `cwd` from hook input
2. Detect if CWD is in a worktree:
   ```bash
   GIT_COMMON=$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null)
   GIT_DIR=$(git -C "$CWD" rev-parse --git-dir 2>/dev/null)
   [ "$GIT_COMMON" != "$GIT_DIR" ] # true = in worktree
   ```
3. Find worktree root: `git -C "$CWD" rev-parse --show-toplevel`
4. If `$WT_ROOT/.ce-worktree-pending` exists → **BLOCK**
5. Block response format:
   ```json
   {
     "hookSpecificOutput": {
       "hookEventName": "PreToolUse",
       "decision": "block",
       "reason": "⛔ WORKTREE WRITE BLOCKED: activate_project must be called first.\nCall activate_project(\"$WT_ROOT\") before using code-explorer write tools in a worktree.\nThis prevents silently writing to the wrong repository."
     }
   }
   ```

Edge cases:
- Not in a worktree → exit 0 (pass through)
- No marker file → exit 0 (activate_project already called)
- Code-explorer not configured → exit 0

### Piece 3: New `ce-activate-project.sh` (PostToolUse)

Fires after `activate_project`. Tool name matcher:
```
mcp__.*__activate_project
```

Logic:
1. Extract activated path from `tool_response` (JSON field `path` or `project_root`)
2. Remove `$ACTIVATED_PATH/.ce-worktree-pending` if it exists
3. Inject `additionalContext` confirming: "code-explorer switched to `$ACTIVATED_PATH`. Write tools unblocked."

### Piece 4: Guidance hardening

**`guidance.txt`** — add `WORKTREES` section:
```
WORKTREES:
  After EnterWorktree, ALWAYS call activate_project("/abs/worktree/path") before
  using any code-explorer tools. Code-explorer tracks its own active project
  independently of Bash CWD — they are NOT coupled automatically.
```

**`session-start.sh`** — extend `IN_WORKTREE=true` branch: inject the same activate_project guidance into the session start message so resumed sessions also see it.

**`using-git-worktrees` SKILL.md** — add after step 2 (Create Worktree):
```
### 2b. If code-explorer is configured (Step only when relevant)
Call activate_project("/abs/path/to/worktree") immediately after EnterWorktree.
Code-explorer's active project does not change automatically when the Bash CWD changes.
```

## Files changed

| File | Change |
|------|--------|
| `hooks/worktree-activate.sh` | Fix early-exit bug; add marker creation |
| `hooks/worktree-write-guard.sh` | New — PreToolUse block on write tools |
| `hooks/ce-activate-project.sh` | New — PostToolUse clear marker |
| `hooks/hooks.json` | Add matchers for new hooks |
| `hooks/guidance.txt` | Add WORKTREES section |
| `hooks/session-start.sh` | Inject activate_project guidance when IN_WORKTREE |
| `skills/using-git-worktrees/SKILL.md` | Add code-explorer integration step |

## Out of scope

- Recreating the marker at SessionStart for worktrees that persist across sessions
  (existing `IN_WORKTREE` guidance injection covers this partially)
- Bash tool CWD persistence (inherent to Claude Code; documentation-only fix)
- Detecting activate_project called with wrong path (future)
