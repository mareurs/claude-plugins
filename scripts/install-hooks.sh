#!/usr/bin/env bash
# scripts/install-hooks.sh — one-time, per-clone install of local git hooks.
#
# Git hooks live in .git/hooks/, which is NOT versioned/cloned — every
# contributor (and every worktree) needs to run this once. Idempotent.
#
# Usage: ./scripts/install-hooks.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$(cd "$REPO_ROOT" && git rev-parse --git-path hooks)"

install_hook() {
  local name="$1" src="$2"
  local dest="$HOOKS_DIR/$name"
  cp "$src" "$dest"
  chmod +x "$dest"
  echo "✓ installed $name -> $dest"
}

install_hook "pre-push" "$REPO_ROOT/scripts/pre-push-guard.sh"

echo ""
echo "Hooks installed. Uninstall: rm '$HOOKS_DIR/pre-push'"
echo "Override for an intentional force-push to main: ALLOW_FORCE_PUSH_MAIN=1 git push ..."
