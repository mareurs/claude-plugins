# data-leakage-snow-pheasant eval

prompt-tdd harness for the **Snow Pheasant** skill (`buddy:data-leakage-snow-pheasant`,
archetype: knowledge/taxonomy). It measures whether the skill's content changes the
model's observable output versus a bare model that lacks it.

## What it tests

The discriminating task: **flag train/test leakage in an ML pipeline snippet**. Each
scenario hands the model a pipeline with several PLANTED leaks plus a flattering
headline score, and asks for an audit. The judge scores whether the response applies
the Pheasant's **lens-specific audit method** — not whether it merely produced a
competent code review.

One scenario per lens (the skill requires a lens: `classic` or `llm`):

- `scenarios/classic-tabular-leak.yaml` — a scikit-learn churn pipeline. Planted leaks:
  scaler fit on full X before split, full-data target/mean encoding (label-into-feature),
  random split on multi-row-per-customer data (group leak), 98% headline.
- `scenarios/llm-rag-judge-leak.yaml` — a RAG + LLM-judge eval. Planted leaks: public
  benchmark (GSM8K) gain, RAG index built from the gold-answer source docs, single
  same-family judge with fixed response order, few-shot exemplars drawn from the eval
  set, eval run once.

## The discriminating marker

A bare, competent model reliably catches the *famous* bugs (scaler-before-split;
"the judge could be biased") and may hedge on the headline number. The rubric does
**not** reward that. It rewards the Pheasant's signature method:

- **classic**: the **null/permutation test** (shuffle labels, re-fit, compare to chance)
  is required for a pass, plus at least two of {target-encoding label leak, group leak on
  random split, Pipeline fit-on-train-only}, with the 98% treated as suspect.
- **llm**: the **public-benchmark contamination probe** (private post-cutoff held-out /
  n-gram overlap / paraphrase-perplexity / canary recall) is required for a pass, plus at
  least two of {cross-family judge panel + position swap, RAG-index-by-source /
  chunk-permutation audit, variance floor / atomic-claim decomposition}.

These markers (null/permutation test, group-aware split, OOF encoding, cross-family
panel, position swapping, chunk-permutation sanity check, contamination probe, variance
floor) appear in output **only if the skill fired** — they are the teeth. Substring
matching cannot distinguish them from a competent review echoing the same words, so the
tier is **T3 judge**.

## Activation assumption

The skill is copied into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`, but it
auto-fires only if the task matches its description/triggers. Each scenario's `message`
names the capability ("Acting as the data-leakage snow-pheasant specialist in its
CLASSIC/LLM lens, audit this pipeline for train/test leakage") and presents a leakage
task in the skill's exact domain, so a model WITH the skill reliably invokes it. The
`--ablate` arm sends the SAME message without the skill files; the bare model then
falls back to a generic review and should miss the lens-specific markers. **Phase B
validates this assumption.**

## Lens / fidelity caveats

- **Lens not harness-enforced.** The summoned arm copies the WHOLE skill dir, so BOTH
  `_classic.md` and `_llm.md` are present in every scenario's work dir. Lens selection is
  done by the message naming the lens; nothing in the harness restricts which addendum
  loads. Each scenario's rubric only checks that-lens markers, so a model that bleeds the
  other lens's vocabulary is not penalized, only un-rewarded.
- **Skill-content floor, not full summon.** This tests the `SKILL.md` + lens addendum
  payload as a loaded skill — NOT the full `/buddy:summon` injection (memories, gates,
  memory-protocol). The power measured here is the skill-content floor, which is the right
  unit for "does the writing have teeth".
- **Judge calls the API.** The default judge (`claude-haiku-4-5`) hits the Anthropic API;
  run with `ANTHROPIC_API_KEY` set. Judge scores are stochastic near the 0.7 threshold;
  re-run if a result lands within noise of the bar.

## How Phase B runs it

```sh
# Expect PASS — the skill present produces the lens-specific markers
prompt-tdd run prompt_tdd.yaml

# Expect FAIL — bare model lacks the skill; missing markers => skill has power
prompt-tdd run prompt_tdd.yaml --ablate
```

A PASS on the normal run and a FAIL on `--ablate` together demonstrate the skill's
content has teeth (the A vs --ablate delta). If `--ablate` also passes, the markers are
reachable by a bare model and the skill is tautological for this task — a valid result to
report, not a bug to hide.
