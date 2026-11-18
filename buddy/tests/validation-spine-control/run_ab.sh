#!/usr/bin/env bash
# run_ab.sh <fixture_dir> <results_dir> <arm> <skill_dir|none> <n_valid> [cap_usd]
#
# One arm of the spine A/B. Like run_control.sh, but:
#   * the skill (if any) is copied to <work>/.claude/skills/validation-spine/ under the SAME
#     directory name in every arm (prompt-tdd-skill-eval-confounds, trap 1: a renamed copy
#     never registers and silently measures the base model);
#   * skills stay ENABLED (run_control.sh passes --disable-slash-commands, which would turn
#     the skill off);
#   * the call uses --output-format stream-json --verbose, so the stream can be searched for
#     evidence that the skill was actually invoked. That evidence is recorded in
#     <results_dir>/activation.tsv for EVERY arm, including the no-skill arm (expected 0).
#
# Spend guard, per-call budget cap, invalid handling, auth: as in run_control.sh. The cap is
# checked against the summed cost in <results_dir>/costs.tsv before each call.
set -u
FIX="$(cd "$1" && pwd)"; mkdir -p "$2"; RES="$(cd "$2" && pwd)"; ARM="$3"; SKILL="$4"; N="$5"; CAP="${6:-9}"
ENV_FILE="${ENV_FILE:-/home/marius/work/claude/prompt-engineering/.env}"
MODEL="${MODEL:-claude-opus-5}"
PER_CALL_CAP="${PER_CALL_CAP:-2.0}"

K="$(grep -m1 '^ANTHROPIC_API_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"' ")"
[ -n "$K" ] || { echo "no ANTHROPIC_API_KEY in $ENV_FILE" >&2; exit 2; }
[ -s "$FIX/request.txt" ] && [ -d "$FIX/files" ] || { echo "bad fixture $FIX" >&2; exit 2; }
if [ "$SKILL" != "none" ]; then
  SKILL="$(cd "$SKILL" && pwd)"; [ -s "$SKILL/SKILL.md" ] || { echo "no SKILL.md in $SKILL" >&2; exit 2; }
fi

mkdir -p "$RES/$ARM"
COSTS="$RES/costs.tsv"; ACT="$RES/activation.tsv"
[ -f "$COSTS" ] || printf 'arm\trun\tstatus\tcost_usd\tmodel\n' > "$COSTS"
[ -f "$ACT" ]   || printf 'arm\trun\tskill_tool_calls\tskill_text_in_stream\n' > "$ACT"
total() { awk -F'\t' 'NR>1 {s+=$4} END {printf "%.4f", s+0}' "$COSTS"; }
over()  { awk -v t="$(total)" -v c="$CAP" 'BEGIN {exit !(t+0 >= c+0)}'; }

valid=$(find "$RES/$ARM" -maxdepth 1 -type d -name 'run-*' | wc -l | tr -d ' ')
attempts=0
while [ "$valid" -lt "$N" ] && [ "$attempts" -lt $((N + 2)) ]; do
  if over; then echo "STOP: spend $(total) USD reached the cap $CAP USD" >&2; exit 3; fi
  attempts=$((attempts + 1))
  w="$(mktemp -d)"; cp -r "$FIX/files/." "$w/"
  if [ "$SKILL" != "none" ]; then
    mkdir -p "$w/.claude/skills/validation-spine"; cp "$SKILL/SKILL.md" "$w/.claude/skills/validation-spine/SKILL.md"
  fi
  ( cd "$w" && env -i PATH="$PATH" HOME="$HOME" CLAUDE_CONFIG_DIR="$HOME/.claude-test" \
      ANTHROPIC_API_KEY="$K" claude -p --model "$MODEL" \
      --allowedTools "Read Write Edit Bash Glob Grep Skill" --permission-mode acceptEdits \
      --strict-mcp-config --no-session-persistence \
      --output-format stream-json --verbose --max-budget-usd "$PER_CALL_CAP" \
      < "$FIX/request.txt" > "$w/.stream.jsonl" 2> "$w/.err.txt" )
  res="$(jq -c 'select(.type=="result")' "$w/.stream.jsonl" 2>/dev/null | tail -1)"
  result="$(printf '%s' "$res" | jq -r '.result // empty' 2>/dev/null)"
  # NB: jq's `//` treats `false` as missing; test for the key explicitly.
  is_err="$(printf '%s' "$res" | jq -r 'if has("is_error") then (.is_error | tostring) else "true" end' 2>/dev/null)"
  [ -n "$is_err" ] || is_err="true"
  cost="$(printf '%s' "$res" | jq -r '.total_cost_usd // 0' 2>/dev/null)"
  model="$(printf '%s' "$res" | jq -r '(.modelUsage // {}) | keys | join(",")' 2>/dev/null)"
  if [ "$is_err" = "false" ] && [ -n "$result" ]; then
    valid=$((valid + 1))
    d="$RES/$ARM/run-$valid"; mkdir -p "$d"
    printf '%s' "$result" > "$d/result.txt"
    mv "$w/.stream.jsonl" "$d/stream.jsonl"; rm -f "$w/.err.txt"
    # Evidence of activation: a Skill tool call naming validation-spine, and the skill's text in the stream.
    tool="$(grep -c '"name":"Skill"' "$d/stream.jsonl")"
    text="$(grep -c -E 'checks you write must be able to fail|Follow this procedure exactly' "$d/stream.jsonl")"
    printf '%s\t%s\t%s\t%s\n' "$ARM" "$valid" "$tool" "$text" >> "$ACT"
    cp -r "$w" "$d/work"
    printf '%s\t%s\tvalid\t%s\t%s\n' "$ARM" "$valid" "$cost" "$model" >> "$COSTS"
    echo "$ARM run-$valid valid, cost $cost, skill_tool=$tool skill_text=$text, total $(total)"
  else
    printf '%s\t-\tinvalid\t%s\t%s\n' "$ARM" "$cost" "$model" >> "$COSTS"
    echo "$ARM attempt $attempts INVALID ($(printf '%s' "$result" | head -c 100)), total $(total)" >&2
  fi
  rm -rf "$w"
done
echo "$ARM: $valid valid of $N wanted after $attempts attempt(s); total spend $(total) USD"
