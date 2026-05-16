# Snow Pheasant — LLM lens

Loaded alongside `SKILL.md` when summoned as `data-leakage:llm`. Apply on top of the universal Method, Heuristics, and Reactions. Covers LLMs, RAG, finetuning, judge-based eval, and embedder/retriever stacks.

## Method (LLM-specific)

1. **Probe the eval set for pretraining/SFT contamination before quoting any benchmark number.** If the model has seen the eval items during pretraining or fine-tuning, the score measures memorization, not skill. Detection options: n-gram overlap against any available training corpus; perplexity gap between eval items and paraphrases; canary-string recall (insert known unique strings and check whether the model can complete them); exchangeability tests on item ordering. (Sainz et al., *NLP Evaluation in Trouble: On the Need to Measure LLM Data Contamination for each Benchmark*, EMNLP 2023; Magar & Schwartz, *Data Contamination: From Memorization to Exploitation*, ACL 2022; Oren et al., *Proving Test Set Contamination in Black Box Language Models*, 2023; Carlini et al., *Quantifying Memorization Across Neural Language Models*, ICLR 2023.)

2. **Draw few-shot exemplars from a pool disjoint from the eval set.** Exemplars in the prompt are training data at inference time. If they overlap with eval items, the model is shown the answer in-context. Keep an exemplar pool partitioned away from any item that will be scored.

3. **For RAG: audit the retrieval index for eval-answer presence AND check whether the model is actually using retrieved evidence.** Two distinct failure modes: (a) gold-answer chunks in the index → retrieval reads the answer; (b) model ignores retrieval entirely and answers from parametric memory — this is undetectable without probing. Use **RePCS** (Retrieval-Path Contamination Scoring): compute KL divergence between query-only inference and retrieval-augmented inference; low divergence means the model is ignoring retrieved context in favour of memorised data. Also run the **chunk permutation sanity check** (see Heuristics): shuffle the retrieved chunks before passing to the generator; faithfulness should collapse — if it doesn't, the judge is not measuring grounding. (Es et al., *RAGAS*, EACL 2024; Saad-Falcon et al., *ARES*, NAACL 2024; *RePCS: Diagnosing Data Memorization in LLM-Powered RAG*, arxiv 2506.15513.)

4. **Use a cross-family panel of judges — and audit for position, length, and self-preference bias before trusting any score.** LLM judges exhibit four systematic biases:

   - **(a) self-preference** — the model prefers text with lower perplexity relative to its own outputs, not text that is objectively better
   - **(b) position bias** — one study found 48.4% of pairwise verdicts reversed simply by swapping the response order
   - **(c) verbosity bias** — longer responses score higher regardless of instruction-following accuracy
   - **(d) scoring instability** — rubric item order and score ID phrasing shift absolute scores

   Mitigations:

   - Use a **PoLL (Panel of LLM Judges)** of ≥3 models from different families — 3-member panels consistently outperform single judges by averaging out individual biases
   - Run **position swapping** (evaluate each pair in both orders; flag any verdict that reverses)
   - Force **chain-of-thought reasoning before the final judgment** — this reduces self-preference bias by requiring explicit justification
   - **Calibrate** the judge against human-annotated samples and iterate the judge prompt until Cohen's κ ≥ 0.6 against humans

   (Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*, NeurIPS 2023; Wang et al., *Large Language Models are not Fair Evaluators*, 2023; *A Survey on LLM-as-a-Judge*, arxiv 2411.15594, 2024; *PoLL*, getmaxim.ai, 2024.)

5. **Decompose holistic judging prompts into per-claim verification.** A single "rate this answer 1–5 for faithfulness" prompt invites the judge to confabulate a global feel. Decompose into atomic claims, verify each against the source, aggregate. Holistic prompts produce inflated, lower-variance scores; decomposed prompts produce honest, higher-variance scores. (Min et al., *FActScore*, EMNLP 2023; Es et al., *RAGAS*, EACL 2024. MRV-poc real example: holistic Gemini judge scored faithfulness 0.91; ragas claim-decomposition on the same data scored 0.70.)

6. **Pin chat template, tokenizer, and decoding params identical between dev and eval.** A different chat template at eval time is a different model. Sampling temperature, top-p, max-tokens, n-best, repetition penalty — pin and version every one. (MRV-poc real example: Vertex silently dropped the `n` parameter; identical-input variance halved once `bypass_n=True` was forced.)

7. **For finetuning: hold out a prompt set whose distribution matches eval and never train on it.** SFT/DPO/RLHF prompts that overlap with the eval prompt distribution leak the eval task into training. Generate the held-out set from the same source process as eval, then partition before any training run touches it.

8. **Establish a variance floor by re-running on identical inputs.** Treat any treatment Δ smaller than that floor as noise. Without a floor, every reported lift is an unverified claim. (MRV-poc real example: ragas faithfulness mean|Δ|=0.046 on identical-input reruns; only Δ > 0.05 was distinguishable from weather.)

9. **Triangulate any "lift" across at least two independent fixtures.** A single fixture is an oracle once tuned on. A held-out cleaned fixture and a fresh-cleaned fixture, run independently, are the minimum bar before quoting external numbers.

10. **For synthetic / self-distilled training data: never evaluate on data drawn from the same model that produced the training set.** The model recognizes its own distribution. (Shumailov et al., *AI models collapse when trained on recursively generated data*, Nature 2024 — the "model collapse" finding generalizes to eval contamination via the same mechanism.)

## Heuristics (LLM-specific)

1. **Model recites eval answers verbatim from a short prefix → memorization, not skill.** Prefix-completion attacks: feed the first 10–30 tokens of an eval item; if the model continues with the gold answer, the item was in pretraining. (Carlini et al., *Extracting Training Data from Large Language Models*, USENIX Security 2021.)

2. **Eval scores drop sharply on paraphrased prompts → benchmark contamination.** A model that scores 80% on the original and 50% on a semantically-identical paraphrase memorized the surface form. (Oren et al., 2023.)

3. **LLM-as-judge prefers the candidate from its own family → self-preference bias, not quality.** The mechanism: judges prefer text with lower perplexity relative to their own outputs — familiarity, not correctness. Cross-family panel or human spot-check before believing the ranking. (Zheng et al., 2023; *Self-Preference Bias in LLM-as-a-Judge*, arxiv 2410.21819.)

4. **Improvement only on public benchmarks, flat on a private held-out set → contamination.** Public benchmarks leak into training corpora over time (web crawls, GitHub, leaked test sets). A private held-out set is the only honest signal. (Sainz et al., 2023.)

5. **Bi-encoder recall collapses when named entities are stripped → entity-token leak, not semantic match.** Paragraph-derived queries share rare entities with gold; the encoder ranks on those entities. Production users will not supply them. Test by perturbing entities and watching recall. (MRV-poc real finding: −17pp recall when entities replaced with `<entity>` placeholders.)

6. **Filename-token Jaccard between query and gold ≈ source of the lift → filename leakage.** Queries that mention "MIRO Sierra Leone 2011" retrieve any chunk whose filename contains those tokens. Test by hashing or stripping filename tokens from the embedding input.

7. **Reranker top-1 score ≥ 0.9 on a wrong document → confident wrongness, not uncertainty.** A reranker that scores non-gold confidently above gold is not a calibration problem; it is a distribution-mismatch problem. Confidence is not correctness.

8. **Few-shot examples include eval items or near-paraphrases → leakage through prompt context.** Audit every prompt template that appears in an eval run for items that overlap with the eval set.

9. **Adding RAG and the metric jumps → check the index for eval answers before celebrating.** Index hygiene first; attribution second. (Niu et al., *RAGTruth*, 2024.)

10. **A claim that the model is "better at reasoning" without a private held-out set → unverifiable.** Public reasoning benchmarks (GSM8K, MATH, MMLU) have all been shown to be partially contaminated. Treat public-benchmark gains as hypothesis, not evidence.

11. **Chunk permutation faithfulness sanity check.** Shuffle retrieved chunks before passing to the generator; faithfulness score should drop sharply. If it doesn't, the judge is not measuring grounding — it is measuring fluency or prior knowledge. Run this before quoting any RAG faithfulness number. (arxiv 2405.07437.)

12. **Judge returns different verdict when response order is swapped → position bias.** Run every pairwise evaluation in both orders; 48.4% of verdicts flip by mirroring order in controlled studies. If verdicts disagree, the judge is reading position, not quality. Aggregate by majority or flag as "contested." (*Diagnosing Bias and Instability in LLM Evaluation*, MDPI 2025.)

13. **Judge consistently prefers longer responses → verbosity bias.** Controlled test: two equally correct answers of different lengths. If the longer one always wins, add explicit rubric instruction penalising padding, or use a length-normalised metric.

14. **Fragmented inputs (headings, dangling bullets, table cells) routed through an LLM extractor → expect fabricated outputs.** LLMs presented with low-information fragments invent plausible content to fill them. If the extractor's output becomes ground truth, the gold is partly fabricated. (MRV-poc real example: paragraph "Climate change and" produced 9 fabricated nuggets about a project in Brazil.)

15. **A "win" that only appears on the fixture you tuned on → it is the fixture, not the win.** Replicate on a clean held-out and a fresh fixture before shipping. (MRV-poc real example: LoRA α=0.06 won +1.3pp on a 9q dirty holdout; Δ on a 23q+73q clean re-eval was ~0pp.)

16. **A single-shot LLM probe at default temperature is not evidence.** Generation APIs default to ~1.0 temperature; under conflict or ambiguity the model picks different answers across runs. To characterize a prompt-rule's behaviour, run n≥5 at temperature=0. Anything less is theatre. (MRV-poc real finding 2026-05-15: CYCLE DISCIPLINE prompt-only rule looked plausible at n=2 / default-temp — mixed FAIL/PARTIAL across two runs; at n=5 / temp=0 the swap probe was 5/5 PARTIAL deterministic. The rule does not enforce. Diagnostic temperature=0 had to be exposed as a kwarg on the generator before this could be measured.)

17. **A PARTIAL/hedge verdict on a conflict probe ≠ the rule passes.** When the LLM cites *both* options under conflict ("5,000 ha as of Dec 2024 [chunk 2]. 3,200 ha as of Dec 2022 [chunk 1]."), that is the LLM's defensive policy under ambiguity — evidence that the rule did NOT enforce a precedence. The naive read "at least it's not failing, it cites both, that's safe" misses the diagnostic: the rule isn't authoritative. The fix is structural: remove the conflict before the LLM sees it, don't try to teach the LLM to resolve it via prompt.

18. **Costume test for prompt-rule dominance: swap the confound.** If your "passing" test has the rule's signal and the content's signal pointing the same way (e.g. cycle=3 metadata also contains the string "December 2024"), you have not proven dominance — you have proven correlation. Build a swap probe where the two signals *disagree*. If the rule is dominant, the swap still produces the rule-aligned answer; if not, the rule was riding the confound. Without the swap, every "the rule works" finding is a costume.
19. **The audit metric must match production topology.** A pre-registered, chance-corrected, multi-rater metric on the wrong target is still wrong. Before you score, write down the production prediction contract (which model emits, when, against what) and verify the audit *exercises that contract*. Cross-family or multi-rater κ is the right gate for human-aligned label quality, not for single-model deterministic stamping where the operational question is intra-model consistency + downstream-correctness. The MRV-poc V-5 audit (2026-05-15) ran cross-family κ ≥ 0.70 as a gate for three iterations; production used Flash only at ingest. The right gate was intra-model self-consistency (paraphrase-invariance / determinism on identical input) + a downstream pair-match probe. Cost of the miss: $4.20 + near-spiral into "the prompt must be broken, iterate again". (MRV-poc real example: see `benchmarks/v5_extractor_audit/findings_2026-05-15.md` H19.)

20. **Audit failure modes must be distinguishable from valid zero.** `except Exception: results[cid] = []` masks a broken instrument as a legitimate empty extraction. A measurement that cannot distinguish "the API errored" from "the model legitimately returned nothing" is not a measurement. Either hard-fail on instrument errors, or tag the result `None`/`api_error` so downstream knows the datum is missing rather than observed-zero. Silent failure in an audit harness is worse than a loud crash — it inflates agreement statistics (two empties = Jaccard 1.0) and gives a false sense of pre-registered rigour. (MRV-poc real example 2026-05-15: V-5 audit iter#1 spent $1.40 measuring Flash-vs-silent-Pro because Pro errored on `thinking_budget=0` and a bare except swallowed it.)

21. **A predicate is only as stable as the keys it groups on.** When a structural deduplication or matching rule relies on LLM-extracted free-form keys, the rule inherits the LLM's paraphrase variance. At temperature 0 the model still conditions on the actual input text and produces synonymous-but-disjoint surface tokens on paraphrased same-fact inputs ("production seedling" vs "output seedling"; "VCUs issued" vs "carbon credits issued"; "women employed" vs "employment female"). Token-set Jaccard on those keys cannot dedup synonyms. Before designing a structural-key dedup over LLM outputs, build a paraphrase pair-match probe: same-fact pairs should produce overlapping keys; different-fact pairs should produce disjoint keys. If both hold ≥ 80% the predicate is safe; otherwise the key space is the bottleneck and no amount of prompt iteration fixes it — change the architecture (embedding-similarity match, closed vocabulary, or chunk-content embedding clustering). (MRV-poc real example 2026-05-15: V-5 cross-cycle pair-match probe — pair-match-correctness 0.500 = random binary baseline; same_fact 0.286; diff_fact 1.000 = "always predict diff" trivial baseline.)

22. **Once two judge families have agreed on representative slices, defer further cross-family replication to final-tuning, not every iteration.** Cross-family judge panels (Gemini Pro ↔ Anthropic Claude) are expensive (API cost + latency) and slow to interpret. They are most valuable as a gate on *shipped* numbers — externally-quoted RAGAS, demo metrics, sign-off lift claims. They are least valuable mid-iteration when the prior on a treatment's effect size is uncertain by orders of magnitude more than the judge-family disagreement. Decision rule: if prior cross-family runs on this fixture/metric have shown κ ≥ 0.7 or rank-correlation ≥ 0.8, default to single-family during exploration and re-run the cross-family panel only at the gate before external quoting or sign-off. Track the agreement evidence in the experiment README so the deferral is auditable. (MRV-poc real example: Gemini Pro and Anthropic Claude judges agreed broadly on prior eval slices; R2 cross-family replication is scheduled as a final-tuning step, not per-experiment.)
## Reactions (LLM-specific)

Non-exhaustive. Each pairs a user signal with a lens-specific method/heuristic anchor; the universal Operating Principles in `SKILL.md` still apply.

1. **User reports a benchmark gain on a public eval.** — _Applies: Method (LLM) on contamination; Operating Principle 1 (distrust headline)._ "Show me a private held-out set built after the model's training cutoff. Public benchmarks leak into training corpora. Until I see the private number, the gain is a costume."

2. **A judge LLM scores the user's model higher than baseline.** — _Applies: Heuristic (LLM) on family bias._ "Which family is the judge? If it is the same family as the model you favor, the score is family bias. Cross-family judge or human eval. Then come back."

3. **User adds RAG and faithfulness jumps.** — _Applies: Method (LLM) on retrieval-pool contamination._ "Check the index. If eval answers or their near-paraphrases live in the retrieval pool, you are reading the answer, not finding it. Audit by source before celebrating."

4. **User uses a single holistic faithfulness prompt.** — _Applies: Method (LLM) on atomic-claim decomposition._ "One global rating invites a global feel. Decompose into atomic claims, verify each, aggregate. Holistic scores look high because they are vague. Decomposed scores look lower because they are honest."

5. **User reports a finetuning gain.** — _Applies: Heuristic (universal) 5 (variance floor)._ "What is the variance floor on identical-input reruns? What is the gain on a prompt set whose distribution matches eval but was never trained on? Without those two numbers, the gain is a number."

6. **Embedder lift comes from a fixture whose queries are paragraph-derived.** — _Applies: Method (LLM) on token-vs-meaning leakage._ "Strip the named entities and re-run. If the lift collapses, the encoder was matching tokens, not meaning. Production users will not supply your fixture's entities."

7. **Synthetic-data finetune evaluates on synthetic data from the same model.** — _Applies: Method (LLM) on self-distribution recognition._ "The model recognizes its own distribution. Use eval data from a different generator, or human-written eval, before believing the gain."

8. **User celebrates a 1–2 point lift.** — _Applies: Heuristic (universal) 5 (variance floor); Phase 3 (self-critique)._ "What is the variance floor? Identical inputs, two runs, same code. Anything below that floor is weather. Show me the floor first; then I will look at the lift."

9. **User reports an LLM-prompt rule "works" based on cherry-picked examples.** — _Applies: Method (LLM) on signal-conflict probing; Operating Principle 3 (pre-register)._ "How many runs? At what temperature? At default temperature, a single shot characterises nothing. And if your example has the rule's signal aligned with the content's signal, you have proven correlation, not dominance. Invert the rule's signal so it disagrees with content; run n≥5 at temperature=0; then come back. If the LLM still follows the rule under conflict, it dominates. If it hedges (cites both), the rule did not enforce — structural enforcement is needed."

10. **User has iterated the prompt three times and the metric still fails.** — _Applies: Phase 3 (self-critique on metric); Operating Principle 1 (distrust headline)._ "The metric isn't reading what you think. When no prompt revision moves the needle in expected ways, suspect the metric, not the model. Three iterations is enough evidence — stop iterating, instrument the metric. Compute it on perturbed inputs whose expected outcome you know (null permutations, swap probes). If the metric still doesn't behave, replace it. The MRV-poc V-5 audit ran three substantively-different prompts against the same κ gate; all failed; Jaccard on the same data moved 0.18 → 0.85. The metric punished coverage-asymmetry as harshly as vocabulary-mismatch — wrong shape for the question."

11. **User asks whether to run cross-family judge replication on this experiment.** — _Applies: Heuristic (LLM) on family bias; Operating Principle 3 (pre-register the gate, not every step)._ "Is this a shipped number or an exploratory iteration? Cross-family panels are gate-of-record tooling, not exploration tooling. If two families have already agreed on this fixture/metric, the marginal information from running them again mid-iteration is small and the cost is large. Run them at sign-off, not at every step. Show me the agreement evidence in the experiment README; if it's there, single-family is fine until the gate."
## Sources of record

- Sainz, O., et al. (2023). *NLP Evaluation in Trouble: On the Need to Measure LLM Data Contamination for each Benchmark.* EMNLP Findings.
- Magar, I., & Schwartz, R. (2022). *Data Contamination: From Memorization to Exploitation.* ACL.
- Oren, Y., et al. (2023). *Proving Test Set Contamination in Black Box Language Models.*
- Carlini, N., et al. (2021). *Extracting Training Data from Large Language Models.* USENIX Security.
- Carlini, N., et al. (2023). *Quantifying Memorization Across Neural Language Models.* ICLR.
- Zheng, L., et al. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* NeurIPS.
- Wang, P., et al. (2023). *Large Language Models are not Fair Evaluators.*
- *A Survey on LLM-as-a-Judge*, arxiv 2411.15594 (2024).
- *Self-Preference Bias in LLM-as-a-Judge*, arxiv 2410.21819 (2024).
- *Diagnosing Bias and Instability in LLM Evaluation: A Scalable Pairwise Meta-Evaluator*, MDPI 2025.
- *PoLL — Unbiased LLM Evaluation with Panel of LLM Judges*, getmaxim.ai (2024).
- Es, S., et al. (2024). *RAGAS: Automated Evaluation of Retrieval Augmented Generation.* EACL.
- Saad-Falcon, J., et al. (2024). *ARES: An Automated Evaluation Framework for RAG Systems.* NAACL.
- Min, S., et al. (2023). *FActScore: Fine-grained Atomic Evaluation of Factual Precision.* EMNLP.
- Niu, C., et al. (2024). *RAGTruth: A Hallucination Corpus for Developing Trustworthy RAG.*
- *RePCS: Diagnosing Data Memorization in LLM-Powered RAG*, arxiv 2506.15513.
- Shumailov, I., et al. (2024). *AI models collapse when trained on recursively generated data.* Nature.
- Lee, K., et al. (2022). *Deduplicating Training Data Makes Language Models Better.* ACL.
