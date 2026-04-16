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
BASH_DEDUP_KEY=$(printf '%s\t%s' "Bash" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$BASH_DEDUP_KEY"
OUT=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"git log"}}' "$T/proj" | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "run_command"; then
  pass "Bash: deny with run_command"
else
  fail "Bash: deny with run_command" "$OUT"
fi

# Test 3: Grep type=ts → deny with find_symbol
GREP_DEDUP_KEY=$(printf '%s\t%s' "Grep" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$GREP_DEDUP_KEY"
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
GLOB_DEDUP_KEY=$(printf '%s\t%s' "Glob" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$GLOB_DEDUP_KEY"
OUT=$(guard_input "Glob" '"pattern":"'"$T/proj/**/*.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then pass "Glob *.ts: deny"; else fail "Glob *.ts: deny" "$OUT"; fi

# Test 6: Glob on *.md → allow
OUT=$(guard_input "Glob" '"pattern":"'"$T/proj/**/*.md"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Glob *.md: allow"; else fail "Glob *.md: allow" "$OUT"; fi

# Test 7: Read on .ts file → deny with list_symbols
READ_DEDUP_KEY=$(printf '%s\t%s' "Read" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$READ_DEDUP_KEY"
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "list_symbols"; then
  pass "Read .ts: deny with list_symbols"
else
  fail "Read .ts: deny with list_symbols" "$OUT"
fi

# Test 8: Read on .md inside project → deny with heading navigation guidance
# Clean up dedup file from previous tests so this gets full reason
READ_DEDUP_KEY=$(printf '%s\t%s' "Read" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$READ_DEDUP_KEY"
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
rm -f "$T/proj/.claude/codescout-companion.json"

# Test 11: Edit on .ts → deny with replace_symbol
EDIT_DEDUP_KEY=$(printf '%s\t%s' "Edit" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$EDIT_DEDUP_KEY"
OUT=$(guard_input "Edit" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "replace_symbol"; then
  pass "Edit .ts: deny with replace_symbol"
else
  fail "Edit .ts: deny with replace_symbol" "$OUT"
fi

# Test 12: Edit on .md → allow (markdown not in SOURCE_EXT_PATTERN)
OUT=$(guard_input "Edit" '"file_path":"'"$T/proj/README.md"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Edit .md: allow"; else fail "Edit .md: allow" "$OUT"; fi

# Test 13: Write on .ts → deny with create_file
WRITE_DEDUP_KEY=$(printf '%s\t%s' "Write" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$WRITE_DEDUP_KEY"
OUT=$(guard_input "Write" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "create_file"; then
  pass "Write .ts: deny with create_file"
else
  fail "Write .ts: deny with create_file" "$OUT"
fi

# Test 14: Write on .md → allow (markdown not in SOURCE_EXT_PATTERN)
OUT=$(guard_input "Write" '"file_path":"'"$T/proj/README.md"'"' | bash "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "Write .md: allow"; else fail "Write .md: allow" "$OUT"; fi

# Test 15: Read on a .cargo/registry file (deep path inside crate) → deny, crate name not "lib.rs"
# Clean up dedup file from previous tests so this gets full reason
READ_DEDUP_KEY=$(printf '%s\t%s' "Read" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$READ_DEDUP_KEY"
CARGO_PATH="$HOME/.cargo/registry/src/index.crates.io-abc123/serde-1.0.195/src/lib.rs"
OUT=$(guard_input "Read" "\"file_path\":\"$CARGO_PATH\"" | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "register_library" && assert_reason_contains "$OUT" "crate 'serde'"; then
  pass "Read .cargo/registry deep path: deny with correct crate name"
else
  CRATE=$(echo "$OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null | grep -oE "crate '[^']+'" | head -1)
  fail "Read .cargo/registry deep path: deny with correct crate name" "crate_hint=$CRATE"
fi

# Test 16: Grep on a .cargo/registry path (deep path inside crate) → deny, crate name not "lib.rs"
# Clean up dedup file from previous tests so this gets full reason
GREP_DEDUP_KEY=$(printf '%s\t%s' "Grep" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$GREP_DEDUP_KEY"
OUT=$(guard_input "Grep" "\"pattern\":\"Serialize\",\"path\":\"$CARGO_PATH\"" | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "register_library" && assert_reason_contains "$OUT" "crate 'serde'"; then
  pass "Grep .cargo/registry deep path: deny with correct crate name"
else
  CRATE=$(echo "$OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null | grep -oE "crate '[^']+'" | head -1)
  fail "Grep .cargo/registry deep path: deny with correct crate name" "crate_hint=$CRATE"
fi

# Test 17: parallel dedup — first call gets full reason
# Clean up dedup file from previous tests so this gets full reason
BASH_DEDUP_KEY=$(printf '%s\t%s' "Bash" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$BASH_DEDUP_KEY"
OUT1=$(guard_input "Bash" '"command":"cat foo.rs"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT1" && assert_reason_contains "$OUT1" "run_command"; then
  pass "Bash dedup: first call gets full reason"
else
  fail "Bash dedup: first call gets full reason" "$OUT1"
fi

# Test 18: parallel dedup — second call within window gets short reason
OUT2=$(guard_input "Bash" '"command":"cat bar.rs"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT2" && assert_reason_contains "$OUT2" "see previous message"; then
  pass "Bash dedup: second call gets short reason"
else
  fail "Bash dedup: second call gets short reason" "$OUT2"
fi

# Test 19: different tool type in same window gets its own full reason
READ_DEDUP_KEY=$(printf '%s\t%s' "Read" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$READ_DEDUP_KEY"
OUT3=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT3" && assert_reason_contains "$OUT3" "list_symbols"; then
  pass "Read dedup: different tool type gets full reason"
else
  fail "Read dedup: different tool type gets full reason" "$OUT3"
fi

# Test 20: after dedup window cleared, full reason again
DEDUP_KEY=$(printf '%s\t%s' "Bash" "$T/proj" | md5sum | cut -c1-8)
rm -f "/tmp/cs-block-$DEDUP_KEY"
OUT4=$(guard_input "Bash" '"command":"cat baz.rs"' | bash "$HOOK" 2>/dev/null)
if assert_denied "$OUT4" && assert_reason_contains "$OUT4" "run_command"; then
  pass "Bash dedup: after window cleared, full reason again"
else
  fail "Bash dedup: after window cleared, full reason again" "$OUT4"
fi

print_summary "pre-tool-guard"
