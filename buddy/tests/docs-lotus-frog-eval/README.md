# docs-lotus-frog-eval

prompt-tdd benchmark for the **docs-lotus-frog** skill (`buddy:docs-lotus-frog` —
"Technical writing, documentation architecture").

## What this tests

Does the skill's content change the model's observable output versus a bare model
that lacks it, on the skill's core task: **structuring documentation for a
feature**? The Frog has a distinctive documentation-architecture method; this
eval checks whether that method shows up in the output, not whether the prose is
generically nice.

## The discriminating marker

The Frog's fingerprint — the markers that appear in output ONLY if the skill
fired, drawn from its Operating Principles, three-phase Method, and the **Doc
Format** scaffold (`Reader / Location / Summary / Why-this-shape / Stale-when /
Confidence`):

- **Named reader** — one explicitly named primary audience (API user / operator /
  contributor / evaluator), not "everyone."
- **Stale-when trigger** — a concrete invalidation condition (a file, behavior,
  default value, or version) that would make the doc wrong. This is the single
  most discriminating marker: a competent bare model almost never volunteers an
  invalidation trigger.
- **Why over what** — the load-bearing content is the constraint/tradeoff
  (full-jitter vs. thundering herd; deliberate no-retry-on-4xx), not a prose
  restatement of the code.
- **Placement on the reader's path** — docstring / README section / ADR, with a
  reason for the choice.
- **No doc-everything reflex** — declines to document a trivially self-explanatory
  private helper instead of dutifully restating the code.

Two scenarios, both `mode: judge` (the markers are method-shaped, not literal
strings; substring matching cannot distinguish skill-structured docs from
competent default prose):

| scenario | side | what a pass means |
|---|---|---|
| `structure-feature-doc` | positive | hits >=4 of the 5 markers, INCLUDING named-reader and stale-when |
| `decline-doc-everything` | precision / clean | resists documenting a self-explanatory private helper on method grounds |

## Activation assumption

The skill is copied into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`, but
it auto-fires only if the task matches its description ("Technical writing,
documentation architecture"). Both scenario messages are phrased squarely in that
domain — "structure the documentation for this feature" / "add a docstring … so
our docs are complete" — so a session WITH the skill should reliably invoke it.
The `--ablate` arm sends the SAME messages with the skill files removed. **Phase B
validates this assumption**: if the no-skill arm already satisfies the rubric, the
skill is tautological for this task (a valid result for a competence archetype),
and the delta will be near zero.

Expected power: **likely tautological / partial.** A capable bare model writes
readable, progressively-disclosed docs unprompted, so markers (b)/(c)/(d) carry
little delta. The honest discriminators are the **named reader** (a) and the
**stale-when trigger** (e), and the **doc-everything refusal** in the precision
scenario — those are where any real teeth live. We wrote the honest rubric and
let the delta fall where it falls; we did not inflate it to manufacture a gap.

## Fidelity caveat

This tests the `SKILL.md` payload as a **loaded skill** — NOT the full
`/buddy:summon docs-lotus-frog` injection (memories, gates, memory-protocol).
The power measured here is the **skill-content floor**: the right unit for "does
the writing have teeth," but a lower bound on the summoned specialist's behavior.
The skill has no `_<lens>.md` addenda — `SKILL.md` is the entire payload.

## Phase B — how to run it

From this directory:

```bash
# WITH the skill — expect PASS (both scenarios clear threshold)
prompt-tdd run prompt_tdd.yaml

# WITHOUT the skill (negative control) — expect FAIL == the skill has power.
# If this also PASSES, the skill is tautological for this task (a valid result).
prompt-tdd run prompt_tdd.yaml --ablate
```

A real `A` PASS together with an `--ablate` FAIL is the signal that the skill's
content — not the base model's default competence — produced the doc architecture.
