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

cat << EOF
IMPORTANT - Serena Setup (do this before any other work):
1. Call check_onboarding_performed() to see if Serena knows this project
2. If onboarding was NOT performed, run onboarding() and follow its instructions
3. Call activate_project('${PROJECT_NAME}') to activate the project for this session
This ensures Serena has full project context for semantic code operations.
EOF
