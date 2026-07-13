#!/usr/bin/env bash
# Smoke test for goal-stop-hook.sh.
# Runs the hook with PATH/HOME stripped so codescout is unreachable, and
# asserts the fail-open output is valid JSON with a boolean `continue` field.
set -uo pipefail

HOOK="$(dirname "$0")/goal-stop-hook.mjs"

if [[ ! -f "$HOOK" ]]; then
    echo "FAIL: hook not found: $HOOK"
    exit 1
fi

# Simulate CC stdin. cwd points at a scratch dir so the hook's log writes
# (if any) land somewhere disposable.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

INPUT="{\"session_id\":\"test\",\"transcript_path\":\"/dev/null\",\"cwd\":\"$WORK\",\"last_assistant_message\":\"\"}"

# Force fail-open: scrub PATH (no `codescout`) and point HOME at a nonexistent
# dir so the $HOME/.cargo/bin fallback also misses. The hook should still
# emit `{"continue": true, ...}` rather than crash or produce non-JSON.
OUTPUT=$(echo "$INPUT" | env -i PATH=/usr/bin:/bin HOME=/nonexistent node "$HOOK" 2>&1 || true)

PARSED=$(echo "$OUTPUT" | jq -r '.continue' 2>/dev/null || echo "")
if [[ "$PARSED" != "true" && "$PARSED" != "false" ]]; then
    echo "FAIL: hook did not emit valid JSON with continue field"
    echo "stdout: $OUTPUT"
    exit 1
fi
echo "PASS: hook emits valid JSON (continue=$PARSED)"
