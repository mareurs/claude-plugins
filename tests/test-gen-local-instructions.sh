#!/bin/bash
# tests/test-gen-local-instructions.sh
#
# scripts/gen-local-instructions.sh turns one local facts file into the two local
# instruction files of this repository. Codex loads ONE file per directory and an
# AGENTS.override.md replaces AGENTS.md (measured on Codex 0.171.0, 2026-11-25;
# docs: "Codex includes at most one file per directory"), so the override must carry
# the full text of AGENTS.md followed by the facts. Claude Code loads CLAUDE.local.md
# in addition to CLAUDE.md, so that file holds the facts only.
source "$(dirname "${BASH_SOURCE[0]}")/lib/fixtures.sh"

echo "── gen-local-instructions ──"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN="$REPO_ROOT/scripts/gen-local-instructions.sh"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# A repo-shaped fixture: the script resolves its root from its own location.
mkroot() {
  local r="$1"
  mkdir -p "$r/scripts" "$r/.codescout"
  cp "$GEN" "$r/scripts/gen-local-instructions.sh" 2>/dev/null
  printf '# AGENTS.md\n\nPublic rule.\n' > "$r/AGENTS.md"
}

# 1. No facts file: nothing is written, exit 0, and the script says why.
R1="$T/nofacts"; mkroot "$R1"
OUT=$(bash "$R1/scripts/gen-local-instructions.sh" 2>&1); EC=$?
if [ "$EC" -eq 0 ] && [ ! -e "$R1/AGENTS.override.md" ] && [ ! -e "$R1/CLAUDE.local.md" ] \
   && echo "$OUT" | grep -q 'no .codescout/private-facts.md'; then
  pass "no facts file: writes nothing, says so, exit 0"
else
  fail "no facts file: writes nothing, says so, exit 0" "ec=$EC out=$OUT"
fi

# 2. Facts present: the override is AGENTS.md then the facts; CLAUDE.local.md is the facts.
R2="$T/facts"; mkroot "$R2"
printf '## Facts\n\n- Machine fact one.\n' > "$R2/.codescout/private-facts.md"
bash "$R2/scripts/gen-local-instructions.sh" >/dev/null 2>&1; EC=$?
EXPECT=$(printf '# AGENTS.md\n\nPublic rule.\n\n## Facts\n\n- Machine fact one.\n')
if [ "$EC" -eq 0 ] && [ "$(cat "$R2/AGENTS.override.md" 2>/dev/null)" = "$EXPECT" ]; then
  pass "override = AGENTS.md + blank line + facts"
else
  fail "override = AGENTS.md + blank line + facts" "ec=$EC got=$(cat "$R2/AGENTS.override.md" 2>/dev/null)"
fi
if cmp -s "$R2/CLAUDE.local.md" "$R2/.codescout/private-facts.md"; then
  pass "CLAUDE.local.md holds the facts only"
else
  fail "CLAUDE.local.md holds the facts only" "$(cat "$R2/CLAUDE.local.md" 2>/dev/null)"
fi

# 3. --check is clean right after a run, and goes red when AGENTS.md changes.
bash "$R2/scripts/gen-local-instructions.sh" --check >/dev/null 2>&1; EC=$?
if [ "$EC" -eq 0 ]; then pass "--check: clean after a run"; else fail "--check: clean after a run" "ec=$EC"; fi
printf 'A new public rule.\n' >> "$R2/AGENTS.md"
OUT=$(bash "$R2/scripts/gen-local-instructions.sh" --check 2>&1); EC=$?
if [ "$EC" -eq 1 ] && echo "$OUT" | grep -q 'AGENTS.override.md'; then
  pass "--check: stale override after AGENTS.md changes (exit 1, names the file)"
else
  fail "--check: stale override after AGENTS.md changes (exit 1, names the file)" "ec=$EC out=$OUT"
fi

# 4. --check is red when a generated file is missing but the facts exist.
rm -f "$R2/CLAUDE.local.md"
bash "$R2/scripts/gen-local-instructions.sh" >/dev/null 2>&1
rm -f "$R2/CLAUDE.local.md"
OUT=$(bash "$R2/scripts/gen-local-instructions.sh" --check 2>&1); EC=$?
if [ "$EC" -eq 1 ] && echo "$OUT" | grep -q 'CLAUDE.local.md'; then
  pass "--check: missing CLAUDE.local.md is reported"
else
  fail "--check: missing CLAUDE.local.md is reported" "ec=$EC out=$OUT"
fi

# 5. --check with no facts file is green (a clone without the facts has nothing to check).
OUT=$(bash "$R1/scripts/gen-local-instructions.sh" --check 2>&1); EC=$?
if [ "$EC" -eq 0 ]; then pass "--check: no facts file is green"; else fail "--check: no facts file is green" "ec=$EC out=$OUT"; fi

# 6. The real repository ignores both generated files, so a run never dirties the tree.
if git -C "$REPO_ROOT" check-ignore -q AGENTS.override.md && git -C "$REPO_ROOT" check-ignore -q CLAUDE.local.md; then
  pass "both generated files are gitignored"
else
  fail "both generated files are gitignored" "$(git -C "$REPO_ROOT" check-ignore -v AGENTS.override.md CLAUDE.local.md 2>&1)"
fi

# 7. The real repository: generated files, when present, are current.
if [ -f "$REPO_ROOT/.codescout/private-facts.md" ]; then
  if bash "$GEN" --check >/dev/null 2>&1; then
    pass "this checkout: generated files are current"
  else
    fail "this checkout: generated files are current" "run scripts/gen-local-instructions.sh"
  fi
fi

print_summary
