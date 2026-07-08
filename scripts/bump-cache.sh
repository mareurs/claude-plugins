#!/bin/bash
# scripts/bump-cache.sh <plugin> <version>
#
# Copies plugin source into the versioned cache directory for all three
# Claude Code profiles (~/.claude, ~/.claude-sdd, ~/.claude-kat).
#
# Directory-source plugins read their files from cache/<marketplace>/<plugin>/<version>.
# Bumping plugin.json + installed_plugins.json without seeding the cache leaves
# the install record pointing at a non-existent path — CC silently fails to load.
#
# Usage:
#   ./scripts/bump-cache.sh buddy 0.7.3
#   ./scripts/bump-cache.sh codescout-companion 1.9.4

set -euo pipefail

PLUGIN="${1:?plugin name required (buddy | codescout-companion | sdd | claude-statusline | session-bridge)}"
VERSION="${2:?version required (e.g. 0.7.3)}"
MARKETPLACE="sdd-misc-plugins"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/$PLUGIN"

if [ ! -d "$SRC" ]; then
  echo "ERROR: source plugin dir not found: $SRC" >&2
  exit 1
fi

DECLARED_VERSION=$(jq -r '.version' "$SRC/.claude-plugin/plugin.json" 2>/dev/null)
if [ "$DECLARED_VERSION" != "$VERSION" ]; then
  echo "ERROR: plugin.json declares $DECLARED_VERSION but you passed $VERSION" >&2
  echo "       bump plugin.json first, then run this." >&2
  exit 1
fi

for PROFILE in ~/.claude ~/.claude-sdd ~/.claude-kat; do
  DEST="$PROFILE/plugins/cache/$MARKETPLACE/$PLUGIN/$VERSION"
  if [ -d "$DEST" ]; then
    echo "= $PROFILE: $PLUGIN $VERSION already cached, refreshing"
  else
    echo "+ $PROFILE: $PLUGIN $VERSION installing"
  fi
  mkdir -p "$DEST"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude='__pycache__' --exclude='.pytest_cache' \
      --exclude='*.pyc' --exclude='.mypy_cache' \
      --exclude='target/debug' --exclude='target/deps' \
      --exclude='target/.fingerprint' --exclude='target/.rustc_info.json' \
      --exclude='target/build' --exclude='target/incremental' \
      --exclude='target/.cargo-lock' --exclude='target/CACHEDIR.TAG' \
      --exclude='target/doc' --exclude='target/package' \
      --exclude='target/release/build' --exclude='target/release/deps' \
      --exclude='target/release/examples' --exclude='target/release/incremental' \
      --exclude='target/release/.fingerprint' --exclude='target/release/*.d' \
      --exclude='target/release/*.rlib' --exclude='target/release/*.rmeta' \
      "$SRC/" "$DEST/"
  else
    # rsync isn't shipped with Git-for-Windows bash. Fall back to a plain
    # mirror copy: wipe and recopy, then prune the same exclude patterns.
    # Less efficient than rsync's delta-copy, but correct for these small
    # plugin trees (no compiled artifacts expected under buddy/codescout-companion).
    rm -rf "${DEST:?}"/*
    cp -a "$SRC/." "$DEST/"
    find "$DEST" -depth \( \
      -name '__pycache__' -o -name '.pytest_cache' -o -name '*.pyc' -o -name '.mypy_cache' \
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
done

echo "✓ $PLUGIN $VERSION cached in 3 profiles"
