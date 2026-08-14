#!/bin/bash
# tests/test-worktree-activate.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── worktree-activate ──"
HOOK="$HOOK_DIR/worktree-activate.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# Test 1: non-EnterWorktree tool → silent exit
OUT=$(printf '{"cwd":"%s","tool_name":"Bash","tool_response":{}}' "$T" | node "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "non-EnterWorktree: silent exit"; else fail "non-EnterWorktree: silent exit" "$OUT"; fi

# Test 2: EnterWorktree, no CE → silent exit
make_git_repo "$T/t2main"
make_worktree "$T/t2main" "$T/t2wt"
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{"worktree_path":"%s"}}' \
  "$T/t2main" "$T/t2wt" | CLAUDE_CONFIG_DIR="$T/empty" node "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "no CE: silent exit"; else fail "no CE: silent exit" "$OUT"; fi

# Test 3: EnterWorktree with worktree_path → marker created, guidance injected, symlink exists
make_git_repo "$T/t3main"
write_mcp_json "$T/t3main"
make_ce_dir "$T/t3main"
make_worktree "$T/t3main" "$T/t3wt"
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{"worktree_path":"%s"}}' \
  "$T/t3main" "$T/t3wt" | node "$HOOK" 2>/dev/null)
MARKER_OK=false; GUIDANCE_OK=false; SYMLINK_OK=false
[ -f "$T/t3wt/.cs-worktree-pending" ] && MARKER_OK=true
assert_context_contains "$OUT" "workspace(" && GUIDANCE_OK=true
[ -L "$T/t3wt/.codescout" ] && SYMLINK_OK=true
if $MARKER_OK && $GUIDANCE_OK && $SYMLINK_OK; then
  pass "EnterWorktree with path: marker+guidance+symlink"
else
  fail "EnterWorktree with path: marker+guidance+symlink" \
    "marker=$MARKER_OK guidance=$GUIDANCE_OK symlink=$SYMLINK_OK"
fi

# Test 4: EnterWorktree without worktree_path → fallback detection
make_git_repo "$T/t4main"
write_mcp_json "$T/t4main"
make_ce_dir "$T/t4main"
make_worktree "$T/t4main" "$T/t4wt"
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{}}' \
  "$T/t4main" | node "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "workspace(" && [ -f "$T/t4wt/.cs-worktree-pending" ]; then
  pass "EnterWorktree fallback detection: marker+guidance"
else
  fail "EnterWorktree fallback detection: marker+guidance" \
    "marker=$(ls "$T/t4wt/.cs-worktree-pending" 2>/dev/null || echo missing) ctx=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -2)"
fi

# Test 5: EnterWorktree, worktree has real .codescout/ dir → embeddings symlink created
make_git_repo "$T/t5main"
write_mcp_json "$T/t5main"
make_codescout_dir "$T/t5main"
make_embeddings_dir "$T/t5main"
make_worktree "$T/t5main" "$T/t5wt"
mkdir -p "$T/t5wt/.codescout"
echo '[project]' > "$T/t5wt/.codescout/project.toml"
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{"worktree_path":"%s"}}' \
  "$T/t5main" "$T/t5wt" | node "$HOOK" 2>/dev/null)
if [ -L "$T/t5wt/.codescout/embeddings" ]; then
  pass "EnterWorktree real .codescout/: embeddings symlink created"
else
  fail "EnterWorktree real .codescout/: embeddings symlink created" \
    "$(ls -la "$T/t5wt/.codescout/" 2>/dev/null)"
fi

# Test 6: EnterWorktree, real .codescout/, embeddings missing from main → no symlink
make_git_repo "$T/t6main"
write_mcp_json "$T/t6main"
make_codescout_dir "$T/t6main"
# intentionally no make_embeddings_dir
make_worktree "$T/t6main" "$T/t6wt"
mkdir -p "$T/t6wt/.codescout"
echo '[project]' > "$T/t6wt/.codescout/project.toml"
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{"worktree_path":"%s"}}' \
  "$T/t6main" "$T/t6wt" | node "$HOOK" 2>/dev/null)
if [ ! -e "$T/t6wt/.codescout/embeddings" ]; then
  pass "EnterWorktree real .codescout/, no embeddings in main: no symlink"
else
  fail "EnterWorktree real .codescout/, no embeddings in main: no symlink" \
    "unexpected: $(ls -la "$T/t6wt/.codescout/embeddings" 2>/dev/null)"
fi

# Test 7: additionalContext instructs index(action="build") in the worktree
# (worktree delta search made building the per-worktree delta index the one
# thing that makes semantic_search work there), the guidance reads AFTER
# workspace() since index needs the workspace switched first, and the
# retired "Do NOT run index in worktrees" claim (true before that feature,
# false after) is gone for good.
make_git_repo "$T/t7main"
write_mcp_json "$T/t7main"
make_ce_dir "$T/t7main"
make_worktree "$T/t7main" "$T/t7wt"
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{"worktree_path":"%s"}}' \
  "$T/t7main" "$T/t7wt" | node "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)

if assert_context_contains "$OUT" 'index(action="build")'; then
  pass "additionalContext instructs index(action=\"build\") in the worktree"
else
  fail "additionalContext instructs index(action=\"build\") in the worktree" "$CTX"
fi

if echo "$CTX" | grep -q "Do NOT run index"; then
  fail "retired 'Do NOT run index in worktrees' claim is still present" "$CTX"
else
  pass "retired 'Do NOT run index in worktrees' claim is gone"
fi

# Ordering must fail on an absent line (grep -n yields nothing → empty guard),
# not merely compare empty strings.
WS_LINE=$(echo "$CTX" | grep -n 'workspace(action="activate"' | head -1 | cut -d: -f1)
IDX_LINE=$(echo "$CTX" | grep -n 'index(action="build")' | head -1 | cut -d: -f1)
if [ -n "${WS_LINE:-}" ] && [ -n "${IDX_LINE:-}" ] && [ "$IDX_LINE" -gt "$WS_LINE" ]; then
  pass 'index(action="build") guidance comes after workspace() in reading order'
else
  fail "index guidance is not ordered after workspace()" "ws=${WS_LINE:-?} idx=${IDX_LINE:-?}"
fi

print_summary "worktree-activate"
