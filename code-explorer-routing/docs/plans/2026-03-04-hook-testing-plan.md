# Hook Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a plain-bash test suite that exercises all 6 hook scripts with real fixture filesystem state (temp git repos, real worktrees) so we can catch regressions before pushing.

**Architecture:** `tests/lib/fixtures.sh` provides shared helpers. One test script per hook. `tests/run-all.sh` aggregates results. Each hook is tested by piping crafted JSON to the script and asserting on stdout JSON + filesystem side effects.

**Tech Stack:** bash, jq, git, sqlite3 (all already required by the hooks)

---

## Key Concepts

### How hooks work (read this first)
All hooks read JSON from stdin, write JSON to stdout, exit 0.

```
echo '{"cwd":"/path","tool_name":"Read","tool_input":{"file_path":"/path/file.ts"}}' \
  | bash code-explorer-routing/hooks/pre-tool-guard.sh
```

Output for a **deny**:
```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
```

Output for **context injection** (SessionStart, etc.):
```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
```

**Silent exit** (hook is a no-op): empty stdout, exit 0.

### How `detect-tools.sh` finds CE
1. `.claude/code-explorer-routing.json` with `server_name` override
2. `${CWD}/.mcp.json` — checked against `cwd` from the JSON input
3. `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json` — user-level fallback

**For "no CE" tests:** set `CLAUDE_CONFIG_DIR` to an empty temp dir AND don't write `.mcp.json` in the project dir.
**For "CE present" tests:** write `.mcp.json` in the project dir (Path 2 above).

---

## Task 1: Fixture Library

**Files:**
- Create: `tests/lib/fixtures.sh`

### Step 1: Create the file

```bash
#!/bin/bash
# tests/lib/fixtures.sh — shared helpers for hook tests
# Source this file at the top of each test script.

# Hook directory (relative to this file: tests/lib/ → ../../code-explorer-routing/hooks)
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../code-explorer-routing/hooks" && pwd)"

# --- Result tracking ---
PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  PASS: $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  FAIL: $1${2:+: $2}"
}

print_summary() {
  local suite="$1"
  echo "  ── $suite: $PASS_COUNT passed, $FAIL_COUNT failed"
  [ "$FAIL_COUNT" -eq 0 ]
}

# --- Git / filesystem setup ---

make_git_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@test.com"
  git -C "$dir" config user.name "Test"
  echo "init" > "$dir/README.md"
  git -C "$dir" add .
  git -C "$dir" commit -q -m "init"
}

make_worktree() {
  local main_dir="$1"
  local wt_dir="$2"
  mkdir -p "$(dirname "$wt_dir")"
  git -C "$main_dir" worktree add -q "$wt_dir" -b "test-wt-$(basename "$wt_dir")"
}

write_mcp_json() {
  local dir="$1"
  local server_name="${2:-code-explorer}"
  # Create a dummy binary the hook can find and exec-check
  local dummy_bin="$dir/fake-ce"
  printf '#!/bin/bash\nexit 0\n' > "$dummy_bin"
  chmod +x "$dummy_bin"
  cat > "$dir/.mcp.json" <<EOF
{
  "mcpServers": {
    "$server_name": {
      "command": "$dummy_bin",
      "args": ["serve"]
    }
  }
}
EOF
}

write_routing_config() {
  local dir="$1"
  local json="${2:-{}}"
  mkdir -p "$dir/.claude"
  echo "$json" > "$dir/.claude/code-explorer-routing.json"
}

make_ce_dir() {
  # Creates .code-explorer/project.toml (marks project as onboarded)
  # Pass drift=true to enable drift detection
  local dir="$1"
  local drift="${2:-false}"
  mkdir -p "$dir/.code-explorer"
  if [ "$drift" = "true" ]; then
    printf '[project]\ndrift_detection_enabled = true\n' > "$dir/.code-explorer/project.toml"
  else
    echo '[project]' > "$dir/.code-explorer/project.toml"
  fi
}

make_memories() {
  local dir="$1"
  mkdir -p "$dir/.code-explorer/memories"
  echo "# Arch" > "$dir/.code-explorer/memories/arch.md"
  echo "# Patterns" > "$dir/.code-explorer/memories/patterns.md"
}

make_system_prompt() {
  local dir="$1"
  mkdir -p "$dir/.code-explorer"
  echo "SYSTEM PROMPT CONTENT" > "$dir/.code-explorer/system-prompt.md"
}

seed_sqlite_db() {
  # Creates .code-explorer/embeddings.db with meta table
  local dir="$1"
  local last_commit="$2"
  mkdir -p "$dir/.code-explorer"
  local db="$dir/.code-explorer/embeddings.db"
  sqlite3 "$db" "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);"
  sqlite3 "$db" "INSERT OR REPLACE INTO meta VALUES ('last_indexed_commit', '$last_commit');"
}

seed_drift_db() {
  # Like seed_sqlite_db but also adds drift_report rows
  local dir="$1"
  local last_commit="$2"
  seed_sqlite_db "$dir" "$last_commit"
  local db="$dir/.code-explorer/embeddings.db"
  sqlite3 "$db" "CREATE TABLE IF NOT EXISTS drift_report (file_path TEXT, max_drift REAL);"
  sqlite3 "$db" "INSERT INTO drift_report VALUES ('src/foo.rs', 0.85);"
}

make_pending_marker() {
  local wt_dir="$1"
  touch "$wt_dir/.ce-worktree-pending"
}

# --- Assertion helpers ---

assert_context_contains() {
  local output="$1"
  local string="$2"
  local ctx
  ctx=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
  echo "$ctx" | grep -qF "$string"
}

assert_denied() {
  local output="$1"
  local decision
  decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)
  [ "$decision" = "deny" ]
}

assert_reason_contains() {
  local output="$1"
  local string="$2"
  local reason
  reason=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null)
  echo "$reason" | grep -qF "$string"
}

assert_no_output() {
  local output="$1"
  [ -z "$output" ]
}
```

### Step 2: Smoke-test the library loads cleanly

```bash
bash -c 'source tests/lib/fixtures.sh && echo "HOOK_DIR=$HOOK_DIR"'
```
Expected: `HOOK_DIR=/absolute/path/to/code-explorer-routing/hooks`

### Step 3: Commit

```bash
git add tests/lib/fixtures.sh
git commit -m "test: add hook test fixture library"
```

---

## Task 2: Test Runner

**Files:**
- Create: `tests/run-all.sh`

### Step 1: Create the file

```bash
#!/bin/bash
# tests/run-all.sh — run all hook test scripts and report results

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FAILED=()

for f in "$SCRIPT_DIR"/test-*.sh; do
  echo "▶ $(basename "$f")"
  if bash "$f"; then
    :
  else
    FAILED+=("$(basename "$f")")
  fi
  echo ""
done

if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "✓ All suites passed."
  exit 0
else
  echo "✗ Failed suites: ${FAILED[*]}"
  exit 1
fi
```

```bash
chmod +x tests/run-all.sh
```

### Step 2: Commit

```bash
git add tests/run-all.sh
git commit -m "test: add run-all.sh test runner"
```

---

## Task 3: Subagent Guidance Tests (simplest hook)

**Files:**
- Create: `tests/test-subagent-guidance.sh`

Hook: `hooks/subagent-guidance.sh`
Input shape: `{"cwd":"...","agent_type":"..."}`

### Step 1: Create the file

```bash
#!/bin/bash
# tests/test-subagent-guidance.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── subagent-guidance ──"
HOOK="$HOOK_DIR/subagent-guidance.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/proj"
write_mcp_json "$T/proj"

# Test 1: Bash agent → silent exit
OUT=$(printf '{"cwd":"%s","agent_type":"Bash"}' "$T/proj" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "Bash agent: silent exit"; else fail "Bash agent: silent exit" "$OUT"; fi

# Test 2: statusline-setup agent → silent exit
OUT=$(printf '{"cwd":"%s","agent_type":"statusline-setup"}' "$T/proj" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "statusline-setup agent: silent exit"; else fail "statusline-setup agent: silent exit" "$OUT"; fi

# Test 3: coding agent, no CE → silent exit
OUT=$(printf '{"cwd":"%s","agent_type":"general-purpose"}' "$T/proj" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "no CE: silent exit"; else fail "no CE: silent exit" "$OUT"; fi

# Test 4: coding agent, CE present, system prompt → context contains directive + prompt
make_system_prompt "$T/proj"
OUT=$(printf '{"cwd":"%s","agent_type":"general-purpose"}' "$T/proj" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "find_symbol" && assert_context_contains "$OUT" "SYSTEM PROMPT CONTENT"; then
  pass "CE present: directive + system prompt injected"
else
  fail "CE present: directive + system prompt injected" "$OUT"
fi

print_summary "subagent-guidance"
```

```bash
chmod +x tests/test-subagent-guidance.sh
```

### Step 2: Run it

```bash
bash tests/test-subagent-guidance.sh
```
Expected: `4 passed, 0 failed`

### Step 3: Commit

```bash
git add tests/test-subagent-guidance.sh
git commit -m "test: add subagent-guidance hook tests"
```

---

## Task 4: Pre-Tool Guard Tests

**Files:**
- Create: `tests/test-pre-tool-guard.sh`

Hook: `hooks/pre-tool-guard.sh`
Input shape: `{"cwd":"...","tool_name":"...","tool_input":{...}}`

### Step 1: Create the file

```bash
#!/bin/bash
# tests/test-pre-tool-guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-tool-guard ──"
HOOK="$HOOK_DIR/pre-tool-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/proj"
write_mcp_json "$T/proj"

# --- Helpers ---
guard_input() {
  # $1=tool_name, rest is tool_input JSON fields
  printf '{"cwd":"%s","tool_name":"%s","tool_input":{%s}}' "$T/proj" "$1" "$2"
}

# Test 1: no CE → allow (any tool)
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/foo.ts"'"' | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "no CE: allow"; else fail "no CE: allow" "exit=$EC out=$OUT"; fi

# Test 2: Bash tool → deny, reason contains "run_command"
OUT=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"git log"}}' "$T/proj" | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "run_command"; then
  pass "Bash: deny with run_command"
else
  fail "Bash: deny with run_command" "$OUT"
fi

# Test 3: Grep type=ts → deny, reason contains "find_symbol"
OUT=$(guard_input "Grep" '"pattern":"foo","type":"ts"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "find_symbol"; then
  pass "Grep type=ts: deny"
else
  fail "Grep type=ts: deny" "$OUT"
fi

# Test 4: Grep on .md glob → allow
OUT=$(guard_input "Grep" '"pattern":"foo","glob":"**/*.md"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Grep .md: allow"; else fail "Grep .md: allow" "$OUT"; fi

# Test 5: Glob on *.ts → deny
OUT=$(guard_input "Glob" '"pattern":"'"$T/proj/**/*.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then pass "Glob *.ts: deny"; else fail "Glob *.ts: deny" "$OUT"; fi

# Test 6: Glob on *.md → allow
OUT=$(guard_input "Glob" '"pattern":"'"$T/proj/**/*.md"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Glob *.md: allow"; else fail "Glob *.md: allow" "$OUT"; fi

# Test 7: Read on .ts file → deny, reason contains "list_symbols"
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "list_symbols"; then
  pass "Read .ts: deny with list_symbols"
else
  fail "Read .ts: deny with list_symbols" "$OUT"
fi

# Test 8: Read on .md file → allow
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/README.md"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Read .md: allow"; else fail "Read .md: allow" "$OUT"; fi

# Test 9: block_reads=false → allow source file
write_routing_config "$T/proj" '{"block_reads":false}'
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "block_reads=false: allow source"; else fail "block_reads=false: allow source" "$OUT"; fi
# Reset routing config
rm -f "$T/proj/.claude/code-explorer-routing.json"

# Test 10: file outside workspace_root → allow even if source
write_routing_config "$T/proj" '{"workspace_root":"'"$T/proj/src"'"}'
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "outside workspace_root: allow"; else fail "outside workspace_root: allow" "$OUT"; fi

print_summary "pre-tool-guard"
```

```bash
chmod +x tests/test-pre-tool-guard.sh
```

### Step 2: Run it

```bash
bash tests/test-pre-tool-guard.sh
```
Expected: `10 passed, 0 failed`

### Step 3: Commit

```bash
git add tests/test-pre-tool-guard.sh
git commit -m "test: add pre-tool-guard hook tests"
```

---

## Task 5: Session Start Tests

**Files:**
- Create: `tests/test-session-start.sh`

Hook: `hooks/session-start.sh`
Input shape: `{"cwd":"..."}`

### Step 1: Create the file

```bash
#!/bin/bash
# tests/test-session-start.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── session-start ──"
HOOK="$HOOK_DIR/session-start.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# --- Test 1: no CE → silent exit ---
make_git_repo "$T/t1"
OUT=$(printf '{"cwd":"%s"}' "$T/t1" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "no CE: silent exit"; else fail "no CE: silent exit" "$OUT"; fi

# --- Test 2: CE configured, not onboarded (no project.toml) ---
make_git_repo "$T/t2"
write_mcp_json "$T/t2"
OUT=$(printf '{"cwd":"%s"}' "$T/t2" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "not yet onboarded"; then
  pass "not onboarded: hint shown"
else
  fail "not onboarded: hint shown" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -3)"
fi

# --- Test 3: has memories → CE MEMORIES: shown ---
make_git_repo "$T/t3"
write_mcp_json "$T/t3"
make_ce_dir "$T/t3"
make_memories "$T/t3"
OUT=$(printf '{"cwd":"%s"}' "$T/t3" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "CE MEMORIES:"; then
  pass "memories: hint shown"
else
  fail "memories: hint shown" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -3)"
fi

# --- Test 4: has system-prompt.md → content injected ---
make_git_repo "$T/t4"
write_mcp_json "$T/t4"
make_ce_dir "$T/t4"
make_system_prompt "$T/t4"
OUT=$(printf '{"cwd":"%s"}' "$T/t4" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "SYSTEM PROMPT CONTENT"; then
  pass "system-prompt: injected"
else
  fail "system-prompt: injected" "$OUT"
fi

# --- Test 5: index stale → INDEX: Refreshing message ---
make_git_repo "$T/t5"
write_mcp_json "$T/t5"
make_ce_dir "$T/t5"
seed_sqlite_db "$T/t5" "deadbeef0000000000000000000000000000000000"
OUT=$(printf '{"cwd":"%s"}' "$T/t5" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "INDEX: Refreshing"; then
  pass "stale index: refresh triggered"
else
  fail "stale index: refresh triggered" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -5)"
fi

# --- Test 6: index current → no INDEX message ---
make_git_repo "$T/t6"
write_mcp_json "$T/t6"
make_ce_dir "$T/t6"
HEAD=$(git -C "$T/t6" rev-parse HEAD)
seed_sqlite_db "$T/t6" "$HEAD"
OUT=$(printf '{"cwd":"%s"}' "$T/t6" | bash "$HOOK" 2>/dev/null)
if ! assert_context_contains "$OUT" "INDEX:"; then
  pass "current index: no refresh"
else
  fail "current index: no refresh" "index message appeared unexpectedly"
fi

# --- Test 7: inside worktree → WORKTREE SESSION, no INDEX ---
make_git_repo "$T/t7main"
write_mcp_json "$T/t7main"
make_ce_dir "$T/t7main"
seed_sqlite_db "$T/t7main" "deadbeef0000000000000000000000000000000000"
make_worktree "$T/t7main" "$T/t7wt"
# Symlink .code-explorer into worktree (as the hook would do in a real session)
ln -s "$T/t7main/.code-explorer" "$T/t7wt/.code-explorer"
cp "$T/t7main/.mcp.json" "$T/t7wt/.mcp.json"
OUT=$(printf '{"cwd":"%s"}' "$T/t7wt" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "WORKTREE SESSION" && ! assert_context_contains "$OUT" "INDEX:"; then
  pass "worktree: WORKTREE SESSION shown, no INDEX"
else
  fail "worktree: WORKTREE SESSION shown, no INDEX" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -5)"
fi

# --- Test 8: drift warnings ---
make_git_repo "$T/t8"
write_mcp_json "$T/t8"
make_ce_dir "$T/t8" "true"   # drift_detection_enabled = true
HEAD=$(git -C "$T/t8" rev-parse HEAD)
seed_drift_db "$T/t8" "$HEAD"   # current index + drift rows
OUT=$(printf '{"cwd":"%s"}' "$T/t8" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "DRIFT WARNING"; then
  pass "drift: warning shown"
else
  fail "drift: warning shown" "$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null | head -5)"
fi

print_summary "session-start"
```

```bash
chmod +x tests/test-session-start.sh
```

### Step 2: Run it

```bash
bash tests/test-session-start.sh
```
Expected: `8 passed, 0 failed`

If test 7 (worktree) fails with a git error, check that the `.mcp.json` is present in the worktree dir (the hook reads CWD for mcp.json).

### Step 3: Commit

```bash
git add tests/test-session-start.sh
git commit -m "test: add session-start hook tests"
```

---

## Task 6: Worktree Write Guard Tests

**Files:**
- Create: `tests/test-worktree-write-guard.sh`

Hook: `hooks/worktree-write-guard.sh`
Input shape: `{"cwd":"...","tool_name":"mcp__code-explorer__replace_symbol"}`

### Step 1: Create the file

```bash
#!/bin/bash
# tests/test-worktree-write-guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── worktree-write-guard ──"
HOOK="$HOOK_DIR/worktree-write-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/main"
make_worktree "$T/main" "$T/wt"

WRITE_TOOL="mcp__code-explorer__replace_symbol"
READ_TOOL="mcp__code-explorer__list_symbols"

# Test 1: non-write tool → allow
OUT=$(printf '{"cwd":"%s","tool_name":"%s"}' "$T/wt" "$READ_TOOL" | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "non-write tool: allow"; else fail "non-write tool: allow" "$OUT"; fi

# Test 2: write tool, CWD in main repo (not worktree) → allow
OUT=$(printf '{"cwd":"%s","tool_name":"%s"}' "$T/main" "$WRITE_TOOL" | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "main repo: allow"; else fail "main repo: allow" "$OUT"; fi

# Test 3: write tool, in worktree, no marker → allow
OUT=$(printf '{"cwd":"%s","tool_name":"%s"}' "$T/wt" "$WRITE_TOOL" | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "worktree, no marker: allow"; else fail "worktree, no marker: allow" "$OUT"; fi

# Test 4: write tool, in worktree, marker present → deny
make_pending_marker "$T/wt"
OUT=$(printf '{"cwd":"%s","tool_name":"%s"}' "$T/wt" "$WRITE_TOOL" | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "activate_project"; then
  pass "worktree + marker: deny with activate_project"
else
  fail "worktree + marker: deny with activate_project" "$OUT"
fi

print_summary "worktree-write-guard"
```

```bash
chmod +x tests/test-worktree-write-guard.sh
```

### Step 2: Run it

```bash
bash tests/test-worktree-write-guard.sh
```
Expected: `4 passed, 0 failed`

### Step 3: Commit

```bash
git add tests/test-worktree-write-guard.sh
git commit -m "test: add worktree-write-guard hook tests"
```

---

## Task 7: Worktree Activate Tests

**Files:**
- Create: `tests/test-worktree-activate.sh`

Hook: `hooks/worktree-activate.sh`
Input shape: `{"cwd":"...","tool_name":"EnterWorktree","tool_response":{"worktree_path":"..."}}`

### Step 1: Create the file

```bash
#!/bin/bash
# tests/test-worktree-activate.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── worktree-activate ──"
HOOK="$HOOK_DIR/worktree-activate.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# Test 1: non-EnterWorktree tool → silent exit
OUT=$(printf '{"cwd":"%s","tool_name":"Bash","tool_response":{}}' "$T" | bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "non-EnterWorktree: silent exit"; else fail "non-EnterWorktree: silent exit" "$OUT"; fi

# Test 2: EnterWorktree, no CE → silent exit
make_git_repo "$T/t2main"
make_worktree "$T/t2main" "$T/t2wt"
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{"worktree_path":"%s"}}' \
  "$T/t2main" "$T/t2wt" | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "no CE: silent exit"; else fail "no CE: silent exit" "$OUT"; fi

# Test 3: EnterWorktree with worktree_path → marker created, guidance injected, symlink exists
make_git_repo "$T/t3main"
write_mcp_json "$T/t3main"
make_ce_dir "$T/t3main"
make_worktree "$T/t3main" "$T/t3wt"
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{"worktree_path":"%s"}}' \
  "$T/t3main" "$T/t3wt" | bash "$HOOK" 2>/dev/null)
MARKER_OK=false; GUIDANCE_OK=false; SYMLINK_OK=false
[ -f "$T/t3wt/.ce-worktree-pending" ] && MARKER_OK=true
assert_context_contains "$OUT" "activate_project" && GUIDANCE_OK=true
[ -L "$T/t3wt/.code-explorer" ] && SYMLINK_OK=true
if $MARKER_OK && $GUIDANCE_OK && $SYMLINK_OK; then
  pass "EnterWorktree with path: marker+guidance+symlink"
else
  fail "EnterWorktree with path: marker+guidance+symlink" \
    "marker=$MARKER_OK guidance=$GUIDANCE_OK symlink=$SYMLINK_OK out=$(echo "$OUT" | head -1)"
fi

# Test 4: EnterWorktree without worktree_path → fallback detection
make_git_repo "$T/t4main"
write_mcp_json "$T/t4main"
make_ce_dir "$T/t4main"
make_worktree "$T/t4main" "$T/t4wt"
# No worktree_path in response — hook must detect via git worktree list
OUT=$(printf '{"cwd":"%s","tool_name":"EnterWorktree","tool_response":{}}' \
  "$T/t4main" | bash "$HOOK" 2>/dev/null)
if assert_context_contains "$OUT" "activate_project" && [ -f "$T/t4wt/.ce-worktree-pending" ]; then
  pass "EnterWorktree fallback detection: marker+guidance"
else
  fail "EnterWorktree fallback detection: marker+guidance" \
    "marker=$(ls "$T/t4wt/.ce-worktree-pending" 2>/dev/null || echo missing)"
fi

print_summary "worktree-activate"
```

```bash
chmod +x tests/test-worktree-activate.sh
```

### Step 2: Run it

```bash
bash tests/test-worktree-activate.sh
```
Expected: `4 passed, 0 failed`

### Step 3: Commit

```bash
git add tests/test-worktree-activate.sh
git commit -m "test: add worktree-activate hook tests"
```

---

## Task 8: CE Activate Project Tests

**Files:**
- Create: `tests/test-ce-activate-project.sh`

Hook: `hooks/ce-activate-project.sh`
Input shape: `{"tool_name":"mcp__code-explorer__activate_project","tool_input":{"path":"..."}}`

### Step 1: Create the file

```bash
#!/bin/bash
# tests/test-ce-activate-project.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── ce-activate-project ──"
HOOK="$HOOK_DIR/ce-activate-project.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/main"
make_worktree "$T/main" "$T/wt"

ACTIVATE_TOOL="mcp__code-explorer__activate_project"

# Test 1: non-activate_project tool → silent exit
OUT=$(printf '{"tool_name":"mcp__code-explorer__list_symbols","tool_input":{"path":"%s"}}' "$T/wt" \
  | bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "non-activate: silent exit"; else fail "non-activate: silent exit" "$OUT"; fi

# Test 2: activate_project, no marker → silent exit
OUT=$(printf '{"tool_name":"%s","tool_input":{"path":"%s"}}' "$ACTIVATE_TOOL" "$T/wt" \
  | bash "$HOOK" 2>/dev/null)
if assert_no_output "$OUT"; then pass "no marker: silent exit"; else fail "no marker: silent exit" "$OUT"; fi

# Test 3: activate_project, marker present → marker deleted, confirmation in context
make_pending_marker "$T/wt"
OUT=$(printf '{"tool_name":"%s","tool_input":{"path":"%s"}}' "$ACTIVATE_TOOL" "$T/wt" \
  | bash "$HOOK" 2>/dev/null)
if [ ! -f "$T/wt/.ce-worktree-pending" ] && assert_context_contains "$OUT" "✓ CE switched"; then
  pass "marker present: deleted + confirmed"
else
  fail "marker present: deleted + confirmed" \
    "marker_exists=$([ -f "$T/wt/.ce-worktree-pending" ] && echo yes || echo no) out=$OUT"
fi

print_summary "ce-activate-project"
```

```bash
chmod +x tests/test-ce-activate-project.sh
```

### Step 2: Run it

```bash
bash tests/test-ce-activate-project.sh
```
Expected: `3 passed, 0 failed`

### Step 3: Commit

```bash
git add tests/test-ce-activate-project.sh
git commit -m "test: add ce-activate-project hook tests"
```

---

## Task 9: Wire Into Version Bump Checklist

**Files:**
- Modify: `CLAUDE.md` (project-level, in repo root)

### Step 1: Add test gate to the version bump checklist

Find the "When bumping a plugin version" section and add a "Before bumping, verify:" step:

```markdown
Before bumping, verify:

1. **Tests pass** — `./tests/run-all.sh` exits 0
2. **Tested** — new behavior works as expected
3. **Nothing pending** — no more changes planned for this version, `git status` clean
```

Also add to the Development section:

```markdown
## Testing

Run before any version bump:

```bash
./tests/run-all.sh
```
```

### Step 2: Verify full suite passes

```bash
./tests/run-all.sh
```
Expected output:
```
▶ test-ce-activate-project.sh
  PASS: non-activate: silent exit
  PASS: no marker: silent exit
  PASS: marker present: deleted + confirmed
  ── ce-activate-project: 3 passed, 0 failed

▶ test-pre-tool-guard.sh
  ...
  ── pre-tool-guard: 10 passed, 0 failed

...

✓ All suites passed.
```

### Step 3: Commit

```bash
git add CLAUDE.md tests/
git commit -m "test: wire run-all.sh into version bump checklist"
```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| 1 | `tests/lib/fixtures.sh` | — |
| 2 | `tests/run-all.sh` | — |
| 3 | `test-subagent-guidance.sh` | 4 |
| 4 | `test-pre-tool-guard.sh` | 10 |
| 5 | `test-session-start.sh` | 8 |
| 6 | `test-worktree-write-guard.sh` | 4 |
| 7 | `test-worktree-activate.sh` | 4 |
| 8 | `test-ce-activate-project.sh` | 3 |
| 9 | `CLAUDE.md` update | — |

**33 tests total.** All plain bash, no extra dependencies.
