#!/bin/bash
# Runs one short `claude -p` session with mod-probe loaded, from the current directory (run it
# from a git checkout), then prints the summary. Output: scripts/mod-probe/run/.
set -u
D="$(cd "$(dirname "$0")" && pwd)"
OUT="$D/run"; mkdir -p "$OUT"; rm -f "$D/out.json"
PROMPT='This is a hook probe. Make EXACTLY these three tool calls, one per turn, and do not retry: 1. Read the first 5 lines of README.md. 2. Run the Bash command: git --version 3. Run the Bash command: git status --short. Then reply with one word: done.'
claude -p "$PROMPT" --model haiku --max-turns 8 --no-session-persistence \
  --allowedTools Read Bash --plugin-dir "$D" --output-format stream-json --verbose \
  --debug-file "$OUT/debug.log" > "$OUT/stream.jsonl" 2> "$OUT/stderr.txt"
echo "claude exit: $?"
node "$D/summarize.mjs" "$OUT/debug.log" "$D/out.json" | tee "$OUT/summary.txt"
