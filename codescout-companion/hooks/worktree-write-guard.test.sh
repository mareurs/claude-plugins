#!/usr/bin/env bash
# Test for worktree-write-guard.sh — verifies coverage of modern codescout
# write tools (edit_code, edit_file, edit_markdown, create_file) and that
# stale handles (replace_symbol, insert_code, edit_lines,
# create_or_update_file) are correctly filtered OUT by the case statement.
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
assert "edit_markdown-pending" "mcp__codescout__edit_markdown" "$PENDING_WT" "deny"
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
assert "stale-replace_symbol"   "mcp__codescout__replace_symbol"   "$PENDING_WT" "allow"
assert "stale-insert_code"      "mcp__codescout__insert_code"      "$PENDING_WT" "allow"
assert "stale-edit_lines"       "mcp__codescout__edit_lines"       "$PENDING_WT" "allow"
assert "stale-create_or_update" "mcp__github__create_or_update_file" "$PENDING_WT" "allow"

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
