#!/usr/bin/env bash
# Colocated test for the migrating-trackers skill.
# Part 1: structural assertions on SKILL.md and its references. This part is PHRASE-MATCHING: it
# proves the text says what it should, not that an agent follows it (the agent scenarios in
# tests/scenarios/migrating-trackers.md do that).
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
  'already_applied' 'git diff --cached --name-only' 'absolute-git-dir' 'reconnaissance-patterns' \
  'tracker-hygiene-log' 'trackers --help' 'cutover plan' '--no-old-catalog'; do
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

for banned in 'git add docs/' 'git add -A' 'git add .' 'git commit -a' 'git push' 'read_markdown' 'edit_markdown'; do
  # A prohibition may name the banned text only inside a line that starts with "Never" or "- Never";
  # the skill keeps them out entirely, so the check is plain.
  grep -qF -- "$banned" "$SKILL" && fail "does not name $banned" "found in SKILL.md" || pass "does not name $banned"
done

grep -qE 'git commit -m .* --pathspec-from-file' "$SKILL" && pass "commit line carries a pathspec" || fail "commit line carries a pathspec" "absent"

# I-2: Step 8 stages and commits by a names file, never by retyped names
line_of() { grep -F -- "$1" "$2" | head -1; }
grep -qE 'git add --pathspec-from-file' "$SKILL" && ! grep -qE 'git add -- <' "$SKILL" \
  && pass "Step 8 stages by pathspec file" || fail "Step 8 staging" "no pathspec-from-file add, or a retyped add"
grep -F 'unique' "$SKILL" | grep -qF '.names' && pass "Step 8 builds the names file with jq" || fail "Step 8 names file" "absent"

# I-1: untracked-files=all in the snapshot (recovery) and in Step 7; restore uses the apply list;
# no destructive command appears in either file as an instruction (a line with never/do not is a prohibition)
grep -qF -- '--untracked-files=all' "$RECOVERY_MD" && pass "recovery.md snapshot uses --untracked-files=all" || fail "recovery untracked-files" "absent"
line_of '**Review.**' "$SKILL" | grep -qF -- '--untracked-files=all' && pass "Step 7 uses --untracked-files=all" || fail "Step 7 untracked-files" "absent"
line_of '## Check is not clean' "$RECOVERY_MD" >/dev/null
grep -A2 '^## Check is not clean' "$RECOVERY_MD" | grep -qF 'exactly the union' && pass "restore after a clean apply uses the apply list" || fail "restore list" "absent"
for f in "$SKILL" "$RECOVERY_MD"; do
  bad=$(grep -nE 'git clean|git checkout -- |rm -rf' "$f" | grep -vE '[Nn]ever|[Dd]o not|[Dd]on.t' || true)
  [ -z "$bad" ] && pass "$(basename "$f") has no destructive instruction" || fail "$(basename "$f") destructive instruction" "$bad"
done

# M5: no repo-specific names in a shipped skill
grep -qE 'bistriceanu|bug-fix-session-log' "$SKILL" && fail "no repo-specific names" "found" || pass "no repo-specific names in SKILL.md"
# M7: where the cutover export names come from
line_of '**Catalog facts.**' "$SKILL" > "${TMPDIR:-/tmp}/m7.$$"
m7=${TMPDIR:-/tmp}/m7.$$
if grep -qF '.apply.written' "$m7" && grep -qF '.apply.renamed' "$m7" && grep -qF '.apply.unchanged' "$m7" \
   && grep -qF -- '--untracked-files=all' "$m7" && grep -qF -- '--pathspec-from-file' "$m7"; then
  pass "Step 0.3 builds the export names from written, renamed and unchanged, with a snapshot first"
else fail "Step 0.3 export names" "line lacks written/renamed/unchanged, the snapshot or pathspec-from-file"; fi
rm -f "$m7"
# Ruling 11: a partial export is never committed; the directory exists before the first write
l03=$(line_of '**Catalog facts.**' "$SKILL")
if echo "$l03" | grep -qF '.apply.refused' && echo "$l03" | grep -qF 'partial export' && echo "$l03" | grep -qF 'STOP' \
   && echo "$l03" | grep -qF 'mkdir -p'; then
  pass "Step 0.3 stops on a partial export and creates the tracker-migration directory"
else fail "Step 0.3 partial export" "line lacks .apply.refused, partial export, STOP or mkdir -p"; fi
if echo "$l03" | grep -qF 'subset of the names' && ! echo "$l03" | grep -qF 'equal the names' \
   && echo "$l03" | grep -qF '.report_errors' && echo "$l03" | grep -qF '"ran": false' && echo "$l03" | grep -qF 'cutover.before.txt'; then
  pass "Step 0.3 compares as a subset, handles report_errors and exit 2, names the snapshot file"
else fail "Step 0.3 subset" "line lacks 'subset of the names', has 'equal the names', or lacks .report_errors, exit 2 shape or the snapshot file"; fi
if command -v jq >/dev/null 2>&1; then
  # the filter the skill prescribes must hold both sides of a rename (shape from ApplyOutcome: renamed is [[old,new]])
  f=$(line_of '**Catalog facts.**' "$SKILL" | grep -oE "\[\.apply\.written\[\][^']*" | head -1)
  got=$(echo '{"apply":{"written":["b.md"],"renamed":[["old.md","new.md"]],"unchanged":["c.md"],"refused":[]}}' | jq -r "$f" | tr '\n' ' ')
  [ "$got" = "b.md c.md new.md old.md " ] && pass "export names filter keeps both rename paths" || fail "export names filter" "got '$got' from '$f'"
fi
# I-3: row-only created comes from blame
grep -F '`row_only`' "$MAPPING_MD" | grep -qF 'git blame' && pass "mapping.md sources the row-only date from blame" || fail "row-only date source" "absent"

# check refusal shapes (manual: three cases) and the three result shapes in Step 6
for needle in 'normalised repository path' 'target.existing' 'does not parse' '"reason"'; do
  grep -qF -- "$needle" "$SKILL" && pass "names check refusal item: $needle" || fail "names check refusal item: $needle" "absent"
done
grep -F '**Check.**' "$SKILL" | grep -qF 'blocking' && grep -F '**Check.**' "$SKILL" | grep -qF 'refused' \
  && pass "Step 6 parses blocking and refused shapes" || fail "Step 6 shapes" "Step 6 lacks blocking or refused"
# refactor round 1: each assertion is scoped to the step's own line
line_of() { grep -F -- "$1" "$2" | head -1; }
line_of '**Inventory.**' "$SKILL" | grep -qF 'readme_body' && line_of '**Inventory.**' "$SKILL" | grep -qF 'silently' \
  && pass "Step 2 handles a supplied mapping (readme routing, no silent edit)" || fail "Step 2 supplied mapping" "Inventory line lacks readme_body or silently"
line_of '1. **Binary.**' "$SKILL" | grep -qF 'trackers apply --help' && line_of '1. **Binary.**' "$SKILL" | grep -qF 'trackers check --help' \
  && pass "binary probe covers apply and check help" || fail "binary probe" "Binary line lacks apply/check --help"
line_of '**Review.**' "$SKILL" | grep -qF 'git status --porcelain' \
  && pass "Step 7 shows git status --porcelain beside the stat" || fail "Step 7 status" "Review line lacks git status --porcelain"
line_of '1. **Fix the cause' "$RECOVERY_MD" | grep -qF 'first `git status --porcelain --untracked-files=all` snapshot' \
  && pass "recovery keeps the first snapshot on re-run" || fail "recovery snapshot" "Fix-the-cause item lacks it"
# the risky flag is not in the default Step 5 command
grep -F '**Apply.**' "$SKILL" | grep -qF -- '--no-old-catalog' && fail "Step 5 default command has no --no-old-catalog" "flag present" || pass "Step 5 default command has no --no-old-catalog"
# the -wal/-shm case is exit 2, not the no-old-catalog question
grep -qF 'wal_checkpoint' "$SKILL" && pass "SKILL.md gives the -wal remedy" || fail "-wal remedy" "absent"
grep -qF 'wal_checkpoint' "$RECOVERY_MD" && pass "recovery.md gives the -wal remedy" || fail "recovery -wal" "absent"
grep -qF 'Check exited 2' "$RECOVERY_MD" && pass "recovery.md covers check exit 2" || fail "recovery check exit 2" "absent"
# jq pipes must not be markdown-escaped (a copied \| is a jq syntax error)
if grep -qF '\|' "$MAPPING_MD"; then fail "mapping.md has no escaped pipes" "found backslash-pipe"; else pass "mapping.md has no escaped pipes"; fi

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

  # 0. every jq query in mapping.md parses and runs against a real inventory
  mkfx() { # <dir>: build a fixture; a failing builder is a test failure, not a silent skip
    if ! bash "$FIXTURE" "$1" >"$TMP/fx.log" 2>&1; then fail "fixture builds ($1)" "$(cat "$TMP/fx.log")"; return 1; fi
  }
  RJ="$TMP/rj"; mkfx "$RJ"
  "$BIN" trackers inventory docs/trackers/demo-log.md --project "$RJ" --json > "$TMP/inv.json" 2>/dev/null
  nq=0
  while IFS= read -r line; do
    f=${line#jq \'}; f=${f%\' @cmd_xxxx}
    nq=$((nq+1))
    if jq "$f" "$TMP/inv.json" >/dev/null 2>"$TMP/jqerr"; then pass "jq query $nq runs"; else fail "jq query $nq runs" "$f: $(cat "$TMP/jqerr")"; fi
  done < <(grep -E "^jq '.* @cmd_xxxx$" "$MAPPING_MD")
  [ "$nq" -ge 10 ] && pass "found $nq jq queries" || fail "found jq queries" "only $nq"

  # 1. apply + check on the good mapping
  R1="$TMP/r1"; mkfx "$R1"
  M1=$(place_mapping "$R1" "$EX")
  AOUT=$("$BIN" trackers apply "$M1" --project "$R1" --no-old-catalog --json 2>/dev/null); arc=$?
  [ "$arc" -eq 0 ] && pass "apply exits 0" || fail "apply exits 0" "exit $arc: $AOUT"
  [ "$(echo "$AOUT" | jq '(.written|length)>0 and (.deleted|length)>0' 2>/dev/null)" = "true" ] \
    && pass "apply lists written and deleted" || fail "apply lists written and deleted" "$AOUT"
  COUT=$("$BIN" trackers check "$M1" --project "$R1" --json 2>/dev/null); crc=$?
  [ "$crc" -eq 0 ] && [ "$(echo "$COUT" | jq '.clean' 2>/dev/null)" = "true" ] \
    && pass "check exits 0 and is clean" || fail "check clean" "exit $crc: $COUT"

  # 2. status_map without fixed-verified: apply refuses
  R2="$TMP/r2"; mkfx "$R2"
  grep -v '^fixed-verified' "$EX" > "$TMP/nostatus.toml"
  M2=$(place_mapping "$R2" "$TMP/nostatus.toml")
  ROUT=$("$BIN" trackers apply "$M2" --project "$R2" --no-old-catalog --json 2>/dev/null); rrc=$?
  [ "$rrc" -eq 1 ] && [ "$(echo "$ROUT" | jq 'has("refused")' 2>/dev/null)" = "true" ] \
    && pass "apply refuses a status_map gap (exit 1, refused key)" || fail "apply refusal" "exit $rrc: $ROUT"

  # 3. not TOML: check refuses
  R3="$TMP/r3"; mkfx "$R3"
  printf 'this is = not [valid toml\n' > "$TMP/broken.toml"
  M3=$(place_mapping "$R3" "$TMP/broken.toml")
  BOUT=$("$BIN" trackers check "$M3" --project "$R3" --json 2>/dev/null); brc=$?
  [ "$brc" -eq 1 ] && [ "$(echo "$BOUT" | jq 'has("refused")' 2>/dev/null)" = "true" ] \
    && pass "check refuses a broken mapping (exit 1, refused key)" || fail "check refusal" "exit $brc: $BOUT"

  # 4. the Step 8 procedure: names file from the apply JSON, stage and commit by the file
  GD=$(git -C "$R1" rev-parse --absolute-git-dir)
  printf '%s\n' "$AOUT" > "$GD/tracker-migration/demo-log.apply.json"
  NAMES="$GD/tracker-migration/demo-log.names"; STAGED="$GD/tracker-migration/demo-log.staged"
  jq -r '[.written[], .deleted[], .already_applied[]] | unique | .[]' "$GD/tracker-migration/demo-log.apply.json" > "$NAMES"
  # The count comes from apply's own JSON, not a literal. It was 6 while apply also retired the sidecar by
  # its derived name; codescout 970827aa6 (2026-11-22) retires only a sidecar the source DECLARES with
  # expects_augmentation, so the fixture's undeclared one stays and apply reports 5. This check is about the
  # Step 8 procedure (names file by jq, stage and commit by pathspec), not about which files apply touches:
  # that is codescout's own contract and its own tests.
  EXPECTED=$(jq '[.written[], .deleted[], .already_applied[]] | unique | length' "$GD/tracker-migration/demo-log.apply.json")
  [ "$EXPECTED" -gt 0 ] && [ "$(wc -l < "$NAMES")" -eq "$EXPECTED" ] && pass "names file holds every path apply reported ($EXPECTED)" || fail "names file" "expected $EXPECTED: $(cat "$NAMES")"
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
  git -C "$R1" add --pathspec-from-file="$NAMES" >/dev/null 2>&1 && pass "git add --pathspec-from-file" || fail "git add --pathspec-from-file" "refused"
  git -C "$R1" diff --cached --name-only > "$STAGED"
  cmp_out=$(LC_ALL=C sort "$NAMES" | diff - <(LC_ALL=C sort "$STAGED"))
  [ -z "$cmp_out" ] && pass "staged set equals the names file" || fail "staged set" "$cmp_out"
  git -C "$R1" commit -q -m "test: migrate demo-log" --pathspec-from-file="$NAMES" >/dev/null 2>&1 && pass "git commit --pathspec-from-file" || fail "git commit --pathspec-from-file" "refused"
  committed=$(git -C "$R1" show --name-only --format= HEAD | LC_ALL=C sort)
  [ "$committed" = "$(LC_ALL=C sort "$NAMES")" ] && pass "the commit holds exactly the paths apply reported" || fail "commit content" "$committed"
  rest=$(git -C "$R1" status --porcelain --untracked-files=all | grep -v '^?? \.codescout/' || true)
  [ -z "$rest" ] && pass "nothing else is dirty" || fail "dirty after commit" "$rest"
  git -C "$R1" status --porcelain --untracked-files=all | grep -q '^?? \.codescout/' \
    && ! git -C "$R1" ls-files --error-unmatch .codescout/write.lock >/dev/null 2>&1 \
    && pass ".codescout/ stays untracked" || fail ".codescout/ untracked" "missing or tracked"
  CC=$("$BIN" trackers check "$M1" --project "$R1" --json 2>/dev/null); ccrc=$?
  [ "$ccrc" -eq 2 ] && [ "$(echo "$CC" | jq '.ran' 2>/dev/null)" = "false" ] \
    && pass "check after the commit exits 2 with ran false" || fail "check after commit" "exit $ccrc: $CC"

  # 5. the worked example's D-3 date is the blame date of D-3's row in a fresh fixture
  ROW=$(grep -n '| D-3 |' "$RJ/docs/trackers/demo-log.md" | head -1 | cut -d: -f1)
  BLAME=$(git -C "$RJ" blame -L "$ROW,$ROW" --date=short -- docs/trackers/demo-log.md | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
  EXD=$(grep -A1 '^\[overrides."D-3"\]' "$EX" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')
  [ -n "$BLAME" ] && [ "$BLAME" = "$EXD" ] && pass "example D-3 date ($EXD) equals the row's blame date" || fail "example D-3 date" "example '$EXD', blame '$BLAME'"
fi

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
