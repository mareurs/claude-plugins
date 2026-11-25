# Tracker hygiene writes through a box: short design

Date: 2026-11-25. Status: proposed, waits for the operator's approval.
Entry: `docs/trackers/streams/box-migration/2026-11-24-tracker-hygiene-log-cannot-move-to-a-box-while-the-hygiene.md`.

## Intent and why

The `tracker-hygiene` skill writes `docs/trackers/tracker-hygiene-log.md` by path, and the SessionStart hook reads one line of that file. The `migrating-trackers` skill refuses a tracker that a skill or hook writes by path, so the log cannot move. Every other flat tracker waits behind the same rule. The skill and the hook must write and read through a box first. The log moves second.

## Goals, non-goals, anti-goals

- Goal: the skill adds sweep and `HY-N` entries with `codescout box hygiene add`. The hook finds the due date in the box.
- Goal: a project with the old log keeps working until its log moves.
- Non-goal: moving the existing log in this change. Session `9b880af2` may still write it (a D10 step). The move waits for its word.
- Non-goal: changing the detectors D1 to D11 or the sweep method.
- Anti-goal: a second place for the due date, or a hook that starts a process.

## Approaches

1. **A `hygiene` box (worklog stream) with a declared field `next_sweep_due`.** Chosen. The hook scans the box folder with one text rule, as it scans the old file today.
2. Same box, and the hook runs `codescout box hygiene list`. Rejected: SessionStart would start a process in every session, and it costs time and bytes.
3. Keep the flat log and move only the `HY-N` entries. Rejected: the skill still writes the log by path, so the writer rule still blocks the move.

## Design

- **Box.** `docs/trackers/streams/hygiene/`, template `worklog`, kinds `sweep` and `meta`. The readme declares the field `next_sweep_due` (scalar) and `sweep_interval_days` is not a field: the skill text holds the default of 30.
- **Where state lives.** The newest `sweep` entry carries the state of the project: `next_sweep_due` in its frontmatter and the full detector trust table in its body. The next sweep reads the newest entry, edits the table and writes a new entry. This replaces the mutable table of the log. *My call: a copy per sweep gives a history of the trust table for free.*
- **`HY-N`.** A `meta` entry is one box entry. The server's date key replaces the number. Old `HY-N` ids stay in titles when the log moves.
- **Skill.** `SKILL.md` Phase 0 bootstraps the box with `codescout box new worklog hygiene ...` in place of copying a template file. Phase 5 adds the entry with `codescout box hygiene add --kind sweep` and sets the field. The reference file `tracker-hygiene-log-template.md` becomes the box readme text and the entry templates.
- **Hook.** `session-start.mjs` reads every `*.md` file in `docs/trackers/streams/hygiene/` except `readme.md`, takes the greatest `next_sweep_due`, and nudges when it is today or earlier. When the folder does not exist, it reads the old log as today. Both paths give the same one-line text.
- **`migrating-trackers`.** The writer table drops the `tracker-hygiene-log` row once the release lands.

## Constraints

- The hook must stay a file read: no process, no new dependency, silent on error.
- `release.sh` is the only way a skill change reaches a session (memory `plugin-load-channels`). The hook change is live from the working tree.
- The box readme body stays under 2000 bytes.

## To verify first

- A `scalar` field is written into the entry frontmatter. Evidence: the `bugs` box entries hold `severity:` there.
- `codescout box new` cannot run under the system temp dir, so a probe runs in this repository on the real box, which is the first step of the build.

## Left to the builder

- The exact text of the box readme and the two entry kinds.
- The test: the three existing tests in `session-start.test.sh` keep their cases for the old file, and new cases cover the box (overdue, future, due today, malformed value, empty box, both paths present).
- The order of release: hook and skill together in one `codescout-companion` release.
