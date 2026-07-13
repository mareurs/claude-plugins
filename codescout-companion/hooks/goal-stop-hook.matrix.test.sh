#!/usr/bin/env bash
# T2e — 9-branch decision matrix test for goal-stop-hook.sh.
#
# Mocks the `codescout` binary by prepending a stub directory to PATH that
# answers `artifact find`, `artifact get`, and `artifact-event list` with
# canned JSON, then asserts the hook's stdout matches the expected verdict
# for each branch.
#
# Branches:
#   1. 0 active goals          → continue, "no active goal"
#   2. >1 active goals         → continue, "multiple active goals"
#   3. 1 goal, status=done, gate_check event present → STOP, "auto-close gate passed"
#   4. 1 goal, status=blocked  → STOP, "goal blocked"
#   5. 1 goal, status=abandoned → STOP, "goal abandoned"
#   6. 1 goal, status=active + unmet signal → continue, "next acceptance signal"
#   7. codescout binary missing → continue, "fail-open" (binary not found)
#   8. 1 goal, status=unknown  → continue, "malformed" (Hamsa S-2 — fail-open with distinct signal)
#   9. 1 goal, status=done, NO gate_check event → STOP, legacy form (S-4 fallback)

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/goal-stop-hook.mjs"
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

mkdir -p "$WORK/bin"
mkdir -p "$WORK/project/.claude"
ORIG_PATH="$PATH"

# Helper: install a `codescout` stub whose body branches on the artifact subcommand
# ($1) — the function body to evaluate as bash inside the stub.
install_stub_body() {
    local body="$1"
    cat > "$WORK/bin/codescout" <<EOF
#!/usr/bin/env bash
set -e
$body
EOF
    chmod +x "$WORK/bin/codescout"
}

# Helper: install a stub that distinguishes find / get / event-list based on argv[1..2].
# $1 = find response JSON, $2 = get response JSON (optional), $3 = event-list response JSON (optional, default "[]").
install_find_get_stub() {
    local find_json="$1"
    local get_json="${2:-}"
    local event_json="${3:-[]}"
    cat > "$WORK/bin/codescout" <<EOF
#!/usr/bin/env bash
set -e
sub="\$1"; verb="\$2"
case "\$sub \$verb" in
    "artifact find") echo '$find_json' ;;
    "artifact get")  echo '$get_json' ;;
    "artifact-event list") echo '$event_json' ;;
    *) echo "{}" ;;
esac
EOF
    chmod +x "$WORK/bin/codescout"
}

assert_hook() {
    local label="$1"
    local expected_continue="$2"        # "true" or "false"
    local expected_reason_substring="$3"

    local input="{\"session_id\":\"t\",\"transcript_path\":\"/dev/null\",\"cwd\":\"$WORK/project\",\"last_assistant_message\":\"\"}"
    local output
    output=$(echo "$input" | PATH="$WORK/bin:/usr/bin:/bin" HOME="$WORK/home" node "$HOOK")

    local got_continue
    got_continue=$(echo "$output" | jq -r '.continue' 2>/dev/null || echo "")
    local got_reason
    got_reason=$(echo "$output" | jq -r '.reason // .reason_to_continue // ""' 2>/dev/null || echo "")

    if [[ "$got_continue" != "$expected_continue" ]]; then
        echo "FAIL [$label]: expected continue=$expected_continue, got '$got_continue'"
        echo "  full output: $output"
        exit 1
    fi
    if [[ "$got_reason" != *"$expected_reason_substring"* ]]; then
        echo "FAIL [$label]: expected reason containing '$expected_reason_substring', got '$got_reason'"
        echo "  full output: $output"
        exit 1
    fi
    echo "PASS [$label]"
}

GOAL_ID="abc123"

# --- Branch 1: 0 active goals ---
install_find_get_stub '{"count":0,"items":[]}'
assert_hook "0-goals" "true" "no active goal"

# --- Branch 2: >1 active goals ---
install_find_get_stub '{"count":2,"items":[{"id":"a","title":"G1"},{"id":"b","title":"G2"}]}'
assert_hook "multi-goals" "true" "multiple active goals"

# --- Branch 3: 1 goal, status=done, gate_check event present (S-4: surface gate text) ---
install_find_get_stub \
    "{\"count\":1,\"items\":[{\"id\":\"$GOAL_ID\",\"title\":\"G\"}]}" \
    "{\"id\":\"$GOAL_ID\",\"title\":\"G\",\"augmentation\":{\"params\":{\"status\":\"done\",\"criterion\":\"do X\"}}}" \
    '[{"id":"e1","kind":"note","payload":{"tag":"gate_check","gate_passed":true,"text":"auto-close gate passed: 2/2 children done, 3/3 signals met","evidence":{"children_count":2,"children_done":2,"signal_count_total":3,"signal_count_met":3},"refresh_at":"2026-05-17T10:00:00Z"}}]'
assert_hook "done-with-gate" "false" "auto-close gate passed: 2/2 children done"

# --- Branch 4: 1 goal, status=blocked ---
install_find_get_stub \
    "{\"count\":1,\"items\":[{\"id\":\"$GOAL_ID\",\"title\":\"G\"}]}" \
    "{\"id\":\"$GOAL_ID\",\"title\":\"G\",\"augmentation\":{\"params\":{\"status\":\"blocked\",\"criterion\":\"do X\",\"blocked_reason\":\"need approval\"}}}"
assert_hook "blocked" "false" "goal blocked"

# --- Branch 5: 1 goal, status=abandoned ---
install_find_get_stub \
    "{\"count\":1,\"items\":[{\"id\":\"$GOAL_ID\",\"title\":\"G\"}]}" \
    "{\"id\":\"$GOAL_ID\",\"title\":\"G\",\"augmentation\":{\"params\":{\"status\":\"abandoned\",\"criterion\":\"do X\"}}}"
assert_hook "abandoned" "false" "goal abandoned"

# --- Branch 6: 1 goal, status=active, with one unmet signal ---
install_find_get_stub \
    "{\"count\":1,\"items\":[{\"id\":\"$GOAL_ID\",\"title\":\"G\"}]}" \
    "{\"id\":\"$GOAL_ID\",\"title\":\"G\",\"augmentation\":{\"params\":{\"status\":\"active\",\"criterion\":\"do X\",\"acceptance_signals\":[{\"description\":\"step one\",\"met\":true},{\"description\":\"step two\",\"met\":false}]}}}"
assert_hook "active-with-next" "true" "step two"

# --- Branch 7: codescout binary missing (stub removed) ---
rm -f "$WORK/bin/codescout"
assert_hook "binary-missing" "true" "fail-open"

# --- Branch 8: status=unknown / malformed (Hamsa S-2) ---
# Reinstall the stub for this branch.
install_find_get_stub \
    "{\"count\":1,\"items\":[{\"id\":\"$GOAL_ID\",\"title\":\"G\"}]}" \
    "{\"id\":\"$GOAL_ID\",\"title\":\"G\",\"augmentation\":{\"params\":{\"status\":\"unknown\",\"criterion\":\"do X\"}}}"
assert_hook "malformed-status" "true" "malformed"

# --- Branch 9: 1 goal, status=done, NO gate_check event (S-4 fallback) ---
# Stub answers artifact-event list with an empty array. The hook should fall
# back to the legacy reason form (criterion + last refreshed) without the
# gate-evidence dash-separator.
install_find_get_stub \
    "{\"count\":1,\"items\":[{\"id\":\"$GOAL_ID\",\"title\":\"G\"}]}" \
    "{\"id\":\"$GOAL_ID\",\"title\":\"G\",\"augmentation\":{\"params\":{\"status\":\"done\",\"criterion\":\"do X\"}}}" \
    '[]'
assert_hook "done-no-gate" "false" "goal done: do X"
# Defensive: also assert the gate substring is ABSENT in the fallback path.
fallback_out=$(echo "{\"session_id\":\"t\",\"transcript_path\":\"/dev/null\",\"cwd\":\"$WORK/project\",\"last_assistant_message\":\"\"}" | PATH="$WORK/bin:/usr/bin:/bin" HOME="$WORK/home" node "$HOOK")
if [[ "$fallback_out" == *"auto-close gate passed"* ]]; then
    echo "FAIL [done-no-gate-no-leak]: fallback reason should NOT contain 'auto-close gate passed' substring"
    echo "  full output: $fallback_out"
    exit 1
fi
echo "PASS [done-no-gate-no-leak]"

echo "All 9 branches passed."
