# Rubric — `/buddy:create` Evaluation

Score each case on 5 dimensions, 0–3 each. Total range: 0–15.

**Pass bar per case:**
- Total ≥ 12 / 15
- No individual dimension < 2

A case scoring 12 with one 1 fails. A case scoring 11 with all 2s
fails. Both bars must hold.

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

Three rows passing = green light. Any row failing = the failing row's
weakest dimension names what to fix.

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
