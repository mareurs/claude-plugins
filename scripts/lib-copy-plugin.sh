#!/usr/bin/env bash
# scripts/lib-copy-plugin.sh — shared plugin-tree copy helper.
#
# Source this file, then call:
#   copy_plugin_tree <src-dir> <dest-dir>
#
# Wipes <dest-dir> and mirrors <src-dir> into it, pruning the same set of
# build/cache artifacts every plugin-cache-seeding script needs to exclude
# (Python __pycache__/venv cruft, Rust target/ build dirs, Claude Code's
# .orphaned_at runtime marker). Kept in one place so the exclude list can't
# drift between bump-cache.sh's rsync-missing fallback and sync-copilot.sh's
# flat-copy — both call this.
#
# NOTE: this mirrors the FILESYSTEM, not git. A .gitignore entry does not keep
# a file out of a cache snapshot — only this list does. That is why
# .orphaned_at needed both: gitignoring it stops a fresh clone carrying it,
# excluding it here stops every future seed carrying it.
#
# .buddy/ is the second instance of exactly that, found 2026-08-27: it is
# gitignored in BOTH buddy/.gitignore and the root .gitignore, and was still
# copied into every profile's cache on every seed. The leaked file is
# .buddy/.session-start-trace.log — the very artifact CLAUDE.md tells you to
# probe to learn which path a plugin actually loads from. A stale copy of it
# sitting inside the cache is a trap for that diagnostic, so this exclusion is
# not merely tidiness.
#
# Prefers rsync (delta-copy, real excludes) when available; falls back to a
# plain cp + find-prune mirror (Git-for-Windows bash ships no rsync).

copy_plugin_tree() {
  local src="$1" dest="$2"

  mkdir -p "$dest"

  if command -v rsync >/dev/null 2>&1; then
    # --delete-excluded, not plain --delete: rsync PROTECTS excluded paths from
    # deletion in the destination, so an exclusion alone can never evict a file
    # already sitting in a cache — it only stops new ones arriving. Without this
    # the two branches disagree, because the fallback below wipes dest outright.
    # Measured 2026-08-27: adding --exclude='.buddy' re-seeded all three profiles
    # and left the stale .buddy/ in place in every one.
    rsync -a --delete --delete-excluded \
      --exclude='__pycache__' --exclude='.pytest_cache' \
      --exclude='*.pyc' --exclude='.mypy_cache' --exclude='.venv' \
      --exclude='.orphaned_at' --exclude='.buddy' \
      --exclude='target/debug' --exclude='target/deps' \
      --exclude='target/.fingerprint' --exclude='target/.rustc_info.json' \
      --exclude='target/build' --exclude='target/incremental' \
      --exclude='target/.cargo-lock' --exclude='target/CACHEDIR.TAG' \
      --exclude='target/doc' --exclude='target/package' \
      --exclude='target/release/build' --exclude='target/release/deps' \
      --exclude='target/release/examples' --exclude='target/release/incremental' \
      --exclude='target/release/.fingerprint' --exclude='target/release/*.d' \
      --exclude='target/release/*.rlib' --exclude='target/release/*.rmeta' \
      "$src/" "$dest/"
  else
    # `rm -rf "$dest"/*` was wrong here: the glob does not match dotfiles, so a
    # stale dotfile that is NOT on the exclude list (and so is not caught by the
    # find-prune below either) survived every re-seed forever. -mindepth 1
    # -delete clears the directory including dotfiles, matching what rsync
    # --delete --delete-excluded does on the other branch. This branch is the
    # Git-for-Windows path, where rsync is absent — so it is the one that got
    # the least exercise and carried the defect longest.
    find "${dest:?}" -mindepth 1 -delete
    cp -a "$src/." "$dest/"
    find "$dest" -depth \( \
      -name '__pycache__' -o -name '.pytest_cache' -o -name '*.pyc' \
      -o -name '.mypy_cache' -o -name '.venv' -o -name '.orphaned_at' \
      -o -name '.buddy' \
      -o -path '*/target/debug' -o -path '*/target/deps' \
      -o -path '*/target/.fingerprint' -o -path '*/target/.rustc_info.json' \
      -o -path '*/target/build' -o -path '*/target/incremental' \
      -o -path '*/target/.cargo-lock' -o -path '*/target/CACHEDIR.TAG' \
      -o -path '*/target/doc' -o -path '*/target/package' \
      -o -path '*/target/release/build' -o -path '*/target/release/deps' \
      -o -path '*/target/release/examples' -o -path '*/target/release/incremental' \
      -o -path '*/target/release/.fingerprint' -o -name '*.d' \
      -o -name '*.rlib' -o -name '*.rmeta' \
    \) -exec rm -rf {} + 2>/dev/null || true
  fi
}
