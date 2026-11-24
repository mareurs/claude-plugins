#!/usr/bin/env bash
# scripts/sync-frictions-box.sh — refresh the verbs of the frictions box, and their tests, from codescout.
# The box verbs (note, admit, recent, check) live in .codescout/box/scripts/frictions/, each with its
# test in tests/test_<verb>.py, and are byte copies of the codescout repository's. Source:
# $CODESCOUT_REPO, or ../codescout beside this checkout.
# tests/test-frictions-box.sh warns when a copy drifts; it never fails on it, because the source is
# another repository whose working tree moves on its own.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${CODESCOUT_REPO:-$ROOT/../codescout}/.codescout/box/scripts/frictions"
DST="$ROOT/.codescout/box/scripts/frictions"
[ -d "$SRC" ] || { echo "no source at $SRC (set CODESCOUT_REPO)" >&2; exit 2; }
mkdir -p "$DST/tests"
for f in note admit recent check; do
  cp "$SRC/$f.py" "$DST/$f.py"
  cp "$SRC/tests/test_$f.py" "$DST/tests/test_$f.py"
done
echo "synced $DST from $SRC"
