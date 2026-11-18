#!/usr/bin/env bash
# run_arm.sh <arms_dir> <results_dir> <arm> <n_valid> [cap_usd]
#
# Runs one arm until it has <n_valid> VALID responses (a valid response is a non-empty,
# non-error result; AMENDMENT-2 of the one-advisor eval: the registered n is n VALID
# runs). Every call is appended to <results_dir>/costs.tsv, and the loop refuses to
# start a call once the summed cost in that file reaches <cap_usd> (default 4).
#
# Isolation: CLAUDE_CONFIG_DIR=~/.claude-test (no plugins), --strict-mcp-config,
# --disable-slash-commands, --tools "", --no-session-persistence, an empty working
# directory per call, and a minimal environment (env -i). The only secret passed is
# ANTHROPIC_API_KEY, read from $ENV_FILE and never printed.
set -u
ARMS="$1"; RES="$2"; ARM="$3"; N="$4"; CAP="${5:-4}"
ENV_FILE="${ENV_FILE:-/home/marius/work/claude/prompt-engineering/.env}"
MODEL="${MODEL:-sonnet}"
PER_CALL_CAP="${PER_CALL_CAP:-0.50}"

K="$(grep -m1 '^ANTHROPIC_API_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"' ")"
[ -n "$K" ] || { echo "no ANTHROPIC_API_KEY in $ENV_FILE" >&2; exit 2; }
PROMPT="$ARMS/$ARM/prompt.txt"
[ -s "$PROMPT" ] || { echo "missing prompt $PROMPT" >&2; exit 2; }

mkdir -p "$RES/$ARM"
COSTS="$RES/costs.tsv"
[ -f "$COSTS" ] || printf 'arm\trun\tstatus\tcost_usd\tmodel\n' > "$COSTS"
total() { awk -F'\t' 'NR>1 {s+=$4} END {printf "%.4f", s+0}' "$COSTS"; }
over()  { awk -v t="$(total)" -v c="$CAP" 'BEGIN {exit !(t+0 >= c+0)}'; }

valid=$(find "$RES/$ARM" -maxdepth 1 -name 'run-*.txt' -size +0 | wc -l | tr -d ' ')
attempts=0
while [ "$valid" -lt "$N" ] && [ "$attempts" -lt $((N + 3)) ]; do
  if over; then echo "STOP: spend $(total) USD reached the cap $CAP USD" >&2; exit 3; fi
  attempts=$((attempts + 1))
  w="$(mktemp -d)"
  ( cd "$w" && env -i PATH="$PATH" HOME="$HOME" CLAUDE_CONFIG_DIR="$HOME/.claude-test" \
      ANTHROPIC_API_KEY="$K" claude -p --model "$MODEL" --tools "" --strict-mcp-config \
      --disable-slash-commands --no-session-persistence --output-format json \
      --max-budget-usd "$PER_CALL_CAP" < "$PROMPT" > out.json 2> err.txt )
  result="$(jq -r '.result // empty' "$w/out.json" 2>/dev/null)"
  # NB: jq's `//` treats `false` as missing, so `.is_error // true` would turn a valid
  # `false` into `true` and discard every good response. Test for the key explicitly.
  is_err="$(jq -r 'if has("is_error") then (.is_error | tostring) else "true" end' "$w/out.json" 2>/dev/null)"
  [ -n "$is_err" ] || is_err="true"
  cost="$(jq -r '.total_cost_usd // 0' "$w/out.json" 2>/dev/null)"
  model="$(jq -r '(.modelUsage // {}) | keys | join(",")' "$w/out.json" 2>/dev/null)"
  if [ "$is_err" = "false" ] && [ -n "$result" ]; then
    valid=$((valid + 1))
    printf '%s' "$result" > "$RES/$ARM/run-$valid.txt"
    printf '%s\t%s\tvalid\t%s\t%s\n' "$ARM" "$valid" "$cost" "$model" >> "$COSTS"
    echo "$ARM run-$valid valid, cost $cost, total $(total)"
  else
    why="$(printf '%s' "$result" | head -c 120)"
    printf '%s' "${why:-no result}" > "$RES/$ARM/attempt-$attempts.invalid"
    printf '%s\t-\tinvalid\t%s\t%s\n' "$ARM" "$cost" "$model" >> "$COSTS"
    echo "$ARM attempt $attempts INVALID (${why:-no result}), total $(total)" >&2
  fi
  rm -rf "$w"
done
echo "$ARM: $valid valid of $N wanted after $attempts attempt(s); total spend $(total) USD"
