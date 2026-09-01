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
  local _rc
  printf '{"cwd":"%s","agent_type":"%s","agent_id":"a1","session_id":"s1"}' "$1" "$2" \
    | HOME="$T" CLAUDE_CONFIG_DIR="$T/empty" node "$HOOK" 2>/dev/null
  _rc=$?
  return $_rc
}

# --- Exclusions. Gate is OPEN, so silence proves the exclusion, not the gate. ---
for at in Bash statusline-setup claude-code-guide; do
  OUT=$(run_hook "$T/proj" "$at")
  RC=$?
  if assert_no_output "$OUT"; then pass "$at agent: silent exit"
  else fail "$at agent: silent exit" "$OUT"; fi
  if check_rc "$RC"; then pass "$at agent: exits 0"
  else fail "$at agent: exits 0" "rc=$RC"; fi
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
RC=$?
if assert_no_output "$OUT"; then pass "gate closed: silent exit"
else fail "gate closed: silent exit" "$OUT"; fi
if check_rc "$RC"; then pass "gate closed: exits 0"
else fail "gate closed: exits 0" "rc=$RC"; fi

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
# --- Pin the verb, not just the two substrings separately: "PROJECT BOOTSTRAP:"
# --- and path="$PROJ_ROOT" are asserted above but are free to land on
# --- different tool calls with a different action= (e.g. action="reset")
# --- and still pass both. Assert the call as one contiguous substring.
if assert_context_contains "$OUT" "workspace(action=\"activate\", path=\"$PROJ_ROOT\")"; then
  pass "bootstrap: pins the activate verb"
else fail "bootstrap: pins the activate verb" "$OUT"; fi
if assert_context_contains "$OUT" "if your task names a different project root"; then
  pass "bootstrap: exception wording present"
else fail "bootstrap: exception wording present" "$OUT"; fi

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


# --- Memories present → names inlined, no list round-trip. Assert on
# --- "patterns", NOT "arch": "arch" is a substring of "architecture" which the
# --- fallback bullet itself contains, so it would not discriminate.
# --- Dedicated fixture ($T/mem), not $T/proj: $T/proj is read by earlier
# --- assertions (bootstrap paragraph, subdir cwd, worktree) and mutating it
# --- here would make those order-dependent on this block running after them.
make_git_repo "$T/mem"
write_routing_config "$T/mem" '{"server_name":"codescout"}'
make_memories "$T/mem"
OUT=$(run_hook "$T/mem" "general-purpose")
if assert_context_contains "$OUT" "Memory topics available here:"; then
  pass "memories: inline header present"
else fail "memories: inline header present" "$OUT"; fi
if assert_context_contains "$OUT" "patterns"; then
  pass "memories: names the topics"
else fail "memories: names the topics" "$OUT"; fi
if assert_context_contains "$OUT" "patterns.md"; then
  fail "memories: must strip the .md extension" "$OUT"
else pass "memories: strips the .md extension"; fi
# --- The literal substring memory(action="list") is REQUIRED in the fallback
# --- branch and FORBIDDEN in the inline branch, so asserting on that literal
# --- is a tripwire in both directions (any rewording of either branch's
# --- "don't call list" phrasing evades a substring check trivially). Assert
# --- instead on the fallback bullet's own distinctive phrase, which is unique
# --- to that branch and appears nowhere in the inline bullet: this tests that
# --- the inline bullet REPLACED the fallback rather than being appended
# --- alongside it, which is the behavior that actually matters here.
if assert_context_contains "$OUT" "then read the topics matching your task"; then
  fail "memories: inline bullet must replace the fallback, not append to it" "$OUT"
else pass "memories: inline bullet replaces the fallback"; fi

# --- No memories → fallback to today's wording verbatim. $T/nomem is a separate
# --- fixture so the memories written above cannot leak into it.
make_git_repo "$T/nomem"
write_routing_config "$T/nomem" '{"server_name":"codescout"}'
OUT=$(run_hook "$T/nomem" "general-purpose")
if assert_context_contains "$OUT" 'memory(action="list")'; then
  pass "no memories: falls back to list"
else fail "no memories: falls back to list" "$OUT"; fi
if assert_context_contains "$OUT" "Memory topics available here:"; then
  fail "no memories: must NOT emit the inline header" "$OUT"
else pass "no memories: no inline header"; fi
# --- Pin the sentinel phrase at its source. The "memories: inline bullet
# --- replaces the fallback" case above depends on "then read the topics
# --- matching your task" being unique to the fallback bullet, but nothing
# --- asserted that phrase is actually PRESENT there — a fallback reword
# --- could silently disarm that other assertion. Assert it here, on the
# --- fallback branch itself.
if assert_context_contains "$OUT" "then read the topics matching your task"; then
  pass "no memories: fallback sentinel phrase present"
else fail "no memories: fallback sentinel phrase present" "$OUT"; fi

# --- Empty memories dir → also fallback. Exercises HAS_CS_MEMORIES' computation
# --- rather than only the missing-directory path.
make_git_repo "$T/emptymem"
write_routing_config "$T/emptymem" '{"server_name":"codescout"}'
mkdir -p "$T/emptymem/.codescout/memories"
OUT=$(run_hook "$T/emptymem" "general-purpose")
if assert_context_contains "$OUT" 'memory(action="list")'; then
  pass "empty memories dir: falls back to list"
else fail "empty memories dir: falls back to list" "$OUT"; fi
if assert_context_contains "$OUT" "Memory topics available here:"; then
  fail "empty memories dir: must NOT emit the inline header" "$OUT"
else pass "empty memories dir: no inline header"; fi

# --- Whitespace-only memory name → the trim guard must still fall back.
# --- A memory file named " .md" (one leading space, then the extension)
# --- makes detect.mjs report HAS_CS_MEMORIES=true with CS_MEMORY_NAMES=" "
# --- (name.slice(0,-3) of " .md" is a single space) -- non-empty as a raw
# --- string, so an untrimmed guard would take the inline branch and render
# --- a degenerate header with no topic names. Covers the trim guard in
# --- subagent-guidance.mjs, which had zero test coverage before this case.
make_git_repo "$T/whitespacemem"
write_routing_config "$T/whitespacemem" '{"server_name":"codescout"}'
mkdir -p "$T/whitespacemem/.codescout/memories"
echo "# space" > "$T/whitespacemem/.codescout/memories/ .md"
OUT=$(run_hook "$T/whitespacemem" "general-purpose")
if assert_context_contains "$OUT" 'memory(action="list")'; then
  pass "whitespace-only memory name: falls back to list"
else fail "whitespace-only memory name: falls back to list" "$OUT"; fi
if assert_context_contains "$OUT" "Memory topics available here:"; then
  fail "whitespace-only memory name: must NOT emit the inline header" "$OUT"
else pass "whitespace-only memory name: no inline header"; fi

# --- Non-git cwd → the `|| cwd` fallback. Every fixture above is a git repo,
# --- so root always resolved via `git rev-parse --show-toplevel`; a plain
# --- directory (no make_git_repo) exercises the fallback branch instead.
# --- HAS_CODESCOUT is decided purely by the routing config (findRoutingConfig
# --- reads .claude/codescout-companion.json off cwd, no git involved — see
# --- detect.mjs), so a subagent dispatched into a non-git cwd with
# --- user-level codescout config is a normal, reachable case, not a fixture
# --- artifact.
mkdir -p "$T/nogit"
write_routing_config "$T/nogit" '{"server_name":"codescout"}'
OUT=$(run_hook "$T/nogit" "general-purpose")
if assert_context_contains "$OUT" "PROJECT BOOTSTRAP:"; then
  pass "non-git cwd: bootstrap still fires"
else fail "non-git cwd: bootstrap still fires" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$T/nogit\""; then
  pass "non-git cwd: names the cwd itself"
else fail "non-git cwd: names the cwd itself" "$OUT"; fi

# --- Output budget. The hook injects the project system-prompt VERBATIM (it is the
# --- only channel that reaches subagents at all — server_instructions do not, per
# --- claude-code#29655), so its payload grows with a user-editable file that
# --- onboarding() rewrites. CC replaces hook output over its inline cap with a ~2 KB
# --- preview and a bare filesystem path, which for a subagent brief means the
# --- briefing silently stops arriving. Measured 2026-09-01: 7,687 B emitted against a
# --- 4,869 B system-prompt, so roughly 2,800 B is fixed overhead and the rest tracks
# --- the file.
# ---
# --- This is a TRIPWIRE, not a fix. There is no spill here on purpose: the payload
# --- fits today, and making every subagent pay a Read round-trip to dodge a cap it
# --- does not hit would be premature. What was missing is anything that notices the
# --- approach. 12000 is the same budget buddy's reload path uses
# --- (buddy/scripts/reload.py INLINE_CAP) and sits below every truncation observed
# --- across 130,958 hook-output samples.
# ---
# --- If this fails: shrink .codescout/system-prompt.md, or port the spill pattern
# --- from buddy/scripts/buddy_paths.py::spill_to_session_dir. Do NOT just raise the
# --- number — the cap is CC's, not ours.
# --- See docs/issues/2026-09-01-reload-block-inlines-45kb-over-the-hook-stdout-cap.md
SP="$T/proj/.codescout/system-prompt.md"
mkdir -p "$(dirname "$SP")"
# A realistic system-prompt, sized to the live one (4,869 B on 2026-09-01).
head -c 4900 /dev/zero | tr '\0' 'x' > "$SP"
OUT=$(run_hook "$T/proj" "general-purpose")
BYTES=${#OUT}
if [ "$BYTES" -gt 0 ] && [ "$BYTES" -lt 12000 ]; then
  pass "output budget: ${BYTES} B, under the 12000 B cap"
else
  fail "output budget" "emitted ${BYTES} B (want 0 < n < 12000; empty means the hook went silent and the bound proves nothing)"
fi

# And the guard must actually be reachable: an oversized system-prompt has to push
# it over. Without this, the assertion above passes in a world where the
# system-prompt is never injected at all.
head -c 20000 /dev/zero | tr '\0' 'y' > "$SP"
OUT=$(run_hook "$T/proj" "general-purpose")
if [ "${#OUT}" -gt 12000 ]; then
  pass "output budget: tripwire is reachable (20 KB prompt -> ${#OUT} B)"
else
  fail "output budget tripwire" "a 20 KB system-prompt produced only ${#OUT} B — the prompt is not being injected, so the budget check above is vacuous"
fi
rm -f "$SP"

print_summary "subagent-guidance"
