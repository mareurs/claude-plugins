#!/usr/bin/env bash
# scripts/sync-copilot.sh <plugin> <version>
#
# GitHub Copilot CLI/Chat is a SEPARATE app from Claude Code with its own
# marketplace registry and cache format:
#   - Registry:  .copilot/config.json (JSONC — has a leading `//` comment
#     header, so it is NOT strict JSON; jq chokes on it directly).
#   - Cache:     .copilot/installed-plugins/<marketplace>/<plugin>/  — FLAT,
#     unversioned (no per-version subdirectory, unlike Claude Code's
#     plugins/cache/<marketplace>/<plugin>/<version>/). Copilot always loads
#     whatever is at that fixed path; there's nothing to "point" a record at.
#
# release.sh + bump-cache.sh have zero awareness of this surface — it drifts
# silently unless synced separately. This script is the Copilot-side half of
# a release: locates .copilot/config.json (soft-skip if this machine has no
# Copilot install), copies plugin source into the flat cache dir via the
# shared copy_plugin_tree helper, and patches just that plugin's "version"
# field in config.json (scoped to its object, not a blind global replace —
# two plugins could share a version string).
#
# Usage:
#   ./scripts/sync-copilot.sh buddy 0.7.36
#   ./scripts/sync-copilot.sh codescout-companion 1.12.3

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-copy-plugin.sh
source "$SCRIPT_DIR/lib-copy-plugin.sh"

PLUGIN="${1:?plugin name required (buddy | codescout-companion)}"
VERSION="${2:?version required (e.g. 0.7.36)}"

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO_ROOT/$PLUGIN"
CONFIG="${COPILOT_CONFIG:-$HOME/.copilot/config.json}"

if [ ! -d "$SRC" ]; then
  echo "ERROR: source plugin dir not found: $SRC" >&2
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "= no Copilot install on this machine ($CONFIG not found) — skipping"
  exit 0
fi

DECLARED_VERSION=$(jq -r '.version' "$SRC/.claude-plugin/plugin.json" 2>/dev/null)
if [ "$DECLARED_VERSION" != "$VERSION" ]; then
  echo "ERROR: plugin.json declares $DECLARED_VERSION but you passed $VERSION" >&2
  exit 1
fi

# config.json has a leading "// ..." comment header — strip comment lines
# before feeding it to jq (read-only; we never write back via this path).
STRIPPED="$(grep -v '^[[:space:]]*//' "$CONFIG")"

CACHE_PATH="$(echo "$STRIPPED" | jq -r --arg p "$PLUGIN" \
  '.installedPlugins[]? | select(.name == $p) | .cache_path')"

if [ -z "$CACHE_PATH" ] || [ "$CACHE_PATH" = "null" ]; then
  echo "= $PLUGIN not installed under Copilot on this machine — skipping"
  exit 0
fi

echo "+ Copilot: $PLUGIN -> $VERSION ($CACHE_PATH)"
copy_plugin_tree "$SRC" "$CACHE_PATH"

# Patch only this plugin's "version" line, scoped between its own
# `"name": "<plugin>"` line and the next `}` — avoids touching another
# plugin entry that happens to share the same version string.
python3 - "$CONFIG" "$PLUGIN" "$VERSION" <<'PYEOF'
import re, sys
path, plugin, version = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
name_pat = re.compile(r'("name":\s*"' + re.escape(plugin) + r'".*?)("version":\s*")([^"]*)(")', re.S)
new_text, n = name_pat.subn(lambda m: m.group(1) + m.group(2) + version + m.group(4), text, count=1)
if n != 1:
    print(f"ERROR: could not locate a single version field for {plugin} in {path}", file=sys.stderr)
    sys.exit(1)
open(path, "w", encoding="utf-8").write(new_text)
PYEOF

echo "✓ $PLUGIN $VERSION synced to Copilot"
