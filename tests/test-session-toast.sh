#!/usr/bin/env bash
# tests/test-session-toast.sh — the session-toast mod: its layout is the one a mod needs, it adds
# nothing to a file another harness reads, it is listed in the marketplace and the README, and its own
# tests pass.
# Design: docs/superpowers/specs/2026-11-24-session-toast-design.md.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── session-toast ──"

# One module path, and nothing else in the file: the plugin is Claude Code only.
if jq -e 'has("modules") and (has("hooks") | not) and (.modules == ["./register.ts"])' "$ROOT/session-toast/hooks/hooks.json" >/dev/null 2>&1; then
  ok "session-toast/hooks/hooks.json holds one module path and nothing else"
else bad "session-toast/hooks/hooks.json" "expected { \"modules\": [\"./register.ts\"] }"; fi

# The mod must not touch a file another harness reads.
if jq -e 'has("modules") | not' "$ROOT/codescout-companion/hooks/hooks.json" >/dev/null 2>&1; then
  ok "codescout-companion/hooks/hooks.json has no modules key (Codex and Copilot read it)"
else bad "codescout-companion/hooks/hooks.json" "a modules key was added to the shared file"; fi

# The manifest.
if jq -e '.name == "session-toast" and .version == "0.1.0" and .license == "MIT"' "$ROOT/session-toast/.claude-plugin/plugin.json" >/dev/null 2>&1; then
  ok "plugin.json names session-toast, version 0.1.0, license MIT"
else bad "session-toast/.claude-plugin/plugin.json" "name, version or license is not as the plan says"; fi

# Listed in the marketplace, with no version field (plugin.json is the one source).
if jq -e '[.plugins[] | select(.name == "session-toast" and .source == "./session-toast" and (has("version") | not))] | length == 1' "$ROOT/.claude-plugin/marketplace.json" >/dev/null 2>&1; then
  ok "marketplace.json lists session-toast once, with no version field"
else bad "marketplace.json" "no single session-toast entry, or it carries a version"; fi

# Listed in the README plugin table.
if grep -q '^| \*\*\[session-toast\](\./session-toast/)\*\* | 0\.1\.0 |' "$ROOT/README.md"; then
  ok "README.md plugin table lists session-toast 0.1.0"
else bad "README.md" "no session-toast row with version 0.1.0 in the plugin table"; fi

# The mod's own tests need the claude binary; skip, say so, where it is absent.
if command -v claude >/dev/null 2>&1; then
  if out="$(cd "$ROOT" && claude plugin test session-toast 2>&1)"; then ok "claude plugin test session-toast"
  else bad "claude plugin test session-toast" "$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi
else
  echo "  SKIP: claude not found — the mod's own tests were NOT run"
fi

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" = 0 ]
