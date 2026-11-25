#!/usr/bin/env bash
# Test for d12_sizes.py: the size detector of tracker-hygiene D12.
# The fixture holds one oversized tracker (by bytes), one oversized by entry count,
# one small tracker, one big file in an archive folder, and a template heading and a
# fenced heading that must not count as entries.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
X="$SCRIPT_DIR/d12_sizes.py"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1 -- $2"; FAIL=$((FAIL+1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/d12-sizes-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
D="$TMP/trackers"; mkdir -p "$D/archive"

python3 - "$D" <<'PY'
import sys
d = sys.argv[1]
open(f"{d}/big-bytes.md", "w").write("# Big\n\n## F-1 — one\n\n" + "x" * 160000 + "\n")
open(f"{d}/many-entries.md", "w").write("# Many\n\n" + "".join(f"## F-{i} — e{i}\n\ntext\n\n" for i in range(1, 302)))
open(f"{d}/small.md", "w").write("# Small\n\n## F-1 — one\n\ntext\n\n## F-N — <title>\n\n```\n## F-2 — fenced\n```\n")
open(f"{d}/archive/old-big.md", "w").write("x" * 200000)
PY

OUT="$(python3 "$X" "$D" 2>&1)"; RC=$?
[ "$RC" = 1 ] && pass "exit 1 when a tracker is over a limit" || fail "exit code" "$RC"
echo "$OUT" | grep -q "big-bytes.md" && pass "flags the file over 150000 bytes" || fail "bytes" "$OUT"
echo "$OUT" | grep -q "many-entries.md.*301 entries" && pass "flags and counts 301 entries" || fail "entries" "$OUT"
echo "$OUT" | grep -q "small.md" && fail "small flagged" "$OUT" || pass "a small tracker is not flagged"
echo "$OUT" | grep -q "old-big.md" && fail "archive flagged" "$OUT" || pass "the archive folder is skipped"

rm "$D/big-bytes.md" "$D/many-entries.md"
OUT="$(python3 "$X" "$D" 2>&1)"; RC=$?
[ "$RC" = 0 ] && pass "exit 0 when nothing is over a limit" || fail "clean exit" "$RC $OUT"

python3 "$X" >/dev/null 2>&1 && fail "no argument" "exit 0" || pass "no argument prints usage and fails"
SM="$(python3 "$X" "$D" --bytes 10 2>&1)"
echo "$SM" | grep -q "small.md" && pass "--bytes overrides the limit" || fail "--bytes" "$SM"

echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" = 0 ]
