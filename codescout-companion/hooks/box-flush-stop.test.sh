#!/usr/bin/env bash
# Tests for box-flush-stop.mjs: the Stop hook that flushes a session's batched box writes.
# A fake `codescout` on PATH records its argv and CLAUDE_CODE_SESSION_ID, and behaves as
# FAKE_MODE says (ok | busy | failed | stands | moved | sleep).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/box-flush-stop.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }
TMP=$(mktemp -d)
SLEEPER=""
cleanup() { [ -n "$SLEEPER" ] && kill "$SLEEPER" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

export HOME="$TMP/home"; mkdir -p "$HOME"
export XDG_STATE_HOME="$TMP/state"
unset CLAUDE_CONFIG_DIR CLAUDE_PROJECT_DIR CODESCOUT_SESSION_ID
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

BIN="$TMP/bin"; mkdir -p "$BIN"
FAKE_LOG="$TMP/fake.log"
cat >"$BIN/codescout" <<'EOF'
#!/usr/bin/env bash
{ printf 'ARGV:'; printf ' %s' "$@"; printf '\nSID:%s\n' "${CLAUDE_CODE_SESSION_ID-unset}"; } >>"$FAKE_LOG"
case "${FAKE_MODE:-ok}" in
  ok) echo '{"flush":{"committed":["a"],"sha":"abc1234","failed":null,"stands":null,"moved":null,"stuck":[],"torn":[]},"sweep":null,"sweep_error":null}' ;;
  busy) echo '{"flush":null,"error":"write lock held by codescout:sid-x append_entry"}'; exit 1 ;;
  failed) echo '{"flush":{"committed":[],"failed":"pre-commit hook refused: dead artifact id foo","stands":null,"moved":null,"stuck":[],"torn":[]},"sweep":null,"sweep_error":null}'; exit 1 ;;
  stands) echo '{"flush":{"committed":["a"],"failed":null,"stands":"commit abc reverts the changes of a peer on the tip","moved":null,"stuck":[],"torn":[]},"sweep":null,"sweep_error":null}' ;;
  moved) echo '{"flush":{"committed":[],"failed":null,"stands":null,"moved":"HEAD moved","stuck":[],"torn":[]},"sweep":null,"sweep_error":null}' ;;
  sleep) echo $$ >"$FAKE_PIDFILE"; exec sleep 30 ;;
esac
EOF
chmod +x "$BIN/codescout"
export PATH="$BIN:$PATH" FAKE_LOG

# A repo with one commit, a linked worktree of it, and a repo whose batched folder holds a record.
REPO="$TMP/repo"; WT="$TMP/wt"
git init -q "$REPO" && git -C "$REPO" commit -q --allow-empty -m init
git -C "$REPO" worktree add -q "$WT" -b wt-branch 2>/dev/null
BATCH="$REPO/.codescout/state/batched"

run() { # run <json-input> -> stdout in $OUT, wall ms in $MS
  local t0 t1
  t0=$(date +%s%3N)
  OUT=$(printf '%s' "$1" | node "$HOOK" 2>"$TMP/stderr")
  t1=$(date +%s%3N); MS=$((t1 - t0))
}
input() { printf '{"hook_event_name":"Stop","session_id":"%s","cwd":"%s","stop_hook_active":false}' "$1" "$2"; }
calls() { [ -f "$FAKE_LOG" ] && grep -c '^ARGV:' "$FAKE_LOG" || echo 0; }
reset() { rm -f "$FAKE_LOG"; rm -rf "$BATCH"; unset FAKE_MODE; }
logfile() { echo "$1/.claude/codescout-companion.log"; }

# 1. no batched folder: codescout is not run.
reset; run "$(input sess-a "$REPO")"
[ "$OUT" = '{"continue":true}' ] && [ "$(calls)" = 0 ] && pass "no batched folder: fake not run, continue" || fail "no batched folder" "out=$OUT calls=$(calls)"

# 1b. a batched folder with no record file of the session: not run.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"other","pid":null}' >"$BATCH/other.jsonl"
run "$(input sess-a "$REPO")"
[ "$OUT" = '{"continue":true}' ] && [ "$(calls)" = 0 ] && pass "record file of another session: fake not run" || fail "other session's file" "out=$OUT calls=$(calls)"

# 2. a record file named for the session: one call, --project before --session, env id set.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
run "$(input sess-a "$REPO")"
ARGV=$(grep '^ARGV:' "$FAKE_LOG" 2>/dev/null)
[ "$OUT" = '{"continue":true}' ] && [ "$(calls)" = 1 ] && pass "record file: one call, clean output" || fail "record file call" "out=$OUT calls=$(calls)"
[ "$ARGV" = "ARGV: box flush --project $REPO --session sess-a --json" ] && pass "argv: --project before --session, --json" || fail "argv" "got: $ARGV"
grep -q '^SID:sess-a$' "$FAKE_LOG" && pass "CLAUDE_CODE_SESSION_ID in the child's environment" || fail "env id" "$(cat "$FAKE_LOG")"

# 2b. the cwd is a subdirectory of the checkout: same root.
reset; mkdir -p "$BATCH" "$REPO/sub"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
run "$(input sess-a "$REPO/sub")"
[ "$(grep '^ARGV:' "$FAKE_LOG")" = "ARGV: box flush --project $REPO --session sess-a --json" ] && pass "subdirectory cwd targets the checkout root" || fail "subdir" "$(cat "$FAKE_LOG" 2>/dev/null)"

# 3. cwd is a linked worktree: the flush targets the main checkout.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
run "$(input sess-a "$WT")"
[ "$(grep '^ARGV:' "$FAKE_LOG")" = "ARGV: box flush --project $REPO --session sess-a --json" ] && pass "linked worktree cwd targets the main checkout" || fail "worktree" "$(cat "$FAKE_LOG" 2>/dev/null)"

# 4. a record file of another id with the pid of this session's registry row: one call.
reset; mkdir -p "$BATCH" "$HOME/.claude/sessions"
printf '%s\n' '{"session":"old-id","pid":4242}' >"$BATCH/old-id.jsonl"
printf '%s' '{"pid":4242,"sessionId":"sess-a","cwd":"/x"}' >"$HOME/.claude/sessions/4242.json"
run "$(input sess-a "$REPO")"
[ "$(calls)" = 1 ] && pass "record of another id with the session's pid: one call" || fail "pid rule" "calls=$(calls)"
# 4b. the same file when the registry row names another session: not run.
reset; mkdir -p "$BATCH"
printf '%s\n' '{"session":"old-id","pid":4242}' >"$BATCH/old-id.jsonl"
run "$(input sess-b "$REPO")"
[ "$(calls)" = 0 ] && pass "pid of another session: fake not run" || fail "pid rule negative" "calls=$(calls)"
rm -rf "$HOME/.claude"

# 5. busy lock: continue, no systemMessage.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
FAKE_MODE=busy run "$(input sess-a "$REPO")"
[ "$OUT" = '{"continue":true}' ] && pass "busy lock: continue, no systemMessage" || fail "busy lock" "out=$OUT"

# 6. failed: systemMessage names the reason.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
FAKE_MODE=failed run "$(input sess-a "$REPO")"
case "$OUT" in *'"continue":true'*'"systemMessage":"box flush: '*'dead artifact id foo'*) pass "failed: systemMessage carries the reason" ;; *) fail "failed" "out=$OUT" ;; esac
case "$OUT" in *'"decision"'*) fail "never blocks" "out=$OUT" ;; *) pass "failed: no decision field" ;; esac
grep -q 'failed' "$(logfile "$REPO")" 2>/dev/null && pass "failed: logged to codescout-companion.log" || fail "failed log" "no log line in $(logfile "$REPO")"

# 6b. stands: systemMessage. moved: none.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
FAKE_MODE=stands run "$(input sess-a "$REPO")"
case "$OUT" in *'"systemMessage":"box flush: '*'reverts the changes of a peer'*) pass "stands: systemMessage" ;; *) fail "stands" "out=$OUT" ;; esac
FAKE_MODE=moved run "$(input sess-a "$REPO")"
[ "$OUT" = '{"continue":true}' ] && pass "moved: no systemMessage" || fail "moved" "out=$OUT"

# 6c. a clean flush prints nothing beyond continue.
FAKE_MODE=ok run "$(input sess-a "$REPO")"
[ "$OUT" = '{"continue":true}' ] && pass "clean flush: continue only" || fail "clean" "out=$OUT"

# 7. a flush slower than the wait: the hook returns in time and the child lives on.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
export FAKE_PIDFILE="$TMP/fake.pid"; rm -f "$FAKE_PIDFILE"
FAKE_MODE=sleep BOX_FLUSH_STOP_WAIT_MS=700 run "$(input sess-a "$REPO")"
SLEEPER=$(cat "$FAKE_PIDFILE" 2>/dev/null)
[ "$OUT" = '{"continue":true}' ] && [ "$MS" -lt 3000 ] && pass "slow flush: continue within the wait (${MS} ms)" || fail "slow flush" "out=$OUT ms=$MS"
if [ -n "$SLEEPER" ] && kill -0 "$SLEEPER" 2>/dev/null; then pass "slow flush: the child is still alive (not killed)"; else fail "child alive" "pid=$SLEEPER"; fi
[ -n "$SLEEPER" ] && kill "$SLEEPER" 2>/dev/null; SLEEPER=""
grep -q 'still running' "$(logfile "$REPO")" 2>/dev/null && pass "slow flush: logged" || fail "slow flush log" "$(cat "$(logfile "$REPO")" 2>/dev/null)"

# 8. missing session_id or cwd: continue, fake not run. An unsafe session id too.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
run "{\"hook_event_name\":\"Stop\",\"cwd\":\"$REPO\"}"
[ "$OUT" = '{"continue":true}' ] && [ "$(calls)" = 0 ] && pass "missing session_id: continue, fake not run" || fail "missing session_id" "out=$OUT calls=$(calls)"
run '{"hook_event_name":"Stop","session_id":"sess-a"}'
[ "$OUT" = '{"continue":true}' ] && [ "$(calls)" = 0 ] && pass "missing cwd: continue, fake not run" || fail "missing cwd" "out=$OUT calls=$(calls)"
run "$(input '../evil' "$REPO")"
[ "$OUT" = '{"continue":true}' ] && [ "$(calls)" = 0 ] && pass "unsafe session_id: continue, fake not run" || fail "unsafe id" "out=$OUT calls=$(calls)"
printf 'not json' | node "$HOOK" >"$TMP/o-bad" 2>/dev/null
[ "$(cat "$TMP/o-bad")" = '{"continue":true}' ] && pass "unparseable input: continue" || fail "bad input" "$(cat "$TMP/o-bad")"

# 9. a non-repository cwd: continue, fake not run.
reset; mkdir -p "$TMP/plain"
run "$(input sess-a "$TMP/plain")"
[ "$OUT" = '{"continue":true}' ] && [ "$(calls)" = 0 ] && pass "non-repository cwd: continue, fake not run" || fail "non-repo" "out=$OUT calls=$(calls)"

# 10. no codescout binary: continue.
reset; mkdir -p "$BATCH"; printf '%s\n' '{"session":"sess-a","pid":null}' >"$BATCH/sess-a.jsonl"
OUT=$(printf '%s' "$(input sess-a "$REPO")" | PATH="/usr/bin:/bin" HOME="$TMP/nohome" node "$HOOK" 2>/dev/null)
[ "$OUT" = '{"continue":true}' ] && pass "no codescout binary: continue" || fail "no binary" "out=$OUT"

# 11. the probe: the keys of the input are logged on the first line of a run.
reset; rm -rf "$REPO/.claude"; run "$(input sess-a "$REPO")"
[ "$(head -n1 "$(logfile "$REPO")" 2>/dev/null)" = "box-flush-stop: input keys: cwd,hook_event_name,session_id,stop_hook_active" ] && pass "probe: input keys logged" || fail "probe" "$(cat "$(logfile "$REPO")" 2>/dev/null)"

echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
