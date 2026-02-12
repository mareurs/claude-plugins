#!/bin/bash
# Shared detection logic - sourced by other hooks
# Expects: CWD to be set before sourcing
# Sets: HAS_SERENA, HAS_INTELLIJ, HAS_CONTEXT (true/false)
#
# Detection order:
# 1. Check .claude/tool-infra.json for forced overrides (for global MCP servers)
# 2. Fall back to .mcp.json auto-detection

MCP_JSON="${CWD}/.mcp.json"
CONFIG="${CWD}/.claude/tool-infra.json"

HAS_SERENA=false
HAS_INTELLIJ=false
HAS_CONTEXT=false

# Check overrides first
if [ -f "$CONFIG" ]; then
  [ "$(jq -r '.serena // false' "$CONFIG" 2>/dev/null)" = "true" ] && HAS_SERENA=true
  [ "$(jq -r '.intellij // false' "$CONFIG" 2>/dev/null)" = "true" ] && HAS_INTELLIJ=true
  [ "$(jq -r '.["claude-context"] // false' "$CONFIG" 2>/dev/null)" = "true" ] && HAS_CONTEXT=true
fi

# Auto-detect from .mcp.json for anything not already forced
if [ -f "$MCP_JSON" ]; then
  [ "$HAS_SERENA" = "false" ] && jq -e '.mcpServers.serena' "$MCP_JSON" >/dev/null 2>&1 && HAS_SERENA=true || true
  [ "$HAS_INTELLIJ" = "false" ] && jq -e '.mcpServers["intellij-index"]' "$MCP_JSON" >/dev/null 2>&1 && HAS_INTELLIJ=true || true
  [ "$HAS_CONTEXT" = "false" ] && jq -e '.mcpServers["claude-context-local"]' "$MCP_JSON" >/dev/null 2>&1 && HAS_CONTEXT=true || true
fi
