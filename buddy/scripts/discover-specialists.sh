#!/usr/bin/env bash
# Discover buddy specialists across three scopes and print one
# "scope name abspath" line per specialist (a subdir containing SKILL.md).
# Precedence (project > global > builtin) is applied by the caller.
#
#   PLUGIN_ROOT (builtin): self-located from this script's path. Do NOT trust
#     CLAUDE_PLUGIN_ROOT — it can arrive unset or as a bare slug (commit 5a02546).
#   GLOBAL (global): ${BUDDY_HOME:-$HOME/.buddy}/skills — profile-agnostic,
#     shared by every CC instance (see buddy_paths.py).
#   PROJECT (project): ${CLAUDE_PROJECT_DIR:-$PWD}/.buddy/skills.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUDDY_HOME_DIR="${BUDDY_HOME:-$HOME/.buddy}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

scan() {
  local scope="$1" root="$2" dir
  [ -z "$root" ] && return 0
  [ -d "$root" ] || return 0
  for dir in "$root"/*/; do
    [ -f "${dir}SKILL.md" ] || continue
    echo "$scope $(basename "$dir") ${dir%/}"
  done
}

scan builtin "$PLUGIN_ROOT/skills"
scan global  "$BUDDY_HOME_DIR/skills"
scan project "$PROJECT_DIR/.buddy/skills"
