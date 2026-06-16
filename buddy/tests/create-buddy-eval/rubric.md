# Rubric — `/buddy:create` Evaluation

Score each case on 5 dimensions, 0–3 each. But the dimensions are **not
equal evidence**. Pass 0 — the bare-model floor run on 2026-06-16 (no
template, no command) — proved that two of the five float high without
the apparatus, so an absolute total hides where the command actually
earns its keep. The pass bar is therefore **split**: hygiene floors that
must hold, and value dimensions the command must measurably move.

**Hygiene floors (binary — must hold; not scored toward the value bar):**
- **Voice ≥ 2** — base competence. Bare model already clears it (Pass 0: 2, 2, 3; owl scored a full 3 unaided).
- **Heuristics ≥ 2** — mostly base competence (Pass 0: 2, 2, 2).
- **Lens ≥ 2 on no-lens cases** (no invented lens) — free for yeti; carries no command signal.

Fail any floor → the case fails regardless of value score. These gates
catch regressions; clearing them is **not** evidence the command did
anything.

**Value dimensions (where `/buddy:create` must show power):**
- **Sections** — template-borne. Judge on delta **A − 0 ≥ 2** (Pass 0: 1, 1, 1 → Pass A: 3, 3, 3).
- **Lens** (lens-required cases only — pheasant, owl) — apparatus-borne. Judge on delta over bare **≥ 2** (free, uninformative on no-lens yeti).
- **Scope** — command-borne, the cleanest discriminator. Judge on delta **B − A ≥ 2** (bare model can't resolve scope at all: Pass 0: 0, 0, 0).

**A case passes** when every applicable hygiene floor holds AND every
applicable value dimension clears its delta bar.

The old "Total ≥ 12 / 15, no dimension < 2" bar is **retired**: Pass 0
reached 6–8 / 15 with no apparatus whatsoever, so a 12/15 absolute can be
more than half base competence — the same tautology trap pika's Persist
eval fell into. Use the **Power check (three-arm delta)** section at the
bottom to compute the deltas this bar reads.

---

## Dimension 1 — Voice fidelity

How closely does the draft's voice match the reference specialist's
voice when read aloud?

| Score | Criterion |
|---|---|
| 0 | Generic helpful-assistant voice. Could be any specialist. |
| 1 | Voice gestures toward archetype but reads as imitation. |
| 2 | Voice is distinct and consistent. Recognizable as the archetype. |
| 3 | Voice is indistinguishable from a hand-authored exemplar. Cadence, register, and recurring phrases all land. |

Test: read the `## Voice` section aloud. Does it sound like the
archetype the hint describes? Read 2-3 reactions aloud. Same voice?

---

## Dimension 2 — Required section completeness

Are all REQUIRED sections present and substantively filled?

Required sections per template: `# Title`, `## Voice`,
`## Operating Principles`, `## Method (3 phases)`, `## Heuristics`,
`## Reactions`.

| Score | Criterion |
|---|---|
| 0 | One or more required sections missing entirely. |
| 1 | All present but ≥ 2 sections are skeletal placeholders. |
| 2 | All present and filled; 1 section is thin (e.g. 3 heuristics where 5+ expected). |
| 3 | All present, all filled at canonical depth (5+ heuristics, 3+ reactions, 4+ principles, 3 phases each with 2+ steps). |

Test: count items in each section against the template's minimum.

---

## Dimension 3 — Heuristic specificity

Are the heuristics domain-anchored (not generic) and concrete (cite
signals, not vibes)?

| Score | Criterion |
|---|---|
| 0 | Heuristics are platitudes ("if confused, slow down"). |
| 1 | Heuristics name the domain but don't anchor to evidence ("if the tests fail, investigate"). |
| 2 | Most heuristics name a specific signal and a specific response. Some lack anchor. |
| 3 | Every heuristic has the `If {signal}, {response}. {why}` shape with concrete domain language and at least implicit anchor (incident, citation, structural reason). |

Test: for each heuristic, ask "could I tell whether this heuristic
fired in a real session?" If no, score lower.

---

## Dimension 4 — Lens correctness

Is the Lens conditional section handled correctly?

| Score | Criterion |
|---|---|
| 0 | Lens invented where none needed, OR required lens missing. Addendum files missing or empty when declared. |
| 1 | Lens correctly declared but addenda are stubs (< 20 lines or repeat the universal body). |
| 2 | Lens correctly declared, addenda present and lens-specific, but `## When summoned` stop-instruction missing. |
| 3 | Lens correctly declared (or correctly absent for single-framework specialists), addenda extend the universal body, `## When summoned` stop-instruction present for required-lens specialists. |

Note: for Yeti (no lens), score 3 if no Lens section appears. Score 0
if a Lens section was invented.

---

## Dimension 5 — Scope correctness (Owl-specific, but scored for all)

Did the command's scope resolution work correctly for the case?

| Score | Criterion |
|---|---|
| 0 | Scope question skipped; specialist would be written to wrong scope (e.g. builtin when project intended). |
| 1 | Scope asked but default applied without context; user input did not constrain. |
| 2 | Scope asked, defaulted sensibly, and user's hint contained scope signal that was honored. |
| 3 | Scope asked, default = `global`, and any scope signal in the hint (e.g. "for this repo", domain-specific project name) was correctly elevated to `project`. |

**Owl is the calibration case.** The original MRV-poc Owl was misfiled
to builtin because no scope question existed. The hint
("buddy for MRV section auditing, lenses for output and compliance")
should cause the command to ask scope — and "MRV" is a project-specific
domain, so `project` scope should win.

---

## Recording a run

Create `runs/YYYY-MM-DD-<pass-letter>.md`:

```markdown
# Eval Run — {{date}} — Pass {{A|B}}

| Case | Voice | Sections | Heuristics | Lens | Scope | Total | Pass? |
|------|-------|----------|------------|------|-------|-------|-------|
| yeti     | / 3 | / 3 | / 3 | / 3 | / 3 | / 15 | Y/N |
| pheasant | / 3 | / 3 | / 3 | / 3 | / 3 | / 15 | Y/N |
| owl      | / 3 | / 3 | / 3 | / 3 | / 3 | / 15 | Y/N |

## Notes per case

### yeti
{{1-3 sentences: what landed, what missed}}

### pheasant
{{1-3 sentences}}

### owl
{{1-3 sentences}}

## Verdict
{{ship | iterate template | iterate command}}
```

Three rows passing the split bar = green light. A row fails if any
hygiene floor (Voice, Heuristics, no-lens Lens) drops below 2, or any
applicable value dimension (Sections, Lens, Scope) misses its delta bar.
The failing arm names what to fix: a floor miss = a regression in base
quality; a value-delta miss = the command/template stopped earning its
keep on that dimension.

## Power check (three-arm delta)

After recording Pass 0, A, and B for a case, fill the per-dimension delta to see
where the apparatus actually carries signal — the manual analog of
`prompt-tdd run --ablate`:

| Dimension  | Pass 0 (bare) | Pass A (template) | Pass B (command) | A−0 | B−A | Verdict |
|---|---|---|---|---|---|---|
| Voice      | /3 | /3 | /3 | | | |
| Sections   | /3 | /3 | /3 | | | |
| Heuristics | /3 | /3 | /3 | | | |
| Lens       | /3 | /3 | /3 | | | |
| Scope      | /3 | /3 | /3 | | | |

Per-dimension verdict: **base-competence** if Pass 0 ≈ A ≈ B (the rubric is not
measuring create-buddy here); **template-borne** if A > 0 but B ≈ A;
**command-borne** if B > A. Only template- and command-borne dimensions justify
create-buddy's existence. If the ≥ 12/15 pass is carried mostly by
base-competence dimensions, the eval is passing regardless of the command —
tautological, the same trap pika's Persist eval fell into.
