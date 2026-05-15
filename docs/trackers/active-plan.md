# Buddy Specialists — Active Plan

> **Tracker schema:** hybrid (task_list spine + reflective methodology + metric_baseline once eval is live).
> Plain-markdown fallback because `claude-plugins` is not registered as a codescout artifact repo.
> Companion to [`buddy-introspection.md`](buddy-introspection.md) — that one names the gaps; this one resolves them.

## Done-condition

This plan is **done** when:

1. Eval harness produces a reproducible score per specialist on a frozen test set, with a measured variance floor and a calibrated LLM-judge (Cohen's κ ≥ 0.6 vs human labels on the calibration subset).
2. All 6 systemic issues (S-1..S-6) and all 14 unique per-specialist issues from `buddy-introspection.md` are either fixed (with `eval_status: passing`) or marked `wontfix` with a recorded reason.
3. Self-inspection cadence (§ Self-Inspection Grounds) is scheduled and the next audit date is on a calendar/memory.
4. `buddy/skills/*` mean eval score has not regressed vs the pre-rewrite baseline.

Anything short of this is **in-progress**. Partial wins land in History but do not close the plan.

## Live state

```yaml
phase_current: 0   # Phase 0: eval grounds (blocks Phases 2-3)
phase_total: 4
tasks_total: 38
tasks_done: 16     # T-1, T-2, T-3, T-4, T-5, T-12..T-22 complete
tasks_in_progress: 0
tasks_open: 22
eval_baseline:
  established: false
  variance_floor: null     # populated after T-6
  judge_kappa: null        # populated after T-8
  pilot_specialist: ml-training-takin
  pre_edit_snapshot_sha: 729dc22  # SKILL.md state before Phase 1 edits
  fixtures_count:
    ml-training-takin: 3   # T-3 complete; targeting 5 total in T-9
  judge:
    prompt_drafted: true
    rubrics_drafted: ["ml-training-takin"]
    panel_drafted: true
    panel_version: 1
last_updated: 2026-05-15
```
## Decisions Log

Append-only. Each entry: date, decision-id, what, why, who. Reversals get a new entry pointing back; never edit history in place.

### D-1 — 2026-05-15 — Eval tooling: DSPy + Promptfoo (split roles)

**Decision.** Use **Promptfoo** for fast regression (CI hook on every PR touching `buddy/skills/`) and **DSPy** for offline programmatic optimization (Phase 3+, after baseline is frozen).

**Why.** Single-tool choice would compromise one of the two jobs:
- Promptfoo alone — fast YAML-driven regression, but no automated prompt optimization. Phase 3 (systemic rewrites) would stay manual forever.
- DSPy alone — strong at compile-time prompt search, but slow as a per-PR gate and not designed for asserting regression on a frozen baseline.

The two tools attack non-overlapping problems. Cost of running both is low (Promptfoo runs locally + in CI; DSPy runs offline on demand). The "do not split tools without reason" anti-pattern doesn't apply when the tools have non-overlapping jobs — splitting on job boundary is correct.

**Rejected alternative.** Manual edits-with-eval-gate (no auto-optimization). Reason: 6 systemic gaps × 10 specialists × multiple A/B variants per gap is too many manual cycles. DSPy automates the search.

**Resolves.** T-1 (Phase 0).

**Triggers.** T-5 needs Promptfoo `panel.yaml`; T-11 needs Promptfoo CI workflow. DSPy module work starts in Phase 3.

### D-2 — 2026-05-15 — Pilot specialist: ml-training-takin

**Decision.** Build the first eval fixtures and judge calibration on **ml-training-takin**.

**Why.** Per the introspection sweep, takin has the tightest existing contract — concrete numerical bounds (LR ranges, gradient ratios, batch overfit threshold) make for unambiguous rubric criteria. Rubric ambiguity destroys κ early; pick the specialist where rubric is easiest to write right.

**Resolves.** T-3, T-4 (Phase 0).

### D-3 — 2026-05-15 — First-3 for ibex-promote: debugging-yeti, planning-crane, architecture-snow-lion

**Decision.** Phase 2 pilots use these three.

**Why.** High-traffic (assumed — replace with telemetry when available) + architect's gaps are freshest in our heads from the initial sweep.

**Revisit.** When usage data exists, swap if it disagrees.

**Resolves.** Open decision row 2.

### D-4 — 2026-05-15 — Cases per specialist: 5

**Decision.** 5 cases × 10 specialists = 50 baseline fixtures (T-9). Plus 3 calibration cases × 5 specialists = 15 hand-labeled (T-7).

**Why.** 5 is the minimum hamsa step 7 endorses (*"5+ graded examples or state plainly that the change is unverified"*). Bigger N (10) doubles annotation time without a clear quality win for v1. Expand later if variance floor is too noisy.

**Resolves.** T-7, T-9.

### D-5 — 2026-05-15 — PoLL panel: Anthropic + OpenAI + Google

**Decision.** 3-judge cross-family panel: Claude Sonnet 4.6, GPT-4.1 (or successor), Gemini 2.5 Pro (or successor).

**Why.** Three is the minimum for majority vote without ties. Three different vendor families neutralize per-family self-preference bias (pheasant-llm Method 4(a)). Open-weight alternative (Llama) was considered for reproducibility but a hosted-model panel is faster to wire and the κ-vs-human calibration step (T-8) provides the ground truth anyway.

**Cost.** All three vendors have paid API access. Budget concern: 50 fixtures × 3 judges × 2 (position-swap) = 300 judge calls per full eval run. Expected ~$3–10 per full run at 2026 pricing.

**Resolves.** T-5.

### D-6 — 2026-05-15 — Stale threshold: 90 days

**Decision.** Stale-detector (T-37) warns when any SKILL.md mtime > 90 days AND no eval run in that window.

**Why.** 90 days matches the planned quarterly hamsa sweep cadence. 30 days would generate noise on rarely-edited but eval-passing specialists. 180 days would let lit drift past acceptable.

**Resolves.** T-37.

## Self-Inspection Grounds

The conditions under which the buddy suite gets re-audited. Without these, the introspection sweep we just finished is a one-shot ritual that drifts the moment lit changes or someone edits a SKILL.md.

### Triggers — re-run the hamsa sweep when ANY of these is true

| Trigger | Action |
|---|---|
| Any `buddy/skills/*/SKILL.md` is edited and committed | Re-audit that specialist within 7 days; update `buddy-introspection.md` |
| 90 days since the last full sweep | Re-run the sweep on all 10 specialists (calendar / memory entry) |
| 12 months since the last researcher MCP query on persona-prompt patterns | Re-run the literature query; compare new findings vs the 5 papers in current audit; update systemic rows if lit shifts |
| Eval mean score regresses by more than the variance floor on any specialist | Audit that specialist; the regression is itself a finding |
| A new specialist is added under `buddy/skills/` | Audit before merge — never ship a specialist without going through this lens |

### Methodology — how to re-run (one specialist or the whole suite)

```
Step 1. Summon hamsa: /buddy:summon hamsa
Step 2. Read the SKILL.md (+ lens addendums if any). Hamsa method:
        - locate artifact + symptom (if a failing output exists, use it; else benchmark mode)
        - read as a stranger — no project context, no charity
        - name gaps under H1–H8 + step-5/step-6
Step 3. Cross-check vs current literature snapshot
        (the 5 papers in buddy-introspection.md § Audit scope — or re-run /research if >12 months old)
Step 4. Append findings to buddy-introspection.md:
        - if gap recurs ≥3 specialists → promote to S-N
        - else → next per-specialist row number
Step 5. Run eval (Phase-0 harness) BEFORE proposing fixes — establish the
        baseline for this specialist
Step 6. Open a new task T-N in this plan for each actionable gap
Step 7. Commit tracker updates
```

### Anti-drift discipline

- **Never claim a specialist is "improved" without an eval delta exceeding the variance floor.** This is hamsa-H7 applied to ourselves.
- **Never close an `open` issue without `eval_status: passing` OR an explicit History note "fixed without eval — decay flag set".** Decay flags are reviewed at the next quarterly sweep.
- **Never edit a SKILL.md without running the eval suite for that specialist first.** Skipping creates an unfalsifiable claim.
- **Position-swap every judge run.** If verdict reverses on response-order swap, the judge is biased; do not trust the score.

## Evaluation Grounds

The harness that makes every other phase falsifiable.

### Directory layout (proposed)

```
eval/
  README.md                     # how to run; how to add a case
  fixtures/
    <specialist>/
      case-01.yaml              # input prompt + ideal output rubric
      case-02.yaml
      ...
  judge/
    prompt.md                   # cross-family LLM judge with per-Method rubric
    panel.yaml                  # PoLL config: 3 judges from different families
    calibration/
      human-labels.csv          # human-annotated subset for κ calibration
  baselines/
    <date>/<specialist>/        # frozen scores per release
  promptfoo.yaml                # Promptfoo config — fast regression
  dspy/                         # DSPy modules — automated prompt optimization
  scripts/
    run.sh                      # generator → judge panel → score → diff vs baseline
    variance-floor.sh           # identical-input N=5 reruns → noise floor per case
```

### Per-case fixture format (YAML)

```yaml
case_id: case-01
specialist: ml-training-takin
input:
  user_message: |
    My loss is 4.2 and won't drop. I'm training a 7B LLM on 10k examples.
    LR is 1e-5. What's wrong?
ideal_rubric:
  # each criterion = boolean assertion the judge evaluates
  - asks_for_loss_curve_shape: true
  - asks_for_grad_norm: true
  - mentions_lr_sweep_or_overfit_tiny_batch: true
  - avoids_recommending_bigger_model_immediately: true
  - cites_at_least_one_method_step_or_heuristic_id: true
notes: |
  Tests Method 1 (overfit tiny first), Method 2 (LR sweep),
  Reaction 2 (no bigger-model jump).
```

### Judge prompt skeleton

```
You are evaluating an AI persona named <specialist> against a rubric.

For each rubric item:
  1. Quote the relevant span of the candidate's response (or note its absence)
  2. Score 0 or 1 against the criterion
  3. State your reasoning in ONE sentence

Do NOT score holistically. Score per-criterion only.

Output JSON: {rubric: [{criterion, evidence, score, reasoning}, ...], total: N/M}

Constraints:
- Use chain-of-thought BEFORE the final JSON (forces explicit reasoning vs self-preference bias)
- If you cannot find evidence for a criterion, score 0 — never assume.
- Position-swap protocol: this is run A→B for half the cases and B→A for the other half.
  If your verdict on the same pair reverses, mark `position_unstable: true`.
```

### PoLL panel — 3 cross-family judges

| Slot | Provider | Model | Role |
|---|---|---|---|
| 1 | Anthropic | Claude Sonnet 4.6 | semantic precision |
| 2 | OpenAI | GPT-4.1 or successor | breadth coverage |
| 3 | Google | Gemini 2.5 Pro or successor | independence check |

Final score = **majority vote per criterion**, not average. Average masks 2:1 disagreement.

### Calibration target

- Annotate 15 cases by hand (3 cases × 5 specialists).
- Run the panel on the same 15 cases.
- Compute Cohen's κ panel-vs-human.
- **Acceptance: κ ≥ 0.6.** Below that, iterate the judge prompt (decompose more, add few-shot examples, tighten criteria) until κ clears.

### Variance floor

For 3 selected cases per specialist, re-run identical input 5×. Record max |Δ| in score. That delta is the floor: **any reported "improvement" smaller than the floor is noise.**

This is hamsa-H7 + pheasant-llm Method 8 applied to ourselves.

### Tooling roles

| Tool | Job | When invoked |
|---|---|---|
| **Promptfoo** | YAML-driven regression; every PR runs subset on changed specialists | Every PR (CI hook) |
| **DSPy** | Programmatic prompt optimization; compile each persona against its rubric | Phase 3+ (after baseline frozen) |
| **Human review** | Calibration; spot-check on top 5% disagreements | Quarterly |

Picking both is intentional — Promptfoo for fast-feedback regression, DSPy for offline optimization. Single-tool would compromise one or the other.

## Phased task list

Each task is a **deliverable** (planning-crane Method 2), sized to one focus session (Method 4). Phases are sequenced by dependency (Method 3) — no Phase-N task starts before Phase-(N-1) is closed.

### Phase 0 — Eval grounds (blocks everything else)

| T   | Task | Deliverable | Est | Notes |
|----:|------|-------------|----:|-------|
| T-1 | Pick eval tooling: confirm DSPy + Promptfoo split | DECISION recorded in this tracker | 30m | _Default picked; user can revise_ |
| T-2 | Create `eval/` directory skeleton (per layout above) | committed empty dirs + README | 30m | |
| T-3 | Draft 3 fixture cases for ml-training-takin (pilot specialist) | `eval/fixtures/ml-training-takin/case-{01,02,03}.yaml` | 60m | Pick from real session traces if available |
| T-4 | Write the judge prompt (skeleton above) + per-Method rubric for takin | `eval/judge/prompt.md` + `rubric-ml-training-takin.md` | 90m | |
| T-5 | Wire 3-model PoLL panel via Promptfoo | `eval/judge/panel.yaml` | 60m | Needs API keys: Anthropic, OpenAI, Google |
| T-6 | Run variance-floor measurement (N=5 identical reruns × 3 cases × pilot specialist) | `eval/baselines/<date>/ml-training-takin/variance.json` | 30m | |
| T-7 | Hand-label 3 cases × 5 specialists = 15 cases for calibration | `eval/judge/calibration/human-labels.csv` | 120m | Highest manual-effort task |
| T-8 | Run panel on calibration set; compute κ; iterate judge prompt until κ ≥ 0.6 | `eval/judge/calibration/kappa-run-<n>.json` | 120m | May need 2–3 iterations |
| T-9 | Expand fixtures: 5 cases × each of 10 specialists = 50 cases | full `eval/fixtures/` | 8h | Spread across multiple sessions; budget ~50m per specialist |
| T-10 | Freeze baseline scores; commit `eval/baselines/<date>/` | baseline JSON per specialist | 30m | This is the **pre-rewrite reference** |
| T-11 | Wire Promptfoo into CI; gate merges on no-regression | `.github/workflows/eval.yml` + `promptfoo.yaml` | 60m | Run subset on changed files only |

**Phase 0 done-condition:** baseline frozen, judge calibrated, CI gating live.

### Phase 1 — Cheap unique fixes (no eval gate needed — purely additive copy edits)

These can run in parallel with Phase 0 — they are mechanical, low-risk, do not require A/B testing.

| T   | Task | Resolves |
|----:|------|----------|
| T-12 | Add `symbols`/`grep` parenthetical to architect Heuristic 7 | #6 |
| T-13 | Rewrite debugging-yeti Method 8 (commit/PR message externalization) | #9 |
| T-14 | Reframe testing-snow-leopard Method 4 (AAA or GWT — pick one) | #10 |
| T-15 | Rewrite refactoring-yak Method 6 ("elevator test" replaces "read aloud") | #11 |
| T-16 | Tag codescout-specific tool names in refactoring-yak Method 4 | #12 |
| T-17 | Gate performance-lammergeier Method 6 systems-lang content | #14 |
| T-18 | Lead with definition for planning-crane Method 7 "compaction" | #15 |
| T-19 | Drop or cite planning-crane Reaction 3 quantitative claim | #16 |
| T-20 | Rewrite docs-lotus-frog Method 7 to same-commit discipline | #17 |
| T-21 | Sub-bullet pheasant-llm Method 4 judge biases | #18 |
| T-22 | Add OWASP LLM Top 10 sub-category to security-ibex Phase-2 Taxonomy | #21 |

**Phase 1 done-condition:** 11 SKILL.md edits committed; each commit references the
introspection row it resolves; eval baseline is unchanged (these are not behavior changes).

### Phase 2 — Promote ibex patterns (eval-gated)

Three high-traffic pilots first. Each pilot is one A/B run.

| T   | Task | Resolves (partial S-N) |
|----:|------|----------------------|
| T-23 | Pilot ibex-promote on debugging-yeti: add Operating Principles, Phased Method with self-critique, Finding Format, Self-Traps | partial S-2, S-3 |
| T-24 | Pilot ibex-promote on planning-crane (same 4 patterns) | partial S-2, S-3 |
| T-25 | Pilot ibex-promote on architecture-snow-lion (same 4 patterns) | partial S-2, S-3 |
| T-26 | Run eval on the 3 pilots; require ≥ variance-floor improvement on at least 1 specialist, no regression on any | gate for T-27 |
| T-27 | If gate passes: roll out to remaining 6 (testing, refactor, ml, perf, docs, leakage) | full S-2, S-3 |
| T-28 | Promote pheasant lens-dispatch pattern as official template for multi-aspect specialists; document in `buddy/skills/AUTHORING.md` | #19 (positive) |

**Phase 2 done-condition:** S-2 and S-3 resolved across all 10 specialists; eval scores
report a net positive vs baseline; AUTHORING.md exists.

### Phase 3 — Systemic large rewrites (eval-gated, one S-N at a time)

The dangerous phase. Each S-N gets piloted on 3 specialists, eval'd, then rolled out
only if positive.

| T   | Task | Resolves |
|----:|------|----------|
| T-29 | S-4 pilot: add `_Applies: <ref>_` lines to Reactions + "Reactions non-exhaustive" disclaimer (3 specialists) | partial S-4 |
| T-30 | Eval gate; roll out to remaining 7 if positive | full S-4 |
| T-31 | S-1 pilot: cut biographical bio on 3 specialists; keep one-line tone cue | partial S-1 |
| T-32 | Eval gate; if positive, roll out; if negative, revert and mark wontfix with finding | full S-1 or wontfix-with-data |
| T-33 | S-6 experiment: dialogic recast of debugging-yeti's Voice (interview-style) vs current declarative | data point for S-6 decision |
| T-34 | Decide S-6 disposition based on T-33 result; document outcome | full S-6 or wontfix-with-data |

**Phase 3 done-condition:** every S-N has a decision (fixed-and-eval-passing OR
wontfix-with-data-on-why); no specialist regressed.

### Phase 4 — Long-term hygiene

| T   | Task | Cadence |
|----:|------|---------|
| T-35 | Schedule quarterly hamsa sweep — memory entry + calendar reminder | next: 2026-08-15 |
| T-36 | Schedule annual researcher MCP lit refresh | next: 2027-05-15 |
| T-37 | Implement stale-detector: warn if any SKILL.md mtime > 90 days AND no eval run in that window | one-off script |
| T-38 | Document the introspection + plan loop in `buddy/docs/introspection-loop.md` for future maintainers | one-off doc |

**Phase 4 done-condition:** cadence is on calendar; stale-detector is wired; the loop
is documented so this plan can be re-derived without re-summoning hamsa from scratch.

## Open decisions

The plan above carries defaults. All 6 defaults were accepted on 2026-05-15 (see § Decisions Log). The table below preserves the rejected alternatives for future reference if a decision is revisited.

| Decision | Accepted | Alternatives (rejected, preserved) | Reversal trigger |
|---|---|---|---|
| Pilot specialist for harness (T-3..T-8) | **ml-training-takin** (D-2) | architecture-snow-lion, data-leakage-snow-pheasant | If takin rubric proves harder than expected (κ <0.6 after 3 prompt iterations), swap to pheasant |
| First-3 for ibex-promote (T-23..T-25) | **debugging-yeti, planning-crane, architecture-snow-lion** (D-3) | substitute by usage telemetry | Telemetry data available |
| Cases per specialist (T-9) | **5** (D-4) | 10 | Variance floor on 5 too high to detect Phase-3 deltas |
| PoLL panel composition | **Anthropic + OpenAI + Google** (D-5) | Anthropic + OpenAI + open-weight (Llama) | API budget pressure or κ instability |
| Optimization tool (Phase 3+) | **DSPy** (D-1) | Manual edits-with-eval-gate | If DSPy onboarding cost exceeds a Phase 3 manual cycle |
| Stale threshold (T-37) | **90 days** (D-6) | 30 / 180 days | Quarterly cadence proves too slow or too aggressive in practice |
## History

### 2026-05-15 — Plan created

- Plan derived from `buddy-introspection.md` sweep (10 specialists audited).
- Self-inspection grounds and evaluation grounds documented in dedicated sections.
- 38 tasks across 4 phases. Phase 0 (eval grounds) blocks Phases 2 and 3.
- Phase 1 (cheap fixes) can run in parallel with Phase 0.
- Open decisions section preserves user override surface.

### 2026-05-15 — T-1 complete; all 6 defaults accepted

- Decisions D-1 through D-6 recorded.
- T-1 (eval tooling: DSPy + Promptfoo) closed. Deliverable: D-1 in Decisions Log.
- Phase 0 unblocked beyond T-1. Next: **T-2** (create `eval/` directory skeleton + README).
- T-12 through T-22 (Phase 1, cheap fixes) are also unblocked — they run in parallel.

### 2026-05-15 — T-2 + Phase 1 fan-out complete

- **T-2** done: `eval/` skeleton created with README, subdirs (`fixtures/`, `judge/{rubrics,calibration}/`, `baselines/`, `dspy/`, `scripts/`), empty `promptfoo.yaml`.
- **Phase 1 (T-12 through T-22)** done: 11 surgical SKILL.md edits applied by 3 parallel agents (groups A/B/C). All edits matched their spec exactly; no auto-rewrites; no behavioral drift beyond the named fix.
- Diff: 9 files changed, +31 −10 lines (architecture-snow-lion, debugging-yeti, testing-snow-leopard, refactoring-yak ×2, performance-lammergeier, planning-crane ×2, docs-lotus-frog, data-leakage-snow-pheasant/_llm.md, security-ibex).
- One markdown-format nit fixed post-hoc: missing blank line before `## Severity Rubric` in security-ibex.
- Committed in two atomic commits:
  - **a73c47c** — `chore(buddy): add introspection + active-plan trackers and eval skeleton` (this tracker, the introspection tracker, eval/ skeleton)
  - **f97f2a4** — `refactor(buddy/skills): Phase 1 cheap fixes per buddy-introspection T-12..T-22` (the 11 SKILL.md edits)
- Pre-edit reference SHA recorded in live state: `729dc22`.
- Status: 13/38 tasks done. Phase 0 next-up: **T-3** (draft 3 fixture cases for ml-training-takin pilot).

### 2026-05-15 — T-3 complete (ml-training-takin fixtures)

- 3 fixture cases written for ml-training-takin (pilot specialist):
  - `case-01.yaml` — pre-train plateau (Method 1/2, Heuristic 2, Reaction 2)
  - `case-02.yaml` — train-serve skew (Method 6, Heuristic 4, Reaction 3)
  - `case-03.yaml` — post-quantize aggregate-OK trap (Method 7, Reaction 5)
- Each fixture: 5–6 boolean rubric criteria, all targeting `true` (response
  must do X; "avoids_Y: true" used for must-not-do criteria).
- Cases cover three distinct phases of an ML pipeline: pre-train, deploy,
  post-train compression — exercises non-overlapping Method/Heuristic/Reaction sets.
- Status: 14/38 tasks done. Phase 0 next-up: **T-4** (judge prompt + per-Method
  rubric for takin).

### 2026-05-15 — T-4 complete (judge prompt + takin rubric)

- `eval/judge/prompt.md` written: cross-family judge prompt template with
  decompose-not-holistic, CoT-before-JSON, NO-EVIDENCE-FOUND explicit-absence
  string, position-swap discipline, "avoids_X: true" polarity rule, and
  forbidden style-based penalization. Output is a single fenced JSON block at
  end of response.
- `eval/judge/rubrics/ml-training-takin.md` written: full specialist surface
  restatement (M1-M8, H1-H8, R1-R5) + per-criterion grounding table for each
  of the 3 fixture cases. Each rubric criterion has a named Method/Heuristic/
  Reaction grounding and an explicit "score-1 evidence pattern".
- Sources cited inline in prompt.md: Min et al. FActScore (decompose),
  Zheng et al. MT-Bench (CoT-before-JSON), Wang et al. (position bias).
- Status: 15/38 tasks done. Phase 0 next-up: **T-5** (wire 3-model PoLL panel
  via Promptfoo — `eval/judge/panel.yaml`).

### 2026-05-15 — T-5 complete (PoLL panel wired)

- `eval/judge/panel.yaml` written: 3-judge cross-family panel definition.
  - Claude Sonnet 4.6 (Anthropic)
  - GPT-4.1 (OpenAI)
  - Gemini 2.5 Pro (Google)
- All 3 judges pinned to specific model IDs, temperature 0, max_tokens 4000.
- Aggregation rule: majority vote per criterion; split (1-of-3) → score 0 +
  `panel_split` flag for human review.
- Position-swap discipline enforced at panel level; reversed verdicts flagged
  `position_unstable: true`.
- κ ≥ 0.6 calibration target baked into panel config; below that requires
  judge-prompt iteration before trusting scores.
- `panel_version: 1` tag for reproducibility — baseline scores namespaced by
  version; cross-version comparisons forbidden.
- `eval/promptfoo.yaml` filled: overall harness config wiring fixtures →
  candidate (Opus 4.7, t=0.7) → judge panel. `threshold: 0.8` per case.
- Several provider-string and Promptfoo-schema specifics marked
  `# verify on first run` — confirm with actual API calls during T-6.
- Runtime requires `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`.
- Status: 16/38 tasks done. Phase 0 next-up: **T-6** (variance-floor
  measurement on ml-training-takin — 3 cases × 5 reruns).
