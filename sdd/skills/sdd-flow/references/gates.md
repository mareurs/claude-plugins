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

## review-guard (integration)

It gates only integration into the base branch (`baseBranch` in the config, default `main`,
then `master`): a commit or merge while on it, a push to it, `gh pr create`, `gh pr merge`.
Each needs the feature's review record, which only `/sdd:approve review <feature>` writes.
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
