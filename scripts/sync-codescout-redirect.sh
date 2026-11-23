#!/usr/bin/env bash
# scripts/sync-codescout-redirect.sh — refresh the copy of guard-rules.mjs in codescout-redirect.
# The mod can import a file of its own plugin only, and it must not live in codescout-companion
# (that plugin's hooks.json is read by Codex and Copilot too). So the pure rules module is copied.
# tests/test-codescout-redirect.sh fails when the copy drifts.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cp "$ROOT/codescout-companion/hooks/guard-rules.mjs" "$ROOT/codescout-redirect/hooks/guard-rules.mjs"
echo "synced codescout-redirect/hooks/guard-rules.mjs from codescout-companion"
