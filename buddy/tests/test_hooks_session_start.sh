#!/usr/bin/env bash
# Test session-start.sh: pointer + by-ppid + GC + dead file removal.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/session-start.sh"

PASS=0; FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
EVENT='{"session_id":"sid-aaa","cwd":"'"$WORK"'","source":"startup","timestamp":1700000000}'

echo "$EVENT" | bash "$HOOK" >/dev/null 2>&1 || true

[ -f "$WORK/.buddy/.current_session_id" ] && [ "$(cat "$WORK/.buddy/.current_session_id")" = "sid-aaa" ] \
  && pass "pointer file written" || fail "pointer file"

[ -f "$WORK/.buddy/by-ppid/$$/session_id" ] && [ "$(cat "$WORK/.buddy/by-ppid/$$/session_id")" = "sid-aaa" ] \
  && pass "by-ppid session_id written" || fail "by-ppid session_id"

[ -f "$WORK/.buddy/by-ppid/$$/started_at" ] && [ -s "$WORK/.buddy/by-ppid/$$/started_at" ] \
  && pass "by-ppid started_at written" || fail "by-ppid started_at"

# GC: seed a stale by-ppid entry with bogus pid + bogus started_at
mkdir -p "$WORK/.buddy/by-ppid/99999"
echo "stale-sid" > "$WORK/.buddy/by-ppid/99999/session_id"
echo "BOGUS_TIME" > "$WORK/.buddy/by-ppid/99999/started_at"

EVENT2='{"session_id":"sid-bbb","cwd":"'"$WORK"'","source":"resume","timestamp":1700001000}'
echo "$EVENT2" | bash "$HOOK" >/dev/null 2>&1 || true

[ ! -d "$WORK/.buddy/by-ppid/99999" ] \
  && pass "GC removed stale entry" || fail "GC stale entry — still exists"

# Dead file cleanup: seed and verify removal
mkdir -p "$HOME/.claude/buddy"
DEAD="$HOME/.claude/buddy/state.json"
DEAD_BACKUP=""
if [ -f "$DEAD" ]; then DEAD_BACKUP=$(mktemp); cp "$DEAD" "$DEAD_BACKUP"; fi
echo '{"version":1}' > "$DEAD"

EVENT3='{"session_id":"sid-ccc","cwd":"'"$WORK"'","source":"startup","timestamp":1700002000}'
echo "$EVENT3" | bash "$HOOK" >/dev/null 2>&1 || true

[ ! -f "$DEAD" ] && pass "dead global state.json removed" || fail "dead global state.json still exists"

# Restore if we backed up the user's real one
if [ -n "$DEAD_BACKUP" ]; then mv "$DEAD_BACKUP" "$DEAD"; fi

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]

# Nudge test: 31 entries in prompt-hamsa triggers capacity nudge
NUDGE_WORK=$(mktemp -d); trap 'rm -rf "$NUDGE_WORK"' EXIT
NUDGE_MEM="$NUDGE_WORK/.buddy/memory/prompt-hamsa"
mkdir -p "$NUDGE_MEM"
for i in $(seq 1 31); do
  echo "# entry $i" > "$NUDGE_MEM/entry-$(printf '%03d' $i).md"
done

NUDGE_EVENT='{"session_id":"sid-nudge","cwd":"'"$NUDGE_WORK"'","source":"startup","timestamp":1700003000}'
NUDGE_OUT=$(echo "$NUDGE_EVENT" | env -u CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$HOOK" 2>/dev/null || true)

echo "$NUDGE_OUT" | grep -q "consider /buddy:consolidate prompt-hamsa" \
  && pass "capacity nudge fires for 31 entries" \
  || fail "capacity nudge missing — output: $NUDGE_OUT"

# Reload test: resume from a prev session with active specialists must emit
# reload block + carry-forward active_specialists.
RELOAD_WORK=$(mktemp -d); trap 'rm -rf "$RELOAD_WORK"' EXIT
PREV_SID="prev-sid-reload"
NEW_SID="new-sid-reload"

# Seed prev session state with active_specialists
mkdir -p "$RELOAD_WORK/.buddy/$PREV_SID"
cat > "$RELOAD_WORK/.buddy/$PREV_SID/state.json" <<EOF
{
  "version": 1,
  "current_session_id": "$PREV_SID",
  "signals": {
    "context_pct": 0, "last_edit_ts": 0, "last_commit_ts": 0,
    "session_start_ts": 1700000000, "prompt_count": 0, "tool_call_count": 0,
    "last_test_result": null, "recent_errors": [], "idle_ts": 0,
    "judge_verdict": null, "judge_severity": null, "judge_block_count": 0,
    "judge_last_ts": 0, "cs_judge_verdict": null, "cs_judge_severity": null,
    "cs_tool_call_count": 0, "cs_active_project": null, "root_cwd": null
  },
  "derived_mood": "flow",
  "suggested_specialist": null,
  "last_mood_transition_ts": 0,
  "active_specialists": ["debugging-yeti"],
  "parent_sid": ""
}
EOF

# Point .current_session_id to PREV_SID (this is what the bash hook reads)
echo "$PREV_SID" > "$RELOAD_WORK/.buddy/.current_session_id"

RELOAD_EVENT='{"session_id":"'"$NEW_SID"'","cwd":"'"$RELOAD_WORK"'","source":"resume","timestamp":1700004000}'
RELOAD_OUT=$(echo "$RELOAD_EVENT" | env -u CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$HOOK" 2>/dev/null || true)

echo "$RELOAD_OUT" | grep -q "buddy:reloaded" \
  && pass "reload block emitted on resume" \
  || fail "reload block missing — output: $RELOAD_OUT"

echo "$RELOAD_OUT" | grep -q "debugging-yeti" \
  && pass "reload block includes specialist directory" \
  || fail "reload block missing specialist directory — output: $RELOAD_OUT"

# Verify new session state carries forward
NEW_ACTIVE=$(jq -r '.active_specialists[0] // ""' "$RELOAD_WORK/.buddy/$NEW_SID/state.json" 2>/dev/null)
[ "$NEW_ACTIVE" = "debugging-yeti" ] \
  && pass "new session carries active_specialists" \
  || fail "new session did not carry active_specialists — got: $NEW_ACTIVE"

NEW_PARENT=$(jq -r '.parent_sid // ""' "$RELOAD_WORK/.buddy/$NEW_SID/state.json" 2>/dev/null)
[ "$NEW_PARENT" = "$PREV_SID" ] \
  && pass "new session records parent_sid" \
  || fail "parent_sid not set — got: $NEW_PARENT"

# Startup must NOT emit reload block even if .current_session_id points at a prev
STARTUP_WORK=$(mktemp -d); trap 'rm -rf "$STARTUP_WORK"' EXIT
mkdir -p "$STARTUP_WORK/.buddy/prev-sid-startup"
cat > "$STARTUP_WORK/.buddy/prev-sid-startup/state.json" <<EOF
{"version":1,"current_session_id":"prev-sid-startup","signals":{"context_pct":0,"last_edit_ts":0,"last_commit_ts":0,"session_start_ts":0,"prompt_count":0,"tool_call_count":0,"last_test_result":null,"recent_errors":[],"idle_ts":0,"judge_verdict":null,"judge_severity":null,"judge_block_count":0,"judge_last_ts":0,"cs_judge_verdict":null,"cs_judge_severity":null,"cs_tool_call_count":0,"cs_active_project":null,"root_cwd":null},"derived_mood":"flow","suggested_specialist":null,"last_mood_transition_ts":0,"active_specialists":["debugging-yeti"],"parent_sid":""}
EOF
echo "prev-sid-startup" > "$STARTUP_WORK/.buddy/.current_session_id"

STARTUP_EVENT='{"session_id":"fresh-startup-sid","cwd":"'"$STARTUP_WORK"'","source":"startup","timestamp":1700100000}'
STARTUP_OUT=$(echo "$STARTUP_EVENT" | env -u CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$HOOK" 2>/dev/null || true)

if echo "$STARTUP_OUT" | grep -q "buddy:reloaded"; then
  fail "startup must NOT emit reload block — output: $STARTUP_OUT"
else
  pass "startup does not emit reload block"
fi
