---
id: a6e798348cba963e
kind: bug
status: fixed
title: reconnaissance SKILL.md prescribes hand-allocated edit_markdown appends, which race, teach nothing, and stop working once the ledger is guarded
tags:
- codescout-companion
- reconnaissance
- skill
- session-log
- librarian
closed: 2026-08-20
unverified: No automated check that a skill's prescribed tool calls remain legal against the MCP server it drives; regression relies on manual review + the full test-suite pass (run-all.sh + buddy pytest) only, not a pinned check.
---

## Summary

`codescout-companion/skills/reconnaissance/SKILL.md` tells the agent to allocate
the next F-N / W-N id **by grepping the tracker**, then append the section with
`edit_markdown`. Three independent defects follow from that one instruction, and
a fourth from the entry shape it demonstrates. codescout's own
`docs/templates/session-log.md` — the file this skill drives — was changed to
`append_entry` on 2026-08-20 (codescout `0b622f3a`); the skill still carries the
old instruction, so the two now disagree.

## Symptom (Effect)

Verified on disk at `codescout-companion/skills/reconnaissance/SKILL.md`:

- **L95–98** — *"**ID allocation.** Read the tracker's existing IDs and use the
  next monotonic integer"*, with pseudocode
  `grep -oE 'F-[0-9]+' tracker.md | sort -V | tail -1, then +1`.
- **L104–113** — *"**Append mechanism.** Use `edit_markdown` to insert the new
  entry above the `## Template for new entries` marker"*.
- **L127** — *"Right after the `edit_markdown` append lands, bump the session
  counter…"*.
- **Zero** occurrences of `**Valid:**`, `**Rests on:**`, or `append_entry` in the
  whole file. (Same grep alternation matched `edit_markdown` and `grep -oE`, so
  the zero is a real absence, not a failed pattern.)

The two worked exemplars (the F-N one at ≈L140–175 and the W-N one at ≈L177–213)
enumerate `**Observed:** / **When:** / **Expected:** / **Got:** / **Severity:** /
**Status:** / **Promote-when:** / **Fix idea:**` and no validity fields.

## Reproduction

1. Invoke `/codescout-companion:reconnaissance` in a codescout-managed project.
2. Follow Phase 3 literally against a session log that declares
   `entry_prefix` in its frontmatter.
3. The `edit_markdown` call is **refused** by codescout's librarian guard:
   `'<path>' is a librarian-managed artifact — do not read or edit it directly`.

Observed 2026-08-20 against
`codescout:docs/trackers/statement-validity-session-log.md`.

## Environment

`codescout-companion` v1.16.14 (`codescout-companion/.claude-plugin/plugin.json`),
branch `main`. Consumer: codescout on `experiments`.

## Root cause

One instruction, four consequences.

1. **Hand-allocation races.** codescout's `get_guide("tracker-conventions")`
   § *Entry ids* states the rule the skill violates verbatim: *"Let the server
   allocate. `artifact(action="append_entry", id_prefix="R", …)` assigns the next
   id atomically. Hand-allocation races: a peer session in the same checkout can
   take the id between your scan and your write."*

2. **Pre-written index rows consume the ids they name.** The skill also says to
   update the Index table. The allocator counts an id claimed by an index row, so
   a row written ahead of its section burns that number. This already happened:
   `codescout:statement-validity-session-log` starts at `F-2`/`W-3` rather than
   `F-1`/`W-1`, recorded as `F-3` in that same log.

3. **It stops working once the ledger is set up correctly.** This is the part
   that makes the defect hard to see. codescout's session-log template ships with
   no frontmatter, so a *fresh copy* is directly editable and `edit_markdown`
   succeeds. Declaring `entry_prefix` — which `tracker-conventions` § *Make the
   tracker guarded* instructs you to do — flips the file into the guard's
   `ledger` case and only `append_entry` can write it. So the skill works right
   up until the agent follows the *other* guidance correctly, then fails.

4. **It bypasses the server-side `**Valid:**` stamp.** codescout's
   `append_entry` stamps `**Valid:** dated <today>` into the section it writes
   unless the caller passes a class; `edit_markdown` writes a raw section and
   gets no stamp. Combined with the exemplars not showing the field, an agent
   following this skill produces undeclared entries by default — which
   `librarian(action="doctor")`'s `entry_cited_from_outside_but_undeclared` then
   reports once the entry attracts cross-file citations.

**Measured vs. reported.** Items 1–3 were verified this session: the SKILL.md
lines were read on disk, and the guard refusal in *Reproduction* was observed
directly. Item 4's stamp behaviour is taken from codescout's
`docs/manual/src/concepts/statement-validity.md` § *Server-side stamping* and its
CHANGELOG entry — **read, not independently exercised** here. A related claim
from the audit that produced this file — that `EditMarkdown` inherits
`relevant_guide_topic = None` and therefore fires no guide on that path — is
**reported, not verified by me**; treat it as a lead, not a premise.

## Evidence

### `SKILL.md` L95–98, L104–113

```
**ID allocation.** Read the tracker's existing IDs and use the next monotonic integer:

# Pseudocode: grep -oE 'F-[0-9]+' tracker.md | sort -V | tail -1, then +1

**Append mechanism.** Use `edit_markdown` to insert the new entry above the
`## Template for new entries` marker, then update the Index / Wins Index table at the top
```

### The guard refusal

```
'docs/trackers/statement-validity-session-log.md' is a librarian-managed
artifact — do not read or edit it directly
```

## Fix

Implemented 2026-08-20. Replaced the Phase 3 *ID allocation* + *Append
mechanism* blocks in `codescout-companion/skills/reconnaissance/SKILL.md`
with the single-call form:

```
artifact(action="append_entry", id="<artifact id>", id_prefix="F",
         anchor_heading="## Template for new entries",
         title="<one-line title>", body="**Observed:** ...")
```

Added `**Valid:**` and `**Rests on:**` to both worked exemplars (F-3, W-2),
and updated the "Count the entry" sentence from `edit_markdown` to
`append_entry`.

**The same root cause recurred in three more surfaces, fixed in the same
pass** (found during this bug's "what else does this affect" sweep, not
scoped in the original report):

1. `codescout-companion/skills/reconnaissance/references/reconnaissance-patterns-template.md`
   — the R-N ledger template, bootstrapped into every consuming project as
   `docs/trackers/reconnaissance-patterns.md`. Same `edit_markdown` append
   prescription in "How to append" and the trailing template comment.
   Verified against the *live* R-N ledger (codescout repo, artifact
   `5696563f06b2c222`): already guarded (`entry_prefix: "R"`), and its own
   augmentation prompt had already been hand-patched to say "never
   edit_markdown, use append_entry" — the template shipped from this repo
   was never updated to match.
2. `codescout-companion/skills/tracker-hygiene/SKILL.md` Phase 5 ("Apply +
   Log") and `codescout-companion/skills/tracker-hygiene/references/tracker-hygiene-log-template.md`
   — identical pattern for HY-N entries and dated Sweep entries. Verified
   against the live HY-N ledger (codescout repo, artifact
   `7e498b6dcb45b924`): also already guarded and hand-patched at the
   instance level, source never fixed.
3. `buddy/tests/reconnaissance-eval/` (`README.md`, `prompt_tdd.yaml`) —
   the skill's own eval suite. Doesn't test the broken path (documented
   "PARTIAL control": the isolated eval profile strips MCP, substitutes a
   plain file fixture, never exercises `edit_markdown`/librarian) but
   described the native mechanism in prose as `edit_markdown insert_before`
   in three spots. Updated for accuracy; no scoring logic changed.

Both live ledgers (R-N, HY-N) had already been hand-patched at the
*instance* level — someone hit the break in practice and worked around it
locally — but the skill files and templates this repo distributes to every
other consumer were never fixed at the source until now.
## Tests added

Still none as automated regression coverage — this repo has no check that
a skill's prescribed tool calls remain legal against the MCP server it
drives, which is the gap that let this go stale silently in the first
place. Verified manually instead: `./tests/run-all.sh` and `buddy`
`pytest` both green after the edits (483 buddy tests, all bash suites).
`unverified:` is set in frontmatter for exactly this reason.
## Workarounds

Ignore Phase 3's append mechanism and call `append_entry` directly. The rest of
the skill — the seam definition, the scout phases, the severity rubric, the
promotion routing — is unaffected.

## Resume

Closed 2026-08-20. All items from *Fix* landed:
`codescout-companion/skills/reconnaissance/SKILL.md`,
`.../reconnaissance/references/reconnaissance-patterns-template.md`,
`.../tracker-hygiene/SKILL.md`,
`.../tracker-hygiene/references/tracker-hygiene-log-template.md`, plus
eval-doc accuracy fixes in `buddy/tests/reconnaissance-eval/`.
`codescout-companion/.claude-plugin/plugin.json` bumped and profile caches
verified per the standard release flow — see the version-bump-checklist
tracker for the specific version.
## References

- `codescout-companion/skills/reconnaissance/SKILL.md` — the stale instruction
- `codescout-companion/.claude-plugin/plugin.json` — the cache key to bump
- codescout `docs/templates/session-log.md` — the counterpart, updated `0b622f3a`
- codescout `get_guide("tracker-conventions")` § *Entry ids* — the rule violated
- codescout `docs/manual/src/concepts/statement-validity.md` — the stamp
- `codescout:statement-validity-session-log:F-3` — pre-written rows burning ids
- `codescout:prompt-surface-compaction-session-log:F-9` — the version-bump hazard
- `codescout-companion/skills/reconnaissance/references/reconnaissance-patterns-template.md` — sibling defect, R-N ledger template
- `codescout-companion/skills/tracker-hygiene/SKILL.md` + `.../tracker-hygiene-log-template.md` — sibling defect, HY-N ledger + Sweep entries
- `buddy/tests/reconnaissance-eval/README.md`, `prompt_tdd.yaml` — eval-doc prose updated for accuracy
- codescout `docs/trackers/reconnaissance-patterns.md` (artifact `5696563f06b2c222`) — live R-N ledger, already hand-patched at instance level
- codescout `docs/trackers/tracker-hygiene-log.md` (artifact `7e498b6dcb45b924`) — live HY-N ledger, already hand-patched at instance level
