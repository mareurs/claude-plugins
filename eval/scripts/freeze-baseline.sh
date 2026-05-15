#!/usr/bin/env bash
# eval/scripts/freeze-baseline.sh — snapshot current scores as a release baseline
#
# Refuses to freeze unless:
#   - The latest kappa-run-NN.json has verdict == "PASS" (κ >= 0.6)
#   - The git working tree is clean (no uncommitted changes that could affect
#     the baseline semantics)
#
# Output: eval/baselines/<date>/META.json + per-specialist scores under the
# same date dir, tagged with panel_version and git_sha for reproducibility.
#
# Usage:
#   ./freeze-baseline.sh
#   FORCE_DIRTY=1 ./freeze-baseline.sh   # bypass git-clean check (not recommended)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EVAL_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(cd "$EVAL_DIR/.." && pwd)

# Verify κ has been measured and passes
latest_kappa=$(ls -t "$EVAL_DIR/judge/calibration/kappa-run-"*.json 2>/dev/null | head -1 || true)
if [[ -z "$latest_kappa" ]]; then
  echo "No κ run found. Run ./calibrate.sh first." >&2
  exit 2
fi

verdict=$(python3 -c "import json; print(json.load(open('$latest_kappa'))['verdict'])")
kappa=$(python3 -c "import json; print(json.load(open('$latest_kappa'))['cohen_kappa'])")

if [[ "$verdict" != "PASS" ]]; then
  echo "Latest κ verdict: $verdict (κ = $kappa, target >= 0.6)" >&2
  echo "Iterate the judge prompt before freezing." >&2
  exit 3
fi

# Verify git working tree is clean
if [[ -z "${FORCE_DIRTY:-}" ]]; then
  cd "$REPO_DIR"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is dirty. Commit or stash before freezing." >&2
    echo "(Set FORCE_DIRTY=1 to bypass — not recommended.)" >&2
    exit 3
  fi
fi

panel_version=$(grep "^panel_version:" "$EVAL_DIR/judge/panel.yaml" | awk '{print $2}')
date_tag=$(date -u +%Y-%m-%d)
git_sha=$(git -C "$REPO_DIR" rev-parse HEAD)
baseline_dir="$EVAL_DIR/baselines/$date_tag"

echo ">>> Freezing baseline"
echo ">>>   date:           $date_tag"
echo ">>>   panel_version:  $panel_version"
echo ">>>   κ:              $kappa"
echo ">>>   git_sha:        $git_sha"
echo ">>>   output:         $baseline_dir"

mkdir -p "$baseline_dir"

# Run eval against every specialist that has fixtures
if [[ ! -d "$EVAL_DIR/fixtures" ]]; then
  echo "No fixtures directory; nothing to freeze." >&2
  exit 2
fi

for d in "$EVAL_DIR/fixtures"/*/; do
  [[ -d "$d" ]] || continue
  name=$(basename "$d")
  echo ""
  echo ">>> Scoring specialist: $name"
  "$SCRIPT_DIR/run.sh" "$name"
done

# Tag the baseline
cat > "$baseline_dir/META.json" <<META
{
  "frozen_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "date_tag": "$date_tag",
  "panel_version": $panel_version,
  "calibration_kappa": $kappa,
  "calibration_run": "$(basename "$latest_kappa")",
  "git_sha": "$git_sha",
  "note": "Reference baseline. Scores are namespaced by panel_version — cross-version comparison invalid."
}
META

echo ""
echo ">>> Frozen. Baseline tagged at: $baseline_dir/META.json"
