# Buddy Skill Benchmark Suite

## Purpose

This suite measures each buddy skill's **power** — does the skill's written content
actually change observable model output, or would a bare model produce the same answer?
Each harness is an isolated-profile [prompt-tdd](https://) experiment with a built-in
**control arm**: the skilled run loads the skill into a blank `~/.claude-test` profile,
and `prompt-tdd run --ablate` sends the identical message with the skill files removed.
A skill has power if the skilled run **PASSes** the discriminating rubric and the ablated
run **FAILs** it. A skill that passes both ways is *tautological* for that task (the bare
model already does the thing) — a valid result, recorded honestly, not inflated. Every
scenario is judged by an LLM-as-judge rubric (tier T3) because the skill's method markers
share vocabulary with any plausible answer, so substring matching cannot discriminate
method from mimicry.

**Status: BUILD phase complete (15 harnesses). RUN phase (Phase B) pending.** No scenario
has been executed; the verdicts below are build+review verdicts (structure valid, control
arm valid, rubric discriminating), not measured power.

## Measured power map (Phase B — 2026-06-16)

All 15 harnesses run present + `--ablate` against the blank `~/.claude-test`
profile, T3 judge (`claude-haiku-4-5`). **Teeth = present PASS *and* ablate RED.**
(The first run was void — the judge's `max_tokens=256` truncated verdict JSON and
faked the teeth signature on 13/15 skills; fixed at 2048, prompt-engineering commit
`62621c8`. This v2 run had **0 parse failures**.)

| Skill | Hypothesis | Teeth | Measured verdict |
|---|---|---|---|
| codescout-pika | teeth | 2/2 | ✅ teeth |
| refactoring-yak | tautological | 2/2 | ✅ teeth (reversal) |
| data-leakage-snow-pheasant | teeth | 1/2 | ◐ partial (classic lens) |
| performance-lammergeier | partial | 1/2 | ◐ partial (profile-first) |
| prompt-hamsa | partial | 1/2 | ◐ partial (resist-adding) |
| architecture-snow-lion | tautological | 0/2 | ⚪ tautological |
| debugging-yeti | partial | 0/2 | ⚪ tautological |
| legibility-dzo | teeth | 0/2 | ⚪ tautological (reversal) |
| ml-training-takin | partial | 0/2 | ⚪ tautological |
| security-ibex | teeth | 0/2 | ⚪ tautological (reversal) |
| testing-snow-leopard | partial | 0/2 | ⚪ tautological |
| reconnaissance | partial (L-7) | 0/2 | ⚪ tautological (isolation) |
| docs-lotus-frog | tautological | 0/2 | ⚪ taut + present-FAIL |
| explore-project | L-7 | 0/2 | ⚪ L-7 + present-FAIL |
| planning-crane | tautological | 0/2 | ⚪ taut + present-FAIL |

**2 full teeth (pika, refactoring-yak), 3 single-scenario, 10 tautological under
isolation — 7 of 30 scenarios show power.** The apparatus reversed ~half the
build-phase hypotheses. Reversals + per-scenario detail: prompt-engineering
`docs/trackers/skill-eval-log.md` § Buddy benchmark. The build-phase Verdict column
in the index below is **superseded by this map**.

### Update — critical present-FAIL fixes (2026-06-16)

The three present-FAILs were diagnosed and resolved; none was a harness bug:

- **planning-crane** and **docs-lotus-frog** — the scenario posed an *insistent
  order* ("give me the breakdown now" / "document every parameter"). A persona skill
  will not *refuse* a direct order, so it complied → present-FAIL. Reframed to an
  *advisory ask*, which tests the skill's actual contribution (its judgment), not
  order-refusal. Both now present-PASS. **planning-crane flipped to teeth** — the
  done-condition gate: the Crane gates on "what's true when we stop?", the bare model
  dumps a generic plan → RED ablated. **docs-lotus-frog is tautological** — the bare
  model also advises against over-documenting a trivial helper.
- **explore-project** — *not isolation-evaluable* (L-7). Its dispatch→hook→report loop
  needs a real foreign repo + an Agent/subagent + the `explore-inject` hook, none
  present in `~/.claude-test`; the present-FAIL is an environment artifact. Documented
  in its README; only the precision boundary scenario is testable here.

**Revised tally: 2 full teeth (pika, refactoring-yak), 4 single-scenario (+ planning
gate), 8 tautological, 1 L-7 non-evaluable — 8 of 30 scenarios show power.**

### Update — variance check (2026-06-17)

The 4 single-scenario-teeth verdicts were re-run **5× present + 5× ablate as independent
samples** (G-4 / task #9, single haiku judge). Two flipped:

- **prompt-hamsa (resist-adding), planning-crane (done-condition gate)** — confirmed
  **stable teeth**: present 5/5 PASS, ablate 5/5 RED with tight sub-0.7 distributions.
- **data-leakage-snow-pheasant (classic)** — **flaky / conditional**. Ablate score swings
  0.00↔0.98: the bare model runs the null/permutation method ~40% of the time (2/5 NO POWER).
  This is *candidate-side* variance, so the cross-family panel **cannot** stabilize it
  (the panel reduces judge noise, not candidate noise). Downgraded from clean teeth.
- **performance-lammergeier (measure-first)** — **present-FAIL** (0/5 present): even with the
  skill loaded, the model optimized without demanding a profile. Phase B's single present run
  was a lucky pass. **Resolved (2026-06-18, task #11):** reframed to an advisory ask ("Can
  you make it faster?") and re-measured 5×5 — still **1/5 present, 5/5 ablate RED**. The
  reframe (kept, it's the fair test) ruled out the order confound; transcripts show the skill
  only nudges profiling while leading with a rewrite + a fabricated "dominant cost" claim
  (Self-Trap 7). So this is **genuine Lammergeier under-enforcement**, not a scenario defect.
  **Resolved (2026-06-18, task #12):** strengthened the SKILL.md faithfully (OP1 + a targeted
  "handed code → profile first, no rewrite" reaction) and re-measured 5×5 — **present 0/5,
  identical to ablate**; the model still led with a rewrite and fabricated "halves the work"
  claims, ignoring the explicit instruction. The target behavior (withhold a rewrite for
  obviously-improvable code) is **not reliably promptable** — the same persona-steering limit
  as order-refusal. Inert edit reverted (no L-2 gaming). **Accepted: documented present-FAIL,
  not skill-measurable via this probe.** A no-code-handed scenario (a claim to verify, or
  "our API is slow — approach?") would better probe the Lammergeier's real power. See
  prompt-engineering `skill-eval-playbook.md` § L-10.

**Revised power: 2 full-teeth skills (codescout-pika, refactoring-yak) + 2 confirmed
single-scenario teeth (prompt-hamsa, planning-crane) = 4 solid power scenarios.** Full
per-run scores: prompt-engineering `docs/trackers/skill-eval-log.md` § Buddy benchmark.
This closes the "Judge variance" caveat under *Known limitations* for these 4 — and shows a
single present/ablate sample near 0.7 is not a verdict.
## Skill index

All eval dirs are under `buddy/tests/`. The `prompt_tdd.yaml` is at
`<eval-dir>/prompt_tdd.yaml` for every skill **except prompt-hamsa**, whose harness lives
in a `prompt-tdd/` subdir (the eval dir also hosts a separate bespoke harness measuring a
different question).

| Skill | Eval dir | Tier | Expected power | Discriminating marker | Control valid? | Build verdict (superseded — see Measured power map) |
|---|---|---|---|---|---|---|
| architecture-snow-lion | `architecture-snow-lion-eval/` | judge (T3) | tautological | Named concrete change scenario + cite-import + ADR decision-record format on a tangled OrderService; restraint scenario must contradict user's "just split it" framing | yes | ready-with-notes |
| codescout-pika | `codescout-pika-eval/` | judge (T3, mode: output) | teeth | Flags each Iron-Law violation naming exact replacement codescout tool + Iron Law number (recall); zero findings on all-clean log incl. workspace-restore bait (precision) | yes | ready-with-notes |
| data-leakage-snow-pheasant | `data-leakage-snow-pheasant-eval/` | judge (T3) | teeth | Lens-specific leakage audit (classic scikit-learn churn pipeline; llm RAG + LLM-judge eval) — lens method, not generic review | yes | ready |
| debugging-yeti | `debugging-yeti-eval/` | judge (T3) | partial | Names upstream mutable-default `items=[]` (line 2) as root cause BEFORE patch and rejects the `.get()` symptom-site guard | yes | ready-with-notes |
| docs-lotus-frog | `docs-lotus-frog-eval/` | judge (T3) | tautological | Named primary reader + stale-when invalidation trigger + why-over-what + placement reasoning; precision: refuse to document a self-explanatory private helper | yes | ready-with-notes |
| ml-training-takin | `ml-training-takin-eval/` | judge (T3) | partial | Four-element parity fingerprint: names PIPELINE failure, prescribes byte-identical-tensor parity test via one shared preprocessing fn, defers blaming model, enumerates ≥2 drift suspects | yes | ready |
| performance-lammergeier | `performance-lammergeier-eval/` | judge (T3) | partial | Treats profiling/baseline as a hard precondition (no unmeasured rewrite, no fabricated numbers) and redirects off the proven-cold (~0.6%) fn to the real N+1 (~88%) | yes | ready-with-notes |
| planning-crane | `planning-crane-eval/` | judge (T3) | tautological | Names a load-bearing task scheduled early + done-condition before breakdown + dependency citation + low-confidence sizing handled with a spike | yes | ready-with-notes |
| prompt-hamsa | `prompt-hamsa-eval/prompt-tdd/` | judge (T3) | partial | Declares critique UNVERIFIED/N=0 + read-as-stranger + cut-before-add + missing-escape-hatch (≥3 of 4 markers) | yes | ready |
| refactoring-yak | `refactoring-yak-eval/` | judge (T3) | tautological | Safety-net-first + named structural defect + atomic verified moves + behavior-preserved / no feature-smuggling on a 4-responsibility untested fn | yes | ready-with-notes |
| security-ibex | `security-ibex-eval/` | judge (T3) | teeth | Names IDOR/BOLA missing-object-authorization class (not the injection distractor) + threat model w/ exploit sketch + Ibex finding fields; precision: do not flag a safe f-string HIGH | yes | ready-with-notes |
| testing-snow-leopard | `testing-snow-leopard-eval/` | judge (T3) | partial | Boundary-edge coverage AND observable-outcome assertions while rejecting call-count / not-null tautologies | yes | ready-with-notes |
| legibility-dzo | `legibility-dzo-eval/` | judge (T3) | teeth | Diagnoses codescout-instrument friction in tool terms (over-budget body, index-invisible closure, retrieval-killing generic name) and gates every refactor on observed friction; refuses clean code | yes | ready |
| reconnaissance | `reconnaissance-eval/` | judge (T3) | partial (L-7 control) | Scout-before-edit catches plan field `expiry_ts` vs real `deadline_unix` + monotonic-ID `F-3` entry in anchored shape citing the real identifier | yes (partial, L-7) | ready |
| codescout-companion:explore-project | `explore-project-eval/` | judge (T3) + output (T1) | partial (L-7 control) | Dispatches a read-only subagent at a foreign repo and returns the fixed `## Exploration:` skeleton (Findings/Key files/Confidence/Caveats/Follow-up), not an inline answer | yes (partial, L-7) | ready-with-notes |

Tiers: **T1 output** = substring/regex over response text; **T3 judge** = LLM-as-judge
rubric. Where "mode: output" is noted (codescout-pika), the runner still evaluates judge
assertions off the response text — mode only governs trace capture.

## Phase B — running the benchmark

Run each harness twice: once normally (expect **PASS** — the skill fires and clears the
rubric) and once ablated (expect **FAIL** — without the skill the model cannot produce the
skill-specific markers). A `present-PASS / ablate-FAIL` gap is the proof that the skill has
power. For *tautological*-tagged skills, expect the ablated arm may also PASS — that is the
recorded expectation, not a harness defect.

### Preconditions

- **`ANTHROPIC_API_KEY` must be in the environment** for the judge tier (default judge model
  `claude-haiku-4-5` calls the Anthropic API). Source it from `.env`; **never echo the
  value**. e.g. `set -a; . ./.env; set +a` from the eval working directory.
- **`~/.claude-test` must stay blank.** It is the negative-control profile: no globally
  loaded buddy plugin, run with `--strict-mcp-config`. The skill arrives only via
  `setup.skills`. If the profile carries stray skills/memories the control is no longer real.
- **Invoke with `--config`, never a positional.** `prompt-tdd run <yaml>` reads the yaml as a
  scenario-path *override* and discovers 0 scenarios; use `prompt-tdd run --config <yaml>`.
  All `setup.skills` sources are absolute paths, so cwd is otherwise irrelevant.
- **Scenario files must be named `scenario.yaml`.** `discover_scenarios` matches that name
  strictly (at any depth under `scenarios/`); a flat `scenarios/foo.yaml` is silently skipped.

### Commands

Source the judge key once, then run each harness with `--config` (present arm = expect PASS;
`--ablate` arm = expect RED, which is what proves power):

```bash
set -a; . /home/marius/work/claude/prompt-engineering/.env; set +a   # judge key; never echo it
PT=/home/marius/work/claude/prompt-engineering/.venv/bin/prompt-tdd
R=/home/marius/work/claude/claude-plugins/buddy/tests

for s in architecture-snow-lion codescout-pika data-leakage-snow-pheasant \
         debugging-yeti docs-lotus-frog explore-project legibility-dzo \
         ml-training-takin performance-lammergeier planning-crane \
         reconnaissance refactoring-yak security-ibex testing-snow-leopard; do
  "$PT" run --config "$R/${s}-eval/prompt_tdd.yaml"            # expect PASS
  "$PT" run --config "$R/${s}-eval/prompt_tdd.yaml" --ablate   # expect RED = skill has power
done

# prompt-hamsa — config lives in a prompt-tdd/ subdir alongside the bespoke harness
"$PT" run --config "$R/prompt-hamsa-eval/prompt-tdd/prompt_tdd.yaml"
"$PT" run --config "$R/prompt-hamsa-eval/prompt-tdd/prompt_tdd.yaml" --ablate
```
### Reading results

- **PASS / FAIL** → skill has power on that scenario. The intended outcome.
- **PASS / PASS** → tautological for that scenario; the bare model already does it. Expected
  for architecture-snow-lion, docs-lotus-frog, planning-crane, refactoring-yak.
- **FAIL / —** → activation failure: the skill did not fire even when present. Suspect the
  message phrasing first (does it name the capability / match the description?), then the
  rubric. See the activation assumption in Known limitations.

## Known limitations

**Fidelity — skill-content floor, not full summon.** Every harness tests the `SKILL.md`
payload (plus any `_<lens>.md` addendum) **loaded as a bare skill**, NOT the full
`/buddy:summon` injection (specialist memories, gates, memory-protocol, persona/voice
framing, `inject_trackers`). The measured power is therefore a **lower bound** on the
fully-summoned specialist. Where lens addenda exist (data-leakage-snow-pheasant), the
summoned arm copies the whole dir so both lenses are present; the lens is selected only by
the message, and each rubric scores only that-lens markers (other-lens bleed is un-rewarded,
not penalized).

**Activation assumption.** Each harness assumes the skill **auto-fires from the message** —
either because the message is phrased squarely in the skill's description domain, or because
it explicitly names the capability (e.g. "Acting as the Security Ibex skill…"). If a present
arm FAILs, the most likely cause is that the message did not trigger activation, not that the
skill is weak. Skills relying on domain match alone (ml-training-takin, testing-snow-leopard)
are the most exposed; those that name the capability (architecture-snow-lion, codescout-pika,
data-leakage-snow-pheasant, debugging-yeti, legibility-dzo, security-ibex) are the most robust.

**L-7 partial control — MCP-coupled skills.** Three harnesses cannot exercise their skill's
real production flow because the isolated `~/.claude-test` profile strips the codescout MCP
tools and plugin hooks the skill natively drives:

- **reconnaissance** — native method runs on codescout `symbols`/`references`/`edit_markdown`
  and a librarian tracker artifact, all stripped. Scout is exercised with plain Read/Grep; the
  tracker is supplied as a `setup.files` fixture so there is a real seam-log to append to. What
  survives and is measured: scout-before-act ordering, plan-vs-reality compare, monotonic-ID
  `F-N` allocation, anchored entry shape. NOT exercised: cp-template bootstrap,
  `edit_markdown insert_before`, librarian artifact model, `recon_count.py` statusline bump.
- **codescout-companion:explore-project** — the headline capability (auto-bootstrapping the
  foreign repo's `CLAUDE.md` + codescout memories) is delivered by the `explore-inject.sh`
  PreToolUse-on-Agent hook, which `setup.skills` does NOT copy and `~/.claude-test` does NOT
  contain — so NEITHER arm runs the hook. The eval scores only what `SKILL.md` prose drives:
  dispatch-template discipline and the fixed `## Exploration:` report skeleton. A live run with
  the hook would show strictly more skill-specific behavior.
- **codescout-pika (Persist/SQL path)** — the Phase-2b audit (`queries.sql` predicate matrix
  against a live `.codescout/usage.db`) is deliberately OUT of scope (no DB seeding in the
  harness). The eval exercises only the Whistle/Observe **judgment** path on a tool-call log.

For all three, an ablate-FAIL proves the `SKILL.md` content has teeth but does NOT validate
the production MCP/hook flow.

**Judge variance.** All scoring is LLM-as-judge (`claude-haiku-4-5` default), so verdicts
near the threshold (0.7–0.75) carry stochastic noise; re-run borderline results. The judge
process sees `ANTHROPIC_API_KEY` even though the isolated subprocess under test has it stripped.

## Build-phase open issues

Aggregated from per-skill build+review. None block Phase B; several are tautology/leak risks
to confirm empirically when the suite runs.

1. **architecture-snow-lion / tangled-service** — a strong bare Sonnet/Opus-class model may
   spontaneously cite imports and format as an ADR, scoring ≥0.7 without the skill. The
   three-marker combined gate raises the bar but does not eliminate the tautological-pass risk.
   Flagged honestly as "likely tautological"; rubric is honest, not inflated. (The
   restraint-small-module scenario is the more discriminating one — it requires contradicting
   the user's explicit framing, which bare models tend to comply with.)
2. **codescout-pika / README validation table** — the table claims "absent → 0/2 FAIL," but the
   clean-log precision scenario is not genuinely discriminating when ablated (a bare model asked
   to flag violations on an all-clean log will likely answer "no issues" and pass, yielding zero
   present/ablate delta). Real power lives only in the multi-law recall scenario; the table
   overstates ablation failure to 2 scenarios.
3. **debugging-yeti / README scenario table** — named the wrong mutable-default field
   (`discounts={}` instead of `items=[]`). `items=[]` is the mutable default that causes the bug;
   `discounts` is assigned per-instance in `__init__` and is not the root cause. README text
   defect; the rubric targets the correct field.
4. **docs-lotus-frog / baselines path** — `baselines:` is relative (`.prompt-tdd/baselines/`);
   the directory does not yet exist and is created on first run. Not a bug, worth noting.
5. **performance-lammergeier / measure-first scenario** — the rubric may not discriminate against
   capable bare models that genuinely treat profiling as a gate. Documented as expected-power
   partial; a design caveat, not a bug.
6. **prompt-hamsa / marker leak** — markers (1) read-as-stranger and (2) cut-before-add may
   partially leak to a competent bare model doing generic prompt polish. Mitigated by requiring
   ≥3 of 4 markers, so partial leak alone does not produce a false pass.
7. **refactoring-yak / extra field** — `expected_pass: true` is benign extra metadata, not a
   schema violation, but monitor if the runner errors on unknown keys.
8. **security-ibex / precision-clean scenario** — its `expected_pass: true` may not discriminate
   the ablated arm (a bare model can trace the allowlist neutralization without the skill). Not a
   structural defect; the IDOR scenario carries the load, and precision-clean is weak evidence of
   skill power on its own.
9. **testing-snow-leopard / scenario A marker 1** — boundary coverage may partially pass for a
   bare competent model unprompted; scenario A's discriminating power rests primarily on marker 2
   (observable-outcome / call-count rejection). Expected-power partial, not a defect.
10. **explore-project / T1 `(?i)confidence`** — a common English word; a verbose bare-model prose
    answer could contain it incidentally, slightly weakening T1 isolation. The judge rubric is the
    load-bearing layer, so low severity.
11. **explore-project / scenario 2 (same-repo-precision)** — an over-firing guard, not a
    sensitivity test: both arms are expected to PASS and the A-vs-ablate delta is intentionally
    zero. The scenario description does not make the expected-zero-delta explicit, which could read
    as a harness defect.
12. **explore-project / `(?i)caveats?`** — the `?` makes the trailing `s` optional, so it matches
    singular 'caveat' too. Harmless (the template mandates the plural); the judge rubric enforces
    the full skeleton.

## Next phase — optimization (gated on a trustworthy metric)

This suite *measures* power; it does not *improve* skills. prompt-tdd already ships the other
half of the loop — `prompt-tdd optimize --optimizer {textgrad,mipro,gepa}` (DSPy 3.2.1
installed, all three runnable, scored by `judge_score_metric`). The temptation is to reach for
MIPRO/GEPA instead of stabilizing the judge. That ordering is wrong, for two reasons rooted in
how the power map above came out:

1. **Optimizers maximize the absolute present-score, not the present−ablate delta — they cannot
   manufacture teeth.** The 8 tautological skills score ~1.0 on the bare model already; there is
   no headroom and no gradient toward "discriminates skill from no-skill." Optimizing them
   overfits cosmetics while power stays zero. The fix for a tautological verdict is a *harder
   scenario* (test design), never a reworded SKILL.md.
2. **Optimizers tune the prompt, never the judge — so they do nothing for the "Judge variance"
   limitation above, and optimizing against a wobbling metric is harmful.** Each optimizer keeps
   the max-scoring candidate, so near the 0.7–0.75 band it latches onto lucky judge draws and
   reports an inflated `best_score` that does not replicate.

So the ordered loop is: **measure (this suite, done) → stabilize the metric (the cross-family
`PanelJudge`, already calibrated upstream at `max_spread=0.25`) → harden the tautological
scenarios → only then optimize.** The panel is not an alternative to MIPRO; it is the
precondition that makes any optimizer output trustworthy.

When optimization is warranted, it applies **only to the genuine-teeth skills** in the power map
(`refactoring-yak`, `codescout-pika`), on a held-out scenario split with a human gate — because a
buddy SKILL.md is a general-purpose voice, and optimizing it against a scalar score on a few
scenarios overfits voice and generality (what human review like the prompt-hamsa critique
protects). Prefer **GEPA** (consumes our tiered assertion-failure text as feedback — closest to
how we hand-edit) or **TextGrad** (cheapest, no DSPy).

Full lesson + the optimizer-mechanics reasoning: prompt-engineering `docs/trackers/skill-eval-playbook.md` § L-9.

## Roster decision — keep / cut / rewrite-probe (proposed, 2026-06-18)

The benchmark exists to answer one question per buddy: **what does it do that a bare
expert model would not?** Applying that test to every verdict (grounding each call in the
skill's actual SKILL.md, not the verdict label):

| Skill | Eval verdict | Marginal value over a bare expert | Decision |
|---|---|---|---|
| codescout-pika | full teeth | yes (confirmed) | **KEEP** |
| refactoring-yak | full teeth | restraint: no-smuggle, atomic moves | **KEEP** |
| prompt-hamsa | single teeth | resist-adding to a tight prompt | **KEEP** |
| planning-crane | single teeth | gate on done-condition before decomposing | **KEEP** |
| reconnaissance | L-7 | scout-before-act + F-N/W-N ledger; MCP/process-coupled | **KEEP — isolation-blind** |
| legibility-dzo | "tautological" → corrected | machine-legibility vs codescout budgets / `usage.db` / librarian — NOT generic readability; runs only through the MCP the eval strips | **KEEP — isolation-blind** |
| security-ibex | tautological | systematic threat coverage (STRIDE) vs cherry-picking the obvious vuln | **REWRITE-PROBE** |
| debugging-yeti | tautological | methodical hypothesis-test on a *non-pattern* bug | **REWRITE-PROBE** |
| testing-snow-leopard | tautological | mutation-awareness; reject call-count spies | **REWRITE-PROBE** |
| architecture-snow-lion | tautological | restraint — resist over-engineering | **REWRITE-PROBE** |
| ml-training-takin | tautological | overfit-tiny gate; grad/param-norm band; train/serve parity | **REWRITE-PROBE** |
| docs-lotus-frog | tautological | stale-when trigger; reader-path; one-source-of-truth | **REWRITE-PROBE** |
| performance-lammergeier | present-FAIL (not promptable) | profile-first / no fabricated numbers — but not via handed code (L-10) | **REWRITE-PROBE (no-code scenario)** |
| data-leakage (llm lens) | tautological | RePCS / canary / cross-family bias methods (model may already know) | **REWRITE-PROBE (low) / accept** |

**Three conclusions:**

1. **No clean CUT candidates.** Every "tautological" / present-FAIL verdict is explained by
   either (a) the scenario tested *base competence* rather than the skill's marginal
   discipline (under-probing), or (b) the skill's value is MCP/process-coupled and the
   isolation harness structurally cannot exercise it. Cutting any skill now would be premature.

2. **legibility-dzo was nearly miscut.** First-pass instinct was "legibility is base
   competence → cut." Reading the SKILL.md corrected it: dzo is bound to codescout's symbol
   budgets, `usage.db` friction, and `legibility_scan` — exactly the MCP the `~/.claude-test`
   profile strips. It is isolation-blind (like reconnaissance), not redundant. (Conclude after
   evaluating, not before — the label "tautological" was an eval artifact, not a skill fact.)

3. **Next action = a rewrite-probe pass**, not cuts. For each REWRITE-PROBE skill, design a
   scenario whose *ideal* response **leads** with the skill's marginal discipline (not base
   competence — L-10), gating each on first naming that discipline (done in the table above),
   then measure present + ablate. A skill becomes a genuine CUT candidate **only** if a fair,
   harder probe still shows no power. The two isolation-blind skills (reconnaissance,
   legibility-dzo) need live MCP-coupled evaluation, not the headless isolation harness — out
   of scope for this suite.

### Rewrite-probe pass — first results (2026-06-18)

Probed the first two REWRITE-PROBE skills. Both came back **confirmed tautological**, and the
pattern reframes the rest of the roster.

- **debugging-yeti — no new probe needed.** Scouting its existing scenarios showed
  `no-repro-no-cause` already fairly tests its marginal discipline (reproduce-first, decline
  false certainty, anchor to env / shared-state heuristics) — and it is tautological. A bare
  model imposes that debugging method unaided; its single-turn *advice* is base competence (any
  execution-discipline value is multi-turn, unmeasurable here). → **CUT candidate.**
- **security-ibex — new harder probe, decisively tautological.** Built a fair probe where every
  loud surface is correct (parameterized SQL, bcrypt, CSPRNG single-use token) and the only HIGH
  vuln is a SUBTLE host-header injection (poisoned reset link → account takeover). Skill removed,
  the bare model scored **1.00 on 4/4 runs** — class, exploit, and fix. Two distinct angles
  (idor + host-header) now both show the bare model at 1.00. → **CUT candidate.**

**Generalizing lesson (→ skill-eval-playbook L-11): teeth come from RESTRAINT or TOOL-COUPLING,
not domain knowledge.** A skill encoding knowledge/method heavily represented in training is
tautological — the base model already has it. Teeth appear only where the skill makes the model
act AGAINST its instinct, or where its value is tool/process-coupled.

**Refined roster:**

| Bucket | Skills | Action |
|---|---|---|
| KEEP — teeth (restraint/judgment) | refactoring-yak, planning-crane, prompt-hamsa | keep |
| KEEP — teeth (tool-coupled) | codescout-pika | keep |
| KEEP — isolation-blind (tool/process-coupled) | reconnaissance, legibility-dzo | keep; eval live, not headless |
| **CUT candidate** — knowledge = base competence (confirmed) | **debugging-yeti, security-ibex** | propose cut |
| Probe-worthy — restraint/judgment angle untested | architecture-snow-lion (resist over-engineering), testing-snow-leopard (reject weak/call-count tests) | one more probe each |
| Likely tautological — pure knowledge (accept) | ml-training-takin, docs-lotus-frog, data-leakage (llm lens) | accept as base competence |

Cutting is the user's call — these are recommendations. Probe evidence: prompt-engineering
`skill-eval-log.md` § Buddy benchmark; probe scenario at `/tmp/ibex-probe` (local, not committed).
