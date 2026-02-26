# Design: Worktree-aware code-explorer activation

**Date:** 2026-02-26
**Status:** Draft
**Plugin:** code-explorer-routing

## Problem

When `EnterWorktree` is called in Claude Code, the CWD changes to the worktree
path, but code-explorer continues operating on the original project root. All
symbol navigation, semantic search, and file operations target the wrong tree.

There is no `EnterWorktree` hook event — the session continues silently with a
different working directory.

## Design

### Trigger: PostToolUse on EnterWorktree

A `PostToolUse` hook fires after `EnterWorktree` completes. At that point:
- The worktree directory exists on disk
- The tool response contains the worktree path
- CWD has changed to the worktree

### What the hook does

**New file: `hooks/worktree-activate.sh`**

1. **Detect code-explorer** — reuse `detect-tools.sh` (exit early if absent)
2. **Extract worktree path** — from `tool_response` or derive from new `cwd`
3. **Find original project root** — walk up from pre-worktree `cwd` to find
   nearest `.code-explorer/`
4. **Symlink `.code-explorer/`** from original project into worktree root:
   ```
   ln -s /original/project/.code-explorer /worktree/path/.code-explorer
   ```
5. **Inject guidance** via `additionalContext`:
   ```
   Worktree detected. Call activate_project("/worktree/path") now to switch
   code-explorer to the worktree. Do NOT run index_project in worktrees —
   the shared index from the main project is read-only here.
   ```

### hooks.json addition

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

### Index sharing via symlink

The entire `.code-explorer/` directory is symlinked, not copied. This means:

- **`embeddings.db`** — shared read-only from worktrees
- **`project.toml`** — same config (no path fields; project root comes from
  `activate_project` argument)
- **`memories/`** — shared across main + worktrees

### No indexing in worktrees

Worktrees do NOT trigger `index_project`. The main branch owns the index.

- The hook's `additionalContext` explicitly tells the model not to re-index
- If auto-index logic exists in `session-start.sh`, it should detect worktree
  and skip

**What still works without re-indexing:**
- `find_symbol`, `get_symbols_overview`, `list_functions` — LSP-based, live filesystem
- `find_referencing_symbols` — LSP-based, live filesystem
- `search_for_pattern` — regex on disk, no index needed
- `semantic_search` — uses the shared embeddings DB (covers ~99% of code)
- `read_file`, `git_blame`, `git_log`, `git_diff` — filesystem/git, no index

**What may miss new worktree-only files:**
- `semantic_search` — new files not yet embedded (acceptable trade-off)

### Concurrent access

Multiple worktrees may read the same `embeddings.db` simultaneously. This is
safe because:

- SQLite handles concurrent reads natively
- Worktrees never write to the DB (no indexing)
- Only the main project indexes, serializing all writes

### Edge cases

| Case | Behavior |
|------|----------|
| `.code-explorer/` already exists in worktree | Skip symlink (idempotent) |
| No code-explorer configured | Exit 0, do nothing |
| Worktree path can't be determined | Log warning, exit 0 |
| Original project has no `.code-explorer/` | Exit 0 (nothing to symlink) |
| Session resumes inside a worktree | Not handled (future: SessionStart detection) |

### Future considerations

- **SessionStart worktree detection** — if a session resumes already inside a
  worktree (e.g. after crash/restart), SessionStart could detect this via
  `git worktree list` and re-inject the activate_project guidance. Not in scope
  for v1.
- **Worktree cleanup** — when a worktree is removed, the dangling symlink is
  harmless (points to non-existent dir). No cleanup hook needed.

## Files changed

| File | Change |
|------|--------|
| `hooks/hooks.json` | Add PostToolUse matcher for EnterWorktree |
| `hooks/worktree-activate.sh` | New — symlink + guidance injection |
| `hooks/session-start.sh` | Guard auto-index to skip worktrees |
