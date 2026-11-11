#!/usr/bin/env bash
# Test for wake-missed-jobs.mjs: the UserPromptSubmit / SessionStart hook that
# reports a codescout background job which ended while no watcher was alive
# (the 30-minute heartbeat ends the only watcher; see
# docs/issues/2026-11-11-background-job-past-30-minutes-loses-its-end-wake-...).
#
# Contract: stdout is one JSON object with hookSpecificOutput.additionalContext
# when a job of THIS session ended with no end wake; otherwise nothing on stdout.
# Exit is always 0 (fail-open). No jq: JSON is built and read with node.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/wake-missed-jobs.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export XDG_STATE_HOME="$TMP/state"
WAKE="$XDG_STATE_HOME/codescout-companion/wake"

true & DEAD=$!; wait "$DEAD" 2>/dev/null   # a pid that is certainly dead

# mkrec FILE STATE SERVER_PID  (handle fixed to @bg_00000001)
mkrec() {
  node -e '
    const fs = require("fs");
    const [f, state, sp] = process.argv.slice(1);
    const fin = state === "running" ? null : "2026-11-11T11:35:32Z";
    const rec = { schema: 1, handle: "@bg_00000001", command: "sleep 1",
      server_pid: Number(sp), job_pid: null, state,
      exit_code: state === "exited" ? 0 : null,
      error: state === "failed" ? "spawn boom" : null,
      started_at: "2026-11-11T10:53:12Z", finished_at: fin };
    fs.writeFileSync(f, JSON.stringify(rec));
  ' "$@"
}

# mkmap SESSION HANDLE RECORD
mkmap() { mkdir -p "$WAKE"; printf '%s' "$3" >"$WAKE/map-$1-$2"; }

# run_hook NAME EVENT SESSION -> sets CODE and OUT
run_hook() {
  local name="$1" event="$2" sid="$3"
  node -e '
    const [ev, sid] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ hook_event_name: ev, session_id: sid, cwd: process.cwd() }));
  ' "$event" "$sid" | node "$HOOK" >"$TMP/$name.out" 2>"$TMP/$name.err"
  CODE=$?
  OUT=$(cat "$TMP/$name.out")
}

# ctx NAME -> the additionalContext string, or empty
ctx() { node -e 'try{const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.hookSpecificOutput.additionalContext||"")}catch{}' "$TMP/$1.out"; }
evname() { node -e 'try{const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.hookSpecificOutput.hookEventName||"")}catch{}' "$TMP/$1.out"; }

silent() { # NAME WHAT
  if [ "$CODE" = 0 ] && [ -z "$OUT" ]; then pass "$2"; else fail "$2" "exit $CODE, stdout: $OUT"; fi
}

# 1. ended, no .delivered, no watcher: reported, with the handle and the exit code
R="$TMP/r1.json"; mkrec "$R" exited "$$"; mkmap sess-1 @bg_00000001 "$R"; rm -f "$R.delivered" "$R.watch"
run_hook c1 UserPromptSubmit sess-1
C=$(ctx c1)
[ "$CODE" = 0 ] && pass "missed end: exit 0" || fail "missed end: exit" "exit $CODE"
case "$C" in *"@bg_00000001"*"exited 0"*) pass "missed end: names the handle and the exit code" ;; *) fail "missed end: message" "got: $C" ;; esac
case "$C" in *'run_command("tail -50 @bg_00000001")'*) pass "missed end: live server, offers the read" ;; *) fail "missed end: read hint" "got: $C" ;; esac
[ "$(evname c1)" = "UserPromptSubmit" ] && pass "missed end: hookEventName echoes the event" || fail "hookEventName" "got '$(evname c1)'"

# 2. the report claims the delivery: a second prompt says nothing
[ -f "$R.delivered" ] && pass "report claims .delivered" || fail "report claims .delivered" "no $R.delivered"
run_hook c2 UserPromptSubmit sess-1
silent c2 "second prompt: nothing more to report"

# 3. SessionStart reports too, with its own event name
R="$TMP/r3.json"; mkrec "$R" failed "$$"; mkmap sess-3 @bg_00000001 "$R"; rm -f "$R.delivered" "$R.watch"
run_hook c3 SessionStart sess-3
C=$(ctx c3)
case "$C" in *"failed: spawn boom"*) pass "SessionStart: failed job reported" ;; *) fail "SessionStart: failed job" "got: $C" ;; esac
[ "$(evname c3)" = "SessionStart" ] && pass "SessionStart: hookEventName" || fail "SessionStart hookEventName" "got '$(evname c3)'"

# 4. an end wake was already delivered: silent
R="$TMP/r4.json"; mkrec "$R" exited "$$"; mkmap sess-4 @bg_00000001 "$R"; printf '%s' "$$" >"$R.delivered"
run_hook c4 UserPromptSubmit sess-4
silent c4 "delivered end: silent"

# 5. still running: silent (the heartbeat path owns it)
R="$TMP/r5.json"; mkrec "$R" running "$$"; mkmap sess-5 @bg_00000001 "$R"; rm -f "$R.delivered" "$R.watch"
run_hook c5 UserPromptSubmit sess-5
silent c5 "running job: silent"

# 6. ended, but a live watcher still holds the job: it will deliver, so stay silent
R="$TMP/r6.json"; mkrec "$R" exited "$$"; mkmap sess-6 @bg_00000001 "$R"; rm -f "$R.delivered"; printf '%s' "$$" >"$R.watch"
run_hook c6 UserPromptSubmit sess-6
silent c6 "live watcher: silent"
[ ! -e "$R.delivered" ] && pass "live watcher: delivery left to the watcher" || fail "live watcher" ".delivered was claimed"

# 7. a dead pid in .watch does not hide a missed end
R="$TMP/r7.json"; mkrec "$R" exited "$$"; mkmap sess-7 @bg_00000001 "$R"; rm -f "$R.delivered"; printf '%s' "$DEAD" >"$R.watch"
run_hook c7 UserPromptSubmit sess-7
case "$(ctx c7)" in *"exited 0"*) pass "stale watch marker: still reported" ;; *) fail "stale watch marker" "got: $(ctx c7)" ;; esac

# 8. another session's map is not reported here
R="$TMP/r8.json"; mkrec "$R" exited "$$"; mkmap sess-other @bg_00000001 "$R"; rm -f "$R.delivered" "$R.watch"
run_hook c8 UserPromptSubmit sess-8
silent c8 "another session's job: silent"
[ ! -e "$R.delivered" ] && pass "another session's job: not claimed" || fail "another session" ".delivered was claimed"

# 9. the server is gone: the handle is invalid, so the message must not offer a read
R="$TMP/r9.json"; mkrec "$R" exited "$DEAD"; mkmap sess-9 @bg_00000001 "$R"; rm -f "$R.delivered" "$R.watch"
run_hook c9 UserPromptSubmit sess-9
C=$(ctx c9)
case "$C" in *"exited 0"*) pass "dead server: reported" ;; *) fail "dead server: reported" "got: $C" ;; esac
case "$C" in *"tail -50"*) fail "dead server" "offers tail -50 on an invalid handle: $C" ;; *) pass "dead server: no tail -50" ;; esac
case "$C" in *"no longer valid"*) pass "dead server: says the handle is no longer valid" ;; *) fail "dead server wording" "got: $C" ;; esac

# 10. fail-open: no session id, a missing record, a record of another schema, junk map
run_hook c10a UserPromptSubmit ""
silent c10a "no session id: silent"
mkmap sess-10 @bg_00000001 "$TMP/does-not-exist.json"
run_hook c10b UserPromptSubmit sess-10
silent c10b "missing record: silent"
R="$TMP/r10.json"; mkrec "$R" exited "$$"; node -e 'const f=process.argv[1],r=JSON.parse(require("fs").readFileSync(f));r.schema=2;require("fs").writeFileSync(f,JSON.stringify(r))' "$R"
mkmap sess-10c @bg_00000001 "$R"; rm -f "$R.delivered"
run_hook c10c UserPromptSubmit sess-10c
silent c10c "schema 2 record: silent"
printf 'not json' >"$TMP/junk.json"; mkmap sess-10d @bg_00000001 "$TMP/junk.json"
run_hook c10d UserPromptSubmit sess-10d
silent c10d "unparseable record: silent"
printf '%s' 'x' >"$TMP/stdin-junk"; node "$HOOK" <"$TMP/stdin-junk" >/dev/null 2>&1; [ $? = 0 ] && pass "junk stdin: exit 0" || fail "junk stdin" "non-zero exit"

# 11. two missed jobs in one session: both reported in one message
R1="$TMP/r11a.json"; R2="$TMP/r11b.json"; mkrec "$R1" exited "$$"; mkrec "$R2" exited "$$"
rm -f "$R1.delivered" "$R2.delivered" "$R1.watch" "$R2.watch"
mkmap sess-11 @bg_00000001 "$R1"; mkmap sess-11 @bg_00000002 "$R2"
run_hook c11 UserPromptSubmit sess-11
C=$(ctx c11)
case "$C" in *"@bg_00000001"*"@bg_00000002"*) pass "two missed jobs: both named" ;; *) fail "two missed jobs" "got: $C" ;; esac

echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
