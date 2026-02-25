#!/bin/bash
# Shared detection logic — sourced by other hooks
# Expects: CWD to be set before sourcing
# Sets: HAS_CODE_EXPLORER, CE_SERVER_NAME, CE_PREFIX,
#          HAS_CE_ONBOARDING, HAS_CE_MEMORIES, CE_MEMORY_NAMES,
#          SOURCE_EXT_PATTERN

MCP_JSON="${CWD}/.mcp.json"
ROUTING_CONFIG="${CWD}/.claude/code-explorer-routing.json"
CE_MEMORIES_DIR="${CWD}/.code-explorer/memories"
CE_CONFIG_FILE="${CWD}/.code-explorer/project.toml"

HAS_CODE_EXPLORER=false
CE_SERVER_NAME=""
CE_PREFIX=""

# --- Detection ---

# Path 1: config override (for globally-configured servers without .mcp.json)
if [ -f "$ROUTING_CONFIG" ]; then
  _override=$(jq -r '.server_name // empty' "$ROUTING_CONFIG" 2>/dev/null)
  if [ -n "$_override" ]; then
    HAS_CODE_EXPLORER=true
    CE_SERVER_NAME="$_override"
  fi
fi

# Path 2: auto-detect from .mcp.json
if [ "$HAS_CODE_EXPLORER" = "false" ] && [ -f "$MCP_JSON" ]; then
  CE_SERVER_NAME=$(jq -r '
    .mcpServers // {} | to_entries[] |
    select(
      (.value.command // "" | test("code-explorer")) or
      ((.value.args // []) | map(test("code-explorer")) | any)
    ) | .key
  ' "$MCP_JSON" 2>/dev/null | head -1)
  [ -n "$CE_SERVER_NAME" ] && HAS_CODE_EXPLORER=true
fi

# Build tool prefix
if [ "$HAS_CODE_EXPLORER" = "true" ]; then
  CE_PREFIX="mcp__${CE_SERVER_NAME}__"
fi

# --- Onboarding state ---
HAS_CE_ONBOARDING=false
[ -f "$CE_CONFIG_FILE" ] && HAS_CE_ONBOARDING=true

# --- Memory state ---
HAS_CE_MEMORIES=false
CE_MEMORY_NAMES=""
if [ -d "$CE_MEMORIES_DIR" ]; then
  while IFS= read -r mem_file; do
    [ -f "$mem_file" ] || continue
    name=$(basename "$mem_file" .md)
    CE_MEMORY_NAMES="${CE_MEMORY_NAMES}${name} "
    HAS_CE_MEMORIES=true
  done < <(find "$CE_MEMORIES_DIR" -maxdepth 1 -name '*.md' 2>/dev/null)
fi

# --- Source extension pattern ---
SOURCE_EXT_PATTERN='\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|cs|rb|scala|swift|cpp|c|h|hpp|sh)$'
