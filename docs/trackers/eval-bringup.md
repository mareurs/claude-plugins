# Buddy Eval Harness — Bringup Tracker

> **Scope:** runtime execution of the eval harness — env setup, first script
> runs, calibration loop. Subset focus of [`active-plan.md`](active-plan.md)
> Phase 0 (specifically T-6..T-11 which require API access).
> Once these are done, this tracker closes; ongoing eval activity is tracked
> in the per-baseline directories under `eval/baselines/<date>/`.

## Done-condition

This tracker closes when ALL of the following hold:

1. Environment installed: Promptfoo CLI on PATH; API keys for Anthropic, OpenAI, Google set.
2. Smoke test passed: one fixture runs end-to-end through the panel without error.
3. **Variance floor measured** (T-6): `eval/baselines/<date>/ml-training-takin/variance.json` exists with a recorded `variance_floor`.
4. **Calibration cleared** (T-7 + T-8): `eval/judge/calibration/human-labels.csv` populated (15+ cases); latest `kappa-run-NN.json` shows `verdict: PASS` (κ ≥ 0.6).
5. **Fixtures expanded** (T-9): 5 fixtures per specialist (currently only takin has 3; 9 specialists × 5 + 2 more for takin = 47 fixtures still to write).
6. **Baseline frozen** (T-10): `eval/baselines/<date>/META.json` exists; per-specialist `scores.json` under each.
7. **CI wired** (T-11): `.github/workflows/eval.yml` runs Promptfoo on changed-specialist PRs.

## Live state

```yaml
status: open

environment:
  promptfoo_installed: false        # `npm i -g promptfoo`
  api_keys:
    anthropic: false                # ANTHROPIC_API_KEY
    openai: false                   # OPENAI_API_KEY
    google: false                   # GOOGLE_API_KEY

scripts:
  run_sh:               { written: true, smoke_tested: false }
  variance_floor_sh:    { written: true, smoke_tested: false }
  calibrate_sh:         { written: true, smoke_tested: false }
  freeze_baseline_sh:   { written: true, smoke_tested: false }

runtime_executions:
  smoke_test:                false
  variance_floor:            false
  hand_labels_15_cases:      false
  judge_calibration_passed:  false
  fixtures_expanded_to_5:    false
  first_baseline_frozen:     false
  ci_wired:                  false

last_updated: 2026-05-15
```

## Setup checklist (one-time)

### Software

1. **Promptfoo CLI**

   ```bash
   npm i -g promptfoo
   promptfoo --version    # confirm install (expect >= 0.115)
   ```

   Pin the version in `eval/promptfoo.yaml` once the first run confirms the
   schema. If Promptfoo's CLI flags drift, update `eval/scripts/*.sh`.

2. **Python 3.10+** with `json`, `csv`, `glob` (all stdlib — no extra installs).

3. **`jq`** (already used elsewhere in the plugin) — for any ad-hoc JSON
   inspection of score files.

### API keys

Set in your shell or via `direnv`/`.env`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=AIza...
```

Never commit these. `.gitignore` already excludes `.env` if present.

### Provider-string verification (first-run)

`eval/judge/panel.yaml` uses these provider strings — verify they match the
installed Promptfoo's schema:

| Vendor    | Used         | Alternative if rejected |
|-----------|--------------|-------------------------|
| Anthropic | `anthropic:messages:claude-sonnet-4-6` | `anthropic:claude-sonnet-4-6` |
| OpenAI    | `openai:chat:gpt-4.1` | `openai:gpt-4.1` |
| Google    | `googleai:gemini-2.5-pro` | `vertex:gemini-2.5-pro` |

Adjust on first failure and record the working form in this section.

## Runtime sequence (first bringup)

Run these in order. Each step is a deliverable in the active plan.

### Step 1 — Smoke test (no plan ID; pre-T-6 sanity)

```bash
cd eval
promptfoo eval \
  --config promptfoo.yaml \
  --tests fixtures/ml-training-takin/case-01.yaml \
  --max-concurrency 1
```

Expected: 1 case scored by 3 judges, JSON output to stdout. If this fails,
fix the provider strings or prompt template before proceeding.

### Step 2 — Variance floor (T-6)

```bash
./scripts/variance-floor.sh ml-training-takin
```

5 reruns × 3 cases × 3 judges = 45 judge calls. ~$2 at 2026 prices.

Output: `eval/baselines/<date>/ml-training-takin/variance.json`. The
`variance_floor` field is the largest max|Δ| across cases — record it in
this tracker's `live state`.

### Step 3 — Hand-label calibration set (T-7)

Pick 3 cases from 5 different specialists = 15 cases. For each, score every
rubric criterion 0 or 1 manually. Write to:

```
eval/judge/calibration/human-labels.csv
```

Columns: `case_id,specialist,criterion,score`

Time: ~2 hours. This is the highest-effort manual step in Phase 0.

### Step 4 — Calibrate (T-8)

```bash
./scripts/calibrate.sh
```

Computes Cohen's κ panel-vs-human. Exit codes:
- `0` → PASS (κ ≥ 0.6). Proceed to Step 5.
- `4` → ITERATE. Edit `eval/judge/prompt.md` (tighten criteria, add few-shot
  examples, decompose more), re-run. Repeat until PASS.

Typical iteration count: 2–4 cycles to clear 0.6.

### Step 5 — Expand fixtures (T-9)

Currently ml-training-takin has 3 cases. The plan calls for 5 per specialist.

Schedule:
1. Add 2 more cases to ml-training-takin.
2. Write 5 cases each for the other 9 specialists.

Per-specialist budget: ~50m. Total: ~8 hours, spread across sessions.

Reuse the case format in `eval/fixtures/ml-training-takin/case-01.yaml`.

### Step 6 — Freeze baseline (T-10)

```bash
./scripts/freeze-baseline.sh
```

Refuses if κ has not passed or working tree is dirty. Writes
`eval/baselines/<date>/META.json` + per-specialist scores. This is the
pre-rewrite reference: every subsequent change to a SKILL.md is measured
against this baseline.

### Step 7 — Wire CI (T-11)

Add `.github/workflows/eval.yml`:

```yaml
name: Eval
on:
  pull_request:
    paths:
      - 'buddy/skills/**/SKILL.md'
      - 'eval/**'
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm i -g promptfoo
      - run: ./eval/scripts/run.sh $(./eval/scripts/changed-specialists.sh)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
```

(`changed-specialists.sh` is a small helper, write inline when wiring CI.)

Configure GitHub repo secrets for the 3 API keys.

## Notes & gotchas (populated by first runner)

_Add observations as you go through bringup. Each entry should answer
"what would have saved me 20 minutes?"_

- _(empty until first run)_

## Cost log

_Record cost per bringup step so subsequent runs are predictable._

| Step | Judge calls | Approx cost (2026 USD) | Actual |
|---|--:|--:|--:|
| Smoke (1 case × 3 judges) | 3 | $0.02 | — |
| Variance floor (T-6) | 45 | $2.00 | — |
| Calibration (T-8, per iteration) | 45 | $2.00 | — |
| Full baseline freeze (T-10, 50 fixtures × 3 judges × 2 swap) | 300 | $10.00 | — |

## History

### 2026-05-15 — Tracker created

- 4 runtime scripts written and committed (`run.sh`, `variance-floor.sh`,
  `calibrate.sh`, `freeze-baseline.sh`).
- Environment setup pending — Promptfoo not installed; API keys not set.
- Runtime execution (T-6 onward) blocks on environment.
- Tracker indexed at `docs/trackers/INDEX.md`.
