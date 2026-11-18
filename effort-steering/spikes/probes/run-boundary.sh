#!/usr/bin/env bash
# ES-17 probe 4: effort change at a TURN boundary (a new user message in a resumed session), with
# same-effort controls, through the wire recorder. Each arm = turn 1 at effort X, then `--resume` the
# same session for turn 2 at effort Y (the mod reads .effort-probe, rewritten between the two calls).
#   arms (X>Y), in run order: H>H (control), M>H, H>L, M>M (control)
# 2 requests per arm (no tools are expected), 8 requests in all. Guard: if turn 1 of the first arm shows
# no thinking, the thinking blocks the boundary drops do not exist and the run stops after 2 requests.
# Stdin is /dev/null on every call. Each call is capped at 2 USD. Needs PROBE_DIR (see lib.sh).
set -u
. "$(dirname "$0")/lib.sh"
MOD=$(assemble_mod effort-stepper)
OUT=$SP/probe4-runs
PORT=8099
P1='Design a rate limiter that works across three application servers and survives a Redis failover. Compare two approaches and recommend one.'
P2='Now take the approach you did not recommend. State the one situation where it would be the better choice, and explain why in a few sentences.'
lvl() { case "$1" in H) echo high ;; M) echo medium ;; L) echo low ;; esac; }
mkdir -p "$OUT"; : > "$OUT/runs.txt"; : > "$OUT/wire.jsonl"
WIRE_PORT=$PORT WIRE_UPSTREAM=https://api.anthropic.com WIRE_LOG="$OUT/wire.jsonl" python3 "$HERE/wire_recorder.py" > "$OUT/recorder.out" 2>&1 &
REC=$!
trap 'kill $REC 2>/dev/null' EXIT
sleep 1.5
claude_call() {  # claude_call DIR MODE(--session-id|--resume) SID PROMPT OUTFILE
  ( cd "$1" && env -i PATH="$PATH" HOME="$HOME" USER="$USER" LANG="${LANG:-C.UTF-8}" TERM=dumb SHELL=/bin/bash \
      CLAUDE_CONFIG_DIR="$CFG" ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" \
      timeout 900 claude -p --model claude-sonnet-5-5 "$2" "$3" --setting-sources local --settings '{}' \
      --strict-mcp-config --thinking-display summarized --plugin-dir "$MOD" \
      --max-budget-usd 2 -- "$4" < /dev/null > "$5" 2> "$5.err" )
}
n=0
for arm in HH MH HL MM; do
  n=$((n+1)); x=${arm:0:1}; y=${arm:1:1}
  dir="$OUT/$n-$arm"; mkdir -p "$dir"
  sid=$(cat /proc/sys/kernel/random/uuid)
  printf '%s\n' "$(lvl $x)" > "$dir/.effort-probe"
  claude_call "$dir" --session-id "$sid" "$P1" out1.txt; rc1=$?
  printf '%s\n' "$(lvl $y)" > "$dir/.effort-probe"
  claude_call "$dir" --resume "$sid" "$P2" out2.txt; rc2=$?
  echo "$n $arm $sid rc1=$rc1 rc2=$rc2" >> "$OUT/runs.txt"
  if [ "$n" = 1 ]; then
    th=$(python3 - "$sid" <<'PY'
import json,glob,sys,os
fs=glob.glob('%s/projects/*/%s.jsonl'%(os.environ['CFG'],sys.argv[1]))
last={}
for line in open(fs[0]) if fs else []:
    o=json.loads(line)
    if o.get('type')=='assistant': last[(o.get('message') or {}).get('id')]=o
print(sum(((o['message'].get('usage') or {}).get('output_tokens_details') or {}).get('thinking_tokens',0) or 0 for o in list(last.values())[:1]))
PY
)
    echo "arm1 turn1 thinking_tokens=$th" >> "$OUT/runs.txt"
    if [ "${th:-0}" -le 0 ]; then
      echo "STOP: turn 1 of the first arm (high) had no thinking, so there are no thinking blocks for the boundary to drop; 6 requests saved" >> "$OUT/runs.txt"
      break
    fi
  fi
done
echo done >> "$OUT/runs.txt"
