#!/usr/bin/env bash
# Test for worktree-activate.mjs — PostToolUse hook fired after EnterWorktree.
# Covers: (1) no-op when tool_name isn't EnterWorktree, (2) the injected
# additionalContext instructs index(action="build") in the worktree — added
# when worktree delta search made building the per-worktree delta index the
# one thing that makes semantic_search work there — and (3) the retired
# "Do NOT run index in worktrees" claim (true before that feature, false
# after) is gone for good.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/worktree-activate.mjs"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# --- Sandbox: real git repo + a linked worktree. HAS_CODESCOUT is forced via
#     the routing-config override (.claude/codescout-companion.json), not
#     this machine's real Claude Code config — deterministic, unlike the
#     machine-specific session-start.test.sh. ---
SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT

cd "$SANDBOX"
git init -q -b main main-repo
cd main-repo
git config user.email "test@test"
git config user.name "test"
git commit --allow-empty -q -m initial
git worktree add -q -b wt-branch ../wt >/dev/null
MAIN_REPO="$SANDBOX/main-repo"
WT="$SANDBOX/wt"

mkdir -p "$MAIN_REPO/.claude"
cat > "$MAIN_REPO/.claude/codescout-companion.json" <<'JSON'
{ "server_name": "cs" }
JSON

run_hook() {
  local input="$1"
  echo "$input" | node "$HOOK" 2>/dev/null
}

# --- 1. No-op when tool_name isn't EnterWorktree ---
OTHER_INPUT=$(jq -n --arg c "$MAIN_REPO" '{tool_name:"SomeOtherTool", cwd:$c}')
OTHER_OUT=$(run_hook "$OTHER_INPUT")
if [ -z "$OTHER_OUT" ]; then
  pass "non-EnterWorktree tool_name -> no output"
else
  fail "non-EnterWorktree tool_name should no-op, got: $OTHER_OUT"
fi

# --- 2/3. EnterWorktree -> additionalContext carries the new index guidance
#     and drops the retired 'Do NOT run index' claim ---
ENTER_INPUT=$(jq -n --arg c "$MAIN_REPO" --arg wt "$WT" \
  '{tool_name:"EnterWorktree", cwd:$c, tool_response:{worktree_path:$wt}}')
ENTER_OUT=$(run_hook "$ENTER_INPUT")
CTX=$(echo "$ENTER_OUT" | jq -r '.hookSpecificOutput.additionalContext // ""')

if [ -n "$CTX" ]; then
  pass "EnterWorktree -> additionalContext emitted"
else
  fail "EnterWorktree produced no additionalContext (got: $ENTER_OUT)"
fi

echo "$CTX" | grep -q 'workspace(action="activate"' \
  && pass 'additionalContext still names the workspace(action="activate") call' \
  || fail 'additionalContext missing the workspace(action="activate") instruction'

echo "$CTX" | grep -q 'index(action="build")' \
  && pass 'additionalContext instructs index(action="build") in the worktree' \
  || fail 'additionalContext missing the index(action="build") guidance'

echo "$CTX" | grep -q "not-yet-indexed hint" \
  && pass "additionalContext explains the not-yet-indexed-hint fallback" \
  || fail "additionalContext missing the not-yet-indexed-hint consequence"

if echo "$CTX" | grep -q "Do NOT run index"; then
  fail "retired 'Do NOT run index in worktrees' claim is still present"
else
  pass "retired 'Do NOT run index in worktrees' claim is gone"
fi

# Ordering: index(action="build") guidance must read AFTER the workspace()
# call, since index needs the workspace switched first.
WS_LINE=$(echo "$CTX" | grep -n 'workspace(action="activate"' | head -1 | cut -d: -f1)
IDX_LINE=$(echo "$CTX" | grep -n 'index(action="build")' | head -1 | cut -d: -f1)
if [ -n "${WS_LINE:-}" ] && [ -n "${IDX_LINE:-}" ] && [ "$IDX_LINE" -gt "$WS_LINE" ]; then
  pass 'index(action="build") guidance comes after workspace() in reading order'
else
  fail "index guidance is not ordered after workspace() (ws=${WS_LINE:-?} idx=${IDX_LINE:-?})"
fi

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
