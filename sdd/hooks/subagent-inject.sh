#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
AGENT_TYPE="$(echo "$INPUT" | jq -r '.agent_type // empty')"

# Skip agents that don't do code work
case "$AGENT_TYPE" in
  Bash|statusline-setup|claude-code-guide|episodic-memory*)
    exit 0
    ;;
esac

# Get working directory
PROJECT_DIR="$(echo "$INPUT" | jq -r '.cwd // empty')"
PROJECT_DIR="${PROJECT_DIR:-${CWD:-$PWD}}"

# Check if project uses SDD
if [[ ! -f "$PROJECT_DIR/memory/constitution.md" ]]; then
  exit 0
fi

# State detection — filenames only, no content
SPECS="none"
if compgen -G "$PROJECT_DIR/memory/specs/*.md" > /dev/null 2>&1; then
  SPECS="$(ls "$PROJECT_DIR/memory/specs/"*.md 2>/dev/null | xargs -r basename -a | tr '\n' ' ' | xargs)"
fi

PLANS="none"
if [[ -d "$PROJECT_DIR/memory/plans" ]] && [[ -n "$(ls -A "$PROJECT_DIR/memory/plans" 2>/dev/null)" ]]; then
  PLANS="$(ls "$PROJECT_DIR/memory/plans/" 2>/dev/null | tr '\n' ' ' | xargs)"
fi

case "$AGENT_TYPE" in
  Plan)
    CONTEXT="SDD: Plan must stay within spec scope. Human approval required before execution.
Constitution: memory/constitution.md
Active specs: ${SPECS}
Active plans: ${PLANS}
Read the relevant spec before planning. Your plan output needs human approval before implementation begins."
    ;;

  general-purpose)
    CONTEXT="SDD: Follow the approved plan. Don't exceed spec scope.
Active specs: memory/specs/ → ${SPECS}
Approved plans: memory/plans/ → ${PLANS}
spec-guard will block writes without a spec."
    ;;

  superpowers:code-reviewer)
    CONTEXT="SDD: Review implementation against the spec, not just code quality.
Specs: memory/specs/ → ${SPECS}
Check: does implementation match acceptance criteria? Does it exceed scope?"
    ;;

  Explore)
    SPEC_LIST=""
    if [[ -d "$PROJECT_DIR/memory/specs" ]]; then
      SPEC_FILES="$(ls "$PROJECT_DIR/memory/specs/"*.md 2>/dev/null || true)"
      if [[ -n "$SPEC_FILES" ]]; then
        SPEC_LIST="\nSpec files:\n"
        while IFS= read -r f; do
          SPEC_LIST+="- $f\n"
        done <<< "$SPEC_FILES"
      fi
    fi
    CONTEXT="SDD PROJECT - EXPLORATION GUIDANCE\n\nThis project uses Specification-Driven Development.\nSpecs: memory/specs/ | Plans: memory/plans/ | Constitution: memory/constitution.md\n${SPEC_LIST}\nTOOL ROUTING:\n- Source code: prefer Serena tools (find_symbol, get_symbols_overview, search_for_pattern) over Grep/Read\n- Non-code files (.md, .json, .yaml, .sql): use Grep, Read, Glob\n- Always pass relative_path to find_symbol for performance\n\nPHASES:\n1. Semantic Discovery - search_code or search_for_pattern for concepts\n2. Symbol Drill-down - find_symbol for specific classes/methods\n3. Cross-reference - find_referencing_symbols for usage patterns"
    ;;

  *)
    # Unknown agent type — no injection
    exit 0
    ;;
esac

jq -n --arg ctx "$CONTEXT" '{hookSpecificOutput: {additionalContext: $ctx}}'
