#!/usr/bin/env bash
# The big-job experiment: scenario L, a long task with a large tracker job in the middle (triage ten
# bugs). Arm n: the agent triages them itself. Arm f: the prompt hands the triage to a scribe fork
# (get_guide('scribe')), no hook. The best case for a fork: real work is left for the parent.
#
# usage: tests/acceptance/scribe-fork/experiment-l.sh [runs-per-arm] [parallel] [padding-k-tokens]
#        (defaults 4, 8 and 0)
# env:   CODESCOUT_BIN, ACC_DIR as in run.sh. A label is L<arm><size>x<n>.
# Never reuse a label after deleting its scratch repository: the catalog remembers the path and
# `box new` then refuses it ("path exists").
# Then: python3 tests/acceptance/scribe-fork/table-l.py $(ls $ACC_DIR/out | sed -n 's/^run\(L[a-z][0-9]*x[0-9]*\)\.jsonl$/\1/p' | sort)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
runs="${1:-4}"; par="${2:-8}"; size="${3:-0}"
for i in $(seq 1 "$runs"); do for arm in n f; do echo "$arm $size $i"; done; done |
  xargs -P "$par" -L1 bash -c '
    arm="$0"; size="$1"; i="$2"
    unset SCRIBE_HOOK
    PAD_TOKENS=$((size * 1000)) "'"$here"'/run.sh" L "${arm}${size}x${i}" >/dev/null 2>&1
    echo "done L${arm}${size}x${i}"'
