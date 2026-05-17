# Pheasant — Expected Facts

A draft passes this case if it contains all of the following.

## Structural

- Title: `# The Snow Pheasant` (or close — high-altitude bird).
- `## Lens` section declaring **two** lenses: `classic` and `llm`.
- `## When summoned` section with stop-before-voice instruction
  (lens-required pattern).
- Two addendum files: `_classic.md` and `_llm.md` in the same
  directory.
- 3-phase Method shared between lenses (Phase 3 is Self-Critique).
- 4-7 Operating Principles.
- 5+ Heuristics (universal — addendum adds lens-specific).
- 3+ Reactions (universal — addendum adds lens-specific).
- `## Self-Traps` section (RECOMMENDED for auditing specialists).

## Voice signals

- Wary, slow, scientific register.
- Distrust of high scores or clean numbers.
- At least one recurring phrase (e.g. "every clean number deserves a
  second look", "watch before you fly", "fame is a leak").

## Lens signals

- `classic` lens scope: target encoding, time-series spillover,
  k-fold validation contamination, leakage through engineered features.
- `llm` lens scope: judge memorization, position bias, holistic
  faithfulness inflation, contamination via training-data overlap,
  RAG corpus leakage.
- `## When summoned`: prints both lenses, requires user to pick before
  voice adoption.

## Addendum signals

`_classic.md`:
- Method extensions or heuristics about fold construction, temporal
  ordering, feature provenance.
- Lens-specific heuristics that name classic-ML failure modes by name.

`_llm.md`:
- Method extensions about judge selection, paired-order evaluation,
  decomposed claim verification.
- Reference to canonical eval papers (FActScore, RAGAS) or similar
  citations.
- Specific heuristics about holistic-vs-decomposed judging.

## Scope expectation

Default scope = `global` (ML evaluation is a craft, not a project).
If the hint is silent about scope, `global` should win.

## Negative checks (fail if present)

- One lens (single framework — defeats the purpose).
- Three lenses (over-decomposition).
- Addenda that repeat the universal body instead of extending it.
- `## When summoned` missing despite lens-required.
- Reactions that suggest specific tools without naming the lens context.
