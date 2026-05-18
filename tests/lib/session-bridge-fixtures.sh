#!/usr/bin/env bash
# tests/lib/session-bridge-fixtures.sh — helpers for session-bridge hook tests.
# Sourced after tests/lib/fixtures.sh (uses pass/fail/print_summary from there).

SB_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../session-bridge/hooks" && pwd)"

# Run a hook with an isolated $HOME so the real registry is untouched.
# Args: <hook-script> <stdin-json>
# Sets: SB_TEST_HOME, SB_TEST_REGISTRY
sb_run_hook() {
  local hook="$1"
  local payload="$2"
  SB_TEST_HOME="$(mktemp -d)"
  SB_TEST_REGISTRY="$SB_TEST_HOME/.claude/sessions/active.json"
  HOME="$SB_TEST_HOME" CLAUDE_CONFIG_DIR="" \
    bash "$SB_HOOK_DIR/$hook" <<< "$payload"
}

sb_registry_has_session() {
  local id="$1"
  jq -e --arg id "$id" '.sessions[$id] != null' "$SB_TEST_REGISTRY" >/dev/null 2>&1
}

sb_registry_field() {
  local id="$1" field="$2"
  jq -r --arg id "$id" --arg f "$field" '.sessions[$id][$f] // empty' "$SB_TEST_REGISTRY"
}

sb_session_count() {
  jq -r '.sessions | length' "$SB_TEST_REGISTRY"
}

sb_cleanup() {
  [ -n "$SB_TEST_HOME" ] && rm -rf "$SB_TEST_HOME"
}
