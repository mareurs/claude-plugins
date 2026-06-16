# reconnaissance eval

A [prompt-tdd](../../../) eval for the `codescout-companion:reconnaissance` skill.
It presents a seam-contact task — a plan that names code shape the model has not
read — and judges whether the model scouts the real shape BEFORE acting and
externalizes the plan-vs-reality gap as an `F-N` session-log entry with a
**monotonic ID**.

## What it tests

`reconnaissance` is a protocol skill. Its checkable method markers — the things
that appear in output ONLY if the skill fired — are:

1. **Scout-before-act ordering.** The model reads the actual shape of the symbol
   it is about to touch *before* editing or asserting a fact about it.
2. **Plan-vs-reality compare.** An explicit "plan said X / reality holds Y" gap
   statement (Phase 2).
3. **F-N / W-N externalization with a monotonic ID.** The gap is written into
   `docs/trackers/<topic>-session-log.md` as the **next** monotonic integer
   (never reused, never skipped), in the anchored entry shape
   (Expected vs Got split, Severity from {low, med, high} with a concrete cost,
   Status from the friction enum), with concrete identifiers (file path, field
   name). IDs are what make the lesson portable — "entries without IDs don't
   compound."
4. **One-line announcement citing the ID** (Phase 4).

## The discriminating marker

The crux is the **monotonic-ID allocation** plus the **scout-before-edit**
ordering. The positive scenario pre-seeds the tracker with `F-1` and `F-2`
(and `W-1`), so the only correct new friction ID is `F-3`. A bare model handed
the same prompt:

- has no concept of an `F-N` session-log entry or monotonic-ID allocation, so it
  produces no ID-bearing entry at all (or an arbitrary/`F-1`/`W-` number);
- tends to implement the plan straight from the prompt text, walking into the
  fictional `expiry_ts` field (the real field is `deadline_unix`) instead of
  scouting first.

So the skill-present arm allocates `F-3` with the right shape and uses
`deadline_unix`; the `--ablate` arm does neither. That gap is the skill's power.

Scenarios:

| Scenario | Mode | What it proves |
|---|---|---|
| `seam-contact/gap-capture` | judge | Positive: scout-first + catch the `expiry_ts`/`deadline_unix` drift + write `F-3` (next monotonic ID) in anchored shape + cite the ID. High expected delta. |
| `precision/no-decision-edit` | judge | Precision/control: a mechanical docstring typo (in "When NOT to Use") must NOT trigger an entry. Guards over-firing. **Low expected delta** — see below. |

## Why this needs an isolated profile

`codescout-companion:reconnaissance` ships in a **globally-installed plugin**. A
plain `claude -p` loads it regardless of `setup.skills`, so omitting the skill
does not remove it and every run is confounded. `prompt_tdd.yaml` points the
harness at a blank, plugin-free profile via:

```yaml
claude_code:
  session:
    config_dir: ~/.claude-test
```

so `setup.skills` is the *only* source of the skill and `--ablate` is a real
no-skill control. (One-time `~/.claude-test` setup is documented in the
`codescout-pika-eval` README; the same blank profile is reused.)

## Activation assumption

The skill is COPIED into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`, but
it auto-fires only if the task matches its description. The skill's description
triggers on "before editing code that changes a struct, function signature, or
API contract" and on capturing friction. The positive scenario's `message` is
phrased squarely in that domain: implement a plan that names a struct field,
and "record any reconnaissance finding in the work-stream session log" — naming
both the seam-contact and the session-log capability. **Activation assumption:**
a model WITH the skill loaded reliably invokes the scout-before-act + F-N
protocol on this message; the `--ablate` arm receives the SAME message without
the skill files. Phase B validates this assumption empirically.

## L-7 caveat — PARTIAL control

This skill is **MCP-coupled** (level 7): its native method runs on codescout
tools (`symbols(include_body=true)`, `references`, `edit_markdown` with
`insert_before`) and on a **librarian tracker artifact**. The isolated
`~/.claude-test` profile strips ALL MCP. Consequences:

- The **scout** is exercised with plain `Read`/`Grep` instead of `symbols`/
  `references`. The *discipline* (read actual shape before acting) survives; the
  specific codescout tool calls do not.
- The **tracker** is supplied as a `setup.files` fixture (a pre-seeded
  `auth-refactor-session-log.md`) so the model has a real seam-log to append to
  with plain file tools. The skill's `cp <template>` bootstrap, `edit_markdown`
  append mechanism, librarian artifact model, and `recon_count.py` statusline
  bump are **NOT** exercised.

What the eval measures is therefore the **MCP-independent core**: scout-before-
act ordering, plan-vs-reality compare, monotonic-ID allocation, and entry shape.
The MCP plumbing is out of scope. **Flag: this is a PARTIAL negative control** —
a `--ablate` FAIL proves the *content* (the protocol the SKILL.md teaches) has
teeth, but does not exercise the full MCP-coupled flow as it runs in production.

## Fidelity caveat

This tests the `SKILL.md` payload as a loaded skill — NOT the full
`/buddy:summon` injection (memories, gates, memory-protocol) and NOT the live
codescout MCP / librarian backend. Power measured here is the skill-content
floor: "does the writing have teeth," which is the right unit for this benchmark.
There are no `_<lens>.md` addenda for this skill (only `SKILL.md`,
`references/reconnaissance-patterns-template.md`, and `recon_count.py`).

### Note on the precision scenario's delta

`precision/no-decision-edit` is a CONTROL: a bare model also writes no tracker
entry for a typo, so the A-vs-`--ablate` delta on the "no entry" marker is
expected to be **near zero**. That is a valid, honest result — the scenario's
job is to confirm the skill does not *over-fire* (manufacture an F-N for a
mechanical edit), not to manufacture a delta. Do not inflate this rubric to
force a gap.

## Phase B — how to run it

The judge tier calls the Anthropic API, so `ANTHROPIC_API_KEY` must be in the
environment (the adapter strips it from the isolated subprocess only — the judge
still sees it):

```bash
set -a; . /path/to/prompt-engineering/.env; set +a
cd buddy/tests/reconnaissance-eval

# Skill-present arm — expect PASS (both scenarios green):
prompt-tdd run prompt_tdd.yaml

# No-skill negative control — expect the positive scenario to FAIL
# (= the skill has power). The precision scenario may stay green (low delta):
prompt-tdd run prompt_tdd.yaml --ablate
```

A GREEN-with / RED-without gap on `seam-contact/gap-capture` is the proof the
eval measures the skill, not the base model. See
`prompt-engineering/docs/trackers/skill-eval-playbook.md`.
