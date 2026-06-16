# testing-snow-leopard — prompt-tdd eval

Measures whether the `testing-snow-leopard` skill content changes how the model
**writes and reviews unit tests**, versus a bare model that lacks the skill.

## What it tests

The skill's distinctive method, not generic "good tests." Two markers carry the
discrimination, both drawn straight from `SKILL.md`:

1. **Boundary over middle** (Operating Principle 2, Phase 1.2) — edges enumerated
   per parameter (`0`, negative, threshold off-by-one, max/at-the-limit) before
   the happy path.
2. **Observable outcomes, not call counts** (Operating Principle 4, Heuristic 1,
   Self-Trap 1) — assert on returned values and visible/persisted state, and
   treat spy assertions (`assert_called_once`, `call_count`, `mock.called`) and
   `is not None` as tautological decoration to be rejected.

### Scenarios

- `scenarios/write/boundary-and-observable/` — **positive.** Asks for a test
  suite for `apply_discount(qty, audit_log)`, a unit with a real edge surface
  (qty 0 / negative / bulk-threshold off-by-one) AND a side-effecting `audit_log`
  dependency that baits a call-count spy. Rubric scores boundary coverage AND
  observable-outcome assertions, each worth half; deducts the second half if the
  side effect is checked only via a mock call-count.
- `scenarios/review/tautology-detection/` — **precision.** Hands the model a
  green, passing suite whose every assertion is a tautology (`is not None`,
  truthiness, `assert_called_once`) and asks "is this enough?" Rubric passes only
  if the review names the assertions as tautological, makes it concrete with a
  mutation / specific wrong return value the suite would miss, and proposes a
  specific-value assertion. The trap: a passing suite that looks fine until you
  ask what a failure would have caught.

## The discriminating marker

A bare model, asked to test a small function, tends to write one happy-path test
and — when a dependency is present — reach for a mock spy (`assert_called_once`),
and when asked "is this enough?" tends to rubber-stamp a green suite or pad it
with more of the same. The skill forces (a) boundary enumeration before the happy
path and (b) assertions on observable outcomes with explicit rejection of
call-count/`is not None` tautologies. The judge reads the produced code/review
and scores on exactly those two axes — quality phrased as the skill's method, not
as taste.

## Activation assumption

The skill is copied into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`; it
auto-fires only if the task matches its description (`Designing test suites,
coverage gaps, flaky tests, asserting correctness`). Both messages are squarely
in-domain — "write a unit test suite … catch bugs" and "these tests pass … is
this enough" — so a model WITH the skill should reliably invoke it. The `--ablate`
arm sends the SAME message with the skill files absent. Phase B validates this
assumption: if the ablated arm also passes, the task did not discriminate (the
markers were bare-model default) and the result is a valid near-zero delta.

## Fidelity caveat

This exercises the `SKILL.md` payload as a **loaded skill** — NOT the full
`/buddy:summon testing` injection (specialist memories, gates, memory-protocol,
the Snow Leopard voice framing). Power measured here is the skill-content floor:
"does the writing in SKILL.md have teeth on its own." The summoned specialist may
score higher; it will not score lower.

This is a `method` archetype with **expected power: partial** — a competent bare
model already knows about edge cases and may produce some boundaries unprompted,
so a real (but not maximal) delta is the honest expectation. Do not read a
moderate delta as failure.

## Phase B — how to run it

From this eval directory:

```bash
# WITH the skill — expect PASS (markers present)
prompt-tdd run prompt_tdd.yaml

# WITHOUT the skill (negative control) — expect FAIL
# A FAIL here = the skill has power (the markers came from the skill, not the
# bare model). A PASS here = tautological eval / bare-model default; report the
# near-zero delta honestly rather than inflating the rubric.
prompt-tdd run prompt_tdd.yaml --ablate
```

The judge calls the Anthropic API — run with `ANTHROPIC_API_KEY` set.
