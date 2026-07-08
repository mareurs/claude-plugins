#!/usr/bin/env bash
# scripts/lib-copy-plugin.sh — shared plugin-tree copy helper.
#
# Source this file, then call:
#   copy_plugin_tree <src-dir> <dest-dir>
#
# Wipes <dest-dir> and mirrors <src-dir> into it, pruning the same set of
# build/cache artifacts every plugin-cache-seeding script needs to exclude
# (Python __pycache__/venv cruft, Rust target/ build dirs). Kept in one place
# so the exclude list can't drift between bump-cache.sh's rsync-missing
# fallback and sync-copilot.sh's flat-copy — both call this.
#
# Prefers rsync (delta-copy, real excludes) when available; falls back to a
# plain cp + find-prune mirror (Git-for-Windows bash ships no rsync).

copy_plugin_tree() {
  local src="$1" dest="$2"

  mkdir -p "$dest"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude='__pycache__' --exclude='.pytest_cache' \
      --exclude='*.pyc' --exclude='.mypy_cache' --exclude='.venv' \
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
    rm -rf "${dest:?}"/*
    cp -a "$src/." "$dest/"
    find "$dest" -depth \( \
      -name '__pycache__' -o -name '.pytest_cache' -o -name '*.pyc' \
      -o -name '.mypy_cache' -o -name '.venv' \
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
