#!/usr/bin/env bash
# Headless effort-rewrite probe (ES-17). 6 calls: none, low, high, none, low, high.
# Stdin is /dev/null on every call (a `claude -p` that reads the loop's stdin ate the prompt file once).
set -u
. "$(dirname "$0")/lib.sh"
MOD=$(assemble_mod effort-rewriter)
OUT=$SP/probe-runs
PROMPT='Design a rate limiter that works across three application servers and survives a Redis failover. Compare two approaches and recommend one.'
mkdir -p "$OUT"
: > "$OUT/runs.txt"
n=0
for level in none low high none low high; do
  n=$((n+1))
  dir="$OUT/$n-$level"
  mkdir -p "$dir"
  if [ "$level" != none ]; then printf '%s\n' "$level" > "$dir/.effort-probe"; fi
  sid=$(cat /proc/sys/kernel/random/uuid)
  ( cd "$dir" && env -i PATH="$PATH" HOME="$HOME" USER="$USER" LANG="${LANG:-C.UTF-8}" TERM=dumb SHELL=/bin/bash \
      CLAUDE_CONFIG_DIR="$CFG" \
      timeout 600 claude -p --model claude-sonnet-5-5 --session-id "$sid" --setting-sources local --settings '{}' \
      --strict-mcp-config --thinking-display summarized --plugin-dir "$MOD" -- "$PROMPT" \
      < /dev/null > out.txt 2> err.txt )
  rc=$?
  echo "$n $level $sid rc=$rc" >> "$OUT/runs.txt"
  if [ "$n" = 1 ] && ! ls "$dir"/.step-* >/dev/null 2>&1; then
    echo "STOP: run 1 left no .step-* file, so the mod did not load; 5 calls saved" >> "$OUT/runs.txt"
    break
  fi
done
echo done >> "$OUT/runs.txt"
