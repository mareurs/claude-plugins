---
kind: entry
status: held
title: 'A-5: buddy/skills/prompt-hamsa/SKILL.md (Hamsa auditing itself); commits 4f4ec77, a4f71e0, 36d73e5.'
closed: 2026-11-25
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
- '2026-11-25 open -> held codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from `docs/trackers/prompt-hamsa-audit-log.md` (`params.audits` row 23, id `A-5`) on 2026-11-25; audited 2026-11-17.

**Artifact:** buddy/skills/prompt-hamsa/SKILL.md (Hamsa auditing itself); commits 4f4ec77, a4f71e0, 36d73e5.

**Symptom:** Requested change, not a failure: the operator reports that current frontier models are fluent with the filesystem, a shell and tools, and do better on a short prompt built on one coherent abstraction, shaped like text they were trained on, than on a long, enumerated one. Hamsa's own SKILL.md (23,038 B, 171 lines; H10-H12 each a paragraph of evidence) was that long, enumerated kind.

**Gap:** Read as a stranger: Hamsa taught 'cut toward completeness' but its Phase 1 step 2 ('mark every term whose meaning is not pinned down') and Principle 4 ('pin the contract') pushed toward over-specification, with no rule against inlining what an agent can read or scripting steps it can plan. Its evidence bodies sat in the always-loaded core.

**Move:** Native-register rewrite inside the same skeleton: new Principle 7 (native register), H13 (step scripts are cut candidates), Reaction 7, Self-Trap 9; Phase 1 step 2 and Principle 4 now pin only what the model cannot infer or discover. Evidence (H9-H12, P6, harness routing) moved verbatim to references/evidence.md. 23,038 B -> 10,837 B. Numbers 1-N of every list unchanged. New prompt-tdd scenario refactor-over-detailed-agent-prompt.

**Prediction:** Deletion burden (H12): both existing scenarios hold on the new file, and resist-adding-to-tight-prompt keeps its power. The new scenario passes on treatment; if it also passes on control, it is a guard only and no evidence that Principle 7 changes behaviour.

**Eval status:** present(n=3 per arm; prompt-tdd; Sonnet 5.5 subject; plugin-free profile; old --paired, new treatment only)

**Confidence:** medium

## Record

## A-5 — Hamsa's own prompt, rewritten in the native register: the 53% cut held, and the new principle's effect is unmeasured

**Valid:** dated 2026-11-17

**Symptom.** The operator's experience: capable tool-using models do better on a short brief built on one coherent abstraction than on an enumerated procedure. Hamsa's own `SKILL.md` was the enumerated kind (23,038 B).

**Move.** Rewrite in the native register, same headings and numbering, evidence to `buddy/skills/prompt-hamsa/references/evidence.md`. 10,837 B. Structural guard: `tests/test-prompt-hamsa-split.sh`.

**Outcome — held.** n=3 per arm, Sonnet 5.5. Old file: `critique-weak-prompt` and the new `refactor-over-detailed-agent-prompt` pass on the bare control too (tautological); `resist-adding-to-tight-prompt` has power (3/3 vs 0/3). New file: all three pass, and all 9 transcripts loaded the new text. The deletion regressed nothing these scenarios measure. Principle 7 is not shown to change behaviour: the bare model already writes the compact rewrite. A stimulus that discriminates — a bare model that keeps the step script or inlines the layout — is still to be found. Results: `buddy/tests/prompt-hamsa-eval/prompt-tdd/RESULTS-2026-11-17.md`.

**Eval-tool finding.** The first baseline ran in a profile with no credential; every session replied `Not logged in · Please run /login`, and prompt-tdd scored the round "no-effect", not "invalid".

## Closed

Outcome `held` carried over from `params.audits` of the flat tracker, set before the move on 2026-11-25.
