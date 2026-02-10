#!/bin/bash
# SubagentStart hook - inject semantic tool workflow into Explore agents

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

if [ "$AGENT_TYPE" != "Explore" ]; then
  exit 0
fi

cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "CODE EXPLORATION WORKFLOW:\n\n1. Semantic Discovery: Use search_code or search_for_pattern for conceptual understanding\n2. Symbol Drill-down: Use find_symbol on key terms for precise definitions\n3. Cross-reference: Use find_referencing_symbols for usage patterns\n\nPrefer semantic tools over Grep/Glob for source files."
  }
}
EOF
