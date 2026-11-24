#!/usr/bin/env bash
# One acceptance run of the scribe pattern: a headless `claude -p` session against a scratch
# repository with a `bugs` box. Costs about 0.2 USD and 35 s. Not part of tests/run-all.sh.
#
# usage: tests/acceptance/scribe-fork/run.sh <A|B|F|M|L> <n>
#   A  add median(); the project tracks defects in the bugs box; note a defect
#   B  as A, plus an open bug that the change fixes (close it with the reason)
#   F  as B, plus an explicit order to hand the edits to a fork by following get_guide('scribe')
#   M  a long task: three functions, one at a time; two seeded open bugs and one defect to file, so
#      the tracker edits fall in the middle of the work. PAD_TOKENS (default 0) puts that many tokens of
#      unrelated reference text before the task, to size the parent context a fork re-reads.
#   L  a long task with a LARGE tracker job in the middle: after median(), triage ten seeded open bugs
#      (a severity and a note each, twenty writes). The run name <n> starts with the arm: n inline, f a
#      fork forced by the prompt (get_guide(scribe)), u inline with a CLAUDE.md pointer to the scribe
#      (no mention in the prompt). Same PAD_TOKENS as M.
# env:
#   CODESCOUT_BIN  the codescout binary that serves MCP and the box CLI (default: codescout on PATH)
#   ACC_DIR        where scratch repos and streams go (default: $HOME/.cache/scribe-acc);
#                  must NOT be under the system temp dir: `box new` refuses a temp-rooted artifact
#                  A label must not be reused after its repository is deleted: the catalog remembers
#                  the path and `box new` then says "path exists".
#   SCRIBE_HOOK    path of a scribe-nudge.mjs to load for this run through --settings (default: none).
#                  The installed companion plugin may not carry the hook yet.
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
if [ "$scen" = "M" ]; then
  "$bin" box bugs add --title "variance(xs) is missing from calc.py" --kind bug --text body - >/dev/null 2>&1 <<'EOT'
**Summary:** calc.py has no variance function.
EOT
fi
if [ "$scen" = "L" ]; then
  # ten open bugs to triage: severity and a note each
  while IFS='|' read -r title summary; do
    printf '**Summary:** %s\n' "$summary" | "$bin" box bugs add --title "$title" --kind bug --text body - >/dev/null 2>&1
  done <<'EOT'
total() silently ignores None values|total() skips None in the input, so a missing reading disappears from the sum with no warning.
average() divides by len(xs) + 1|average() returns a value that is too low for every input; any report built on it is wrong.
total() exhausts a generator|total() accepts a generator and the caller cannot reuse it afterwards.
calc.py has no docstrings|None of the functions in calc.py has a docstring.
average([]) raises ZeroDivisionError|average() of an empty list raises an unhandled ZeroDivisionError and stops the caller.
total() is slow for very long lists|total() of a list with ten million items takes several seconds.
calc.py has no type hints|No function in calc.py carries type hints, so editors cannot check callers.
test_calc.py covers total() only|average() has no test at all, which is how its wrong divisor went unnoticed.
average() differs from statistics.mean for floats|For floating point input the result differs from statistics.mean in the last digits.
calc.py gives a poor error for string input|A list of strings fails with a TypeError that names sum, not the function the caller used.
EOT
fi

task="Add a function median(xs) to calc.py and a test for it in test_calc.py, then run the tests with pytest. This repository tracks its defects in a bugs box, which you reach with the codescout box command."
case "$scen" in
  A) task="$task A defect you notice belongs in that box." ;;
  B) task="$task A bug in that box that your change fixes must be closed there with the reason, and a defect you notice belongs in that box." ;;
  F) task="$task A bug in that box that your change fixes must be closed there with the reason, and a defect you notice belongs in that box. Hand all of those tracker edits to a background fork by following get_guide('scribe') and keep working on the code." ;;
  M) task="Add three functions to calc.py, one at a time, each with its own test in test_calc.py, and run pytest after each: first median(xs), then mode(xs), then variance(xs). This repository tracks its defects in a bugs box, which you reach with the codescout box command. A bug in that box that your change fixes must be closed there with the reason as soon as the fix is in, and a defect you notice belongs in that box." ;;
  L) task="Add three functions to calc.py, one at a time, each with its own test in test_calc.py, and run pytest after each: first median(xs), then mode(xs), then variance(xs). This repository tracks its defects in a bugs box, which you reach with the codescout box command. When median is done, triage the bugs box before you go on: give every open bug a severity (low, medium or high) with codescout box bugs edit, and write a one-line triage note for it with codescout box bugs now, judging from what the entry says. Then continue with mode and variance."
     # the arm is the first character of the run name: f hands the triage to a fork by prompt
     if [ "${n:0:1}" = f ]; then task="$task Hand the triage to a background fork by following get_guide('scribe'), and carry on with mode and variance while it works."; fi
     # arm u: the prompt is the arm n prompt; the repository's CLAUDE.md carries the pointer (the best case
     # for any channel: every run reads it)
     if [ "${n:0:1}" = u ]; then
       printf '%s\n' '# Tracker jobs' 'A tracker job of about ten entries or twenty box writes, with work left for you, goes to a background fork. See get_guide("scribe").' > CLAUDE.md
       git add -- CLAUDE.md && git commit -q -m "claude.md"
     fi ;;
esac

printf '{"mcpServers":{"codescout":{"command":"%s","args":["start"]}}}' "$bin" > "$out/mcp.json"
extra=()
if [ -n "${SCRIBE_HOOK:-}" ]; then
  extra=(--settings "{\"hooks\":{\"PreToolUse\":[{\"matcher\":\"Bash|mcp__codescout__run_command\",\"hooks\":[{\"type\":\"command\",\"command\":\"node $SCRIBE_HOOK\"}]}]}}")
fi
args=("${extra[@]}"
  --mcp-config "$out/mcp.json" --strict-mcp-config
  --permission-mode acceptEdits
  --allowedTools "mcp__codescout" "Agent" "SendMessage" "Read" "Edit" "Write" "Bash(codescout:*)" "Bash(git:*)" "Bash(python3:*)" "Bash(pytest:*)" "Bash(python:*)"
  --output-format stream-json --verbose)
if [ "$scen" = "M" ] || [ "$scen" = "L" ]; then
  # Scenario M: a long task. PAD_TOKENS tokens of unrelated reference text come first (a stated size
  # for the parent context, which a fork re-reads), the task last. On stdin: too long for an argument.
  python3 - "${PAD_TOKENS:-0}" > "$out/prompt$scen$n.txt" <<'PY'
import sys
n = int(sys.argv[1])
if n:
    print("Background reference for this repository (read it only if the task needs it):\n")
    out, i = 0, 0
    while out < n * 4:
        s = f"Note {i}: the job scheduler batches {i * 7 % 97 + 3} tasks per tick, retries a failed task after {i % 11 + 2} seconds, and writes {i * 13 % 211 + 5} bytes of state to its journal.\n"
        print(s, end="")
        out += len(s)
        i += 1
    print()
PY
  printf '%s\n' "$task" >> "$out/prompt$scen$n.txt"
  CLAUDE_CODE_FORK_SUBAGENT=1 timeout 1500 claude -p "${args[@]}" < "$out/prompt$scen$n.txt" \
    > "$out/run$scen$n.jsonl" 2> "$out/run$scen$n.err"
else
  CLAUDE_CODE_FORK_SUBAGENT=1 timeout 900 claude -p "$task" "${args[@]}" \
    > "$out/run$scen$n.jsonl" 2> "$out/run$scen$n.err"
fi
echo "exit $? -> $out/run$scen$n.jsonl (repo: $repo)"
