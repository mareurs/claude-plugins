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

## Skill index

All eval dirs are under `buddy/tests/`. The `prompt_tdd.yaml` is at
`<eval-dir>/prompt_tdd.yaml` for every skill **except prompt-hamsa**, whose harness lives
in a `prompt-tdd/` subdir (the eval dir also hosts a separate bespoke harness measuring a
different question).

| Skill | Eval dir | Tier | Expected power | Discriminating marker | Control valid? | Verdict |
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
- **Run cwd matters.** codescout-pika's skill source path resolves against
  `project_root = os.getcwd()` (the eval dir per its README), so run it from its eval dir.

### Commands

```bash
# 14 skills — yaml at <eval-dir>/prompt_tdd.yaml
for s in architecture-snow-lion codescout-pika data-leakage-snow-pheasant \
         debugging-yeti docs-lotus-frog ml-training-takin performance-lammergeier \
         planning-crane refactoring-yak security-ibex testing-snow-leopard \
         legibility-dzo reconnaissance explore-project; do
  prompt-tdd run buddy/tests/${s}-eval/prompt_tdd.yaml            # expect PASS
  prompt-tdd run buddy/tests/${s}-eval/prompt_tdd.yaml --ablate   # expect FAIL = skill has power
done

# prompt-hamsa — yaml in a prompt-tdd/ subdir
prompt-tdd run buddy/tests/prompt-hamsa-eval/prompt-tdd/prompt_tdd.yaml           # expect PASS
prompt-tdd run buddy/tests/prompt-hamsa-eval/prompt-tdd/prompt_tdd.yaml --ablate # expect FAIL
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
