#!/usr/bin/env bash
# Test for session-start.sh — project-bootstrap activate_project nudge and the
# MSG-composition guard (the onboarding block must APPEND, not reset, or it
# clobbers the prepended bootstrap nudge). Machine-specific, like the sibling
# pre-tool-guard.test.sh: relies on codescout being configured for this user.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/session-start.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# HAS_CODESCOUT is config-based (not per-project). If codescout isn't configured
# on this machine the hook exits early and emits nothing — skip rather than fail.
eval "$(CWD="$TMP" HOME="$HOME" CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR-}" \
        python3 "$SCRIPT_DIR/../scripts/detect.py")"
if [ "${HAS_CODESCOUT:-false}" != "true" ]; then
  echo "SKIP: codescout not configured on this machine — session-start emits nothing."
  exit 0
fi

# Run the hook for a given source against the (non-git, non-onboarded) temp cwd
# and print the injected additionalContext.
ctx() {
  printf '{"cwd":"%s","source":"%s","session_id":"sst-%s"}' "$TMP" "$1" "$1" \
    | XDG_STATE_HOME="${XDG_STATE_HOME:-$TMP/state}" node "$HOOK" 2>/dev/null \
    | jq -r '.hookSpecificOutput.additionalContext // ""'
}

# --- rendezvous: the hook stamps slots whose ppid is on our ancestry ---
RV="$TMP/state/codescout/servers"; mkdir -p "$RV"
MYPPID=$(ps -o ppid= -p $$ | tr -d ' ')
printf '{"pid":999001,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$MYPPID" > "$RV/999001.json"
printf '{"pid":999002,"ppid":1,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' > "$RV/999002.json"

XDG_STATE_HOME="$TMP/state" ctx startup >/dev/null

jq -e '.session == "sst-startup" and .hook_at != null' "$RV/999001.json" >/dev/null \
  && pass "rendezvous: entry on our ancestry is stamped" \
  || fail "rendezvous: entry on our ancestry was NOT stamped"

jq -e '.session == null and .hook_at == null' "$RV/999002.json" >/dev/null \
  && pass "rendezvous: unrelated entry is left alone" \
  || fail "rendezvous: unrelated entry was stamped — selection is too broad"

# The Rust Entry struct has no #[serde(default)] on ANY field — a partial
# write-back (e.g. just {session, hook_at}) parses fine here but fails silently
# on the server's next poll(). Assert every original field survived the stamp.
jq -e --arg ppid "$MYPPID" \
  '.pid == 999001 and (.ppid|tostring) == $ppid and .started_at == "2026-01-01T00:00:00Z" and .cwd == "/"' \
  "$RV/999001.json" >/dev/null \
  && pass "rendezvous: stamp round-trips every original field (pid/ppid/started_at/cwd)" \
  || fail "rendezvous: stamp dropped a field — server's poll() would silently fail to parse"

# Atomic write: the stamp stages to a sibling "<name>.json.tmp" then renames
# over the target. A leftover .tmp file means the write path fell back to (or
# was mixed with) a bare non-atomic write instead of completing the rename —
# content-correctness checks above are blind to that regression since the
# target ends up right either way.
if find "$RV" -maxdepth 1 -name '*.tmp' 2>/dev/null | grep -q .; then
  fail "rendezvous: stray .tmp file left in $RV — atomic write did not clean up"
else
  pass "rendezvous: no leftover .tmp file after the stamp (rename completed)"
fi

# The Rust side declares hook_at: Option<chrono::DateTime<Utc>> — an RFC3339
# string, not a JSON number. `Date.now()` in place of `.toISOString()` would
# stay valid JSON and pass every other assertion here while the server's
# poll() silently fails to parse it forever. Pin the wire shape.
jq -e '.hook_at | test("^[0-9]{4}-.*(Z|[+-][0-9]{2}:[0-9]{2})$")' "$RV/999001.json" >/dev/null \
  && pass "rendezvous: hook_at is an RFC3339 string, not a numeric timestamp" \
  || fail "rendezvous: hook_at is not RFC3339 — server's poll() would fail to parse Option<DateTime<Utc>>"

# --- rendezvous: a missing/empty session_id must not stamp (rekey("") hazard) ---
# The server's rekey("") would repoint the ledger to "<dir>/.json" (empty
# basename). The outer `if (sessionId)` guard exists to prevent that; assert a
# matching slot is left completely untouched when session_id is absent.
NOSID_ENTRY="$RV/999004.json"
printf '{"pid":999004,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$MYPPID" > "$NOSID_ENTRY"
printf '{"cwd":"%s","source":"startup"}' "$TMP" \
  | XDG_STATE_HOME="$TMP/state" node "$HOOK" >/dev/null 2>&1
jq -e '.session == null and .hook_at == null' "$NOSID_ENTRY" >/dev/null \
  && pass "rendezvous: missing session_id leaves a matching slot untouched" \
  || fail "rendezvous: missing session_id stamped a slot — rekey(\"\") hazard"

# --- rendezvous: a comm field containing spaces/parens must not shift ppid parsing ---
# Regression for the /proc/<pid>/stat hazard: field 2 (comm) can itself contain
# spaces and parens (the `claude` and `node` wrappers routinely produce this),
# which shifts every later whitespace-split field and silently yields the wrong
# ppid. The other rendezvous assertions above never exercise this: nothing in
# this test's own process tree (bash/node) has a weird comm. Fabricate one: a
# python3 process renames itself via prctl(PR_SET_NAME) to a name containing
# both a space and unbalanced-looking parens, then spawns node (running the
# hook) as its child — so the hook's grandparent-hop must correctly climb PAST
# a weird-comm process to reach us ($$, this test script).
if [ "$(uname)" = "Linux" ] && command -v python3 >/dev/null 2>&1; then
  WEIRD_ENTRY="$RV/999003.json"
  printf '{"pid":999003,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$$" > "$WEIRD_ENTRY"

  XDG_STATE_HOME="$TMP/state" python3 - "$HOOK" "$TMP" <<'PYEOF' >/dev/null 2>&1
import ctypes, subprocess, sys
libc = ctypes.CDLL('libc.so.6')
libc.prctl(15, b'weird (na) x\0', 0, 0, 0)  # PR_SET_NAME
hook, tmp = sys.argv[1], sys.argv[2]
payload = ('{"cwd":"%s","source":"startup","session_id":"sst-weirdcomm"}' % tmp).encode()
subprocess.run(['node', hook], input=payload,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
PYEOF

  jq -e '.session == "sst-weirdcomm" and .hook_at != null' "$WEIRD_ENTRY" >/dev/null \
    && pass "rendezvous: ppid parsing survives a comm field with spaces/parens" \
    || fail "rendezvous: comm-with-spaces broke ppid parsing (whitespace-split regression)"
else
  pass "rendezvous: comm-with-spaces test N/A (not Linux or no python3)"
fi

STARTUP=$(ctx startup)
COMPACT=$(ctx compact)

echo "$STARTUP" | grep -q "PROJECT BOOTSTRAP" \
  && pass "startup → activate_project bootstrap nudge present" \
  || fail "bootstrap nudge missing on startup"

echo "$STARTUP" | grep -q 'workspace(action="activate"' \
  && pass "nudge names the workspace activate call" \
  || fail "nudge missing the workspace(action=\"activate\") call"

if echo "$COMPACT" | grep -q "PROJECT BOOTSTRAP"; then
  fail "bootstrap nudge should be suppressed on compact (post-compact owns the workspace call)"
else
  pass "compact → bootstrap suppressed"
fi

# Resume must NOT re-inject the nudge (startup-only): a same-process re-attach
# reuses the already-active project; a real resume re-runs activate at most lazily.
RESUME=$(ctx resume)
if echo "$RESUME" | grep -q "PROJECT BOOTSTRAP"; then
  fail "bootstrap nudge should be suppressed on resume (startup-only)"
else
  pass "resume → bootstrap suppressed"
fi

# Append-not-reset guard: a non-onboarded temp project emits the onboarding
# nudge too. Both must coexist — if the onboarding block reset MSG (the old
# bug), the prepended bootstrap line would vanish.
if echo "$STARTUP" | grep -q "not yet onboarded"; then
  echo "$STARTUP" | grep -q "PROJECT BOOTSTRAP" \
    && pass "bootstrap survives the onboarding MSG block (append, not reset)" \
    || fail "onboarding block clobbered the bootstrap nudge (MSG reset regression)"
else
  pass "temp project already onboarded — append-guard N/A"
fi

# --- rendezvous: the SessionStart SOURCE is recorded, and a compaction re-stamps
#     even though the session id is unchanged ---
# codescout's workspace(post_compact=true) clears the whole guide ledger, and a
# call made after a plain /mcp reconnect (no compaction) re-delivered ~49 KB. The
# server can only tell the two apart if the last SessionStart's `source` reaches
# it. A compaction keeps the session id, and the "already current" skip above
# used to swallow exactly that stamp, so the source must be part of "current".
# codescout:docs/issues/archive/2026-08-31-post-compact-clears-the-ledger-with-no-compaction-check.md
SRC_ENTRY="$RV/999005.json"
printf '{"pid":999005,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$MYPPID" > "$SRC_ENTRY"
start_as() {  # <source> -- ONE session id for every source, unlike ctx()
  printf '{"cwd":"%s","source":"%s","session_id":"sst-same"}' "$TMP" "$1" \
    | XDG_STATE_HOME="$TMP/state" node "$HOOK" >/dev/null 2>&1
}
start_as startup
jq -e '.session == "sst-same" and .hook_source == "startup"' "$SRC_ENTRY" >/dev/null \
  && pass "rendezvous: the SessionStart source is recorded beside the session" \
  || fail "rendezvous: the SessionStart source was not recorded"
start_as compact
jq -e '.session == "sst-same" and .hook_source == "compact"' "$SRC_ENTRY" >/dev/null \
  && pass "rendezvous: a compaction re-stamps the source though the session is unchanged" \
  || fail "rendezvous: a compaction on an already-stamped session left the old source"
# Same wire shape as hook_at: the server parses it as Option<DateTime<Utc>>.
jq -e '.hook_source_at | test("^[0-9]{4}-.*(Z|[+-][0-9]{2}:[0-9]{2})$")' "$SRC_ENTRY" >/dev/null \
  && pass "rendezvous: hook_source_at is an RFC3339 string" \
  || fail "rendezvous: hook_source_at is not RFC3339 — the server would fail to parse the slot"

# --- rendezvous: a NESTED session must not stamp its ancestor session's server ---
# codescout:docs/issues/archive/2026-09-24-a-nested-claude-session-hijacks-its-ancestor-sessions-codescout-server.md
# A `claude -p` started from inside another session's tool call has the OUTER
# Claude in its ancestry, so "ppid anywhere up the chain" matched the outer
# session's server and rewrote its session id. The walk must stop at the NEAREST
# Claude process. Each case fabricates one: an intermediate process plays the
# nested claude. It publishes its own server slot (ppid = itself) and runs the
# hook as its child. The OUTER slot's ppid is this test script, one hop further
# up. Two signals identify a Claude process, and each case lets exactly one of
# them fire:
#   (A) a registry row, on a plain bash;
#   (B) comm "claude", with no row.
# The positive control in each (the inner slot IS stamped) keeps the outer
# slot's silence from passing when the hook never ran.
NEST_CFG="$TMP/nest-cfg"; mkdir -p "$NEST_CFG/sessions"
# Load-bearing: detect() reads this profile config. With no codescout server
# declared here, the hook exits before it stamps anything.
printf '{"mcpServers":{"codescout":{"command":"codescout"}}}' > "$NEST_CFG/.claude.json"
nested_hook() {  # <launcher> <inner-slot> <registry-row:yes|no> <session-id> <comm-out>
  NEST_CFG="$NEST_CFG" TMP="$TMP" HOOK="$HOOK" "$1" -c '
    printf "{\"pid\":999100,\"ppid\":%s,\"started_at\":\"2026-01-01T00:00:00Z\",\"cwd\":\"/\",\"session\":null,\"hook_at\":null}" "$$" > "$1"
    if [ "$2" = yes ]; then printf "{\"pid\":%s,\"sessionId\":\"%s\"}" "$$" "$3" > "$NEST_CFG/sessions/$$.json"; fi
    cat "/proc/$$/comm" > "$4" 2>/dev/null
    printf "{\"cwd\":\"%s\",\"source\":\"startup\",\"session_id\":\"%s\"}" "$TMP" "$3" \
      | CLAUDE_CONFIG_DIR="$NEST_CFG" XDG_STATE_HOME="$TMP/state" node "$HOOK" >/dev/null 2>&1
    rc=$?  # a command after the pipeline keeps this shell alive as the parent of the hook
  ' nested "$2" "$3" "$4" "$5"
}
outer_slot() {  # <file> <session>: an already-stamped server of the ANCESTOR session
  printf '{"pid":999101,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":"%s","hook_at":"2026-01-01T00:00:00Z"}' "$$" "$2" > "$1"
}

outer_slot "$RV/999110.json" outer-a
nested_hook bash "$RV/999111.json" yes sst-nested-a "$TMP/comm-a"
jq -e '.session == "sst-nested-a" and .hook_at != null' "$RV/999111.json" >/dev/null \
  && pass "rendezvous (nested, registry row): the nested session stamps its own server" \
  || fail "rendezvous (nested, registry row): the nested session's own server was not stamped"
jq -e '.session == "outer-a"' "$RV/999110.json" >/dev/null \
  && pass "rendezvous (nested, registry row): the ancestor session's server keeps its session" \
  || fail "rendezvous (nested, registry row): a nested session hijacked its ancestor's server ($(jq -r .session "$RV/999110.json"))"

if [ "$(uname)" = "Linux" ]; then
  # Load-bearing, and checked rather than assumed: the kernel names a process
  # after the file it was exec'd through, so this bash runs with comm "claude".
  mkdir -p "$TMP/bin"; ln -sf "$(command -v bash)" "$TMP/bin/claude"
  outer_slot "$RV/999120.json" outer-b
  nested_hook "$TMP/bin/claude" "$RV/999121.json" no sst-nested-b "$TMP/comm-b"
  [ "$(cat "$TMP/comm-b")" = claude ] \
    || fail "rendezvous (nested, comm): fixture precondition — the launcher's comm was '$(cat "$TMP/comm-b")', not 'claude'"
  jq -e '.session == "sst-nested-b" and .hook_at != null' "$RV/999121.json" >/dev/null \
    && pass "rendezvous (nested, comm): the nested session stamps its own server" \
    || fail "rendezvous (nested, comm): the nested session's own server was not stamped"
  jq -e '.session == "outer-b"' "$RV/999120.json" >/dev/null \
    && pass "rendezvous (nested, comm): the ancestor session's server keeps its session" \
    || fail "rendezvous (nested, comm): a nested session hijacked its ancestor's server ($(jq -r .session "$RV/999120.json"))"
else
  pass "rendezvous (nested, comm): N/A (comm is read from /proc)"
fi

# --- rendezvous: a server that publishes AFTER SessionStart still gets stamped ---
# codescout:docs/issues/archive/2026-09-24-sessionstart-can-run-before-the-resumed-servers-slot-exists.md
# Interactive Claude Code fires SessionStart about 220 ms BEFORE its codescout
# server publishes its slot (measured 2026-09-24: hook at +763 ms, slot at
# +982 ms), so the scan finds nothing to stamp, and the refresher never opens a
# null gate. This fabricates that order. An intermediate bash plays the Claude
# (registry row) and runs the hook while NO slot of its own exists. Only after
# the hook has returned does its "server" publish. Load-bearing: the OTHER
# Claude's late slot is written FIRST, so a stamper that matched any ppid would
# reach it in the same scan that finds ours. The positive assertion is awaited
# first, so the negative one cannot pass merely because nothing has run yet.
LATE_STATE="$TMP/late-state"; LATE_RV="$LATE_STATE/codescout/servers"; mkdir -p "$LATE_RV"
NEST_CFG="$NEST_CFG" TMP="$TMP" HOOK="$HOOK" LATE_STATE="$LATE_STATE" bash -c '
  printf "{\"pid\":%s,\"sessionId\":\"sst-late\"}" "$$" > "$NEST_CFG/sessions/$$.json"
  echo "$$" > "$1"
  printf "{\"cwd\":\"%s\",\"source\":\"startup\",\"session_id\":\"sst-late\"}" "$TMP" \
    | CLAUDE_CONFIG_DIR="$NEST_CFG" XDG_STATE_HOME="$LATE_STATE" node "$HOOK" >/dev/null 2>&1
  rc=$?  # a command after the pipeline keeps this shell alive as the parent of the hook
' late "$TMP/late-claude.pid"
LATE_CLAUDE=$(cat "$TMP/late-claude.pid")
# Both servers publish only now, after SessionStart has returned.
printf '{"pid":999131,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$$" > "$LATE_RV/999131.json"
printf '{"pid":999130,"ppid":%s,"started_at":"2026-01-01T00:00:00Z","cwd":"/","session":null,"hook_at":null}' "$LATE_CLAUDE" > "$LATE_RV/999130.json"
for _ in $(seq 1 60); do jq -e '.hook_at != null' "$LATE_RV/999130.json" >/dev/null 2>&1 && break; sleep 0.1; done
jq -e '.session == "sst-late" and .hook_at != null and .hook_source == "startup"' "$LATE_RV/999130.json" >/dev/null \
  && pass "rendezvous (late slot): a server that publishes after SessionStart is still stamped, with its source" \
  || fail "rendezvous (late slot): a server that published after SessionStart was never stamped ($(cat "$LATE_RV/999130.json"))"
jq -e '.session == null and .hook_at == null' "$LATE_RV/999131.json" >/dev/null \
  && pass "rendezvous (late slot): another Claude's late server is left alone" \
  || fail "rendezvous (late slot): the late stamper stamped another Claude's server"

# --- Tracker-hygiene overdue nudge ---
# Ledger absent (all earlier ctx calls ran without it): no nudge.
if echo "$STARTUP" | grep -q "TRACKER HYGIENE"; then
  fail "hygiene nudge must be silent when no ledger exists"
else
  pass "no ledger → no hygiene nudge"
fi

mkdir -p "$TMP/docs/trackers"
LEDGER="$TMP/docs/trackers/tracker-hygiene-log.md"

# Overdue date → nudge present, names the due date and the skill.
printf -- '---\nkind: tracker\nstatus: active\ntitle: Tracker hygiene log\nnext-sweep-due: 2020-01-01\nsweep-interval-days: 30\n---\n# Tracker hygiene log\n' > "$LEDGER"
OVERDUE=$(ctx startup)
echo "$OVERDUE" | grep -q "TRACKER HYGIENE: sweep overdue (due 2020-01-01)" \
  && pass "overdue ledger → hygiene nudge with due date" \
  || fail "overdue ledger did not produce the hygiene nudge"
echo "$OVERDUE" | grep -q "codescout-companion:tracker-hygiene" \
  && pass "nudge names the skill invocation" \
  || fail "nudge missing the skill name"

# Future date → silent.
printf -- '---\nkind: tracker\nstatus: active\ntitle: Tracker hygiene log\nnext-sweep-due: 2099-01-01\nsweep-interval-days: 30\n---\n# Tracker hygiene log\n' > "$LEDGER"
FUTURE=$(ctx startup)
if echo "$FUTURE" | grep -q "TRACKER HYGIENE"; then
  fail "future due date must not nudge"
else
  pass "future due date → silent"
fi

# Malformed date → silent (never nudge on garbage).
printf -- '---\nnext-sweep-due: soonish\n---\n' > "$LEDGER"
BAD=$(ctx startup)
if echo "$BAD" | grep -q "TRACKER HYGIENE"; then
  fail "malformed date must not nudge"
else
  pass "malformed date → silent"
fi
rm -f "$LEDGER"

# --- Tracker-hygiene nudge: guard-hardening (numeric-malformed) ---
# A numeric-but-invalid value sorts BEFORE today and would wrongly nudge if the
# ISO regex guard regressed; asserting silence here actually exercises the guard
# (a letter-led value stays silent with or without the guard — vacuous).
mkdir -p "$TMP/docs/trackers"
LEDGER="$TMP/docs/trackers/tracker-hygiene-log.md"
printf -- '---\nnext-sweep-due: 202\n---\n' > "$LEDGER"
NUMBAD=$(ctx startup)
if echo "$NUMBAD" | grep -q "TRACKER HYGIENE"; then
  fail "numeric-malformed date (202) must not nudge — ISO guard regressed"
else
  pass "numeric-malformed date → silent (ISO guard exercised)"
fi

# --- Tracker-hygiene nudge: due==today boundary ---
printf -- '---\nnext-sweep-due: %s\n---\n' "$(date +%F)" > "$LEDGER"
DUETODAY=$(ctx startup)
if echo "$DUETODAY" | grep -q "TRACKER HYGIENE: sweep overdue (due $(date +%F))"; then
  pass "due today → nudge fires (boundary: today counts as due)"
else
  fail "due today must nudge (today counts as due)"
fi
rm -f "$LEDGER"

# --- Post-compact injection: names the cost, the condition, and the remedy ---
# The assertions are PAIRED on purpose. A negative-only guard ("no disruption" is
# absent) is monotone under REMOVAL: delete the whole `source === 'compact'` block
# and it still passes, reporting green on a hook that injects nothing at all. The
# positives are what make a deletion fail. Both directions, or the guard is
# decoration.
COMPACT=$(ctx compact)

echo "$COMPACT" | grep -q "POST-COMPACT: Context was just compacted." \
  && pass "compact → post-compact block is injected" \
  || fail "compact injected no POST-COMPACT block (a negative-only guard would pass here)"

echo "$COMPACT" | grep -q "workspace(post_compact=true)" \
  && pass "post-compact names the remedy" \
  || fail "post-compact block does not name the remedy"

echo "$COMPACT" | grep -q "pays the language-server" \
  && pass "post-compact names the cost (first nav call pays the LSP start)" \
  || fail "post-compact block does not name the cost"

echo "$COMPACT" | grep -q "shared per workspace, not per session" \
  && pass "post-compact names the condition that removes the cost" \
  || fail "post-compact block does not name the warm-server condition"

# The regression this exists to catch: the block used to end "LSP clients restart
# lazily — no disruption to the session." The restart is lazy, so the first nav
# call pays the start; on a large crate that has exceeded the 60s tool timeout.
# "No disruption" is the costly half — it rules out the real cause, so the search
# for it ends.
if echo "$COMPACT" | grep -q "no disruption"; then
  fail "post-compact must not promise 'no disruption' — the LSP start is not free"
else
  pass "post-compact does not promise 'no disruption'"
fi

# Non-vacuity: the block is gated on source=compact. Without this, the negative
# above could be passing merely because the harness never renders the block at all.
COMPACT_GATE=$(ctx startup)
if echo "$COMPACT_GATE" | grep -q "POST-COMPACT"; then
  fail "startup must not carry the post-compact block"
else
  pass "startup → no post-compact block (gate exercised)"
fi

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
