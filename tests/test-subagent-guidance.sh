#!/bin/bash
# tests/test-subagent-guidance.sh
#
# Gate control is per-project + environment-sealed:
#   OPEN  → write_routing_config with an explicit server_name
#   CLOSE → seal HOME + CLAUDE_CONFIG_DIR, write no routing config
# Do NOT use write_mcp_json to open the gate: detect.mjs matches /codescout/
# against the server command/args, and that fixture's command is <dir>/fake-ce,
# so it leaves HAS_CODESCOUT=false. Every invocation seals HOME and
# CLAUDE_CONFIG_DIR — an unsealed call reads the developer's real config and
# passes on a configured box while failing on CI.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── subagent-guidance ──"
HOOK="$HOOK_DIR/subagent-guidance.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/empty"

# Gate OPEN for $T/proj.
make_git_repo "$T/proj"
write_routing_config "$T/proj" '{"server_name":"codescout"}'

# Gate CLOSED for $T/bare (git repo, no routing config).
make_git_repo "$T/bare"

# run_hook <cwd> <agent_type> → raw stdout, env sealed so only the fixture decides.
run_hook() {
  printf '{"cwd":"%s","agent_type":"%s","agent_id":"a1","session_id":"s1"}' "$1" "$2" \
    | HOME="$T" CLAUDE_CONFIG_DIR="$T/empty" node "$HOOK" 2>/dev/null
}

# --- Exclusions. Gate is OPEN, so silence proves the exclusion, not the gate. ---
for at in Bash statusline-setup claude-code-guide; do
  OUT=$(run_hook "$T/proj" "$at")
  if assert_no_output "$OUT"; then pass "$at agent: silent exit"
  else fail "$at agent: silent exit" "$OUT"; fi
done

# --- Positive control: without it, every exclusion case above could pass by
# --- the hook being globally silent.
OUT=$(run_hook "$T/proj" "general-purpose")
if [ -n "$OUT" ]; then pass "general-purpose + gate open: emits"
else fail "general-purpose + gate open: emits" "(empty)"; fi
if assert_context_contains "$OUT" "codescout EXPLORATION PROTOCOL"; then
  pass "emits the exploration protocol"
else fail "emits the exploration protocol" "$OUT"; fi
if assert_context_contains "$OUT" "CODESCOUT RULES"; then
  pass "emits the codescout rules"
else fail "emits the codescout rules" "$OUT"; fi

# --- Gate CLOSED → silent, with the environment sealed (not ambient config). ---
OUT=$(run_hook "$T/bare" "general-purpose")
if assert_no_output "$OUT"; then pass "gate closed: silent exit"
else fail "gate closed: silent exit" "$OUT"; fi

# --- System prompt appended verbatim (gate open). ---
make_system_prompt "$T/proj"
OUT=$(run_hook "$T/proj" "general-purpose")
if assert_context_contains "$OUT" "SYSTEM PROMPT CONTENT"; then
  pass "system prompt appended"
else fail "system prompt appended" "$OUT"; fi

# --- Bootstrap paragraph. $T/proj is a git repo, so root == its toplevel. ---
PROJ_ROOT=$(git -C "$T/proj" rev-parse --show-toplevel)
OUT=$(run_hook "$T/proj" "general-purpose")
if assert_context_contains "$OUT" "PROJECT BOOTSTRAP:"; then
  pass "bootstrap: marker present"
else fail "bootstrap: marker present" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$PROJ_ROOT\""; then
  pass "bootstrap: names the project root"
else fail "bootstrap: names the project root" "$OUT"; fi
if assert_context_contains "$OUT" "unless the task below names a different project root"; then
  pass "bootstrap: soft-conditional wording present"
else fail "bootstrap: soft-conditional wording present" "$OUT"; fi

# --- cwd is a SUBDIRECTORY → must name the toplevel, not the subdir. A subdir
# --- path would not match .cs-worktree-pending's location and so would never
# --- release worktree-write-guard.
mkdir -p "$T/proj/nested/deeper"
# detect.mjs's routing-config lookup checks cwd ONLY, no upward search (see
# findRoutingConfig in detect.mjs) — so the subdir needs its own routing
# config or the gate is CLOSED and the hook exits silently before our root
# resolution ever runs, making this case vacuous instead of exercising it.
write_routing_config "$T/proj/nested/deeper" '{"server_name":"codescout"}'
OUT=$(run_hook "$T/proj/nested/deeper" "general-purpose")
if assert_context_contains "$OUT" "path=\"$PROJ_ROOT\""; then
  pass "subdir cwd: names repo toplevel"
else fail "subdir cwd: names repo toplevel" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$T/proj/nested/deeper\""; then
  fail "subdir cwd: must NOT name the subdir" "$OUT"
else pass "subdir cwd: does not name the subdir"; fi

# --- Worktree cwd → fires, and names the WORKTREE root, not the main repo.
# --- The worktree needs its own routing config: detect reads it from cwd.
make_worktree "$T/proj" "$T/wt"
write_routing_config "$T/wt" '{"server_name":"codescout"}'
WT_ROOT=$(git -C "$T/wt" rev-parse --show-toplevel)
OUT=$(run_hook "$T/wt" "general-purpose")
if assert_context_contains "$OUT" "PROJECT BOOTSTRAP:"; then
  pass "worktree: bootstrap fires"
else fail "worktree: bootstrap fires" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$WT_ROOT\""; then
  pass "worktree: names the worktree root"
else fail "worktree: names the worktree root" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$PROJ_ROOT\""; then
  fail "worktree: must NOT name the main repo" "$OUT"
else pass "worktree: does not name the main repo"; fi

print_summary "subagent-guidance"
