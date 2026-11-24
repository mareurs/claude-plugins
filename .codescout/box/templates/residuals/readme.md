---
lifetime: ledger
summary: the work that a finished piece left open, one box per source box; never ends
candidate_min: 5
commit: new-entries
entry_kinds:
- residual
fields:
  topics:
    type: list
  source:
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
---

# Residuals

The work that a finished piece left open. One entry per residual. It never ends.

## Rules

- File here what a closed issue, a merged plan or a review left undone. A residual that has an owner and a date is a bug or a task: file it in that box.
- Set `source` to the issue, plan or entry that left it, and give the entry at least one topic.
- Write the end condition in `**Done when:**`. A residual with no end condition is a wish: drop it.

## How an entry ends

- `done`: finished, with the commit or the measurement in the closing line.
- `promoted`: it became a bug, a task or a decision. The entry names it in a `**Promoted to:**` line.
- `dropped`: nobody will act on it. The entry says why in one line.
- `blocked`: it waits on something named in the entry.

## Entry template

**What is open:** <one line, with the evidence>

**Done when:** <one checkable condition>

**From:** <the issue, plan or entry that left it>
