#!/bin/bash
# tests/test-profile-list-single-source.sh — scripts/lib-profiles.sh
#
# release.sh, bump-cache.sh and check-profile-parity.sh each hardcoded the same
# three profiles. ~/.claude-stef was left out of all three, so the 1.20.22 release
# seeded no cache there and the record stayed on 1.20.21, with the wake hook missing.
# The parity gate said "3 profile(s)" and passed. Found 2026-10-29.
#
# The list now lives in scripts/lib-profiles.sh. This test pins that it holds all
# four profiles and that no script keeps a private copy that could drift again.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── profile-list-single-source ──"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

LIB="$SCRIPTS/lib-profiles.sh"
if [ ! -f "$LIB" ]; then
  fail "scripts/lib-profiles.sh exists" "missing"
else
  pass "scripts/lib-profiles.sh exists"
  got="$(HOME=/h bash -c "source '$LIB'; printf '%s\n' \"\${PROFILES[@]}\"")"
  want="$(printf '%s\n' /h/.claude /h/.claude-sdd /h/.claude-kat /h/.claude-stef)"
  if [ "$got" = "$want" ]; then pass "PROFILES lists the four profiles, rooted at \$HOME"
  else fail "PROFILES lists the four profiles, rooted at \$HOME" "got: $got"; fi
fi

# Each script must read the list from the library, and must not assign its own.
for s in release.sh bump-cache.sh check-profile-parity.sh; do
  if grep -q 'lib-profiles.sh' "$SCRIPTS/$s"; then pass "$s sources lib-profiles.sh"
  else fail "$s sources lib-profiles.sh" "no source line"; fi
  if grep -qE '^(PROFILES=|for PROFILE in ~/)' "$SCRIPTS/$s"; then
    fail "$s keeps no private profile list" "$(grep -nE '^(PROFILES=|for PROFILE in ~/)' "$SCRIPTS/$s" | head -1)"
  else pass "$s keeps no private profile list"; fi
done

print_summary "profile-list-single-source"
