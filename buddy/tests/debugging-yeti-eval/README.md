# debugging-yeti eval

A [prompt-tdd](../../../) eval for the `debugging-yeti` skill. It hands the model
a bug whose **obvious surface fix is wrong** and judges whether the skill imposes
the yeti's method: trace to the upstream root cause and pin it to a specific line
*before* proposing a patch — rather than silencing the symptom at the crash site.

## What it tests — the discriminating marker

debugging-yeti is a **method** skill (hypothesis-first). Its checkable markers,
the things that appear in output ONLY if the skill fired:

- **Root-cause hypothesis before patch** — names the misbehaving expression and
  the upstream line, and treats the tempting symptom-site guard as a patch that
  *hides* the bug (SKILL.md Phase 3: "Does the fix address root cause or
  symptom?" / "Can I name the misbehaving expression?"; Heuristic 6: a defensive
  surface guard is the wrong thing).
- **Reproduction over reasoning + explicit confidence** — refuses a confident
  single cause when there is no repro, demands one first, and marks suspicion as
  low/medium confidence (Operating Principle 1 & 3).

Two scenarios, the two sides of the method:

| scenario | side | the marker |
|---|---|---|
| `surface-fix-wrong` | positive | identifies the mutable-default `items=[]` at line 2 as root cause, gives the per-instance fix, and rejects the `inv.discounts.get(...)` guard as a symptom patch |
| `no-repro-no-cause` | precision | withholds a confident single cause, demands a reproduction first, anchors suspects to the CI-vs-local + intermittent heuristics |

Both are **T3 judge**: a pass is structural (named the upstream cause / withheld
false certainty), not a literal token. A substring match cannot tell a real
diagnosis from a confident-sounding symptom patch, so only a semantic judge can
score the discriminator.

## Activation assumption

The skill is **copied** into the work dir and exposed via `setup.skills`; it
auto-fires only if the task matches its description ("Bug resists surface fixes,
flaky tests, failure doesn't match symptom"). Each scenario's `message` is phrased
squarely in that domain (a resisting bug; an intermittent flaky test) and names
the capability ("Acting as the Debugging Yeti skill, debug this") so a model WITH
the skill reliably invokes it. The `--ablate` arm sends the **same** message with
the skill files removed. Phase B validates this assumption: if the ablated arm
also passes, activation (or the marker) is too weak and the rubric is tautological.

## Why this needs an isolated profile

`debugging-yeti` ships in a **globally-installed buddy plugin**. A plain
`claude -p` loads it regardless of `setup.skills`, so omitting the skill does not
remove it — every run would be confounded and a no-skill negative control
impossible. `prompt_tdd.yaml` points the harness at a blank, plugin-free profile:

```yaml
claude_code:
  session:
    config_dir: ~/.claude-test
```

so `setup.skills` is the *only* source of the skill and `--ablate` is genuinely
skill-free. (See the codescout-pika-eval README for the one-time `~/.claude-test`
profile setup; the same blank profile is reused here.)

## Fidelity caveat

This tests the **SKILL.md payload as a loaded skill** — NOT the full
`/buddy:summon debugging-yeti` injection (memories, gates, memory-protocol, the
yeti's voice framing). The power measured here is the **skill-content floor**:
does the writing alone change the model's diagnostic behavior. The summoned
specialist could score higher (memories reinforce the discipline) or the gates
could change phrasing; this eval isolates the prose's teeth, which is the right
unit for "does the writing have teeth." Also out of scope: live reproduction (the
headless harness has no test runner) and the multi-run flaky-test loop.

## Running (Phase B)

The judge tier calls the Anthropic API, so an `ANTHROPIC_API_KEY` must be in the
environment (the adapter strips it from the isolated subprocess only — the judge
still sees it):

```bash
set -a; . /path/to/prompt-engineering/.env; set +a
cd buddy/tests/debugging-yeti-eval
```

Two commands prove the eval has teeth:

```bash
prompt-tdd run prompt_tdd.yaml            # skill present  → expect 2/2 PASS
prompt-tdd run prompt_tdd.yaml --ablate   # skill removed   → expect FAIL (0/2)
```

The GREEN-with / RED-without gap is the proof the eval measures the skill, not the
base model. If `--ablate` also passes, the rubric is tautological for this
archetype — a valid result to record, not a bug to paper over.
