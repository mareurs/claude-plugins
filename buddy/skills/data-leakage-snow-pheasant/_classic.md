# Snow Pheasant — Classic ML lens

Loaded alongside `SKILL.md` when summoned as `data-leakage:classic`. Apply on top of the universal Method, Heuristics, and Reactions.

## Method (classic-ML-specific)

1. **Draw the split along the causal axis, not at random.** If predictions will be made forward in time, split by time — use chronological (train → validate → test) or **walk-forward (rolling-window)** validation, never random shuffle. If predictions generalize across users / sessions / accounts, split by that group (`GroupKFold`, not `KFold`). Random splits across a correlated unit leak identity. Ask: "what would an adversary exploit if I split naively here?" (Kaufman, Rosset, Perlich, Stitelman, *Leakage in Data Mining: Formulation, Detection, and Avoidance*, KDD 2012; *Hidden Leaks in Time Series Forecasting*, arxiv 2512.06932, 2024.)

2. **Fit transforms on train only — `Pipeline`, not pre-computed features.** Scalers, imputers, encoders, PCA, feature selection, target/mean encoders — every one of these leaks if fitted on the full dataset before splitting. Wrap in `sklearn.pipeline.Pipeline` so cross-validation refits per fold. Pre-computing "for convenience" is the most common leak in production notebooks.

3. **Resample after splitting, never before.** SMOTE, oversampling, undersampling, class weighting via duplication — all must happen inside the CV loop on the train fold only. Resampling before the split places synthetic neighbors of test points into training. (Chawla et al., *SMOTE*, 2002 — original paper does not specify; the leakage pattern is widespread in Kaggle/StackOverflow practice and called out repeatedly by sklearn maintainers.)

4. **Target/mean encoding requires out-of-fold (OOF) computation.** Replace a categorical with the per-category target mean and you have leaked the label into the feature unless the encoding is computed on a fold disjoint from the row being encoded. Use `category_encoders.TargetEncoder` with CV, or hand-roll OOF.

5. **Audit temporal joins for look-ahead.** Joining feature tables that aggregate up to or past the label's timestamp is a silent leak. Every join key needs a time bound: "as of T, compute X" — not "compute X over the full history including post-label rows." Feature stores (Feast, Tecton) make this explicit; ad-hoc joins in pandas usually do not.

6. **Match every feature's freshness SLA to the prediction horizon.** A feature available at training with full future context may arrive minutes, hours, or days late at inference — or never. List every feature with its production latency. If any latency exceeds the prediction horizon, the model will not see that feature when it matters. (Google, *Rules of Machine Learning*, Zinkevich; Polyzotis et al., *Data Validation for Machine Learning*, KDD 2019.)

7. **Permute labels — preserve group structure; account for feature correlations.** When running the null/permutation test from the universal Method, permute *within* groups for grouped data (e.g. shuffle labels within users), not across the full dataset. A naive label shuffle breaks group leakage detection. Also: if features are highly correlated, standard Permutation Feature Importance (PFI) is misleading — shuffling a correlated feature creates out-of-manifold points with unreliable importance scores. Use **Conditional Variable Permutation Feature Importance (CVPFI)**, which samples from conditional distributions rather than marginals. (Demšar, *Statistical Comparisons of Classifiers over Multiple Data Sets*, JMLR 2006; *Conditional Variable Importance for Random Forests*, 2022–2023 literature.)

## Heuristics (classic-ML-specific)

1. **Cross-validation scores varying wildly across folds → suspect grouping.** Random CV on grouped data produces folds that differ by which groups they contain. Switch to group-aware CV and the variance usually shrinks.

2. **Surprisingly good rare-class precision → suspect label contamination.** Rare-class precision of 0.99 on a real-world task is almost always a bug. Check whether the rare label's production uses any feature the model also uses (a downstream system's label informed by a feature the model sees).

3. **Permuted-label accuracy still beats majority-class baseline → leakage in split structure.** If shuffling y leaves accuracy meaningfully above the prior, the model is finding signal in *which fold a row landed in* — usually a group leak or a deduplication failure. (Kapoor & Narayanan, *Leakage and the Reproducibility Crisis in ML-based Science*, Patterns 2023.)

4. **A feature whose addition jumps the metric by more than a few points → audit its derivation line by line.** Aggregates, ratios, anything derived from neighbors of the target row. Most of these are post-event values dressed as pre-event features.

5. **Test set drifted from production → re-sample a small fresh slice and compare distributions.** A frozen test set ages. Covariate shift is silent: the metric still looks fine; the predictions in production are wrong.

6. **`pd.get_dummies` outside the pipeline → category set leaked from full data.** Categories present in test but not train get silently encoded as zero-vectors when fit on full data; categories present in train but not test inflate dimensionality. Use `OneHotEncoder(handle_unknown="ignore")` inside a `Pipeline`.

## Reactions (classic-ML-specific)

1. **When the user proposes a random train/test split on user-level data** — "Stop. Random split bleeds identity across folds. If the same user appears in train and test, the model memorizes users, not behavior. Split by user, or by time — whichever matches what prediction actually means here."

2. **When the user adds a feature and the metric jumps** — "A feature that moves the metric by that much is either a brilliant signal or a leak. Usually a leak. Tell me how that feature is computed, and *when*, relative to the label's timestamp. If it can see past the label, it is leaking."

3. **When the user pre-computes features then splits** — "Refit per fold or accept that the score is optimistic. Every transform that touched the full dataset has bled validation distribution into training. The fix is `Pipeline`, not vigilance."

4. **When the user mentions SMOTE** — "Where does it run — inside the CV loop, or once on the full dataset? If it ran once, the synthetic neighbors of test points are in training, and the lift is not real."

5. **When the user asks whether time-based or group-based splitting matters** — "It matters when the unit at inference is a future row from a group already partly in training. If yes, group split. If predictions are forward in time, time split. If both, both — nested."

## Sources of record

- Kaufman, S., Rosset, S., Perlich, C., & Stitelman, O. (2012). *Leakage in Data Mining: Formulation, Detection, and Avoidance.* KDD.
- Kapoor, S., & Narayanan, A. (2023). *Leakage and the Reproducibility Crisis in ML-based Science.* Patterns.
- Roelofs, R., et al. (2019). *A Meta-Analysis of Overfitting in Machine Learning.* NeurIPS.
- Recht, B., et al. (2018). *Do CIFAR-10 Classifiers Generalize to CIFAR-10?*
- Polyzotis, N., et al. (2019). *Data Validation for Machine Learning.* KDD.
- Zinkevich, M. *Rules of Machine Learning: Best Practices for ML Engineering* (Google).
- Demšar, J. (2006). *Statistical Comparisons of Classifiers over Multiple Data Sets.* JMLR.
- scikit-learn `Pipeline` and `GroupKFold` documentation (canonical reference for fit-on-train-only discipline).
- *Hidden Leaks in Time Series Forecasting: How Data Leakage Affects LSTM Evaluation*, arxiv 2512.06932 (2024).
- *Impact of Sampling Techniques and Data Leakage on XGBoost Performance in Credit Card Fraud Detection*, arxiv 2412.07437 (2024). (Confirms: pre-split SMOTE inflates metrics vs post-split.)
