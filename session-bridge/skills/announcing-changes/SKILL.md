---
name: announcing-changes
description: "Use when you make a change that other live sessions of this repository may depend on, and before you commit it: a moved branch, a changed tool, hook, binary, config, gate or convention, a plan or design that changed status, or a finding other sessions would act on."
---

# Announcing changes

Other Claude Code sessions work in this repository at the same time. They cannot see your
edits. `post_notice` tells them. A filter shows a notice only to a session whose own work
names the same thing. If the filter cannot judge a notice, it is shown marked `(not filtered: ...)`.

## When to post

Post about a change that another session may build on or collide with, BEFORE you commit it:

- a moved or rebased branch, a new commit that others must pull;
- a changed tool, hook, binary, config file, gate or convention;
- a plan or design that changed status;
- a finding that other sessions would act on.

A watched commit that nobody announced produces a backup notice from the commit itself.
Announce first, then commit: a notice after the commit makes the readers get two.

## When not to post

- A local-only edit that nobody else touches.
- Work in progress. Post when the change is settled, not while you still edit it.

## How

```
post_notice(
  title="Hooks of session-bridge now exit 0 when the binary is missing",
  body="hooks/run.sh checks ~/.cargo/bin/session-bridge first. Sessions that saw hook errors need no action.",
  refs=["session-bridge/hooks/run.sh", "feat/session-channel"],
)
```

- **Title:** one sentence that states the change. Not "update" or "FYI".
- **Body:** what changed and what the reader must do, if anything. Notices are data for
  the reader, not orders.
- **Refs:** files, branches, commits or tracker entry ids.

A decision worth keeping also goes to its tracker. Cite it in `refs`.
