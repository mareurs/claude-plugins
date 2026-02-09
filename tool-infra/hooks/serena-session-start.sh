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
REQUIRED - Activate Serena NOW (before any other work):
1. Call check_onboarding_performed()
2. If onboarding was NOT performed, run onboarding() and follow its instructions
3. Call activate_project('${PROJECT_NAME}') -- this step is MANDATORY, do NOT skip it
All three steps must complete before you use any Serena tools. Serena tools will be BLOCKED until activate_project is called.
EOF
