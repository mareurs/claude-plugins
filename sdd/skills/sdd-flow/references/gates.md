# The gates

All gates apply only when `.sdd/config.json` exists. The project root is the main checkout,
also while you work in a worktree. In `strict` mode a gate denies; in `warn` mode it only
adds a note.

## spec-guard (writes)

- A write to source needs an active plan. Writes under `docs/`, `.sdd/`, `.claude/`,
  `.codescout/` and to `*.md`, `*.json`, `*.yaml`, `*.yml`, `*.toml`, `*.ini`, `*.env` are
  exempt.
- Any tool write that sets `status: approved`, `implemented`, `done` or `approved:` on a
  spec or plan is denied, in every mode. Ask the user to type the matching
  `/sdd:approve ...` instead.
- A tool write into the approvals directory is denied, except `<feature>.report.json`.
- After `/sdd:approve done`, the next source write needs a new approved spec and plan.

## Committing spec and plan

Commit them while the plan is still `draft`: this feature's plan is not active then, so
review-guard lets a commit on the base branch through (unless another feature's plan is
active and not yet review-approved; see Known limits). Once the plan is approved and has no
`branch:` yet, a commit on the base branch is denied and asks for a review approval that
cannot exist before any code. So the order is commit, `/sdd:approve plan`, `branch:`,
worktree. What `/sdd:approve` writes after the commit stays an uncommitted change in the
main checkout (the hooks read it there). At step 9, after `/sdd:approve review` and
before any merge, commit the spec and plan frontmatter on the base branch; then merge. In the
other order `git merge` refuses whenever the branch touched the plan. For a PR, commit it on
the base branch the same way before `git pull` brings in the merged PR; pushing that commit
is gated and the review record satisfies the gate. The `implemented`/`done` frontmatter that
`/sdd:approve done` writes is committed too; the plan is then inactive, so that commit is
not gated.

## review-guard (integration)

It gates only integration into the base branch (`baseBranch` in the config, default `main`,
then `master`): a commit or merge while on it, a push to it, `gh pr create`, `gh pr merge`.
Each needs the feature's review record, which only `/sdd:approve review <feature>` writes,
and the record counts only while its head is the current tip of the plan's `branch:`. A
commit added to the branch after the approval needs a new review and a new
`/sdd:approve review <feature>`. A commit on the base branch is judged against the plan
branch tip, not the base HEAD, so the frontmatter commit at step 9 passes. With several
active plans, a commit or push on the base branch passes when every one has a valid record.
Commits on a feature branch pass. A shell command that writes into the approvals directory
is denied.

## What to do when a call is denied

1. Read the reason; it names the missing gate.
2. Do not retry with a shell write or by editing a status field. Ask the user to type the
   command the reason names.
3. If the reason says several plans are active, ask the user which feature this is, and put
   `branch:` in the right plan.

## Known limits

Shell writes (`sed -i`, `>`, `tee`) are not detected by spec-guard, and a deliberate shell
write could forge a report or a record. The hooks stop edits made through edit tools; they
are not a sandbox. Do not use that gap. Editing a plan's `branch:` to widen the gate is the
same kind of deliberate act.

While one feature's plan is active and not yet review-approved, a new feature's spec and
plan cannot be committed on the base branch: wait for that review, or commit them from the
new feature's branch. A fix committed on the base branch after the merge, while the plan is
still approved and its branch tip unchanged, passes review-guard; run `/sdd:approve done`
promptly after the merge.
