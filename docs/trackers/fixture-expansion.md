# Tracker: Fixture Expansion

```yaml
status: open
opened: 2026-05-16
owner: hamsa
goal: Author 5 fixtures per remaining specialist (9 × 5 = 45 cases) so eval coverage is uniform across the bestiary
done_condition: Each of the 9 remaining specialists has ≥5 fixtures, each with tightened rubrics (criteria-grounded, no fuzzy meta-criteria), each baselined and frozen as eval/baselines/frozen/<specialist>@v1
priority: medium — deferred from T-9 of active-plan; Phase 2 (ibex-promote) proceeds on takin alone meanwhile
blocks: phase-2-completion-for-non-takin-specialists, phase-3-systemic-rewrites-broad-validation
blocked_by: none
review_cadence: revisit after each Phase 2 batch lands — backfill fixtures opportunistically
```

## Why deferred

T-9 (expand fixtures to 5×10) is ~8 hours of writing work. Takin alone gives us:

- Working harness (T-1..T-5)
- Validated variance floor (T-6, 0.200)
- Calibrated panel (T-8, κ=1.0 vs strong)
- Frozen baseline (T-10, v1)

That's enough to **gate Phase 2 ibex-promote rewrites** if takin is used as the control specialist. New specialists get fixtures + baselines on the demand of "I want to refactor X — write its fixtures first, then proceed."

This avoids paying the full 8h upfront when phases 2/3 may reveal that the
ibex pattern itself needs adjustment — in which case the rubric criteria
change and we'd be rewriting fixtures anyway.

## Per-specialist status

| Specialist | Fixtures | Baseline | κ | Notes |
|------------|---------:|----------|---|-------|
| ml-training-takin | 3 | frozen v1 | 1.000 (n=13) | pilot done |
| debugging-yeti | 0 | — | — | needed for Phase 2 T-23 pilot |
| testing-snow-leopard | 0 | — | — | |
| refactoring-yak | 0 | — | — | |
| performance-lammergeier | 0 | — | — | |
| planning-crane | 0 | — | — | |
| architecture-snow-lion | 0 | — | — | |
| docs-lotus-frog | 0 | — | — | |
| data-leakage-snow-pheasant (classic + llm) | 0 | — | — | two lenses, two fixture sets |
| security-ibex | 0 | — | — | source of the pattern being promoted |
| prompt-hamsa | 0 | — | — | self-eval — write last to avoid loop |

11 entries (data-leakage has 2 lenses). 1 done, 10 pending.

## Fixture authoring checklist

Per specialist:

1. Pick 5 cases spanning easy / medium / hard / edge / failure-mode-trigger.
2. Each case: `case-NN.yaml` with `prompt`, `expected_behavior` (criteria-grounded), `must_*` / `must_not_*` lists.
3. Tighten rubric in `eval/judge/rubrics/<specialist>.md` — per-criterion grounding tables, NO fuzzy meta-criteria like `references_*` (per 2026-05-15 finding).
4. Run variance floor: 5 runs, compute per-case max_abs_delta and floor.
5. Run κ vs strong panel: ≥10 paired criterion judgments, κ ≥ 0.7 PASS.
6. Freeze: `eval/baselines/frozen/<specialist>@v1/` with METADATA.json.
7. Update this tracker row.

Time estimate: ~50min/specialist if rubric is straightforward, ~90min if criteria need invention.

## Done-condition

All 10 specialist rows show frozen baseline + κ ≥ 0.7. At that point this tracker closes — eval coverage is uniform and Phase 2/3 can quote per-specialist deltas instead of using takin as proxy control.

## History

### 2026-05-16
- Tracker created. Deferred from T-9 of active-plan after T-10 (takin baseline) froze.
- Decision: proceed with Phase 2 on takin as pilot + control. Backfill fixtures per-specialist on demand.
