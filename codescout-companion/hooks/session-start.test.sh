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

# --- rendezvous: a CODEX session started inside another session must not stamp that session's server ---
# codescout:docs/issues/2026-11-09-shared-mcp-usage-misattributes-observation-work.md
# A Codex thread started from a Claude session's tool call has the Claude process above it,
# and with a walk that only stopped at a Claude process the hook of that thread walked
# THROUGH the `codex` process and stamped the Claude session's server with the thread id
# (the commit guard then blamed the thread for the Claude session's writes). Reproduced
# 2026-11-12 with the real ownAncestry on the real tree: hook > bash > codex > bash >
# codescout > claude. The fixture is the nested-Claude one with a launcher whose comm is
# `codex`: its own server (ppid = the launcher) is stamped, the OUTER server (ppid = this
# script, one hop further up) keeps its session.
if [ "$(uname)" = "Linux" ]; then
  mkdir -p "$TMP/bin"; ln -sf "$(command -v bash)" "$TMP/bin/codex"
  outer_slot "$RV/999130.json" outer-c
  nested_hook "$TMP/bin/codex" "$RV/999131.json" no sst-codex-c "$TMP/comm-c"
  [ "$(cat "$TMP/comm-c")" = codex ] \
    || fail "rendezvous (nested, codex): fixture precondition — the launcher's comm was '$(cat "$TMP/comm-c")', not 'codex'"
  jq -e '.session == "sst-codex-c" and .hook_at != null' "$RV/999131.json" >/dev/null \
    && pass "rendezvous (nested, codex): the codex session stamps its own server" \
    || fail "rendezvous (nested, codex): the codex session's own server was not stamped"
  jq -e '.session == "outer-c"' "$RV/999130.json" >/dev/null \
    && pass "rendezvous (nested, codex): the ancestor session's server keeps its session" \
    || fail "rendezvous (nested, codex): a codex session stamped its ancestor's server ($(jq -r .session "$RV/999130.json"))"
else
  pass "rendezvous (nested, codex): N/A (comm is read from /proc)"
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

# --- Tracker-hygiene nudge: the hygiene box (docs/trackers/streams/hygiene) ---
# The hook reads the greatest `next_sweep_due` in the FRONTMATTER of the box entries,
# and falls back to the flat log when no box entry carries a valid date.
HBOX="$TMP/docs/trackers/streams/hygiene"
LEDGER="$TMP/docs/trackers/tracker-hygiene-log.md"
hbox_entry() { # name, frontmatter line (may be empty), body line (may be empty)
  mkdir -p "$HBOX"
  printf -- '---\nkind: entry\nentry_kind: sweep\n%s\n---\n%s\n' "$2" "$3" > "$HBOX/$1.md"
}
hbox_reset() { rm -rf "$TMP/docs/trackers/streams"; rm -f "$LEDGER"; }
hbox_nudges() { ctx startup | grep -q "TRACKER HYGIENE: sweep overdue (due $1)"; }
hbox_silent() { ! ctx startup | grep -q "TRACKER HYGIENE"; }

hbox_reset
hbox_entry 2026-01-01-sweep "next_sweep_due: 2020-01-01" ""
hbox_nudges 2020-01-01 && pass "box overdue → nudge with the date" || fail "box overdue entry did not nudge"

hbox_reset
hbox_entry 2026-01-01-sweep "next_sweep_due: 2099-01-01" ""
hbox_silent && pass "box future date → silent" || fail "box future date must not nudge"

hbox_reset
hbox_entry 2026-01-01-a "next_sweep_due: 2099-01-01" ""
hbox_entry 2026-02-01-b "next_sweep_due: 2020-01-01" ""
hbox_silent && pass "box takes the greatest date, not the last file read" || fail "box must use the greatest date"

hbox_reset
hbox_entry 2026-01-01-a "next_sweep_due: soonish" ""
hbox_entry 2026-02-01-b "next_sweep_due: 2020-01-01" ""
hbox_nudges 2020-01-01 && pass "box malformed date beside a valid one → the valid one decides" || fail "box malformed date hid the valid one"

hbox_reset
hbox_entry 2026-01-01-sweep "next_sweep_due: $(date +%F)" ""
hbox_nudges "$(date +%F)" && pass "box due today → nudge" || fail "box due today must nudge"

hbox_reset
mkdir -p "$HBOX"; printf -- '---\nkind: collection\n---\n# Tracker hygiene sweeps\n' > "$HBOX/readme.md"
printf -- '---\nnext-sweep-due: 2020-01-01\n---\n' > "$LEDGER"
hbox_nudges 2020-01-01 && pass "empty box (readme only) → falls back to the flat log" || fail "empty box silenced the flat log"

hbox_reset
hbox_entry 2026-01-01-sweep "next_sweep_due: 2099-01-01" ""
printf -- '---\nnext-sweep-due: 2020-01-01\n---\n' > "$LEDGER"
hbox_silent && pass "box wins over the flat log" || fail "flat log overrode the box"

hbox_reset
hbox_entry 2026-01-01-sweep "" "next_sweep_due: 2020-01-01"
hbox_silent && pass "a date in the entry body does not count" || fail "a body line counted as the due date"

hbox_reset
mkdir -p "$HBOX"; printf -- '---\nnext_sweep_due: 2020-01-01\n---\n# readme\n' > "$HBOX/readme.md"
hbox_silent && pass "a date in readme.md does not count" || fail "readme.md counted as an entry"

# A broken file in the box never hides a valid entry or the flat-log fallback.
hbox_reset
hbox_entry 2026-02-01-ok "next_sweep_due: 2020-01-01" ""
ln -s /nonexistent/target "$HBOX/2026-01-01-dangling.md"
mkdir "$HBOX/2026-03-01-dir.md"
hbox_nudges 2020-01-01 && pass "a dangling symlink and a directory beside a valid entry → the valid entry decides" || fail "a broken file in the box silenced the nudge"

hbox_reset
mkdir -p "$HBOX"; ln -s /nonexistent/target "$HBOX/2026-01-01-dangling.md"
printf -- '---\nnext-sweep-due: 2020-01-01\n---\n' > "$LEDGER"
hbox_nudges 2020-01-01 && pass "only a broken box file → falls back to the flat log" || fail "a broken box file silenced the flat-log fallback"

# Values as a hand edit may leave them: quotes, a trailing comment, a byte-order mark.
for v in '"2020-01-01"' "'2020-01-01'" '2020-01-01 # due'; do
  hbox_reset
  hbox_entry 2026-01-01-sweep "next_sweep_due: $v" ""
  hbox_nudges 2020-01-01 && pass "box value $v is read" || fail "box value $v was ignored"
done
hbox_reset
mkdir -p "$HBOX"; printf '\357\273\277---\nkind: entry\nnext_sweep_due: 2020-01-01\n---\n' > "$HBOX/2026-01-01-bom.md"
hbox_nudges 2020-01-01 && pass "box entry with a byte-order mark is read" || fail "a byte-order mark hid the date"
hbox_reset
hbox_entry 2026-01-01-sweep "next_sweep_due: \"2026-13\"" ""
hbox_silent && pass "a quoted malformed value stays silent" || fail "a quoted malformed value nudged"
hbox_reset

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

# --- SKILLS AVAILABLE: only when the session can call the Skill tool ---
# The block tells the agent to call Skill('...'). A session launched with --tools that
# omits Skill has no such tool (28 of 28 cs-arm runs of the Setup A/B study), so the
# line can only waste a turn. The hook reads the Claude process's own argv; unreadable
# or unrecognised argv leaves the block in, which is the behaviour from before.
# docs/trackers/ledgers/bugs/2026-11-24-companion-hooks-advertise-a-skill-tool-the-cs-arm-lacks-name.md
skill_absent() {  # <argv...>: prints yes|no
  node -e 'import(process.argv[1]).then((m) => console.log(m.skillToolAbsentFromArgv(process.argv.slice(2)) ? "yes" : "no"))' \
    -- "$SCRIPT_DIR/lib.mjs" "$@" 2>/dev/null
}
check_absent() {  # <expected yes|no> <label> <argv...>
  local want="$1" label="$2" got; shift 2
  got=$(skill_absent "$@")
  [ "$got" = "$want" ] && pass "skill tool, argv: $label" || fail "skill tool, argv: $label (want $want, got '$got')"
}
check_absent no  "no --tools flag → present" claude
check_absent yes "--tools list without Skill → absent" claude -p --tools Bash,Read,Write,Edit,Glob,Grep
check_absent no  "--tools list with Skill → present" claude --tools Bash,Skill
check_absent yes "--tools=<list> form" claude '--tools=Bash,Read'
check_absent yes "space-separated values end at the next flag" claude --tools Bash Read --model opus
check_absent yes '--tools "" disables every tool' claude --tools ""
check_absent no  "--tools default keeps the default set" claude --tools default
check_absent no  "--tools with no value is ignored (fail safe)" claude --tools
check_absent no  "--disallowedTools is not read as removing Skill (not verified to)" claude --disallowedTools Skill

if [ "$(uname)" = "Linux" ]; then
  mkdir -p "$TMP/bin"; ln -sf "$(command -v bash)" "$TMP/bin/claude"
  skills_hook() {  # <extra claude args...>: the hook's raw stdout, run under a process whose comm is "claude"
    NEST_CFG="$NEST_CFG" TMP="$TMP" HOOK="$HOOK" "$TMP/bin/claude" -c '
      printf "{\"cwd\":\"%s\",\"source\":\"startup\",\"session_id\":\"sst-skills\"}" "$TMP" \
        | CLAUDE_CONFIG_DIR="$NEST_CFG" XDG_STATE_HOME="$TMP/state" node "$HOOK" 2>/dev/null
      rc=$?  # a command after the pipeline keeps this shell alive as the parent of the hook
    ' nested "$@"
  }
  skills_ctx() { skills_hook "$@" | jq -r '.hookSpecificOutput.additionalContext // ""'; }

  SK_DEFAULT=$(skills_ctx)
  SK_RESTRICTED=$(skills_ctx --tools Bash,Read,Write,Edit,Glob,Grep)
  SK_WITH=$(skills_ctx --tools Bash,Skill)

  echo "$SK_DEFAULT" | grep -q "SKILLS AVAILABLE" \
    && pass "skills block: a session with no --tools flag gets it" \
    || fail "skills block: missing for a session with no --tools flag"
  echo "$SK_WITH" | grep -q "SKILLS AVAILABLE" \
    && pass "skills block: --tools that lists Skill keeps it" \
    || fail "skills block: dropped although --tools lists Skill"
  # Non-vacuity: the restricted run must still emit the rest of the message, or a hook
  # that failed to run at all would pass the absence check below.
  echo "$SK_RESTRICTED" | grep -q "PROJECT BOOTSTRAP" \
    || fail "skills block: fixture precondition — the hook emitted nothing under the fake claude"
  if echo "$SK_RESTRICTED" | grep -q "SKILLS AVAILABLE"; then
    fail "skills block: advertised to a session whose --tools omits Skill"
  else
    pass "skills block: omitted when --tools omits Skill"
  fi
else
  pass "skills block: N/A (the Claude argv is read from /proc)"
fi

# --- hot view: collections that declare hot_cap (docs/superpowers/specs/2026-11-15-session-start-hot-view-design.md) ---
HV_REPO="$TMP/hv-repo"; HV_CFG="$TMP/hv-cfg"; HV_LOG="$TMP/hv-calls.log"
mkdir -p "$HV_REPO" "$HV_CFG"
git -C "$HV_REPO" init -q
# What the fake binary prints for `codescout box --project <root> --json`: the hook asks the binary which
# collections declare hot_cap and builds no tracker path, so no readme file exists in this repository.
HV_BOX="$TMP/hv-box.json"
printf '{"collections":[{"key":"busy","hot_cap":5,"problem":null}]}' > "$HV_BOX"
HV_FAKE="$TMP/hv-fake-codescout"
cat > "$HV_FAKE" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$HV_LOG"
# The call shape is part of the contract: box --project <root> --json.
if [ "\$1" = "box" ]; then
  { [ "\$2" = "--project" ] && [ "\$4" = "--json" ] && [ "\$#" -eq 4 ]; } || exit 101
  cat "$HV_BOX"; exit 0
fi
# The call shape is part of the contract: hot-view <key> --project <root>.
if [ "\$1" != "hot-view" ] || [ "\$3" != "--project" ] || [ "\$#" -ne 4 ]; then exit 101; fi
printf 'hot view: busy (docs/trackers/ledgers/busy): 1 of 1 hot, 1 live. Scope: x.\n- [[e1]] t: open since 2026-11-01\n'
EOF
chmod +x "$HV_FAKE"
hv_profile() { printf '{"mcpServers":{"codescout":{"command":"%s"}}}' "$1" > "$HV_CFG/.claude.json"; }
# $PATH minus every directory that holds a `codescout`: the fixture must not see a host binary.
hv_clean_path() {
  local d out="" IFS=:
  for d in $PATH; do
    [ -n "$d" ] && [ ! -x "$d/codescout" ] && out="${out:+$out:}$d"
  done
  printf '%s' "$out"
}
hv_ctx() {  # <source>
  printf '{"cwd":"%s","source":"%s","session_id":"hv-%s"}' "$HV_REPO" "$1" "$1" \
    | PATH="$(hv_clean_path)" HOME="${HV_HOME:-$HOME}" CLAUDE_CONFIG_DIR="$HV_CFG" XDG_STATE_HOME="$TMP/state" node "$HOOK" 2>/dev/null \
    | jq -r '.hookSpecificOutput.additionalContext // ""'
}
hv_profile "$HV_FAKE"

# Host independence (issue #18, item 2). resolveCodescoutBinary searches PATH BEFORE the command
# in the profile's mcpServers config, so a real `codescout` on the host PATH (typically in
# ~/.cargo/bin) is called instead of the fake, and the block degrades to "not shown: busy
# (hot-view unavailable)". hv_ctx must hide every host codescout. The decoy stands in for one:
# it records the call and answers like a binary that does not know `hot-view`.
HV_DECOY_BIN="$TMP/hv-decoy-bin"; HV_DECOY_LOG="$TMP/hv-decoy.log"; mkdir -p "$HV_DECOY_BIN"
printf '#!/usr/bin/env bash\necho "$*" >> "%s"\nexit 2\n' "$HV_DECOY_LOG" > "$HV_DECOY_BIN/codescout"
chmod +x "$HV_DECOY_BIN/codescout"
: > "$HV_DECOY_LOG"; : > "$HV_LOG"
HV_DECOYED=$(PATH="$HV_DECOY_BIN:$PATH" hv_ctx startup)
if echo "$HV_DECOYED" | grep -q -F -- "- [[e1]] t: open since 2026-11-01" \
   && [ ! -s "$HV_DECOY_LOG" ] && [ -s "$HV_LOG" ]; then
  pass "hot view: a codescout on the host PATH is hidden from the fixture; the fake answers"
else
  fail "hot view: a host codescout on PATH was called instead of the fake (decoy log: $(tr '\n' ';' < "$HV_DECOY_LOG"))"
fi

# The MCP launch command is not necessarily the codescout binary (review I-1): with
# {"command":"bash","args":["-c","exec codescout start"]} the hook must still call the real
# `codescout` it finds on PATH, never `bash hot-view ...`.
HV_BIN="$TMP/hv-bin"; mkdir -p "$HV_BIN"
cp "$HV_FAKE" "$HV_BIN/codescout"
printf '{"mcpServers":{"codescout":{"command":"bash","args":["-c","exec codescout start"]}}}' > "$HV_CFG/.claude.json"
: > "$HV_LOG"
HV_WRAP=$(printf '{"cwd":"%s","source":"startup","session_id":"hv-wrap"}' "$HV_REPO" \
  | PATH="$HV_BIN:$PATH" CLAUDE_CONFIG_DIR="$HV_CFG" XDG_STATE_HOME="$TMP/state" node "$HOOK" 2>/dev/null \
  | jq -r '.hookSpecificOutput.additionalContext // ""')
if echo "$HV_WRAP" | grep -q -F -- "- [[e1]] t: open since 2026-11-01" \
   && grep -q -x -F "box --project $HV_REPO --json" "$HV_LOG" \
   && grep -q -x -F "hot-view busy --project $HV_REPO" "$HV_LOG"; then
  pass "hot view: a wrapper launch command (bash -c exec codescout) still reaches the real codescout"
else
  fail "hot view: wrapper launch command broke the call (log: $(tr '\n' ';' < "$HV_LOG"))"
fi
hv_profile "$HV_FAKE"

HV_START=$(hv_ctx startup)
echo "$HV_START" | grep -q "HOT VIEW (codescout hot-view;" \
  && echo "$HV_START" | grep -q -F -- "- [[e1]] t: open since 2026-11-01" \
  && pass "hot view: startup injects the view of a collection that declares hot_cap" \
  || fail "hot view: startup context lacks the HOT VIEW block"
HV_POS_VIEW=$(echo "$HV_START" | grep -n "HOT VIEW (codescout hot-view;" | head -1 | cut -d: -f1)
HV_POS_CONN=$(echo "$HV_START" | grep -n "codescout: Detected in config" | head -1 | cut -d: -f1)
{ [ -n "$HV_POS_VIEW" ] && [ -n "$HV_POS_CONN" ] && [ "$HV_POS_VIEW" -lt "$HV_POS_CONN" ]; } \
  && pass "hot view: the block comes before the connectivity note" \
  || fail "hot view: block is not before the connectivity note ($HV_POS_VIEW vs $HV_POS_CONN)"
# The entry line, not the string `HOT VIEW`: the header carries that string even when the
# collection is "not shown", so a header-only grep passes while the fake is never called.
for s in compact clear; do
  hv_ctx "$s" | grep -q -F -- "- [[e1]] t: open since 2026-11-01" \
    && pass "hot view: source=$s injects it" \
    || fail "hot view: source=$s lacks it"
done
if hv_ctx resume | grep -q "HOT VIEW"; then
  fail "hot view: source=resume must not inject it"
else
  # Non-vacuity: the resume run must still emit the rest of the message.
  hv_ctx resume | grep -q "CODESCOUT RULES" \
    && pass "hot view: source=resume omits it" \
    || fail "hot view: resume fixture precondition — the hook emitted nothing"
fi

# Opt-out: hot_view:false in the routing config, and the binary is never called.
mkdir -p "$HV_REPO/.claude"
printf '{"hot_view": false}' > "$HV_REPO/.claude/codescout-routing.json"
: > "$HV_LOG"
HV_OFF=$(hv_ctx startup)
if echo "$HV_OFF" | grep -q "HOT VIEW"; then
  fail "hot view: hot_view:false still injected the block"
elif [ -s "$HV_LOG" ]; then
  fail "hot view: hot_view:false still called the binary"
else
  echo "$HV_OFF" | grep -q "CODESCOUT RULES" \
    && pass "hot view: hot_view:false injects nothing and never calls the binary" \
    || fail "hot view: opt-out fixture precondition — the hook emitted nothing"
fi
rm -f "$HV_REPO/.claude/codescout-routing.json"

# Missing binary: the rest of the message is unchanged, the collection is listed as not shown.
# resolveCodescoutBinary also tries ~/.cargo/bin/codescout, which exists on a developer machine
# and would turn "missing" into a real binary — so this call runs with an empty HOME.
hv_profile "$TMP/missing-codescout"
mkdir -p "$TMP/hv-empty-home"
HV_MISSING=$(HV_HOME="$TMP/hv-empty-home" hv_ctx startup)
# Without the binary nothing says which collections are hot, so there is no block at all.
if echo "$HV_MISSING" | grep -q "HOT VIEW"; then
  fail "hot view: a missing binary still produced a block"
else
  echo "$HV_MISSING" | grep -q "codescout: Detected in config" \
    && echo "$HV_MISSING" | grep -q "CODESCOUT RULES" \
    && pass "hot view: a missing binary adds no block and keeps the rest" \
    || fail "hot view: missing-binary fixture precondition — the hook emitted nothing"
fi
hv_profile "$HV_FAKE"

# The old-layout refusal (a repository before `codescout box migrate`): exit 0, no `collections`. No block.
printf '{"done":false,"not_done":"the boxes use the old layout","old_layout":["docs/trackers/ledgers/busy"]}' > "$HV_BOX"
HV_OLD=$(hv_ctx startup)
if echo "$HV_OLD" | grep -q "HOT VIEW"; then
  fail "hot view: the old-layout refusal got a block"
else
  echo "$HV_OLD" | grep -q "CODESCOUT RULES" \
    && pass "hot view: the old-layout refusal adds nothing" \
    || fail "hot view: old-layout fixture precondition — the hook emitted nothing"
fi

# No hot_cap anywhere: no block at all.
printf '{"collections":[{"key":"busy","hot_cap":null,"problem":null}]}' > "$HV_BOX"
HV_NONE=$(hv_ctx startup)
if echo "$HV_NONE" | grep -q "HOT VIEW"; then
  fail "hot view: a repo with no hot_cap got a block"
else
  echo "$HV_NONE" | grep -q "CODESCOUT RULES" \
    && pass "hot view: no hot_cap anywhere adds nothing" \
    || fail "hot view: no-hot_cap fixture precondition — the hook emitted nothing"
fi

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
