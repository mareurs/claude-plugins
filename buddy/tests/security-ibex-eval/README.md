# security-ibex — prompt-tdd eval

Measures whether the **security-ibex** SKILL.md content changes the model's
observable output when it reviews a code snippet — versus a bare model that
lacks the skill. Negative control: the isolated, plugin-free `~/.claude-test`
profile plus `prompt-tdd run --ablate`.

## What it tests

Archetype: knowledge / checklist. Expected power: **teeth likely**.

The skill is a security-review method with a concrete taxonomy, a three-phase
process (Context → Taxonomy traversal → Self-critique), a severity rubric, and
a structured finding format. The discriminating question is not "can the model
find *a* bug" (a bare model can) but "does it apply the Ibex's *method* — find
the right vuln class and threat-model it the way the skill prescribes."

### The discriminating marker

The skill names **IDOR / BOLA** (authenticated-but-not-authorized object access)
as "the #1 missed class" and "the most-missed vulnerability class in AI security
reviews." So the positive fixture (`scenarios/idor/`) is built to be a trap:

- The SQL query is **parameterized** — no injection. The injection-shaped surface
  that a bare model fixates on yields nothing high-severity.
- The real HIGH bug is an **IDOR**: `@require_login` authenticates the caller but
  the handler never checks that `invoice_id` belongs to `g.user_id`. Any logged-in
  user reads any invoice by changing the id.

The rubric scores 1.0 **only if** the review (a) names the missing-object-level-
authorization class (IDOR/BOLA/ownership-check), (b) gives a concrete exploit
sketch (a logged-in attacker requests another user's invoice_id with their own
valid session), and (c) writes it up with the Ibex's finding fields (Severity +
specific location + an ownership-scoping fix). A review whose primary finding is
SQL injection or generic "add validation" scores 0. These are markers that
appear in output **only if the skill's taxonomy + finding format fired**.

The second scenario (`scenarios/precision-clean/`) tests **precision**: a snippet
that *looks* injectable (f-string in a query, value from `request.args`) but is
safe because the value is resolved through a fixed allowlist to one of two literal
constants before reaching SQL. A skill that only pattern-matches
"f-string + query = HIGH" cries wolf and fails; the Ibex's Phase-3 self-critique
("is the exploit path reachable? am I inventing it? raise a QUESTION not a
finding") passes by tracing that the allowlist neutralizes the taint.

### Why judge tier (not output/trace)

Security vocabulary ("SQL", "injection", "user", "token", "invoice") appears in
both the fixture code and any review, so substring/regex matching cannot
distinguish "diagnosed the IDOR and threat-modeled it" from "echoed the snippet."
Only a semantic judge separates the Ibex's method from generic commentary. No
tool-use protocol is under test, so no trace tier.

## Activation assumption

The skill is copied into the work dir and exposed via `CLAUDE_PLUGIN_ROOT`, but
it auto-fires only if the task matches its description ("Security review, threat
modeling, vulnerability analysis"). Each scenario's `message` is phrased squarely
in that domain ("do a security review", "threat-model it", "Acting as the
Security Ibex skill") so a model **with** the skill reliably invokes it. The
`--ablate` arm sends the **same** message without the skill files. Phase B
validates this assumption: if the ablated arm also passes, activation was not the
differentiator and the skill lacks measured power on this task.

## Fidelity caveat

This tests the **SKILL.md payload as a loaded skill** — not the full
`/buddy:summon ibex` injection (memories, gates, memory-protocol). The power
measured here is the skill-content floor, which is the right unit for "does the
writing have teeth." A summoned Ibex with accumulated memories could do more; it
will not do less.

## Phase B — how to run it

From this directory:

```bash
# Skill present — expect PASS (the skill's method fires)
prompt-tdd run prompt_tdd.yaml

# Skill ablated — expect FAIL (bare model misses the IDOR / cries wolf).
# FAIL here = the skill has power (the A vs --ablate delta is real).
prompt-tdd run prompt_tdd.yaml --ablate
```

A genuine pass/fail split across the two arms is the evidence that the skill's
content — not generic model competence — produced the behavior. If both arms
pass, the result is honest and valid: it means a bare model already threat-models
IDOR on this fixture, and the skill is tautological *for this task* (consider a
harder trap before concluding the skill is weak in general).
