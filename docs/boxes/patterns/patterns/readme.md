---
kind: collection
title: Good agent patterns
lifetime: ledger
commit: new-entries
entry_kinds:
- decision
- proposal
fields:
  confidence:
    type: enum
    values:
    - high
    - medium
    - low
  source:
    type: scalar
hot_cap: 12
initial_status: accepted
key_style: dated
owner: claude-plugins maintainers
statuses:
  proposed: deferred
  accepted: open
  adopted: terminal
  superseded: terminal
  dropped: terminal
template: adr
template_version: 1
---

# Good agent patterns

A pattern is a way that a surface an agent reads or calls treats the agent, kept because it saves calls, tokens or trust. Each entry names the alternatives it lost to, the cost and the evidence. Progressive disclosure is the model.

Not here: a working law (conventions), a bug, a friction, an idea with no test. A rejected alternative keeps its numbers, so nobody repeats the probe.

## Kinds and statuses

- A `decision` is `accepted`, then `superseded` (another replaces it) or `dropped` (the body says why).
- A `proposal` is `proposed`, then `adopted` (name the decision with `**Adopted as:** [[key]]`) or `dropped`. File it with `add --kind proposal --status proposed` and a `revisit_by` date in the JSON: `{"fields": {"revisit_by": "YYYY-MM-DD"}}`.

## Anchors

An `accepted` decision that code implements has anchors. In a file over the line limit, anchor the symbol (`path#symbol`), not the file. Anchor line limit: 500.

A decision not to build, or that no code implements, has `**Unanchored:** <why>`. With neither, it reads as decided and not built.

## Premises and amendments

- A premise that is an entry is a `**Rests on:** [[key]]` line.
- A change that keeps the decision in force is a dated paragraph under `## Amendments`, with the reason. Add the heading with `edit`, then `reaffirm --anchor`. `reaffirm --text` records a check, not an amendment.
- A change that replaces the decision is a `supersede`.

## Entry template

**Decision:** one sentence.

**Scope:** what it covers, and what it does not.

**Context:** the constraints and drivers, dated.

**Alternatives considered:** each, with why it lost.

**Consequences:** now easier; now harder.

**Change scenarios absorbed:** the future changes it protects against.

**Revisit-when:** the trigger.

**Evidence:** the path:line or symbol that implements it.

A proposal adds, after Decision: **Experiments:** each experiment that decides it. **Decides when:** the pass rule, fixed before the run.
