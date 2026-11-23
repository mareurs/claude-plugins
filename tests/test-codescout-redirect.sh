#!/usr/bin/env bash
# tests/test-codescout-redirect.sh — the codescout-redirect mod: its copy of the guard's pure rules
# has not drifted, that module stays loadable by a mod (no Node import), and the mod's own tests pass.
# Design: docs/superpowers/specs/2026-11-24-codescout-redirect-mod-design.md.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/codescout-companion/hooks/guard-rules.mjs"
COPY="$ROOT/codescout-redirect/hooks/guard-rules.mjs"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── codescout-redirect ──"

if cmp -s "$SRC" "$COPY"; then ok "guard-rules.mjs is byte-identical in codescout-redirect"
else bad "guard-rules.mjs drifted" "run scripts/sync-codescout-redirect.sh"; fi

# A hooks module has no Node: a shared rules file that imports `node:` cannot load in the mod.
if grep -nE "^[[:space:]]*import[[:space:]].*['\"]node:|require\(" "$SRC" >/dev/null; then
  bad "guard-rules.mjs imports Node" "the mod cannot load it; keep the rules pure"
else ok "guard-rules.mjs has no node: import"; fi

# The mod must not touch a file another harness reads.
if jq -e 'has("modules") and (has("hooks") | not)' "$ROOT/codescout-redirect/hooks/hooks.json" >/dev/null 2>&1; then
  ok "codescout-redirect/hooks/hooks.json holds modules only"
else bad "codescout-redirect/hooks/hooks.json" "expected only a modules key"; fi
if jq -e 'has("modules") | not' "$ROOT/codescout-companion/hooks/hooks.json" >/dev/null 2>&1; then
  ok "codescout-companion/hooks/hooks.json has no modules key (Codex and Copilot read it)"
else bad "codescout-companion/hooks/hooks.json" "a modules key was added to the shared file"; fi

# The mod's own tests need the claude binary; skip, say so, where it is absent.
if command -v claude >/dev/null 2>&1; then
  if out="$(cd "$ROOT" && claude plugin test codescout-redirect 2>&1)"; then ok "claude plugin test codescout-redirect"
  else bad "claude plugin test codescout-redirect" "$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi
else
  echo "  SKIP: claude not found — the mod's own tests were NOT run"
fi

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" = 0 ]
