#!/usr/bin/env bash
# Test matrix for il3-deny-hook.sh.
#
# Covers:
#   1. Live command piped to log-trimmer → DENY
#   2. Buffer-op (grep @cmd_xxx) piped to log-trimmer → ALLOW (buffer whitelist)
#   3. Buffer-op (cat @bg_xyz) piped to head → ALLOW
#   4. Buffer-op (jq @tool_abc) piped to grep → ALLOW
#   5. Non-pipe command → ALLOW
#   6. Pipe to allow-listed verb (jq) → ALLOW (jq not in DENY_PIPE)
#   7. Wrong tool name → ALLOW (hook only fires on run_command)
#   8. @cmd_ ref AFTER first pipe (LHS still live) → DENY

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/il3-deny-hook.sh"
PASS=0
FAIL=0

assert() {
    local label="$1"
    local input="$2"
    local expected="$3"  # "deny" or "allow"
    local got
    got=$(echo "$input" | "$HOOK")
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
    local cmd="$1"
    local tool="${2:-mcp__codescout__run_command}"
    jq -n --arg c "$cmd" --arg t "$tool" '{tool_name:$t, tool_input:{command:$c}}'
}

# 1. Live command → DENY
assert "live-cargo-grep" "$(mkinput 'cargo test | grep FAILED')" "deny"

# 2. Buffer-op grep @cmd_ → ALLOW
assert "buffer-grep-cmd-sort" "$(mkinput 'grep -c EnterWorktree @cmd_3b8e6cc5 | sort -u')" "allow"

# 3. Buffer-op cat @bg_ → ALLOW
assert "buffer-cat-bg-head" "$(mkinput 'cat @bg_abc123 | head -50')" "allow"

# 4. Buffer-op grep @tool_ → ALLOW
assert "buffer-grep-tool-sort" "$(mkinput 'grep error @tool_xyz | sort')" "allow"

# 5. No pipe → ALLOW
assert "no-pipe" "$(mkinput 'cargo test')" "allow"

# 6. Pipe to jq (not in DENY_PIPE) → ALLOW
assert "live-cargo-jq" "$(mkinput 'cargo metadata | jq .packages')" "allow"

# 7. Wrong tool → ALLOW
assert "wrong-tool" "$(mkinput 'cargo test | grep FAIL' 'mcp__codescout__edit_file')" "allow"

# 8. @cmd_ on RHS only (LHS is live cargo) → DENY
assert "ref-on-rhs-only" "$(mkinput 'cargo test | grep FAIL @cmd_abc')" "deny"

# 9. Buffer-op with multi-char id chars → ALLOW
assert "buffer-mixed-id" "$(mkinput 'grep -oE pat @cmd_a1b2c3d4 | uniq')" "allow"

# 10. Real user command from F-incident → ALLOW (this is the friction we fixed)
assert "friction-repro" "$(mkinput 'grep -oE \"\\\"cwd\\\":\\\"[^\\\"]*\\\"\" @cmd_3b8e6cc5 | sort -u')" "allow"

# --- Bounded-LHS cases (2026-05-18 bounded-LHS fix) ---
# 11. cat <file> → bounded → ALLOW
assert "bounded-cat-grep" "$(mkinput 'cat items.txt | grep apple')" "allow"

# 12. ls <dir> → bounded → ALLOW
assert "bounded-ls-head" "$(mkinput 'ls /some/dir | head -20')" "allow"

# 13. grep <pat> <file> (non-recursive) → bounded → ALLOW
assert "bounded-grep-file-wc" "$(mkinput 'grep -oE pat src/lib.rs | sort -u')" "allow"

# 14. awk <prog> <file> → bounded → ALLOW
assert "bounded-awk-sort" "$(mkinput 'awk {print} file.log | sort -u')" "allow"

# 15. sed <prog> <file> → bounded → ALLOW
assert "bounded-sed-head" "$(mkinput 'sed s/foo/bar/ file.txt | head')" "allow"

# 16. find with -maxdepth → bounded → ALLOW
assert "bounded-find-maxdepth" "$(mkinput 'find . -maxdepth 2 -name *.rs | head')" "allow"

# 17. grep -r → recursive → unbounded → DENY
assert "unbounded-grep-recursive" "$(mkinput 'grep -r FAILED src/ | head')" "deny"

# 18. grep -R (capital) → unbounded → DENY
assert "unbounded-grep-capital-R" "$(mkinput 'grep -R pat src/ | wc -l')" "deny"

# 19. grep --recursive → unbounded → DENY
assert "unbounded-grep-long-recursive" "$(mkinput 'grep --recursive pat src/ | sort')" "deny"

# 20. find without -maxdepth → unbounded → DENY
assert "unbounded-find-bare" "$(mkinput 'find / -name *.rs | head')" "deny"

# 21. rg → defaults recursive → unbounded → DENY
assert "unbounded-rg-head" "$(mkinput 'rg pattern | head')" "deny"

# 22. fd → defaults recursive → unbounded → DENY
assert "unbounded-fd-wc" "$(mkinput 'fd .rs | wc -l')" "deny"

echo
echo "Passed: $PASS   Failed: $FAIL"
[[ $FAIL -eq 0 ]]
