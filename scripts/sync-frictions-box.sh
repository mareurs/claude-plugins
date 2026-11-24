#!/usr/bin/env bash
# scripts/sync-frictions-box.sh — refresh the four verb scripts of the frictions box from codescout.
# The box verbs (note, admit, recent, check) live in .codescout/scripts/frictions/ and are byte
# copies of the codescout repository's. Source: $CODESCOUT_REPO, or ../codescout beside this checkout.
# tests/test-frictions-box.sh warns when a copy drifts; it never fails on it, because the source is
# another repository whose working tree moves on its own.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${CODESCOUT_REPO:-$ROOT/../codescout}/.codescout/scripts/frictions"
DST="$ROOT/.codescout/scripts/frictions"
[ -d "$SRC" ] || { echo "no source at $SRC (set CODESCOUT_REPO)" >&2; exit 2; }
mkdir -p "$DST"
for f in note admit recent check; do
  cp "$SRC/$f.py" "$DST/$f.py"
done
echo "synced $DST from $SRC"
