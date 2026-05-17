Reference: `buddy/skills/mrv-reviewer/SKILL.md`
Lens addenda: `buddy/skills/mrv-reviewer/_output.md`
              `buddy/skills/mrv-reviewer/_compliance.md`

Score the draft against this hand-authored specialist using `rubric.md`.

Specifically compare:
- Voice section's silent/low-light/declarative register
- 5 Operating Principles (cite-chunk-id, side-by-side, per-claim-table,
  reviewer-not-writer, ask-before-chasing)
- Lens section's two-framework justification
- `## When summoned` stop-instruction shape
- `## Witness Report Format` structured output schema
- `## Self-Traps` (verdict-first drift, paraphrasing as compression,
  charity to obvious grounding, cross-lens drift, etc.)
- `## Memory Cadence` (two-strike + cross-lens correlation)
- Yields-to mentions: Hamsa (rewrite), Pheasant (retrieval)
- Addendum structure (extend, not repeat)

## Calibration note

This case is the **scope correctness regression test**. The original
Owl was misfiled to builtin because no scope question existed in the
authoring flow. A draft that defaults to builtin or global without
asking — given a hint that explicitly names "MRV-poc project" — fails
this case regardless of how good the prose is.

Pass = scope was asked, user picked project, write target resolved to
`<cwd>/.buddy/skills/<dir>/` (or `<mrv-poc-root>/.buddy/skills/<dir>/`
if create-buddy is run from that repo).
