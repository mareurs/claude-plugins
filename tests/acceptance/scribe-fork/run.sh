#!/usr/bin/env bash
# One acceptance run of the scribe pattern: a headless `claude -p` session against a scratch
# repository with a `bugs` box. Costs about 0.2 USD and 35 s. Not part of tests/run-all.sh.
#
# usage: tests/acceptance/scribe-fork/run.sh <A|B|F> <n>
#   A  add median(); the project tracks defects in the bugs box; note a defect
#   B  as A, plus an open bug that the change fixes (close it with the reason)
#   F  as B, plus an explicit order to hand the edits to a fork by following get_guide('scribe')
# env:
#   CODESCOUT_BIN  the codescout binary that serves MCP and the box CLI (default: codescout on PATH)
#   ACC_DIR        where scratch repos and streams go (default: $HOME/.cache/scribe-acc);
#                  must NOT be under the system temp dir: `box new` refuses a temp-rooted artifact
# The stream is saved as $ACC_DIR/out/run<scenario><n>.jsonl; score it with score.py.
set -uo pipefail
scen="$1"; n="$2"
bin="${CODESCOUT_BIN:-$(command -v codescout)}"
root="${ACC_DIR:-$HOME/.cache/scribe-acc}"
repo="$root/repo-$scen$n"; out="$root/out"
mkdir -p "$out"; rm -rf "$repo"; mkdir -p "$repo"; cd "$repo" || exit 2

git init -q; git config user.email t@example.com; git config user.name tester
cat > calc.py <<'PY'
def total(xs):
    return sum(xs)


def average(xs):
    # the divisor counts one element too many
    return sum(xs) / (len(xs) + 1)
PY
cat > test_calc.py <<'PY'
from calc import total


def test_total():
    assert total([1, 2, 3]) == 6
PY
git add -A && git commit -q -m init
"$bin" box new issues bugs --title "Bugs" >/dev/null
git add -A && git commit -q -m "bugs box" || true
if [ "$scen" != "A" ]; then
  "$bin" box bugs add --title "median(xs) is missing from calc.py" --kind bug --text body - >/dev/null 2>&1 <<'EOT'
**Summary:** calc.py has no median function.
EOT
fi

task="Add a function median(xs) to calc.py and a test for it in test_calc.py, then run the tests with pytest. This repository tracks its defects in a bugs box, which you reach with the codescout box command."
case "$scen" in
  A) task="$task A defect you notice belongs in that box." ;;
  B) task="$task A bug in that box that your change fixes must be closed there with the reason, and a defect you notice belongs in that box." ;;
  F) task="$task A bug in that box that your change fixes must be closed there with the reason, and a defect you notice belongs in that box. Hand all of those tracker edits to a background fork by following get_guide('scribe') and keep working on the code." ;;
esac

printf '{"mcpServers":{"codescout":{"command":"%s","args":["start"]}}}' "$bin" > "$out/mcp.json"
CLAUDE_CODE_FORK_SUBAGENT=1 timeout 900 claude -p "$task" \
  --mcp-config "$out/mcp.json" --strict-mcp-config \
  --permission-mode acceptEdits \
  --allowedTools "mcp__codescout" "Agent" "SendMessage" "Read" "Edit" "Write" "Bash(codescout:*)" "Bash(git:*)" "Bash(python3:*)" "Bash(pytest:*)" "Bash(python:*)" \
  --output-format stream-json --verbose > "$out/run$scen$n.jsonl" 2> "$out/run$scen$n.err"
echo "exit $? -> $out/run$scen$n.jsonl (repo: $repo)"
