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
  printf '%s\n' "$json" > "$dir/.claude/code-explorer-routing.json"
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
  printf "INSERT OR REPLACE INTO meta VALUES ('last_indexed_commit', '%s');\n" "$last_commit" \
    | sqlite3 "$db"
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
  grep -qF "$string" <<< "$ctx"
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
  grep -qF "$string" <<< "$reason"
}

assert_no_output() {
  local output="$1"
  [ -z "$output" ]
}
