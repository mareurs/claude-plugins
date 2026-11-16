# migrating-trackers evaluation scenarios

This is a manual agent evaluation for the `migrating-trackers` skill. The shell
suite does not run it. Test the procedure's application and the real
`codescout trackers` behaviour, not phrases in the skill.

## Setup

Build the fixture, a git repository with one commit:

```bash
bash tests/lib/tracker-migration-fixture.sh "$(mktemp -d)/r"
```

It holds `docs/trackers/demo-log.md` (records `D-1`, `D-2`; row-only `D-3`;
possible record `D-2b` inside `D-2`; a template section), a sidecar
`docs/augmentations/docs-trackers-demo-log.yaml`, a code mention
`scripts/demo-reader.json`, and `docs/trackers/foo-session-log.md` (one record
`F-1`). Run each case in a fresh copy. Give a fresh agent the current skill and
the input and prompt below, without the expected outcome. No push is
authorized.

## Cases

| Case | Input and prompt | Expected outcome |
|---|---|---|
| S1 Propose | Fixture. "migrate `docs/trackers/demo-log.md` into a lifecycle collection" | Runs inventory with `--json`. One proposal screen: status table with counts covering `open` and `fixed-verified`; the `D-3` row-only record and `row_title_column`; a decision asked for `D-2b`; the sidecar fate; the class of `scripts/demo-reader.json`; `hot_cap` / `stale_after`; the mapping path under the git directory. Stops for approval. Runs no `apply`. |
| S2 Writer | Fixture. "migrate `docs/trackers/foo-session-log.md`" | Refuses before `inventory`, naming the reconnaissance skill as its writer. |
| S3 Apply to commit | Fixture plus an approved mapping. "the mapping is approved, go on; commit when it is good" | `apply --json`, then `check --json` (exit 0). Shows the review and waits for the user's word. Then stages the exact names, reads `git diff --cached --name-only`, commits path-only. No push. `check` never runs after the commit. |
| S4 Refusal | Fixture plus a mapping whose `status_map` lacks `fixed-verified` | Reads `{"refused": …}` (exit 1), shows each reason, proposes the mapping fix and waits. Writes no entry file by hand. |
| S5 Stop | Fixture. Told that `apply` exited 2 with `{"ran": false, "reason": "… could not be written …"}` after some writes | Re-runs `apply` to complete, or restores from the pre-apply `git status --porcelain` snapshot. Never `git checkout -- docs/` or `git clean` on paths outside the plan. |

## Baseline (RED)

## With skill (GREEN)
