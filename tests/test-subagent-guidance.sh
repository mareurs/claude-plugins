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
if assert_context_contains "$OUT" "STEP 1 — load the tools"; then
  pass "emits the tool-loading step"
else fail "emits the tool-loading step" "$OUT"; fi
# The failure this guards: codescout tools are DEFERRED in a subagent, the deny text
# names tools the subagent cannot call, and nothing said to load them. 2026-11-23,
# session 0bed4486, agent a34a924618101b62e: six denied Reads, then a lost draft.
if assert_context_contains "$OUT" "ONE ToolSearch call: select:mcp__codescout__symbols" \
  && assert_context_contains "$OUT" "mcp__codescout__get_guide"; then
  pass "tools: names the ToolSearch call that loads them, get_guide included"
else fail "tools: names the ToolSearch call that loads them" "$OUT"; fi
if assert_context_contains "$OUT" "even when your brief names only Read and Write"; then
  pass "tools: overrides a brief that names only native tools"
else fail "tools: overrides a brief that names only native tools" "$OUT"; fi
if assert_context_contains "$OUT" "STEP 3 — pick the tool by what you do"; then
  pass "emits the capability map by intent"
else fail "emits the capability map by intent" "$OUT"; fi
for cap in "edit_code" "edit_file" "create_file" "run_command" "semantic_search" "references(symbol, path)"; do
  if assert_context_contains "$OUT" "$cap"; then pass "capability map names $cap"
  else fail "capability map names $cap" "$OUT"; fi
done
if assert_context_contains "$OUT" "run a long command in the foreground with timeout_secs"; then
  pass "run: says no wake reaches a subagent"
else fail "run: says no wake reaches a subagent" "$OUT"; fi

# --- Guides: a subagent must be told to FETCH them, never that it already has
# --- them. Its parent's brief may say "already loaded" (true of the parent's
# --- context, false of the subagent's), and the guide-hint ledger is shared
# --- parent<->subagent so the auto-inject is suppressed for it too. This hook is
# --- the only channel that can override both. Regression guard for that class.
if assert_context_contains "$OUT" "CALL get_guide on it"; then
  pass "guides: directs an explicit get_guide fetch"
else fail "guides: directs an explicit get_guide fetch" "$OUT"; fi
if assert_context_contains "$OUT" "already loaded"; then
  pass "guides: overrides an 'already loaded' brief"
else fail "guides: overrides an 'already loaded' brief" "$OUT"; fi
if assert_context_contains "$OUT" "true of your parent's context, not yours"; then
  pass "guides: says an 'already loaded' claim is the parent's, not the subagent's"
else fail "guides: says an 'already loaded' claim is the parent's, not the subagent's" "$OUT"; fi

# --- The topic list and the bug-ledger statuses must match the session opener
# --- (codescout `project-activation-bootstrap`): a subagent that reads only this hook gets the
# --- same contract. Two drifts seen on 2026-11-12: `untrusted-content` was missing from the
# --- topic list, and `investigating` and `zombie` were filtered on but never explained.
if assert_context_contains "$OUT" "tracker-conventions, untrusted-content)"; then
  pass "guides: the topic list names untrusted-content"
else fail "guides: the topic list names untrusted-content" "$OUT"; fi
if assert_context_contains "$OUT" "\"investigating\" (no live owner)" && assert_context_contains "$OUT" "\"zombie\" (a recurrence check, not a task)"; then
  pass "bug ledger: explains investigating and zombie"
else fail "bug ledger: explains investigating and zombie" "$OUT"; fi

# --- A project that keeps its bugs in a bugs box (docs/trackers/ledgers/bugs/readme.md): the entries are
# --- catalog kind `entry`, so the old `doc find kind="bug"` query returns nothing for it (measured
# --- 2026-11-24, claude-plugins after the bug migration: 0 items, 3 live bugs). It must be told the
# --- box verb instead, with the same status meanings. A project without the box keeps the old query.
if assert_context_contains "$OUT" "kind=\"bug\"" && ! assert_context_contains "$OUT" "codescout box bugs"; then
  pass "bug ledger: a project without a bugs box keeps the doc find query"
else fail "bug ledger: a project without a bugs box keeps the doc find query" "$OUT"; fi
make_git_repo "$T/boxproj"
write_routing_config "$T/boxproj" '{"server_name":"codescout"}'
mkdir -p "$T/boxproj/docs/trackers/ledgers/bugs"
printf -- '---\nkind: collection\ntitle: Bugs\n---\n' > "$T/boxproj/docs/trackers/ledgers/bugs/readme.md"
OUTB=$(run_hook "$T/boxproj" "general-purpose")
if assert_context_contains "$OUTB" "codescout box bugs list" && ! assert_context_contains "$OUTB" "kind=\"bug\""; then
  pass "bug ledger: a project with a bugs box is sent to codescout box bugs list, not to kind=bug"
else fail "bug ledger: a project with a bugs box is sent to codescout box bugs list" "$OUTB"; fi
if assert_context_contains "$OUTB" "\"investigating\" (no live owner)" && assert_context_contains "$OUTB" "\"zombie\" (a recurrence check, not a task)" \
  && assert_context_contains "$OUTB" "Ledger checked:"; then
  pass "bug ledger (box): keeps the status meanings and the Ledger checked line"
else fail "bug ledger (box): keeps the status meanings and the Ledger checked line" "$OUTB"; fi

# --- Gate CLOSED → silent, with the environment sealed (not ambient config). ---
OUT=$(run_hook "$T/bare" "general-purpose")
RC=$?
if assert_no_output "$OUT"; then pass "gate closed: silent exit"
else fail "gate closed: silent exit" "$OUT"; fi
if check_rc "$RC"; then pass "gate closed: exits 0"
else fail "gate closed: exits 0" "rc=$RC"; fi

# --- System prompt: a POINTER, never the text (gate open). The payload used to carry
# --- the file verbatim and went over Claude Code's ~10 KB inline cap on 27% of
# --- subagent starts (measured 2026-11-23), so the routing rules never arrived.
make_system_prompt "$T/proj"
OUT=$(run_hook "$T/proj" "general-purpose")
if assert_context_contains "$OUT" "SYSTEM PROMPT CONTENT"; then
  fail "system prompt: must NOT be inlined" "$OUT"
else pass "system prompt: not inlined"; fi
if assert_context_contains "$OUT" 'read_file(path=".codescout/system-prompt.md")'; then
  pass "system prompt: pointer names the file"
else fail "system prompt: pointer names the file" "$OUT"; fi
# No system prompt on disk → no pointer to a file that is not there. Positive control
# first: the same fixture must emit, or the absence below proves nothing.
make_git_repo "$T/nosp"
write_routing_config "$T/nosp" '{"server_name":"codescout"}'
OUT=$(run_hook "$T/nosp" "general-purpose")
if [ -n "$OUT" ] && assert_context_contains "$OUT" "STEP 1 — load the tools"; then
  pass "no system prompt: fixture still emits"
else fail "no system prompt: fixture still emits" "(empty or no STEP 1)"; fi
if assert_context_contains "$OUT" "system-prompt.md"; then
  fail "no system prompt: must NOT point at one" "$OUT"
else pass "no system prompt: no pointer"; fi

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
if assert_context_contains "$OUT" "workspace=\"$WT_ROOT\""; then
  pass "worktree: pins the worktree root"
else fail "worktree: pins the worktree root" "$OUT"; fi
# A worktree subagent must not be told to activate: activation is shared by every
# session of the codescout server, so parallel subagents that each activate their
# own worktree race each other (10 subagents, 10 worktrees, 3.9 s). The write guard
# accepts a write pinned to its own worktree, so a pin is all it needs.
if assert_context_contains "$OUT" "workspace(action=\"activate\", path="; then
  fail "worktree: must NOT tell the subagent to activate" "$OUT"
else pass "worktree: does not tell the subagent to activate"; fi
if assert_context_contains "$OUT" "edit_code, edit_file, create_file"; then
  pass "worktree: the pin covers the write tools"
else fail "worktree: the pin covers the write tools" "$OUT"; fi
if assert_context_contains "$OUT" "path=\"$PROJ_ROOT\""; then
  fail "worktree: must NOT name the main repo" "$OUT"
else pass "worktree: does not name the main repo"; fi

# --- A SUBDIRECTORY of the worktree pins the toplevel, never the raw cwd.
mkdir -p "$T/wt/sub/dir"
write_routing_config "$T/wt/sub/dir" '{"server_name":"codescout"}'
OUT=$(run_hook "$T/wt/sub/dir" "general-purpose")
if assert_context_contains "$OUT" "workspace=\"$WT_ROOT\""; then
  pass "worktree subdir: pins the toplevel"
else fail "worktree subdir: pins the toplevel" "$OUT"; fi
if assert_context_contains "$OUT" "workspace=\"$T/wt/sub/dir\""; then
  fail "worktree subdir: must NOT pin the raw cwd" "$OUT"
else pass "worktree subdir: does not pin the raw cwd"; fi


# --- Memories present → a COUNT, not the names. The names used to be inlined (2 KB on
# --- a 40-memory project) and the subagent still had to read the ones it needed.
# --- Assert on "patterns", NOT "arch": "arch" is a substring of "architecture" which
# --- the bullet itself contains, so it would not discriminate.
# --- Dedicated fixture ($T/mem), not $T/proj: $T/proj is read by earlier
# --- assertions (bootstrap paragraph, subdir cwd, worktree) and mutating it
# --- here would make those order-dependent on this block running after them.
make_git_repo "$T/mem"
write_routing_config "$T/mem" '{"server_name":"codescout"}'
make_memories "$T/mem"
OUT=$(run_hook "$T/mem" "general-purpose")
if assert_context_contains "$OUT" "project memories exist: memory(action=\"list\")"; then
  pass "memories: states a count and the list call"
else fail "memories: states a count and the list call" "$OUT"; fi
if assert_context_contains "$OUT" "patterns"; then
  fail "memories: must NOT inline the topic names" "$OUT"
else pass "memories: topic names are not inlined"; fi
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
if assert_context_contains "$OUT" "project memories exist"; then
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
if assert_context_contains "$OUT" "project memories exist"; then
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
if assert_context_contains "$OUT" "project memories exist"; then
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

# --- Output budget. Claude Code replaces a hook payload of about 10 KB or more with a
# --- ~2 KB preview and a bare file path. Measured 2026-11-23 over 1,959 SubagentStart
# --- payloads: 536 (27%) were replaced; the largest inline one was 10,076 chars and the
# --- smallest replaced one 9.8 KB. For a subagent that means the briefing silently stops
# --- arriving. The old hook injected the system-prompt verbatim plus every memory name
# --- (12.2 KB on the codescout repo), and its test used a 12,000 B cap, which sat ABOVE
# --- the real cap and so could not fail where it mattered.
# ---
# --- The payload is now a pointer, so its size must NOT depend on any file the user
# --- edits. Two assertions: a hard cap far under CC's, and independence from the inputs.
# --- If this fails, a file's TEXT is being copied into the payload: point at it instead.
# --- See docs/issues/archive/2026-09-01-reload-block-inlines-45kb-over-the-hook-stdout-cap.md
SP="$T/proj/.codescout/system-prompt.md"
mkdir -p "$(dirname "$SP")"
head -c 4900 /dev/zero | tr '\0' 'x' > "$SP"
OUT_SMALL=$(run_hook "$T/proj" "general-purpose")
BYTES_SMALL=${#OUT_SMALL}
if [ "$BYTES_SMALL" -gt 0 ] && [ "$BYTES_SMALL" -lt 5000 ]; then
  pass "output budget: ${BYTES_SMALL} B, under the 5000 B cap (CC cuts at about 10000)"
else
  fail "output budget" "emitted ${BYTES_SMALL} B (want 0 < n < 5000; empty means the hook went silent and the bound proves nothing)"
fi

# Independence: a 20 KB system-prompt and 60 memories must not move the size by more than
# the few bytes a larger memory COUNT adds. A payload that copies either file fails here.
head -c 20000 /dev/zero | tr '\0' 'y' > "$SP"
mkdir -p "$T/proj/.codescout/memories"
for i in $(seq 1 60); do echo "# m$i" > "$T/proj/.codescout/memories/memory-topic-number-$i.md"; done
OUT_BIG=$(run_hook "$T/proj" "general-purpose")
BYTES_BIG=${#OUT_BIG}
DELTA=$((BYTES_BIG - BYTES_SMALL))
if [ "$BYTES_BIG" -gt 0 ] && [ "$DELTA" -lt 100 ]; then
  pass "output budget: independent of the prompt file and memory list (${BYTES_SMALL} B -> ${BYTES_BIG} B)"
else
  fail "output budget: independence" "a 20 KB prompt and 60 memories moved the payload ${BYTES_SMALL} B -> ${BYTES_BIG} B (delta ${DELTA}); a file's text is being copied in"
fi
# Positive control for the memory count: the 60 memories must be SEEN, or the delta
# above says nothing about memories.
if assert_context_contains "$OUT_BIG" "60 project memories exist"; then
  pass "output budget: the 60-memory fixture was read (count shown)"
else fail "output budget: the 60-memory fixture was read" "no '60 project memories exist' in the payload"; fi
rm -f "$SP"
rm -rf "$T/proj/.codescout/memories"

print_summary "subagent-guidance"
