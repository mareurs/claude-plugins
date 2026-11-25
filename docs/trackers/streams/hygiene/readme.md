---
kind: collection
title: Tracker hygiene sweeps
commit: new-entries
entry_kinds:
- sweep
- meta
fields:
  next_sweep_due:
    type: scalar
exit_when: the repository stops running tracker hygiene
hot_cap: 12
initial_status: open
key_style: dated
stale_after: 30d
statuses:
  open: open
  done: terminal
  promoted: terminal
  dropped: terminal
template: worklog
template_version: 1
---

# Tracker hygiene sweeps

The log of the `codescout-companion:tracker-hygiene` skill. The skill adds the entries; the SessionStart hook reads the due date.

## What goes here

- `sweep`: one per sweep, filed with `--status done`. The body holds the scope, the table of findings per detector, every reject with its verbatim reason, the fixes applied, and the detector trust table after the update. The frontmatter field `next_sweep_due` (`YYYY-MM-DD`) is the sweep date plus 30 days. The newest `sweep` entry is the state of the project: the next sweep reads its trust table, and the hook reads the greatest `next_sweep_due`.
- `meta`: an observation about the skill itself. Its body starts with `**Verdict:**`, one of `hit`, `miss`, `false-positive-pattern`, `proposal`, `promoted`, `wontfix`.

## How an entry ends

- `done`: finished, and nothing is worth keeping. A `sweep` starts here.
- `promoted`: a `meta` proposal landed in `SKILL.md`. The entry names the commit and plugin version in a `**Promoted to:**` line.
- `dropped`: nobody will act on it. The entry says why in one line.

## Entry templates

The skill holds them: `skills/tracker-hygiene/references/tracker-hygiene-log-template.md`.
