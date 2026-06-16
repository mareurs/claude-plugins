# explore-project — prompt-tdd eval

Tests whether the `codescout-companion:explore-project` skill content changes a
model's observable behavior on a deliberate cross-repo, read-only exploration
request — versus a bare model that lacks the skill.

## What it tests

The skill prescribes a specific METHOD, not generic "explore well":

1. **Dispatch, don't inline.** Treat the request as a `general-purpose` subagent
   dispatch aimed at the FOREIGN repo, carrying the skill's verbatim template
   (names the path + topic, orders the subagent READ-ONLY, points it at codescout
   tools pinned with `workspace="<path>"`).
2. **Don't hand-write the bootstrap.** The skill is explicit: do NOT write
   `workspace(action="activate", ...)` / a manual foreign-project bootstrap into
   the subagent prompt — the `explore-inject.sh` hook owns it, and a hand-rolled
   version trips the hook's idempotency guard and *suppresses* the richer
   auto-bootstrap (project memories).
3. **Fixed report skeleton.** Results return as `## Exploration: <topic>` with
   `### Findings`, `### Key files`, and explicit `Confidence` / `Caveats` /
   `Follow-up` lines — presented verbatim, not re-synthesized.
4. **Boundary discipline.** "When NOT to Use": a same-repo question is explored
   inline, NOT turned into a foreign-repo dispatch.

## The discriminating marker

A bare model asked "explore the other repo at `/srv/legacy-billing` and tell me
how it handles retries" answers inline, in ordinary prose, from whatever it can
read. It does **not** (a) dispatch/template a read-only foreign-repo subagent, or
(b) emit the fixed `## Exploration:` report skeleton with the
Confidence/Caveats/Follow-up lines. Those structural markers appear ONLY if the
skill payload fired — none of the headers are present in the user's message. The
judge scores the *method* (dispatch + fixed skeleton + no hand-written
bootstrap), never the mere correctness of the retry answer.

Scenarios:
- `cross-repo/foreign-explore` — POSITIVE. Should fire: dispatch + report
  skeleton + no hand-written workspace-activate.
- `cross-repo/same-repo-precision` — PRECISION/CLEAN. Should NOT over-fire:
  current-repo question explored inline, no foreign dispatch, no Exploration
  skeleton.

## Activation assumption

The skill is copied into the work dir via `setup.skills` and exposed through
`CLAUDE_PLUGIN_ROOT`; it auto-fires only if the task matches its
description/triggers. The positive `message` is phrased squarely in the skill's
domain ("a DIFFERENT repo than the one I'm in", "run the explore-project flow",
"read-only", "structured findings report") so a model WITH the skill reliably
invokes it. The `--ablate` arm sends the SAME message with the skill files
removed. **Phase B validates this assumption** — if the positive arm fails to
activate, the message needs sharpening (it may name the capability explicitly).

## Fidelity caveat (L-7 partial control — read this)

Two layers of fidelity loss, both honest lower bounds on the skill's real power:

1. **Skill-content floor, not full injection.** This tests the `SKILL.md`
   payload as a loaded skill — NOT the full `/buddy:summon` injection (memories,
   gates, memory-protocol). The power measured is the skill-content floor, the
   right unit for "does the writing have teeth."

2. **The control is PARTIAL (L-7, MCP/subagent-coupled).** The skill's *headline*
   capability — auto-bootstrapping the foreign project's `CLAUDE.md` + codescout
   memories — is delivered by the `explore-inject.sh` PreToolUse-on-`Agent` hook,
   a PLUGIN hook that is **not** carried by `setup.skills` and is **absent** from
   the isolated `~/.claude-test` profile. So *neither* arm exercises the hook, and
   the real subagent-dispatch + auto-bootstrap loop is not reproduced in the
   harness. What remains observable from the skill content alone is the
   dispatch-template discipline and the fixed report skeleton, which is what the
   rubric scores. If the headless harness also constrains spawning a
   `general-purpose` subagent, a skill-loaded model should still emit the template
   + report skeleton it was instructed to use — and that is the scored marker.

   Consequence: the measured A-vs-ablate delta is a **lower bound**. A real
   `/codescout-companion:explore-project` run with the hook live would show
   strictly more skill-specific behavior (injected foreign memories in the
   findings) than this eval can detect.

## Phase B result (2026-06-16) — the dispatch scenario is NOT isolation-evaluable

The optimistic prediction above ("a skill-loaded model should still emit the
template + report skeleton") was **wrong in practice.** In the isolated headless
run the positive `foreign-explore` arm **FAILED**: with no real `/srv/legacy-billing`
repo, no Agent/subagent available to `claude -p`, and no `explore-inject.sh` hook in
`~/.claude-test`, the dispatch→bootstrap→report loop cannot execute, so the model
never produced the `## Exploration:` skeleton. The present-FAIL is an **environment
artifact, not a skill or rubric defect** — the L-7 pincer in full: the skill's value
needs MCP/subagent/hook context that a valid isolation control strips.

Verdict: `foreign-explore` is **not isolation-evaluable** — do not read its FAIL as
"no power." Only `same-repo-precision` is meaningfully testable here (it passed; the
bare model also stays inline → tautological boundary). A faithful eval of this skill
needs a live environment with a real foreign repo + the hook. [skill-eval-playbook L-7]

## Phase B — how to run it

From this directory:

```bash
# Positive arm — skill present. Expect PASS (skill changes behavior).
prompt-tdd run prompt_tdd.yaml

# Negative control — same messages, skill ablated. Expect FAIL.
# FAIL here = the skill has power (its content, not the prompt, drove the pass).
prompt-tdd run prompt_tdd.yaml --ablate
```

Interpretation:
- PASS positive **and** FAIL ablate → skill has teeth (delta is real).
- PASS both → tautological for these scenarios (bare model already does the
  method); sharpen markers or accept near-zero delta as a valid result.
- FAIL positive → activation failed; sharpen the `message` (see Activation).

Requires `ANTHROPIC_API_KEY` (judge tier calls the Anthropic API).
