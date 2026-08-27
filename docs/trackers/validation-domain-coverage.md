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
roster_lines_total: 2125       # buddy 0.9.2, source not cache, 2026-08-26; method:
                               #   find buddy/skills -maxdepth 2 -name '*.md' -exec cat + | wc -l
                               # the prior 1958 figure's method was not recorded, so treat
                               # 1958 -> 2125 as NOT a comparable delta (VG-6 closure added
                               # a property-testing section; VG-7 removed 6 lines)
specialists: 12
competencies_surveyed: 14
competencies_held: 4
competencies_partial: 4
competencies_unowned: 6
entries_total: 10
entries_open: 4                # VG-3, VG-4, VG-5, VG-10
entries_mitigated: 1           # VG-9 — spine reshaped; stimulus retired as non-discriminating
entries_closed: 5              # VG-6, VG-7, VG-8 fixed; VG-1, VG-2 wontfix (specialist measured unwarranted)
new_specialists_proposed: 1    # eval-harness-teaching (VG-5). The data-contract specialist
                               # (VG-1+VG-2) was drafted, reviewed twice, base-armed at n=10,
                               # and NOT shipped — see Domain block C.
interventions_retired_by_own_control_arm: 2   # VG-9's spine stimulus, and the VG-1/VG-2 specialist
spine_status: >
  rewritten 2026-08-26 to outcome framing. Measurement RESOLVED as non-discriminating:
  6 no-skill control runs recovered from the Claude Code transcripts, 3 read in full,
  all 3 clear both judge rubrics unaided. Neither variant has headroom on this fixture.
  Not a verdict on the spine — an instrument that cannot separate the arms cannot rank
  them — but direct evidence for the premise. See VG-9.
eval_location: prompt-engineering:scenarios/validation-spine/ (registered in that repo's skill-eval-log.md)
eval_blockers: 4 harness defects found while building it — prompt-tdd-operating-guide OP-13..OP-16
eval_next: build a stimulus above the unaided floor; run CONTROLS FIRST, before any arm
transcripts: ~/.claude-test/projects/-tmp-prompt-test-*/*.jsonl — attribute by a content
  marker unique per arm, never by mtime (that failure is reconnaissance-patterns:R-6)
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

When asked to stop alarming on a signal, do NOT loosen a deterministic
contract into a tolerance. Keep the contract, and add a separate
rate-based signal beside it. This is the ONE rule in this block a
frontier model does not already apply unprompted -- measured, see below.

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

**Unowned by any specialist, and measured to be correctly so.** A `VG-1`/`VG-2` specialist
was drafted (base + two lenses, ~200 lines) and **not shipped**. Its base arm ran first, per
`prompt-engineering:skill-eval-playbook` `L-17`: unaided Opus 5, no skill, n=10, pinned model,
plugin-free profile, three one-concept rubrics proven to move by output mutation first.

| Behaviour the specialist would teach | Unaided |
|---|---|
| Separates structural from statistical, with different response paths | **10/10** |
| Grades distribution movement into >=2 severity bands | **6/10** |
| Keeps BOTH null guarantees rather than collapsing them | **6/10** |

Zero merges in ten runs. Four of ten did commit the collapse above — under the fixture's
ops pressure (*"make it not page for that"*) they deleted the hard null contract and
replaced it with a bare tolerance. The tolerances they invented, same fixture, same prompt:
**90%, 60%, 35%, 25%, 20%.** A fivefold spread with no stated basis — not a judgement call
being made well, but an arbitrary number filling the space a contract used to occupy.

So the block's other rules are decoration for a current frontier model, and the one added at
the top of the pasteable text is the measured deficit. Full record:
`prompt-engineering:skill-eval-log` § data-contract base arm, and
`prompt-hamsa-audit-log` `A-1` (outcome `held`).

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

**Status:** wontfix — the gap is real; a specialist is measured as the wrong remedy. One rule landed in Domain block C instead.
**Valid:** dated 2026-08-27
**Rests on:** the n=10 base arm recorded in Domain block C — unaided Opus 5 at 10/10 on layer separation and 6/10 on severity banding, so the deficit is one rule wide, not a specialist wide.

Nothing on the roster owns structural data validation: types, nullability, ranges,
categorical membership, referential integrity, uniqueness, Write-Audit-Publish, semantic
schema versioning, feature freshness SLAs. Content is Domain block C, structural half.

**Proposed fix — RETIRED 2026-08-27, and the retirement is the finding.** The proposal was a
new specialist, working name *Data Contract Marmot*, refusing to merge structural and
statistical checks, with `:schema` and `:drift` lenses split per the Pheasant's layout. It
was drafted in full and previewed. Two independent reviews cut it down before it reached
disk, and then a measurement cut it further:

- **Architecture (`architecture-snow-lion`):** the lens boundary is a *taxonomy*, not a fault
  line. The Pheasant's lenses are disjoint substrates — a practitioner does tabular ML *or*
  LLM eval. These two layers are two properties of the same table, so a real session needs
  both and forced to pick loses half. Also premature by definition: an interface declared on
  an artifact with zero users. Recommendation was single-file, no lens — and the headroom
  argument that motivated the split turned out to be **7 lines**.
- **Prompt craft (`prompt-hamsa`):** the premise was an *imported* failure claim from ML-ops
  literature about human practice — a hypothesis about what Claude does, never tested. Base
  arm demanded before any file was written.
- **Measurement:** see Domain block C. Two of the three behaviours at or above ceiling
  unaided; one real deficit at 6/10.

Nothing was written to disk. The surviving artifact is one rule in Domain block C.

## VG-2 — No owner for drift, freshness, and distribution monitors

**Status:** wontfix — shares `VG-1`'s disposition. Severity banding measured at 6/10 unaided; no specialist warranted.
**Valid:** dated 2026-08-27
**Rests on:** § Coverage map; the same n=10 base arm as `VG-1`, recorded in Domain block C.

Statistical monitoring is absent: data drift, label drift, concept drift, KS /
chi-square / PSI / KL, tiered response (minor → retrain, moderate → human review, severe
→ stop serving), and the delayed-feedback case where labels are not yet available.

Closed with `VG-1` as `wontfix`, 2026-08-27. Filed separately because it is a distinct
competency, and the measurement treated it separately too: the drift half's discriminating
behaviour is *grading distribution movement into more than one severity band*, which unaided
Opus 5 did on **6 of 10** runs. Above the pre-registered no-ship bar, so the `:drift` lens
is not warranted — but the 40% miss rate is the reason the surviving rule in Domain block C
is about contracts-versus-tolerances rather than about drift statistics, which the model
picks reliably on its own.

## VG-3 — No owner for model release gating

**Status:** open — base arm owed before any prose; stimulus designed below, not run
**Valid:** conditional — a base arm measures which of the four release-gating behaviours unaided Opus 5 omits
**Rests on:** Domain block B, final two paragraphs — the part `data-leakage-snow-pheasant:classic` does not cover.

Unowned: probability calibration, subgroup slice metrics, fairness auditing, decision
threshold selection from error cost rather than a 0.5 default, model cards, shadow
deployment, canary release, rollback triggers.

The Pheasant's `:classic` lens covers split/transform/resample discipline and stops
there. Everything between "the model scores well" and "the model is safe to serve" has
no owner.

**Disposition 2026-08-27 — base arm owed BEFORE any prose.** This is the one remaining
unowned row where a real deficit is plausible, so it is the one worth measuring rather than
guessing. Applying the method that retired `VG-1`/`VG-2`
(`prompt-engineering:skill-eval-playbook` `L-17`): no artifact gets written until the
no-skill arm shows the failure.

The list above is not one behaviour and should not be one rubric. Split by how likely a
frontier model volunteers it unprompted — stated here as a prediction, to be scored:

| Behaviour | Prior | Why |
|---|---|---|
| Threshold from error cost rather than the 0.5 default | probably at ceiling | well-known move, and the cost asymmetry is usually stated in the prompt |
| Probability calibration checked before trusting scores | uncertain | requires knowing scores are not probabilities |
| **Subgroup slice metrics volunteered when not asked** | **probably the deficit** | needs the model to widen scope on its own; aggregate metrics answer the question as literally posed |
| Rollback trigger named before deploy | uncertain | stop-condition shaped, which models are weak on |

**Stimulus sketch.** A trained classifier plus a `metrics.json` reporting only aggregate
AUC, and a request to "decide whether this is ready to serve." The cheap answer quotes the
aggregate and picks 0.5. Slice data is present in the fixture but not surfaced — volunteering
it is the discriminator, so the fixture must make it reachable without naming it. Same
discipline as the `VG-1` arm: diegetic fixture, one concept per rubric, rubrics proven by
output mutation first, n>=10, model pinned, its own `config_dir`.

**Do not skip to a specialist.** The measured prior across this ledger is bad for new
specialists: two of two proposals this session were retired by their own control arm, and
`prompt-hamsa`'s running tally is 8 no-ship of 11 intervention audits. If a deficit lands
here it is more likely one rule — as `VG-1` turned out to be — than a body of prose.

## VG-4 — No owner for EDA and feature engineering

**Status:** open — lowest priority; the entry's own escape hatch rests on a false premise, so a `wontfix` has to be made on merit
**Valid:** dated 2026-08-27
**Rests on:** § Coverage map, and a reading of all twelve `SKILL.md` descriptions (below).

The whole front half of data-science work is absent from the roster. Lowest urgency of
the unowned rows — it is exploratory rather than gating, so nothing silently ships
wrong because it is missing.

**Premise corrected 2026-08-27.** This entry previously offered itself an exit: *"may well
close `wontfix` if the roster is deliberately scoped to validation and review rather than
discovery."* **The roster is not so scoped.** Reading all twelve descriptions:
`architecture-snow-lion` decides module boundaries, `docs-lotus-frog` writes prose,
`planning-crane` sequences work, `refactoring-yak` transforms code, `ml-training-takin`
builds training loops. Five of twelve are constructive rather than validating, so "this
roster only does validation" is false and cannot carry the closure.

What survives is the *priority* argument, which was always the better one: an EDA gap costs
nothing silently. Nothing ships wrong for want of it — which is why it can wait indefinitely,
and also why `wontfix` would be honest. **That is a scope call for the roster owner, not a
measurement question**, so it is left open rather than decided here.

## VG-5 — Eval-harness construction is built here but not teachable

**Status:** open — RE-SCOPED 2026-08-27: the curriculum now exists, so the gap is discoverability and the fix is a trigger, not a specialist
**Valid:** conditional — `prompt-hamsa` routes eval-construction requests to the playbook, or a base arm shows a deficit the playbook does not already cover
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

**Proposed fix — RE-SCOPED 2026-08-27. The gap moved from authorship to discoverability.**

The original proposal was a new specialist, working name *Eval Harness Bharal*, owning
golden-set construction, rubric design, judge calibration, and (with `VG-3`) release gating.

That premise has weakened, because **the curriculum now exists and is written down.**
`prompt-engineering:skill-eval-playbook` carries `L-1`..`L-17`, and the 2026-08-26/27 work
added the load-bearing half of exactly what this entry said was taught nowhere:

- **Sequencing** — `L-17`: run the no-skill control FIRST; it can retire the stimulus before
  either arm is built. Its checklist now puts the control at step 4 rather than step 5.
- **Rubric design** — one concept per rubric, plus the measured consequence of violating it:
  a severity-band rubric silently re-measured a separation rubric until its scope was pinned.
- **Judge validation** — the teeth check as a concrete recipe: six canned mutants driven
  through `LLMJudge` directly, each scored against every rubric to catch cross-talk, for
  $0.0151 before any generator ran. Mutate the OUTPUT, never the prompt.
- **Sample size** — n>=10 for any rubric expected near its threshold, with a worked case that
  landed at exactly 6/10.
- **Isolation** — a per-experiment `config_dir`, and the reason not to solve attribution by
  naming the workdir: the workdir is the model's cwd and leaks the arm to the subject.

So a user asking *"how do I build an eval for my RAG pipeline"* is no longer met with an
obligation and no method. What is missing is that **nothing routes them to it** — the method
lives in a sibling repo's tracker, reachable only by someone who already knows it is there.

That reframing changes the fix from expensive to cheap, and the direction is load-bearing:
`prompt-hamsa`'s own memory (`framing-provenance-inert-model-judges-on-merit`) measured that
once on-demand guidance is **fetched** it is as authoritative as always-visible guidance —
*"the failure mode of on-demand guidance is 'never fetched,' not 'fetched then forgotten,' so
invest in the trigger that fetches it at the right moment, not in duplicating its text."*
Writing a specialist here would be duplicating the text.

**Revised fix, cheapest first:**

1. **A trigger, not a body.** Have `prompt-hamsa` route eval-*construction* requests to the
   playbook, the way it already routes to `prompt-tdd` under § Harness. It insists on an eval
   (Operating Principle 3) and cannot build one; a referral closes that in one sentence.
2. **Then measure whether more is needed.** Base arm: unaided, asked to build an eval for a
   skill, does the model run a control first and validate its rubric by mutation? If it does,
   no specialist is warranted and this closes like `VG-1`. Prior: control-first is the
   deficit — it is the step this session got wrong twice.

**Non-negotiable if a body is ever written:** no eval is trusted until its judge has been
scored against human labels — the `human_anchor_TODO` this repo already carries.

Still distinct from `S-5`: that is "this roster's specialists lack graded examples," an
internal quality gap. `S-5` coverage is unchanged — `fixtures_count` still records
`ml-training-takin: 3`, one specialist of twelve, with `fixture-expansion.md` owning it.

## VG-6 — Property-based testing has no home in the roster

**Status:** fixed
**Valid:** dated 2026-08-26

Closed by the `## Properties and Invariants` section in `testing-snow-leopard/SKILL.md`;
re-verify if that section is removed or the skill is lens-split.

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

### Closed 2026-08-26 — and the draft needed one correction before it could ship

`testing-snow-leopard/SKILL.md` gained `## Properties and Invariants` (125 → 148 lines),
placed between *Test Format* and *Heuristics*: the five property families from Domain
block D (round-trip, idempotency, metamorphic, order-independence, conservation) with a
concrete trigger each, the Hypothesis / fast-check / proptest pointer,
`RuleBasedStateMachine` for stateful units, and shrinking framed as *the counterexample
is the deliverable* — the shrunk value belongs in the suite as its own named regression
case. Plus a `**Properties:**` field in the Test Format block, so the section is
load-bearing rather than advisory, and Heuristic 9 naming the test-oracle problem
directly.

**The draft's lead sentence had to be inverted, and this is the part worth keeping.**
Domain block D opens *"Prefer invariants to examples."* Dropped into this skill as
written, that instruction is actively harmful — because `buddy/tests/testing-snow-leopard-eval`
scores the skill on exactly the behaviour it displaces. The `write/boundary-and-observable`
rubric awards MARKER 1 only for **three or more named boundaries** (`qty == 0`, negative,
the `qty == 9` vs `qty == 10` threshold off-by-one, an at-the-limit case) and scores `0.0`
for a suite testing one happy value. A model told to prefer invariants writes
`@given(st.integers())` and satisfies none of them: a generator may never sample
exactly-at-the-limit, and its failure reports a random value rather than the boundary the
contract names. So the section states the opposite of the draft — **properties sit beside
the boundary list, never instead of it**, Operating Principle 2 still governs, and a suite
of pure `@given` has *lost* coverage.

**Second constraint, from the same scout.** `prompt_tdd.yaml` and the rubric both cite
the skill by **positional anchor** — "Operating Principle 2", "Operating Principle 4",
"Heuristic 1", "Self-Trap 1", "Phase 1.2". Inserting into any of those lists silently
re-points the eval's own references at different content, with nothing failing. Hence a
new top-level section and an *appended* Heuristic 9 — Operating Principles 1–5, Heuristics
1–8 and the Self-Traps keep their numbers, verified after the edit.

**Not closed by this:** `buddy-introspection` `#10` (Method step 4 locks Arrange-Act-Assert
as a format, ignoring Given-When-Then). `VG-6` said a fix for `#10` that merely loosened
the format would not close `VG-6`; the converse also holds — this section adds the
discipline and leaves the format lock untouched. `#10` stays `open`.

**Owed:** no eval scenario exercises the property vocabulary. The two existing scenarios
score boundary-and-observable and tautology-detection, so the section ships unmeasured —
the same gap `#21` carries, and the reason its row reads `fixed` with `Eval: none`.

## VG-7 — The Snow Pheasant lens split is under-extracted

**Status:** fixed — extraction applied 2026-08-26. **But the entry's own success metric was wrong, and the measurement below is the correction.**

### What was actually wrong (confirmed by reading all three files)

The diagnosis held, in two parts the entry did not separate:

1. **Genuine duplication.** `_llm.md` Method 8 (variance floor) restated base Phase 3 and base Reaction 5. `_llm.md` Heuristic 15 restated base Heuristic 7 **using the same MRV-poc LoRA α=0.06 example**. Method 9 (triangulate across two fixtures) was base Heuristic 7's remedy. Deleted; the two-fixtures requirement folded into base H-7.
2. **Three lens-agnostic laws stranded in the LLM addendum** — promoted to universal Heuristics 8/9/10: *the audit metric must match the production topology*, *an audit's failure mode must be distinguishable from a valid zero*, and *if the rule's signal and the content's signal agree you proved correlation, not dominance — swap the confound*. None is about LLMs. `:classic` summons were missing all three.

`_classic.md` needed nothing — all 59 lines are sklearn/temporal-split specific. That asymmetry is real.

### The metric this entry proposed does not measure extraction quality

| | before | after |
|---|---|---|
| monolith | 324 | 318 |
| base + `:classic` | 195 (60.2%) | 200 (**62.9%**) |
| base + `:llm` | 265 (81.8%) | 259 (**81.4%**) |
| `_llm.md` / base ratio | 0.95 | 0.84 |

The headline `:llm` figure moved **0.4 points**, and `:classic` got *worse* as a ratio. That is not a weak fix; it is the wrong instrument. **Relocating a line from an addendum into the base is algebraically invisible to `(base + lens) / monolith`** — both numerator and denominator contain it, so the ratio is unchanged. Only *deletion* moves it, and only 6 lines were genuinely deletable. `:classic`'s ratio rose because the base grew, which is the fix working.

What actually improved, and what the entry should have measured:

- **absolute lines per summon** — `:llm` 265 → 259, `:classic` 195 → 200 (paying 5 lines for three laws it was missing)
- **duplication** — 11 lines of restatement gone; the LoRA example now appears once, not twice
- **correctness** — `:classic` now carries the confound-swap, metric-topology and valid-zero laws

### The stated rule has a false-positive mode

> **The rule: an addendum approaching the size of its base means the base is under-extracted.**

After extracting everything genuinely general, `_llm.md` is still 118 lines against a 141-line base — ratio **0.84**, which the rule still flags. But every remaining line is LLM-substrate: contamination probing, RAG/RePCS, judge bias, chat-template pinning. LLM-eval leakage simply has more distinct failure modes than tabular leakage — 18 heuristics against `_classic.md`'s 6.

So the rule is a **smell, not a law**. It correctly pointed at this file, and a large addendum can equally mean a genuinely richer lens. **Do not clone it to `VG-1`/`VG-5` as a numeric gate** — clone the *question* ("is anything in here lens-agnostic?"), which is answered by reading, not by a ratio.

### Found while doing it

`_llm.md` Reactions 5 and 8 both cited *"Heuristic (universal) 5 (variance floor)"*. Base universal Heuristic 5 is **label noise**; the variance floor lives in Phase 3. A pre-existing mis-citation in shipped prompt content, repointed to Phase 3 in the same pass. Base Heuristics 1–7 kept their numbering precisely so `_classic.md`'s surviving `Heuristic (universal) 1` cross-reference did not break.
**Valid:** dated 2026-08-26
**Rests on:** the measurement table below, taken from source at `0fd8eb1`; feeds `buddy/docs/trackers/headroom-optimization.md` backlog item 2b.

**Condition discharged — and it was the wrong condition.** The original class was
*conditional — the `_llm.md`-to-`SKILL.md` line ratio changes*. That ratio moved
0.95 → 0.84 at `0fd8eb1`, so the condition fired; but the correction section
below shows the headline `(base + lens) / monolith` figure it was standing in for
is **algebraically incapable of moving** under relocation, which is what the fix
mostly did. A conditional keyed to a quantity that cannot respond to the
intervention is not a decay class — it is a check that passes in every world.
Re-declared as `dated`, whose failure mode is at least honest. See
`reconnaissance-patterns:R-5`, which this is a fifth instance of.

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

**Status:** fixed
**Valid:** dated 2026-08-26
**Rests on:** direct read of `buddy/skills/security-ibex/SKILL.md` on 2026-08-26.

buddy-introspection's `#20 — security-ibex — Length 167 lines` no longer matches source:
the file is **181 lines**. Doc-vs-code drift, low severity, but it is the kind that
compounds — a length-based finding whose number has moved is evidence the audit has not
been re-run since 2026-05-15, which `active-plan.md`'s `T-35` (quarterly hamsa sweep,
next 2026-08-15) says was due eleven days before this entry was written.

Not a coverage gap. Filed here because this survey found it while verifying line counts,
and dropping it would be the drift the entry describes.

### Widened and closed 2026-08-26 — this entry was scoped to the wrong half of `#20`

**As filed, this entry under-scoped its own finding, and said so in its severity.** It
re-measured the integer in `#20`'s *title* (167 → 181) and called it low-severity
doc-vs-code drift. The claims that made `#20` actionable sat four lines below the title
and are also false — and unlike a stale integer, they invalidate the entry's verdict:

- *"Highest length of any specialist"* — `codescout-pika` is **316**. Ibex is second.
- *"others 47–60 lines"* — the real minimum is **118**, twice the stated maximum.
- *"roughly 3× per specialist baseline"* — **1.47×** (181 against a median of 123).

`#20`'s `Fix: Accept` reasons that *security complexity earns the extra budget* — which is
only an argument about **the** outlier, and ibex is not it. So the correct scope was never
"the number moved"; it was "the disposition rests on a falsified comparison."

**The generalisable bit: a measurement and a comparison decay at different rates.** `#20`
recorded a comparison (X versus the rest of the roster) in the grammar of a measurement (X
is 167). A measurement goes stale only when its own subject changes. A comparison goes
stale when *anything in its reference class* changes — far more often, and completely
invisible to a check that re-measures only the subject. Re-measuring the subject of a
comparison and reporting it green is the exact failure this entry committed.

Corrected in `d334a50`: `#20` re-opened with the measured distribution, the audit re-scoped
from `10/10` to `10/12`, and `S-5` closed as falsified. Full detail in
`roster-audit-session-log:F-1` / `roster-audit-session-log:F-2` and
`docs/issues/archive/2026-08-26-buddy-introspection-20-outlier-comparison-falsified.md`.

**Still owed:** `#20`'s *verdict* is not re-derived, only its evidence retracted. "Is 181
lines justified?" is a question about rank, so it cannot be answered until
`codescout-pika` (316) is audited — and that specialist is one of the two outside audit
scope, which is why `roster-audit-session-log:F-1` and `roster-audit-session-log:F-2` are the same defect seen from two directions.

## VG-9 — The prompting spine was over-specified for current models

**Status:** mitigated — spine rewritten 2026-08-26, shape corrected. Effect unmeasured and, on the stimulus built for it, **unmeasurable**: the unaided Opus 5 floor clears the pass bar 3/3. Stimulus retired; a discriminating one is owed.
**Valid:** conditional — a stimulus exists on which unaided Opus 5 measurably fails, established by controls before any arm is built
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

**Measurement attempt — 2026-08-26, same session.** The eval was built and run. The verdict
is **unresolved**, so this entry does not close. Registered in
`prompt-engineering:docs/trackers/skill-eval-log.md` under *validation-spine (VG-9 spine
ablation)*, with stimulus, confound controls and file paths.

What the attempt established — none of it about the spine:

- **Smoke at n=1 on Claude Opus 5: both variants PASS.** Under the harness's own paired
  predicates that classifies `tautological`, consistent with Opus 5 catching a crisp
  docstring contradiction unaided — i.e. neither variant having power on this stimulus.
  One run per arm proves nothing; it is a direction, not a result.
- The `--ablate` control ran and its summary was lost to a buffer handle that expired on an
  MCP reconnect. Transcript recovery is inconclusive and attributable only by mtime.
- **The plan changed on evidence.** `--paired`, the mode `skill-eval-playbook` `L-15`
  prescribes, discards both arms' per-run results
  (`prompt-tdd-operating-guide:OP-14`), and a partly-errored arm silently depresses its own
  rate while the delta still prints clean (`OP-15`) — which at exactly the n and margin
  planned here would have produced a clean-looking number out of a corrupted run. Revised
  design: `--ablate` per arm, n>=10, `defaults.timeout` raised above 300s.
- Cost reality: ~$1.32 per generator invocation and 40 invocations for the planned design,
  against a config whose `max_cost_per_run` cap turned out to be inert (`OP-16`).

**Stimulus question RESOLVED — 2026-08-26, later session, at zero API cost.** The
previous paragraph guessed that the stimulus "may be too easy." It is, and the evidence
was already on disk. The `--ablate` run's control arm had been written to the Claude Code
transcripts all along; what was missing was not data but **attribution**, and the earlier
attempt failed because it tried to attribute by *mtime*. Attributing by a **content marker
unique to each arm** works on the first try:

| Arm | Marker | Sessions |
|---|---|---|
| old choreography | `Follow this procedure exactly` | 4 (15:16, 15:18, 15:21, 15:27) |
| new outcome framing | `So: the checks you write must be able to fail` | 3 (15:22, 15:24, 15:25) |
| **no skill at all** | both markers absent, `Validation Spine` absent, fixture present | **6** (15:28–15:37) |

The six controls are Opus 5 sessions with zero mention of `validation-spine` and no judge
traffic. That is the negative control `skill-eval-playbook` `L-1` requires, and it had
already run.

**Three controls read in full. All three clear both judge rubrics unaided:**

- Named the negative-clamp contradiction with the arithmetic — `apply_discount(1000, -50)`
  returns `1500`, "a 50% markup", against a docstring promising a 0..100 clamp. One cited
  `src/pricing.py:14`.
- Named the truncation-vs-round-half-up contradiction. One used *the exact case in the
  rubric* — `apply_discount(101, 50)` returns 50, not 51.
- **Did not flag `normalize_currency`** — the `L-13` precision bait. One wrote "matches its
  docstring in every case I probed."
- All three invented the same design unprompted: characterization tests pinning observed
  behaviour, plus a separate `xfail(strict=True)` class encoding the documented contract,
  so the suite is green today and turns red the moment a refactor makes the docstring true.
- One went further than either spine asks: it built a throwaway corrected implementation,
  confirmed all 10 xfails flipped "along with exactly the 9 paired pins and nothing else,"
  and deleted it. That is mutation verification of its own assertions, self-initiated.
- One found a contradiction the fixture's author did not know was there — float division
  lossy past `2**53`.

**Verdict: the stimulus is retired as non-discriminating**, satisfying the second clause of
the `**Valid:**` condition above. The unaided Opus 5 floor sits *at or above* the eval's
pass bar, so both variants had zero headroom and the harness's `tautological`
classification of the n=1 double-pass was right — for a reason the run itself could not
show. **Do not spend the ~$26 on n>=10 against this fixture; it would measure nothing.**

**What this does and does not say about the spine.** It is not a refutation of the rewrite
and not a validation of it — an instrument that cannot separate the arms cannot rank them.
But it is direct evidence for the *premise*: every requirement the spine states — spec as
oracle, name the unspecified case, mutation-gate each assertion, run it and report — Opus 5
performed here **unprompted, 3 for 3**. That is what `prompt-audit` §1c predicts about
choreography for a task the model already plans well. Scope it honestly: six controls, one
fixture shape, one model. It says the spine is redundant *on this task shape*, not that it
is redundant.

**The one thing that could overturn this, stated so it is not glossed.** The verdict above
rests on *my own reading* of three control transcripts against the rubric text — not on the
judge's scores for them, which were in the `--ablate` summary that was lost. The controls
were graded; the numbers are simply gone. So what is established is that the **stimulus** sits
below Opus 5's unaided capability, which is a fact about behaviour and is not in doubt: all
three named both contradictions and spared the bait, explicitly. What is *not* directly
established is that the judge scored them PASS. If a Haiku 4.5 judge failed those runs anyway
— and `skill-eval-playbook` `L-16` records that a judge's score field can contradict its own
reasoning — then the eval would show a delta for the wrong reason: judge miscalibration, not
spine power. That would make the measurement worse, not better, and the remedy is the same
rebuild. Recovering the lost scores would settle it; re-running the old fixture would not.

**A valid stimulus must now be built above that floor, not merely "harder"** — the
requirement is a task where unaided Opus 5 measurably fails, established by controls
*first*. Building the arms before the floor was known is what cost the $2.64 and the
session. The next attempt runs controls before it runs anything else.

### The `VG-1` base arm found the stimulus SHAPE this entry needs — 2026-08-27

A useful accident. The `VG-1`/`VG-2` base arm (Domain block C) was measuring something else
entirely, and its one real deficit came from a fixture property this entry can borrow.

The spine stimulus that failed here was a **docstring-vs-code contradiction** — a puzzle. A
frontier model solves it unaided, 3 for 3, which is why it discriminated nothing. The Marmot
fixture's discriminating half was not a puzzle at all: it applied **pressure to relax a
guarantee**. Ops, quoted in the fixture's own words, asked to *"make it not page for that"* —
and 4 of 10 runs complied by deleting a deterministic contract, inventing tolerances of 90%,
60%, 35%, 25% and 20% to fill the space.

That is the same shape as this spine's actual claim. The spine says *the checks you write
must be able to fail*; the discriminating question is therefore not "can you spot a
contradiction" but **"will you keep a check that can fail when something in the task wants it
not to."** A fixture supplying that want — a failing assertion plus a plausible reason to
soften it, a flaky test plus a deadline, a red gate plus a request to unblock — sits above the
unaided floor in a way the puzzle did not.

Stated as a prediction rather than a finding, because it is untested: unaided Opus 5 will
weaken or delete a failing check on >=3/10 runs when the task supplies a sympathetic reason,
where it caught the docstring contradiction 3/3. If that holds, the spine has a measurable
subject; if it does not, the spine is redundant on this axis too and should close like
`VG-1`. Either way the closing condition above is unchanged — controls first, before any arm.
## VG-10 — Prompt artifacts decay on model release, not on the 90-day clock

**Status:** open — decision text drafted and ready to paste (below); the `D-N` allocation belongs to `active-plan.md`'s owner
**Valid:** conditional — a decision superseding `D-6`'s trigger for prompt-surface artifacts is recorded in `active-plan.md`
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

### Ready to paste — supersede `D-6`'s trigger, do not edit it

`D-6` is a decision record, so the convention is a **new sibling that supersedes it**, not an
in-place edit. `D-7` is the current maximum; **the `D-N` number should be allocated by
`active-plan.md`'s owner at write time**, since hand-allocating into a live namespace from
another tracker is the race `get_guide("tracker-conventions")` warns about. Text:

> ### D-N — 2026-08-27 — Prompt-surface staleness is model-release-triggered, not calendar-triggered
>
> **Decision.** Supersedes `D-6` for prompt-surface artifacts only (`buddy/skills/**/SKILL.md`,
> lens addenda, tool descriptions, the spine in `validation-domain-coverage.md`). `T-37`'s
> detector warns when **either** holds:
> - the artifact's recorded audit generation differs from the current default model, **or**
> - mtime > 90 days AND no eval run in that window — `D-6`'s existing conjunction, retained
>   as a floor.
>
> Non-prompt artifacts keep `D-6` unchanged.
>
> **Why.** A prompt is a per-model artifact. `shared/prompt-audit.md` Step 7 states it
> directly — *"a line that is load-bearing on one generation is cruft on the next"* — and its
> Step 0 already establishes a target model before reading a file, so the audit is
> parameterised by generation while nothing notices the parameter changed. `VG-9` is the
> worked case: a spine written and invalidated inside one session, on evidence about the
> current generation, with **zero** time elapsed. No clock could have caught it. The
> disjunction adds the missing trigger without weakening the one that exists.
>
> **Granularity — the one real choice.** Per-specialist is correct (specialists are audited
> at different times) but means a frontmatter field on twelve `SKILL.md` files, which is a
> prompt-surface change and therefore a version bump plus a three-profile cache reseed. A
> single roster-wide field in `active-plan.md` § Live state costs nothing and is wrong the
> moment two specialists diverge. **Recommendation: start roster-wide, split per-specialist
> the first time a partial audit happens** — the same wait-for-the-second-instance rule
> `architecture-snow-lion` applies to abstractions, and it avoids a twelve-file bump for a
> field with one writer.
>
> **Resolves.** `VG-10`. Related: `VG-8` is the same class on a different surface — an audit
> finding whose invalidating event fires no trigger.
>
> **Revisit-when.** Two specialists carry different audit generations; or the default model
> changes more than once inside a 90-day window, which would make the floor redundant rather
> than complementary.

**Not landed here deliberately.** This entry owns the finding; `active-plan.md` owns `D-N`
and `T-37`. Writing into a live `D-N` sequence from outside is how two sessions allocate the
same number.

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

### 2026-08-26 — Spine ablation built and run; verdict unresolved

Built the `VG-9` ablation as a prompt-tdd eval in `prompt-engineering` and ran it. Recorded
in full under *validation-spine (VG-9 spine ablation)* in that repo's `skill-eval-log.md`;
the substance is appended to `VG-9` here.

**Result: unresolved, and `VG-9` stays open.** Smoke at n=1 on Claude Opus 5 passed *both*
variants, which the harness's own paired predicates would classify `tautological` — pointing
at the stimulus being too easy rather than at either spine having power. The `--ablate`
control ran but its summary was lost to an expired buffer handle, and transcript recovery is
inconclusive.

**The measurement design changed on evidence, before any money was committed to it.**
`--paired` — the mode `skill-eval-playbook:L-15` prescribes — turns out to discard both
arms' per-run results, and a partly-errored arm silently depresses its own rate while the
delta still prints clean. At the planned n=10 against a hard-wired 0.50 margin, three
timeouts would have produced a clean-looking number from a corrupted run and it would have
been reported as a measurement. Four defects were filed against the harness in the process
(`OP-13`..`OP-16`), one of which — `OP-16` — showed the run's own cost cap was inert.

Method note worth carrying: the first claim made about the harness in this session ("runs
are not auditable") was asserted from three absent files and one timed-out command, and was
wrong — transcripts *are* persisted, by Claude Code rather than by prompt-tdd. A subagent
audit established that from source. The same failure shape then recurred in the transcript
recovery probe, whose literal `== 51` pattern cannot match a `parametrize` table, so its
zeros were evidence about the pattern rather than the models.

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
