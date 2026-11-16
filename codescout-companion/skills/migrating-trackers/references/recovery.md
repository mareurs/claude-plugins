# Recovery: an apply that stopped, a restore, late records

Read this when `apply` exits 2, when `check` is not clean and the user wants the files back, or when a record arrives after the migration.

## Before apply: the snapshot

Run `git status --porcelain` before `apply` and keep the output. It is the only record of what the tree held before the migration wrote anything.

## Apply exited 2

The stop JSON is `{"ran": false, "reason": "<one line>"}`. It carries no `written` or `deleted` list. Show the reason, then:

1. **Fix the cause and re-run the same `apply`.** A run completes the one before it: a file already written comes back under `already_applied`, so the union of `written`, `deleted` and `already_applied` of the run that exits 0 is the full set. This is the first choice.
2. **Restore.** If the user wants the tree back, compare `git status --porcelain` now with the snapshot. The paths that differ are the migration's. Restore those paths by exact names (`git restore --source=HEAD --staged --worktree -- <names>` for tracked ones; remove an untracked new file by its exact name). Never restore or clean a directory. Never touch a path that is not in the difference, and never the untracked `.codescout/`.

A dirty path under `docs/trackers/` that the plan does not write or delete is another session's work. `apply` refuses on it; do not clear it to get past the refusal.

## Check is not clean

Show `blocking`. The user chooses: fix the mapping and re-run `apply` (a mapping fix with the same files is an idempotent re-run), or restore as above. Writes nothing by hand either way.

## Late records

A record that was appended to the flat file after the migration, for example on a branch, merges back as a modify/delete conflict.

1. Resolve the merge by keeping the merged flat file, and **commit the merge first**. `apply` reads the sources at `HEAD`; an uncommitted merge is invisible to it.
2. Run `inventory` on the flat file.
3. Draft a mapping with `target.existing = true` and no `[schema]`. Every `sections` entry has `to = "drop"`: in this mode `apply` writes no readme and refuses `readme`.
4. Show the proposal screen, get approval, then run Steps 5 to 8 of the loop. The run writes entries only for tokens the collection lacks, refuses a token whose text differs from its entry, and deletes the flat file again.
