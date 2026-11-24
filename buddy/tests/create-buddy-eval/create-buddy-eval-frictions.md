# Frictions Tracker — `/buddy:create` work

Deferred bugs and frictions surfaced during template + eval work.
**In-session fixes do not land here — only items that require a later
PR, design discussion, or wait for an unbuilt component.**

Entry format:

```
## F<N> — <one-line title>
**Status:** deferred
**Discovered:** YYYY-MM-DD during <pass / case>
**Surfaced by:** <draft id / commit / score session>
**Trace:** <pointer to specific artifact, file, line, or run note>

**Problem:** <2-3 sentences>

**Why deferred:** <reason — needs design / blocked on unbuilt component / refactor>

**Proposed fix:** <where the fix lands — template / command / eval / rubric>

**Resolved by:** (commit SHA when closed)
```

---

## F1 — Pass A scope dimension mis-scoped against template artifacts

**Status:** deferred
**Discovered:** 2026-05-17 during Pass A — yeti
**Surfaced by:** yeti scoring session; recurred in pheasant scoring
**Trace:** `buddy/tests/create-buddy-eval/rubric.md` Dimension 5; both
yeti and pheasant scored 2 by default convention (template is silent
on scope; rubric describes a command-flow concern).

**Problem:** Rubric Dimension 5 ("Scope correctness") asks whether
the command's Phase 1 elicited scope correctly. Pass A drafts SKILL.md
content from the template alone — there is no command, no Phase 1, no
scope question to evaluate. Default-scoring 2 across all cases makes
the dimension a no-op for Pass A and silently caps every total at 14/15
even when the template is perfect.

**Why deferred:** Needs a design choice between three rubric refactors,
not a quick patch:
1. **Drop from Pass A entirely** — scope is a Pass B concern; Pass A
   has 4 dimensions × 0-3 = 12 max with pass bar 10.
2. **Reframe for Pass A** — "Did the template's guidance on
   archetype/scope/naming surface the right elicitation hooks for the
   command to enforce later?" Tests template completeness for the
   scope-question handoff.
3. **Keep as-is, score 2 default** — current state; preserves the
   dimension's slot for Pass B but is structurally a no-op for Pass A.

**Proposed fix:** Option 2 (reframe) is most useful — it gives Pass A
real signal on whether the template helps the command. But ship the
fix only after Pass B exists and we know what guidance the command
actually needs from the template.

**Resolved by:** _(open)_

---

## F2 — No command-layer name-collision enforcement against builtin/global/project index

**Status:** deferred
**Discovered:** 2026-05-17 during Pass A — pheasant
**Surfaced by:** Pheasant subagent draft chose `Lammergeier` as the
archetype name; `performance-lammergeier` already exists as a builtin.
**Trace:** subagent draft output for pheasant case
(`runs/2026-05-17-pass-a.md` once recorded); summon.md Step 1 already
composes the 3-scope index — collision detection is one set-membership
check away.

**Problem:** A new buddy whose `<directory>` name matches an existing
specialist in any of the 3 scopes will silently shadow that specialist
on summon (or fail to be reachable if shadowed). The drafter has no
guard against picking a name in use. The pheasant draft surfaced this
when the model chose a high-altitude bird whose name was already
reserved for the performance specialist.

**Why deferred:** Belongs at the command layer (`/buddy:create`
Phase 1). Implementing it requires the command itself (sub-commit 3b),
which is not yet written. Template-only mitigation (a warning to the
drafter) is a partial fix and lands in-session as a separate friction
(F3) — but the real enforcement is at the command layer.

**Proposed fix:** `/buddy:create` Phase 1 calls the same 3-scope
discovery composition built in commit 2 (`summon.md` Step 1). Before
the brainstorm Phase 2, the command must:
1. Compose the index from all 3 scopes.
2. After the user proposes an archetype, check `<dir-name>` against
   the index keys.
3. On collision, refuse the name and suggest alternatives (other
   high-altitude animals, or scope-prefixing for project scope).
4. Display shadows clearly so the user understands the impact of
   any deliberate override.

**Resolved by:** _(open — slated for sub-commit 3b)_



## F5 — Template silent on Memory Cadence convention for lens-required specialists

**Status:** deferred
**Discovered:** 2026-05-17 during Pass A — owl
**Surfaced by:** Owl subagent draft omitted `## Memory Cadence` entirely;
reference Owl includes it with a cross-lens correlation save criterion.
**Trace:** Griffon draft (Pass A owl run); reference at
`/home/marius/work/stefanini/southpole/MRV-poc/.buddy/skills/snow-owl/SKILL.md` (moved 2026-05-17 from claude-plugins builtin scope).

**Problem:** The template marks `## Memory Cadence` as CONDITIONAL —
include only when save criteria diverge from the default two-strike
rule. For lens-required specialists this is technically correct (the
default rule still applies), but it misses a high-leverage pattern:
**cross-lens correlation** as a save trigger. The reference Owl
explicitly saves on "same audit produces both an output-lens
hallucination and a compliance-lens absence on the same claim" —
this is uniquely valuable for lens-bifurcated specialists, and lens
specialists who do not encode it lose this signal.

The pheasant reference does NOT include Memory Cadence (lens-required
but no cross-lens convention encoded). The owl reference does. The
template offers no guidance either way, so drafters reasonably
default to omitting.

**Why deferred:** Needs a policy decision:

1. **Make Memory Cadence RECOMMENDED for lens-required specialists**
   with cross-lens correlation as the canonical save criterion.
   Template patch: one sentence under the `## Lens` section, or a
   new paragraph in the `## Memory Cadence` conditional spec.
2. **Leave as-is** — let specialists declare cross-lens convention
   if they want it; do not impose a default.
3. **Stronger default**: bake the cross-lens correlation rule into
   the universal Memory Cadence injection (alongside the memory
   protocol), so lens-required specialists inherit it without
   needing a section in their own body.

Option 3 is the cleanest (matches the existing pattern of injecting
memory-protocol and gates at summon time). But it changes runtime
behavior; needs design discussion.

**Proposed fix:** Option 1 first (low-risk template patch, immediate
benefit). Revisit Option 3 if Memory Cadence drift becomes a wider
pattern across new specialists.

**Resolved by:** _(open)_



## F6 — Step 2 collision check is name-only, no conceptual-overlap surfacing

**Status:** deferred
**Discovered:** 2026-05-17 during Pass B — pheasant
**Surfaced by:** Pheasant subagent draft picked archetype "Himalayan
Griffon" with slug `data-hygiene-himalayan-griffon`. The command's
Step 2 collision check (dir-name only) saw no collision and proceeded
— but the new specialist substantially overlaps the existing
`data-leakage-snow-pheasant` (ML data hygiene + evaluation integrity).
**Trace:** Pass B pheasant subagent (agentId af2d... in
2026-05-17 session); Step 2 logic in `buddy/commands/create.md` lines
~70-95.

**Problem:** A new buddy with a different dir name but overlapping
craft / domain creates two specialists doing nearly the same work.
On summon, neither will shadow the other (different names), but the
user has redundant specialists with no good way to know which to
pick. The discovery composition (commit 4850c8c) returns both; the
empty-arg listing shows both as separate entries.

This is a soft failure — not a crash, not an immediate bug. But over
many `/buddy:create` invocations, the specialist landscape drifts
toward "many similar buddies with different names" rather than "a
small set of orthogonal crafts." That undermines the value of the
Hamsa-pattern specialist conventions.

**Why deferred:** Needs a Step 2b design:

1. **Lightweight option** — surface existing specialists' titles +
   one-line descriptions during Step 2 so the drafter sees what
   already exists. Drafter judgment closes the gap. Cheap, no new
   logic, mostly a presentation change.
2. **Semantic option** — read existing specialists' `## Voice` and
   `## Operating Principles` sections, embed (or summarize), and
   flag if proposed specialist's brainstorm answers are semantically
   close to an existing one. More accurate but adds an embed step
   and a similarity threshold to tune.
3. **Hybrid** — show titles + descriptions always (cheap); add
   semantic surfacing only when hint is long enough to be embedded
   meaningfully (≥ 30 words).

**Proposed fix:** Option 1 (lightweight) ships in the next
`/buddy:create` patch. Option 3 (hybrid) revisit after we see how
often near-duplicates actually get created in real use.

**Resolved by:** _(open)_
