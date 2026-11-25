# Tracker hygiene writes through a box: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `tracker-hygiene` skill adds its sweep and `HY-N` entries to a `hygiene` box, and the SessionStart hook finds the due date there, with the old flat log as fallback.

**Architecture:** A `worklog` stream box `hygiene` holds one entry per sweep or per meta observation. The newest `sweep` entry carries `next_sweep_due` in its frontmatter and the detector trust table in its body. The hook scans the box folder with one text rule and falls back to the flat log when no box entry carries a date.

**Tech Stack:** Node ES module hook (`session-start.mjs`), bash test driver (`session-start.test.sh`), skill markdown, `codescout box` CLI.

**Spec:** `docs/superpowers/specs/2026-11-25-tracker-hygiene-box-design.md`

## Global Constraints

- The hook stays a file read: no process, no new dependency, silent on every error.
- Box path: `docs/trackers/streams/hygiene/`. Field: `next_sweep_due` (scalar, `YYYY-MM-DD`). Nudge text unchanged: `TRACKER HYGIENE: sweep overdue (due <date>) — run /codescout-companion:tracker-hygiene`.
- A due date of today counts as overdue. A value that is not exactly `YYYY-MM-DD` never nudges.
- The box readme body stays under 2000 bytes. The sweep interval of 30 days stays in the skill text, not in a field.
- Agent-facing text states the current situation only, with no history. Write all text in English.
- The existing flat log is not moved or edited by this plan.
- A skill edit is live only after `./scripts/release.sh codescout-companion`; run it with `NO_PUSH=1`. The hook edit is live at once.

## Review Focus

- A box folder that exists but holds only `readme.md`: the hook must fall back to the flat log, not go silent.
- Two box entries with different dates: the hook takes the greatest, not the first file in name order.
- A box entry with a malformed date beside a valid one: the valid one decides.
- Both the box and the flat log present with different dates: the box wins.
- A `next_sweep_due` line inside an entry body (a quoted example), not in frontmatter: it must not count.

## File Structure

- Modify `codescout-companion/hooks/session-start.mjs` (the nudge block near line 242): one new function `readHygieneDue(cwd)`.
- Modify `codescout-companion/hooks/session-start.test.sh` (the nudge tests near line 300): new box cases beside the old ones.
- Create `docs/trackers/streams/hygiene/readme.md` through `codescout box new`.
- Modify `codescout-companion/skills/tracker-hygiene/SKILL.md` and its `references/tracker-hygiene-log-template.md`.
- Modify the skill-contract test data only if `tests/run-all.sh` names a skill call that is no longer legal.

---

### Task 1: The hook reads the box first

**Files:**
- Modify: `codescout-companion/hooks/session-start.mjs` (nudge block, lines 242-260)
- Test: `codescout-companion/hooks/session-start.test.sh` (after the due-today case, line 363)

**Interfaces:**
- Produces: `readHygieneDue(cwd: string): string`, returns the due date `YYYY-MM-DD` or `''`. It never throws.

- [ ] **Step 1: Write the failing tests.** Add these cases to `session-start.test.sh`, in the style of the existing nudge cases (`ctx startup`, `pass`, `fail`). Each case writes files under `$TMP/docs/trackers/streams/hygiene/` and removes them after. Entry files are `2026-11-25-sweep.md` style with frontmatter `---\nkind: entry\nentry_kind: sweep\nnext_sweep_due: <date>\n---\n`.
  - `box overdue → nudge with the date`: one entry with `2020-01-01`; assert `TRACKER HYGIENE: sweep overdue (due 2020-01-01)`.
  - `box future → silent`: `2099-01-01`.
  - `box takes the greatest date`: entries `2020-01-01` and `2099-01-01`; assert silent.
  - `box malformed date beside a valid one`: entries `soonish` and `2020-01-01`; assert the nudge names `2020-01-01`.
  - `box due today → nudge`: `$(date +%F)`.
  - `empty box (readme.md only) → falls back to the flat log`: flat log with `next-sweep-due: 2020-01-01`; assert the nudge names that date.
  - `box wins over the flat log`: box `2099-01-01`, flat log `2020-01-01`; assert silent.
  - `a date in the entry body does not count`: an entry whose body holds the line `next_sweep_due: 2020-01-01` and whose frontmatter holds none; assert silent.
  - `a date in readme.md does not count`: `readme.md` carries the field; assert silent.

- [ ] **Step 2: Run the tests and confirm the new cases fail.** Run: `bash codescout-companion/hooks/session-start.test.sh 2>&1 | grep -E "FAIL|passed"`. Expected: the new box cases FAIL, the old cases PASS.

- [ ] **Step 3: Implement `readHygieneDue(cwd)` in `session-start.mjs`.** List `*.md` files of `docs/trackers/streams/hygiene/` except `readme.md`. For each, read the frontmatter block only (between the first two `---` lines) and match `^next_sweep_due:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*$` (multiline). Collect valid dates and return the greatest. When none, read the flat log with the existing rule (`^next-sweep-due:` anywhere in the file, valid ISO only) and return its date, else `''`. Wrap the whole function in `try/catch` returning `''`. Replace the inline block so it calls `readHygieneDue(cwd)` and keeps the existing `due <= today` test and message.

- [ ] **Step 4: Run the tests and confirm all pass.** Same command. Expected: no FAIL; the old six nudge cases still PASS.

- [ ] **Step 5: Commit.** `git add codescout-companion/hooks/session-start.mjs codescout-companion/hooks/session-start.test.sh`, then commit with `-- <both paths>`.

### Task 2: Create the box

**Files:**
- Create: `docs/trackers/streams/hygiene/readme.md` (through the CLI)

- [ ] **Step 1: Make the box.** Run: `codescout box new worklog hygiene --title "Tracker hygiene sweeps" --exit-when "the repository stops running tracker hygiene"`. Run the commit lines the command prints, with explicit paths.

- [ ] **Step 2: Declare the kinds and the field in the readme frontmatter.** Set `entry_kinds: [sweep, meta]`, and under `fields:` the key `next_sweep_due` with `type: scalar`, as the `bugs` box readme does. Replace the readme body with: what a `sweep` entry holds (the sweep table, rejects, fixes, the detector trust table after the update, and `next_sweep_due` in frontmatter), what a `meta` entry holds (the verdict vocabulary `hit | miss | false-positive-pattern | proposal | promoted | wontfix`), and how an entry ends (`done`, `promoted`, `dropped`). Keep the body under 2000 bytes: run `codescout box check`.

- [ ] **Step 3: Verify the field reaches the frontmatter.** Run: `codescout box hygiene add --kind sweep --title "probe" '{"fields":{"next_sweep_due":"2099-01-01"}}'`, then `head -12` the new file. Expected: `next_sweep_due: 2099-01-01` inside the frontmatter. Then end the probe entry with `codescout box hygiene close <entry> dropped --text reason -`. If the field is not in the frontmatter, stop and report: the hook rule of Task 1 rests on it.

- [ ] **Step 4: Run the Task 1 hook against the real box.** With the probe entry still open and dated `2099-01-01`, `echo '{"cwd":"<repo>","hook_event_name":"SessionStart","source":"startup"}' | node codescout-companion/hooks/session-start.mjs` must print no `TRACKER HYGIENE` line; with the date `2020-01-01` it must print one. Delete the probe entry file afterward; do not commit it.

- [ ] **Step 5: Commit** the readme only, by explicit path.

### Task 3: The skill writes through the box

**Files:**
- Modify: `codescout-companion/skills/tracker-hygiene/SKILL.md` (description line 3; bootstrap paragraph near line 163; Phase 5 near lines 419-450; the section "The ledger (per project)" near line 482)
- Modify: `codescout-companion/skills/tracker-hygiene/references/tracker-hygiene-log-template.md`

**Interfaces:**
- Consumes: the box and field of Task 2.

- [ ] **Step 1: Bootstrap.** Replace the paragraph that copies the template into `docs/trackers/tracker-hygiene-log.md` with: if `codescout box` does not list `hygiene`, run `codescout box new worklog hygiene --title "Tracker hygiene sweeps" --exit-when "the repository stops running tracker hygiene"`, then the two commit lines it prints. Remove the paragraph about converting a fenced `yaml` sample.

- [ ] **Step 2: Phase 5.** Replace the `doc(update ... body_edits ...)` sweep write and the `append_entry` `HY` write with `codescout box hygiene add --kind sweep --title "Sweep YYYY-MM-DD" --text body -` (stdin: the sweep entry, ending with the updated trust table) and the JSON `{"fields":{"next_sweep_due":"<today + 30 days>"}}`; and `--kind meta` for an observation. State that the next sweep reads the newest `sweep` entry for the trust table. A project whose flat log still exists keeps the old route: say so in one line, with the path.

- [ ] **Step 3: The ledger section and the description.** Rewrite "The ledger (per project)" to name the box and the field, and the hook's rule (greatest `next_sweep_due` in the box, else the flat log). Change the description in the frontmatter: "each sweep adds an entry to the project's hygiene box".

- [ ] **Step 4: The template file.** Keep it as the source of the entry templates and the verdict vocabulary; delete the bootstrap blockquote, the fenced frontmatter sample and the `append_entry` comment. State at its top that it holds templates for `codescout box hygiene add`.

- [ ] **Step 5: Run the checks.** Run: `bash tests/run-all.sh 2>&1 | tail -20`. Expected: `All suites passed.` The skill-call tests (`tests/lib/skill_call_legality.py`) parse the calls in the skill text: a failure there names the illegal call to fix.

- [ ] **Step 6: Commit** the two skill files by explicit paths.

### Task 4: Release and follow-up entries

- [ ] **Step 1: Tell the peer.** `post_notice` to the sessions of this repository: the hook change is live, the skill change waits for the release, and `docs/trackers/tracker-hygiene-log.md` is not moved. Cite the design path.

- [ ] **Step 2: Release.** Only when the tree is clean and the operator asks for it: `NO_PUSH=1 ./scripts/release.sh codescout-companion patch`. Then refresh the `version-bump-checklist` tracker (`CLAUDE.md` § Version Management) and verify every row.

- [ ] **Step 3: File the open work in the `box-migration` stream.** One `residual`: move `tracker-hygiene-log` into the box after session `9b880af2` reports its D10 step done, then drop the `tracker-hygiene-log` row from the writer table of `codescout-companion/skills/migrating-trackers/SKILL.md` and re-run `migrating-trackers.test.sh`. Close the existing entry `tracker-hygiene-log cannot move to a box while the hygiene skill writes it by path` with `promoted` and the `**Promoted to:**` line naming the new residual.
