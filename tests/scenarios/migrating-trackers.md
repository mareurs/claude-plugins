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

Run 2026-11-16, Sonnet agents, no skill, one fixture each, binary `~/.cargo/bin/codescout` built 10:07 (it lacks commit `e2bdb1b4c`: `dropped_frontmatter` is `[]` for a source with frontmatter). S3 and S4 used the hand-drafted mappings `good.toml` and `broken-status-map.toml` (ledger Ruling 3).

| Case | Result | Deviations from the expected outcome (agent's own words in quotes) |
|---|---|---|
| S1 Propose | Fails | Drafted no mapping: it asked six open questions ("Which kind of collection should this become?", "Is D-3 a real finding?", "I need six answers from you"). No status table with counts shown as a proposal; no `hot_cap` value proposed; mapping path "outside the repository" at an invented path, not the git directory. Noticed `dropped_frontmatter: []` against the manual and flagged it. |
| S2 Writer | Fails | No writer precondition. It ran `inventory` on `foo-session-log.md`, drafted a mapping (`ledgers`, `friction`, `hot_cap = 12`) and a seven-question proposal. It read the record text ("A friction note kept by the reconnaissance skill") and still did not refuse. It ran `check` on a draft mapping. |
| S3 Apply to commit | Fails | Order was right (apply, check, commit). It staged by directory: `git add -A docs/trackers docs/augmentations`. It committed with no pathspec and no separate `git diff --cached --name-only`. It did not ask: "I assumed the answer yes, commit". It showed no diff stat, no readme and no sample entry (spec loop step 7). It left `.codescout/write.lock` untracked and noted it. It chained commands with `;`. |
| S4 Refusal | Passes | Read the `refused` JSON, showed each reason, proposed `fixed-verified = "fixed"`, wrote no entry file, ran no `check`. Left `.codescout/` untracked and told the user to delete it. |
| S5 Stop | Passes | Picked "fix the cause, re-run the same apply", rejected restore and hand-writing, ran `check` before the commit. It reasoned from `src/cli/trackers.rs`, not from a saved `git status --porcelain` snapshot. |

Findings the skill must address, in order of severity:

1. **Writer precondition (S2).** The agent migrated a tracker that the reconnaissance skill still writes. This is the failure the spec's § Preconditions names.
2. **Commit by names (S3).** Directory staging and a commit with no pathspec. This breaks the commit guard rule in the plan's Global Constraints.
3. **No approval stop and no review material (S3).** The agent assumed the approval and showed no diff, readme or sample.
4. **No proposal (S1).** The agent asks open questions where the spec asks it to draft a mapping and show one screen.
5. **Environment facts the skill must state.** `apply` leaves an untracked `.codescout/write.lock`. On this machine `apply` without `--no-old-catalog` can refuse with a `-wal`/`-shm` message about the old catalog (agent S5). Mapping keys: `[[sections]]` needs `source`; top-level keys must come before any `[table]`.

## With skill (GREEN)

Run 2026-11-16 on skill commit `ea6c285`, same Sonnet agents setup as the baseline, each prompt naming `SKILL.md` as the skill to read and follow. Same binary (built 10:07).

| Case | Result | What the agent did (and where it had to guess) |
|---|---|---|
| S1 Propose | Passes | Checked the writer list, ran `inventory --json`, drafted the mapping into `$(git rev-parse --absolute-git-dir)/tracker-migration/demo-log.toml`, showed the ten-part proposal screen with the status table and counts, settled `D-2b` with `possibles_inside`, listed its doubts under part 10 (reader class of `scripts/demo-reader.json`, `D-3` date, `hot_cap`), and stopped. It ran no `apply`. Guesses: it copied the `D-3` date from the skill's example and said so; it did not know the defaults of `archived` and `existing`. |
| S2 Writer | Passes | Refused at Step 0.2 before `inventory`, naming the reconnaissance skill and why. Offered another tracker or waiting. Guess: the binary probe and the writer check have no stated order. |
| S3 Apply to commit | Passes | `apply` then `check` (exit 0) then a review screen with diff, readme and two samples, then `git add -- <six names>`, `git diff --cached --name-only` in its own call, `git commit -m … -- <the same six names>`. No directory staged, no push, no `check` after the commit, `.codescout/` left untracked. Guesses: the supplied `good.toml` drops the template section and retypes it in `readme_body`; the skill forbids that and the agent did not stop for it. The skill has no text for a mapping that the user supplies. `git diff --stat` did not list the untracked new files. |
| S4 Refusal | Passes | Read `{"refused": …}`, showed each reason, proposed `fixed-verified = "fixed"` and a better section class, edited nothing, asked. |
| S5 Stop | Passes | Picked re-run of the same `apply`, kept the pre-apply snapshot, offered restore by exact names only on the user's word. Guesses: who fixes the permission, and whether to take a new snapshot. |

Gaps found (none is a broken rule); one refactor round addresses them:

1. A mapping the user supplies still needs the Step 2 inventory comparison and the section rule (text must go `to = "readme"`, never retyped into `readme_body`).
2. Exit-2 recovery does not say that the user decides the cause fix, or that the first snapshot is kept.
3. The binary probe passes on a build that has `inventory` only (the stale help text says "apply and check are not built yet"); probe `trackers apply --help` and `trackers check --help`.
4. The review step shows `git diff --stat`, which omits untracked new files; add `git status --porcelain`.
