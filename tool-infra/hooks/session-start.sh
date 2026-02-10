#!/bin/bash
# SessionStart hook - semantic tool reminder + schema pre-loading
# Auto-detects available MCP servers from .mcp.json

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
source "$(dirname "$0")/detect-tools.sh"

# Build tool reference card
MSG="SEMANTIC TOOLS AVAILABLE:"

if [ "$HAS_SERENA" = "true" ]; then
  MSG="$MSG

Serena (all languages with LSP support):
  find_symbol / replace_symbol_body - Read/edit symbols by name
  get_symbols_overview - File structure overview
  search_for_pattern - Regex search (param: substring_pattern, NOT pattern)
  find_referencing_symbols - Find all usages"
fi

if [ "$HAS_INTELLIJ" = "true" ]; then
  MSG="$MSG

IntelliJ (all languages in project):
  ide_find_symbol - Find classes/functions by name
  ide_find_references - Find all usages
  ide_find_file - Find files by name
  ide_file_structure - File outline"
fi

if [ "$HAS_CONTEXT" = "true" ]; then
  MSG="$MSG

Claude Context (semantic search):
  search_code - Natural language queries across all files"
fi

MSG="$MSG

Text search (non-source files only):
  Grep - Literal strings, regex, config/docs files

STARTUP TASK - Load tool schemas now:"

# Build schema loading instructions
N=1
if [ "$HAS_SERENA" = "true" ]; then
  MSG="$MSG
$N. ToolSearch(query='select:mcp__serena__find_symbol', max_results=1)"
  N=$((N+1))
  MSG="$MSG
$N. ToolSearch(query='select:mcp__serena__search_for_pattern', max_results=1)"
  N=$((N+1))
  MSG="$MSG
$N. ToolSearch(query='select:mcp__serena__get_symbols_overview', max_results=1)"
  N=$((N+1))
fi

if [ "$HAS_INTELLIJ" = "true" ]; then
  MSG="$MSG
$N. ToolSearch(query='select:mcp__intellij-index__ide_find_symbol', max_results=1)"
  N=$((N+1))
  MSG="$MSG
$N. ToolSearch(query='select:mcp__intellij-index__ide_find_references', max_results=1)"
  N=$((N+1))
  MSG="$MSG
$N. ToolSearch(query='select:mcp__intellij-index__ide_find_file', max_results=1)"
  N=$((N+1))
fi

if [ "$HAS_CONTEXT" = "true" ]; then
  MSG="$MSG
$N. ToolSearch(query='select:mcp__claude-context-local__search_code', max_results=1)"
  N=$((N+1))
fi

MSG="$MSG

Execute these ToolSearch calls before responding to the user."

echo "$MSG"
