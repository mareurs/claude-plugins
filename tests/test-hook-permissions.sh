#!/bin/bash
# tests/test-hook-permissions.sh — verify all hook scripts are executable
# Catches the class of bug where a script is created without chmod +x:
# Claude Code executes hooks directly (not via `bash script.sh`), so missing
# +x causes a "hook error" that is invisible to tests calling bash directly.

source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── hook-permissions ──"

for script in "$HOOK_DIR"/*.sh; do
  name=$(basename "$script")
  if [ -x "$script" ]; then
    pass "$name: executable"
  else
    fail "$name: missing +x (Claude Code runs hooks directly, not via bash)"
  fi
done

print_summary "hook-permissions"
