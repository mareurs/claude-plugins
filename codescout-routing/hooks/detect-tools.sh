#!/bin/bash
# Shared detection logic — sourced by other hooks
# Expects: CWD to be set before sourcing
# Sets: HAS_CODESCOUT, CS_SERVER_NAME, CS_PREFIX, CS_BINARY,
#          HAS_CS_ONBOARDING, HAS_CS_MEMORIES, CS_MEMORY_NAMES,
#          HAS_CS_SYSTEM_PROMPT, CS_SYSTEM_PROMPT,
#          SOURCE_EXT_PATTERN

MCP_JSON="${CWD}/.mcp.json"
# Check new name first, fall back to old for backwards compatibility
ROUTING_CONFIG="${CWD}/.claude/codescout-routing.json"
[ -f "$ROUTING_CONFIG" ] || ROUTING_CONFIG="${CWD}/.claude/code-explorer-routing.json"
CS_MEMORIES_DIR="${CWD}/.code-explorer/memories"
CS_CONFIG_FILE="${CWD}/.code-explorer/project.toml"

HAS_CODESCOUT=false
CS_SERVER_NAME=""
CS_PREFIX=""
CS_BINARY=""

# --- Detection ---

# Path 1: config override (for globally-configured servers without .mcp.json)
if [ -f "$ROUTING_CONFIG" ]; then
  _override=$(jq -r '.server_name // empty' "$ROUTING_CONFIG" 2>/dev/null)
  if [ -n "$_override" ]; then
    HAS_CODESCOUT=true
    CS_SERVER_NAME="$_override"
  fi
fi

# Path 2: auto-detect from .mcp.json
if [ "$HAS_CODESCOUT" = "false" ] && [ -f "$MCP_JSON" ]; then
  CS_SERVER_NAME=$(jq -r '
    .mcpServers // {} | to_entries[] |
    select(
      (.value.command // "" | test("code-explorer|codescout")) or
      ((.value.args // []) | map(test("code-explorer|codescout")) | any)
    ) | .key
  ' "$MCP_JSON" 2>/dev/null | head -1)
  [ -n "$CS_SERVER_NAME" ] && HAS_CODESCOUT=true
fi

# Path 3: auto-detect from user-level MCP config
# `claude mcp add` writes to .claude.json; manual config goes in settings.json
_CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
for _cfg in "${_CLAUDE_DIR}/.claude.json" "${_CLAUDE_DIR}/settings.json"; do
  [ "$HAS_CODESCOUT" = "true" ] && break
  [ -f "$_cfg" ] || continue
  CS_SERVER_NAME=$(jq -r '
    .mcpServers // {} | to_entries[] |
    select(
      (.value.command // "" | test("code-explorer|codescout")) or
      ((.value.args // []) | map(strings | test("code-explorer|codescout")) | any)
    ) | .key
  ' "$_cfg" 2>/dev/null | head -1)
  [ -n "$CS_SERVER_NAME" ] && HAS_CODESCOUT=true
done

# Build tool prefix
if [ "$HAS_CODESCOUT" = "true" ]; then
  CS_PREFIX="mcp__${CS_SERVER_NAME}__"
fi

# Extract binary path — same config files, same server name key
if [ "$HAS_CODESCOUT" = "true" ] && [ -n "$CS_SERVER_NAME" ]; then
  for _cfg in "$MCP_JSON" "${_CLAUDE_DIR}/.claude.json" "${_CLAUDE_DIR}/settings.json"; do
    [ -f "$_cfg" ] || continue
    _bin=$(jq -r ".mcpServers[\"$CS_SERVER_NAME\"].command // empty" "$_cfg" 2>/dev/null)
    if [ -n "$_bin" ]; then
      CS_BINARY="${_bin/#\~/$HOME}"
      break
    fi
  done
fi

# Read routing config for blocking behavior
BLOCK_READS=true
WORKSPACE_ROOT=""

if [ -f "$ROUTING_CONFIG" ]; then
  _block=$(jq -r 'if .block_reads == false or .block_reads == "false" then "false" else "" end' "$ROUTING_CONFIG" 2>/dev/null)
  [ "$_block" = "false" ] && BLOCK_READS=false
  _ws=$(jq -r '.workspace_root // empty' "$ROUTING_CONFIG" 2>/dev/null)
  if [ -n "$_ws" ]; then
    # Expand ~ to $HOME
    WORKSPACE_ROOT="${_ws/#\~/$HOME}"
  fi
fi

# --- Onboarding state ---
HAS_CS_ONBOARDING=false
[ -f "$CS_CONFIG_FILE" ] && HAS_CS_ONBOARDING=true

# --- Memory state ---
HAS_CS_MEMORIES=false
CS_MEMORY_NAMES=""
if [ -d "$CS_MEMORIES_DIR" ]; then
  while IFS= read -r mem_file; do
    [ -f "$mem_file" ] || continue
    name=$(basename "$mem_file" .md)
    CS_MEMORY_NAMES="${CS_MEMORY_NAMES}${name} "
    HAS_CS_MEMORIES=true
  done < <(find "$CS_MEMORIES_DIR" -maxdepth 1 -name '*.md' 2>/dev/null)
fi

# --- System prompt ---
CS_SYSTEM_PROMPT_FILE="${CWD}/.code-explorer/system-prompt.md"
CS_SYSTEM_PROMPT=""
HAS_CS_SYSTEM_PROMPT=false
if [ -f "$CS_SYSTEM_PROMPT_FILE" ]; then
  CS_SYSTEM_PROMPT=$(cat "$CS_SYSTEM_PROMPT_FILE")
  HAS_CS_SYSTEM_PROMPT=true
fi

# --- Source extension pattern ---
SOURCE_EXT_PATTERN='\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|cs|rb|scala|swift|cpp|c|h|hpp)$'
