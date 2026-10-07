#!/usr/bin/env bash
# Headless cache + mid-turn effort probe 3 (ES-17): a tool loop that makes the model THINK at high,
# with the default tool set (a realistic prefix). 6 runs: C, B, D, A, C, B.
#   A = no rewrite (medium)   B = medium,medium,high   C = high,high,low   D = high throughout
# Chain: start.txt (puzzle 1, answer 80) -> f80.txt (puzzle 2, answer 61) -> f61.txt (puzzle 3,
# answer 14) -> f14.txt (DONE: kiwi). Requests: index 0 reads start, 1 reads f80, 2 reads f61,
# 3 reads f14, 4 answers. The effort changes at index 2. All other f00..f99 files say "wrong file".
# Stdin is /dev/null on every call. Each run is capped at 2 USD.
set -u
. "$(dirname "$0")/lib.sh"
MOD=$(assemble_mod effort-stepper)
OUT=$SP/probe3-runs
PROMPT='Use only the Read tool and do not run any command. Read start.txt in the current directory. Each file holds a puzzle. The answer X to the puzzle names the next file, f<X>.txt, where X is written with two digits. Follow the chain with one Read call per step until a file says DONE. Then reply with only the word that follows DONE.'
mkdir -p "$OUT"
: > "$OUT/runs.txt"
thinking_of() {  # total thinking_tokens of a session id, deduped by message id (last record wins)
  python3 - "$1" <<'PY'
import json,glob,sys,os
fs=glob.glob('%s/projects/*/%s.jsonl'%(os.environ['CFG'],sys.argv[1]))
last={}
for line in open(fs[0]) if fs else []:
    o=json.loads(line)
    if o.get('type')=='assistant':
        last[(o.get('message') or {}).get('id')]=o
print(sum(((o['message'].get('usage') or {}).get('output_tokens_details') or {}).get('thinking_tokens',0) or 0 for o in last.values()))
PY
}
n=0
for arm in C B D A C B; do
  n=$((n+1))
  dir="$OUT/$n-$arm"
  mkdir -p "$dir"
  for i in $(seq -w 0 99); do
    printf 'Wrong file. The number you computed is not the answer to the puzzle you came from. Recompute carefully and read a different file.\n' > "$dir/f$i.txt"
  done
  printf 'Puzzle 1. How many integers n with 1 <= n <= 200 are divisible by exactly one of 3 and 5 (divisible by 3 or by 5, but not by both)? That count is X.\n' > "$dir/start.txt"
  printf 'Puzzle 2. What is the sum of the decimal digits of 2 to the power 40? That sum is X.\n' > "$dir/f80.txt"
  printf 'Puzzle 3. How many primes below 100 have a digit sum that is also prime? (Examples: 11 counts, since 1+1=2 is prime; 13 does not, since 1+3=4 is not.) That count is X.\n' > "$dir/f61.txt"
  printf 'DONE: kiwi\n' > "$dir/f14.txt"
  case "$arm" in
    B) printf 'medium,medium,high\n' > "$dir/.effort-probe" ;;
    C) printf 'high,high,low\n'      > "$dir/.effort-probe" ;;
    D) printf 'high\n'               > "$dir/.effort-probe" ;;
  esac
  sid=$(cat /proc/sys/kernel/random/uuid)
  ( cd "$dir" && env -i PATH="$PATH" HOME="$HOME" USER="$USER" LANG="${LANG:-C.UTF-8}" TERM=dumb SHELL=/bin/bash \
      CLAUDE_CONFIG_DIR="$CFG" \
      timeout 900 claude -p --model claude-sonnet-5-5 --session-id "$sid" --setting-sources local --settings '{}' \
      --strict-mcp-config --thinking-display summarized --plugin-dir "$MOD" \
      --allowedTools Read --max-budget-usd 2 -- "$PROMPT" \
      < /dev/null > out.txt 2> err.txt )
  rc=$?
  echo "$n $arm $sid rc=$rc" >> "$OUT/runs.txt"
  if [ "$n" = 1 ]; then
    th=$(thinking_of "$sid")
    steps=$(ls "$dir"/.step-* 2>/dev/null | wc -l)
    echo "run1 thinking_total=$th steps=$steps" >> "$OUT/runs.txt"
    if [ "$th" -le 0 ] || [ "$steps" -lt 4 ]; then
      echo "STOP: run 1 (C, high first) had thinking_total=$th and $steps steps: the loop does not make the model think at high, or did not run; 5 calls saved" >> "$OUT/runs.txt"
      break
    fi
  fi
done
echo done >> "$OUT/runs.txt"
