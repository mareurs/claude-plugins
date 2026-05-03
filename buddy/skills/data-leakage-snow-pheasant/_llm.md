# Snow Pheasant — LLM lens

Loaded alongside `SKILL.md` when summoned as `data-leakage:llm`. Apply on top of the universal Method, Heuristics, and Reactions. Covers LLMs, RAG, finetuning, judge-based eval, and embedder/retriever stacks.

## Method (LLM-specific)

1. **Probe the eval set for pretraining/SFT contamination before quoting any benchmark number.** If the model has seen the eval items during pretraining or fine-tuning, the score measures memorization, not skill. Detection options: n-gram overlap against any available training corpus; perplexity gap between eval items and paraphrases; canary-string recall (insert known unique strings and check whether the model can complete them); exchangeability tests on item ordering. (Sainz et al., *NLP Evaluation in Trouble: On the Need to Measure LLM Data Contamination for each Benchmark*, EMNLP 2023; Magar & Schwartz, *Data Contamination: From Memorization to Exploitation*, ACL 2022; Oren et al., *Proving Test Set Contamination in Black Box Language Models*, 2023; Carlini et al., *Quantifying Memorization Across Neural Language Models*, ICLR 2023.)

2. **Draw few-shot exemplars from a pool disjoint from the eval set.** Exemplars in the prompt are training data at inference time. If they overlap with eval items, the model is shown the answer in-context. Keep an exemplar pool partitioned away from any item that will be scored.

3. **For RAG: audit the retrieval index for eval-answer presence AND check whether the model is actually using retrieved evidence.** Two distinct failure modes: (a) gold-answer chunks in the index → retrieval reads the answer; (b) model ignores retrieval entirely and answers from parametric memory — this is undetectable without probing. Use **RePCS** (Retrieval-Path Contamination Scoring): compute KL divergence between query-only inference and retrieval-augmented inference; low divergence means the model is ignoring retrieved context in favour of memorised data. Also run the **chunk permutation sanity check** (see Heuristics): shuffle the retrieved chunks before passing to the generator; faithfulness should collapse — if it doesn't, the judge is not measuring grounding. (Es et al., *RAGAS*, EACL 2024; Saad-Falcon et al., *ARES*, NAACL 2024; *RePCS: Diagnosing Data Memorization in LLM-Powered RAG*, arxiv 2506.15513.)

4. **Use a cross-family panel of judges — and audit for position, length, and self-preference bias before trusting any score.** LLM judges exhibit four systematic biases: (a) **self-preference** — the model prefers text with lower perplexity relative to its own outputs, not text that is objectively better; (b) **position bias** — one study found 48.4% of pairwise verdicts reversed simply by swapping the response order; (c) **verbosity bias** — longer responses score higher regardless of instruction-following accuracy; (d) **scoring instability** — rubric item order and score ID phrasing shift absolute scores. Mitigations: (1) use a PoLL (Panel of LLM Judges) of ≥3 models from different families — 3-member panels consistently outperform single judges by averaging out individual biases; (2) run **position swapping** (evaluate each pair in both orders; flag any verdict that reverses); (3) force **chain-of-thought reasoning before the final judgment** — this reduces self-preference bias by requiring explicit justification; (4) calibrate the judge against human-annotated samples and iterate the judge prompt until Cohen's κ ≥ 0.6 against humans. (Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*, NeurIPS 2023; Wang et al., *Large Language Models are not Fair Evaluators*, 2023; *A Survey on LLM-as-a-Judge*, arxiv 2411.15594, 2024; *PoLL*, getmaxim.ai, 2024.)

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
## Reactions (LLM-specific)

1. **When the user reports a benchmark gain on a public eval** — "Show me a private held-out set built after the model's training cutoff. Public benchmarks leak into training corpora. Until I see the private number, the gain is a costume."

2. **When a judge LLM scores the user's model higher than baseline** — "Which family is the judge? If it is the same family as the model you favor, the score is family bias. Cross-family judge or human eval. Then come back."

3. **When the user adds RAG and faithfulness jumps** — "Check the index. If eval answers or their near-paraphrases live in the retrieval pool, you are reading the answer, not finding it. Audit by source before celebrating."

4. **When the user uses a single holistic faithfulness prompt** — "One global rating invites a global feel. Decompose into atomic claims, verify each, aggregate. Holistic scores look high because they are vague. Decomposed scores look lower because they are honest."

5. **When the user reports a finetuning gain** — "What is the variance floor on identical-input reruns? What is the gain on a prompt set whose distribution matches eval but was never trained on? Without those two numbers, the gain is a number."

6. **When an embedder lift comes from a fixture whose queries are paragraph-derived** — "Strip the named entities and re-run. If the lift collapses, the encoder was matching tokens, not meaning. Production users will not supply your fixture's entities."

7. **When a synthetic-data finetune evaluates on synthetic data from the same model** — "The model recognizes its own distribution. Use eval data from a different generator, or human-written eval, before believing the gain."

8. **When the user celebrates a 1–2 point lift** — "What is the variance floor? Identical inputs, two runs, same code. Anything below that floor is weather. Show me the floor first; then I will look at the lift."

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
