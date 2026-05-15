# Buddy Specialist Eval Harness

Evaluation infrastructure for the 10 buddy specialists under `buddy/skills/`.

Companion to:
- `docs/trackers/buddy-introspection.md` — gap inventory (audit)
- `docs/trackers/active-plan.md` — plan (this harness is Phase 0)

## Layout

```
eval/
├── README.md                     # this file
├── fixtures/                     # input cases per specialist
│   └── <specialist>/
│       └── case-NN.yaml          # input prompt + ideal rubric criteria
├── judge/                        # LLM-judge prompt + panel config
│   ├── prompt.md                 # cross-family judge with per-Method rubric
│   ├── panel.yaml                # PoLL: 3 cross-family judges
│   ├── rubrics/                  # per-specialist rubric templates
│   │   └── <specialist>.md
│   └── calibration/              # human-labeled subset for κ measurement
│       ├── human-labels.csv      # ground truth
│       └── kappa-run-NN.json     # panel vs human results
├── baselines/                    # frozen scores per release
│   └── <YYYY-MM-DD>/
│       └── <specialist>/
│           ├── scores.json       # per-case scores from panel
│           └── variance.json     # N=5 identical-input variance floor
├── promptfoo.yaml                # Promptfoo config — fast regression
├── dspy/                         # DSPy modules — automated optimization
│   └── <specialist>/
│       └── optimize.py
└── scripts/
    ├── run.sh                    # generator → judge panel → score → diff vs baseline
    ├── variance-floor.sh         # N=5 identical reruns → noise floor per case
    ├── calibrate.sh              # run panel on human-labeled subset → κ
    └── freeze-baseline.sh        # snapshot current scores to baselines/<date>/
```

## Quick start

```bash
# 1. Set API keys (Anthropic, OpenAI, Google)
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export GOOGLE_API_KEY=...

# 2. Run the full eval on one specialist
./scripts/run.sh ml-training-takin

# 3. Compute variance floor for one specialist
./scripts/variance-floor.sh ml-training-takin

# 4. Calibrate judge against human labels
./scripts/calibrate.sh

# 5. Freeze current scores as the release baseline
./scripts/freeze-baseline.sh
```

## Adding a fixture case

Pick a real session trace where the specialist's response was good, ambiguous, or wrong. Create `fixtures/<specialist>/case-NN.yaml`:

```yaml
case_id: case-NN
specialist: <specialist>
input:
  user_message: |
    <the actual user prompt to the specialist>
ideal_rubric:
  # each criterion = boolean assertion the judge evaluates
  # criteria must be observable in the response, not in the prompt
  - <criterion_snake_case>: true   # or false if the response must NOT do this
  - ...
notes: |
  <which Method step / Heuristic this case tests>
```

Rubric criteria should map to specific Method steps or Heuristics named in the specialist's `SKILL.md`. The judge prompt instructs the panel to cite which criterion was met and where.

## Judge prompt design

See `judge/prompt.md` for the cross-family judge skeleton. Key constraints (enforced inside the prompt):

- **Decompose**, do not score holistically. Per-criterion 0/1 with cited evidence.
- **CoT before JSON** — explicit reasoning reduces self-preference bias.
- **Position-swap** — every pair is evaluated in both orders; flag verdict reversals as `position_unstable: true`.
- **Majority vote** across the 3-judge panel, not average. Average masks 2:1 disagreement.

## Calibration target

Cohen's κ ≥ 0.6 panel-vs-human on the calibration subset (15 hand-labeled cases). Below 0.6, iterate the judge prompt before trusting any score.

## Variance floor

For 3 cases per specialist, run identical input 5×. Record max |Δ|. **Any reported improvement smaller than the floor is noise** (pheasant-llm Method 8 applied to ourselves).

## Tooling roles

| Tool | Job | Cadence |
|---|---|---|
| **Promptfoo** | YAML-driven regression; subset on changed specialists | Every PR (CI hook) |
| **DSPy** | Programmatic prompt optimization against rubric | Phase 3+, offline |
| **Human review** | Calibration; spot-check top 5% disagreements | Quarterly |

See `docs/trackers/active-plan.md § Decisions Log § D-1` for the rationale.

## Status

This harness is under construction. Track progress in `docs/trackers/active-plan.md § Phase 0`. Current state: skeleton only — no fixtures, no calibration yet.
