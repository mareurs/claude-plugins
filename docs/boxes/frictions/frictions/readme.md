---
kind: collection
title: Frictions
lifetime: ledger
commit: new-entries
entry_kinds:
- friction
fields:
  severity:
    type: enum
    values:
    - low
    - med
    - high
  friction_kind:
    type: enum
    values:
    - wrong-guidance
    - misleading-output
    - gate-too-strict
    - gate-too-loose
    - param-confusion
    - missing-capability
    - silent-failure
    - discoverability
    - hint-ineffective
    - latency
    - other
  tool:
    type: scalar
  fr:
    type: scalar
  session:
    type: scalar
hot_cap: 12
initial_status: inbox
key_style: dated
owner: operator
stale_after: 30d
statuses:
  inbox: open
  open: open
  fixing: open
  fixed-verified: terminal
  not-a-friction: terminal
  wontfix: terminal
  duplicate: terminal
template: issues
---

# Frictions

Measured places where an agent loses calls, work or trust to a hook, deny message, skill, mod or script of a plugin here. A friction of the codescout tools goes to the codescout repository's `frictions` box. Plan drift goes to `recon`.

## What counts as a friction

Count is not friction: a gate that the next call obeys is healthy teaching. Admit an entry when one holds:

- the agent repeats a call after an error, needs three or more calls to recover, or never recovers;
- it routes around the surface it was meant to use;
- the text is wrong or gives no hint, or the call succeeded but misled;
- it passes a parameter the tool does not declare;
- a hook or mod refuses what it should allow;
- latency makes agents retry or give up.

## Rules for entries

1. Evidence or nothing: every number names its query or script, UTC window and corpus.
2. Cite the recovery: sample five rows or more and say what the next calls were.
3. A fix cites its entry in the commit message. `fixed-verified` needs a re-measurement and the commit SHA.

## Statuses

`inbox`: one unmeasured observation, filed by `note`. `open`: admitted, has an `FR-N`. `fixing`: names the branch. `not-a-friction`: the recovery is healthy. `wontfix` and `duplicate` (names the other key) say why.

## Verbs

- `note --title T --tool X` files an inbox entry with your failed calls of the last 30 minutes.
- `recent` shows those calls and files nothing.
- `admit <key>` refuses until the body has `**Query:**`, `**Window:**`, `**Corpus:**` and `**Recovery sample:**` (see [the template](../../frictions/entry-template.md)).
