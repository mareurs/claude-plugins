#!/usr/bin/env bash
set -euo pipefail

# Read hook input JSON from stdin
INPUT="$(cat)"

# Get CWD from input JSON's cwd field, fall back to $PWD
PROJECT_DIR="$(echo "$INPUT" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
PROJECT_DIR="${PROJECT_DIR:-${CWD:-$PWD}}"

# Check if project is SDD-initialized
if [[ ! -f "$PROJECT_DIR/memory/constitution.md" ]]; then
  exit 0
fi

# Read enforcement level from sdd-config.md YAML frontmatter
ENFORCEMENT="warn"
CONFIG_FILE="$PROJECT_DIR/memory/sdd-config.md"
if [[ -f "$CONFIG_FILE" ]]; then
  PARSED="$(sed -n '/^---$/,/^---$/{ /^enforcement:/{ s/^enforcement:[[:space:]]*//p; q; } }' "$CONFIG_FILE")"
  if [[ -n "$PARSED" ]]; then
    ENFORCEMENT="$PARSED"
  fi
fi

# Build additionalContext
CONTEXT="SDD is active for this project.\nCommands: /specify, /plan, /review, /drift, /document\nConstitution: memory/constitution.md\nEnforcement: ${ENFORCEMENT}\nSpecs: memory/specs/ | Plans: memory/plans/\n\nRun /specify <feature> to start a new feature.\nRun /review before committing."

# Output JSON
cat <<EOF
{"hookSpecificOutput":{"additionalContext":"${CONTEXT}"}}
EOF
