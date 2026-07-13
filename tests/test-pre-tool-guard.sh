#!/bin/bash
# tests/test-pre-tool-guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── pre-tool-guard ──"
HOOK="$HOOK_DIR/pre-tool-guard.mjs"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

# Dedup markers live in the OS temp dir under the hook's sha256(tool\tcwd) key.
# Clear them by glob so the tests never need to recompute the key or assume /tmp
# (works regardless of the hook's hash algorithm or $TMPDIR).
TMPD=$(node -e 'process.stdout.write(require("os").tmpdir())')
clear_dedup() { [ -n "$TMPD" ] && rm -f "$TMPD"/cs-block-* 2>/dev/null; return 0; }

make_git_repo "$T/proj"
write_mcp_json "$T/proj"

# --- Helper ---
guard_input() {
  printf '{"cwd":"%s","tool_name":"%s","tool_input":{%s}}' "$T/proj" "$1" "$2"
}

# Test 1: no CE → allow
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/foo.ts"'"' | CLAUDE_CONFIG_DIR="$T/empty" node "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "no CE: allow"; else fail "no CE: allow" "exit=$EC out=$OUT"; fi

# Test 2: Bash tool → deny with run_command
clear_dedup
OUT=$(printf '{"cwd":"%s","tool_name":"Bash","tool_input":{"command":"git log"}}' "$T/proj" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "run_command"; then
  pass "Bash: deny with run_command"
else
  fail "Bash: deny with run_command" "$OUT"
fi

# Test 3: Grep type=ts → deny with find_symbol
clear_dedup
OUT=$(guard_input "Grep" '"pattern":"foo","type":"ts"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "semantic_search"; then
  pass "Grep type=ts: deny"
else
  fail "Grep type=ts: deny" "$OUT"
fi

# Test 4: Grep on .md glob → deny (Grep always routed)
clear_dedup
OUT=$(guard_input "Grep" '"pattern":"foo","glob":"**/*.md"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then pass "Grep .md: deny"; else fail "Grep .md: deny" "$OUT"; fi

# Test 5: Glob on *.ts → deny
clear_dedup
OUT=$(guard_input "Glob" '"pattern":"'"$T/proj/**/*.ts"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then pass "Glob *.ts: deny"; else fail "Glob *.ts: deny" "$OUT"; fi

# Test 6: Glob on *.md → deny (Glob always routed)
clear_dedup
OUT=$(guard_input "Glob" '"pattern":"'"$T/proj/**/*.md"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT"; then pass "Glob *.md: deny"; else fail "Glob *.md: deny" "$OUT"; fi

# Test 7: Read on .ts file → deny with symbols
clear_dedup
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "symbols"; then
  pass "Read .ts: deny with symbols"
else
  fail "Read .ts: deny with symbols" "$OUT"
fi

# Test 8: Read on .md inside project → deny with heading navigation guidance
# Clean up dedup file from previous tests so this gets full reason
clear_dedup
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/README.md"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && echo "$OUT" | grep -q "heading="; then
  pass "Read .md in project: deny with heading navigation"
else
  fail "Read .md in project: deny with heading navigation" "$OUT"
fi

# Test 8b: Read on .md outside project → deny (path-agnostic)
clear_dedup
OUT=$(guard_input "Read" '"file_path":"/tmp/some-skill/SKILL.md"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && echo "$OUT" | grep -q "read_markdown"; then
  pass "Read .md outside project: deny with read_markdown guidance"
else
  fail "Read .md outside project: deny with read_markdown guidance" "$OUT"
fi

# Test 8c: Read on skill SKILL.md inside project → ALLOW (skill-payload exemption,
# 2026-06-12 skill-loading-bootstrap design: verbatim fidelity required, codescout
# has no index over plugin payloads)
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/skills/my-skill/SKILL.md"'"' | node "$HOOK" 2>/dev/null)
if [ -z "$OUT" ]; then
  pass "Read SKILL.md in project: allow (skill-payload exemption)"
else
  fail "Read SKILL.md in project: allow (skill-payload exemption)" "$OUT"
fi

# Test 8d: Read on .md in skills/ subdir inside project → deny (no skills/ exemption)
clear_dedup
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/myplugin/skills/foo/guide.md"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && echo "$OUT" | grep -q "read_markdown"; then
  pass "Read .md in skills/ dir: deny (no skills/ exemption)"
else
  fail "Read .md in skills/ dir: deny (no skills/ exemption)" "$OUT"
fi

# Test 9: block_reads=false → allow source file
# Note: jq's // empty operator treats boolean false as absent; hook reads
# block_reads via jq -r '.block_reads // empty' and compares to string "false",
# so block_reads must be set as a JSON string "false" to trigger the bypass.
write_routing_config "$T/proj" '{"block_reads":"false"}'
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | node "$HOOK" 2>/dev/null)
EC=$?
if [ $EC -eq 0 ] && ! assert_denied "$OUT"; then pass "block_reads=false: allow source"; else fail "block_reads=false: allow source" "$OUT"; fi
rm -f "$T/proj/.claude/codescout-companion.json"

# Test 10: outside workspace_root → still deny (workspace_root no longer relaxes guard)
write_routing_config "$T/proj" '{"workspace_root":"'"$T/proj/src"'"}'
clear_dedup
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "symbols"; then
  pass "outside workspace_root: deny (no relaxation)"
else
  fail "outside workspace_root: deny (no relaxation)" "$OUT"
fi
rm -f "$T/proj/.claude/codescout-companion.json"

# Test 11: Edit on .ts → deny with edit_code
clear_dedup
OUT=$(guard_input "Edit" '"file_path":"'"$T/proj/app.ts"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "edit_code"; then
  pass "Edit .ts: deny with edit_code"
else
  fail "Edit .ts: deny with edit_code" "$OUT"
fi

# Test 12: Edit on .md → deny (Edit now blocks all text)
clear_dedup
OUT=$(guard_input "Edit" '"file_path":"'"$T/proj/README.md"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "edit_code"; then
  pass "Edit .md: deny (path-agnostic)"
else
  fail "Edit .md: deny (path-agnostic)" "$OUT"
fi

# Test 13: Write on .ts → deny with create_file
clear_dedup
OUT=$(guard_input "Write" '"file_path":"'"$T/proj/app.ts"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "create_file"; then
  pass "Write .ts: deny with create_file"
else
  fail "Write .ts: deny with create_file" "$OUT"
fi

# Test 14: Write on .md → deny (Write now blocks all text)
clear_dedup
OUT=$(guard_input "Write" '"file_path":"'"$T/proj/README.md"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" "create_file"; then
  pass "Write .md: deny (path-agnostic)"
else
  fail "Write .md: deny (path-agnostic)" "$OUT"
fi

# Test 15: Read on a .cargo/registry file (deep path inside crate) → deny, crate name not "lib.rs"
# Clean up dedup file from previous tests so this gets full reason
clear_dedup
CARGO_PATH="$HOME/.cargo/registry/src/index.crates.io-abc123/serde-1.0.195/src/lib.rs"
OUT=$(guard_input "Read" "\"file_path\":\"$CARGO_PATH\"" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" 'scope="lib:serde"' && assert_reason_contains "$OUT" "crate 'serde'"; then
  pass "Read .cargo/registry deep path: deny with correct crate name"
else
  CRATE=$(echo "$OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null | grep -oE "crate '[^']+'" | head -1)
  fail "Read .cargo/registry deep path: deny with correct crate name" "crate_hint=$CRATE"
fi

# Test 16: Grep on a .cargo/registry path (deep path inside crate) → deny, crate name not "lib.rs"
# Clean up dedup file from previous tests so this gets full reason
clear_dedup
OUT=$(guard_input "Grep" "\"pattern\":\"Serialize\",\"path\":\"$CARGO_PATH\"" | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT" && assert_reason_contains "$OUT" 'scope="lib:serde"' && assert_reason_contains "$OUT" "crate 'serde'"; then
  pass "Grep .cargo/registry deep path: deny with correct crate name"
else
  CRATE=$(echo "$OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null | grep -oE "crate '[^']+'" | head -1)
  fail "Grep .cargo/registry deep path: deny with correct crate name" "crate_hint=$CRATE"
fi

# Test 17: parallel dedup — first call gets full reason
# Clean up dedup file from previous tests so this gets full reason
clear_dedup
OUT1=$(guard_input "Bash" '"command":"cat foo.rs"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT1" && assert_reason_contains "$OUT1" "run_command"; then
  pass "Bash dedup: first call gets full reason"
else
  fail "Bash dedup: first call gets full reason" "$OUT1"
fi

# Test 18: dedup — second call within the 3s window gets the short pointer.
# Relies on Test 17 above having made the hook write its OWN marker (no manual
# seeding), so this exercises the real atomic-dedup path end to end.
OUT2=$(guard_input "Bash" '"command":"cat bar.rs"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT2" && assert_reason_contains "$OUT2" "see previous message"; then
  pass "Bash dedup: second call gets short reason"
else
  fail "Bash dedup: second call gets short reason" "$OUT2"
fi

# Test 19: different tool type in same window gets its own full reason
clear_dedup
OUT3=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT3" && assert_reason_contains "$OUT3" "symbols"; then
  pass "Read dedup: different tool type gets full reason"
else
  fail "Read dedup: different tool type gets full reason" "$OUT3"
fi

# Test 20: after dedup window cleared, full reason again
clear_dedup
OUT4=$(guard_input "Bash" '"command":"cat baz.rs"' | node "$HOOK" 2>/dev/null)
if assert_denied "$OUT4" && assert_reason_contains "$OUT4" "run_command"; then
  pass "Bash dedup: after window cleared, full reason again"
else
  fail "Bash dedup: after window cleared, full reason again" "$OUT4"
fi

# Emit a Read guard input for an arbitrary file path, JSON-escaping backslashes
# (so we can feed native Windows paths through the hook).
read_input_path() {
  local p="${1//\\/\\\\}"
  printf '{"cwd":"%s","tool_name":"Read","tool_input":{"file_path":"%s"}}' "$T/proj" "$p"
}

# Test 21: Windows backslash skill-payload path → ALLOW (A2 path normalization).
# Before normalization the exemption regexes matched only forward slashes, so a
# backslash path fell through to a wrongful deny.
clear_dedup
OUT=$(read_input_path 'C:\Users\me\.claude\plugins\cache\mp\plug\skills\s\SKILL.md' | node "$HOOK" 2>/dev/null)
if [ -z "$OUT" ]; then
  pass "Windows backslash skill-payload path: allow (normalized exemption)"
else
  fail "Windows backslash skill-payload path: allow (normalized exemption)" "$OUT"
fi

# Test 22: config-dir path written with backslashes under HOME → ALLOW (isConfigDir norm).
clear_dedup
OUT=$(read_input_path "$HOME\\.claude\\settings.json" | node "$HOOK" 2>/dev/null)
if [ -z "$OUT" ]; then
  pass "backslash config-dir path under HOME: allow (normalized exemption)"
else
  fail "backslash config-dir path under HOME: allow (normalized exemption)" "$OUT"
fi

# Test 23: fail-open — an unreadable memories dir must NOT crash the guard (A1).
# The hook must exit 0 and still emit its deny JSON: detect() catches the
# readdirSync throw so HAS_CODESCOUT stays true and routing still fires. (Under
# root, chmod 000 is a no-op, so this degrades to a plain deny check — still a
# valid regression guard on non-root.)
clear_dedup
mkdir -p "$T/proj/.codescout/memories"
chmod 000 "$T/proj/.codescout/memories"
OUT=$(guard_input "Read" '"file_path":"'"$T/proj/app.ts"'"' | node "$HOOK" 2>/dev/null); EC=$?
chmod 755 "$T/proj/.codescout/memories"
if [ $EC -eq 0 ] && assert_denied "$OUT"; then
  pass "unreadable memories dir: fail-open (exit 0, still denies)"
else
  fail "unreadable memories dir: fail-open (exit 0, still denies)" "exit=$EC out=$OUT"
fi

print_summary "pre-tool-guard"
