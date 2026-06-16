# prompt-hamsa — prompt-tdd harness

This subdir is a **second, separate** eval for the `prompt-hamsa` skill, built on
the shared `prompt-tdd` harness schema. It is deliberately kept apart from the
bespoke instrument in the parent dir.

## Relationship to the bespoke harness (do not conflate)

The parent `prompt-hamsa-eval/` already contains a **bespoke** measurement
instrument — `harness.py`, `archetypes.py`, `crossfamily_check.py`, `RESULTS.md`,
`POC.md`. That instrument answers a **different question**: it runs a flawed
*control* prompt against the Hamsa's *treatment* rewrite on a downstream model
(Gemini Flash-Lite / Claude), grades the **downstream behavioral delta**, and
reports where a rewrite actually moves a metric (cost, routing accuracy, the hard
tail). Its headline finding: prompt quality is invisible to behavioral metrics
wherever a capable model self-heals the flaw — see `../RESULTS.md`.

This harness answers the **complementary** question:

> Does the skill's own content change the **auditing model's critique** of a weak
> prompt — relative to a bare model that lacks the skill?

- **Bespoke harness (`../harness.py`):** does a Hamsa *rewrite* change *downstream*
  behavior? Output = graded behavioral delta on a third model.
- **This harness (`prompt-tdd/`):** does the Hamsa *skill content* change the
  *critique* the auditing model produces? Output = A-vs-`--ablate` delta on the
  critique itself.

Both are valid. Neither replaces the other. Do not delete or modify the parent
files.

## What this tests

The discriminating task is **"critique a weak prompt."** The rubric awards credit
ONLY for skill-specific method markers — never generic prompt-polish:

1. **Read-as-stranger gap** — names the specific unanchored terms ("concise",
   "appropriate detail", "if needed", "professional") the model could legally
   satisfy in unintended ways.
2. **Cut-before-add** — flags the role-priming ("world-class expert") as
   *decoration to cut*, and orders cutting *before* any addition.
3. **Pin the contract** — names the missing **output schema** AND the missing
   legal **escape hatch** ("I don't know"), warning of hallucination under load.
4. **Eval gate** — declares the critique **UNVERIFIED / N=0** (an inspection, not a
   measurement) instead of asserting the rewrite "improves" the prompt.

### Scenarios

| id | side | what it discriminates |
|---|---|---|
| `critique-weak-prompt` | positive (recall) | the four method markers above fire on a bloated, unanchored, eval-less prompt. Carries a second hard guard: the verdict is declared UNVERIFIED / N=0. |
| `resist-adding-to-tight-prompt` | precision | given an already-tight prompt and an open "what should I add?", the skill runs subtraction-first and **declines** to pile on additions — the "adding before cutting" self-trap a generic assistant falls into. |

The **discriminating marker** that most cleanly separates skill-from-bare is the
**UNVERIFIED / N=0 eval-status declaration** (scenario 1, second judge assertion):
a bare model asked to critique a prompt rewrites it cleaner and calls it "better";
it does not declare its own critique unverified for lack of a graded set. That move
is idiosyncratic to the Hamsa's Operating Principle 3 / Self-Trap 5.

## Tier choice

**T3 judge.** The markers are method-shaped (a *named* gap, a *declared* unverified
flag, a *refused* addition), not literal tokens — substring matching cannot tell
"applied the method" from "wrote a nicer prompt." The one place a marker IS a
literal string (the "unverified" / "N=0" flag) is folded into a tight rubric rather
than a brittle `contains:` so paraphrases ("this is a guess until you run it")
still count.

## Activation assumption

The skill is copied into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`, but it
auto-fires only if the task matches its description (*"Improving a prompt —
critique, drafting from scratch, diagnosing model misbehavior…"*). Both scenarios
phrase the request squarely in that domain — "critique this prompt", "what should I
add to this prompt" — so a model WITH the skill loaded reliably invokes it. The
`--ablate` arm sends the **same** message with the skill files absent. **Phase B
validates this assumption** — if the positive scenario does not pass with the skill
present, the activation phrasing (not the rubric) is the first suspect.

## Fidelity caveat

This tests the `SKILL.md` payload as a **loaded skill** — NOT the full
`/buddy:summon hamsa` injection (no memories, no gates, no memory-protocol, no
audit-log tracker append). Power measured here is the **skill-content floor**:
"does the writing alone have teeth?" The audit-log row append (SKILL.md "Record the
audit") and the R6 scout/apply eval-substitution path are out of scope — they need
a live codescout artifact store and a different task shape the headless harness does
not seed. Expected power for this archetype (method + cost): **partial** — a bare
model produces a competent prose cleanup, so markers (1) and (2) may partially leak;
markers (3) and (4), and the precision scenario's refusal-to-add, are where the
delta should concentrate.

## Phase B — how to run it

From this directory (`prompt-hamsa-eval/prompt-tdd/`), with `ANTHROPIC_API_KEY` set
(the judge calls the Anthropic API):

```bash
# Skill PRESENT — expect PASS (the method markers fire):
prompt-tdd run prompt_tdd.yaml

# Skill ABSENT (negative control) — expect FAIL (= the skill has power):
prompt-tdd run prompt_tdd.yaml --ablate
```

A **PASS with the skill** and a **FAIL on `--ablate`** is the result that means the
skill's writing changed the model's behavior. A pass on both arms means the marker
is tautological (a bare model already does it) — a valid, honest outcome to record,
not a bug to paper over.
