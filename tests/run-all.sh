#!/bin/bash
# tests/run-all.sh — run all hook test scripts and report results

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FAILED=()

for f in "$SCRIPT_DIR"/test-*.sh; do
  echo "▶ $(basename "$f")"
  if bash "$f"; then
    :
  else
    FAILED+=("$(basename "$f")")
  fi
  echo ""
done

if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "✓ All suites passed."
  exit 0
else
  echo "✗ Failed suites: ${FAILED[*]}"
  exit 1
fi
