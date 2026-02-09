#!/bin/bash
# SessionStart hook - ensure Serena is onboarded and activated
# Outputs instructions for Claude to follow at conversation start

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROJECT_NAME=$(basename "${CWD:-unknown}")

# Check if .serena/project.yml exists (Serena is configured for this project)
if [ ! -f "${CWD}/.serena/project.yml" ]; then
  exit 0
fi

# Detect the Serena tool prefix (plugin vs direct MCP)
# Check for plugin-style serena tools first, fall back to direct
if [ -f "${CWD}/.mcp.json" ] && grep -q '"serena"' "${CWD}/.mcp.json" 2>/dev/null; then
  SERENA_PREFIX="mcp__serena__"
else
  SERENA_PREFIX="mcp__serena__"
fi

cat << EOF
REQUIRED - Activate Serena NOW (before any other work):
1. Call the Serena check_onboarding_performed tool to check if this project is known
2. If onboarding was NOT performed, call the Serena onboarding tool and follow its instructions
3. Call the Serena activate_project tool with project_name='${PROJECT_NAME}' -- this is MANDATORY, do NOT skip it
All three steps must complete before you use any Serena tools. Serena tools will be BLOCKED until activate_project is called.
EOF
