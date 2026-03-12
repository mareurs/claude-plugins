#!/bin/bash
# tests/test-pre-tool-guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-tool-guard ──"
HOOK="$HOOK_DIR/pre-tool-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

make_git_repo "$T/proj"
write_mcp_json "$T/proj"

# --- Helper ---
guard_input() {
  printf '{"cwd":"%s","tool_name":"%s","tool_input":{%s}}' "$T/proj" "$1" "$2"
}

# Test 1: no CE → allow
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/foo.ts"'"' | CLAUDE_CONFIG_DIR="$T/empty" bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "no CE: allow"; else fail "no CE: allow" "exit=$EC out=$OUT"; fi

# Test 2: Bash tool → deny with run_command
OUT=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"git log"}}' "$T/proj" | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "run_command"; then
  pass "Bash: deny with run_command"
else
  fail "Bash: deny with run_command" "$OUT"
fi

# Test 3: Grep type=ts → deny with find_symbol
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

# Test 7: Read on .ts file → deny with list_symbols
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "list_symbols"; then
  pass "Read .ts: deny with list_symbols"
else
  fail "Read .ts: deny with list_symbols" "$OUT"
fi

# Test 8: Read on .md inside project → deny with heading navigation guidance
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/README.md"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && echo "$OUT" | grep -q "heading="; then
  pass "Read .md in project: deny with heading navigation"
else
  fail "Read .md in project: deny with heading navigation" "$OUT"
fi

# Test 8b: Read on .md outside project → allow
OUT=$(guard_input "Read" '"file_path":"/tmp/some-skill/SKILL.md"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Read .md outside project: allow"; else fail "Read .md outside project: allow" "$OUT"; fi

# Test 8c: Read on skill SKILL.md inside project → allow
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/skills/my-skill/SKILL.md"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Read SKILL.md in project: allow"; else fail "Read SKILL.md in project: allow" "$OUT"; fi

# Test 8d: Read on .md in skills/ subdir inside project → allow
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/myplugin/skills/foo/guide.md"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Read .md in skills/ dir: allow"; else fail "Read .md in skills/ dir: allow" "$OUT"; fi

# Test 9: block_reads=false → allow source file
# Note: jq's // empty operator treats boolean false as absent; hook reads
# block_reads via jq -r '.block_reads // empty' and compares to string "false",
# so block_reads must be set as a JSON string "false" to trigger the bypass.
write_routing_config "$T/proj" '{"block_reads":"false"}'
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "block_reads=false: allow source"; else fail "block_reads=false: allow source" "$OUT"; fi
rm -f "$T/proj/.claude/codescout-companion.json"

# Test 10: outside workspace_root → allow even if source
write_routing_config "$T/proj" '{"workspace_root":"'"$T/proj/src"'"}'
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "outside workspace_root: allow"; else fail "outside workspace_root: allow" "$OUT"; fi

print_summary "pre-tool-guard"
