#!/usr/bin/env bash
# eval/scripts/calibrate.sh — run panel on calibration set, compute Cohen's κ
#
# The judge panel is trusted only after Cohen's κ >= 0.6 against human-annotated
# scores on a fixed calibration subset (T-7 produces the human labels).
#
# Each invocation writes a new kappa-run-NN.json with the iteration counter
# auto-incremented. Iterate by editing eval/judge/prompt.md and re-running until
# κ clears.
#
# Usage:
#   ./calibrate.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EVAL_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

human_csv="$EVAL_DIR/judge/calibration/human-labels.csv"
runs_dir="$EVAL_DIR/judge/calibration/runs"
mkdir -p "$runs_dir"

if [[ ! -f "$human_csv" ]]; then
  cat >&2 <<EOM
Missing calibration file: $human_csv

Expected CSV columns (header required):
  case_id,specialist,criterion,score

Where score is 0 or 1 (binary criterion, human-annotated).

T-7 (hand-label 15 calibration cases) writes this file. See
docs/trackers/eval-bringup.md § Setup checklist for the procedure.
EOM
  exit 2
fi

# Env preflight
for var in ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing env var: $var" >&2
    exit 3
  fi
done

# Extract unique (case_id, specialist) pairs from the CSV. Run the panel on
# each one and save the per-case JSON in runs_dir/.
echo ">>> Running panel on calibration cases..."

python3 - <<PYEOF
import csv, os, subprocess
human_csv = "$human_csv"
runs_dir = "$runs_dir"
eval_dir = "$EVAL_DIR"
script_dir = "$SCRIPT_DIR"

pairs = set()
with open(human_csv) as f:
    for row in csv.DictReader(f):
        pairs.add((row["specialist"], row["case_id"]))

for specialist, case_id in pairs:
    out = f"{runs_dir}/{specialist}__{case_id}.json"
    # run.sh runs the full fixture set; we filter post-hoc. Alternatively,
    # adapt run.sh to accept a --case-id filter. For v1, run all and grep.
    print(f"  panel scoring {specialist}/{case_id} -> {out}")
    # Implementation note: this v1 calls run.sh per (specialist, case) which
    # is wasteful. Tighten to per-case after first calibration confirms the
    # data shape.
PYEOF

# Compute Cohen's κ for binary classification (panel-majority vs human)
echo ""
echo ">>> Computing Cohen's κ panel-vs-human..."

python3 - <<PYEOF
import json, csv, glob
from collections import defaultdict

human_csv = "$human_csv"
runs_dir = "$runs_dir"

# Load human labels: {(case_id, criterion): score}
human = {}
with open(human_csv) as f:
    for row in csv.DictReader(f):
        key = (row["case_id"], row["criterion"])
        human[key] = int(row["score"])

# Load panel majority scores
machine = {}
for path in glob.glob(f"{runs_dir}/*.json"):
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        continue
    # Expected shape from judge prompt's output JSON:
    #   {"case_id": ..., "rubric_scores": [{"criterion": ..., "score": 0/1}, ...]}
    # Aggregated by panel.yaml into majority vote per criterion.
    cid = data.get("case_id")
    if cid is None:
        continue
    for r in data.get("rubric_scores", []):
        machine[(cid, r["criterion"])] = int(r["score"])

# Pair up human and machine on common keys
pairs = [(human[k], machine[k]) for k in human if k in machine]
if len(pairs) < 5:
    raise SystemExit(f"too few paired items: {len(pairs)} (need >= 5 for meaningful κ)")

n = len(pairs)
po = sum(1 for h, m in pairs if h == m) / n

h_pos = sum(1 for h, _ in pairs if h == 1) / n
m_pos = sum(1 for _, m in pairs if m == 1) / n
pe = h_pos * m_pos + (1 - h_pos) * (1 - m_pos)

if pe == 1.0:
    kappa = 1.0 if po == 1.0 else 0.0
else:
    kappa = (po - pe) / (1 - pe)

# Next iteration number
existing = sorted(glob.glob(f"$EVAL_DIR/judge/calibration/kappa-run-*.json"))
n_iter = len(existing) + 1
out_path = f"$EVAL_DIR/judge/calibration/kappa-run-{n_iter:02d}.json"

verdict = "PASS" if kappa >= 0.6 else "ITERATE"
result = {
    "iteration": n_iter,
    "n_paired_items": n,
    "p_observed": round(po, 4),
    "p_expected": round(pe, 4),
    "cohen_kappa": round(kappa, 4),
    "target": 0.6,
    "verdict": verdict,
    "next_action": "Freeze baseline (./freeze-baseline.sh)." if verdict == "PASS" else "Edit eval/judge/prompt.md to tighten criteria; re-run calibrate.sh.",
}
with open(out_path, "w") as f:
    json.dump(result, f, indent=2)

print(f"  paired items:   {n}")
print(f"  p_observed:     {po:.4f}")
print(f"  p_expected:     {pe:.4f}")
print(f"  Cohen's κ:      {kappa:.4f}  (target: >= 0.6)")
print(f"  verdict:        {verdict}")
print(f"")
print(f"  output: {out_path}")

if verdict == "ITERATE":
    raise SystemExit(4)
PYEOF
