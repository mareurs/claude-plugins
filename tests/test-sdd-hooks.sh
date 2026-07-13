#!/usr/bin/env bash
# tests/test-sdd-hooks.sh — behavior tests for the SDD Node hooks (cross-platform port).
# The hooks run cross-platform; this test harness stays bash (dev/CI only) to match
# run-all.sh, and invokes the hooks via `node`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$ROOT/sdd/hooks"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

check_has() { # DESC EXPECTED ACTUAL — ACTUAL must contain EXPECTED
  case "$3" in
    *"$2"*) pass ;;
    *) fail "$1 — expected substring: $2 | got: $3" ;;
  esac
}

check_empty() { # DESC ACTUAL — ACTUAL must be empty
  if [ -z "$2" ]; then pass; else fail "$1 — expected empty | got: $2"; fi
}

run() { printf '%s' "$2" | node "$HOOKS/$1"; }

PROJ="$(mktemp -d)"
MARKER="${TMPDIR:-/tmp}/.sdd-reviewed-$(printf '%s' "$PROJ" | md5sum | cut -c1-8)"
cleanup() { rm -rf "$PROJ"; rm -f "$MARKER"; }
trap cleanup EXIT

mkdir -p "$PROJ/memory/specs" "$PROJ/memory/plans"

# --- session-start ---
check_empty "session-start: no constitution → empty" "$(run session-start.mjs "{\"cwd\":\"$PROJ\"}")"

echo "# Constitution" > "$PROJ/memory/constitution.md"

out="$(run session-start.mjs "{\"cwd\":\"$PROJ\"}")"
check_has "session-start: active → SDD banner" "SDD is active" "$out"
check_has "session-start: default enforcement warn" "Enforcement: warn" "$out"

printf -- '---\nenforcement: strict\n---\n' > "$PROJ/memory/sdd-config.md"
check_has "session-start: strict enforcement parsed" "Enforcement: strict" "$(run session-start.mjs "{\"cwd\":\"$PROJ\"}")"

# --- spec-guard ---
write_in="{\"cwd\":\"$PROJ\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$PROJ/src/app.py\"}}"
check_has "spec-guard: strict + no specs → deny" '"permissionDecision":"deny"' "$(run spec-guard.mjs "$write_in")"

printf -- '---\nenforcement: warn\n---\n' > "$PROJ/memory/sdd-config.md"
check_has "spec-guard: warn + no specs → context" "additionalContext" "$(run spec-guard.mjs "$write_in")"

md_in="{\"cwd\":\"$PROJ\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$PROJ/notes.md\"}}"
check_empty "spec-guard: .md allowed" "$(run spec-guard.mjs "$md_in")"

echo "# spec" > "$PROJ/memory/specs/feature.md"
check_empty "spec-guard: specs exist → allowed" "$(run spec-guard.mjs "$write_in")"
rm -f "$PROJ/memory/specs/feature.md"

# --- review-guard ---
printf -- '---\nenforcement: strict\n---\n' > "$PROJ/memory/sdd-config.md"
commit_in="{\"cwd\":\"$PROJ\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m x\"}}"
check_has "review-guard: strict + no marker → deny" '"permissionDecision":"deny"' "$(run review-guard.mjs "$commit_in")"

( cd "$PROJ" && node "$HOOKS/mark-reviewed.mjs" )
check_empty "review-guard: after mark-reviewed → allowed" "$(run review-guard.mjs "$commit_in")"

noncommit_in="{\"cwd\":\"$PROJ\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls -la\"}}"
check_empty "review-guard: non-commit → allowed" "$(run review-guard.mjs "$noncommit_in")"

# --- subagent-inject ---
check_empty "subagent-inject: Bash skipped" "$(run subagent-inject.mjs "{\"cwd\":\"$PROJ\",\"agent_type\":\"Bash\"}")"
check_has "subagent-inject: Plan → guidance" "Plan must stay within spec scope" "$(run subagent-inject.mjs "{\"cwd\":\"$PROJ\",\"agent_type\":\"Plan\"}")"
check_has "subagent-inject: Explore → routing" "TOOL ROUTING" "$(run subagent-inject.mjs "{\"cwd\":\"$PROJ\",\"agent_type\":\"Explore\"}")"

echo "  sdd hooks: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
