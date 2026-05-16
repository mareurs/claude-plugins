# Frozen Baselines

Immutable snapshots. Never edit in place. Bump version on rebaseline.

## Structure

```
frozen/
  <specialist>@v<n>/
    METADATA.json          -- panel, rubric, fixture, model, scores, κ
    variance.json          -- aggregate (n_runs, per_case stats, floor)
    variance-run-NN.json   -- raw per-run judge outputs
```

## Active Baselines

| Specialist | Version | Frozen | κ_vs_strong | Floor | Notes |
|------------|---------|--------|-------------|-------|-------|
| ml-training-takin | **v3** | 2026-05-16 | 1.000 (n=13, inherited) | 0.200 | 3 fixtures, panel_version 1, harness `ac9ae8a`, **refactored candidate (ibex pattern)**. **Use this one.** |
| ml-training-takin | v2 (superseded) | 2026-05-16 | 1.000 (n=13) | 0.200 | Pre-refactor candidate. case-01 mean 0.880 (v3: 0.960, but below floor — not a claim). |
| ml-training-takin | v1 (superseded) | 2026-05-16 | 1.000 (n=13) | 0.200 | Pre-parser-fix. Numerically equal to v2; methodologically inferior. |
## Rebaseline Triggers

See `METADATA.json` `rebaseline_triggers`. When any trigger fires, freeze v(n+1) — do NOT mutate v(n).

## How to Compare Against Baseline

```bash
# Run candidate eval (using whatever harness mode)
python eval/scripts/harness.py --specialist ml-training-takin --mode variance --runs 3

# Compare per-case mean against METADATA per_case_baseline.
# Regression: candidate_mean < baseline_mean - variance_floor
# Improvement: candidate_mean > baseline_mean + variance_floor
# Anything in between: noise, no claim.
```
