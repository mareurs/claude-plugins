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

# 2. required frontmatter keys present
for key in "kind: tracker" "topic:" "origin_session_id:" "branch:" "time_scope:"; do
  if grep -qF "$key" "$TPL"; then ok "frontmatter has '$key'"; else bad "frontmatter '$key'" "not found"; fi
done

# 2b. tags is a LIST containing 'passover' — librarian serializes YAML lists in
# block style ("tags:\n- passover"), not flow style ("tags: [passover]")
if grep -qF "tags:" "$TPL" && grep -qF -- "- passover" "$TPL"; then
  ok "frontmatter has 'tags: [passover]'"
else
  bad "frontmatter 'tags: [passover]'" "not found"
fi

# 3. required body headings present
for h in "## State" "## Next actions" "## Working state" "## Anti-goals" "## Pointers"; do
  if grep -qF "$h" "$TPL"; then ok "section '$h'"; else bad "section '$h'" "not found"; fi
done

# 4. verify-before-trust escape hatch baked into the resume script
if grep -qi "VERIFY" "$TPL"; then ok "verify-before-trust gate present"; else bad "verify gate" "missing VERIFY step in Next actions"; fi

CLAUDEMD="$ROOT/CLAUDE.md"
# 5. discovery query documented verbatim in CLAUDE.md (drift guard)
if grep -qF '{"tags":{"in":["passover"]}}' "$CLAUDEMD"; then
  ok "CLAUDE.md documents the discovery query"
else
  bad "CLAUDE.md discovery query" "marker {\"tags\":{\"in\":[\"passover\"]}} not found"
fi
# 6. CLAUDE.md points at the template path
if grep -qF 'docs/templates/passover-template.md' "$CLAUDEMD"; then
  ok "CLAUDE.md points at template"
else
  bad "CLAUDE.md template pointer" "docs/templates/passover-template.md not referenced"
fi

echo "── passover-template: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
