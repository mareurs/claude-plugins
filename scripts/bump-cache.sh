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

PLUGIN="${1:?plugin name required (buddy | codescout-companion | sdd | claude-statusline)}"
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
  rsync -a --delete \
    --exclude='__pycache__' --exclude='.pytest_cache' \
    --exclude='*.pyc' --exclude='.mypy_cache' \
    "$SRC/" "$DEST/"
done

echo "✓ $PLUGIN $VERSION cached in 3 profiles"
