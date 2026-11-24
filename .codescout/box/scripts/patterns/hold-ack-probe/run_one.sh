#!/usr/bin/env bash
# One run of the hold-ack probe.
#   RUNS_DIR=<dir> [FORK_TOOL=Task] run_one.sh <arm: repeat|hold|advise> <task: S|M|F> <n>
set -u
AP="$(cd "$(dirname "$0")" && pwd)"
RUNS=${RUNS_DIR:?set RUNS_DIR to a writable directory outside the repository}
ARM=$1; TASK=$2; N=$3
R=$RUNS/$ARM-$TASK-$N
rm -rf "$R"; mkdir -p "$R"
cp -r "$AP/mod" "$R/mod"
printf '{"mode":"%s","logPath":"%s/probe.log.jsonl","forkTool":"%s"}\n' "$ARM" "$R" "${FORK_TOOL:-Agent}" > "$R/mod/config.json"
cat > "$R/boxw" <<'EOF'
#!/usr/bin/env bash
# stand-in for `codescout box <key> add`: files the stdin body and says so
title=""
while [ $# -gt 0 ]; do case "$1" in --title) title="$2"; shift 2;; *) shift;; esac; done
body=$(cat)
printf 'FILED\t%s\t%s bytes\n' "$title" "${#body}" >> "$(dirname "$0")/notes.tsv"
echo "filed: $title"
EOF
chmod +x "$R/boxw"
[ "$TASK" = F ] && cp "$AP/prompts/findings.md" "$R/findings.md"
cd "$R"
timeout 300 claude -p --setting-sources local --no-session-persistence --model haiku \
  --max-budget-usd 0.5 --plugin-dir "$R/mod" \
  --allowedTools "Bash,Task,Agent,mcp__hold-ack-probe__ack" \
  --output-format stream-json --verbose \
  "$(cat "$AP/prompts/$TASK.txt")" > "$R/stream.jsonl" 2> "$R/stderr.txt"
echo "exit=$?" > "$R/exit.txt"
