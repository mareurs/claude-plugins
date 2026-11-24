#!/usr/bin/env bash
# The mid-work experiment: scenario M (three functions, tracker edits in the middle), arm n (no hook)
# against arm b (the hook that refuses complex verbs), at two sizes of parent context.
# Costs about 0.5 USD a run with no padding and about 1 USD with 60k tokens of it.
#
# usage: [ARMS="n b"] tests/acceptance/scribe-fork/experiment-m.sh [runs-per-cell] [parallel]    (defaults 4 and 8)
# env:   CODESCOUT_BIN, ACC_DIR as in run.sh. ARMS lists the arms to run: n is no hook, any other
#        letter is that CS_SCRIBE_VARIANT of the hook (b, e).
# A label is M<arm><size>x<n>: arm n or b, size 0 or 60 (thousand tokens of padding), n the run.
# Then: python3 tests/acceptance/scribe-fork/table-m.py $(ls $ACC_DIR/out | sed -n 's/^run\(M[a-z][0-9]*x[0-9]*\)\.jsonl$/\1/p' | sort)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
runs="${1:-4}"; par="${2:-8}"
export HOOK="$here/../../../codescout-companion/hooks/scribe-nudge.mjs"
for i in $(seq 1 "$runs"); do for size in 0 60; do for arm in ${ARMS:-n b}; do echo "$arm $size $i"; done; done; done |
  xargs -P "$par" -L1 bash -c '
    arm="$0"; size="$1"; i="$2"
    if [ "$arm" != n ]; then export SCRIBE_HOOK="$HOOK" CS_SCRIBE_VARIANT="$arm"; else unset SCRIBE_HOOK; fi
    PAD_TOKENS=$((size * 1000)) "'"$here"'/run.sh" M "${arm}${size}x${i}" >/dev/null 2>&1
    echo "done M${arm}${size}x${i}"'
