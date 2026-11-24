---
kind: collection
title: Runtime
candidate_min: 5
commit: new-entries
entry_kinds:
- note
- question
- idea
- lesson
- residual
- script
- decision
- measurement
fields:
  topics:
    type: list
  source:
    type: scalar
  not_a_box:
    type: scalar
hot_cap: 12
initial_status: open
key_style: dated
stale_after: 30d
statuses:
  open: open
  blocked: blocked
  done: terminal
  promoted: terminal
  dropped: terminal
  superseded: terminal
template: runtime
---

# Runtime

The entries of this repository that no other box holds: notes, questions, ideas, lessons, scripts, decisions and measurements. It never ends.

## Rules

- File here what has no other box. If a box fits, file there; the root view lists them.
- Give every entry at least one topic. Reuse a topic that the root view or `codescout box list` shows before inventing one. `check` reports each open entry with no topic.
- A `script` entry holds the script in a fenced block, at most 150 lines. The box commits it as a record; nothing runs it. A longer script, or one used a second time, becomes a root verb with a test, or goes to `scripts/`.
- A `lesson` that held up goes to a memory topic, a convention or a box, and is never left `open` as a trophy: close its entry with `codescout box close <entry> promoted --text reason -` and the line `**Promoted to:** <where>` on stdin.

## How an entry ends

- `done`: finished, and nothing is worth keeping.
- `promoted`: the content went to a box that lasts, or to a file. The entry names it in a `**Promoted to:**` line.
- `dropped`: nobody will act on it. The entry says why in one line.
- `superseded`: a newer decision replaces this decision. `codescout box supersede <old> --title T --text body -` files the new decision and closes the old one.

## Entry template

**What:** <one line>

**Why it matters:** <one line>

**Next step:** <one line, or "none">
