---
lifetime: ledger
singleton: false
summary: prompt audits of a repository, each with a falsifiable prediction that a later outcome scores
version: 1
entry_kinds:
- audit
statuses:
  open: open
  held: terminal
  partial: terminal
  failed: terminal
  unobserved: terminal
initial_status: open
key_style: dated
commit: new-entries
hot_cap: 12
stale_after: 30d
---

# {title}

The prompt audits of this repository. One entry per audit. An `open` entry is a prediction nobody has scored yet.

## Statuses

- `open`: audited, the prediction is not scored.
- `held`: the evidence confirms the prediction.
- `partial`: the evidence confirms part of it. The entry says which part.
- `failed`: the evidence contradicts it.
- `unobserved`: no evidence arrived and none is expected.

Score an entry with `codescout box <key> close <entry> <status> --text reason -`.

## How to add

Run `codescout box <key> add --title "<gap>"` and leave the body empty: the entry takes the skeleton below.

## Entry template

**Artifact:** <path or identifier of the prompt>

**Symptom:** <the observable failure or the requested behavior>

**Gap:** <what the stranger's reading found>

**Move:** <the one recommended move>

**Prediction:** <what the move should change: a claim the evidence can contradict>

**Eval status:** <present (n=N, rubric R) | drafted | absent>

**Confidence:** <high | medium | low, and the reason if not high>
