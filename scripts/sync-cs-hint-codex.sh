#!/usr/bin/env bash
# scripts/sync-cs-hint-codex.sh — refresh the two buddy modules copied into cs-hint-codex.
# Copies, not symlinks: Codex's plugin fingerprint refuses a symlink in the plugin root.
# tests/test-cs-hint-codex.sh fails when the copies drift. A change here changes the
# content hash, so the plugin's hook approval in Codex must be renewed afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for f in cs_heuristics.py cs_tool_log.py; do
  cp "$ROOT/buddy/scripts/$f" "$ROOT/cs-hint-codex/scripts/$f"
done
echo "synced; renew the Codex hook approval for cs-hint-codex (codex plugin add, then /hooks)"
