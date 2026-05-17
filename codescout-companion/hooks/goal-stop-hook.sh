#!/usr/bin/env bash
# Stop hook for codescout goal-trackers.
#
# Reads CC stdin JSON (session_id, transcript_path, cwd, last_assistant_message),
# queries the active goal-tracker via `codescout artifact find/get --json`,
# and emits {"continue": bool, "reason": "..."} based on params.status.
#
# Strategy: two-step. `find` does not return augmentation params, so we list
# active goal trackers first, then `get --full` the single match to read
# `.augmentation.params.{status, criterion, blocked_reason, acceptance_signals}`.
#
# Fail-open: any error path (binary missing, query failure, malformed JSON)
# emits continue=true so the hook never deadlocks the agent loop.
# Disable entirely via .claude/codescout-companion.json {"goal_stop_hook": false}.

set -uo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")

log() {
    local logdir="$CWD/.claude"
    local logfile="$logdir/codescout-companion.log"
    mkdir -p "$logdir" 2>/dev/null || return 0
    echo "$(date -Iseconds) goal-stop-hook: $*" >> "$logfile"
}

# --- 1. Disable flag ---
CONFIG_FILE="$CWD/.claude/codescout-companion.json"
if [[ -f "$CONFIG_FILE" ]]; then
    DISABLED=$(jq -r '.goal_stop_hook // true | if . == false or . == "false" then "1" else "0" end' "$CONFIG_FILE" 2>/dev/null || echo "0")
    if [[ "$DISABLED" == "1" ]]; then
        echo '{"continue": true, "reason": "goal_stop_hook disabled in .claude/codescout-companion.json"}'
        exit 0
    fi
fi

# --- 2. Locate codescout binary ---
CS=$(command -v codescout 2>/dev/null || true)
if [[ -z "$CS" ]]; then
    for cand in "$HOME/.cargo/bin/codescout" "$CWD/target/release/codescout"; do
        if [[ -x "$cand" ]]; then CS="$cand"; break; fi
    done
fi
if [[ -z "$CS" ]]; then
    log "codescout binary not found on PATH or in fallback locations"
    echo '{"continue": true, "reason": "codescout binary not found — fail-open"}'
    exit 0
fi

# --- 3. Find active goal(s) ---
# `2>/dev/null` strips the librarian's INFO/WARN log lines so stdout stays pure JSON.
FIND_OUT=$("$CS" artifact find --kind tracker --tag goal --status active --project "$CWD" --limit 5 --json 2>/dev/null || echo "")
if [[ -z "$FIND_OUT" ]]; then
    log "codescout artifact find failed or returned empty"
    echo '{"continue": true, "reason": "codescout query failed — fail-open"}'
    exit 0
fi

COUNT=$(echo "$FIND_OUT" | jq -r '.count // (.items | length) // 0' 2>/dev/null || echo "0")
# Defensive: jq may emit "null" if both paths missing.
if [[ "$COUNT" == "null" || -z "$COUNT" ]]; then COUNT=0; fi

if [[ "$COUNT" == "0" ]]; then
    echo '{"continue": true, "reason": "no active goal"}'
    exit 0
fi
if [[ "$COUNT" -gt 1 ]] 2>/dev/null; then
    printf '{"continue": true, "reason": "multiple active goals (%s) — ambiguous, deferring"}\n' "$COUNT"
    exit 0
fi

# --- 4. Drill into the one goal's augmentation params ---
GOAL_ID=$(echo "$FIND_OUT" | jq -r '.items[0].id // empty' 2>/dev/null || echo "")
if [[ -z "$GOAL_ID" ]]; then
    log "goal id missing from find envelope"
    echo '{"continue": true, "reason": "goal id missing — fail-open"}'
    exit 0
fi

GET_OUT=$("$CS" artifact get "$GOAL_ID" --full --project "$CWD" --json 2>/dev/null || echo "")
if [[ -z "$GET_OUT" ]]; then
    log "codescout artifact get $GOAL_ID failed"
    echo '{"continue": true, "reason": "codescout get failed — fail-open"}'
    exit 0
fi

# Params live under .augmentation.params (verified against codescout artifact get --full --json).
PARAMS=$(echo "$GET_OUT" | jq -c '.augmentation.params // empty' 2>/dev/null || echo "")
if [[ -z "$PARAMS" || "$PARAMS" == "null" ]]; then
    log "goal $GOAL_ID has no augmentation.params — treating as active"
    echo '{"continue": true, "reason": "goal has no params — fail-open"}'
    exit 0
fi

STATUS=$(echo "$PARAMS" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
CRITERION=$(echo "$PARAMS" | jq -r '.criterion // ""' 2>/dev/null | cut -c1-120)
BLOCKED_REASON=$(echo "$PARAMS" | jq -r '.blocked_reason // ""' 2>/dev/null | cut -c1-120)

case "$STATUS" in
    done)
        jq -nc --arg c "$CRITERION" '{continue: false, reason: ("goal done: " + $c)}'
        ;;
    blocked)
        REASON_TEXT="${BLOCKED_REASON:-$CRITERION}"
        jq -nc --arg r "$REASON_TEXT" '{continue: false, reason: ("goal blocked: " + $r)}'
        ;;
    abandoned)
        jq -nc --arg c "$CRITERION" '{continue: false, reason: ("goal abandoned: " + $c)}'
        ;;
    *)
        # active / scoping / pending-confirmation / unknown — keep going.
        NEXT=$(echo "$PARAMS" | jq -r '.acceptance_signals // [] | map(select(.met == false)) | .[0].description // ""' 2>/dev/null | cut -c1-120)
        TARGET="${NEXT:-$CRITERION}"
        TARGET="${TARGET:-active goal in progress}"
        jq -nc --arg t "$TARGET" '{continue: true, reason_to_continue: ("next acceptance signal: " + $t)}'
        ;;
esac
