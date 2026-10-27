#!/usr/bin/env bash
# run_control.sh <fixture_dir> <results_dir> <n_valid> [cap_usd]
#
# Runs the UNAIDED control (no skill, plugin-free profile) for one candidate stimulus
# until it has <n_valid> valid runs. Each run gets a fresh copy of <fixture>/files in an
# empty working directory, the request in <fixture>/request.txt on stdin, and the tools
# a real session would have (Read, Write, Edit, Bash, Glob, Grep). For each run it saves
# the final message, the raw JSON, and the whole working directory, so the response can
# be read afterwards.
#
# Spend: every call is appended to <results_dir>/costs.tsv, and no call starts once the
# summed cost in that file reaches <cap_usd> (default 10). Each call also carries
# --max-budget-usd (default 2).
#
# Model: claude-opus-5, the pin the original spine ablation used (validation_spine_opus5.yaml).
# Auth: ANTHROPIC_API_KEY read from $ENV_FILE and passed to the subprocess only.
set -u
FIX="$1"; RES="$2"; N="$3"; CAP="${4:-10}"
ENV_FILE="${ENV_FILE:-/home/marius/work/claude/prompt-engineering/.env}"
MODEL="${MODEL:-claude-opus-5}"
PER_CALL_CAP="${PER_CALL_CAP:-2.0}"
NAME="$(basename "$FIX")"

K="$(grep -m1 '^ANTHROPIC_API_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"' ")"
[ -n "$K" ] || { echo "no ANTHROPIC_API_KEY in $ENV_FILE" >&2; exit 2; }
[ -s "$FIX/request.txt" ] && [ -d "$FIX/files" ] || { echo "bad fixture $FIX" >&2; exit 2; }

mkdir -p "$RES/$NAME"
COSTS="$RES/costs.tsv"
[ -f "$COSTS" ] || printf 'fixture\trun\tstatus\tcost_usd\tmodel\n' > "$COSTS"
total() { awk -F'\t' 'NR>1 {s+=$4} END {printf "%.4f", s+0}' "$COSTS"; }
over()  { awk -v t="$(total)" -v c="$CAP" 'BEGIN {exit !(t+0 >= c+0)}'; }

valid=$(find "$RES/$NAME" -maxdepth 1 -type d -name 'run-*' | wc -l | tr -d ' ')
attempts=0
while [ "$valid" -lt "$N" ] && [ "$attempts" -lt $((N + 2)) ]; do
  if over; then echo "STOP: spend $(total) USD reached the cap $CAP USD" >&2; exit 3; fi
  attempts=$((attempts + 1))
  w="$(mktemp -d)"; cp -r "$FIX/files/." "$w/"
  ( cd "$w" && env -i PATH="$PATH" HOME="$HOME" CLAUDE_CONFIG_DIR="$HOME/.claude-test" \
      ANTHROPIC_API_KEY="$K" claude -p --model "$MODEL" \
      --allowedTools "Read Write Edit Bash Glob Grep" --permission-mode acceptEdits \
      --strict-mcp-config --disable-slash-commands --no-session-persistence \
      --output-format json --max-budget-usd "$PER_CALL_CAP" \
      < "$FIX/request.txt" > "$w/.out.json" 2> "$w/.err.txt" )
  result="$(jq -r '.result // empty' "$w/.out.json" 2>/dev/null)"
  # NB: jq's `//` treats `false` as missing; test for the key explicitly.
  is_err="$(jq -r 'if has("is_error") then (.is_error | tostring) else "true" end' "$w/.out.json" 2>/dev/null)"
  [ -n "$is_err" ] || is_err="true"
  cost="$(jq -r '.total_cost_usd // 0' "$w/.out.json" 2>/dev/null)"
  model="$(jq -r '(.modelUsage // {}) | keys | join(",")' "$w/.out.json" 2>/dev/null)"
  if [ "$is_err" = "false" ] && [ -n "$result" ]; then
    valid=$((valid + 1))
    d="$RES/$NAME/run-$valid"; mkdir -p "$d"
    printf '%s' "$result" > "$d/result.txt"
    mv "$w/.out.json" "$d/out.json"; rm -f "$w/.err.txt"
    cp -r "$w" "$d/work"
    printf '%s\t%s\tvalid\t%s\t%s\n' "$NAME" "$valid" "$cost" "$model" >> "$COSTS"
    echo "$NAME run-$valid valid, cost $cost, total $(total)"
  else
    printf '%s\t-\tinvalid\t%s\t%s\n' "$NAME" "$cost" "$model" >> "$COSTS"
    echo "$NAME attempt $attempts INVALID ($(printf '%s' "$result" | head -c 100)), total $(total)" >&2
  fi
  rm -rf "$w"
done
echo "$NAME: $valid valid of $N wanted after $attempts attempt(s); total spend $(total) USD"
