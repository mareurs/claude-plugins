#!/usr/bin/env bash
# Buddy composed statusline.
#
# Runs a "primary" statusline command (e.g. claude-statusline) on row 1,
# then the buddy bodhisattva on the following rows — both fed the same
# stdin JSON from Claude Code.
#
# Each component remains independently usable; this wrapper just stacks them.
#
# Configuration (all optional):
#   BUDDY_PRIMARY_STATUSLINE  Path to a primary statusline command. If unset,
#                             the script tries to find claude-statusline from
#                             the sdd-misc-plugins cache, then falls back to
#                             $HOME/.claude/statusline.sh, then to nothing.
#   BUDDY_SKIP_PRIMARY=1      Skip the primary entirely (buddy only).
#   BUDDY_SKIP_SELF=1         Skip the buddy row (primary only — rarely useful).

set -u

# -- Read stdin once so we can fan it out --
INPUT=$(cat)

# -- Resolve primary statusline command --
resolve_primary() {
  if [[ -n "${BUDDY_PRIMARY_STATUSLINE:-}" ]]; then
    printf '%s' "$BUDDY_PRIMARY_STATUSLINE"
    return
  fi

  local cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  local candidate
  # Glob into the sdd-misc-plugins cache for claude-statusline (latest version).
  for candidate in "$cfg"/plugins/cache/sdd-misc-plugins/claude-statusline/*/bin/statusline.sh; do
    [[ -x "$candidate" ]] && { printf '%s' "$candidate"; return; }
  done

  # Legacy fallback: a user-managed ~/.claude/statusline.sh
  if [[ -x "$HOME/.claude/statusline.sh" ]]; then
    printf '%s' "$HOME/.claude/statusline.sh"
    return
  fi

  printf ''
}

# -- Render primary (if any, and not skipped) --
if [[ "${BUDDY_SKIP_PRIMARY:-0}" != "1" ]]; then
  PRIMARY=$(resolve_primary)
  if [[ -n "$PRIMARY" ]]; then
    printf '%s' "$INPUT" | "$PRIMARY" 2>/dev/null || true
    # Primary scripts typically end without trailing newline; ensure row break.
    echo
  fi
fi

# -- Render buddy (unless explicitly suppressed) --
if [[ "${BUDDY_SKIP_SELF:-0}" != "1" ]]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  printf '%s' "$INPUT" | python3 "$SELF_DIR/statusline.py" 2>/dev/null || true
fi

# -- Render caveman badge (if active) --
CAVEMAN_FLAG="$HOME/.claude/.caveman-active"
if [[ -f "$CAVEMAN_FLAG" ]]; then
  CAVEMAN_MODE=$(cat "$CAVEMAN_FLAG" 2>/dev/null)
  if [[ "$CAVEMAN_MODE" == "full" ]] || [[ -z "$CAVEMAN_MODE" ]]; then
    printf ' \033[38;5;172m[CAVEMAN]\033[0m'
  else
    printf ' \033[38;5;172m[CAVEMAN:%s]\033[0m' "$(echo "$CAVEMAN_MODE" | tr '[:lower:]' '[:upper:]')"
  fi
  echo
fi
