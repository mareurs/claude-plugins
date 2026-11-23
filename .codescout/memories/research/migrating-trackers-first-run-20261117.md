# migrating-trackers: first run, 2026-11-17

Measured in the claude-plugins checkout with the `codescout trackers` binary at `~/.cargo/bin/codescout` (0.15.0, built 2026-11-16 18:31). Tracker used: `docs/trackers/validation-domain-coverage.md` (1164 lines, 10 records `VG-1..VG-10`, no code readers). The real migration was NOT done (see "Blocked" below). The full loop was run on a throwaway clone instead.

## What the loop did on the clone (all measured)

- `inventory --json`: exit 0, 10 records, 5 raw status words (`open` 3, `wontfix` 2, `fixed` 3, `fixed 2026-09-07` 1, `mitigated` 1), 16 sections, `possibles`/`repeats`/`row_only`/`disagreements` all empty, 8 frontmatter keys reported in `dropped_frontmatter`, `mentions.code` empty, `mentions.paths` 29 lines in 12-14 docs.
- `apply` exit 0: 11 files written, source deleted. `check` right after: `clean: true`, `blocking: []`. Commit by `--pathspec-from-file` of the apply names: staged list equalled the names list. After the commit `check` exits 2 with `{"ran":false,"reason":"<source> is not in HEAD. Commit it, then run this again"}`, as the skill says.
- Terminal statuses went to `archive/` in the collection folder; open and `mitigated` (class open) stayed in the main folder.
- `apply` needed no `created` date for a record with no stated date (`VG-3`): the dates were derived (`review.derived_dates`).

## Blocked on the real repo

`apply` exits 2: `{"ran":false,"reason":"a -wal or -shm file, or a -journal file that is not empty, lies beside the old catalog ... Stop every codescout process, run sqlite3 <old catalog file> 'PRAGMA wal_checkpoint(TRUNCATE)'"}`. The old catalog is `~/.local/share/librarian/catalog.db` (544 MB, with `-wal` 10 MB and `-shm`). `lsof` showed 49 `codescout start` processes holding it open (a floor: lsof warned about docker overlay mounts). That is every MCP server of every live session across the four profiles, so the fix is a maintenance window: close the sessions, checkpoint, then run `apply`. The mapping is kept at `<git-dir>/tracker-migration/validation-domain-coverage.toml`.

## Technique: test the loop without the shared catalog

`dirs::data_local_dir()` honours `XDG_DATA_HOME` on Linux (the old catalog path is `data_local_dir()/librarian/catalog.db`). In a `git clone` of the repo, run the commands with `XDG_DATA_HOME=<empty dir>` and `apply --no-old-catalog`. This validates a mapping and the skill end to end and touches neither the real tree nor the real catalog. It does NOT run the catalog-facts check (skill Step 0.3), so it proves nothing about `cutover`.

## Small facts

- After a real migration of `validation-domain-coverage`, `docs/trackers/INDEX.md:50` links the old path (`in_code: false`) and stays broken. `apply` rewrites no markdown mention (`skipped_rewrites` was empty).
- The source's "Live state" block said `entries_open: 4 (VG-3, VG-4, VG-5, VG-10)` but `VG-10`'s body status is `fixed 2026-09-07`. Pre-existing staleness; the migration keeps the body.
- `run_command` asks for an ack on `rm -rf`, even for a path in the scratchpad. Run the `@ack_*` it prints.
- Tool gate: a `git commit ... -- <path>` in the codescout repo ran 7 pre-commit checks; two of them ("pathspec commit carrying unstaged content", "index commit carrying another session's staged paths") passed with 24 other files dirty from other sessions.

Related: [[reconnaissance]], the `migrating-trackers` skill in `codescout-companion/skills/`, codescout bug `3c5fa35d9d2754a7` (stray empty `.git` dirs; a note was added there the same day).

## Update 2026-11-23: sidecar retirement changed; the test no longer pins a count

`migrating-trackers.test.sh` went red because codescout commits `970827aa6` (apply, 2026-11-22) and `8d0deb18b` (inventory, 2026-11-23) made `sidecar = "retire"` delete only a sidecar the source DECLARES with `expects_augmentation:` in its frontmatter, not the one its derived name gives (`rel_path_for` is not injective). The fixture `tests/lib/tracker-migration-fixture.sh` writes `docs/augmentations/docs-trackers-demo-log.yaml` but its `demo-log.md` does not declare it, so `apply` leaves the sidecar and reports 5 paths, not 6 (measured in a scratch copy with the `~/.cargo/bin` build and with the session's self-bin: same result).

**Done (2026-11-23):** the test derives the expected count from `apply`'s own JSON (`unique(written+deleted+already_applied)`), because the check is about the Step 8 procedure, not about which files apply touches. 90 passed, 0 failed with both binaries.

**Left for later, when the codescout change settles (not done on purpose: the rule moved twice in two days):**
- **A. Declare the sidecar in the fixture.** Add `expects_augmentation: docs/augmentations/docs-trackers-demo-log.yaml` to the fixture's frontmatter. That is one extra line, so every line number shifts, and the worked example in `references/mapping.md` pins lines 6, 7, 11, 37 and others. Measured: with the line added and the mapping unchanged, `apply` refuses with 10 errors (sections and possibles at the old line numbers). The fix is the fixture plus the renumbered example. Skill files are served from the versioned cache, so it is not live until a release.
- **B. The orphan sidecar.** A source that does not declare its sidecar now leaves `docs/augmentations/*.yaml` behind after `apply` (measured on the fixture). I read from the commit title of `8d0deb18b`, not from a run, that `inventory` then also stops reporting a `.sidecar`; if so, the skill's step 8 ("Sidecar: its path and the proposed fate") shows nothing and the orphan stays unmentioned. Check this on a real tracker with an undeclared sidecar, then decide whether `SKILL.md` must tell the user.

**Why the test is red or green depends on the binary.** The test takes the first `codescout` on `PATH`. In a normal shell that is `~/.cargo/bin/codescout`, a symlink to `/home/marius/work/claude/codescout/target/release/codescout` (the dev build of the `experiments` branch). The `codescout trackers` command is marked "Unreleased" in codescout's manual, so `release.sh`'s pre-flight depends on an unreleased binary. Inside a codescout `run_command` the first binary on `PATH` is the self-bin copy instead.
