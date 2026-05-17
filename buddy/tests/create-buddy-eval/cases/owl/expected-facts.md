# Owl — Expected Facts

A draft passes this case if it contains all of the following.

## Structural

- Title: `# The Snow Owl` (or close — high-altitude silent-bird
  archetype).
- `## Lens` section declaring **two** lenses: `output` and `compliance`.
- `## When summoned` section with stop-before-voice instruction.
- Two addendum files: `_output.md` and `_compliance.md`.
- 3-phase Method (Locate → Compare → Self-Critique).
- 4-5 Operating Principles.
- `## Witness Report Format` (or equivalent structured output schema).
- `## Self-Traps` section.
- `## Memory Cadence` section (Owl-specific: two-strike +
  cross-lens correlation save criterion).

## Voice signals

- Silent / low-light / declarative.
- Refuses to praise or condemn — only discriminates.
- At least one recurring phrase (e.g. "I have seen this shape before",
  "the gap has a shape — let me name it", "claim and evidence side
  by side").

## Lens signals

- `output` lens: chunk_id liveness, candidate_pool triangulation,
  fidelity to source_chunks, hallucination detection.
- `compliance` lens: VCS v4.4 sub-clause coverage, dates / methods /
  outcomes / signatories presence checks, blocking-absence flagging.
- `## When summoned`: prints both lenses, requires user to pick before
  voice adoption.

## Operating Principles signals

At least 3 of:

1. Cite the chunk_id or the VCS paragraph — always.
2. Hold claim and evidence side by side; do not paraphrase either.
3. No verdict without a per-claim table.
4. Reviewer, not writer — yields to Hamsa for rewrite.
5. Ask before chasing — yields to Pheasant for retrieval audit.

## Yields-to signals

Explicit mentions in either Operating Principles or Reactions:
- Yields to **Hamsa** for prompt/text rewrite.
- Yields to **Pheasant** for retrieval / corpus debugging.

## Scope expectation — THE CRITICAL ONE

**The hint explicitly says "MRV-poc project."** A passing draft MUST
recognize this as a project-specific domain signal and:

1. Ask scope (do not default silently).
2. When the user confirms project-scoped, write to
   `<cwd>/.buddy/skills/snow-owl/` (or similar dir name), NOT to
   builtin or global.

The original Owl was misfiled to claude-plugins builtin
(`buddy/skills/mrv-reviewer/`) because no scope question existed.
It has since been moved to its correct home at
`/home/marius/work/stefanini/southpole/MRV-poc/.buddy/skills/snow-owl/`. This case calibrates whether the
new command would have prevented the misfile.

**If the draft defaults to `global` or `builtin` without asking, the
Scope Correctness dimension scores 0.** No partial credit on this one.

## Negative checks (fail if present)

- One lens, three lenses, or asymmetric addenda.
- Drafts replacement section text (writer behavior — violates
  Reviewer-not-Writer principle).
- Missing `## Memory Cadence` (Owl's distinctive section).
- Missing yields-to mentions (Hamsa, Pheasant).
- Builtin or silent-global scope without asking the user.
