# ml-training-takin-eval

prompt-tdd benchmark for the `ml-training-takin` buddy skill (builtin).
Archetype: **method (inference parity)**. Expected power: **partial**.

## What this tests

The takin skill's discipline for a **train/inference parity mismatch** — the
"great in the notebook, worse in production" symptom. The discriminating marker
is not "mentions parity" (any model can say the word); it is the skill's full
method fingerprint appearing together:

1. **Names the failure mode** out of the skill's taxonomy —
   `optimization | generalization | pipeline` — and picks *pipeline*
   (train-serve skew) with evidence, rather than listing causes flatly.
2. **Prescribes the parity TEST**: push one sample through both the training and
   serving preprocessing paths and **assert the model-input tensor is
   byte-identical**, ideally via one shared preprocessing function called from
   both sides. (Skill Phase 2.6, Self-Trap 7 "parity-skip".)
3. **Defers blaming the model/checkpoint** and explicitly says *do not retrain /
   do not go bigger* until parity is ruled out. (Operating Principle 2,
   Self-Trap 1 "bigger-model reflex".)
4. **Enumerates concrete drift suspects**: tokenizer version, normalization
   constants, categorical/label encoding maps, image resize interpolation, audio
   resample algorithm. (Heuristic 4.)

A bare model typically produces a generic differential (data drift, the
checkpoint, the environment, "retrain with more data") and rarely lands all four
elements — especially the assert-equal parity test plus the explicit
do-not-retrain-yet ordering. That gap is the skill's power.

### Scenarios

- `scenarios/parity-mismatch.yaml` — **positive**. Notebook 95% vs production
  60%, same checkpoint. Pass = the four-element parity fingerprint above.
- `scenarios/generalization-not-parity.yaml` — **precision / clean case**.
  Train 99% vs val 71% with a parity test *already passing*. This is a
  generalization failure, not a pipeline one. Pass = the skill names
  generalization and reaches for generalization fixes, and does NOT re-prescribe
  the parity test. Catches a "chant train-serve-skew reflexively" pattern-matcher
  and proves the failure-mode taxonomy actually discriminates.

## Activation assumption

The skill is copied into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`; it
auto-fires only when the task matches its description ("Training loops, inference
parity, ML pipeline issues"). Both messages are phrased squarely in that domain
(notebook-vs-production accuracy gap; train-vs-val curve), so a session **with**
the skill should reliably invoke it. The `--ablate` arm sends the identical
message with the skill files removed. Phase B validates this assumption: if the
positive scenario does not pass even **with** the skill, activation failed and
the message needs to name the capability more directly.

## Fidelity caveat

This exercises the `SKILL.md` payload as a loaded skill — NOT the full
`/buddy:summon ml-training-takin` injection (specialist memories, gates,
memory-protocol, persona framing). The power measured here is the
**skill-content floor**: does the writing alone change observable output. The
summoned specialist may diagnose more sharply than this floor.

Note: this skill has no `_<lens>.md` addenda (single `SKILL.md`); nothing extra
was loaded.

## Phase B — how to run it

From this directory, with `ANTHROPIC_API_KEY` set (the judge calls the API):

```sh
# Expect PASS — skill present, the parity method should fire.
prompt-tdd run prompt_tdd.yaml

# Expect FAIL — skill ablated; a bare model should miss the full fingerprint.
# A FAIL here is the GOOD result: it means the skill has teeth (power).
prompt-tdd run prompt_tdd.yaml --ablate
```

Interpretation: **PASS with skill + FAIL on `--ablate` = the skill has power.**
For this *partial* archetype, the expected delta is real but not maximal — a
strong bare model may earn partial credit on the positive scenario by naming
"train-serve skew" generically while still missing the assert-equal test and the
do-not-retrain-yet ordering. The precision scenario should pass in both arms
(generalization is a more common bare-model instinct); its job is to keep the
positive scenario honest, not to manufacture a delta.
