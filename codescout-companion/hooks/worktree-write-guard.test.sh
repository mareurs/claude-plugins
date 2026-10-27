#!/usr/bin/env bash
# Test for worktree-write-guard.sh — verifies coverage of modern codescout
# write tools (edit_code, edit_file, create_file) and that stale handles
# (edit_markdown, replace_symbol, insert_code, edit_lines,
# create_or_update_file) are correctly filtered OUT by the case statement.
# edit_markdown was folded into edit_file by the 2026-09-02 collapse; it sits
# in the stale-sentinel block precisely so re-adding it to the matcher — which
# would read as coverage of a tool that cannot exist — flips a visible test.
# Closes U-14 (matcher drift) and pins the stale-name absence so a future
# regression flips a visible test.

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/worktree-write-guard.mjs"
PASS=0
FAIL=0

# --- Sandbox: real git repo + worktree + pending marker ---
SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT

cd "$SANDBOX"
git init -q -b main main-repo
cd main-repo
git config user.email "test@test"
git config user.name "test"
git commit --allow-empty -q -m initial
git worktree add -q -b pending-branch ../worktree-pending >/dev/null
PENDING_WT="$SANDBOX/worktree-pending"
touch "$PENDING_WT/.cs-worktree-pending"

# Second worktree WITHOUT the marker (control)
git worktree add -q -b clean-branch ../worktree-clean >/dev/null
CLEAN_WT="$SANDBOX/worktree-clean"

verdict() {
    local out="$1"
    if [ -z "$out" ]; then
        echo allow
    else
        echo "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null || echo allow
    fi
}

# assert <label> <tool_name> <cwd> <expected>
assert() {
    local label="$1" tool="$2" cwd="$3" expected="$4"
    local input
    input=$(jq -n --arg t "$tool" --arg c "$cwd" '{tool_name:$t, cwd:$c}')
    local got
    got=$(verdict "$(echo "$input" | node "$HOOK")")
    if [ "$got" = "$expected" ]; then
        echo "PASS [$label]"
        PASS=$((PASS+1))
    else
        echo "FAIL [$label]: expected=$expected got=$got"
        FAIL=$((FAIL+1))
    fi
}

# --- Modern write tools in pending worktree → DENY ---
assert "edit_code-pending"     "mcp__codescout__edit_code"     "$PENDING_WT" "deny"
assert "edit_file-pending"     "mcp__codescout__edit_file"     "$PENDING_WT" "deny"
assert "create_file-pending"   "mcp__codescout__create_file"   "$PENDING_WT" "deny"

# --- Read-only tools in pending worktree → ALLOW (case filters out) ---
assert "symbols-pending"          "mcp__codescout__symbols"          "$PENDING_WT" "allow"
assert "read_file-pending"        "mcp__codescout__read_file"        "$PENDING_WT" "allow"
assert "semantic_search-pending"  "mcp__codescout__semantic_search"  "$PENDING_WT" "allow"
assert "grep-pending"             "mcp__codescout__grep"             "$PENDING_WT" "allow"

# --- Modern write tools in clean worktree (no marker) → ALLOW ---
assert "edit_code-clean"     "mcp__codescout__edit_code"   "$CLEAN_WT" "allow"
assert "create_file-clean"   "mcp__codescout__create_file" "$CLEAN_WT" "allow"

# --- Modern write tools in main repo (not a worktree) → ALLOW ---
assert "edit_code-mainrepo"  "mcp__codescout__edit_code"   "$SANDBOX/main-repo" "allow"

# --- Modern write tools outside any git repo → ALLOW ---
assert "edit_code-no-git"    "mcp__codescout__edit_code"   "$SANDBOX" "allow"

# --- Stale handles in pending worktree → ALLOW (case filters; pinned as
#     regression sentinel — if any of these flip to deny, the matcher or case
#     statement has re-acquired a stale handle and the substrate broke) ---
assert "stale-edit_markdown"    "mcp__codescout__edit_markdown"    "$PENDING_WT" "allow"
assert "stale-replace_symbol"   "mcp__codescout__replace_symbol"   "$PENDING_WT" "allow"
assert "stale-insert_code"      "mcp__codescout__insert_code"      "$PENDING_WT" "allow"
assert "stale-edit_lines"       "mcp__codescout__edit_lines"       "$PENDING_WT" "allow"
assert "stale-create_or_update" "mcp__github__create_or_update_file" "$PENDING_WT" "allow"

# assert_pin <label> <tool_name> <cwd> <workspace pin> <expected>
# A call pinned with workspace="<abs path>" names its own target. The guard only
# exists so a write cannot silently land in the wrong repo; a pin to THIS worktree
# cannot, so it must pass without `workspace(action="activate")` — activation is
# shared by every session of the codescout server, so concurrent subagents that
# activate their own worktrees race each other.
assert_pin() {
    local label="$1" tool="$2" cwd="$3" pin="$4" expected="$5"
    local input
    input=$(jq -n --arg t "$tool" --arg c "$cwd" --arg w "$pin" \
        '{tool_name:$t, cwd:$c, tool_input:{workspace:$w}}')
    local got
    got=$(verdict "$(echo "$input" | node "$HOOK")")
    if [ "$got" = "$expected" ]; then
        echo "PASS [$label]"
        PASS=$((PASS+1))
    else
        echo "FAIL [$label]: expected=$expected got=$got"
        FAIL=$((FAIL+1))
    fi
}

# --- A pin naming THIS worktree → ALLOW, whatever the write tool ---
assert_pin "edit_code-pin-self"      "mcp__codescout__edit_code"   "$PENDING_WT" "$PENDING_WT"  "allow"
assert_pin "edit_file-pin-self"      "mcp__codescout__edit_file"   "$PENDING_WT" "$PENDING_WT"  "allow"
assert_pin "create_file-pin-self"    "mcp__codescout__create_file" "$PENDING_WT" "$PENDING_WT"  "allow"
assert_pin "pin-self-trailing-slash" "mcp__codescout__edit_file"   "$PENDING_WT" "$PENDING_WT/" "allow"

# --- A pin naming ANOTHER tree, or nothing usable → still DENY ---
assert_pin "pin-main-repo"       "mcp__codescout__edit_file" "$PENDING_WT" "$SANDBOX/main-repo" "deny"
assert_pin "pin-sibling-worktree" "mcp__codescout__edit_file" "$PENDING_WT" "$CLEAN_WT"          "deny"
assert_pin "pin-empty"           "mcp__codescout__edit_file" "$PENDING_WT" ""                    "deny"
assert_pin "pin-relative"        "mcp__codescout__edit_file" "$PENDING_WT" "worktree-pending"    "deny"
assert_pin "pin-prefix-sibling"  "mcp__codescout__edit_file" "$PENDING_WT" "${PENDING_WT}-two"   "deny"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
