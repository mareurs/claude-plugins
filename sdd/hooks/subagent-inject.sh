#!/usr/bin/env bash
set -euo pipefail

# Claude Code SubagentStart hook for SDD plugin
# Injects exploration guidance into Explore subagents

INPUT="$(cat)"

AGENT_TYPE="$(echo "$INPUT" | jq -r '.agent_type // empty')"

# Only process Explore agents
if [[ "$AGENT_TYPE" != "Explore" ]]; then
  exit 0
fi

# Get working directory
PROJECT_DIR="$(echo "$INPUT" | jq -r '.cwd // empty')"
PROJECT_DIR="${PROJECT_DIR:-${CWD:-$PWD}}"

# Check if project uses SDD
if [[ ! -f "$PROJECT_DIR/memory/constitution.md" ]]; then
  exit 0
fi

# List spec files if they exist
SPEC_LIST=""
if [[ -d "$PROJECT_DIR/memory/specs" ]]; then
  SPEC_FILES="$(ls "$PROJECT_DIR/memory/specs/" 2>/dev/null || true)"
  if [[ -n "$SPEC_FILES" ]]; then
    SPEC_LIST="\nSpec files:\n"
    while IFS= read -r f; do
      SPEC_LIST+="- $f\n"
    done <<< "$SPEC_FILES"
  fi
fi

CONTEXT="SDD PROJECT - EXPLORATION GUIDANCE\n\nThis project uses Specification-Driven Development.\nSpecs: memory/specs/ | Plans: memory/plans/ | Constitution: memory/constitution.md\n${SPEC_LIST}\nTOOL ROUTING:\n- Source code: prefer Serena tools (find_symbol, get_symbols_overview, search_for_pattern) over Grep/Read\n- Non-code files (.md, .json, .yaml, .sql): use Grep, Read, Glob\n- Always pass relative_path to find_symbol for performance\n\nPHASES:\n1. Semantic Discovery - search_code or search_for_pattern for concepts\n2. Symbol Drill-down - find_symbol for specific classes/methods\n3. Cross-reference - find_referencing_symbols for usage patterns"

jq -n --arg ctx "$CONTEXT" '{hookSpecificOutput: {additionalContext: $ctx}}'
