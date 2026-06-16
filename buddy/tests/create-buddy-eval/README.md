# `/buddy:create` Evaluation Set

Reference cases for evaluating the `/buddy:create` command against
known-good hand-authored specialists. Per Hamsa's eval requirement
(no improvement without graded examples), this set is the precondition
for shipping the command — and the regression test for future template
or command changes.

## How to run

The eval is **human-driven** for v1 (no automated scoring). Three passes — a
bare-model floor, then template-only, then command-driven:

### Pass 0 — bare-model floor (negative control)

Pass A controls for the *command* (template-only vs command-driven). It does NOT
control for the *template + rubric themselves*: if a capable model scores ≥ 12/15
from the bare hint alone — no template, no command — then on those dimensions the
rubric is measuring general writing competence, not specialist craft, and a pass
says nothing about create-buddy. Pass 0 establishes that floor.

For each case:

1. Read `cases/<name>/hint.txt` — the only input.
2. Spawn a **fresh subagent given ONLY the hint** — NOT the template, NOT the
   command — with the anti-memorization tripwires below. The whole prompt is, in
   effect: "Write a SKILL.md for this specialist." Nothing else.
3. Score the draft on `rubric.md` exactly as for A/B.
4. Record in `runs/<date>-pass-0.md`.

Read the per-dimension deltas across the three arms:

- **Pass A − Pass 0** = what the *template* contributes.
- **Pass B − Pass A** = what the *command* contributes.
- A dimension where **Pass 0 ≈ Pass A ≈ Pass B** is base competence — the rubric
  is not measuring the apparatus there, so treat that dimension's pass as
  uninformative about create-buddy. Expectation to test, not assume: dims 2
  (sections), 4 (lens), 5 (scope) should need the template/command (low Pass 0);
  dims 1 (voice), 3 (heuristics) may already float high on Pass 0.

**Run Pass 0 against the isolated `~/.claude-test` profile** (no buddy plugin, no
MCP) so the bare model genuinely lacks the 12 builtin specialists — the same
isolation prompt-tdd uses for its negative control. Without it, the installed
buddy plugin leaks the builtins into context and the "bare" floor is fake (the
plugin-load confound — see prompt-engineering `docs/trackers/skill-eval-playbook.md`).
### Pass A — template correctness (no command yet)

For each case:

1. Read `cases/<name>/hint.txt` — that is the input.
2. Spawn a **fresh subagent** with no session memory of existing
   specialists, using the hardened prompt below. Do not draft yourself
   in a session that has already read any builtin SKILL.md — your
   recall will inflate the voice score.
3. Subagent reads `buddy/data/skill-template.md` and produces a draft
   from the template alone.
4. Compare the draft against `cases/<name>/reference-skill.md` (the
   actual hand-authored specialist).
5. Score using `rubric.md` (5 dimensions × 3 cases = 15 scores).
6. Record results in `runs/<date>-pass-a.md`.

**Pass bar:** total ≥ 12/15 per case, no individual dimension < 2.

If Pass A fails, the **template** is the bug. Fix `skill-template.md`,
re-run.

#### Hardened subagent prompt (anti-memorization)

LLM drafters trained on this repo's content will tend to recall exact
catchphrases and citations from existing specialists, producing
"perfect-score" drafts that test recall rather than the template.
Calibration from the yeti pass: without explicit tripwires, the
draft converged on the reference's verbatim opening phrase. The
hardened pheasant prompt fixed it.

Use this scaffold for every Pass A subagent invocation:

```
You are drafting a SKILL.md for a "buddy" specialist using ONLY the
canonical template. This is an evaluation — your draft will be scored
against a hand-authored reference you must NOT read.

INPUTS:
- buddy/tests/create-buddy-eval/cases/<name>/hint.txt
- buddy/data/skill-template.md

FORBIDDEN:
- buddy/skills/**       (the 12 builtin specialists)
- buddy/tests/create-buddy-eval/cases/<name>/expected-facts.md
- buddy/tests/create-buddy-eval/cases/<name>/reference-skill.md
- Codebase searches for keywords related to the target specialist

ANTI-MEMORIZATION TRIPWIRES:
Your training data almost certainly contains earlier versions of
similar specialists. If you find yourself reaching for any of these
patterns, STOP and derive from template instead:
- Catchphrases (e.g. "the mountain waits", "fame is a leak",
  "every clean number deserves a second look")
- Specific archetype-name combos used by existing specialists
- Verbatim section names not in the canonical template
- Specific citations (e.g. "FActScore EMNLP 2023", "RAGAS EACL 2024")

Honest drafts that miss reference catchphrases are MORE valuable than
high-recall drafts. The goal is to test the template, not your memory.

OUTPUT: SKILL.md only as markdown text. No commentary. For
lens-required specialists, also output `_<lens>.md` addenda separated
by `=== filename ===` headers.
```

Augment this with case-specific minimum-section requirements (lens
required? Self-Traps recommended? etc.) per the template's section
spec.
### Pass B — command correctness (after `/buddy:create` exists)

For each case:

1. In a clean session, run `/buddy:create <hint.txt contents>`.
2. Let the command drive the model through the brainstorm + draft
   phases.
3. Capture the resulting SKILL.md before the model writes it (use the
   preview step from Phase 4).
4. Score using `rubric.md`.
5. Record results in `runs/<date>-pass-b.md`.

**Pass bar:** same as Pass A.

If Pass B fails *and* Pass A passed, the **command** is the bug. The
template was sufficient for a human; the command's prompt failed to
elicit the same. Fix `commands/create.md`, re-run.

## Why these three cases

| Case | Tests |
|---|---|
| **yeti** | Simplest shape (no lens, conversational output). Floor of complexity — if create-buddy can't reproduce Yeti, it can't reproduce anything. |
| **pheasant** | Required lens + two cognitive frameworks. Tests lens elicitation and addenda generation. Stress test for the conditional sections. |
| **owl** | Recent + well-documented misfile. Tests whether the scope question (Phase 1) would have caught the original mistake of writing this as a builtin instead of project-scoped. |

## File layout

```
create-buddy-eval/
  README.md                    — this file
  rubric.md                    — 5-dimension scoring rubric + pass bar
  cases/
    yeti/
      hint.txt                 — input hint for /buddy:create
      expected-facts.md        — non-negotiable facts the draft must contain
      reference-skill.md       — path pointer to hand-authored SKILL.md
    pheasant/
      hint.txt
      expected-facts.md
      reference-skill.md
    owl/
      hint.txt
      expected-facts.md
      reference-skill.md
  runs/                        — gitignored; eval results land here
    .gitkeep
```

## When this eval is authoritative

- Before any change to `buddy/data/skill-template.md` — re-run Pass A
  against all 3 cases; regression if any drops below pass bar.
- Before any change to `buddy/commands/create.md` (when it exists) —
  re-run Pass B against all 3 cases.
- Before adding a new case — verify it adds a dimension the current 3
  do not test (size, voice register, structural shape — not just
  another domain).

## Not in scope for v1

- Automated scoring (LLM-as-judge for voice fidelity is itself a
  Pheasant `:llm` problem — defer until create-buddy ships and stabilizes)
- More than 3 cases (Hamsa: 5+ graded examples beats clever technique
  — but 3 is the minimum credible set; expand after Pass B passes)
- Cross-model evaluation (template should produce the same shape
  across model versions; defer until stability is established)
