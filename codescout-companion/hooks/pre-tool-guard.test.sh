#!/usr/bin/env bash
# Test matrix for pre-tool-guard.sh — path-agnostic contract (2026-05-21).
#
# Bash, Read, Edit, Write, Grep, and Glob all route to codescout regardless
# of path or extension. Native Read of binary images/PDF is the sole
# exemption (codescout has no renderer for those). workspace_root no longer
# relaxes the guard.
#
# Sources `pre-tool-guard.sh` as a black box; relies on detect-tools.sh →
# detect.py to fill in HAS_CODESCOUT / BLOCK_READS / WORKSPACE_ROOT from
# the announced $CWD. ACTIVE_CWD uses code-explorer to exercise the
# cross-repo case (its sibling claude-plugins acts as SIBLING_CWD).

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/pre-tool-guard.sh"
ACTIVE_CWD="/home/marius/work/claude/code-explorer"
SIBLING_CWD="/home/marius/work/claude/claude-plugins"
PASS=0
FAIL=0

verdict() {
    local out="$1"
    if [[ -z "$out" ]]; then
        echo allow
    else
        echo "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null || echo allow
    fi
}

# Clear the 3-second dedup window so each test runs with a fresh slate.
clean() { /bin/rm -f /tmp/cs-block-* 2>/dev/null; }

assert() {
    local label="$1"
    local cmd="$2"
    local expected="$3"  # "deny" or "allow"
    clean
    local input
    input=$(jq -n --arg c "$cmd" --arg cwd "$ACTIVE_CWD" \
        '{tool_name:"Bash", cwd:$cwd, tool_input:{command:$c}}')
    local got
    got=$(verdict "$(echo "$input" | "$HOOK")")
    if [[ "$got" == "$expected" ]]; then
        echo "PASS [$label]"
        PASS=$((PASS+1))
    else
        echo "FAIL [$label]: expected=$expected got=$got"
        echo "  cmd: $cmd"
        FAIL=$((FAIL+1))
    fi
}

# General assert: arbitrary tool_name + tool_input JSON.
# Usage: assert_tool <label> <tool_name> <tool_input_json> <expected>
assert_tool() {
    local label="$1" tool="$2" tinput="$3" expected="$4"
    clean
    local input
    input=$(jq -n --arg t "$tool" --arg cwd "$ACTIVE_CWD" --argjson ti "$tinput" \
        '{tool_name:$t, cwd:$cwd, tool_input:$ti}')
    local got
    got=$(verdict "$(echo "$input" | "$HOOK")")
    if [[ "$got" == "$expected" ]]; then
        echo "PASS [$label]"; PASS=$((PASS+1))
    else
        echo "FAIL [$label]: expected=$expected got=$got"
        echo "  tool=$tool input=$tinput"
        FAIL=$((FAIL+1))
    fi
}

# Read/Edit/Write file_path helper.
assert_file() {  # <label> <tool_name> <file_path> <expected>
    assert_tool "$1" "$2" "$(jq -nc --arg p "$3" '{file_path:$p}')" "$4"
}

# --- Cross-repo cd: hardened — no longer an escape (all Bash → run_command) ---
assert "cd-sibling-abs"      "cd $SIBLING_CWD && git status"                        "deny"
assert "cd-sibling-quoted"   "cd \"/home/marius/work/mirela/backend-kotlin\" && git status" "deny"
assert "cd-sibling-tilde"    "cd ~/work/claude/claude-plugins && git log -1"        "deny"
assert "cd-sibling-relative" "cd ../claude-plugins && git status"                   "deny"
assert "cd-tmp"              "cd /tmp && ls"                                        "deny"

# --- In-workspace bash: must remain blocked ---
assert "bare-cargo-test"     "cargo test"                                           "deny"
assert "cd-subdir-in-ws"     "cd src && ls"                                         "deny"
assert "cd-abs-back-into-ws" "cd $ACTIVE_CWD/src && ls"                             "deny"
assert "grep-on-source"      "grep foo src/main.rs"                                 "deny"

# --- Read: path-agnostic, type-gated ---
assert_file "read-xrepo-md"     "Read" "$SIBLING_CWD/buddy/data/gates.md"        "deny"
assert_file "read-skill-md"     "Read" "$ACTIVE_CWD/skills/foo/SKILL.md"         "deny"
assert_file "read-skills-dir"   "Read" "$ACTIVE_CWD/skills/foo/notes.md"         "deny"
assert_file "read-inrepo-md"    "Read" "$ACTIVE_CWD/docs/x.md"                   "deny"
assert_file "read-xrepo-source" "Read" "$SIBLING_CWD/buddy/scripts/statusline.py" "deny"
assert_file "read-json"         "Read" "$ACTIVE_CWD/package.json"               "deny"
assert_file "read-env"          "Read" "$ACTIVE_CWD/.env"                       "deny"
assert_file "read-txt"          "Read" "$ACTIVE_CWD/notes.txt"                  "deny"
assert_file "read-png-allow"    "Read" "$ACTIVE_CWD/diagram.png"               "allow"
assert_file "read-pdf-allow"    "Read" "$ACTIVE_CWD/spec.pdf"                  "allow"

# --- Edit / Write: path-agnostic, all text ---
assert_file "edit-xrepo-source" "Edit"  "$SIBLING_CWD/buddy/scripts/statusline.py" "deny"
assert_file "edit-inrepo-json"  "Edit"  "$ACTIVE_CWD/tsconfig.json"            "deny"
assert_file "write-xrepo-src"   "Write" "$SIBLING_CWD/new_module.py"          "deny"
assert_file "write-inrepo-yaml" "Write" "$ACTIVE_CWD/config.yaml"            "deny"
assert_file "edit-png-allow"   "Edit"  "$ACTIVE_CWD/diagram.png"             "allow"
assert_file "write-pdf-allow"  "Write" "$ACTIVE_CWD/spec.pdf"                "allow"

# --- Grep / Glob: always routed ---
assert_tool "grep-any"  "Grep" '{"pattern":"foo","path":"src","output_mode":"content"}' "deny"
assert_tool "glob-any"  "Glob" '{"pattern":"**/*.py"}'                                  "deny"

clean
echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
