#!/usr/bin/env bash
# Test matrix for pre-tool-guard.sh — path-agnostic contract (2026-05-21).
#
# Bash, Read, Edit, Write, Grep, and Glob all route to codescout regardless
# of path or extension. Native Read has two exemptions: binary images/PDF
# (codescout has no renderer) and skill payloads (SKILL.md / lens addenda /
# references, plugin cache, .buddy trees — verbatim fidelity required; see
# 2026-06-12-skill-loading-bootstrap-design.md). workspace_root no longer
# relaxes the guard.
#
# Sources `pre-tool-guard.sh` as a black box; relies on detect-tools.sh →
# detect.py to fill in HAS_CODESCOUT / BLOCK_READS / WORKSPACE_ROOT from
# the announced $CWD. ACTIVE_CWD uses codescout to exercise the
# cross-repo case (its sibling claude-plugins acts as SIBLING_CWD).

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/pre-tool-guard.sh"
ACTIVE_CWD="/home/marius/work/claude/codescout"
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
assert_file "read-skills-dir"   "Read" "$ACTIVE_CWD/skills/foo/notes.md"         "deny"
assert_file "read-inrepo-md"    "Read" "$ACTIVE_CWD/docs/x.md"                   "deny"
assert_file "read-xrepo-source" "Read" "$SIBLING_CWD/buddy/scripts/statusline.py" "deny"
assert_file "read-json"         "Read" "$ACTIVE_CWD/package.json"               "deny"
assert_file "read-env"          "Read" "$ACTIVE_CWD/.env"                       "deny"
assert_file "read-txt"          "Read" "$ACTIVE_CWD/notes.txt"                  "deny"
assert_file "read-png-allow"    "Read" "$ACTIVE_CWD/diagram.png"               "allow"
assert_file "read-pdf-allow"    "Read" "$ACTIVE_CWD/spec.pdf"                  "allow"

# --- Read: skill-payload exemption (2026-06-12) ---
assert_file "read-skill-md-allow"    "Read" "$ACTIVE_CWD/skills/foo/SKILL.md"                                    "allow"
assert_file "read-skill-lens-allow"  "Read" "$SIBLING_CWD/buddy/skills/data-leakage-snow-pheasant/_llm.md"      "allow"
assert_file "read-skill-refs-allow"  "Read" "$SIBLING_CWD/codescout-companion/skills/reconnaissance/references/reconnaissance-patterns-template.md" "allow"
assert_file "read-plugin-cache-allow" "Read" "$HOME/.claude/plugins/cache/sdd-misc-plugins/buddy/0.7.17/data/gates.md" "allow"
assert_file "read-dot-buddy-allow"   "Read" "$ACTIVE_CWD/.buddy/memory/debugging-yeti/lesson.md"                "allow"
assert_file "read-buddy-home-allow"  "Read" "$HOME/.buddy/skills/custom-buddy/SKILL.md"                         "allow"
# Non-payload shapes inside skills/ stay denied (read-skills-dir above);
# sibling-repo data files stay denied (read-xrepo-md above — the summon hook
# injects gates/protocol; native Read of them is still routed to codescout).

# --- Read: harness persisted-output exemption (tool-results/, 2026-06-14) ---
# An over-cap summon payload is persisted to .../tool-results/ and must be
# readable back natively (F-3 in skill-loading-session-log.md).
assert_file "read-tool-results-allow"  "Read"  "$HOME/.claude-kat/projects/-home-x/abc-uuid/tool-results/hook-123-stdout.txt" "allow"
assert_file "read-tool-results-allow2" "Read"  "$ACTIVE_CWD/.codescout/tool-results/big-output.txt"                          "allow"
# Read-only exemption: Edit/Write to a tool-results path stay blocked.
assert_file "edit-tool-results-deny"   "Edit"  "$HOME/.claude/projects/x/uuid/tool-results/hook-9-stdout.txt"                 "deny"
assert_file "write-tool-results-deny"  "Write" "$HOME/.claude/projects/x/uuid/tool-results/hook-9-stdout.txt"                 "deny"

# --- Read: profile config-dir exemption (plans/skills/settings under ~/.claude*) ---
# Content under a CC config dir is not project source — native read passes through.
assert_file "read-config-plan-allow"     "Read" "$HOME/.claude-sdd/plans/my-plan.md"        "allow"
assert_file "read-config-skill-allow"    "Read" "$HOME/.claude-sdd/skills/foo/notes.md"     "allow"
assert_file "read-config-settings-allow" "Read" "$HOME/.claude/settings.json"               "allow"
assert_file "read-config-source-allow"   "Read" "$HOME/.claude-kat/plugins/cache/x/y/z.py"  "allow"
# Read-only: Edit/Write under a config dir stay blocked.
assert_file "edit-config-deny"  "Edit"  "$HOME/.claude-sdd/plans/my-plan.md" "deny"
assert_file "write-config-deny" "Write" "$HOME/.claude-sdd/skills/foo/x.md"  "deny"
# Grep/Glob scoped to a config dir are exempt; project-scoped stay blocked (grep-any/glob-any above).
assert_tool "grep-config-allow" "Grep" "$(jq -nc --arg p "$HOME/.claude-sdd" '{pattern:"foo",path:$p,output_mode:"content"}')" "allow"
assert_tool "glob-config-allow" "Glob" "$(jq -nc --arg p "$HOME/.claude-sdd/skills/**/*.md" '{pattern:$p}')" "allow"

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
