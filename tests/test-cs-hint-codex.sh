#!/usr/bin/env bash
# tests/test-cs-hint-codex.sh — the cs-hint-codex bundle: what it contains, that its
# copies of the buddy modules have not drifted, and that its hook behaves.
#
# Why the layout check exists: Codex hashes the WHOLE plugin root for hook trust (only
# __pycache__, .venv, *.pyc, *.egg-info are skipped), so a README, a test or a skill
# inside the root invalidates every hook approval whenever it is edited. This bundle is
# small so that one approval survives. Tests, docs and the sync script live outside it.
# See docs/superpowers/specs/2026-11-09-cs-hint-codex-bundle-design.md.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
B="$ROOT/cs-hint-codex"
HOOK="$B/hooks/cs_hint.py"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cs-hint-codex-XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }

echo "── layout ──"
expected=$'.claude-plugin/plugin.json\nhooks/cs_hint.py\nhooks/hooks.json\nscripts/cs_heuristics.py\nscripts/cs_tool_log.py'
actual="$(cd "$B" && find . -type f -not -name '*.pyc' -not -path '*/__pycache__/*' | sed 's|^\./||' | LC_ALL=C sort)"
if [ "$actual" = "$expected" ]; then ok "the bundle root holds exactly the five expected files"
else bad "bundle root" "got: $(echo "$actual" | tr '\n' ' ')"; fi

echo "── copies ──"
for f in cs_heuristics.py cs_tool_log.py; do
  if cmp -s "$ROOT/buddy/scripts/$f" "$B/scripts/$f"; then ok "$f is byte-identical to buddy/scripts/$f"
  else bad "$f drifted" "run scripts/sync-cs-hint-codex.sh"; fi
done

run_hook() {  # <json> [env assignments...]; prints stdout
  local json="$1"; shift
  printf '%s' "$json" | env PLUGIN_DATA="$TMP/data" "$@" python3 "$HOOK"
}

echo "── behaviour ──"
GREP='{"session_id":"s1","tool_name":"mcp__codescout__grep","tool_input":{"pattern":"how retries get scheduled","path":"docs"},"tool_response":{}}'
out="$(run_hook "$GREP")"
if echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin)["hookSpecificOutput"]; assert d["hookEventName"]=="PostToolUse"; assert d["additionalContext"].startswith("[cs-hint] ") and "matches text literally" in d["additionalContext"]'; then
  ok "a concept-shaped grep (a question) prints a PostToolUse [cs-hint] additionalContext"
else bad "grep hint" "got: $out"; fi

QUOTED='{"session_id":"s1","tool_name":"mcp__codescout__grep","tool_input":{"pattern":"another session wrote","path":"docs"},"tool_response":{}}'
out="$(run_hook "$QUOTED")"
[ -z "$out" ] && ok "a grep for quoted prose prints nothing (negative control for the grep hint)" || bad "quoted prose" "got: $out"

READ='{"session_id":"s1","tool_name":"mcp__codescout__read_file","tool_input":{"path":"README.md"},"tool_response":{}}'
out="$(run_hook "$READ")"
[ -z "$out" ] && ok "a harmless call prints nothing" || bad "harmless call" "got: $out"

out="$(run_hook "$GREP" CS_HINT_ENABLED=false)"
[ -z "$out" ] && ok "CS_HINT_ENABLED=false prints nothing" || bad "disabled" "got: $out"

out="$(printf 'not json' | PLUGIN_DATA="$TMP/data" python3 "$HOOK")"; rc=$?
{ [ -z "$out" ] && [ "$rc" = 0 ]; } && ok "malformed stdin: no output, exit 0" || bad "malformed stdin" "rc=$rc out=$out"

OTHER='{"session_id":"s1","tool_name":"WebSearch","tool_input":{"query":"another session wrote"},"tool_response":{}}'
out="$(run_hook "$OTHER")"
[ -z "$out" ] && ok "a tool outside the matcher set prints nothing" || bad "other tool" "got: $out"

# Codex and Claude Code run one agent's write calls one after the other, and codescout
# serializes writes itself (write guard in src/server.rs), so two writes in one second are
# serial calls, not a race. The rule that flagged them was removed 2026-11-11; see
# docs/issues/archive/2026-11-11-buddy-parallel-write-hint-keys-on-a-same-second-clock-and-a-session-wide-log.md.
# Each call here is a separate process, so a second boundary between two calls would hide a
# stale hint and make this test pass by luck. Retry with a fresh session until the log shows
# the two writes really share a timestamp, and assert on that attempt only.
same_second=""
for attempt in 1 2 3 4 5; do
  W1='{"session_id":"s2-'$attempt'","tool_name":"mcp__codescout__create_file","tool_input":{"path":"a.txt","content":"x"},"tool_response":{}}'
  W2='{"session_id":"s2-'$attempt'","tool_name":"mcp__codescout__create_file","tool_input":{"path":"b.txt","content":"y"},"tool_response":{}}'
  run_hook "$W1" >/dev/null
  out="$(run_hook "$W2")"
  if python3 -c 'import json,sys; ts=[json.loads(l)["ts"] for l in open(sys.argv[1])]; sys.exit(0 if len(ts)==2 and ts[0]==ts[1] else 1)' "$TMP/data/s2-$attempt/cs_tool_log.jsonl"; then same_second=1; break; fi
done
if [ -z "$same_second" ]; then bad "same-second writes" "no attempt in 5 put both writes in one second; the test checked nothing"
elif [ -z "$out" ]; then ok "two writes in one second print nothing (they are serial calls, not a race)"
else bad "same-second writes" "got: $out"; fi

W3='{"session_id":"s3","tool_name":"mcp__codescout__create_file","tool_input":{"path":"c.txt","content":"z"},"tool_response":{}}'
out="$(run_hook "$W3")"
[ -z "$out" ] && ok "a single write in a fresh session prints nothing (logs are per session)" || bad "per-session log" "got: $out"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" = 0 ]
