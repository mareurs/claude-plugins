#!/usr/bin/env bash
# eval/scripts/variance-floor.sh — measure the noise floor on identical inputs
#
# Runs each fixture for a specialist N times (default 5) with identical inputs
# and computes max |Δ| per case. The largest delta across cases is the
# variance floor: any reported "improvement" smaller than that is noise.
#
# Source: pheasant-llm Method 8 + hamsa H7 applied to ourselves.
#
# Usage:
#   ./variance-floor.sh <specialist>
#   N_RUNS=10 ./variance-floor.sh <specialist>   # override default 5

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EVAL_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

specialist="${1:-}"
N_RUNS="${N_RUNS:-5}"

if [[ -z "$specialist" ]]; then
  echo "Usage: $0 <specialist>" >&2
  echo "Env: N_RUNS=<N> overrides default of 5" >&2
  exit 2
fi

if [[ "$N_RUNS" -lt 2 ]]; then
  echo "N_RUNS must be >= 2 to measure variance" >&2
  exit 2
fi

date_tag=$(date -u +%Y-%m-%d)
out_dir="$EVAL_DIR/baselines/$date_tag/$specialist"
mkdir -p "$out_dir"

echo ">>> Variance floor measurement"
echo ">>>   specialist: $specialist"
echo ">>>   N runs:     $N_RUNS"
echo ">>>   output dir: $out_dir"
echo ""

for i in $(seq 1 "$N_RUNS"); do
  echo ">>> Run $i / $N_RUNS"
  out="$out_dir/variance-run-$(printf '%02d' "$i").json"
  "$SCRIPT_DIR/run.sh" "$specialist" --output "$out"
done

echo ""
echo ">>> Computing variance floor across $N_RUNS runs..."

python3 - <<PYEOF
import json, glob, os
from collections import defaultdict

out_dir = "$out_dir"
runs = sorted(glob.glob(f"{out_dir}/variance-run-*.json"))
if len(runs) < 2:
    raise SystemExit(f"need >= 2 runs, got {len(runs)}")

# Score shape assumed: each file is a Promptfoo eval result with per-case
# entries containing case_id and a total or score field. The exact field
# names will need to match Promptfoo's output schema on first run — adjust
# the field-extraction below to match.
per_case = defaultdict(list)
for r in runs:
    with open(r) as f:
        data = json.load(f)
    # Promptfoo result schema varies — common shape: {"results": [{"vars": {"case_id": ...}, "score": N}, ...]}
    results = data.get("results", []) or data.get("evals", [])
    for item in results:
        # Try a few common locations for case_id and score
        cid = (item.get("vars") or {}).get("case_id") or item.get("case_id") or item.get("test_name")
        score = item.get("score")
        if score is None:
            score = (item.get("namedScores") or {}).get("total")
        if cid is None or score is None:
            continue
        per_case[cid].append(float(score))

if not per_case:
    raise SystemExit("no scored cases found — Promptfoo output schema may have changed; adjust variance-floor.sh field extraction")

variance = {}
for cid, scores in per_case.items():
    variance[cid] = {
        "scores": scores,
        "n": len(scores),
        "min": min(scores),
        "max": max(scores),
        "max_abs_delta": max(scores) - min(scores),
        "mean": sum(scores) / len(scores),
    }

overall_floor = max(v["max_abs_delta"] for v in variance.values())

result = {
    "specialist": "$specialist",
    "n_runs": $N_RUNS,
    "per_case": variance,
    "variance_floor": overall_floor,
    "interpretation": "Any reported improvement smaller than variance_floor is noise — do not claim a 'fix' worked unless its delta exceeds this floor.",
}

with open(f"{out_dir}/variance.json", "w") as f:
    json.dump(result, f, indent=2)

print(f"")
print(f"variance floor: {overall_floor:.4f}")
print(f"per-case deltas:")
for cid, v in variance.items():
    print(f"  {cid}: max|Δ| = {v['max_abs_delta']:.4f}  (mean = {v['mean']:.3f}, n = {v['n']})")
print(f"")
print(f"output: {out_dir}/variance.json")
PYEOF
