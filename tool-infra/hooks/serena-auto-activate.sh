#!/bin/bash
# SessionStart hook - Auto-activate Serena project
# Forces immediate activation with mandatory instructions

set -euo pipefail

INPUT=$(cat)
SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Only activate on startup/resume
if [[ "$SOURCE" != "startup" && "$SOURCE" != "resume" ]]; then
  exit 0
fi

# Must have a project directory
if [ -z "$CWD" ]; then
  exit 0
fi

# Detect serena availability
source "$(dirname "$0")/detect-tools.sh"

# Serena not available → nothing to do
if [ "$HAS_SERENA" = "false" ]; then
  exit 0
fi

# Detect project name from directory
PROJECT_NAME=$(basename "$CWD")

# Generate session-specific marker for tracking
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"
MARKER_DIR="$HOME/.claude-sdd/tmp/serena-activation"
MARKER="$MARKER_DIR/$SESSION_ID"

# Already activated this session
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "activated" ]; then
  exit 0
fi

# Mark as activation-pending
mkdir -p "$MARKER_DIR"
echo "pending" > "$MARKER"

# Output mandatory activation instructions
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "═══ CRITICAL INITIALIZATION (Serena) ═══

Before proceeding with ANY user task, you MUST complete these steps:

1. Call: mcp__serena__check_onboarding_performed()
   - Verify serena is properly configured
   - Note any available memories (don't read them yet)

2. Call: mcp__serena__activate_project() with path: $CWD
   - This enables semantic code intelligence tools
   - Required once per session

3. After BOTH calls succeed, proceed with the user's request

Project: $PROJECT_NAME
Directory: $CWD

Do NOT skip these steps. Do NOT ask the user about this. Just execute them now.

═══════════════════════════════════════"
  }
}
EOF
