# architecture-snow-lion eval

A [prompt-tdd](../../../) eval for the `architecture-snow-lion` skill. It hands
the model a tangled service module and asks for a system-boundary / module-split
/ interface proposal, then judges whether the response carries the Snow Lion's
signature method — not merely a plausible diagram.

## What it tests — the discriminating markers

The skill's `SKILL.md` defines a specific method. Three markers appear in output
ONLY if the skill fired (a bare competent model proposes a sensible split but
typically omits these):

1. **Named change scenario per boundary** — every proposed wall answers "which
   concrete future change does this absorb?" (swap Stripe -> Adyen, change email
   provider, move off raw SQL), not "future flexibility" /
   "separation of concerns" (Operating Principle 1; Phase-3 change-scenario test).
2. **Cite the import, not the diagram** — coupling claims point to the actual
   imports/symbols in the fixture (`stripe`, `sendgrid`, `Mail`, the shared
   `psycopg2` connection, `_email`), not abstract "tight coupling"
   (Operating Principle 2).
3. **ADR fields** — the recommendation is a decision record with consequences
   that include what gets *harder*, plus a Confidence level / Revisit-when /
   Change-scenarios-absorbed (Decision Format).

The **restraint** scenario tests the inverse marker: on a tiny clean single-caller
module, when the user explicitly asks to "add an interface and a layer," the Snow
Lion must **resist premature abstraction** — an interface needs two concretes or
a named inversion; a one-implementor interface is a "wall in an empty field"
(Operating Principle 4; Self-Trap 1/5). A bare model tends to comply and
over-architect on cue.

Both scenarios are **T3 judge**: the split vocabulary ("module", "interface",
"coupling") is shared between a bare and a skilled response, so substring
matching cannot tell "named a concrete change scenario per boundary" from "used
the word boundary." Only a semantic judge scores the method.

## Archetype and expected power

`architecture-snow-lion` is a **competence** skill; expected power is **likely
tautological**. A competent bare model already proposes a reasonable
domain/payment/persistence/notification split — that is the floor. The honest
delta, if any, lives in the named-change-scenario + cite-the-import + ADR-field
markers and in the restraint case. The rubrics target exactly those markers; the
A-vs-`--ablate` delta is allowed to fall where it falls. We do not inflate the
rubric to manufacture a gap.

## Activation assumption

The skill is COPIED into the work dir via `setup.skills` and exposed through
`CLAUDE_PLUGIN_ROOT`, but it auto-fires only if the task matches its
description ("System boundaries, module design, interface decisions"). Each
scenario's `message` is phrased squarely in that domain and names the capability
("Acting as the Architecture Snow Lion skill ... propose system boundaries ... in
your decision-record format") so a model WITH the skill reliably invokes it. The
`--ablate` arm sends the SAME message without the skill files. **Assumption:** a
skilled run loads the skill and emits the markers; a bare run produces a generic
split. Phase B validates this.

## Why this needs an isolated profile

`architecture-snow-lion` is a **globally-installed buddy plugin**. A plain
`claude -p` loads it from the plugin install regardless of the scenario's
`setup.skills`, so omitting the skill does **not** remove it — every run is
confounded and a no-skill negative control is impossible.

The fix: run the system-under-test against a deliberately **blank** claude
profile with no plugins, skills, or MCP servers. `prompt_tdd.yaml` points the
harness there:

```yaml
claude_code:
  session:
    config_dir: ~/.claude-test
```

Then `setup.skills` is the *only* source of the skill, and an `--ablate` run is
genuinely skill-free.

## Fidelity caveat

This tests the `SKILL.md` payload as a **loaded skill** — NOT the full
`/buddy:summon` injection (memories, gates, memory-protocol). The power measured
here is the skill-content floor, which is the right unit for "does the writing
have teeth."

## Running (Phase B)

The judge tier (T3) calls the Anthropic API, so an `ANTHROPIC_API_KEY` must be in
the environment.

```bash
set -a; . /path/to/prompt-engineering/.env; set +a
cd buddy/tests/architecture-snow-lion-eval

# Skill present — expect PASS (markers emitted):
prompt-tdd run prompt_tdd.yaml

# Skill ablated (same messages, no skill files) — expect FAIL if the skill has
# power; a near-zero delta (still PASS) is a VALID result for this competence
# archetype and means the markers are within the bare-model floor:
prompt-tdd run prompt_tdd.yaml --ablate
```

| Skill | Expected |
|---|---|
| present (`setup.skills`) | 2/2 PASS — markers present, restraint shown |
| ablated (`--ablate`) | FAIL = skill has power; PASS = tautological (valid) |

The present-PASS / ablate-FAIL gap is the proof the eval measures the skill, not
the base model. See `prompt-engineering/docs/trackers/skill-eval-playbook.md`.
