#!/usr/bin/env bash
# Test for wake-on-job-end.mjs: the asyncRewake hook that wakes the session
# when a codescout background job (run_command run_in_background) ends.
#
# Contract under test: exit 2 + stderr message = deliberate wake-up; exit 0 =
# nothing to say (fail-open). No jq and no python3 here: JSON is built and read
# with node, so the suite runs on every CI platform.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/wake-on-job-end.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export CODESCOUT_WAKE_DEADLINE_SECS=3
export CODESCOUT_WAKE_POLL_MS=100
# The map file lives under the state home: keep it inside the test directory.
export XDG_STATE_HOME="$TMP/state"
MAP="$XDG_STATE_HOME/codescout-companion/wake/map-sess-1-@bg_00000001"

# A pid that is certainly dead: a child that has been reaped.
true & DEAD=$!; wait "$DEAD" 2>/dev/null

# mkrec FILE STATE SERVER_PID JOB_PID  -> atomic-ish record write
mkrec() {
  node -e '
    const fs = require("fs");
    const [f, state, sp, jp] = process.argv.slice(1);
    const fin = state === "running" ? null : "2026-10-29T10:00:05Z";
    const rec = { schema: 1, handle: "@bg_00000001", command: "sleep 1",
      server_pid: Number(sp), job_pid: jp === "null" ? null : Number(jp),
      state, exit_code: state === "exited" ? 0 : null,
      error: state === "failed" ? "spawn boom" : null,
      started_at: "2026-10-29T10:00:00Z", finished_at: fin };
    fs.writeFileSync(f + ".tmp", JSON.stringify(rec));
    fs.renameSync(f + ".tmp", f);
  ' "$@"
}

# mkinput KIND RECORD -> hook input JSON on stdout
mkinput() {
  node -e '
    const [kind, rec] = process.argv.slice(1);
    const inner = {
      spawn:   { output_id: "@bg_00000001", record: rec },
      read:    { output_id: "@bg_00000001", record: rec, exit_code: 0 },
      pending: { pending_ack: "@ack_x" },
    }[kind === "ack" || kind === "agent" ? "spawn" : kind === "readbg" ? "read" : kind];
    const cmd = kind === "ack" ? "@ack_x" : kind === "readbg" ? "tail -50 @bg_00000001" : "sleep 1";
    const input = { tool_name: "mcp__codescout__run_command",
      tool_input: { command: cmd },
      tool_response: [{ text: JSON.stringify(inner) }] };
    if (!process.env.TEST_NO_SID) input.session_id = "sess-1";
    if (kind === "agent") input.agent_id = "agent-123";
    process.stdout.write(JSON.stringify(input));
  ' "$1" "$2"
}

# run_hook NAME INPUT [env assignments...] -> sets CODE and ERR
run_hook() {
  local name="$1" input="$2"; shift 2
  printf '%s' "$input" | env "$@" node "$HOOK" >"$TMP/$name.out" 2>"$TMP/$name.err"
  CODE=$?
  ERR=$(cat "$TMP/$name.err")
}

expect() { # NAME WANT_CODE SUBSTR(or "" = must be empty stderr)
  local name="$1" want="$2" sub="$3"
  if [ "$CODE" != "$want" ]; then fail "$name" "exit $CODE, want $want; stderr: $ERR"; return; fi
  if [ -z "$sub" ]; then
    [ -z "$ERR" ] && pass "$name" || fail "$name" "stderr not empty: $ERR"
  else
    case "$ERR" in *"$sub"*) pass "$name" ;; *) fail "$name" "stderr lacks '$sub': $ERR" ;; esac
  fi
}

PD="CLAUDE_PROJECT_DIR=$TMP"

# 1. spawn arms, record exited 0
R="$TMP/r1.json"; mkrec "$R" exited "$$" null
run_hook c1 "$(mkinput spawn "$R")" "$PD"
expect "spawn arms, record exited 0" 2 "ended: exited 0"

# 2. record failed
R="$TMP/r2.json"; mkrec "$R" failed "$$" null
run_hook c2 "$(mkinput spawn "$R")" "$PD"
expect "record failed" 2 "failed: spawn boom"

# 3. read response (has exit_code) does not arm
R="$TMP/r3.json"; mkrec "$R" exited "$$" null
run_hook c3 "$(mkinput read "$R")" "$PD"
expect "read response (has exit_code) does not arm" 0 ""

# 4. acked replay arms
R="$TMP/r4.json"; mkrec "$R" exited "$$" null
run_hook c4 "$(mkinput ack "$R")" "$PD"
expect "acked replay arms" 2 "ended:"

# 5. pending ack does not arm
R="$TMP/r5.json"; mkrec "$R" exited "$$" null
run_hook c5 "$(mkinput pending "$R")" "$PD"
expect "pending ack does not arm" 0 ""

# 6. agent_id present does not arm
R="$TMP/r6.json"; mkrec "$R" exited "$$" null
run_hook c6 "$(mkinput agent "$R")" "$PD"
expect "agent_id present does not arm" 0 ""

# 7. no CLAUDE_PROJECT_DIR does not arm
R="$TMP/r7.json"; mkrec "$R" exited "$$" null
run_hook c7 "$(mkinput spawn "$R")" "-u" "CLAUDE_PROJECT_DIR"
expect "no CLAUDE_PROJECT_DIR does not arm" 0 ""

# 8. record vanishes after 0.5 s
R="$TMP/r8.json"; mkrec "$R" running "$$" null
( sleep 0.5; rm -f "$R" ) &
run_hook c8 "$(mkinput spawn "$R")" "$PD"
wait
expect "record vanishes" 2 "vanished"

# 9. two watchers race on one record: exactly one wakes (exit 2)
R="$TMP/r9.json"; mkrec "$R" running "$$" null
INP="$(mkinput spawn "$R")"
printf '%s' "$INP" | env "$PD" node "$HOOK" >"$TMP/c9a.out" 2>"$TMP/c9a.err" & PA=$!
printf '%s' "$INP" | env "$PD" node "$HOOK" >"$TMP/c9b.out" 2>"$TMP/c9b.err" & PB=$!
sleep 0.6; mkrec "$R" exited "$$" null
wait "$PA"; CA=$?; wait "$PB"; CB=$?
if { [ "$CA" = 2 ] && [ "$CB" = 0 ]; } || { [ "$CA" = 0 ] && [ "$CB" = 2 ]; }; then
  pass "two watchers race: exactly one exits 2 ($CA,$CB)"
else
  fail "two watchers race" "exit codes $CA,$CB, want one 2 and one 0"
fi

# 10. heartbeat: record stays running, live server_pid, deadline passes
R="$TMP/r10.json"; mkrec "$R" running "$$" null
START=$SECONDS
run_hook c10 "$(mkinput spawn "$R")" "$PD"
ELAPSED=$((SECONDS-START))
expect "heartbeat" 2 "still running"
[ "$ELAPSED" -le 5 ] && pass "heartbeat within 5 s (${ELAPSED}s)" || fail "heartbeat timing" "took ${ELAPSED}s"
[ ! -e "$R.watch" ] && pass "heartbeat removes <record>.watch" || fail "heartbeat watch file" "$R.watch still exists"

# 11. server dead, job alive
R="$TMP/r11.json"
sleep 1 & JOB=$!
mkrec "$R" running "$DEAD" "$JOB"
START=$SECONDS
run_hook c11 "$(mkinput spawn "$R")" "$PD"
ELAPSED=$((SECONDS-START))
# The hook must have WAITED for the job: it returns only after the job pid died.
if kill -0 "$JOB" 2>/dev/null; then fail "server dead, job alive: waits for the job" "job still alive when hook returned"; else pass "server dead, job alive: waits for the job (job dead on return)"; fi
wait "$JOB" 2>/dev/null
expect "server dead, job alive: no longer valid" 2 "no longer valid"
case "$ERR" in *"has also ended"*) pass "server dead, job alive: has also ended" ;; *) fail "server dead, job alive" "no 'has also ended': $ERR" ;; esac

# 11b. server dead, job outlives the deadline: still running as pid N
R="$TMP/r11b.json"
sleep 10 & JOB=$!
mkrec "$R" running "$DEAD" "$JOB"
run_hook c11b "$(mkinput spawn "$R")" "$PD"
kill "$JOB" 2>/dev/null; wait "$JOB" 2>/dev/null
expect "server dead, job still running at deadline" 2 "still running as pid $JOB"
case "$ERR" in *"no longer valid"*) pass "server dead, job running: no longer valid" ;; *) fail "server dead, job running" "no 'no longer valid': $ERR" ;; esac
case "$ERR" in *"tail -50"*) fail "server dead, job running" "stderr offers tail -50: $ERR" ;; *) pass "server dead, job running: no tail -50" ;; esac

# 12. server dead, job dead
R="$TMP/r12.json"; mkrec "$R" running "$DEAD" "$DEAD"
run_hook c12 "$(mkinput spawn "$R")" "$PD"
expect "server dead, job dead" 2 "state is unknown"
case "$ERR" in *"tail -50"*) fail "server dead, job dead" "stderr offers tail -50: $ERR" ;; *) pass "server dead, job dead: no tail -50" ;; esac

# mkmap RECORD -> write the session-to-record map the way a spawn would
mkmap() { mkdir -p "$(dirname "$MAP")"; printf '%s' "$1" >"$MAP"; }

# 13. spawn writes the map (and a spawn without session_id writes none)
rm -rf "$XDG_STATE_HOME"
R="$TMP/r13.json"; mkrec "$R" exited "$$" null
run_hook c13 "$(mkinput spawn "$R")" "$PD"
expect "spawn writes the map: still wakes" 2 "ended:"
if [ -f "$MAP" ] && [ "$(cat "$MAP")" = "$R" ]; then pass "spawn writes the map"; else fail "spawn writes the map" "missing or wrong content at $MAP"; fi
rm -rf "$XDG_STATE_HOME"
R="$TMP/r13b.json"; mkrec "$R" exited "$$" null
run_hook c13b "$(TEST_NO_SID=1 mkinput spawn "$R")" "$PD"
expect "spawn without session_id still wakes" 2 "ended:"
[ -z "$(find "$XDG_STATE_HOME" -type f 2>/dev/null)" ] && pass "spawn without session_id writes no map" || fail "no session_id" "a map file was written"

# 14. read of a running job after a heartbeat re-arms
R="$TMP/r14.json"; mkrec "$R" running "$$" null; mkmap "$R"; rm -f "$R.watch" "$R.delivered"
printf '%s' "$(mkinput readbg "$R")" | env "$PD" node "$HOOK" >"$TMP/c14.out" 2>"$TMP/c14.err" & PW=$!
sleep 0.6
if kill -0 "$PW" 2>/dev/null; then pass "re-arm: hook stays alive on a running job"; else fail "re-arm: hook stays alive" "hook already exited"; fi
[ "$(cat "$R.watch" 2>/dev/null)" = "$PW" ] && pass "watch marker holds the watcher's pid" || fail "watch marker" "want $PW, got '$(cat "$R.watch" 2>/dev/null)'"
mkrec "$R" exited "$$" null
wait "$PW"; CODE=$?; ERR=$(cat "$TMP/c14.err")
expect "read of a running job after heartbeat re-arms" 2 "ended: exited 0"
[ ! -e "$R.watch" ] && pass "owner removes its watch marker" || fail "owner removes marker" "$R.watch still exists"

# 15. read of a finished job does not arm (final wake-up already delivered)
R="$TMP/r15.json"; mkrec "$R" exited "$$" null; mkmap "$R"; printf '%s' "$$" >"$R.delivered"; rm -f "$R.watch"
START=$SECONDS
run_hook c15 "$(mkinput readbg "$R")" "$PD"
expect "read of a finished job does not arm" 0 ""
[ $((SECONDS-START)) -le 2 ] && pass "finished job: no wait" || fail "finished job: no wait" "took $((SECONDS-START))s"

# 16. read while a watcher is alive does not arm
R="$TMP/r16.json"; mkrec "$R" running "$$" null; mkmap "$R"; printf '%s' "$$" >"$R.watch"
START=$SECONDS
run_hook c16 "$(mkinput readbg "$R")" "$PD"
expect "read while a watcher is alive does not arm" 0 ""
[ $((SECONDS-START)) -le 2 ] && pass "live watcher: no wait" || fail "live watcher: no wait" "took $((SECONDS-START))s"
[ "$(cat "$R.watch" 2>/dev/null)" = "$$" ] && pass "live watcher's marker untouched" || fail "live watcher's marker" "changed or gone"

# 17. read with no map does not arm
rm -rf "$XDG_STATE_HOME"
R="$TMP/r17.json"; mkrec "$R" running "$$" null; rm -f "$R.watch"
START=$SECONDS
run_hook c17 "$(mkinput readbg "$R")" "$PD"
expect "read with no map does not arm" 0 ""
[ $((SECONDS-START)) -le 2 ] && pass "no map: no wait" || fail "no map: no wait" "took $((SECONDS-START))s"

# 18. a dead pid in the watch marker does not block a re-arm
R="$TMP/r18.json"; mkrec "$R" exited "$$" null; mkmap "$R"
mkrec "$R" running "$$" null; printf '%s' "$DEAD" >"$R.watch"; rm -f "$R.delivered"
printf '%s' "$(mkinput readbg "$R")" | env "$PD" node "$HOOK" >"$TMP/c18.out" 2>"$TMP/c18.err" & PW=$!
sleep 0.5; mkrec "$R" exited "$$" null
wait "$PW"; CODE=$?; ERR=$(cat "$TMP/c18.err")
expect "stale watch marker (dead pid) re-arms" 2 "ended: exited 0"

# 19. a watcher that does not own the marker leaves it alone on exit
R="$TMP/r19.json"; mkrec "$R" running "$$" null; rm -f "$R.watch" "$R.delivered"
printf '%s' "$(mkinput spawn "$R")" | env "$PD" node "$HOOK" >"$TMP/c19.out" 2>"$TMP/c19.err" & PW=$!
sleep 0.5
[ "$(cat "$R.watch" 2>/dev/null)" = "$PW" ] && pass "spawn: watch marker holds the watcher's pid" || fail "spawn watch marker" "want $PW, got '$(cat "$R.watch" 2>/dev/null)'"
printf '%s' "$$" >"$R.watch"   # another (live) watcher takes the marker
mkrec "$R" exited "$$" null
wait "$PW"; CODE=$?; ERR=$(cat "$TMP/c19.err")
expect "non-owner watcher still wakes" 2 "ended: exited 0"
[ "$(cat "$R.watch" 2>/dev/null)" = "$$" ] && pass "non-owner exit leaves the marker" || fail "non-owner exit" "marker removed or changed"

echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
