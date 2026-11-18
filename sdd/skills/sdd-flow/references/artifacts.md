# Artifacts in a strict project

## Files

| Artifact | Path | Frontmatter you may write | Frontmatter only `/sdd:approve` writes |
|---|---|---|---|
| Spec | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | `kind: spec`, `status: draft`, `feature: <slug>`, tags `sdd` | `status: approved`, `approved:`, `implemented` |
| Plan | `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` | `kind: plan`, `status: draft`, `feature: <slug>`, `branch: <name>`, tags `sdd` | `status: approved`, `approved:`, `done` |
| Config | `.sdd/config.json` | written by `/sdd-init` | |

A feature slug matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`. A missing `status` counts as `draft`.

A plan is **active** when it is `approved` and its `**Spec:**` line names an `approved` spec.
The `**Spec:**` line is a plain root-relative path, optionally in backticks. A Markdown link
is not followed. Source writes need an active plan; with several active plans, the one whose
`branch:` equals the current branch counts.

## Approval forms

The user types one of these as the whole prompt (`/approve ...` and `sdd approve ...` work too):

- `/sdd:approve spec <feature|path>`
- `/sdd:approve plan <feature|path>`
- `/sdd:approve review <feature>`
- `/sdd:approve done <feature|path>`

Spec and plan approval work only on a `draft` file. `done` needs an approved spec and an
approved plan. `review` is refused unless the report says GO twice (see the `review`
command).

## Catalog calls

Find the feature's spec and plan (step 1):

```python
doc(action="find", kind="spec", filter={"tags": {"contains": "sdd"}})
doc(action="find", kind="plan", filter={"tags": {"contains": "sdd"}})
```

Record an approval or the merge on the spec (after each approval, and at step 9):

```python
doc(action="event_create", id="<spec id>", event={"kind": "note", "payload": {"text": "approved by the user: spec"}})
```

Read the drift verdicts on a spec (newest first):

```python
doc(action="event_list", id="<spec id>", kinds=["verdict"])
```

## The git common directory

The approval records and the review report live outside the tree, under the repository's
common git directory, not under a worktree:

```
git rev-parse --git-common-dir
```

That prints the main repository's `.git` directory (an absolute path when run from a linked
worktree, `.git` from the main checkout). The approvals are under `<that>/sdd/approvals/`.
Running this command is a read and is allowed.
