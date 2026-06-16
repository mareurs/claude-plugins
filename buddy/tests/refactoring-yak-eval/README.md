# refactoring-yak eval

A [prompt-tdd](../../../) eval for the `refactoring-yak` skill. It hands the
model a knotted function and judges whether the response carries the Yak's
**method markers** — not whether the resulting code looks cleaner.

## What it tests (the discriminating marker)

Asked to "clean up this tangled function," a bare model produces a tidier
rewrite. The skill is supposed to impose a specific discipline instead:

1. **Safety net before move.** No structural change until a green suite /
   characterization tests pin the *current* behavior. The fixture states the
   module has **no tests**, so the skill must call for writing characterization
   tests (or recording a baseline) FIRST.
2. **Name the structural defect in one sentence**, in structural terms — "this
   function mixes parsing, validation, computation, and persistence" — as an
   explicit diagnosis before touching code.
3. **Smallest atomic moves, tests after each.** Extract one concern at a time,
   re-run the suite after every move, behavior preserved against the baseline —
   not one big rewrite.
4. **Behavior preserved / no smuggling.** A refactor changes structure, not
   behavior; a latent bug gets pinned (fixed in a *separate* change), and a new
   feature stays out of the refactor (separate commit / ask before scope).

The two scenarios target these:

- `scenarios/untangle-knot/` — **positive**: judges markers 1–3 (safety-net-first,
  named structural defect, atomic verified moves).
- `scenarios/no-smuggle/` — **precision / bait**: same function, but the user
  also asks to fix a rounding bug and add a 15% discount tier *in the same pass*.
  Judges marker 4 — the skill keeps the refactor behavior-preserving and pushes
  the fix and the feature out into separate changes, where a bare model just
  fixes-and-adds inline.

Both use `mode: judge` (T3). The markers are about the *shape* of the method, not
literal strings, so a substring match cannot tell "the Yak fired" from "a tidy
rewrite" — only a semantic judge can.

## Activation assumption

The skill is copied into the work dir via each scenario's `setup.skills` and
exposed through `CLAUDE_PLUGIN_ROOT`, but it auto-fires only if the task matches
its description ("Structural code transformation, cleaning up tangled code"). The
`message` is phrased squarely in that domain ("untangle / clean up this knotted
code so the responsibilities are separated"), so a model WITH the skill should
reliably invoke it. The `--ablate` arm sends the SAME message without the skill
files. **Phase B validates this assumption** — if the present-arm fails to
activate, the rubric will not be met and the gap collapses.

## Fidelity caveat

This tests the `SKILL.md` payload as a **loaded skill** — NOT the full
`/buddy:summon` injection (memories, gates, memory-protocol, persona framing).
There are no `_<lens>.md` addenda for this skill; the SKILL.md is the whole
payload. Power measured here is the **skill-content floor** — the right unit for
"does the writing have teeth," but a lower bound on the fully-summoned Yak.

## Why this needs an isolated profile

`refactoring-yak` is a globally-installed buddy plugin. A plain `claude -p` loads
it regardless of `setup.skills`, so omitting the skill would NOT remove it and the
negative control would be fake. `prompt_tdd.yaml` points the harness at a blank,
plugin-free profile so `setup.skills` is the only source of the skill:

```yaml
claude_code:
  session:
    config_dir: ~/.claude-test
```

One-time setup of `~/.claude-test` (blank profile, subscription creds symlinked)
is documented in the codescout-pika eval README in the sibling directory.

## Running (Phase B)

The judge tier calls the Anthropic API, so `ANTHROPIC_API_KEY` must be in the
environment (the adapter strips it from the isolated subprocess only):

```bash
set -a; . /path/to/prompt-engineering/.env; set +a
cd buddy/tests/refactoring-yak-eval

# Skill PRESENT — expect PASS (the method markers appear):
prompt-tdd run prompt_tdd.yaml          # expect 2/2 PASS

# Skill ABLATED — expect FAIL (= the skill has power):
prompt-tdd run prompt_tdd.yaml --ablate # expect FAIL; bare model rewrites/ smuggles
```

The GREEN-with / RED-without gap is the proof the eval measures the skill, not
the base model.

## Honest expectation (competence archetype)

This is a **competence** skill with **likely-tautological** expected power: a
capable bare model may already separate the four concerns and may even balk at
mixing a feature into a cleanup. The markers chosen are the ones a bare model is
LEAST likely to produce unprompted — *tests-first on an untested module* and
*pinning a bug rather than fixing it during a refactor*. If the `--ablate` arm
still passes, that is a **valid, expected** result: the delta is near zero and the
skill is tautological for this task. The rubric is written honestly toward those
markers; the delta is allowed to fall where it falls rather than being inflated to
manufacture teeth.
