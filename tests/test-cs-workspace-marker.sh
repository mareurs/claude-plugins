#!/bin/bash
# tests/test-cs-workspace-marker.sh
# End-to-end tests for the codescout-active marker convention:
#   $CLAUDE_CONFIG_DIR/codescout-active/<session_id> contains one line: workspace path
# Written by: cs-activate-project.sh, worktree-activate.sh, session-start.sh (resumed-in-wt)
# Read by:    claude-statusline/bin/statusline.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── cs-workspace-marker ──"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

CFG="$TMP/cfg"
mkdir -p "$CFG"
export CLAUDE_CONFIG_DIR="$CFG"

MAIN="$TMP/main"
make_git_repo "$MAIN"
write_routing_config "$MAIN" '{"server_name":"codescout"}'
make_codescout_dir "$MAIN"
make_worktree "$MAIN" "$MAIN/.worktrees/feat"
# Routing config must also be reachable from the worktree's CWD for detect-tools
# to see codescout from inside a resumed-in-worktree session.
write_routing_config "$MAIN/.worktrees/feat" '{"server_name":"codescout"}'
WT="$MAIN/.worktrees/feat"

SID="test-session-abc"
MARKER="$CFG/codescout-active/$SID"

# === Hook 1: cs-activate-project.sh writes marker on workspace activation ===

cs_input() {
  local tool="$1"
  local sid="$2"
  local path="$3"
  printf '{"session_id":"%s","tool_name":"%s","tool_input":{"path":"%s"}}' \
    "$sid" "$tool" "$path"
}

rm -f "$MARKER"
cs_input "mcp__codescout__workspace" "$SID" "$WT" \
  | node "$HOOK_DIR/cs-activate-project.mjs" >/dev/null 2>&1
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$WT" ]; then
  pass "cs-activate-project: writes marker on workspace call"
else
  fail "cs-activate-project: writes marker on workspace call" "marker=$(cat "$MARKER" 2>/dev/null)"
fi

# Subsequent activation overwrites (last wins)
rm -f "$MARKER"
echo "$MAIN" > "$MARKER"
cs_input "mcp__codescout__workspace" "$SID" "$WT" \
  | node "$HOOK_DIR/cs-activate-project.mjs" >/dev/null 2>&1
if [ "$(cat "$MARKER")" = "$WT" ]; then
  pass "cs-activate-project: overwrites marker on re-activation"
else
  fail "cs-activate-project: overwrites marker on re-activation" "marker=$(cat "$MARKER")"
fi

# === Hook 2: worktree-activate.sh writes marker on EnterWorktree ===

wt_input() {
  local sid="$1"
  local cwd="$2"
  local wt_path="$3"
  printf '{"session_id":"%s","cwd":"%s","tool_name":"EnterWorktree","tool_response":{"worktree_path":"%s"}}' \
    "$sid" "$cwd" "$wt_path"
}

rm -f "$MARKER"
wt_input "$SID" "$MAIN" "$WT" \
  | node "$HOOK_DIR/worktree-activate.mjs" >/dev/null 2>&1
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$WT" ]; then
  pass "worktree-activate: writes marker on EnterWorktree"
else
  fail "worktree-activate: writes marker on EnterWorktree" "marker=$(cat "$MARKER" 2>/dev/null)"
fi

# === Hook 3: session-start.sh seeds marker ONLY when resumed inside a worktree ===

ss_input() {
  local sid="$1"
  local cwd="$2"
  printf '{"session_id":"%s","cwd":"%s","source":"resume"}' "$sid" "$cwd"
}

# Resumed in worktree → marker seeded
rm -f "$MARKER"
ss_input "$SID" "$WT" | bash "$HOOK_DIR/session-start.sh" >/dev/null 2>&1
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$WT" ]; then
  pass "session-start: seeds marker when CWD is inside a worktree"
else
  fail "session-start: seeds marker when CWD is inside a worktree" "marker=$(cat "$MARKER" 2>/dev/null)"
fi

# Resumed in main repo → marker NOT seeded (avoid false confirmation)
rm -f "$MARKER"
ss_input "$SID" "$MAIN" | bash "$HOOK_DIR/session-start.sh" >/dev/null 2>&1
if [ ! -f "$MARKER" ]; then
  pass "session-start: skips seed when CWD is main repo (no false confirmation)"
else
  fail "session-start: skips seed when CWD is main repo" "marker exists with: $(cat "$MARKER")"
fi

# === Hook 4: session-start.sh sweeps markers older than 7 days ===

mkdir -p "$CFG/codescout-active"
OLD="$CFG/codescout-active/stale-sid"
NEW="$CFG/codescout-active/fresh-sid"
echo "/some/path" > "$OLD"; touch -d '14 days ago' "$OLD"
echo "/some/path" > "$NEW"; touch -d '1 day ago' "$NEW"

ss_input "another-sid" "$MAIN" | bash "$HOOK_DIR/session-start.sh" >/dev/null 2>&1

if [ ! -f "$OLD" ] && [ -f "$NEW" ]; then
  pass "session-start: sweeps markers older than 7 days, keeps fresh"
else
  fail "session-start: sweeps markers older than 7 days" "old_exists=$([ -f "$OLD" ] && echo Y || echo N) new_exists=$([ -f "$NEW" ] && echo Y || echo N)"
fi

# === Statusline reads marker and prefixes branch with cs: ===

STATUSLINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../claude-statusline/bin" && pwd)/statusline.sh"

# Activate WT branch
git -C "$WT" checkout -q -B feat/gcp

# Write marker, then run statusline (cwd = main repo, would otherwise show main branch)
echo "$WT" > "$MARKER"
OUT=$(cd "$MAIN" && printf '%s' "{\"model\":{\"display_name\":\"m\"},\"session_id\":\"$SID\"}" | bash "$STATUSLINE" 2>/dev/null)
# Strip ANSI escape sequences for matching
OUT_PLAIN=$(printf '%s' "$OUT" | sed -E 's/\x1b\[[0-9;]*m//g')

if echo "$OUT_PLAIN" | grep -q "cs:feat/gcp"; then
  pass "statusline: reads marker, displays cs:<branch>"
else
  fail "statusline: reads marker, displays cs:<branch>" "$OUT_PLAIN"
fi

# Cleanup before next case
rm -f "$MARKER"

# No marker → fallback to current behavior (·Nwt warning, no cs: prefix)
OUT=$(cd "$MAIN" && printf '%s' "{\"model\":{\"display_name\":\"m\"},\"session_id\":\"$SID\"}" | bash "$STATUSLINE" 2>/dev/null)
if echo "$OUT" | grep -q "cs:"; then
  fail "statusline: no cs: prefix when marker absent" "$OUT"
else
  pass "statusline: no cs: prefix when marker absent"
fi

if echo "$OUT" | grep -qE '·[0-9]+wt'; then
  pass "statusline: keeps ·Nwt fallback when marker absent"
else
  fail "statusline: keeps ·Nwt fallback when marker absent" "$OUT"
fi

# Marker points at a removed worktree dir → silently fall back
echo "/tmp/does-not-exist-xxx" > "$MARKER"
OUT=$(cd "$MAIN" && printf '%s' "{\"model\":{\"display_name\":\"m\"},\"session_id\":\"$SID\"}" | bash "$STATUSLINE" 2>/dev/null)
if echo "$OUT" | grep -q "cs:"; then
  fail "statusline: stale marker (missing dir) falls back silently" "$OUT"
else
  pass "statusline: stale marker (missing dir) falls back silently"
fi

print_summary "cs-workspace-marker"
