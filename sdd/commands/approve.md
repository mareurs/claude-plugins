---
description: Approve a spec, plan or review, or mark a feature done (user-only; the hook does the writing)
disable-model-invocation: true
---

# /sdd:approve

Approval in a strict sdd project comes from you, not from the agent. When you
submit this command, the `approve-intake` UserPromptSubmit hook reads the text you
typed and writes the approval itself. The model cannot trigger that hook, and the
PreToolUse guards deny any tool call that tries to write the same fields.

## Forms

- `/sdd:approve spec <feature-or-path>` sets `status: approved` and
  `approved: <today>` on the spec (also `kind: spec` and `feature:`). A path must
  be under `docs/superpowers/specs/`.
- `/sdd:approve plan <feature>` does the same for the plan. Refused unless the
  plan's `**Spec:**` pointer names an approved spec.
- `/sdd:approve review <feature>` writes the review approval record under
  `<main repo>/.git/sdd/approvals/`. Refused unless the review command left
  `<feature>.report.json` with `outcome` and `drift_outcome` both `go`.
- `/sdd:approve done <feature>` finishes the feature: spec `implemented`, plan
  `done`.

## What you will see

The hook injects one line saying what it did, or why it refused and wrote
nothing. This command file does no writing; it exists so the command shows in
the slash menu and explains itself. If sdd is not initialised in the project
(no `.sdd/config.json`), the hook says so and writes nothing.

After an approval, follow the `sdd-flow` guide and record the event on the spec.
