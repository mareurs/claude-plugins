#!/usr/bin/env bash
# Test for d10_extract.py: the extraction step of tracker-hygiene D10.
# The fixture holds the shapes that broke the first D10 run on a 413-entry log:
# template headings (inside a code fence and outside one), a 4-backtick inline fence,
# a win with no Promote-when, a win with no Status line, an inline `· **Status:**` field,
# and a free-text status tail.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
X="$SCRIPT_DIR/d10_extract.py"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/d10-extract-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
LOG="$TMP/log.md"
cat > "$LOG" <<'EOF'
# Log

## F-1 — first friction

**Status:** fixed-verified

## F-2 — second friction

**Category:** method · **Status:** open — 1 datapoint

## W-1 — a win with a free-text status

**Status:** validated — single datapoint, drift caught
**Promote-when:** after 3 more datapoints

## W-2 — a win with no Promote-when

**Status:** validated

## W-3 — a win with no Status line

**Promote-when:** never

## F-N entry template

```markdown
## F-N — <one-line title>

**Status:** open
```

```` ```markdown ````

## F-N — <one-line title>

## W-4 — after the fences

**Status:** mitigated.
EOF

OUT="$(python3 "$X" "$LOG")"
row() { printf '%s\n' "$OUT" | grep -E "^\| $1 "; }

[ "$(printf '%s\n' "$OUT" | grep -cE '^\| [FW]-')" = 6 ] && pass "6 real entries, templates skipped" || fail "entry count" "$OUT"
printf '%s\n' "$OUT" | grep -qx 'F: 2 entries, high-water mark 2' && pass "F summary" || fail "F summary" "$OUT"
printf '%s\n' "$OUT" | grep -qx 'W: 4 entries, high-water mark 4' && pass "W summary" || fail "W summary" "$OUT"
row F-2 | grep -q '| open | 1 datapoint |' && pass "inline Status field is read" || fail "inline status" "$(row F-2)"
row W-1 | grep -q '| validated | single datapoint, drift caught | after 3 more datapoints |' && pass "free-text tail kept apart from the token" || fail "tail" "$(row W-1)"
row W-2 | grep -q '| validated |  | - |' && pass "no Promote-when shows as -" || fail "no promote-when" "$(row W-2)"
row W-3 | grep -q '| (none) |  | never |' && pass "no Status line shows as (none)" || fail "no status" "$(row W-3)"
row W-4 | grep -q '| mitigated |  | - |' && pass "entry after a 4-backtick line is not swallowed" || fail "after fence" "$(row W-4)"

R="$(python3 "$X" "$LOG" --range W-2..W-3)"
[ "$(printf '%s\n' "$R" | grep -cE '^\| [FW]-')" = 2 ] && pass "--range keeps W-2 and W-3 only" || fail "--range" "$R"
python3 "$X" "$LOG" --range W-1..F-3 >/dev/null 2>&1 && fail "mixed range" "accepted" || pass "a mixed-kind range is refused"
python3 "$X" >/dev/null 2>&1 && fail "no argument" "accepted" || pass "no argument prints usage and fails"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
