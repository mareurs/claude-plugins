# Prompt Hamsa — measuring a prompt

Principle 3 of `../SKILL.md` says why a change needs an eval. This file says how: each section is the rule, then the measurements behind it. Read it when the next move is an eval, a scout/apply split, or a harness.

## P6 — scout / apply when no graded set is feasible

**Substitute the eval when a graded set is not feasible.** For a read-then-mutate task, split the prompt into `scout` (a plan, zero mutations) and `apply` (consumes the approved plan). The plan is the eval, scored on real data at the gate; the gate comes off once trust is earned.

The rule as first written: if the user cannot or will not build a graded set, and the task is read-then-mutate, split the prompt into propose / apply phases — the plan IS the eval, scored on real data at the gate. The gate is training wheels; coverage grows in vivo, then the gate comes off.

Validated across three repos (Rust tracker-schema design, Python frontmatter mass-edit on 200 files, Kotlin frontmatter backfill on 204 files); calibration was identical across stacks — zero gate-bypass, scout refusals (read-budget exhaustion, ambiguous-classification) preserved as observable signals rather than papered over.

## Base arm first: an addition must prove the deficit exists

**If the base arm doesn't show the failure, the addition doesn't ship.** Run the no-change arm first on a stimulus that tempts the failure; deletions carry the inverse burden — prove nothing regressed.

Before evaluating any added instruction/snippet, run the *no-change* arm against a stimulus that tempts the target failure, under a pre-registered numeric ship/no-ship rule. Base arm at ceiling → skip the treatment arm and close the audit no-ship: a green treatment arm over an absent deficit reads as "the snippet works" and ships a dead rule — the exact accretion that the cut-first rule (Principle 2) later removes, and on prescription-sensitive models (Fable) a net quality loss. The running rate that grounds this: **6 of 9 intervention audits in the codescout ledger landed no-ship** (adherence/restraint already at ceiling; imported failure claims that never manifested locally — codescout:A-4/codescout:A-6/codescout:A-8/codescout:A-9/codescout:A-14).

Corollaries: an *imported* failure claim (migration guide, forum lore, another team's telemetry) is a hypothesis about your stack, not evidence — the base arm is its test (codescout:A-14: FND-8 "unrequested tidying," real in Anthropic's telemetry, 10/10 absent locally on the tempting stimulus). *Deletions* carry the inverted burden — prove the cut regresses nothing the text claimed to protect (codescout:A-2: −70% prompt, zero regression over 2.5 weeks of real sessions). Full protocol with the pre-registration contract: codescout `docs/research/2026-11-25-prompt-hamsa-protocol.md` (P-1..P-8).

## Break your own eval by mutating the output, not the prompt

**Break your own eval by mutating the output, not the prompt.** Feed it a known-bad answer and watch the score fall.

Feed the eval a deliberately failing answer — a fabricated fact, a dropped constraint, the input ignored — and confirm the score falls; an eval that scores garbage as high as gold is a tautology with a green bar. Mutating the *prompt* to test the eval is the trap: a well-aligned model often refuses to produce the failure, so the score never moves and you wrongly rule the eval blind. Mutate what the eval grades, not what feeds it.

## Harness — prompt-tdd for a Claude Code artifact, the playbook for anything else

For a Claude Code skill, hook or `CLAUDE.md` section, `prompt-tdd` runs the eval that Principle 3 and the mutated-output check ask for: headless `claude -p`, assertions on the output, GEPA to optimise.

1. Register the prompt (`type: skill | hook | claude-md-section`).
2. Write a scenario: `setup.skills` makes the artifact active; assert on a marker the *base* model would not produce (artifact present vs absent).
3. `prompt-tdd run` (`--paired` adds the control); `prompt-tdd optimize` to improve.

Recipe: prompt-tdd's `docs/integrations/claude-code-skills.md`. An eval harness for anything else is a different request: route it to `prompt-engineering:skill-eval-playbook`, as the next paragraph says.

The `prompt-tdd` steps assume the artifact already exists and needs a scenario. A user asking to build an eval for something that is not a Claude Code skill/hook/`CLAUDE.md` section — a RAG pipeline, a classifier, any other system — wants golden-set construction, rubric design, judge calibration, and bias control (position bias, verbosity bias), none of which `prompt-tdd` teaches. Point them at `prompt-engineering:skill-eval-playbook` (`L-1`..`L-17`): run the no-skill control first, one concept per rubric, mutate the *output* to validate the judge before trusting it, `n>=10` near a threshold, isolate each experiment's `config_dir`. Operating Principle 3's "five inputs, five expected outputs, a one-line rubric" (§ Reactions #4) is the right floor for a quick ad-hoc check; route to the playbook once the ask is a real harness, not a spot-check.
