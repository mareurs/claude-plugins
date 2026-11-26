#!/usr/bin/env bash
# Test session-start hook (via hook_dispatch.py): pointer + by-ppid + GC + dead file removal.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DISPATCH="$PLUGIN_ROOT/hooks/hook_dispatch.py"

PASS=0; FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

make_project() {
  local project="$SUITE_ROOT/$1"
  mkdir -p "$project/.git"
  printf '%s\n' "$project"
}

SUITE_ROOT=$(mktemp -d)
trap 'rm -rf "$SUITE_ROOT"' EXIT
export HOME="$SUITE_ROOT/home"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
export BUDDY_HOME="$HOME/.buddy"
unset CLAUDE_PROJECT_DIR BUDDY_HOOK_PPID

WORK=$(make_project startup-gc)
mkdir -p "$WORK/subdir"
EVENT='{"session_id":"sid-aaa","cwd":"'"$WORK/subdir"'","source":"startup","timestamp":1700000000}'

python3 "$DISPATCH" session-start <<< "$EVENT" >/dev/null

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
python3 "$DISPATCH" session-start <<< "$EVENT2" >/dev/null

[ ! -d "$WORK/.buddy/by-ppid/99999" ] \
  && pass "GC removed stale entry" || fail "GC stale entry — still exists"

# Dead file cleanup: seed and verify removal
mkdir -p "$HOME/.claude/buddy"
DEAD="$HOME/.claude/buddy/state.json"
echo '{"version":1}' > "$DEAD"

EVENT3='{"session_id":"sid-ccc","cwd":"'"$WORK"'","source":"startup","timestamp":1700002000}'
python3 "$DISPATCH" session-start <<< "$EVENT3" >/dev/null

[ ! -f "$DEAD" ] && pass "dead global state.json removed" || fail "dead global state.json still exists"

# Nudge test: 31 entries in prompt-hamsa triggers capacity nudge
NUDGE_WORK=$(make_project nudge)
NUDGE_MEM="$NUDGE_WORK/.buddy/memory/prompt-hamsa"
mkdir -p "$NUDGE_MEM"
for i in $(seq 1 31); do
  echo "# entry $i" > "$NUDGE_MEM/entry-$(printf '%03d' $i).md"
done

NUDGE_EVENT='{"session_id":"sid-nudge","cwd":"'"$NUDGE_WORK"'","source":"startup","timestamp":1700003000}'
NUDGE_OUT=$(python3 "$DISPATCH" session-start <<< "$NUDGE_EVENT")

echo "$NUDGE_OUT" | grep -q "consider /buddy:consolidate prompt-hamsa" \
  && pass "capacity nudge fires for 31 entries" \
  || fail "capacity nudge missing — output: $NUDGE_OUT"

# Env-leak test: CLAUDE_PROJECT_DIR set to bogus path must NOT override
# event.cwd — the hook must operate on what the event says, not inherited env.
LEAK_WORK=$(make_project env-leak)
LEAK_MEM="$LEAK_WORK/.buddy/memory/prompt-hamsa"
mkdir -p "$LEAK_MEM"
for i in $(seq 1 31); do
  echo "# entry $i" > "$LEAK_MEM/entry-$(printf '%03d' $i).md"
done
BOGUS_DIR=$(make_project bogus)

LEAK_EVENT='{"session_id":"sid-leak","cwd":"'"$LEAK_WORK"'","source":"startup","timestamp":1700003500}'
LEAK_OUT=$(CLAUDE_PROJECT_DIR="$BOGUS_DIR" python3 "$DISPATCH" session-start <<< "$LEAK_EVENT")

echo "$LEAK_OUT" | grep -q "consider /buddy:consolidate prompt-hamsa" \
  && pass "hook uses event.cwd over inherited CLAUDE_PROJECT_DIR" \
  || fail "hook leaked CLAUDE_PROJECT_DIR — output: $LEAK_OUT"

# Resume test: specialists are already in the restored transcript, so resume
# must NOT re-emit them (no reload/dismissal block) — but active_specialists
# carries forward so the statusline stays correct.
RELOAD_WORK=$(make_project reload)
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
RELOAD_OUT=$(python3 "$DISPATCH" session-start <<< "$RELOAD_EVENT")

if echo "$RELOAD_OUT" | grep -q "buddy:reloaded\|buddy:dismissed"; then
  fail "resume must NOT emit a reload/dismissal block — output: $RELOAD_OUT"
else
  pass "resume emits no reload block (bodies already in transcript)"
fi

# Verify new session state carries forward
RESUMED_STATE="$RELOAD_WORK/.buddy/$NEW_SID/state.json"
jq -e '.active_specialists[0] == "debugging-yeti"' "$RESUMED_STATE" >/dev/null \
  && pass "new session carries active_specialists" \
  || fail "new session did not carry active_specialists"

jq -e --arg sid "$PREV_SID" '.parent_sid == $sid' "$RESUMED_STATE" >/dev/null \
  && pass "new session records parent_sid" \
  || fail "new session did not record parent_sid"

# ── Compact: history is summarized away → release the specialists. Emit a
# dismissal notice (names, NO body) and clear active_specialists so they leave
# the statusline. Reuses RELOAD_WORK's seeded prev state (debugging-yeti); no
# .codescout here, so recon does not fire.
COMPACT_SID="new-sid-compact"
# A compaction keeps its session id (Claude Code 2.1.332), so the compacting session holds
# its own specialists: seed this session's state, not a previous session's.
mkdir -p "$RELOAD_WORK/.buddy/$COMPACT_SID"
COMPACT_STATE="$RELOAD_WORK/.buddy/$COMPACT_SID/state.json"
jq --arg sid "$COMPACT_SID" '.current_session_id = $sid' \
  "$RELOAD_WORK/.buddy/$PREV_SID/state.json" > "$COMPACT_STATE"
COMPACT_EVENT='{"session_id":"'"$COMPACT_SID"'","cwd":"'"$RELOAD_WORK"'","source":"compact","timestamp":1700004100}'
COMPACT_OUT=$(python3 "$DISPATCH" session-start <<< "$COMPACT_EVENT")

echo "$COMPACT_OUT" | grep -q "buddy:dismissed-on-compact" \
  && pass "compact emits dismissal notice" \
  || fail "compact dismissal notice missing — output: $COMPACT_OUT"

echo "$COMPACT_OUT" | grep -q "debugging-yeti" \
  && pass "compact dismissal lists released specialist" \
  || fail "compact dismissal missing specialist name — output: $COMPACT_OUT"

if echo "$COMPACT_OUT" | grep -q "buddy:reloaded"; then
  fail "compact must NOT re-inject specialist bodies — output: $COMPACT_OUT"
else
  pass "compact omits specialist bodies (no reload block)"
fi

jq -e '.active_specialists == []' "$COMPACT_STATE" >/dev/null \
  && pass "compact clears active_specialists (statusline emptied)" \
  || fail "compact did not clear active_specialists"

# Startup must NOT emit reload block even if .current_session_id points at a prev
STARTUP_WORK=$(make_project startup)
mkdir -p "$STARTUP_WORK/.buddy/prev-sid-startup"
cat > "$STARTUP_WORK/.buddy/prev-sid-startup/state.json" <<EOF
{"version":1,"current_session_id":"prev-sid-startup","signals":{"context_pct":0,"last_edit_ts":0,"last_commit_ts":0,"session_start_ts":0,"prompt_count":0,"tool_call_count":0,"last_test_result":null,"recent_errors":[],"idle_ts":0,"judge_verdict":null,"judge_severity":null,"judge_block_count":0,"judge_last_ts":0,"cs_judge_verdict":null,"cs_judge_severity":null,"cs_tool_call_count":0,"cs_active_project":null,"root_cwd":null},"derived_mood":"flow","suggested_specialist":null,"last_mood_transition_ts":0,"active_specialists":["debugging-yeti"],"parent_sid":""}
EOF
echo "prev-sid-startup" > "$STARTUP_WORK/.buddy/.current_session_id"

STARTUP_EVENT='{"session_id":"fresh-startup-sid","cwd":"'"$STARTUP_WORK"'","source":"startup","timestamp":1700100000}'
STARTUP_OUT=$(python3 "$DISPATCH" session-start <<< "$STARTUP_EVENT")

if jq -e '.current_session_id == "fresh-startup-sid"' \
     "$STARTUP_WORK/.buddy/fresh-startup-sid/state.json" >/dev/null &&
   ! grep -q "buddy:reloaded" <<< "$STARTUP_OUT"; then
  pass "startup writes session state without a reload block"
else
  fail "expected startup state without a reload block — output: $STARTUP_OUT"
fi


# ── Same-SID resume: CC reuses session_id and restores the transcript ──
SAMESID_WORK=$(make_project same-sid)
SAMESID="same-sid-resume"
mkdir -p "$SAMESID_WORK/.buddy/$SAMESID"
cat > "$SAMESID_WORK/.buddy/$SAMESID/state.json" <<EOF
{"version":1,"current_session_id":"$SAMESID","signals":{"context_pct":0,"last_edit_ts":0,"last_commit_ts":0,"session_start_ts":1700000000,"prompt_count":0,"tool_call_count":0,"last_test_result":null,"recent_errors":[],"idle_ts":0,"judge_verdict":null,"judge_severity":null,"judge_block_count":0,"judge_last_ts":0,"cs_judge_verdict":null,"cs_judge_severity":null,"cs_tool_call_count":0,"cs_active_project":null,"root_cwd":null},"derived_mood":"flow","suggested_specialist":null,"last_mood_transition_ts":0,"active_specialists":["debugging-yeti"],"parent_sid":""}
EOF
echo "$SAMESID" > "$SAMESID_WORK/.buddy/.current_session_id"

SAMESID_EVENT='{"session_id":"'"$SAMESID"'","cwd":"'"$SAMESID_WORK"'","source":"resume","timestamp":1700004000}'
SAMESID_OUT=$(python3 "$DISPATCH" session-start <<< "$SAMESID_EVENT")

if jq -e '.signals.session_start_ts == 1700004000' \
     "$SAMESID_WORK/.buddy/$SAMESID/state.json" >/dev/null &&
   ! grep -Eq 'buddy:(reloaded|dismissed)' <<< "$SAMESID_OUT"; then
  pass "same-SID resume updates state without a reload block"
else
  fail "expected updated same-SID state without a reload block — output: $SAMESID_OUT"
fi

# ── Recon is the sole auto-reload, and ONLY on compact: codescout present →
# reconnaissance SKILL.md is re-injected (its body was summarized away).
# Resume would NOT reload it (transcript intact); this case uses source=compact.
# ──
RECON_WORK=$(make_project recon)
RECON_SID="recon-marker-sid"
mkdir -p "$RECON_WORK/.buddy/$RECON_SID"
# codescout detect convention: .codescout/project.toml signals onboarding.
mkdir -p "$RECON_WORK/.codescout"
echo "[project]" > "$RECON_WORK/.codescout/project.toml"
cat > "$RECON_WORK/.buddy/$RECON_SID/state.json" <<EOF
{"version":1,"current_session_id":"$RECON_SID","signals":{"context_pct":0,"last_edit_ts":0,"last_commit_ts":0,"session_start_ts":1700000000,"prompt_count":0,"tool_call_count":0,"last_test_result":null,"recent_errors":[],"idle_ts":0,"judge_verdict":null,"judge_severity":null,"judge_block_count":0,"judge_last_ts":0,"cs_judge_verdict":null,"cs_judge_severity":null,"cs_tool_call_count":0,"cs_active_project":null,"root_cwd":null},"derived_mood":"flow","suggested_specialist":null,"last_mood_transition_ts":0,"active_specialists":[],"parent_sid":""}
EOF
echo "$RECON_SID" > "$RECON_WORK/.buddy/.current_session_id"

# Stage a sibling-plugin recon SKILL.md so the reload block can find it.
# Mirror real cache layout: <fake-claude>/plugins/cache/sdd-misc-plugins/{buddy,codescout-companion}/<ver>
FAKE_CACHE="$RECON_WORK/_fake_claude/plugins/cache/sdd-misc-plugins"
FAKE_BUDDY_ROOT="$FAKE_CACHE/buddy/0.7.7"
FAKE_RECON_SKILL="$FAKE_CACHE/codescout-companion/1.11.0/skills/reconnaissance/SKILL.md"
mkdir -p "$FAKE_BUDDY_ROOT" "$(dirname "$FAKE_RECON_SKILL")"
echo "# Reconnaissance test stub" > "$FAKE_RECON_SKILL"
# Copy (NOT symlink) the plugin tree into the fake cache. The hook self-locates
# via Path(__file__).resolve(), which collapses symlinks back to the dev repo —
# only real copies keep plugin_root inside the cache-layout path so the
# sister-plugin SKILL resolution (codescout-companion/reconnaissance) works.
cp -r "$PLUGIN_ROOT/scripts" "$FAKE_BUDDY_ROOT/scripts"
cp -r "$PLUGIN_ROOT/hooks" "$FAKE_BUDDY_ROOT/hooks"
cp -r "$PLUGIN_ROOT/skills" "$FAKE_BUDDY_ROOT/skills"

RECON_EVENT='{"session_id":"'"$RECON_SID"'","cwd":"'"$RECON_WORK"'","source":"compact","timestamp":1700004000}'
# Run the COPIED dispatcher so __file__.resolve() lands in the fake cache.
RECON_OUT=$(python3 "$FAKE_BUDDY_ROOT/hooks/hook_dispatch.py" session-start <<< "$RECON_EVENT")

echo "$RECON_OUT" | grep -q "reconnaissance" \
  && pass "codescout detected: reconnaissance included in reload" \
  || fail "codescout detect not honored — output: $(echo "$RECON_OUT" | head -c 400)"

echo "$RECON_OUT" | grep -q "Reconnaissance test stub" \
  && pass "codescout detected: SKILL.md body inlined via sister-scope" \
  || fail "recon SKILL body not inlined — output: $(echo "$RECON_OUT" | head -c 400)"

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
