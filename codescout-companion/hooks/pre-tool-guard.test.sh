#!/usr/bin/env bash
# Test matrix for pre-tool-guard.sh — Bash branch cross-repo scope.
#
# Covers the fix for bug "cross-repo git-ops friction" (2026-05-20):
# the Bash branch must exit 0 (allow) when the command cd's outside the
# announced $CWD, matching the scoping behavior of Read/Edit/Grep/Glob.
#
# Sources `pre-tool-guard.sh` as a black box; relies on detect-tools.sh →
# detect.py to fill in HAS_CODESCOUT / BLOCK_READS / WORKSPACE_ROOT from
# the announced $CWD. The tests use code-explorer as the active workspace
# because that's where the friction was first observed.

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/pre-tool-guard.sh"
ACTIVE_CWD="/home/marius/work/claude/code-explorer"
SIBLING_CWD="/home/marius/work/claude/claude-plugins"
PASS=0
FAIL=0

verdict() {
    local out="$1"
    if [[ -z "$out" ]]; then
        echo allow
    else
        echo "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null || echo allow
    fi
}

# Clear the 3-second dedup window so each test runs with a fresh slate.
clean() { /bin/rm -f /tmp/cs-block-* 2>/dev/null; }

assert() {
    local label="$1"
    local cmd="$2"
    local expected="$3"  # "deny" or "allow"
    clean
    local input
    input=$(jq -n --arg c "$cmd" --arg cwd "$ACTIVE_CWD" \
        '{tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}')
    local got
    got=$(verdict "$(echo "$input" | "$HOOK")")
    if [[ "$got" == "$expected" ]]; then
        echo "PASS [$label]"
        PASS=$((PASS+1))
    else
        echo "FAIL [$label]: expected=$expected got=$got"
        echo "  cmd: $cmd"
        FAIL=$((FAIL+1))
    fi
}

# --- Cross-repo cd: should pass through ---
assert "cd-sibling-abs"      "cd $SIBLING_CWD && git status"                        "allow"
assert "cd-sibling-quoted"   "cd \"/home/marius/work/mirela/backend-kotlin\" && git status" "allow"
assert "cd-sibling-tilde"    "cd ~/work/claude/claude-plugins && git log -1"        "allow"
assert "cd-sibling-relative" "cd ../claude-plugins && git status"                   "allow"
assert "cd-tmp"              "cd /tmp && ls"                                        "allow"

# --- In-workspace bash: must remain blocked ---
assert "bare-cargo-test"     "cargo test"                                           "deny"
assert "cd-subdir-in-ws"     "cd src && ls"                                         "deny"
assert "cd-abs-back-into-ws" "cd $ACTIVE_CWD/src && ls"                             "deny"
assert "grep-on-source"      "grep foo src/main.rs"                                 "deny"

clean
echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
