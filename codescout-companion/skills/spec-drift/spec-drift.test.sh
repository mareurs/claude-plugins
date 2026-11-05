#!/usr/bin/env bash
# Structural test for the spec-drift skill. The runnable legality of its event_create call is
# covered by tests/test-skill-call-legality.sh; this file checks the skill's shape only.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$SCRIPT_DIR/SKILL.md"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

if [ ! -f "$SKILL" ]; then
  fail "skill exists" "no $SKILL"
  echo "$PASS passed, $FAIL failed"; exit 1
fi

# Frontmatter is the first block between two `---` lines.
FM=$(awk 'NR==1&&$0=="---"{f=1;next} f&&$0=="---"{exit} f{print}' "$SKILL")
echo "$FM" | grep -qx 'name: spec-drift' && pass "frontmatter name: spec-drift" || fail "frontmatter name" "missing 'name: spec-drift'"
echo "$FM" | grep -Eq '^description: *"?Use when' && pass "description starts with 'Use when'" || fail "description" "does not start with 'Use when'"

SIZE=$(wc -c < "$SKILL")
[ "$SIZE" -lt 20480 ] && pass "SKILL.md is $SIZE bytes (< 20480)" || fail "size" "$SIZE bytes"

for needle in 'event_create' '"verdict"' 'outcome'; do
  grep -qF -- "$needle" "$SKILL" && pass "names $needle" || fail "names $needle" "absent"
done

for banned in 'read_markdown' 'edit_markdown' 'Serena' 'memory/specs'; do
  grep -qF -- "$banned" "$SKILL" && fail "does not name $banned" "found in SKILL.md" || pass "does not name $banned"
done

# Every references/*.md the skill links must exist.
links=$(grep -oE 'references/[A-Za-z0-9._-]+\.md' "$SKILL" | sort -u)
if [ -z "$links" ]; then
  fail "links a reference" "SKILL.md links no references/*.md"
else
  for l in $links; do
    [ -f "$SCRIPT_DIR/$l" ] && pass "linked $l exists" || fail "linked $l exists" "missing"
  done
fi

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
