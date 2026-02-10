#!/bin/bash
# Shared detection logic - sourced by other hooks
# Expects: CWD to be set before sourcing
# Sets: HAS_SERENA, HAS_INTELLIJ, HAS_CONTEXT (true/false)

MCP_JSON="${CWD}/.mcp.json"

HAS_SERENA=false
HAS_INTELLIJ=false
HAS_CONTEXT=false

if [ -f "$MCP_JSON" ]; then
  jq -e '.mcpServers.serena' "$MCP_JSON" >/dev/null 2>&1 && HAS_SERENA=true
  jq -e '.mcpServers["intellij-index"]' "$MCP_JSON" >/dev/null 2>&1 && HAS_INTELLIJ=true
  jq -e '.mcpServers["claude-context-local"]' "$MCP_JSON" >/dev/null 2>&1 && HAS_CONTEXT=true
fi
