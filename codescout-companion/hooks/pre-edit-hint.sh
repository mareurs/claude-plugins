#!/bin/bash
# codescout-companion/hooks/pre-edit-hint.sh
# PreToolUse hook on mcp__codescout__(edit_code|replace_symbol) — emit
# recon-for-shape-changes pointer on first shape-changing edit this session.
# Dedup via .buddy/$SID/hint-emitted-recon-edit marker (shared across
# edit_code and replace_symbol because both are shape-changing seams).

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

emit_skill_hint "recon-edit" "Before this shape-changing edit (edit_code|replace_symbol): if the change touches struct fields, function signatures, or API contracts not yet scouted this session, call Skill('codescout-companion:reconnaissance') first to capture friction and wins."
exit 0
