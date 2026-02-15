#!/bin/bash
# Validates that plugin versions in plugin.json match README.md
# Exit 0 = all good, Exit 1 = mismatch found
#
# Also checks that marketplace.json does NOT contain version fields
# (versions should only live in plugin.json -- single source of truth)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

errors=0

# Find all plugin.json files
for plugin_json in "$REPO_ROOT"/*/.claude-plugin/plugin.json; do
  [ -f "$plugin_json" ] || continue

  plugin_dir="$(dirname "$(dirname "$plugin_json")")"
  plugin_name="$(jq -r '.name' "$plugin_json")"
  plugin_version="$(jq -r '.version' "$plugin_json")"

  # Check README.md version table
  readme_version=$(grep -oP "\\*\\*\\[${plugin_name}\\].*?\\|\\s*\\K[0-9]+\\.[0-9]+\\.[0-9]+" "$REPO_ROOT/README.md" 2>/dev/null || echo "")

  if [ -z "$readme_version" ]; then
    echo "WARN: ${plugin_name} not found in README.md version table"
  elif [ "$readme_version" != "$plugin_version" ]; then
    echo "MISMATCH: ${plugin_name} -- plugin.json=${plugin_version}, README.md=${readme_version}"
    errors=$((errors + 1))
  else
    echo "OK: ${plugin_name} ${plugin_version}"
  fi
done

# Check marketplace.json has no version fields in plugin entries
marketplace="$REPO_ROOT/.claude-plugin/marketplace.json"
if [ -f "$marketplace" ]; then
  versions_in_marketplace=$(jq '[.plugins[] | select(.version != null)] | length' "$marketplace")
  if [ "$versions_in_marketplace" -gt 0 ]; then
    echo "MISMATCH: marketplace.json contains version fields -- remove them (plugin.json is the source of truth)"
    jq -r '.plugins[] | select(.version != null) | "  - \(.name): \(.version)"' "$marketplace"
    errors=$((errors + 1))
  else
    echo "OK: marketplace.json has no version fields"
  fi
fi

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "FAILED: ${errors} version mismatch(es) found"
  echo "Fix: update README.md to match plugin.json versions, remove version from marketplace.json"
  exit 1
else
  echo ""
  echo "All versions consistent."
fi
