---
id: e51ea9ef00e3739e
kind: bug
status: open
title: reconnaissance SKILL.md's worked exemplars use a `**Valid:** dated … — <prose>` form that `append_entry` hard-rejects — a regression from the 2026-08-20 fix
tags:
- codescout-companion
- reconnaissance
- skill
- session-log
- librarian
opened: 2026-08-26
severity: med
unverified: 'Only two forms were probed: `dated <date> — <prose>` (rejected, twice) and bare `dated <date>` (accepted). Whether the validator refuses ALL trailing content or only the em-dash form is untested; the fix below is safe either way, but a validator-side fix needs that boundary established first.'
---

## Summary

`codescout-companion/skills/reconnaissance/SKILL.md` instructs the agent to *"Pattern your
new entries on these, not the bare template"* and then supplies two worked exemplars whose
`**Valid:**` lines are rejected outright by `artifact(action="append_entry")` — the call
the same skill prescribes as the only append path.

This is a **regression introduced by the fix for
`docs/issues/2026-08-20-reconnaissance-skill-prescribes-hand-allocated-edit-markdown-appends.md`**
(artifact `a6e798348cba963e`), whose own Fix section records: *"Added `**Valid:**` and
`**Rests on:**` to both worked exemplars (F-3, W-2)."* The added form does not parse.

That bug's `unverified:` note predicted exactly this: *"No automated check that a skill's
prescribed tool calls remain legal against the MCP server it drives."*

## Symptom (Effect)

The first `append_entry` of any session that follows the skill's own instruction fails:

```
`**Valid:** dated 2026-08-26 — true of `RecoverableError`'s field shape at that
commit; re-verify if it changes.` is not an ISO date

hint: Use `dated YYYY-MM-DD`. The three forms are:
      **Valid:** invariant | dated YYYY-MM-DD | conditional — <event>
```

Cost is one rejected round-trip per session, plus the agent having to infer that the
skill's exemplar — not its own wording — is the thing that is wrong. Silent-failure risk
is nil: it errors loudly and the hint names the fix, which is what keeps this below high.

## Reproduction

```
grep -n '^\*\*Valid:\*\*' codescout-companion/skills/reconnaissance/SKILL.md
# → 168: **Valid:** dated 2026-05-18 — true of `RecoverableError`'s field/method shape …
# → 212: **Valid:** dated 2026-05-18 — one confirmed datapoint; promote-when threshold …
```

Then pass L168's line verbatim as the tail of an `append_entry` body. Rejected.
Reproduced twice on 2026-08-26 — once with my own wording, once with the exemplar's
wording copied verbatim — so the refusal tracks the *form*, not the content.

Bare `**Valid:** dated 2026-08-26` is accepted; the qualifier has to move to a following
line or into `**Rests on:**`.

## Environment

- `claude-plugins` @ `2d6cdbe`; codescout MCP build serving this session
- `codescout-companion/skills/reconnaissance/SKILL.md` L168 (F-N exemplar), L212 (W-N exemplar)
- Both sibling templates checked and clean: `references/reconnaissance-patterns-template.md`
  and `skills/tracker-hygiene/**` contain no `**Valid:**` lines at all

## Root cause

The validator parses the entire remainder of the `**Valid:**` line as the class token, so
`dated 2026-05-18 — …` is read as one malformed date string.

The em-dash-qualifier habit is real and comes from the neighbouring form: `conditional —
<event>` **requires** trailing text after an em-dash. An author who has just read the three
accepted forms will naturally write `dated <date> — <why>` by symmetry. `get_guide("tracker-conventions")`
documents the three forms but does not say that `dated` alone takes no tail, and the
skill's exemplars then demonstrate the illegal form as the thing to copy.

So there are two defects stacked: an exemplar that does not parse, and a documented grammar
whose two branches differ in a way nothing states.

## Evidence

Both exemplar lines, verbatim from source:

```
L168: **Valid:** dated 2026-05-18 — true of `RecoverableError`'s field/method shape at that commit; re-verify if `src/tools/core/types.rs` changes.
L212: **Valid:** dated 2026-05-18 — one confirmed datapoint; promote-when threshold (2 datapoints) not yet reached.
```

Working form, as applied to `roster-audit-session-log` `F-1`…`F-5` and `W-1` this session:

```
**Valid:** dated 2026-08-26

True of `buddy/skills/` at plugin version 0.9.1; re-verify after any specialist rewrite.
```

## Fix

**Skill side (this repo, primary):** rewrite L168 and L212 to the bare-date form with the
qualifier on a following line, so the exemplars demonstrate something that works. Add one
sentence to the Phase 3 prose noting that `dated` takes no trailing text while
`conditional` requires it — the asymmetry is the trap.

**Server side (codescout, optional):** accept `dated YYYY-MM-DD — <prose>` by parsing only
up to the first em-dash. This is the more forgiving fix and would make the existing
exemplars correct retroactively, but it widens a grammar that is currently strict, so it is
a judgement call for codescout rather than a defect to assert. **Establish the boundary
first** — see `unverified:`.

Do not do both without deciding which is canonical.

## Tests added

None yet, and this is the gap that matters rather than one to excuse. The 2026-08-20 fix
named it, shipped without it, and this bug is the direct consequence — the second defect
in six days from the same uncovered seam.

The cheap regression is a test that extracts every `**Valid:**` / `**Rests on:**` line from
`codescout-companion/skills/**` and asserts each parses against the documented grammar. It
needs no MCP server, only the grammar, and it would have caught this at the commit that
introduced it.

## Workarounds

Write `**Valid:** dated YYYY-MM-DD` bare; put the qualifier on the next line. Applied
throughout `docs/trackers/roster-audit-session-log.md`.

## References

- `codescout-companion/skills/reconnaissance/SKILL.md` L168, L212 — the two bad exemplars
- `docs/issues/2026-08-20-reconnaissance-skill-prescribes-hand-allocated-edit-markdown-appends.md`
  (artifact `a6e798348cba963e`) — **the fix that introduced this**, and whose `unverified:`
  note predicted it
- codescout `get_guide("tracker-conventions")` § *Required fields* — the three-form grammar
- `roster-audit-session-log:F-3` — the reconnaissance entry this issue is filed from
- `roster-audit-session-log:F-5` — sibling defect, same class (recon boilerplate that does
  not survive contact with the tool that consumes it)

