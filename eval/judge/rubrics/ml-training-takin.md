# Rubric — ml-training-takin

Grounding for the rubric criteria in `eval/fixtures/ml-training-takin/case-*.yaml`.
The judge uses this file (substituted into the judge prompt as
`{{specialist_method_reference}}`) to score consistently across cases.

## Specialist surface — Method / Heuristic / Reaction reference

Restated from `buddy/skills/ml-training-takin/SKILL.md` for the judge's grounding.

### Method (8 items)

- **M1.** Overfit a tiny slice first — prove the model can memorize a batch of
  8–32 examples before any scaling.
- **M2.** Sweep the learning rate, do not guess — short LR-range test (1e-7 to 1)
  reveals the steepest descent region and divergence point.
- **M3.** Watch the ratio, not just the loss — track grad-norm / param-norm per
  layer; healthy ≈ 1e-3 to 1e-2.
- **M4.** Fix seeds, log everything, diff runs — every run logs seed, data hash,
  config, git SHA, deps, hardware.
- **M5.** Separate the three failure modes — optimization (can't fit train),
  generalization (fits train, fails val), pipeline (fits both, predicts wrong
  at inference).
- **M6.** Enforce train/inference parity explicitly — preprocessing, tokenization,
  normalization, padding, dtype must be byte-identical.
- **M7.** Quantize and distill with a held-out comparison suite — never ship on
  aggregate metric; compare student head-to-head against teacher on ~200 hard
  and edge examples.
- **M8.** Stop training when validation curve says so — early stopping, not
  epoch count.

### Heuristics (8 items)

- **H1.** Loss is NaN → suspect numerics (log of zero, fp16 overflow, bad sample).
- **H2.** Loss plateaus immediately → suspect dead loop (zero grads, frozen params,
  detached graph, saturation).
- **H3.** Training loss drops but val loss rises instantly → suspect leakage or
  broken val set.
- **H4.** Notebook great, production wrong → suspect preprocessing drift
  (tokenizer version, normalization constants, encoding maps).
- **H5.** fp16 works but bf16 does not (or vice versa) → suspect range vs precision.
- **H6.** Throughput half of expected → suspect input pipeline (GPU is waiting).
- **H7.** Distributed diverges but single-GPU does not → suspect gradient sync
  or batch-norm.
- **H8.** LoRA underperforms full FT "slightly" → suspect LR too low (adapters
  want 5–10× higher LR).

### Reactions (5 items)

- **R1.** "Loss is going up" → ask for curve shape and grad norm, not the number.
- **R2.** Bigger model proposal → prove the small model is full first
  (overfit-tiny test).
- **R3.** "Training worked but production is worse" → train-serve skew, parity test.
- **R4.** Tuning HP on the test set → forbid; this is leakage by the side door.
- **R5.** "Quantized model, aggregate metric is fine" → aggregates are kind;
  build hard-case suite; teacher-vs-student head-to-head.

## Per-criterion grounding

The judge consults this section when scoring each rubric criterion. Citation by
Method/Heuristic/Reaction ID is sufficient evidence for a `references_*`
meta-criterion.

### case-01 — pre-train plateau

| Criterion | Grounded in | Score-1 evidence pattern |
|---|---|---|
| `asks_for_loss_curve_shape_or_grad_norm` | M3, R1 | Response explicitly asks for the curve shape (descending, flat, climbing) or for grad-norm tracking. |
| `suggests_overfit_tiny_batch_before_scaling` | M1, R2 | Response names overfitting a small batch (8–32 examples to near-zero loss) before considering a larger model. |
| `suggests_lr_sweep_or_range_test` | M2 | Response names an LR-range test or LR sweep (any phrasing — "LR finder", "range test", "1e-7 to 1"). |
| `avoids_recommending_bigger_model_immediately` | R2 | Response declines the bigger-model leap, OR conditions it on first proving the small model is full. |
| `avoids_skipping_diagnostic_for_action` | M1 | Response demands a diagnostic before any change; does not jump straight to "tune X". |

_Note: the meta-criterion `references_at_least_one_method_step_or_heuristic` was dropped 2026-05-15. Judge disagreement on citation-vs-paraphrase made it the largest single contributor to variance floor (0.333 → 0.200 after drop). The above content-specific criteria already test grounding by content; the meta-check was redundant._
### case-02 — train-serve skew

| Criterion | Grounded in | Score-1 evidence pattern |
|---|---|---|
| `names_train_serve_skew_or_preprocessing_drift` | H4, R3, M6 | Response names "train-serve skew", "train-inference skew", or "preprocessing drift" explicitly. |
| `suggests_byte_identical_parity_test` | M6 | Response names a parity test that compares the tensor at the model's input boundary across the two paths (notebook vs API), with the phrase "byte-identical" or equivalent strict-equality language. |
| `asks_about_tokenizer_or_normalization_or_preprocessing` | H4 | Response names tokenizer version, normalization constants, encoding maps, image resize, or audio resample as drift sources. |
| `avoids_blaming_model_or_recommending_retraining` | R3 | Response does not propose retraining, more data, or hyperparameter tuning as the first action. |

_Note: the meta-criterion `references_method_6_or_heuristic_4` was dropped 2026-05-15 for the same reason as case-01._
### case-03 — post-quantize aggregate-OK

| Criterion | Grounded in | Score-1 evidence pattern |
|---|---|---|
| `rejects_aggregate_only_acceptance` | R5 | Response explicitly rejects "aggregate metric is fine, ship it"; phrases like "aggregates are kind" or "0.7pp on aggregate is not the full picture". |
| `suggests_hard_case_or_tail_suite` | M7, R5 | Response names a hard-case suite, edge-case suite, tail suite, or ~200-example targeted set. |
| `mentions_teacher_vs_student_head_to_head_comparison` | M7 | Response names a sample-by-sample comparison between teacher (pre-quant) and student (post-quant). |
| `mentions_failures_cluster_on_tails` | R5 | Response uses the phrase "tails", "tail of the distribution", "rare cases", or "edge cases cluster" to argue why aggregate masks regressions. |

_Note: the meta-criterion `references_method_7_or_reaction_5` was dropped 2026-05-15 for the same reason as case-01._
## Notes for judge calibration

- These criteria are **observable in the response**, not in the prompt. If the
  user_message already names a concept (e.g. "preprocessing drift"), the response
  must still independently invoke it to score 1.
- Citation-by-number (e.g. "see Method 6") and citation-by-bolded-title (e.g.
  "**Enforce train/inference parity explicitly**") both count as references.
  Generic paraphrase ("you should make training and inference match") does NOT
  count unless it uses takin-specific phrasing.
- "avoids_X: true" → 1 when the response demonstrably did not do X. The judge
  must be able to point at either an explicit refusal or a substantive
  alternative action. Silence on X does not earn the point.
