# Worktree Shared-Asset Symlinking

**Date:** 2026-03-15
**Status:** Approved

## Problem

When a worktree's `.codescout/` directory already exists as a real directory (not a symlink),
the plugin's existing full-symlink logic skips it (`[ ! -e "$DEST" ]`). This leaves the
worktree without shared assets — most critically `embeddings/` — which disables semantic
search for that worktree session.

This happens when:
- A session is resumed directly inside a worktree before the plugin ran
- The worktree was created before the main project had a `.codescout/` directory, which was then
  created by codescout on the main project later

## Design

### Shared assets

A fixed list of assets that are always safe to share between the main project and any worktree:

- `embeddings/` — semantic index database; expensive to rebuild, read-only in worktrees

Assets explicitly NOT shared:
- `usage.db` — codescout opens this read-write; sharing it between a main and worktree session
  risks SQLite write contention or corruption
- `project.toml`, `system-prompt.md`, `memories/`, `private-memories/` — worktrees may have
  their own versions

### Logic

The fallback block is added to both hooks after the existing full-symlink attempt. The variable
names differ per hook because the hooks derive the main project dir differently.

**In `session-start.sh`** (inside the existing `IN_WORKTREE` block, after the `ln -s` attempt):

```bash
# Fallback: worktree has a real .codescout dir — symlink individual shared assets
if [ -n "$MAIN_ROOT" ] && [ "$MAIN_ROOT" != "." ] && \
   [ -d "$CE_DEST" ] && [ ! -L "$CE_DEST" ]; then
  for ASSET in embeddings; do
    SRC="$MAIN_ROOT/${CE_NAME}/${ASSET}"
    DST="${CE_DEST}/${ASSET}"
    [ -e "$SRC" ] || continue                                      # asset doesn't exist in main yet
    if [ -e "$DST" ] || [ -L "$DST" ]; then continue; fi          # already present (even if broken symlink)
    ln -s "$SRC" "$DST" 2>/dev/null
  done
fi
```

Variables `CE_DEST`, `MAIN_ROOT`, `CE_NAME` are all set earlier in the same `IN_WORKTREE` block.

**In `worktree-activate.sh`** (after the existing `ln -s "$CE_DIR" "$DEST"` attempt):

```bash
# Fallback: worktree has a real .codescout dir — symlink individual shared assets
if [ -d "$DEST" ] && [ ! -L "$DEST" ]; then
  for ASSET in embeddings; do
    SRC="${CE_DIR}/${ASSET}"
    DST="${DEST}/${ASSET}"
    [ -e "$SRC" ] || continue                                      # asset doesn't exist in main yet
    if [ -e "$DST" ] || [ -L "$DST" ]; then continue; fi          # already present (even if broken symlink)
    ln -s "$SRC" "$DST" 2>/dev/null
  done
fi
```

Variables `DEST` and `CE_DIR` are the existing variable names in `worktree-activate.sh`.

### Edge cases

- **Asset missing from main:** `[ -e "$SRC" ] || continue` — safe skip, no partial state
- **Broken symlink at destination:** `if [ -e "$DST" ] || [ -L "$DST" ]; then continue; fi` catches
  both regular files/dirs and existing (possibly broken) symlinks, avoiding a silent failed
  `ln -s` attempt
- **`CE_DIR` / `DEST` empty:** both are guarded earlier in their respective hooks before
  this block would be reached (`[ -z "$WORKTREE_PATH" ] && exit 0`, etc.)
- **Concurrent writes:** `embeddings/` is read-only in worktrees (codescout writes to it only
  from the main project session), so symlinking is safe

## Files Changed

- `hooks/session-start.sh` — add fallback block inside the `IN_WORKTREE` block, after `ln -s`
- `hooks/worktree-activate.sh` — add fallback block after the existing symlink attempt
