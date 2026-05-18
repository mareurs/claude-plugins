#!/usr/bin/env bash
# session-bridge/hooks/lib.sh — shared helpers for register/unregister hooks.
# Source this file from each hook.

# Registry layout (mirrored from mcp-server/src/registry.rs):
#   ~/.claude/sessions/active.json — JSON: {"version":1,"sessions":{<id>:{...}}}
#   ~/.claude/sessions/.lock       — flock target (separate file to avoid self-deadlock)
SB_DIR="${HOME}/.claude/sessions"
SB_REGISTRY="${SB_DIR}/active.json"
SB_LOCK="${SB_DIR}/.lock"
SB_FLOCK_TIMEOUT="${SB_FLOCK_TIMEOUT:-10}"

sb_ensure_dir() {
  mkdir -p "$SB_DIR"
  chmod 700 "$SB_DIR" 2>/dev/null || true
  [ -f "$SB_REGISTRY" ] || printf '%s\n' '{"version":1,"sessions":{}}' > "$SB_REGISTRY"
  [ -f "$SB_LOCK" ] || : > "$SB_LOCK"
}

# Run a jq filter under exclusive flock with atomic rename.
# Usage: sb_mutate_registry '<jq filter>' [jq-arg-name jq-arg-value]...
sb_mutate_registry() {
  local filter="$1"; shift
  sb_ensure_dir
  (
    if ! flock -w "$SB_FLOCK_TIMEOUT" 9; then
      echo "session-bridge: flock timeout on $SB_LOCK" >&2
      exit 0
    fi
    local tmp
    tmp="$(mktemp "${SB_REGISTRY}.XXXXXX")"
    if jq "$@" "$filter" "$SB_REGISTRY" > "$tmp"; then
      mv "$tmp" "$SB_REGISTRY"
    else
      rm -f "$tmp"
      echo "session-bridge: jq filter failed" >&2
    fi
  ) 9>"$SB_LOCK"
}

# Derive the CC instance name (main / sdd / kat / ...) from CLAUDE_CONFIG_DIR or transcript path.
sb_instance() {
  local transcript="$1"
  if [ -n "$CLAUDE_CONFIG_DIR" ]; then
    basename "$CLAUDE_CONFIG_DIR" | sed -E 's/^\.claude-?//; s/^\.claude$/main/; s/^$/main/'
    return
  fi
  case "$transcript" in
    "$HOME/.claude/"*)     echo main ;;
    "$HOME/.claude-sdd/"*) echo sdd ;;
    "$HOME/.claude-kat/"*) echo kat ;;
    */.claude/projects/*)     echo main ;;
    */.claude-sdd/projects/*) echo sdd ;;
    */.claude-kat/projects/*) echo kat ;;
    *) echo unknown ;;
  esac
}
