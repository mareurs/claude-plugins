#!/usr/bin/env bash
# Discover buddy specialists across three scopes and print one
# "scope name abspath" line per specialist (a subdir containing SKILL.md).
# Precedence (project > global > builtin) is applied by the caller.
#
# With `--claude-dir`, instead print the resolved active-profile dir and exit
# (used by /buddy:create to resolve the global write target from this same
# logic rather than re-deriving it).
#
# Resolution rules — deliberately hardened against unreliable env:
#
#   PLUGIN_ROOT (builtin scope): self-located from this script's own path.
#     CLAUDE_PLUGIN_ROOT is NOT trusted — in subprocess/hook contexts it can
#     arrive unset or as a bare slug ("buddy") rather than an absolute path
#     (see commit 5a02546). This script lives at <plugin_root>/scripts/.
#
#   CLAUDE_DIR (global scope): prefer $CLAUDE_CONFIG_DIR — the active CC
#     profile dir, reliably exported into the tool environment. Fall back to
#     walking PLUGIN_ROOT's ancestors for a .claude/.claude-sdd/.claude-kat
#     component only when CLAUDE_CONFIG_DIR is unset. The ancestor walk alone
#     fails for directory-source installs whose installPath points at the
#     plugin *source* dir rather than the cache under a profile — that is the
#     "pika not found" bug this script fixes.
#
#   PROJECT_DIR (project scope): prefer $CLAUDE_PROJECT_DIR (set even when the
#     tool runs in a subdir of the project); fall back to $PWD.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CLAUDE_DIR=""
if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -d "${CLAUDE_CONFIG_DIR}" ]; then
  CLAUDE_DIR="${CLAUDE_CONFIG_DIR}"
else
  d="$PLUGIN_ROOT"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    case "$(basename "$d")" in
      .claude|.claude-sdd|.claude-kat) CLAUDE_DIR="$d"; break ;;
    esac
    d="$(dirname "$d")"
  done
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

# `--claude-dir`: print the resolved active-profile dir (empty if none), exit.
if [ "${1:-}" = "--claude-dir" ]; then
  printf '%s\n' "$CLAUDE_DIR"
  exit 0
fi

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
scan global  "${CLAUDE_DIR:+$CLAUDE_DIR/buddy/skills}"
scan project "$PROJECT_DIR/.buddy/skills"
