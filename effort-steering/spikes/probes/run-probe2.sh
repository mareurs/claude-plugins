#!/usr/bin/env bash
# Headless cache and mid-turn effort probe (ES-17). 6 runs: A, B, C, A, B, C.
#   A = no rewrite (medium throughout)      B = medium,medium,high  (up after step 1)
#   C = high,high,low (down after step 1)
# Each run is a forced sequential tool loop: step1.txt -> step2.txt -> step3.txt -> step4.txt (DONE),
# so the turn has 5 requests (index 0..4); the effort changes at index 2.
# Stdin is /dev/null on every call.
set -u
. "$(dirname "$0")/lib.sh"
MOD=$(assemble_mod effort-stepper)
OUT=$SP/probe2-runs
PROMPT='Use the Read tool. Read step1.txt in the current directory. Each file tells you which file to read next. Follow the chain one file per step, with exactly one Read call per step, until a file says DONE. Then reply with only the word that follows DONE.'
mkdir -p "$OUT"
: > "$OUT/runs.txt"
n=0
for arm in A B C A B C; do
  n=$((n+1))
  dir="$OUT/$n-$arm"
  mkdir -p "$dir"
  printf 'next: step2.txt\n' > "$dir/step1.txt"
  printf 'next: step3.txt\n' > "$dir/step2.txt"
  printf 'next: step4.txt\n' > "$dir/step3.txt"
  printf 'DONE: banana\n'    > "$dir/step4.txt"
  case "$arm" in
    B) printf 'medium,medium,high\n' > "$dir/.effort-probe" ;;
    C) printf 'high,high,low\n'      > "$dir/.effort-probe" ;;
  esac
  sid=$(cat /proc/sys/kernel/random/uuid)
  ( cd "$dir" && env -i PATH="$PATH" HOME="$HOME" USER="$USER" LANG="${LANG:-C.UTF-8}" TERM=dumb SHELL=/bin/bash \
      CLAUDE_CONFIG_DIR="$CFG" \
      timeout 600 claude -p --model claude-sonnet-5-5 --session-id "$sid" --setting-sources local --settings '{}' \
      --strict-mcp-config --thinking-display summarized --plugin-dir "$MOD" \
      --tools Read --allowedTools Read -- "$PROMPT" \
      < /dev/null > out.txt 2> err.txt )
  rc=$?
  echo "$n $arm $sid rc=$rc" >> "$OUT/runs.txt"
  if [ "$n" = 1 ]; then
    steps=$(ls "$dir"/.step-* 2>/dev/null | wc -l)
    if [ "$steps" -lt 4 ]; then
      echo "STOP: run 1 (A) logged $steps steps, fewer than 4, so the forced chain did not run; 5 calls saved" >> "$OUT/runs.txt"
      break
    fi
  fi
  if [ "$n" = 2 ] && ! grep -q '"rewrittenTo":"high"' "$dir/.step-2-main.json" 2>/dev/null; then
    echo "STOP: run 2 (B) did not rewrite step 2 to high; 4 calls saved" >> "$OUT/runs.txt"
    break
  fi
done
echo done >> "$OUT/runs.txt"
