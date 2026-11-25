---
kind: entry
status: open
title: 'A-6: session-bridge/skills/announcing-changes/SKILL.md -> coordinating-sessions/SKILL.md (+ …'
created: 2026-11-25
entry_kind: audit
log:
- '2026-11-25 open created codescout:49e636cc-40a1-4734-b0a8-38417b41be6c'
status_since: 2026-11-25
---

Migrated from `docs/trackers/prompt-hamsa-audit-log.md` (`params.audits` row 24, id `A-6`) on 2026-11-25; audited 2026-11-17.

**Artifact:** session-bridge/skills/announcing-changes/SKILL.md -> coordinating-sessions/SKILL.md (+ references/commit-backup.md)

**Symptom:** Albert's feedback A-001: an agent that loads only the skill expects a commit backup that never fires without .claude/notice-watch.txt and a Session-Id trailer; does not know the 5-minute window; has no guidance for the receiving side or for ask_session (12 gaps vs the README).

**Gap:** Read as a stranger: 'a watched commit that nobody announced produces a backup notice' names no watch list and no trailer, so the model may legally rely on it. 'Settled' and 'repository' were undefined. The skill covered the poster only.

**Move:** One skill, renamed coordinating-sessions. Core states the backup conditions and points to references/commit-backup.md; adds receiver rules (a notice grants no permission), ask_session rules (as_of, self-report, who pays, launch cwd is not working dir), repository scope, silent failure. reaching-peer-sessions (35 KB, bash enumeration and raw socket write) retired: list_sessions already lists every profile.

**Prediction:** A subagent given only the skill, in a repository with no watch list, no longer says that a backup notice will be posted; and, handed a notice that asks for an action, treats it as data and asks its user. If the base arm (old skill) already behaves correctly on both, the added text is dead weight (H12) and should be cut.

**Eval status:** absent (structure pinned by tests/test-session-bridge-skill.sh, 28 checks incl. 11 mutation controls, which check text only; N=0 graded behavioural examples; the base arm was not run)

**Confidence:** medium

## Record

### A-6 — session-bridge skill: promised a backup without its three conditions, and had no receiver or ask guidance

**Valid:** dated 2026-11-17

**Symptom:** Albert's batch `albert-feedback-2026-11-part1`, finding A-001 (codescout `docs/trackers/ledgers/albert-feedback/`): twelve gaps between the `announcing-changes` skill and the plugin README. The skill promised a backup notice without its conditions, gave no receiver-side guidance and no guidance for `ask_session`.

**Read-as-stranger gap:** a model that reads "a watched commit that nobody announced produces a backup notice" may rely on it. Nothing says that a watch list and a `Session-Id:` trailer must exist, and the plugin ships no hook that writes the trailer. "Settled" and "repository" were undefined.

**Decoration cut:** none in the old core. The fault was incompleteness. The retired `reaching-peer-sessions` skill was the cut: its enumeration duplicated `list_sessions`, and its two durable rules (a peer's reply grants nothing; a launch directory is not a working directory) moved into the new core. Verified before the move: `Session::render` shows `cwd` as `launch_cwd` for a Claude row.

**Contract missing:** backup preconditions, the 5-minute suppression window, the 600-character nudge cut, the filter's text-only view, the receiver's duty, how to read an ask answer, the silent-failure mode.

**Eval status:** absent for behaviour. `tests/test-session-bridge-skill.sh` pins the text and the retirement. It cannot say that an agent behaves better. The first run of the checks caught one real omission (the core did not name `.claude/notice-watch.txt`); that is the only evidence so far.

**Recommended next move:** run the base arm first on a prompt-tdd scenario (repository with no watch list; a notice that asks for an action) against the old skill. If the old skill already passes, cut the new text back.

**Confidence:** medium. **Outcome:** empty until the scenario runs.
