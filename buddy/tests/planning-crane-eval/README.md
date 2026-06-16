# planning-crane-eval

prompt-tdd harness for the **Planning Crane** builtin buddy skill
(`/home/marius/work/claude/claude-plugins/buddy/skills/planning-crane/SKILL.md`).

## What this tests

Does the Planning Crane's SKILL.md payload change the model's observable output
versus a bare model that lacks it, when asked to sequence a large multi-part
effort? The skill's archetype is **competence** and the expected power is
**likely tautological** — a bare model is already a competent planner, so the
honest question is narrow: does the skill impose its *specific* planning
discipline on top of generic competence?

## The discriminating markers

A bare model asked to "break this down and sequence it" reliably produces a
competent generic plan (phases, task list, rough dependencies, milestones). The
rubrics do **not** reward that. They reward only the Crane's SKILL-SPECIFIC,
checkable method markers — things that appear in output ONLY if the skill fired:

- **Done-condition first** — a single concrete finish-test sentence ("we are
  done when X is true / Y passes") stated *before* any task breakdown.
- **Named load-bearing task** — the one task that dominates the effort's
  uncertainty/risk, called out *as such* and scheduled early (first/second),
  never last.
- **Dependency-cited sequencing** — "A unblocks B", not "feels right" ordering.
- **Sizing confidence + spike** — per-task confidence (high/medium/low) where
  low-confidence work triggers a time-boxed *spike* instead of a harder guess.

Scenario `done-condition-gate.yaml` tests the inverse precision behavior: on an
underspecified "just start coding" request, the Crane *refuses to decompose*
until the done-condition is concrete (Operating Principle 1, Self-Trap
"premature decomposition"), where the bare-model default is to eagerly dump a
plausible task list for an invented goal.

The strongest single discriminator is **"load-bearing task"** — a model without
the skill almost never names the dominating-uncertainty task as a first-class
planning object and schedules it early on that basis.

## Scenarios

- `scenarios/large-effort-sequencing.yaml` — positive case. A billing-service
  build with two genuinely uncertain parts (Stripe, legacy migration). Rubric
  passes only if >=3 of 4 markers are present, including the named load-bearing
  task scheduled early.
- `scenarios/done-condition-gate.yaml` — precision case. Underspecified
  "modernize the platform" + "start coding now". Rubric passes only if the model
  gates on the done-condition before decomposing.

## Activation assumption

The skill is COPIED into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`, but
it auto-fires only if the task matches its description/triggers ("Work planning,
task sequencing, breaking down large efforts"). Both scenario messages are
phrased squarely in that domain ("plan a fairly large effort and sequence the
work", "task breakdown", "split it across work sessions"), so a model WITH the
skill should reliably invoke it. The `--ablate` arm sends the SAME message
without the skill files. **Phase B validates this assumption** — if the WITH-skill
arm does not fire the skill, the activation assumption is wrong, not the rubric.

## Fidelity caveat

This tests the **SKILL.md payload as a loaded skill** — NOT the full
`/buddy:summon` injection (no memories, no gates, no memory-protocol, no
`inject_trackers`). The power measured here is the skill-content floor, which is
the right unit for "does the writing have teeth."

## Expected result (honest)

Competence archetype, likely tautological. A bare model already produces phased,
dependency-aware plans. The expected delta is the load-bearing-task call-out, the
confidence/spike treatment, and the done-condition gate. If the bare model
satisfies these rubrics anyway, the measured A-vs-ablate delta is near zero —
that is a VALID result, not a failure of the harness. The rubrics are written to
the honest marker; the delta falls where it falls.

## Phase B commands

```
# WITH skill — expect PASS (skill fires, markers present)
prompt-tdd run /home/marius/work/claude/claude-plugins/buddy/tests/planning-crane-eval/prompt_tdd.yaml

# WITHOUT skill (negative control) — expect FAIL = skill has power.
# If this still PASSES, the skill is tautological for this task (an honest,
# expected outcome for a competence archetype).
prompt-tdd run /home/marius/work/claude/claude-plugins/buddy/tests/planning-crane-eval/prompt_tdd.yaml --ablate
```
