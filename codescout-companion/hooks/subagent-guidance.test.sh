#!/usr/bin/env bash
# Tests for subagent-guidance.mjs — the SubagentStart codescout briefing.
#
# Two layers:
#  1. Gate tests — agent_type exclusions, and the codescout gate driven to
#     CLOSED. The gate case overrides HOME + CLAUDE_CONFIG_DIR; a bare temp cwd
#     is NOT enough, because HAS_CODESCOUT is config-based, not per-project
#     (F-2 in docs/trackers/subagent-bootstrap-session-log.md). detect.mjs
#     consults ~/.claude.json only when CLAUDE_CONFIG_DIR is unset, so setting
#     it is what seals the last discovery path.
#  2. Output-shape tests — driven with CS_SUBAGENT_GUIDANCE_FORCE=1 so they run
#     on any machine regardless of local codescout config. Modelled on
#     explore-inject.test.sh, which is the suite that actually drives a hook
#     end-to-end; pre-task-hint.test.sh is config-only and is NOT a model for
#     output assertions (F-1).

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/subagent-guidance.mjs"

PASS=0; FAIL=0
ok() {
  if [ "$2" = "$3" ]; then echo "PASS [$1]"; PASS=$((PASS+1));
  else echo "FAIL [$1]: exp=$3 got=$2"; FAIL=$((FAIL+1)); fi
}
has()   { case "$2" in *"$3"*) ok "$1" yes yes ;; *) ok "$1" no yes ;; esac; }
hasnt() { case "$2" in *"$3"*) ok "$1" present absent ;; *) ok "$1" absent absent ;; esac; }

# ctx <cwd> [agent_type] → injected additionalContext, forced past the gate.
ctx() {
  local cwd="$1" at="${2:-general-purpose}"
  jq -nc --arg cwd "$cwd" --arg at "$at" \
    '{cwd:$cwd,agent_type:$at,agent_id:"a1",session_id:"s1"}' \
    | CS_SUBAGENT_GUIDANCE_FORCE=1 node "$HOOK" 2>/dev/null \
    | jq -r '.hookSpecificOutput.additionalContext // ""'
}

# raw <cwd> <agent_type> → whole stdout, seam NOT set (for gate tests).
raw() {
  jq -nc --arg cwd "$1" --arg at "$2" '{cwd:$cwd,agent_type:$at}' | node "$HOOK" 2>/dev/null
}

# ---------- 1. Gates ----------

# Case 1: codescout not configured → silent. Needs env override, not just cwd.
T1=$(mktemp -d); mkdir -p "$T1/cfg"
O1=$(jq -nc --arg cwd "$T1" '{cwd:$cwd,agent_type:"general-purpose"}' \
      | HOME="$T1" CLAUDE_CONFIG_DIR="$T1/cfg" node "$HOOK" 2>/dev/null)
[ -z "$O1" ] && ok "gate: no codescout config → silent" silent silent \
             || ok "gate: no codescout config → silent" emitted silent
rm -rf "$T1"

# Case 2: excluded agent types exit before any detection.
for at in Bash statusline-setup claude-code-guide; do
  [ -z "$(raw /tmp "$at")" ] && ok "gate: agent_type $at → silent" silent silent \
                             || ok "gate: agent_type $at → silent" emitted silent
done

# Non-excluded type must NOT be silenced by the exclusion list.
T2=$(mktemp -d)
[ -n "$(ctx "$T2")" ] && ok "gate: general-purpose → emits" emits emits \
                      || ok "gate: general-purpose → emits" silent emits
rm -rf "$T2"

# ---------- 2. Pre-existing behavior (regression guards) ----------

# Case 7: system prompt still appended verbatim.
T7=$(mktemp -d); mkdir -p "$T7/.codescout"
printf 'SENTINEL-SYSPROMPT-SEVEN\n' > "$T7/.codescout/system-prompt.md"
O7=$(ctx "$T7")
has "sysprompt: appended verbatim" "$O7" "SENTINEL-SYSPROMPT-SEVEN"
has "sysprompt: protocol still present" "$O7" "codescout EXPLORATION PROTOCOL"
has "sysprompt: rules still present"    "$O7" "CODESCOUT RULES"
rm -rf "$T7"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
