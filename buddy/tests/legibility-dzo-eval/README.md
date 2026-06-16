# legibility-dzo eval

A [prompt-tdd](../../../) eval for the `legibility-dzo` skill (global buddy
specialist). The dzo refactors code for *machine* legibility — symbol
addressability, the symbols inline budget, retrieval-surface naming,
LSP-resolvable structure — and only ever moves on **observed tool friction**,
never on human taste. This eval tests the two halves of that discipline.

## What it tests — the discriminating marker

The dzo's distinctive method, not generic refactoring competence:

1. **Defects named in instrument terms + moves tied to readings** (`defect-present`).
   Given concrete friction (truncated `symbols` body, a missed
   `semantic_search`, empty `references`, a grep chain) over an over-budget
   god-function with a buried lambda and a generic name, the dzo must diagnose in
   *tool* terms — "exceeds the symbols inline budget", "the closure is invisible
   to the index", "the generic name defeats intent search" — and pick
   budget/concern-driven moves (split at seams, extract the closure to a named
   symbol, rename toward intent), insisting on before/after instrument readings
   and a green baseline. A bare model reads this as "long, messy function, let me
   clean it up" — framed by line count and human aesthetics, no instrument panel.

2. **Evidence-gated refusal** (`clean-bait`). Given clean, cohesive, cleanly
   mappable code and a vague "make it cleaner for the AI" with *no logs and no
   friction*, the dzo must refuse to churn: "cleaner for which instrument? I do
   not refactor from taste, and not without a degraded reading." A bare model
   takes the request at face value and tidies clean code. This is the precision
   side — the dzo's discipline is most visible when the right answer is to NOT
   move (Reaction 1 & 3, Heuristic 10, the Goodhart/churn Self-Trap).

Both scenarios use **`mode: judge`**: code vocabulary (symbols, refactor,
function names, budget) appears in both the prompt and any plausible response,
so substring matching cannot tell "applied the instrument-evidence method" from
"echoed the vocabulary." Only a semantic judge can.

## Activation assumption

The skill is copied into the work dir via `setup.skills` and exposed to the
isolated profile. It auto-fires only if the task matches its description. Each
`message` is phrased in the skill's exact domain (codescout instrument friction,
machine legibility) and names the capability ("Acting as the Legibility Dzo
skill") so a model WITH the skill reliably invokes it. The `--ablate` arm sends
the SAME message without the skill files; the bare model then has no Operating
Principles, Reactions, or Heuristics to gate on and falls back to ordinary
refactoring. Phase B validates this assumption.

## Fidelity caveat

This tests the `SKILL.md` payload as a **loaded skill** — NOT the full
`/buddy:summon legibility-dzo` injection (memories, gates, memory-protocol,
codescout MCP wired live). The dzo's real method calls `librarian
legibility_scan`, `symbols`, `edit_code`, and the librarian against a live
`usage.db`; in this eval there is no codescout MCP and no DB, so we measure
whether the *written method* (instrument-framed diagnosis + evidence gate)
surfaces in the response — the skill-content floor, which is the right unit for
"does the writing have teeth." We do not measure whether the dzo correctly
drives the live tools end to end.

## Why this needs an isolated profile

`legibility-dzo` ships as a global buddy specialist, so a plain `claude -p`
would load it regardless of `setup.skills` and confound every run. The harness
points at a blank, plugin/MCP-free profile so `setup.skills` is the *only* source
of the skill:

```yaml
claude_code:
  session:
    config_dir: ~/.claude-test
```

See `codescout-pika-eval/README.md` for the one-time `~/.claude-test` setup
(blank profile, symlinked credentials, `--strict-mcp-config`).

## Running (Phase B)

The judge tier (T3) calls the Anthropic API, so `ANTHROPIC_API_KEY` must be in
the environment (the adapter strips it from the isolated subprocess only — the
judge still sees it):

```bash
set -a; . /path/to/prompt-engineering/.env; set +a
cd buddy/tests/legibility-dzo-eval

# Skill present — expect PASS (the method fires):
prompt-tdd run prompt_tdd.yaml

# Skill ablated — expect FAIL (bare model refactors / churns):
prompt-tdd run prompt_tdd.yaml --ablate
```

## Expected result (the eval has teeth iff)

| Skill | Expectation |
|---|---|
| present (`setup.skills`) | 2/2 PASS — instrument-framed diagnosis + evidence-gated refusal |
| absent (`--ablate`) | 0/2 (or near-zero) — bare model gives line-count cleanup and tidies clean code |

The GREEN-with / RED-without gap is the proof the eval measures the skill's
written method, not the base model's refactoring instinct. A near-zero delta
would mean the dzo's discipline is something a bare model already does — a valid,
honest result, but not the expectation here, since evidence-gated *refusal* and
instrument-term framing are not default model behavior.
