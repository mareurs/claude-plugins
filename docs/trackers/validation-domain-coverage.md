---
id: de7b91e7010fc3d9
kind: tracker
status: active
title: Roster Domain Coverage — AI Eng / DS Validation (VG-N)
tags:
- validation
- domain-coverage
- ai-engineering
- data-science
- buddy-roster
topic: AI engineering and data science validation competencies; which buddy specialists own them; prompt scaffolds for building validation
entry_high_water_VG: 10
entry_prefix: VG
---

> **Tracker schema:** audit_issues archetype, prose ledger (`VG-N` body sections, no
> `entry_collection`). Deliberately un-augmented — the value here is the prose, and
> augmentation has no on-disk form, so it would not survive a catalog rebuild.

## Live state

```yaml
axis: domain coverage          # NOT prompt craft — see buddy-introspection.md for that axis
roster_version: 0.9.1
roster_lines_total: 1958       # verified against source, not plugin cache, 2026-08-26
specialists: 12
competencies_surveyed: 14
competencies_held: 4
competencies_partial: 4
competencies_unowned: 6
entries_total: 10
entries_open: 9
entries_mitigated: 1           # VG-9 — spine reshaped, effect not yet measured
entries_closed: 0
new_specialists_proposed: 2    # data-contract (VG-1, VG-2), eval-harness-teaching (VG-5)
spine_status: rewritten 2026-08-26 to outcome framing; UNMEASURED — see VG-9
scope_note: >
  VG-1..VG-8 are coverage findings — which competency has no owner. VG-9 and VG-10 are
  method findings, about this tracker's own prompt spine and about audit triggers. They
  live here because VG-9 concerns content this tracker owns, and VG-10 was found while
  writing it. VG-10's fix lands in active-plan.md, since it amends D-6, not here.
feeds:
  - buddy/docs/trackers/headroom-optimization.md   # VG-7 → backlog item 2b
  - docs/trackers/active-plan.md                   # VG-10 → amends D-6
  - docs/trackers/buddy-learning-and-model-drift.md # VG-9 ablation belongs here
related:
  - docs/trackers/buddy-introspection.md           # prompt-craft audit; different axis
  - docs/trackers/active-plan.md                   # execution plan; owns the T-N namespace
last_updated: 2026-08-26
```
## Done-condition

Closes when every `VG-N` is `fixed` or `wontfix`, and the coverage map below shows no
`unowned` row. Reaching that means the roster has an owner for each validation
competency an AI engineer / data scientist actually needs — not that each owner is
well-written, which is `buddy-introspection.md`'s question.

## Why this exists, and what it is NOT

`docs/trackers/buddy-introspection.md` audits the specialists on **prompt craft** —
role-priming, I/O contract, scope rules, Reactions, eval presence, framing (H1–H8,
S-1..S-6). It never asks which *subject-matter competencies* the roster covers.

This tracker is that second axis: for the work of an AI engineer / data scientist,
**which validation competencies has nobody been made responsible for?** A specialist can
score perfectly on every hamsa heuristic and still leave a domain unowned; conversely
every gap below could be filled by a specialist that S-1 would flag for heavy
role-priming. The two audits are orthogonal and neither substitutes for the other.

Four validation kinds fail differently — *data* arriving wrong, a *model* generalising
worse than its score claims, an *LLM system* regressing silently on a prompt edit, and
ordinary *code* whose tests assert nothing. The roster covers the second well.

The shape of the finding: the roster is strong at **diagnosis after the fact** and thin
at **constructing the gate up front**. The Snow Pheasant will tell you a split leaked;
nothing writes the schema contract that stops the bad column arriving.

## Coverage map — AI Eng / DS validation competencies

| Competency | Owner on the roster | State | Entry |
|---|---|---|---|
| Train/test leakage, eval integrity | `data-leakage-snow-pheasant` | held | — |
| Training loops, inference parity | `ml-training-takin` | held | — |
| Test suite design, coverage, flake | `testing-snow-leopard` | held | — |
| Prompt critique, eval-driven iteration | `prompt-hamsa` | held | — |
| Reproducibility: seeds, lineage, tracking | takin Self-Trap 8 only | partial | — |
| ML-specific security | `security-ibex`, appsec framing only | partial | see buddy-introspection `#21` |
| Property-based / invariant testing | implied by snow-leopard Principle 3, never named | partial | `VG-6` |
| Eval-harness construction as a taught skill | harness exists in `eval/`; no specialist teaches it | partial | `VG-5` |
| Data schema contracts & pipeline gates | — | **unowned** | `VG-1` |
| Drift, freshness, distribution monitors | — | **unowned** | `VG-2` |
| Calibration, slice metrics, threshold choice | — | **unowned** | `VG-3` |
| Release gating: shadow, canary, model cards | — | **unowned** | `VG-3` |
| Judge calibration & bias control as a taught skill | practised under `D-7`; no specialist teaches it | **unowned** | `VG-5` |
| EDA & feature engineering | — | **unowned** | `VG-4` |

**One boundary worth keeping.** The Snow Pheasant guards *hygiene between splits*.
Data-contract work guards *format and distribution in a running pipeline*. These look
adjacent and are not: leakage is a design error found by reading a split, drift is a
runtime condition found by watching a monitor. Folding them into one specialist would
blunt both — which is why `VG-1`/`VG-2` propose a new specialist rather than extending
the Pheasant.

## The prompting spine — what to require, and why

The durable craft asset from this survey, and the part most reusable outside the roster.
Applies to any request that asks an agent to write validation, for AI work or ordinary
code.

**Rewritten 2026-08-26.** The first version was a numbered seven-step script. `VG-9`
carries the evidence that retired that shape and names which of its rules did not
survive. What follows keeps only requirements whose failure reproduces on current
models, and states them as outcomes rather than choreography.

The dominant failure is not that agents write too few checks — it is that they write
checks which **cannot fail**. The literature calls it *residual alignment*: the model
reads the implementation, infers that current behaviour is correct behaviour, and
encodes the bug as the expectation. Green suite, certifies nothing. Everything below
serves the single requirement that follows from it.

**Derive expected values from the specification, not from what the code returns.** The
one prohibition worth stating outright, because its failure gets *worse* as models get
stronger: reward-hacking research finds that test tampering and special-casing to pass
scale with capability, and outcome-only metrics do not catch either. Where the spec is
silent, naming the unspecified case beats asserting a value for it.

**Every assertion should have a one-line change to production code that turns it red.**
This is `testing-snow-leopard` Principle 3, and it is the only check on whether the
requirement above was actually met — a bar the output must clear, not a step to perform.

**A failing check is the result, not a problem to tidy.** The repair direction worth
closing off is editing the check to match the code; that prohibition has provenance too.

**Enforce the mutation bar and the evidence requirement in the harness, not the prompt.**
Prompt text competes for attention over a long session; a `PostToolUse` hook that puts
real output into context and a `Stop` hook that blocks on a red suite do not. Hardening
the environment is also the intervention with a measured effect — up to 88% reduction in
reward-hacking behaviour. `VG-9` carries this as its fix.

```text
The checks you write must be able to fail.

Derive expected values from the spec, the docstring, or the ticket. Where
those are silent, name the unspecified case rather than asserting a value
for it.

Every assertion needs a one-line change to production code that would turn
it red. An assertion without one is decoration.

Run it and report what came back. A failing check is a result; editing the
check to match the code is not.
```

**Deliberately absent:** contract-restatement-first, plan-before-acting, whole-unit
context supply, and repo-idiom few-shot retrieval. All four were in the first version.
All four are either named anti-patterns for current models or rest on measurements taken
under constraints that no longer hold — see `VG-9`.

### Domain block A — LLM & GenAI evals

Failure mode: an eval whose judge agrees with anything, gated on per-case pass/fail
against a probabilistic system — so the gate is either always red or quietly disabled.

```text
Golden set: 200–2,000 items from real production failures, not
synthetic generation. Version it under review like source code.
Record provenance and risk tags per item.

Judge: pin the model version, temperature 0, version the judge
prompt. Score against a rubric of verifiable criteria, not a 1–5
subjective scale. Swap the position of compared outputs and average —
position bias is real, so is verbosity bias.

Calibrate the judge against human labels before trusting it. Report
the agreement rate.

Groundedness: decompose the output into atomic claims, verify each
against retrieved context with an NLI entailment check. Similarity is
not groundedness.

Gate on aggregate score trend across runs, not individual case failure.
```

This repo already practises most of this — see `active-plan.md` § Evaluation Grounds and
`D-7`. The `human_anchor_TODO` in its live state is precisely the "calibrate against
human labels" line above, already acknowledged as outstanding.

### Domain block B — Classic ML model validation

Failure mode: validating at threshold 0.5 on a random split with transforms fitted
before splitting, reporting one aggregate number that hides every failing subgroup.

```text
Split along the causal axis first. Forward in time → chronological or
walk-forward. Generalising across users/accounts → GroupKFold. Never
random shuffle over a correlated unit.

Every transform inside a Pipeline so it refits per fold. Resample
inside the CV loop only. Target encoding out-of-fold.

Report a permuted-label baseline. If shuffled y still beats the prior,
the split structure leaks.

Before release: check probability calibration, report metrics per
subgroup slice not just aggregate, and select the decision threshold
from the cost of each error — not 0.5.

State what shadow or canary stage precedes full traffic, and what
triggers rollback.
```

The first three paragraphs restate `data-leakage-snow-pheasant:classic`, which is the
authority. The last two are `VG-3` — unowned.

### Domain block C — Data & pipeline validation

Failure mode: one validation function mixing schema checks with distribution checks, so
a legitimate seasonal shift trips the same alarm as a renamed column — and the alarm
gets muted.

```text
Separate two layers, and never merge them:

STRUCTURAL — types, nullability, ranges, categorical membership,
referential integrity, uniqueness. Deterministic. A violation blocks
the pipeline. Express as code-level schema (Pandera-style
DataFrameSchema) in CI.

STATISTICAL — distribution shift on features, labels, and the
input→target relationship. Probabilistic. Use KS / chi-square / PSI /
KL. A violation opens a tiered response: minor → retrain, moderate →
human review, severe → stop serving.

Write-Audit-Publish: write to a staging location, run gates, publish
only on pass. Never validate data that is already live.

State each feature's freshness SLA against the prediction horizon. A
feature that arrives after the decision is not a feature.

Version the schema semantically. A breaking change is a major bump
with a consumer notice.
```

Entirely unowned — `VG-1` and `VG-2`.

### Domain block D — Ordinary code

Failure mode: five happy-path examples, an assertion that the result merely exists, and
heavy mocking that pins the call sequence rather than the behaviour.

```text
Prefer invariants to examples. For each unit, propose properties before
cases: round-trip (decode(encode(x)) == x), idempotency, metamorphic
relations, order-independence, conservation. Implement with Hypothesis
or fast-check. For multi-step or stateful units, model with
RuleBasedStateMachine rather than sequenced unit tests.

Every parameter gets its boundary cases before its happy path: zero,
one, max, empty, null, negative, Unicode, exactly-at-the-limit.

Every new branch gets a test reaching both sides — present and absent.

Assert the specific cause, never that an error merely occurred.
is_err() / is not None does not discriminate between code paths raising
the same type.

Mocks: reuse the mocking patterns already in this repo's human-written
tests. Do not invent a mock structure, and do not assert on call order
unless order is the contract.
```

First paragraph is `VG-6`.

## VG-1 — No owner for data schema contracts and pipeline quality gates

**Status:** open
**Valid:** conditional — a specialist claims schema-contract / pipeline-gate territory on the roster
**Rests on:** the split-vs-pipeline boundary argued in § Coverage map — leakage is a design error read off a split, drift is a runtime condition read off a monitor.

Nothing on the roster owns structural data validation: types, nullability, ranges,
categorical membership, referential integrity, uniqueness, Write-Audit-Publish, semantic
schema versioning, feature freshness SLAs. Content is Domain block C, structural half.

**Proposed fix.** A new specialist, working name *Data Contract Marmot* — sentinel on a
rock, whistles before the threat arrives. Defining principle, the analogue of the
Pheasant distrusting a high score: **refuses to merge structural and statistical
checks.** Lenses `:schema` and `:drift`, split per the Pheasant's file layout — but
only after `VG-7`, so it inherits a properly extracted base. Draft with `/buddy:create`.

Note the roster naming convention is the user's; the animal is a placeholder.

## VG-2 — No owner for drift, freshness, and distribution monitors

**Status:** open
**Valid:** conditional — a specialist claims drift-monitoring territory on the roster
**Rests on:** § Coverage map; shares a fix with `VG-1`.

Statistical monitoring is absent: data drift, label drift, concept drift, KS /
chi-square / PSI / KL, tiered response (minor → retrain, moderate → human review, severe
→ stop serving), and the delayed-feedback case where labels are not yet available.

Closed by the `:drift` lens of the `VG-1` specialist. Filed separately because it is a
distinct competency and could be closed independently if the fix is split.

## VG-3 — No owner for model release gating

**Status:** open
**Valid:** conditional — a specialist claims calibration / threshold / release-gate territory
**Rests on:** Domain block B, final two paragraphs — the part `data-leakage-snow-pheasant:classic` does not cover.

Unowned: probability calibration, subgroup slice metrics, fairness auditing, decision
threshold selection from error cost rather than a 0.5 default, model cards, shadow
deployment, canary release, rollback triggers.

The Pheasant's `:classic` lens covers split/transform/resample discipline and stops
there. Everything between "the model scores well" and "the model is safe to serve" has
no owner.

## VG-4 — No owner for EDA and feature engineering

**Status:** open
**Valid:** conditional — a specialist claims EDA / feature-engineering territory
**Rests on:** § Coverage map.

The whole front half of data-science work is absent from the roster. Lowest urgency of
the six unowned rows — it is exploratory rather than gating, so nothing silently ships
wrong because it is missing. Recorded for completeness; may well close `wontfix` if the
roster is deliberately scoped to validation and review rather than discovery.

## VG-5 — Eval-harness construction is built here but not teachable

**Status:** open
**Valid:** conditional — a specialist owns eval-harness construction, or S-5 closes with per-specialist fixtures
**Rests on:** `S-5` in buddy-introspection (still open), and `active-plan.md` § Live state `fixtures_count`.

**This entry corrects the first pass of this survey** — see § Corrections. The repo
*does* have a real eval harness: `eval/`, a PoLL panel across three model families,
κ calibration against strong-panel labels under `D-7`, a measured variance floor of
0.200, and frozen baselines under `eval/baselines/frozen/`. That is more mature than the
published practice this survey went looking for.

Two things are nonetheless true:

1. **Coverage is thin.** `fixtures_count` in `active-plan.md` records
   `ml-training-takin: 3`. One specialist of twelve has fixtures; `S-5` remains open
   across all ten audited. `fixture-expansion.md` owns closing that.
2. **No specialist teaches it.** `prompt-hamsa` insists on an eval and will not call a
   prompt improved without one (its Operating Principle 3) — but it cannot build one, and
   nothing else on the roster can either. A user asking "how do I build an eval for my
   RAG pipeline" gets the obligation without the method. Judge calibration and bias
   control (position bias, verbosity bias, rubric design) are practised in this repo and
   taught nowhere.

**Proposed fix.** A new specialist owning golden-set construction, rubric design, judge
calibration, and — with `VG-3` — calibration/slices/thresholds and release gating.
Working name *Eval Harness Bharal*. Non-negotiable: **no eval is trusted until its judge
has been scored against human labels** — which is exactly the `human_anchor_TODO` this
repo already carries.

Distinct from `S-5`: that is "this roster's specialists lack graded examples," an
internal quality gap. This is "the roster cannot teach a user to build an eval," a
coverage gap. Closing one does not close the other.

## VG-6 — Property-based testing has no home in the roster

**Status:** open
**Valid:** conditional — `testing-snow-leopard` gains a property/invariant lens or section
**Rests on:** `testing-snow-leopard` Principle 3 (mutation-aware assertions), which implies invariant thinking without naming it; and buddy-introspection's `#10 — testing-snow-leopard — AAA-only pattern lock`.

Invariants, generators, shrinking, metamorphic relations, and `RuleBasedStateMachine`
for stateful units are the standing answer to the test-oracle problem, and the roster
never names them. Principle 3 gets close — asking what one-line change flips an
assertion red is invariant reasoning — but the skill offers no vocabulary or method for
writing a property.

Related to but not the same as `#10`: that entry says the skill locks to
Arrange-Act-Assert as a *format*; this says it lacks property-based testing as a
*discipline*. A fix for `#10` that merely loosened the format would not close this.

Content is Domain block D, first paragraph. Cheapest of the six to close — it is a
section, not a specialist.

## VG-7 — The Snow Pheasant lens split is under-extracted

**Status:** open
**Valid:** conditional — the `_llm.md`-to-`SKILL.md` line ratio in `data-leakage-snow-pheasant` changes
**Rests on:** the under-extraction rule stated below; feeds `buddy/docs/trackers/headroom-optimization.md` backlog item 2b.

Verified against source on 2026-08-26 (not the plugin cache):

| Load | Lines | vs. monolith |
|---|---:|---:|
| monolith (136 base + 59 classic + 129 llm) | 324 | 100% |
| base + `:classic` | 195 | 60% |
| base + `:llm` | 265 | **82%** |

buddy-introspection records lens dispatch as a positive pattern (`#19`), and it is. But
nobody has measured the split's *quality*. At 129 lines the LLM addendum is almost as
large as the 136-line base, so a `:llm` summon still loads 82% of the monolith — a thin
saving. That is a signal about the base, not the lens: material general enough to sit in
`SKILL.md` is stuck in the addendum.

> **The rule: an addendum approaching the size of its base means the base is
> under-extracted.**

**Why this matters beyond tidiness.** `headroom-optimization.md` measures `skill_load` at
~27K tok / 18.7% of the context window, and its backlog item 2b names "leaner SKILL.md
bodies for skills we own (buddy specialists)" as a live sub-lever — with mid-session
eviction ruled out, so trim-at-source is the only remaining move. The lens pattern *is*
that mechanism, and this ratio is how you tell whether a given split delivers.

Fix the exemplar before cloning the pattern to `VG-1`, `VG-5`, or any specialist split,
or every copy inherits the flaw.

## VG-8 — buddy-introspection records security-ibex at a stale line count

**Status:** open
**Valid:** dated 2026-08-26
**Rests on:** direct read of `buddy/skills/security-ibex/SKILL.md` on 2026-08-26.

buddy-introspection's `#20 — security-ibex — Length 167 lines` no longer matches source:
the file is **181 lines**. Doc-vs-code drift, low severity, but it is the kind that
compounds — a length-based finding whose number has moved is evidence the audit has not
been re-run since 2026-05-15, which `active-plan.md`'s `T-35` (quarterly hamsa sweep,
next 2026-08-15) says was due eleven days before this entry was written.

Not a coverage gap. Filed here because this survey found it while verifying line counts,
and dropping it would be the drift the entry describes.

## VG-9 — The prompting spine was over-specified for current models

**Status:** mitigated — spine rewritten 2026-08-26; shape corrected, effect not measured
**Valid:** conditional — the rewritten spine is ablated per-model against the eval harness
**Rests on:** `shared/prompt-audit.md` §1a/§1b/§1c in the bundled `claude-api` skill — first-party guidance on prompting patterns that degrade current models — plus the capability-scaling result in the reward-hacking literature.

The seven-rule spine as first written rested on benchmark literature about unit-test
generation, largely pre-2026 models, plus extrapolation. It was presented as durable
craft with citations attached. The citations do not reach that far, and three of the
seven rules match named anti-patterns for the models actually in use.

**Matched anti-patterns.** `prompt-audit.md` §1c, *Over-specification — describe the
goal, not the method*, names step-by-step choreography for judgment tasks: prompts
written for prior models "are often too prescriptive for current ones and degrade output
quality — the model's own plan usually beats a hand-written script." The spine was a
numbered 1–5 script for a judgment task. The same section names prohibition lists,
noting that "a prohibition against a failure the model wasn't going to make can anchor
it toward that failure," with a greppable signal of runs of 3+ `Do not` / `Never` /
`Avoid` — the spine's pasteable block had exactly three. §1b retires "plan before
acting" outright: "current models plan without being told, and these cause
over-planning." Rule 1 was plan-before-acting. §1a adds the register point: "an anxious
prompt produces a cautious, hedging model."

Independent web evidence converged rather than conflicted: explicit chain-of-thought
scaffolding is largely obsolete for models with native reasoning, showing a U-shaped
error curve and 20–80% added latency for roughly 3% accuracy. Rule 1 was therefore not
merely unsupported — the evidence points the other way.

**What survived, and why the split is principled.** §1c carries its own carve-out: keep
prohibitions whose failure reproduces on the target model. Reward-hacking research finds
that test tampering and special-casing to pass scale *with* capability, that environment
hardening cuts such behaviour by up to 88%, and that outcome-only metrics are
insufficient to detect it. So the implementation-as-oracle ban, the mutation bar, the
evidence requirement, and harness enforcement all target a failure that gets *worse* on
stronger models, and survive on their own provenance. Retired: contract-restatement
-first; whole-unit context supply (its ">50% oracle accuracy" figure was measured under
context scarcity and is likely moot against a 1M window); and repo-idiom few-shot
retrieval, which collides with §1c's warning that "examples written for an older model
freeze that model's behavior into the new one."

**Model-specific notes.** Claude Opus 5 runs adaptive thinking by default, unlike Opus
4.8/4.7, and rejects `budget_tokens`. Disabling thinking on it has two documented failure
modes — a tool call written into visible text, where the turn succeeds but the call never
runs and no error is raised, and `<thinking>` tag leakage — and the documented remedy
explicitly includes *deleting* any don't-think rule, because such rules make the leakage
worse. That is the same lesson as §1c's anchoring warning, from a different direction.
GPT-5.6 (Sol / Terra / Luna, GA 2026-07-09, post-dating this survey's assumed model
landscape) shows a reported "homogenization trap" in synthetic test generation and an
inverse relation between agentic autonomy and factual reliability; the Sol-specific
hallucination claim came from secondary coverage and wants first-party confirmation
before anything rests on it.

**What closes this — not more reading.** `prompt-audit.md` Step 7 is explicit: "Probe
behavior, not self-report… Asking the model whether it needs an instruction is not a
measurement," one change at a time so regressions attribute to their cause. Ablate the
rewritten spine against `eval/`: each surviving requirement present vs. removed, per
model, recording per-requirement effect sizes rather than transferred ones.
`buddy-learning-and-model-drift.md` is already scoped for cross-model differential eval
and is the natural home for that run. Until it exists, the rewritten spine is a
better-argued hypothesis, not a measured one — and this entry should not close.

Cross-reference: `VG-10` records the trigger problem this entry exposed — the spine was
written and invalidated inside a single session, with no time elapsed, which a 90-day
staleness clock would never have caught.

## VG-10 — Prompt artifacts decay on model release, not on the 90-day clock

**Status:** open
**Valid:** conditional — `D-6`'s staleness rule distinguishes prompt-surface artifacts from code
**Rests on:** `shared/prompt-audit.md` Step 7 — "Re-audit at every model release. Prompts are per-model artifacts; a line that is load-bearing on one generation is cruft on the next" — read against `active-plan.md` `D-6`.

`D-6` sets a 90-day stale threshold and `T-35` schedules a quarterly hamsa sweep. For
code that is a reasonable cadence. For prompt-surface artifacts it is the wrong
*trigger*, not merely the wrong interval: a specialist body does not decay on a clock, it
decays when the model underneath it changes. Two releases inside one quarter and the
calendar sweep fires late; a quiet quarter with no release and it fires for nothing.

`VG-9` is the worked example. That spine was written and invalidated inside a single
session, on evidence about the current model generation, with no time elapsed at all. No
staleness clock would have caught it, because nothing had aged.

**Fix direction.** Amend `D-6`, or add a sibling decision, so prompt-surface artifacts —
`buddy/skills/**/SKILL.md`, the lens addenda, tool descriptions, and the spine in this
tracker — carry a model-release trigger alongside the 90-day floor, and each records the
model generation it was last audited against. `T-37`'s stale-detector already watches
`SKILL.md` mtime against a 90-day window and the absence of an eval run in it; that
detector is the natural place to add "audited against model X, current is Y" rather than
building a second mechanism.

Worth noting how cheap the signal is: the `claude-api` skill bundles a whole
`prompt-audit` flow whose Step 0 establishes a *target model* before reading a single
file. The audit is already parameterised by model generation. What is missing on this
roster is anything that notices the parameter changed.

**Same defect, different surface.** `VG-8` records that `buddy-introspection` `#20` still
cites `security-ibex` at 167 lines against a source now at 181. That is also an audit
finding nothing re-triggers — stale because no event fires, not because nobody cared.
Both belong to the same fix: audits need triggers tied to what actually invalidates them.

## Corrections to the first pass of this survey

Recorded rather than silently fixed, because the mistake has a reusable lesson.

**The first pass read the plugin *cache*** (`~/.claude-kat/plugins/cache/sdd-misc-plugins/buddy/0.9.1/skills/`)
and nothing else, then concluded the roster had no eval harness and that "nobody builds
the eval." That was wrong: `eval/`, `buddy/tests/*-eval/`, and four trackers in this repo
document a working harness with a calibrated judge panel and frozen baselines. Line
counts happened to be identical between cache and source at 0.9.1, so the arithmetic in
`VG-7` survived — but that was luck, not method.

Lesson, and the reason this tracker lives here rather than in an unrelated project:
**the skills directory is not the project.** A roster audit that reads only `SKILL.md`
files will miss every tracker, harness, and plan that says the work is already done. Read
`docs/trackers/INDEX.md` first.

Two further findings were dropped as duplicates on the same pass:

- A proposed `security-ibex` → `:appsec` / `:ml` split. Already recorded as
  buddy-introspection `#21 — OWASP-2017-flavored taxonomy; LLM threats absent`.
- "Lens dispatch is the pattern to generalise." Already recorded as `#19`.

## Maintenance

- **Axis discipline.** A finding about how a specialist is *written* belongs in
  `buddy-introspection.md`, not here. A finding about what the roster does not *cover*
  belongs here. When in doubt: would fixing it change which competency has an owner?
- **When an entry closes,** flip its `**Status:**` line and update the matching row in
  § Coverage map from `unowned`/`partial` to `held`, then re-tally the counters in
  § Live state. The map is the scoreboard; the counters are what a reader trusts.
- **`VG-N` ids are server-allocated.** Use
  `artifact(action="append_entry", id_prefix="VG", anchor_heading="## Maintenance",
  title=…, body=…)` so the id and its `## VG-N — <title>` heading land in one write.
  Never hand-number: the heading is the only thing that makes the entry citable.
- **Re-verify line counts against `buddy/skills/`, never the plugin cache,** before
  trusting anything in `VG-7` or `VG-8`.
- **This tracker owns `VG-`, not `T-`.** `T-N` belongs to `active-plan.md` (T-1..T-38).
  Any task that comes out of a `VG-N` fix should be filed there as a `T-N`, citing the
  `VG-N` that motivated it.

## History

### 2026-08-26 — Spine rewritten; VG-9, VG-10 opened

Model-specific research pass on where current models fail at *designing* validation,
prompted by noticing the first spine was grounded in benchmark literature about older
models and presented as durable craft anyway.

Retired three of the seven spine rules and the numbered-script shape itself, against
`shared/prompt-audit.md` §1a/§1b/§1c in the bundled `claude-api` skill — first-party
guidance naming step-by-step choreography, prohibition lists, and plan-before-acting as
patterns that degrade current models. Kept the four whose failure reproduces and *scales
with* capability. `VG-9` carries the evidence and names the ablation that would close it.

`VG-10` records the trigger defect the rewrite exposed: `D-6`'s 90-day staleness clock
cannot catch a prompt artifact invalidated by a model release, and this spine was
invalidated inside a single session with no time elapsed.

Also confirmed and cited in `VG-9`: the `D-5` PoLL panel choice (Anthropic + OpenAI +
Google) is right for a documented reason — same-family judge ensembles share redundant
error surfaces, and cross-provider diversification measurably cuts self-preference bias,
so the rejected open-weight alternative would have been weaker on the axis that matters.
Separately: Terra / Luna / Sol were identified as OpenAI GPT-5.6 tiers (GA 2026-07-09),
not Claude models.

### 2026-08-26 — Survey run, tracker created

Domain-coverage audit of the 12-specialist roster at v0.9.1, verified against
`buddy/skills/` source (1,958 lines, matching the 0.9.1 cache). 14 competencies
surveyed: 4 held, 4 partial, 6 unowned. `VG-1`..`VG-8` opened.

Two new specialists proposed (data-contract, eval-harness-teaching) — the first proposals
on this roster to *add* rather than refactor, which is why they needed an audit axis
`buddy-introspection.md` does not have.

`VG-7` hands measured line ratios to `headroom-optimization.md` backlog item 2b, giving
the lens refactor a context-budget justification rather than an aesthetic one.

One correction to the first pass recorded in § Corrections: the survey initially read only
the plugin cache and wrongly concluded no eval harness existed. Two would-be findings
dropped as duplicates of buddy-introspection `#19` and `#21`.
