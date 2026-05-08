#!/bin/bash
# tests/test-detect-tools.sh — characterization test for detect-tools.sh
#
# Locks the current behavior of the sourced detection layer so a future
# I-11 conversion (replace bash with detect.py) has a green target.
# Every assertion below must remain true after the conversion or behavior
# has measurably changed.
#
# detect-tools.sh exports 12+ shell variables that downstream hooks consume.
# This test runs the hook under fixtures covering each detection path and
# asserts the exported values match expectations.

source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── detect-tools ──"
HOOK="$HOOK_DIR/detect-tools.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# Helper: run detect-tools.sh under given CWD, echo all relevant vars.
# We isolate via `bash -c` so each invocation gets fresh shell state.
detect_vars() {
    local cwd="$1"
    bash -c "
        CWD='$cwd'
        # Stub HOME and CLAUDE_CONFIG_DIR away from the developer's real ones
        export HOME='$T/_home_$RANDOM'
        unset CLAUDE_CONFIG_DIR
        mkdir -p \"\$HOME\"
        source '$HOOK' >/dev/null 2>&1
        cat <<VARS
HAS_CODESCOUT=\$HAS_CODESCOUT
CS_SERVER_NAME=\$CS_SERVER_NAME
CS_PREFIX=\$CS_PREFIX
CS_PROJECT_DIR=\$CS_PROJECT_DIR
HAS_CS_ONBOARDING=\$HAS_CS_ONBOARDING
HAS_CS_MEMORIES=\$HAS_CS_MEMORIES
CS_MEMORY_NAMES=\$CS_MEMORY_NAMES
HAS_CS_SYSTEM_PROMPT=\$HAS_CS_SYSTEM_PROMPT
BLOCK_READS=\$BLOCK_READS
WORKSPACE_ROOT=\$WORKSPACE_ROOT
VARS
    "
}

assert_var() {
    local out="$1" var="$2" expected="$3" label="$4"
    local got
    got=$(echo "$out" | grep "^$var=" | head -1 | cut -d= -f2-)
    if [ "$got" = "$expected" ]; then
        pass "$label ($var=$expected)"
    else
        fail "$label" "expected $var=$expected, got $var=$got"
    fi
}

# --- Test 1: empty cwd → no detection ---
mkdir -p "$T/empty"
OUT=$(detect_vars "$T/empty")
assert_var "$OUT" "HAS_CODESCOUT" "false" "empty cwd: not detected"
assert_var "$OUT" "CS_SERVER_NAME" "" "empty cwd: no server name"
assert_var "$OUT" "CS_PREFIX" "" "empty cwd: no prefix"
assert_var "$OUT" "BLOCK_READS" "true" "empty cwd: BLOCK_READS defaults to true"

# --- Test 2: routing config override sets server name explicitly ---
mkdir -p "$T/override"
write_routing_config "$T/override" '{"server_name":"custom-cs"}'
OUT=$(detect_vars "$T/override")
assert_var "$OUT" "HAS_CODESCOUT" "true" "routing override: detected"
assert_var "$OUT" "CS_SERVER_NAME" "custom-cs" "routing override: server name"
assert_var "$OUT" "CS_PREFIX" "mcp__custom-cs__" "routing override: prefix built"

# --- Test 3: .mcp.json with codescout-matching command ---
mkdir -p "$T/mcp"
# Manual mcp.json — fixtures.sh::write_mcp_json creates a binary at fake-ce
# whose path doesn't match the hook's `code-explorer|codescout` regex, so
# we write directly to ensure detection actually fires.
cat > "$T/mcp/.mcp.json" <<EOF
{
  "mcpServers": {
    "code-explorer": {
      "command": "/usr/local/bin/codescout",
      "args": ["serve"]
    }
  }
}
EOF
OUT=$(detect_vars "$T/mcp")
assert_var "$OUT" "HAS_CODESCOUT" "true" "mcp.json: detected"
assert_var "$OUT" "CS_SERVER_NAME" "code-explorer" "mcp.json: server name"
assert_var "$OUT" "CS_PREFIX" "mcp__code-explorer__" "mcp.json: prefix"

# --- Test 4: .codescout/ takes precedence over .code-explorer/ ---
mkdir -p "$T/both"
make_codescout_dir "$T/both"
make_ce_dir "$T/both"
OUT=$(detect_vars "$T/both")
case "$(echo "$OUT" | grep '^CS_PROJECT_DIR=')" in
    *.codescout) pass "both dirs: .codescout/ wins" ;;
    *) fail "both dirs: .codescout precedence" "$(echo "$OUT" | grep CS_PROJECT_DIR)" ;;
esac

# --- Test 5: legacy .code-explorer/ still detected when .codescout/ absent ---
mkdir -p "$T/legacy"
make_ce_dir "$T/legacy"
OUT=$(detect_vars "$T/legacy")
case "$(echo "$OUT" | grep '^CS_PROJECT_DIR=')" in
    *.code-explorer) pass "legacy dir: .code-explorer/ used as fallback" ;;
    *) fail "legacy dir fallback" "$(echo "$OUT" | grep CS_PROJECT_DIR)" ;;
esac
assert_var "$OUT" "HAS_CS_ONBOARDING" "true" "legacy dir: project.toml → onboarded"

# --- Test 6: memories surfaced ---
mkdir -p "$T/mems"
make_ce_dir "$T/mems"
make_memories "$T/mems"
OUT=$(detect_vars "$T/mems")
assert_var "$OUT" "HAS_CS_MEMORIES" "true" "memories: detected"
case "$(echo "$OUT" | grep '^CS_MEMORY_NAMES=')" in
    *arch*patterns*|*patterns*arch*) pass "memories: names contain arch + patterns" ;;
    *) fail "memories: names" "$(echo "$OUT" | grep CS_MEMORY_NAMES)" ;;
esac

# --- Test 7: system-prompt.md surfaced ---
mkdir -p "$T/sysp"
make_ce_dir "$T/sysp"
make_system_prompt "$T/sysp"
OUT=$(detect_vars "$T/sysp")
assert_var "$OUT" "HAS_CS_SYSTEM_PROMPT" "true" "system prompt: detected"

# --- Test 8: routing config block_reads=false honored ---
mkdir -p "$T/noblock"
write_routing_config "$T/noblock" '{"block_reads":false}'
OUT=$(detect_vars "$T/noblock")
assert_var "$OUT" "BLOCK_READS" "false" "routing: block_reads=false honored"

# --- Test 9: workspace_root expanded ---
mkdir -p "$T/ws"
write_routing_config "$T/ws" '{"workspace_root":"/tmp/some-workspace"}'
OUT=$(detect_vars "$T/ws")
assert_var "$OUT" "WORKSPACE_ROOT" "/tmp/some-workspace" "routing: workspace_root literal"

# --- Test 10: routing config legacy name `codescout-routing.json` honored ---
mkdir -p "$T/legacy-routing/.claude"
echo '{"server_name":"legacy-name"}' > "$T/legacy-routing/.claude/codescout-routing.json"
OUT=$(detect_vars "$T/legacy-routing")
assert_var "$OUT" "CS_SERVER_NAME" "legacy-name" "legacy routing config name (codescout-routing.json) honored"

# --- Test 11: routing config legacy-legacy `code-explorer-routing.json` honored ---
mkdir -p "$T/llegacy-routing/.claude"
echo '{"server_name":"oldest-name"}' > "$T/llegacy-routing/.claude/code-explorer-routing.json"
OUT=$(detect_vars "$T/llegacy-routing")
assert_var "$OUT" "CS_SERVER_NAME" "oldest-name" "legacy^2 routing config name (code-explorer-routing.json) honored"

print_summary "detect-tools"
