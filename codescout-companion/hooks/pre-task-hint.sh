#!/bin/bash
# codescout-companion/hooks/pre-task-hint.sh
# PreToolUse hook on Agent — emit recon pointer on first Agent dispatch
# this session. Dedup via .buddy/$SID/hint-emitted-recon marker.

if ! command -v jq &>/dev/null; then
  exit 0
fi

INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

source "$(dirname "$0")/detect-tools.sh"
[ "$HAS_CODESCOUT" = "false" ] && exit 0

source "$(dirname "$0")/skill-hints.sh"

emit_skill_hint "recon" "First Agent dispatch this session. Reconnaissance recommended before subagent work — call Skill('codescout-companion:reconnaissance') for the full method unless this seam has already been scouted."
exit 0
