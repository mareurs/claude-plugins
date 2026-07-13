#!/usr/bin/env bash
# Test matrix for il4-deny-hook.sh.
#
# Covers:
#   1. read_file *.md → DENY (lowercase / uppercase / mixed)
#   2. read_file source extensions → ALLOW (different gate, not this hook)
#   3. read_file .markdown / .mdx → ALLOW (narrow ship: only .md)
#   4. .md inside path but not suffix → ALLOW
#   5. wrong tool name → ALLOW
#   6. malformed input → ALLOW

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/il4-deny-hook.mjs"
PASS=0
FAIL=0

assert() {
    local label="$1"
    local input="$2"
    local expected="$3"  # "deny" or "allow"
    local got
    got=$(echo "$input" | node "$HOOK")
    local decision="allow"
    if [[ -n "$got" ]]; then
        decision=$(echo "$got" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null || echo "allow")
    fi
    if [[ "$decision" == "$expected" ]]; then
        echo "PASS [$label]"
        PASS=$((PASS+1))
    else
        echo "FAIL [$label]: expected=$expected got=$decision"
        echo "  output: $got"
        FAIL=$((FAIL+1))
    fi
}

mkinput() {
    local path="$1"
    local tool="${2:-mcp__codescout__read_file}"
    jq -n --arg p "$path" --arg t "$tool" '{tool_name:$t, tool_input:{path:$p}}'
}

# 1. .md path → DENY (case variations)
assert "deny-md-lowercase" "$(mkinput 'docs/CLAUDE.md')" "deny"
assert "deny-md-uppercase" "$(mkinput 'README.MD')" "deny"
assert "deny-md-mixed" "$(mkinput 'NOTES.Md')" "deny"

# 2. source extensions → ALLOW (this hook only fires on .md)
assert "allow-rs-source" "$(mkinput 'src/lib.rs')" "allow"
assert "allow-ts-source" "$(mkinput 'src/index.ts')" "allow"
assert "allow-py-source" "$(mkinput 'main.py')" "allow"
assert "allow-toml-config" "$(mkinput 'Cargo.toml')" "allow"
assert "allow-json-config" "$(mkinput '.mcp.json')" "allow"

# 3. .markdown / .mdx → ALLOW (narrow ship; add if usage data shows demand)
assert "allow-markdown-ext" "$(mkinput 'doc.markdown')" "allow"
assert "allow-mdx-ext" "$(mkinput 'page.mdx')" "allow"

# 4. .md substring but not suffix → ALLOW
assert "allow-md-in-name" "$(mkinput 'config-md.toml')" "allow"
assert "allow-md-not-suffix" "$(mkinput 'foo.md.bak')" "allow"

# 5. wrong tool → ALLOW (hook only fires on read_file)
assert "wrong-tool-read_markdown" "$(mkinput 'CLAUDE.md' 'mcp__codescout__read_markdown')" "allow"
assert "wrong-tool-edit_file" "$(mkinput 'CLAUDE.md' 'mcp__codescout__edit_file')" "allow"
assert "wrong-tool-native-Read" "$(mkinput 'CLAUDE.md' 'Read')" "allow"

# 6. malformed input
assert "no-path" '{"tool_name":"mcp__codescout__read_file","tool_input":{}}' "allow"
assert "no-tool-name" '{"tool_input":{"path":"foo.md"}}' "allow"
assert "empty-input" '' "allow"

echo
echo "Passed: $PASS   Failed: $FAIL"
[[ $FAIL -eq 0 ]]
