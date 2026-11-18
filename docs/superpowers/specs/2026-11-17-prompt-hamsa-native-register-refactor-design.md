# prompt-hamsa — native-register refactor (short design)

**Date:** 2026-11-17 · **Size:** small change · **Status:** awaiting approval

## Intent

The operator's experience with current frontier models: they are fluent with the
filesystem, bash and tool use, and capable enough that a short prompt built on one
coherent abstraction beats a long, enumerated one. A good rewrite reads like the kind
of text the model was trained on and lets it pull detail from files and tools instead
of inlining it. Hamsa should teach this, and Hamsa's own `SKILL.md` (23,038 B, 171
lines) should practise it.

## Goals

- Add the native-register principle to Hamsa's doctrine.
- Rewrite `buddy/skills/prompt-hamsa/SKILL.md` in that register: target ~8–10 KB.
- Move the long evidence bodies (H10–H12 corollaries, `codescout:A-*` citations,
  Principle 6 validation history) to `buddy/skills/prompt-hamsa/references/evidence.md`,
  with one pointer per heuristic.
- Reword the rules that push toward over-specification (Phase 1 step 2 "mark every
  term", Principle 4 "pin the contract") so they pin only what the model cannot infer
  or discover.

## Non-goals

- No change to the critique format's fields, the audit-log contract, or the
  `prompt-tdd` Harness section's substance.
- No change to other specialists, `skill-template.md`, or summon code.

## Anti-goals

- Losing any of the four eval markers: read-as-stranger gap, cut-before-add,
  pin-the-contract (output schema + escape hatch), UNVERIFIED / N=0.
- Abstraction so vague that the audit fields can no longer be filled.

## Constraints

- Keep these headings (prefix match): `## Voice`, `## Operating Principles`,
  `## Method`, `## Heuristics`, `## Reactions`, `## Self-Traps` — required by
  `buddy/scripts/summon_bootstrap.py` (advisor projection) and
  `buddy/data/skill-template.md`.
- Frontmatter `name` and `description` unchanged (activation).
- Skill edit is `committed`, not `live`, until `release.sh buddy` runs.

## Approaches

1. **Rewrite inside the same skeleton** — *picked.* Compact principles and
   one-line heuristics, evidence moved to `references/`, new principle added.
2. Surgical: move evidence, add principle, leave wording — rejected: Hamsa stays the
   over-detailed prompt the new principle warns against.
3. Free-form essay — rejected: breaks advisor projection and the template.

## Verification (H12: deletions must prove no regression)

- `prompt-tdd` from the `prompt-engineering` repo's environment, against
  `buddy/tests/prompt-hamsa-eval/prompt-tdd/prompt_tdd.yaml`:
  - old `SKILL.md`: both scenarios, skill arm (baseline);
  - new `SKILL.md`: both scenarios, skill arm; `--ablate` once.
- New scenario `refactor-over-detailed-agent-prompt`: an over-enumerated agent prompt
  that inlines what the agent could read from files. Rubric rewards a compact,
  abstraction-led rewrite that delegates detail to the filesystem/tools. Base arm
  (`--ablate`) first; if bare already passes, the scenario stays as a guard and is
  not claimed as evidence for the principle.
- `./tests/run-all.sh` and buddy pytest stay green.
- Record the audit in `prompt-hamsa-audit-log` with a prediction.

## Left to the builder

Exact wording; which heuristics merge; the evidence file's internal layout.
