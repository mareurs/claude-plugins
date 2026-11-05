---
name: sdd-flow
description: Use when starting, resuming or finishing a feature in a project that has `.sdd/config.json` (strict spec-driven development). Walks the nine-step flow from spec to merge and says which steps the user must approve by typing a command.
---

# sdd-flow

`sdd` makes the superpowers flow strict. It does not replace superpowers skills; it adds gates
that the user opens. This skill is the map: which skill to call at each step, and where the
user has to act.

## The rule

**Enforcement comes from the hooks, not from this guide.** You ask the user to type
`/sdd:approve ...`; you never edit status fields (`status: approved`, `approved:`,
`implemented`, `done`) and you never write the approval record yourself. A tool write to
those fields is denied, and a typed command is the only thing that opens a gate.

You may write `status: draft`, `feature:`, `kind:` and `branch:` in frontmatter.

## The nine steps

1. **Resume.** Find the feature's spec and plan before starting anything new. Query the
   catalog; the calls are in `references/artifacts.md`. Re-enter at the first step whose
   gate is not yet open.
2. **Design.** Call `superpowers:brainstorming`. Its design doc is the spec, saved under
   `docs/superpowers/specs/`. Give it `kind: spec`, `status: draft`, `feature: <slug>` and
   the tag `sdd`.
3. **Gate 1.** Stop and ask the user to type `/sdd:approve spec <feature>`. Do not go on to
   planning before they have.
4. **Plan.** Call `superpowers:writing-plans`. Its template line `**Spec:** [path ...]` must
   be filled with the plain root-relative path, optionally in backticks:
   `**Spec:** docs/superpowers/specs/2026-11-05-x-design.md`. A Markdown link is not
   followed, and the plan then never becomes active. Give the plan `kind: plan`,
   `status: draft`, `feature: <slug>`.
5. **Gate 2.** In this order:
   1. Commit the spec and the plan while the plan is still `draft`. No plan is active yet,
      so a commit on the base branch passes the review guard. The worktree starts from HEAD
      and would not contain them otherwise.
   2. Ask the user to type `/sdd:approve plan <feature>`.
   3. Write `branch: <name>` into the plan's frontmatter (an allowed field).
   4. Create the worktree and the feature branch.

   The approval frontmatter that `/sdd:approve` writes after the commit stays an uncommitted
   change in the main checkout; the hooks read it there. It is committed together with the
   integration, after `/sdd:approve review`. Do not try to commit it on the base branch
   before that: the review guard refuses.
6. **Execute.** Call `superpowers:subagent-driven-development`, or
   `superpowers:executing-plans` for inline work. Source writes are denied until the plan is
   active; stay inside the spec.
7. **Drift.** Call `codescout-companion:spec-drift`. It compares the spec's acceptance
   criteria with the code and records a verdict on the spec. A Missing or Divergent
   criterion is a NO-GO: stop, and change the code or the spec before going on.
8. **Review.** Run the `review` command. It checks the constitution and the drift verdict
   and writes a GO or NO-GO report. On GO, ask the user to type
   `/sdd:approve review <feature>`, and tell them to read the report first: that typed
   command is the real gate.
9. **Finish.** Call `superpowers:finishing-a-development-branch`; the merge or PR it
   produces is what the review gate guards. Then ask the user to type
   `/sdd:approve done <feature>`, and record the merge commit or PR as a note on the spec.
   The calls are in `references/artifacts.md`.

## After each approval

The hook confirms in one line. Record it as an event on the spec (see
`references/artifacts.md`), then continue with the next step.

## Where the detail lives

- `references/gates.md`: what each gate denies, when, and what to do when a tool call is
  denied. Read it when a write or a git command is refused.
- `references/artifacts.md`: frontmatter fields, the plan-is-active rule, the catalog and
  event calls, the git common directory. Read it at step 1 and after any approval.

Without `.sdd/config.json` none of this applies: the hooks stay silent and superpowers runs
as usual.
