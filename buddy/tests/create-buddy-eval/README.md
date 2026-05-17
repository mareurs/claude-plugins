# `/buddy:create` Evaluation Set

Reference cases for evaluating the `/buddy:create` command against
known-good hand-authored specialists. Per Hamsa's eval requirement
(no improvement without graded examples), this set is the precondition
for shipping the command — and the regression test for future template
or command changes.

## How to run

The eval is **human-driven** for v1 (no automated scoring). Two passes:

### Pass A — template correctness (no command yet)

For each case:

1. Read `cases/<name>/hint.txt` — that is the input.
2. Using `buddy/data/skill-template.md` directly, draft a SKILL.md
   from the hint (as if `/buddy:create` were a person, not a command).
3. Compare your draft against `cases/<name>/reference-skill.md`
   (the actual hand-authored specialist).
4. Score using `rubric.md` (5 dimensions × 3 cases = 15 scores).
5. Record results in `runs/<date>-pass-a.md`.

**Pass bar:** total ≥ 12/15 per case, no individual dimension < 2.

If Pass A fails, the **template** is the bug. Fix `skill-template.md`,
re-run.

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
