---
kind: entry
status: open
title: 'tracker-hygiene D10: the procedure has no verdict or method for a log of 400 entries'
created: 2026-11-24
entry_kind: bug
log:
- '2026-11-24 open created codescout:be5c3984-2bd4-45c8-897a-3b17ba6e951e'
status_since: 2026-11-24
---

**Summary:** The D10 distill-then-archive procedure in `codescout-companion/skills/tracker-hygiene/SKILL.md` (lines 237-316) was run for the first time on a log of 413 entries (`docs/trackers/bug-fix-session-log.md` in codescout, 1.66 MB). Four read-only agents walked steps 1 and 2 and each hit the same gaps. The procedure gives no verdict for most entries, no way to extract them, and a step order that wastes the work. Whoever runs D10 on a large log is affected.

**Symptom:** Verbatim from the four agents' reports (2026-11-24):
- Step 1 (promote wins), 80 wins in `W-83..W-162`: "No verdict exists for a win with no Promote-when (52 of 80)." In `W-1..W-82`: "Deciding 'fired' means recounting a 1.66 MB corpus, and the skill gives no method"; "38 of the 82 `Status:` lines are free text. W-74 and W-77 have no `Status:` line, and W-66, W-67, W-68 and W-75 have no `Promote-when` line."
- Step 2 (rehome open frictions), 50 open: "Step 2 has no verdict for lesson-only entries", "It still names `docs/issues/` as the bug destination", "Step 3 (the owner confirms the stream is wrapped) should come before steps 1 and 2", and "Splitting on `## F-` swallows the next `W-` entry".

**Reproduction:** In a codescout checkout (HEAD `5343ff14c`, experiments, 2026-11-24) with this skill at claude-plugins `9e24439`:
1. Read SKILL.md lines 237-316.
2. `grep -c '^## F-' docs/trackers/bug-fix-session-log.md` gives 253 and `grep -c '^## W-'` gives 164; the high-water marks are F 251 and W 162.
3. `grep -E '^\*\*Status:\*\*' ... | sort | uniq -c` shows the Status values, including the free-text tails below.
4. Try to follow steps 1 and 2 on this file with no script: no step says how to extract, split or score the entries.

**Root cause:** The text was written for logs of a few dozen entries with clean status tokens. Each defect cites the skill at the bytes:
- **Step order** (lines 242-252): steps 1 and 2 mutate and verify, and "Confirm with the owner that the work stream is actually wrapped" is step 3 (line 251). An idle-but-planned stream gets `defer`, and by then the verification is spent.
- **Wins without a verdict** (lines 242-245): only `Status: validated` with a `Promote-when` is handled, as "fired → promote" or "not fired → digest". A win with no `Promote-when`, an `absorbed` win, and a win whose recorded promotion no longer holds (D11 territory, line 317) have no outcome.
- **"Fired" has no method** (line 243): a count criterion ("after N datapoints") is a recount of the corpus, and the section names no way to do it. Lines 237-316 contain none of the words script, extract, parse, split, agent or evidence.
- **Frictions without a verdict** (lines 246-250): the outcomes are "promote to a bug file or move to the successor log" (still real), or flip to `fixed-verified` / `wontfix-false-alarm`. A lesson-only friction (a rule with no code to check) fits none of them; 11 of 50 were of that kind. An obsolete entry (its subject is gone) has no status either.
- **Status vocabulary** (lines 242, 249): the log's own values are `validated` (84 plain), `open`, `fixed-verified`, `promoted-to-bug-tracker` (13 + 5), `mitigated` (13), `promoted-to-permanent-docs` and free-text tails such as `validated — single datapoint`. `mitigated` and `promoted-to-bug-tracker` are not named by any step.
- **Routing is out of date** (lines 243-244, 248): "CLAUDE.md / skill / project memory" and "bug file (`docs/issues/`)". In codescout CLAUDE.md now sends lessons to `docs/conventions/` and box readmes, and bugs go to the bugs box (`codescout box bugs add`).
- **Heading counts lie** (line 253 binds `link_scan` to the `## <ID> — <title>` heading): the file has 253 `## F-` and 164 `## W-` headings, and the high-water marks are 251 and 162. Four of the headings are templates (`## W-N entry template`, `## W-N — <one-line title>` at lines 795 and 814, and two for F), so a count by heading gives 417 for 413 entries, and a split on `## F-` carries the next `W-` entry along.
- **Fan-out is not covered:** the skill has no rule for splitting the entries between agents and none for what an evidence line must hold, so four agents chose their own tables.

**Evidence:** Four tables in the codescout session scratchpad (`d10-w1.md`, `d10-w2.md`, `d10-f1.md`, `d10-f2.md`), 2026-11-24. Totals: wins 38 already promoted, 10 fired and unpromoted, 2 whose claim no longer holds (`W-7`, `W-32`), 111 unfired, 1 archived; frictions 26 fixed, 4 obsolete, 11 lesson-only, 9 defects. Related: `2026-11-24-tracker-hygiene-no-detector-measures-tracker-size-so-a-1-66` (the size and idle-clock gate; do not repeat it here), `2026-11-24-tracker-hygiene-d10-step-5b-the-timestamped-archive-name` (step 5b, fixed), and codescout `docs/trackers/tracker-hygiene-log.md` `HY-29` (the idle clock) and `HY-33` (a pre-flight list for the archive step). This entry is about steps 1 to 4.

**Fix:** Proposed, not implemented. A short corrected D10:
1. **Owner first.** Confirm the stream is wrapped, then do everything else.
2. **Extract once.** One script, or a `codescout box` verb, parses the log by the `## <ID> — <title>` heading with templates skipped, and prints id, status, `Promote-when` and the routing line. Agents read that table and never split the file themselves.
3. **A closed verdict list.** Win: `already-promoted` (cite the path and heading read), `fired-unpromoted`, `unfired` (quote the criterion), `no-criterion` (stays in the digest), `obsolete`. Friction: `fixed`, `still-real`, `lesson-only` (digest), `obsolete`, `false-alarm`. A recorded promotion that no longer holds is a D11 finding, not a verdict.
4. **A status vocabulary that matches the entry template**, including `mitigated` and `promoted-to-bug-tracker`; a free-text tail is read as its first token.
5. **Current routing:** lessons to `docs/conventions/`, box readmes, memories or skills; bugs to the bugs box.
6. **Fan-out:** split by id range, one table per agent, one evidence line per row (a path:line or a command and its result).

**Tests added:** none.

**Resume:** Rewrite SKILL.md lines 237-316 as above, and add the extraction as a script next to the skill (or a box verb), with one fixture log that holds a template heading, a win without `Promote-when` and a free-text status.
