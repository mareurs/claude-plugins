#!/usr/bin/env bash
# Instrument check I1b (ES-17): the B arm (medium,medium,high) once, through the local wire recorder,
# so the request's real effort is logged per request. Stdin is /dev/null.
set -u
. "$(dirname "$0")/lib.sh"
MOD=$(assemble_mod effort-stepper)
OUT=$SP/i1b-run
PORT=8099
PROMPT='Use only the Read tool and do not run any command. Read start.txt in the current directory. Each file holds a puzzle. The answer X to the puzzle names the next file, f<X>.txt, where X is written with two digits. Follow the chain with one Read call per step until a file says DONE. Then reply with only the word that follows DONE.'
mkdir -p "$OUT"; : > "$OUT/wire.jsonl"; dir="$OUT/1-B"; mkdir -p "$dir"
for i in $(seq -w 0 99); do
  printf 'Wrong file. The number you computed is not the answer to the puzzle you came from. Recompute carefully and read a different file.\n' > "$dir/f$i.txt"
done
printf 'Puzzle 1. How many integers n with 1 <= n <= 200 are divisible by exactly one of 3 and 5 (divisible by 3 or by 5, but not by both)? That count is X.\n' > "$dir/start.txt"
printf 'Puzzle 2. What is the sum of the decimal digits of 2 to the power 40? That sum is X.\n' > "$dir/f80.txt"
printf 'Puzzle 3. How many primes below 100 have a digit sum that is also prime? (Examples: 11 counts, since 1+1=2 is prime; 13 does not, since 1+3=4 is not.) That count is X.\n' > "$dir/f61.txt"
printf 'DONE: kiwi\n' > "$dir/f14.txt"
printf 'medium,medium,high\n' > "$dir/.effort-probe"
WIRE_PORT=$PORT WIRE_UPSTREAM=https://api.anthropic.com WIRE_LOG="$OUT/wire.jsonl" python3 "$HERE/wire_recorder.py" > "$OUT/recorder.out" 2>&1 &
REC=$!
trap 'kill $REC 2>/dev/null' EXIT
sleep 1.5
sid=$(cat /proc/sys/kernel/random/uuid)
( cd "$dir" && env -i PATH="$PATH" HOME="$HOME" USER="$USER" LANG="${LANG:-C.UTF-8}" TERM=dumb SHELL=/bin/bash \
    CLAUDE_CONFIG_DIR="$CFG" ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" \
    timeout 900 claude -p --model claude-sonnet-5-5 --session-id "$sid" --setting-sources local --settings '{}' \
    --strict-mcp-config --thinking-display summarized --plugin-dir "$MOD" \
    --allowedTools Read --max-budget-usd 2 -- "$PROMPT" \
    < /dev/null > out.txt 2> err.txt )
echo "1 B $sid rc=$?" > "$OUT/runs.txt"
echo done >> "$OUT/runs.txt"
