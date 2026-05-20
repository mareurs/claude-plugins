#!/bin/bash
# codescout-companion/hooks/skill-hints.sh
# Shared library: skill-hint emission + session-scoped marker dedup.
# Source from any companion hook that needs to fire a one-shot, session-scoped
# skill pointer.
#
# Caller must set CWD and SESSION_ID before invoking emit_skill_hint.
# Marker convention: $CWD/.buddy/$SESSION_ID/hint-emitted-<topic>

# emit_skill_hint <topic> <hint_text>
# Stdout: {"hookSpecificOutput":{"additionalContext": <hint>}} on first call
#         for <topic> in this session. Touches the marker.
#         Silent {} when marker present, SESSION_ID empty, or CWD empty.
emit_skill_hint() {
  local topic="$1"
  local hint="$2"
  if [ -z "$SESSION_ID" ] || [ -z "$CWD" ]; then
    jq -n '{}'
    return
  fi
  local marker_dir="$CWD/.buddy/$SESSION_ID"
  local marker="$marker_dir/hint-emitted-$topic"
  if [ -f "$marker" ]; then
    jq -n '{}'
    return
  fi
  mkdir -p "$marker_dir" 2>/dev/null
  touch "$marker" 2>/dev/null
  jq -n --arg ctx "$hint" '{hookSpecificOutput:{additionalContext:$ctx}}'
}
