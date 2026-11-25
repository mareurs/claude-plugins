---
kind: collection
title: Prompt audits
commit: new-entries
entry_kinds:
- audit
hot_cap: 12
initial_status: open
key_style: dated
stale_after: 30d
statuses:
  open: open
  held: terminal
  partial: terminal
  failed: terminal
  unobserved: terminal
template: box
template_version: 1
---

# Prompt audits

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
