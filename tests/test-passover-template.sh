#!/usr/bin/env bash
# tests/test-passover-template.sh — passover template presence + schema
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/docs/templates/passover-template.md"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── passover-template ──"

# 1. template file exists
if [ -f "$TPL" ]; then ok "template exists"; else bad "template exists" "missing $TPL"; fi

# 2. required frontmatter keys present (tags is a LIST; passover is literal)
for key in "kind: tracker" "tags: [passover]" "topic:" "origin_session_id:" "branch:" "time_scope:"; do
  if grep -qF "$key" "$TPL"; then ok "frontmatter has '$key'"; else bad "frontmatter '$key'" "not found"; fi
done

# 3. required body headings present
for h in "## State" "## Next actions" "## Working state" "## Anti-goals" "## Pointers"; do
  if grep -qF "$h" "$TPL"; then ok "section '$h'"; else bad "section '$h'" "not found"; fi
done

# 4. verify-before-trust escape hatch baked into the resume script
if grep -qi "VERIFY" "$TPL"; then ok "verify-before-trust gate present"; else bad "verify gate" "missing VERIFY step in Next actions"; fi

echo "── passover-template: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
