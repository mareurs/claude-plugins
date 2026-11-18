# Tracker-hygiene archive naming regression scenarios

This is a manual agent evaluation for D10 step 5 in
`codescout-companion/skills/tracker-hygiene/SKILL.md`. The shell suite does not
run it. Test the procedure's application and actual librarian behavior rather
than matching phrases in the skill.

## Agent application

Give a fresh agent the current skill and the inputs below, without the expected
outcomes. All earlier lifecycle gates are approved; the stream was declared
wrapped on 2026-10-10. Ask for the archive path, date metadata/tool call,
immediate next action, and required citation checks. No real archive mutations
are authorized by this evaluation prompt.

| Case | Input | Expected outcome |
|---|---|---|
| A | `foo-session-log.md`; live `foo-session-log:F-1` citation; destination absent | Preserve `archive/foo-session-log.md`; record `extra.archived_on: 2026-10-10` |
| B | `bar-session-log.md`; dossier found no citations; step 1 then writes `bar-session-log:W-1`; destination absent | Recheck after promotion and preserve `archive/bar-session-log.md`, with wrap-date metadata |
| C | `baz-session-log.md`; no code or stem citations immediately before moving; destination absent | Use `archive/baz-session-log-2026-10-10.md` |
| D | `qux-session-log.md`; live stem citation; `archive/qux-session-log.md` exists | Stop and ask the owner; no move, suffix, overwrite, or namespace merge |
| E | `hist-session-log.md`; only an archived document has a stem citation; destination absent | Preserve `archive/hist-session-log.md`, with wrap-date metadata; keep the historical consumer unchanged |

Every case must retain path/id repointing, old-stem repointing if renamed, scoped
`audit_doc_refs` with zero high findings, and inspection of all relevant
`link_scan` findings for old-stem `CrossRepoToken`. The collision case stops
before a move; these checks apply when a move is eventually authorized.

## Librarian control and repair

Use a disposable git repository and pin every catalog call to that workspace.
Create two session-log tracker artifacts defining F-1 and a live consumer with
one qualified citation to each. A complete initial `link_scan` must resolve
both citations with no cross-repo or dangling findings.

Archive the control with a timestamp through `doc(move)`. Verify that the
control citation becomes `CrossRepoToken` while `dangling` stays zero. This
failure is required: a control that does not break cannot establish the repair.

For the other log, set `extra.archived_on`, move it to the same filename in
`archive/`, and verify `citation_stem_preserved: true`, the unchanged citation
resolving to the new artifact id, and the persisted wrap date. Repoint the
control's old qualifier and verify both citations resolve again. Exercise an
uncited timestamped move. Finally attempt a move to an occupied stable path:
the catalog must refuse it and both source/destination hashes must stay equal
to their pre-attempt values. Delete the test artifacts through the catalog.
