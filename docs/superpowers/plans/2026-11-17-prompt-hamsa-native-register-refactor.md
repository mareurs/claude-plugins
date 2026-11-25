# prompt-hamsa native-register refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `buddy/skills/prompt-hamsa/SKILL.md` in the native register it will now teach, move its evidence to `references/evidence.md`, and measure that nothing regressed.

**Architecture:** One skill dir gains `references/evidence.md`. A structural bash test pins the split. A third prompt-tdd scenario probes the new principle; the old file is scored before the edit, the new one after.

**Tech Stack:** Markdown skill, bash test (pattern of `tests/test-peer-skill-split.sh`), prompt-tdd from `/home/marius/work/claude/prompt-engineering/.venv/bin/prompt-tdd`.

**Spec:** `docs/superpowers/specs/2026-11-17-prompt-hamsa-native-register-refactor-design.md`

## Global Constraints

- Keep headings (line-start prefix): `## Voice`, `## Operating Principles`, `## Method`, `## Heuristics`, `## Reactions`, `## Self-Traps`.
- Frontmatter `name: prompt-hamsa` and the `description:` line stay byte-identical.
- `SKILL.md` < 11,000 B (design target ~8–10 KB). On failure, move text to `references/`; never raise the cap.
- Critique-format fields and the audit-log contract unchanged.
- The working tree has unrelated dirty files: stage only the paths each task names.
- Long eval runs: `run_command(..., run_in_background=true)`, end the turn, wait for the wake.

## Review Focus

1. A heuristic pointer `§ Hn` with no matching `## Hn` in `evidence.md` — reader follows a dead link. Pinned by `pointers_resolve` (Task 2).
2. A `codescout:A-N` citation lost in the move — evidence silently deleted. Pinned by `citations_kept` (Task 2).
3. The rewrite drops an eval marker word so the critique no longer names "escape hatch" / "unverified" — `critique-weak-prompt` regresses. Pinned by `markers_present` (Task 2) and the Task 4 run.
4. The native-register principle over-generalises into "drop constraints" — a rewrite deletes a rule the agent cannot discover. Pinned by the new scenario's rubric (Task 1), and by the principle's wording (Task 3).
5. The `--ablate` arm passes the new scenario — the scenario has no power. Handled in Task 1 Step 3 (recorded as a guard, not as evidence).

---

### Task 1: New scenario + baseline on the OLD skill

**Files:**
- Create: `buddy/tests/prompt-hamsa-eval/prompt-tdd/scenarios/refactor-over-detailed-agent-prompt/scenario.yaml`
- Create: `buddy/tests/prompt-hamsa-eval/prompt-tdd/RESULTS-2026-11-17.md`

**Interfaces:** Produces the baseline table that Task 4 compares against.

- [ ] **Step 1: Write the scenario.** Same shape as `resist-adding-to-tight-prompt/scenario.yaml` (`mode: judge`, `setup.skills` → `/home/marius/work/claude/claude-plugins/buddy/skills/prompt-hamsa`, one rubric, `threshold: 0.7`, `expected_pass: true`). Input message: "This system prompt drives our test-fixing agent. It runs on a current frontier model with bash and file tools. It feels heavy. Refactor it." followed by a ~40-line prompt that (a) pastes the repo layout and the full text of a CONTRIBUTING section the agent could read, (b) scripts "Step 1: run `ls`, Step 2: open …" for 10+ steps, (c) stacks 12+ ALWAYS/NEVER rules, several restating each other, and (d) buries two real constraints the agent cannot discover: "never push to `main`" and "at most 30 tool calls; stop when the suite is green or after reporting the first unfixable failure". Rubric, high score (>= 0.7) only if ALL: the rewrite is substantially shorter; it replaces the step script with a goal, a done-condition and one organising idea; it points the agent at the files/commands instead of inlining their content; it keeps both non-discoverable constraints. Score 0.0 if it keeps the step script, adds rules, or drops either constraint.

- [ ] **Step 2: Baseline run (old skill, both arms, all three scenarios).** In background:
  `cd buddy/tests/prompt-hamsa-eval/prompt-tdd && set -a && . /home/marius/work/claude/prompt-engineering/.env && set +a && /home/marius/work/claude/prompt-engineering/.venv/bin/prompt-tdd run --paired --config prompt_tdd.yaml`
  Expected: one treatment and one control result per scenario. If it fails on credentials or the `~/.claude-test` profile, stop and report the error to the operator; do not improvise auth.

- [ ] **Step 3: Record the baseline** in `RESULTS-2026-11-17.md`: a table `scenario | arm | score | pass`, the run date, `n=1 per arm (spot check, not a measurement)`. If `refactor-over-detailed-agent-prompt` passes on control, write: "bare model already passes — scenario kept as a guard, not evidence for the principle (H12)".

- [ ] **Step 4: Commit** the scenario and `RESULTS-2026-11-17.md`: `test(buddy): prompt-hamsa scenario for over-detailed agent prompts + old-skill baseline`.

### Task 2: Structural test (red)

**Files:**
- Create: `tests/test-prompt-hamsa-split.sh` (auto-discovered by `tests/run-all.sh` via `tests/test-*.sh`)

**Interfaces:** Produces checks Task 3 must turn green. `HAMSA_SKILL_DIR` overrides the dir, as `PEER_SKILL_DIR` does.

- [ ] **Step 1: Write the test** modeled on `tests/test-peer-skill-split.sh`: each check takes a file, runs on the real file (must pass) and on a mutated mktemp copy (must fail, and the control proves the mutation changed the copy). Checks:
  - `under_cap SKILL.md` — `wc -c` < 11000.
  - `frontmatter_pinned` — `grep -qxF 'name: prompt-hamsa'` and `grep -qxF 'description: Improving a prompt — critique, drafting from scratch, diagnosing model misbehavior, or coaching toward eval-driven iteration'`.
  - `has_headings` — each of the six Global-Constraint headings matches `^<heading>` .
  - `markers_present` — case-insensitive: `stranger`, `escape hatch`, `unverified`, `cut`, `native register`.
  - `pointers_resolve` — every `§ H[0-9]+` / `§ P[0-9]+` token in `SKILL.md` has a line `^## <token> ` in `references/evidence.md`, and there is at least one such token.
  - `citations_kept` — `evidence.md` contains each of `codescout:A-2 A-4 A-5 A-6 A-8 A-9 A-10 A-11 A-14`.
- [ ] **Step 2: Run** `bash tests/test-prompt-hamsa-split.sh`. Expected: FAIL on `under_cap`, `markers_present` (no "native register"), `pointers_resolve`, `citations_kept` (no `evidence.md`); PASS on `frontmatter_pinned`, `has_headings`; all mutation controls behave.
- [ ] **Step 3: Commit:** `test: pin the prompt-hamsa core/evidence split (red)`.

### Task 3: Move the evidence, rewrite the core

**Files:**
- Create: `buddy/skills/prompt-hamsa/references/evidence.md`
- Modify: `buddy/skills/prompt-hamsa/SKILL.md` (whole body below frontmatter)

**Interfaces:** Consumes Task 2's checks. Pointer convention: `SKILL.md` writes `(evidence: references/evidence.md § H10)`; `evidence.md` has `## H10 — <rule>`.

- [ ] **Step 0: Record the pre-edit state** of `./tests/run-all.sh` and `cd buddy && python3 -m pytest -q` (pass/fail set), so Step 4 compares like with like.
- [ ] **Step 1: Write `evidence.md`.** Move, verbatim, the evidence bodies: H9's rationale, H10 with its eval / security / distance corollaries, H11's evidence and eval corollary, H12's running rate and corollaries, and Principle 6's three-repo validation (`## P6 — …`). One `##` section per source; a one-line header saying the core rules live in `SKILL.md`.
- [ ] **Step 2: Rewrite `SKILL.md`** under the same headings:
  - Operating Principles: six principles + a new one, each a short paragraph. New principle, in substance: write the prompt in the register the model was trained on — a goal, the reason, the done-condition, one organising idea — and let a capable agent read files and run commands for detail instead of inlining it; pin only what the model cannot infer or discover (I/O shape, escape hatch, hard constraints, budgets). Use the phrase "native register".
  - Reword Phase 1 step 2 and Principle 4 to "pin what the model cannot infer or discover", not every term.
  - Heuristics: one or two lines each, H1–H12 numbering kept, a `§ Hn` pointer where evidence moved. Add one heuristic: "If the prompt scripts steps the agent could plan itself, replace the script with the goal and the done-condition."
  - Harness, Critique Format, Reactions, Self-Traps: tighten wording, keep every field and anchor. Add a Self-Trap: "Over-specifying a capable agent" (inlining what it can read; enumerating what one idea covers).
- [ ] **Step 3: Run** `bash tests/test-prompt-hamsa-split.sh`. Expected: all PASS.
- [ ] **Step 4: Run** `./tests/run-all.sh` and `cd buddy && python3 -m pytest -q`. Expected: the same pass/fail set as Step 0.
- [ ] **Step 5: Commit** both skill files: `refactor(buddy): prompt-hamsa in the native register; evidence to references/`.

### Task 4: Score the NEW skill, record the audit

**Files:**
- Modify: `buddy/tests/prompt-hamsa-eval/prompt-tdd/RESULTS-2026-11-17.md`
- Update (via `doc`): tracker `e34f27e925bf516b` (`prompt-hamsa-audit-log`)

- [ ] **Step 1: Run** in background, the treatment arm only: same command as Task 1 Step 2 without `--paired`.
- [ ] **Step 2: Append** the new-skill rows to the results table with a verdict per scenario: `held` (old pass → new pass), `regressed` (old pass → new fail), `gained` (old fail → new pass). Any `regressed` on `critique-weak-prompt` or `resist-adding-to-tight-prompt` → stop, report, do not proceed to Step 4.
- [ ] **Step 3: Audit row.** `doc(action="get", id="e34f27e925bf516b", heading="## Row schema")`, read the existing `audits[*].id` values, then append the next free `A-N` row via `doc(action="update", …)`: gap = Hamsa over-specified for capable agents; move = native-register rewrite, 23,038 B → final size; prediction = both existing scenarios hold and the new one passes on treatment; outcome = the Step 2 verdicts, with `n=1`.
- [ ] **Step 4: Commit** `RESULTS-2026-11-17.md` and the tracker file: `docs(buddy): prompt-hamsa refactor eval results + audit row`.

### Follow-up (operator decision, not in this plan)

`./scripts/release.sh buddy patch`, then the version-bump-checklist refresh and a cold restart of all four profiles — until then the edit is `committed`, not `live`.
