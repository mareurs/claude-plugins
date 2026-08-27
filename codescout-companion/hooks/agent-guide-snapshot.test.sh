#!/usr/bin/env bash
# Test: agent-guide-snapshot.mjs (PreToolUse: Agent) + agent-guide-restore.mjs
# (PostToolUse: Agent) — snapshot/restore the codescout guide-hints ledger
# around a subagent dispatch, so a subagent's own get_guide-triggering tool
# calls don't silently mark topics delivered for the whole session, starving
# the parent of guidance the server believes it already handed over.
#
# codescout:docs/issues/2026-08-26-subagent-guide-fetch-starves-parent.md
#
# Ledger path mirrors src/tools/guide_ledger.rs's own resolution exactly:
# <XDG_STATE_HOME>/codescout/guide_hints/<sanitize(session_id)>.json, where
# sanitize maps anything outside [A-Za-z0-9_-] to '_'. Both sides must agree
# on this path or the hooks silently operate on the wrong file.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SNAPSHOT_HOOK="$HERE/agent-guide-snapshot.mjs"
RESTORE_HOOK="$HERE/agent-guide-restore.mjs"
HOOKS_JSON="$HERE/hooks.json"
PASS=0
FAIL=0

check() {  # <label> <got> <expected>
  if [[ "$2" == "$3" ]]; then
    echo "PASS [$1]"; PASS=$((PASS+1))
  else
    echo "FAIL [$1]: expected=$3 got=$2"; FAIL=$((FAIL+1))
  fi
}

SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT

# Fixture: a project detect.mjs recognizes as codescout-configured.
PROJECT="$SANDBOX/project"
mkdir -p "$PROJECT"
cat > "$PROJECT/.mcp.json" <<'EOF'
{"mcpServers":{"codescout":{"command":"codescout"}}}
EOF

# XDG_STATE_HOME isolates the ledger to this test's own sandbox.
STATE_HOME="$SANDBOX/state"
mkdir -p "$STATE_HOME"
export XDG_STATE_HOME="$STATE_HOME"

SESSION="conv-a"
LEDGER_DIR="$STATE_HOME/codescout/guide_hints"
LEDGER_FILE="$LEDGER_DIR/${SESSION}.json"
mkdir -p "$LEDGER_DIR"

run_pre() {  # <session_id> <tool_use_id>
  jq -n --arg s "$1" --arg id "$2" --arg c "$PROJECT" \
    '{session_id:$s, tool_use_id:$id, cwd:$c, tool_name:"Agent"}' | node "$SNAPSHOT_HOOK"
}
run_post() {  # <session_id> <tool_use_id>
  jq -n --arg s "$1" --arg id "$2" --arg c "$PROJECT" \
    '{session_id:$s, tool_use_id:$id, cwd:$c, tool_name:"Agent"}' | node "$RESTORE_HOOK"
}

# --- Case 1: ledger pre-exists with a parent-delivered topic; a subagent's
#     own fetch adds a new one; restore must bring back exactly the original,
#     not an empty ledger -- proving this is snapshot/restore, not a wipe. ---
echo '{"librarian":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
run_pre "$SESSION" "toolu_1" > /dev/null
# Simulate the subagent's own tool call marking a second topic delivered.
echo '{"librarian":"2026-08-01T00:00:00Z","workspace-state":"2026-08-01T00:05:00Z"}' > "$LEDGER_FILE"
run_post "$SESSION" "toolu_1" > /dev/null
GOT=$(cat "$LEDGER_FILE" 2>/dev/null | jq -S .)
WANT=$(echo '{"librarian":"2026-08-01T00:00:00Z"}' | jq -S .)
check "restores pre-dispatch content, not empty" "$GOT" "$WANT"

# --- Case 2: no ledger existed before dispatch; subagent's fetch creates
#     one; restore must delete it, returning to true absence. ---
rm -f "$LEDGER_FILE"
run_pre "$SESSION" "toolu_2" > /dev/null
echo '{"progressive-disclosure":"2026-08-01T00:10:00Z"}' > "$LEDGER_FILE"
run_post "$SESSION" "toolu_2" > /dev/null
if [[ -f "$LEDGER_FILE" ]]; then
  echo "FAIL [restores true absence]: ledger file still exists"; FAIL=$((FAIL+1))
else
  echo "PASS [restores true absence]"; PASS=$((PASS+1))
fi

# --- Case 3: concurrent dispatches (two distinct tool_use_id) must not
#     collide -- each pair operates on its own snapshot. ---
echo '{"a":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
run_pre "$SESSION" "toolu_3a" > /dev/null
echo '{"a":"2026-08-01T00:00:00Z","b":"2026-08-01T00:01:00Z"}' > "$LEDGER_FILE"
run_pre "$SESSION" "toolu_3b" > /dev/null
echo '{"a":"2026-08-01T00:00:00Z","b":"2026-08-01T00:01:00Z","c":"2026-08-01T00:02:00Z"}' > "$LEDGER_FILE"
run_post "$SESSION" "toolu_3a" > /dev/null
GOT=$(cat "$LEDGER_FILE" | jq -S .)
WANT=$(echo '{"a":"2026-08-01T00:00:00Z"}' | jq -S .)
check "first dispatch restores its own pre-dispatch snapshot" "$GOT" "$WANT"

# --- Case 4: restore with no prior snapshot (Pre never ran) is a no-op. ---
echo '{"z":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
run_post "$SESSION" "toolu_never_snapshotted" > /dev/null
GOT=$(cat "$LEDGER_FILE" | jq -S .)
WANT=$(echo '{"z":"2026-08-01T00:00:00Z"}' | jq -S .)
check "restore no-ops without a matching snapshot" "$GOT" "$WANT"

# --- Case 5: missing tool_use_id degrades to a safe no-op on both sides. ---
echo '{"q":"2026-08-01T00:00:00Z"}' > "$LEDGER_FILE"
run_pre "$SESSION" "" > /dev/null
echo '{"q":"2026-08-01T00:00:00Z","r":"2026-08-01T00:01:00Z"}' > "$LEDGER_FILE"
run_post "$SESSION" "" > /dev/null
GOT=$(cat "$LEDGER_FILE" | jq -S .)
WANT=$(echo '{"q":"2026-08-01T00:00:00Z","r":"2026-08-01T00:01:00Z"}' | jq -S .)
check "missing tool_use_id is a safe no-op, not a crash" "$GOT" "$WANT"

# --- Wiring: both hooks registered on the Agent matcher, correct events. ---
PRE_MATCHER=$(jq -r '
  .hooks.PreToolUse[]
  | select(any(.hooks[]?; ((.command // "") + " " + ((.args // []) | join(" "))) | test("agent-guide-snapshot\\.mjs")))
  | .matcher' "$HOOKS_JSON")
check "snapshot hook wired to PreToolUse:Agent" "$PRE_MATCHER" "Agent"

POST_MATCHER=$(jq -r '
  .hooks.PostToolUse[]
  | select(any(.hooks[]?; ((.command // "") + " " + ((.args // []) | join(" "))) | test("agent-guide-restore\\.mjs")))
  | .matcher' "$HOOKS_JSON")
check "restore hook wired to PostToolUse:Agent" "$POST_MATCHER" "Agent"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
