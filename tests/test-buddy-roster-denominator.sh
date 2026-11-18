#!/usr/bin/env bash
# tests/test-buddy-roster-denominator.sh — the buddy-introspection tracker's roster
# lists must match the specialists that exist in buddy/skills/.
#
# Why this exists: the tracker said `specialists_scanned: 10/10` for a roster that had
# grown to 12, so a partial audit read as a complete one. The fix relabelled it `10/12`
# by hand, and both archived bug records
# (docs/issues/archive/2026-08-26-buddy-introspection-scope-stale-10-of-12-specialists.md,
# ...-20-outlier-comparison-falsified.md) name the remaining gap: "no check derives the
# denominator from buddy/skills/, so a thirteenth specialist would again be invisible".
# This is that check. It reads the Live state YAML block of the tracker and compares
# it with the directories that hold a SKILL.md.
#
# Each failure mode has a positive control (a fixture that MUST fail), so a check that
# cannot fail does not pass for the wrong reason.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cs-roster-denom-XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

# roster_problems <tracker.md> <skills_dir>
# Prints one line per problem; exit status 1 if there is any.
roster_problems() {
  local tracker="$1" skills="$2" w="$TMP/work.$$.$RANDOM"
  mkdir -p "$w"
  : > "$w/scanned"; : > "$w/pending"; : > "$w/disk"

  # The first Live state block: names under specialists_scanned / specialists_pending.
  awk '
    /^specialists_scanned:/ { k="s"; frac=$2; next }
    /^specialists_pending:/ { k="p"; next }
    /^last_updated:/        { exit }
    /^[a-z_]+:/             { k=""; next }
    k != "" && /^  - / {
      sub(/^  - /, ""); sub(/[ \t]*#.*/, ""); sub(/[ \t]+$/, "")
      print $0 > (k == "s" ? scanned : pending)
    }
    END { print frac > fracfile }
  ' scanned="$w/scanned" pending="$w/pending" fracfile="$w/frac" "$tracker"

  local d
  for d in "$skills"/*/; do
    [ -f "${d}SKILL.md" ] && basename "$d" >> "$w/disk"
  done
  sort -o "$w/scanned" "$w/scanned"; sort -o "$w/pending" "$w/pending"; sort -o "$w/disk" "$w/disk"
  sort -u "$w/scanned" "$w/pending" > "$w/listed"

  local problems=0 n
  while IFS= read -r n; do echo "unlisted: '$n' has a SKILL.md but is in neither list"; problems=1
  done < <(comm -13 "$w/listed" "$w/disk")
  while IFS= read -r n; do echo "ghost: '$n' is listed but has no SKILL.md under $skills"; problems=1
  done < <(comm -23 "$w/listed" "$w/disk")
  while IFS= read -r n; do echo "both: '$n' is in scanned AND pending"; problems=1
  done < <(comm -12 "$w/scanned" "$w/pending")

  local frac a b ns nd
  frac="$(cat "$w/frac")"
  ns="$(wc -l < "$w/scanned" | tr -d ' ')"; nd="$(wc -l < "$w/disk" | tr -d ' ')"
  a="${frac%%/*}"; b="${frac##*/}"
  if [ "$a" != "$ns" ] || [ "$b" != "$nd" ]; then
    echo "fraction: tracker says '$frac' but $ns names are scanned and $nd skill directories exist"
    problems=1
  fi
  rm -rf "$w"
  return "$problems"
}

# A consistent fixture: 3 skill dirs, 2 scanned, 1 pending, fraction 2/3.
make_fixture() {  # <dir>
  mkdir -p "$1/skills/alpha" "$1/skills/beta" "$1/skills/gamma"
  for s in alpha beta gamma; do echo "# $s" > "$1/skills/$s/SKILL.md"; done
  cat > "$1/tracker.md" <<'MD'
## Live state

```yaml
specialists_scanned: 2/3          # roster grew AFTER this sweep
  - alpha
  - beta                          # a comment after the name
specialists_pending:
  - gamma
last_updated: 2026-01-01
```
MD
}

echo "── buddy-introspection roster denominator ──"

# Controls first: each must behave as stated, or the real check below proves nothing.
make_fixture "$TMP/ok"
if out="$(roster_problems "$TMP/ok/tracker.md" "$TMP/ok/skills")"; then
  ok "control: a consistent roster passes"
else
  bad "control: a consistent roster passes" "$out"
fi

make_fixture "$TMP/new"; mkdir "$TMP/new/skills/delta"; echo "# d" > "$TMP/new/skills/delta/SKILL.md"
out="$(roster_problems "$TMP/new/tracker.md" "$TMP/new/skills")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "unlisted: 'delta'"; then
  ok "control: a new specialist in neither list is caught"
else
  bad "control: a new specialist in neither list is caught" "rc=$rc out=[$out]"
fi

make_fixture "$TMP/ghost"; sed -i 's/^  - gamma/  - gamma\n  - zeta/' "$TMP/ghost/tracker.md"
out="$(roster_problems "$TMP/ghost/tracker.md" "$TMP/ghost/skills")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "ghost: 'zeta'"; then
  ok "control: a listed name with no skill is caught"
else
  bad "control: a listed name with no skill is caught" "rc=$rc out=[$out]"
fi

make_fixture "$TMP/frac"; sed -i 's|2/3|2/2|' "$TMP/frac/tracker.md"
out="$(roster_problems "$TMP/frac/tracker.md" "$TMP/frac/skills")"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "^fraction:"; then
  ok "control: a stale N/M fraction is caught"
else
  bad "control: a stale N/M fraction is caught" "rc=$rc out=[$out]"
fi

# The real thing.
if [ ! -f "$ROOT/docs/trackers/buddy-introspection.md" ] || [ ! -d "$ROOT/buddy/skills" ]; then
  bad "inputs exist" "missing tracker or buddy/skills"
else
  if out="$(roster_problems "$ROOT/docs/trackers/buddy-introspection.md" "$ROOT/buddy/skills")"; then
    ok "buddy-introspection lists every specialist in buddy/skills/ and the N/M fraction matches"
  else
    bad "buddy-introspection matches buddy/skills/" "$(printf '%s' "$out" | tr '\n' ';')"
  fi
fi

echo "---"
echo "Total: $((PASS+FAIL)). Pass: $PASS. Fail: $FAIL."
[ "$FAIL" -gt 0 ] && exit 1
exit 0
