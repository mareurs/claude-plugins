#!/bin/bash
# Shared detection logic - sourced by other hooks
# Expects: CWD to be set before sourcing
# Sets: HAS_SERENA, HAS_INTELLIJ, HAS_CONTEXT (true/false)
#        SOURCE_EXT_PATTERN (regex for source file extensions)
#        HAS_SERENA_MEMORIES (true/false), SERENA_MEMORY_NAMES (space-separated)
#
# Detection order:
# 1. Check .claude/tool-infra.json for forced overrides (for global MCP servers)
# 2. Fall back to .mcp.json auto-detection
# 3. Parse .serena/project.yml for language-aware extension filtering

MCP_JSON="${CWD}/.mcp.json"
CONFIG="${CWD}/.claude/tool-infra.json"
SERENA_PROJECT_YML="${CWD}/.serena/project.yml"
SERENA_MEMORIES_DIR="${CWD}/.serena/memories"

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

# --- Language-aware source file detection ---
# Parse .serena/project.yml for project languages → map to file extensions
SOURCE_EXT_PATTERN=""
if [ "$HAS_SERENA" = "true" ] && [ -f "$SERENA_PROJECT_YML" ]; then
  LANGS=$(grep -A 50 "^languages:" "$SERENA_PROJECT_YML" 2>/dev/null | grep "^- " | sed 's/^- //' | tr -d ' "' )
  EXT_LIST=""
  for lang in $LANGS; do
    case "$lang" in
      typescript|typescript_vts) EXT_LIST="$EXT_LIST ts tsx js jsx" ;;
      python|python_jedi)       EXT_LIST="$EXT_LIST py" ;;
      java)                     EXT_LIST="$EXT_LIST java" ;;
      kotlin)                   EXT_LIST="$EXT_LIST kt kts" ;;
      go)                       EXT_LIST="$EXT_LIST go" ;;
      rust)                     EXT_LIST="$EXT_LIST rs" ;;
      cpp)                      EXT_LIST="$EXT_LIST cpp c h hpp" ;;
      csharp|csharp_omnisharp)  EXT_LIST="$EXT_LIST cs" ;;
      ruby|ruby_solargraph)     EXT_LIST="$EXT_LIST rb" ;;
      scala)                    EXT_LIST="$EXT_LIST scala" ;;
      swift)                    EXT_LIST="$EXT_LIST swift" ;;
      bash)                     EXT_LIST="$EXT_LIST sh" ;;
      vue)                      EXT_LIST="$EXT_LIST vue" ;;
      dart)                     EXT_LIST="$EXT_LIST dart" ;;
      elixir)                   EXT_LIST="$EXT_LIST ex exs" ;;
      lua)                      EXT_LIST="$EXT_LIST lua" ;;
      php)                      EXT_LIST="$EXT_LIST php" ;;
      zig)                      EXT_LIST="$EXT_LIST zig" ;;
    esac
  done
  if [ -n "$EXT_LIST" ]; then
    # Deduplicate and build regex: \.(ts|tsx|js|jsx)$
    SOURCE_EXT_PATTERN=$(echo "$EXT_LIST" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' '|' | sed 's/|$//')
    SOURCE_EXT_PATTERN="\\.(${SOURCE_EXT_PATTERN})$"
  fi
fi

# Fallback: broad pattern when no Serena project config
if [ -z "$SOURCE_EXT_PATTERN" ]; then
  SOURCE_EXT_PATTERN='\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|cs|rb|scala|swift|cpp|c|h|hpp)$'
fi

# --- Serena memories detection ---
HAS_SERENA_MEMORIES=false
SERENA_MEMORY_NAMES=""
if [ "$HAS_SERENA" = "true" ] && [ -d "$SERENA_MEMORIES_DIR" ]; then
  MEMORY_FILES=$(ls "$SERENA_MEMORIES_DIR"/*.md 2>/dev/null)
  if [ -n "$MEMORY_FILES" ]; then
    HAS_SERENA_MEMORIES=true
    SERENA_MEMORY_NAMES=$(basename -a $MEMORY_FILES | sed 's/\.md$//' | tr '\n' ' ')
  fi
fi
