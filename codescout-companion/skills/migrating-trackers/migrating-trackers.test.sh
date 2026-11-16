#!/usr/bin/env bash
# Colocated test for the migrating-trackers skill.
# Part 1: structural assertions on SKILL.md and its references.
# Part 2: runtime assertions. The worked mapping in references/mapping.md must be legal against a
# real `codescout trackers` (apply exits 0, check is clean). Without a binary that has `trackers`,
# Part 2 SKIPs loudly ("NOT checked") and passes.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SKILL="$SCRIPT_DIR/SKILL.md"
MAPPING_MD="$SCRIPT_DIR/references/mapping.md"
RECOVERY_MD="$SCRIPT_DIR/references/recovery.md"
FIXTURE="$ROOT/tests/lib/tracker-migration-fixture.sh"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

if [ ! -f "$SKILL" ]; then
  fail "skill exists" "no $SKILL"
  echo "$PASS passed, $FAIL failed"; exit 1
fi

# ---- Part 1: structure ----
FM=$(awk 'NR==1&&$0=="---"{f=1;next} f&&$0=="---"{exit} f{print}' "$SKILL")
echo "$FM" | grep -qx 'name: migrating-trackers' && pass "frontmatter name" || fail "frontmatter name" "missing"
echo "$FM" | grep -Eq '^description: *"?Use when' && pass "description starts with 'Use when'" || fail "description" "does not start with 'Use when'"
SIZE=$(wc -c < "$SKILL")
[ "$SIZE" -lt 20480 ] && pass "SKILL.md is $SIZE bytes (< 20480)" || fail "size" "$SIZE bytes"

for needle in 'trackers inventory' 'trackers apply' 'trackers check' '--json' '"refused"' '"ran": false' \
  'already_applied' 'git diff --cached --name-only' '-- <' 'absolute-git-dir' 'reconnaissance-patterns' \
  'tracker-hygiene-log' '-session-log' 'trackers --help' 'cutover plan' '--no-old-catalog'; do
  grep -qF -- "$needle" "$SKILL" && pass "names $needle" || fail "names $needle" "absent"
done

# check runs before the commit
CHECK_LINE=$(grep -nE 'trackers check .*--json' "$SKILL" | head -1 | cut -d: -f1)
COMMIT_LINE=$(grep -nE 'git commit' "$SKILL" | head -1 | cut -d: -f1)
if [ -n "$CHECK_LINE" ] && [ -n "$COMMIT_LINE" ] && [ "$CHECK_LINE" -lt "$COMMIT_LINE" ]; then
  pass "the check line ($CHECK_LINE) comes before the commit line ($COMMIT_LINE)"
else
  fail "check before commit" "check line '${CHECK_LINE:-none}', commit line '${COMMIT_LINE:-none}'"
fi

for banned in 'git add docs/' 'git add -A' 'git push' 'read_markdown' 'edit_markdown'; do
  # A prohibition may name the banned text only inside a line that starts with "Never" or "- Never";
  # the skill keeps them out entirely, so the check is plain.
  grep -qF -- "$banned" "$SKILL" && fail "does not name $banned" "found in SKILL.md" || pass "does not name $banned"
done

links=$(grep -oE 'references/[A-Za-z0-9._-]+\.md' "$SKILL" | sort -u)
if [ -z "$links" ]; then
  fail "links a reference" "none"
else
  for l in $links; do
    [ -f "$SCRIPT_DIR/$l" ] && pass "linked $l exists" || fail "linked $l exists" "missing"
  done
fi

if [ -f "$MAPPING_MD" ]; then
  for needle in 'jq' 'status_values' 'possibles' 'mentions.code' 'sidecar'; do
    grep -qF -- "$needle" "$MAPPING_MD" && pass "mapping.md names $needle" || fail "mapping.md names $needle" "absent"
  done
else
  fail "mapping.md exists" "missing"
fi
if [ -f "$RECOVERY_MD" ]; then
  for needle in 'git status --porcelain' 'already_applied'; do
    grep -qF -- "$needle" "$RECOVERY_MD" && pass "recovery.md names $needle" || fail "recovery.md names $needle" "absent"
  done
else
  fail "recovery.md exists" "missing"
fi

# ---- Part 2: runtime ----
BIN=""
for c in "$(command -v codescout 2>/dev/null || true)" "$HOME/.cargo/bin/codescout"; do
  [ -n "$c" ] && [ -x "$c" ] && { BIN="$c"; break; }
done
if [ -z "$BIN" ]; then
  echo "SKIP: no codescout binary found -- runtime assertions NOT checked"
elif ! "$BIN" trackers --help >/dev/null 2>&1; then
  echo "SKIP: '$BIN trackers --help' fails (binary predates tracker migration) -- runtime assertions NOT checked"
elif ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: jq not found -- runtime assertions NOT checked"
elif [ ! -f "$FIXTURE" ] || [ ! -f "$MAPPING_MD" ]; then
  fail "runtime inputs" "fixture builder or mapping.md missing"
else
  export LIBRARIAN_DB=/nonexistent/x.db
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  EX="$TMP/example.toml"
  awk '/<!-- example-mapping:start -->/{s=1;next} /<!-- example-mapping:end -->/{s=0} s' "$MAPPING_MD" \
    | awk '/^```toml$/{f=1;next} /^```$/{f=0} f' > "$EX"
  [ -s "$EX" ] && pass "example mapping extracted" || fail "example mapping extracted" "empty"

  # place_mapping <repo> <file>: copy into <git dir>/tracker-migration/demo-log.toml, print path
  place_mapping() {
    local gd; gd=$(git -C "$1" rev-parse --absolute-git-dir)
    mkdir -p "$gd/tracker-migration"
    cp "$2" "$gd/tracker-migration/demo-log.toml"
    echo "$gd/tracker-migration/demo-log.toml"
  }

  # 1. apply + check on the good mapping
  R1="$TMP/r1"; bash "$FIXTURE" "$R1" >/dev/null 2>&1
  M1=$(place_mapping "$R1" "$EX")
  AOUT=$("$BIN" trackers apply "$M1" --project "$R1" --no-old-catalog --json 2>/dev/null); arc=$?
  [ "$arc" -eq 0 ] && pass "apply exits 0" || fail "apply exits 0" "exit $arc: $AOUT"
  [ "$(echo "$AOUT" | jq '(.written|length)>0 and (.deleted|length)>0' 2>/dev/null)" = "true" ] \
    && pass "apply lists written and deleted" || fail "apply lists written and deleted" "$AOUT"
  COUT=$("$BIN" trackers check "$M1" --project "$R1" --json 2>/dev/null); crc=$?
  [ "$crc" -eq 0 ] && [ "$(echo "$COUT" | jq '.clean' 2>/dev/null)" = "true" ] \
    && pass "check exits 0 and is clean" || fail "check clean" "exit $crc: $COUT"

  # 2. status_map without fixed-verified: apply refuses
  R2="$TMP/r2"; bash "$FIXTURE" "$R2" >/dev/null 2>&1
  grep -v '^fixed-verified' "$EX" > "$TMP/nostatus.toml"
  M2=$(place_mapping "$R2" "$TMP/nostatus.toml")
  ROUT=$("$BIN" trackers apply "$M2" --project "$R2" --no-old-catalog --json 2>/dev/null); rrc=$?
  [ "$rrc" -eq 1 ] && [ "$(echo "$ROUT" | jq 'has("refused")' 2>/dev/null)" = "true" ] \
    && pass "apply refuses a status_map gap (exit 1, refused key)" || fail "apply refusal" "exit $rrc: $ROUT"

  # 3. not TOML: check refuses
  R3="$TMP/r3"; bash "$FIXTURE" "$R3" >/dev/null 2>&1
  printf 'this is = not [valid toml\n' > "$TMP/broken.toml"
  M3=$(place_mapping "$R3" "$TMP/broken.toml")
  BOUT=$("$BIN" trackers check "$M3" --project "$R3" --json 2>/dev/null); brc=$?
  [ "$brc" -eq 1 ] && [ "$(echo "$BOUT" | jq 'has("refused")' 2>/dev/null)" = "true" ] \
    && pass "check refuses a broken mapping (exit 1, refused key)" || fail "check refusal" "exit $brc: $BOUT"

  # 4. commit by exact names, then check exits 2 with ran=false
  names=$(echo "$AOUT" | jq -r '[.written[], .deleted[], .already_applied[]] | unique | .[]')
  if [ -n "$names" ]; then
    git -C "$R1" config user.email t@example.invalid; git -C "$R1" config user.name t
    # shellcheck disable=SC2086
    (cd "$R1" && echo "$names" | xargs git add -- && git commit -q -m "test: migrate demo-log" -- $(echo "$names" | tr '\n' ' ')) >/dev/null 2>&1
    CC=$("$BIN" trackers check "$M1" --project "$R1" --json 2>/dev/null); ccrc=$?
    [ "$ccrc" -eq 2 ] && [ "$(echo "$CC" | jq '.ran' 2>/dev/null)" = "false" ] \
      && pass "check after the commit exits 2 with ran false" || fail "check after commit" "exit $ccrc: $CC"
  else
    fail "commit names" "apply listed no names"
  fi
fi

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
