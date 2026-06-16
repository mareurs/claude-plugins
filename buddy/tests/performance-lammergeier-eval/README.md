# performance-lammergeier-eval

prompt-tdd benchmark for the **performance-lammergeier** buddy skill
(`buddy/skills/performance-lammergeier`).

## What it tests

The Lammergeier's archetype is **method (measure-first)**. Its single
non-negotiable is Operating Principle 1: *"Profile before optimize. No code
change for performance reasons before a profile names the hot function. … If
you cannot point at the flame graph, you do not have a target."* This eval
targets that discipline directly, in the two ways it shows up:

1. **`optimize/measure-first`** (positive) — a "make this faster, just give me
   the optimized version" request with **no profile and no numbers**. The skill
   should refuse to ship an intuition-driven rewrite: demand a profile + a
   reproducible baseline benchmark first, and (per Self-Trap 7) refuse to invent
   a percentage or a speedup figure it has not measured.

2. **`optimize/cold-path-redirect`** (precision / Amdahl) — a profile IS
   supplied; it proves the function the user wants optimized owns ~0.6% of
   runtime while an N+1 query owns ~88%. The skill should **redirect** to the
   real hot path (Operating Principle 3, Self-Trap 1) instead of obligingly
   micro-optimizing the cold function.

## The discriminating marker

Not "is the optimization good" — both a bare model and the skilled model can
write fast code. The marker is **measurement as a precondition / hot-path
gating**:

- Scenario 1 pass = measurement is a *gate*, not a footnote, and no profile
  numbers are fabricated. Bare-model default = return the rewritten function and
  assert it is faster (often with an invented "~3x" / "saves N%"). That fails
  the rubric.
- Scenario 2 pass = refuse the cold-path work and point at the N+1 query as the
  real target, citing the profile shares. Bare-model default = optimize the
  function the user pointed at, because it was asked to. That fails the rubric.

Both use **`mode: judge`** because the discipline and the bare-model default
share nearly all their vocabulary (profile, latency, query, faster, optimize) —
a substring assertion cannot tell "insisted on a profile before changing
anything" from "mentioned profiling while handing over a rewrite." Only a
semantic judge scores the discipline rather than the keywords.

## Activation assumption

The skill is copied into the work dir via `setup.skills` (absolute source path)
and exposed through `CLAUDE_PLUGIN_ROOT`, but it auto-fires only if the task
matches its description (*"Profiling, latency, throughput, optimization"*). Both
messages are phrased squarely in that domain — "this is our hot path … optimize
it," and a cProfile dump with a request to optimize a function — so a model
**with** the skill present should reliably load and apply it. The `--ablate` arm
sends the **same** messages with the skill files removed. Phase B validates this
assumption: if the no-skill arm also passes, the skill is not adding teeth on
this task.

## Expected power

**partial.** A capable bare model already knows "profile before you optimize" as
stock advice and may volunteer some of it, especially in scenario 1. The teeth
the skill adds are (a) treating measurement as a hard *precondition* and
declining to ship an unmeasured change, and (b) actively *redirecting off a cold
path* in scenario 2 against an explicit user request — the agreeable default is
strong there, so scenario 2 is where the clearest delta is expected. We write
the honest markers and let the A vs `--ablate` delta fall where it falls; a small
delta on scenario 1 is a valid result for a method archetype, not a reason to
inflate the rubric.

## Fidelity caveat

This exercises the **SKILL.md payload as a loaded skill** — not the full
`/buddy:summon` injection (specialist memories, gates, the memory protocol). The
power measured here is the **skill-content floor**: does the writing alone change
observable output. The summoned specialist, with memories and gates layered on,
can only do better.

## Phase B — how to run it

From this directory, with `ANTHROPIC_API_KEY` set (the judge calls the API):

```bash
# A arm — skill present. Expect PASS (the discipline shows up).
prompt-tdd run prompt_tdd.yaml

# --ablate arm — same messages, skill removed (negative control).
# Expect FAIL = the skill has power (the bare model skips the discipline).
prompt-tdd run prompt_tdd.yaml --ablate
```

PASS on the A arm **and** FAIL on the `--ablate` arm = the skill content has
teeth on this task. PASS on both = tautological on this task (bare model already
does it) — a valid, honest result, not a bug to paper over.
