# Reconnaissance — the recon-patterns tracker and promotion routing

> **Load when:** you are promoting a recurring finding into a durable pattern,
> or auditing the promoted set. This is a **separate workflow** from running
> recon — the four phases in `SKILL.md` do not depend on any of it.
>
> Split out of `SKILL.md` 2026-09-01. Content is verbatim.

---

## The recon-patterns tracker (per project)

Each project that uses this skill keeps its own R-N ledger at
`docs/trackers/reconnaissance-patterns.md`. This is a librarian
tracker artifact, separate from the per-work-stream session logs in
Phase 3 — its scope is the **skill itself**, not any one task. Entries
describe when recon helped (hit), when it missed (miss), and what
should change in `SKILL.md` next (proposal).

**Bootstrap (first use per project).** Read
`references/reconnaissance-patterns-template.md` for the body, then create the
ledger through the catalog — which registers it in the same call:

```python
artifact(action="create", kind="tracker", title="Reconnaissance patterns",
         rel_path="docs/trackers/reconnaissance-patterns.md",
         topic="reconnaissance", tags=["reconnaissance", "skill-meta", "scout"],
         body="<the template body, below its fenced frontmatter block>")
```

`<skill-dir>` resolves to the cached skill location — typically
`~/.claude/plugins/cache/.../codescout-companion/skills/reconnaissance/`.
Verify the path with `claude plugin list` or read the skill's own
`base directory` line.

**Do not `cp` the template.** Its frontmatter is fenced so the template itself is
not classified as an artifact, so a literal copy yields a ledger with no
frontmatter at all — no `kind`, no `status`, no librarian row.

### Bootstrap wakes a whole namespace — scout the prefix first

**Before claiming `R-`, check whether the project already writes it:**
`grep -rnE '\bR-[0-9]+\b' docs/`. If another artifact uses it, take a free prefix
(`RP-`) and say so at the top of the ledger.

This is not a tidiness rule. `link_scan` binds a token to its **defining heading**,
so a prefix with no definer anywhere is inert — every `R-N` in the corpus is read as
prose noise, the same gate that keeps `UTF-8` and `SHA-256` silent. A ledger whose
entries *are* proper `## R-N — title` headings gives the prefix its first definer,
and in that one write **every bare `R-N` in the project becomes a live citation** —
resolving wherever a number happens to match, dangling where it does not.
Bootstrapping a ledger is a corpus-wide reclassification of one namespace, not a
local act.

Measured on a first bootstrap, three `link_scan` runs over one corpus: dangling
citations **5 → 17** on creating an `R-` ledger of four entries, and back to **5** on
renaming it to `RP-`. The `+12` were mentions in six other files that had been
silent for months. Worse than the count: one *shipping* document's back-reference to
its own item 4 stopped dangling because it had been **captured** — bound to the new
ledger's unrelated entry 4. A dangling citation is visibly broken; a captured one
reads as healthy, and the ledger would have captured five more as it grew.

The incumbent there defined its items as **table rows**, which define no token — so
the collision was invisible to `link_scan` right up until the moment it was created.
A `grep` finds it; a link check cannot.

**So, immediately after bootstrap:** run `librarian(action="link_scan")` and compare
corpus dangling against a pre-bootstrap run. A **drop** anywhere is a captured
citation, not a repair. Prefer yielding the prefix to renumbering the incumbent —
especially if the incumbent ships; a four-entry ledger costs one line to rename.

Generalises past this skill: it applies to any new ledger in a corpus that already
writes `PREFIX-N` in prose.

**When to append an R-N entry.** After a recon scout completes:

| Did recon catch the drift? | Action |
|---|---|
| Yes, and downstream gates (spec review, compiler) confirmed | Write a `hit` entry, cite the W-N in the work-stream session log |
| No, but a downstream gate caught it instead | Write a `miss` entry, cite the F-N. Optionally a `proposal` if the fix is obvious |
| Drift was a false alarm | No R-N entry (work-stream session log only) |

Per-project R-N entries are short — one paragraph + evidence. The full
narrative lives in the work-stream session log; the R-N entry is the
cross-cutting lesson.

**Sync flow.** When an R-N proposal reaches promote-when threshold,
sync it back into the skill:

1. PR against `codescout-companion/skills/reconnaissance/SKILL.md`.
2. PR description cites the R-N IDs + their session-log evidence.
3. On merge, mark the project's R-N entry `Verdict: promoted` and
   pin the commit SHA + skill version.

Manual flow. No automated cross-project aggregation; the skill is the
canonical destination. Per-project trackers are the substrate that
earns its way in.

**Why per project, not global.** Recon patterns are project-shaped:
a Rust workspace's blast-radius question (struct-field threading,
trait-method addition) differs from a TypeScript monorepo's (barrel
re-exports, generated types). Per-project ledgers keep the lessons
close to the substrate that produced them. Cross-project lessons
graduate via the sync flow — explicitly, not implicitly.

### Promotion routing — craft-shaped vs project-shaped

`promote-when` has **three** destinations. Classify the lesson before promoting.

**Routing test:** *"Would this rule mislead a different project?"*

- **No — it's craft-shaped** (a language / tool / protocol pattern true in any repo):
  promote to this `SKILL.md` via the Sync flow above. Global; every project loads it
  — *when this skill is invoked*, which is the limit to weigh against the next option.
- **No, AND it is measured not to hold unaided** — promote instead to the host tool's
  **session-opening surface**, if it has one. codescout's
  `project-activation-bootstrap` guide is hard-injected on the first tool call of every
  session: uncapped, harness-independent, and requiring no skill invocation, so it is the
  only channel that reaches an agent who never runs this skill. Two conditions, both
  required:
  1. a **base arm** — a measurement that an unaided agent does *not* already do this.
     Precedent: the verify-before-assert imperative, bare arm 0% against planted-belief
     traps, shipped arm 100% over 35 runs, shipped 2026-08-16 as codescout `5917e37e`.
     Without a base arm this is an addition with no shown deficit, which is the
     accretion this section exists to prevent.
  2. a **slot budget** — bytes here are paid by every session, so the cap is one or two
     laws, not the promoted set. A law that fits the skill fits the skill.
- **Yes — it's project-shaped** (this repo's dialect, build quirks, gotchas): promote to
  the project's codescout memory, not the global skill —

  ```
  memory(action="write", topic="reconnaissance", content="<one distilled rule>")
  ```

  This is the *topic-based* memory system (an on-disk `.codescout/memories/reconnaissance.md`)
  which the companion advertises by name at every SessionStart, so a future agent sees
  `reconnaissance` in the memory list and is nudged to read it. (Not the semantic
  `remember`/`recall` system — that is meaning-search, not advertised by name.)

**Rule format — concrete and bounded, never prose.** A memory rule names the trigger and
the action with a checkable bound. Write *"before asserting a checkable fact about a symbol,
read it this session"* — not *"be careful about hashes."* Each entry is the one-line rule +
a `(R-N)` / `(F-N)` pointer to its ledger origin. The tracker keeps the full narrative; the
memory carries only the imperative.

**Cap ≈ 10 rules.** The advertised channel costs tokens in every session that reads it; an
unbounded memory bloats and gets ignored (the same failure as a prose tracker no one opens).
When the topic exceeds the cap, consolidate near-duplicates or demote the weakest rule back
to tracker-only.

**The channel is ungated — guard it.** Any agent can `memory(write)` this topic; the
substrate enforces nothing. So promotion writes happen **only** through this routing, at a
real promote-when threshold — never ad-hoc, never from a subagent mid-task. The bar is a
norm this skill owns, not a permission the system checks.

As with the Sync flow, the `R-N`/`F-N` ledger entry stays the source of record; the memory
rule is its promoted, distilled projection.

### Every promotion audits the promoted set

**Promoting a law is the trigger to re-verify the ones already promoted.** A promoted
law is text, and text goes stale in four distinct ways with four different remedies.
Check the existing set against these *before* adding to it — the set is small, the audit
is cheap, and it is the only thing stopping this section becoming the ledger it was
extracted from.

1. **False** — the substrate changed and the law now describes behaviour that does not
   exist. Precedent: codescout's `iron-laws-detail` guide asserted `cat src/foo.rs` was
   permitted on bounded files when the gate had never permitted it; measured **0/10**
   unaided survival against that one sentence. *Remedy:* fix the text **and** add a test
   pinning the claim to the code, or it drifts again.

2. **Outgrown** — still true, too narrow, and the ledger keeps recording recurrences the
   promoted wording does not cover. Precedent: *"Grep scope: workspace root, not the file
   being modified"* (promoted 2026-05-23 from `codescout:R-3`) against a chain that then ran
   `codescout:R-113` → `codescout:R-77` → `codescout:R-79`, adding architectural-inference-instead-of-grepping,
   wrong-query-shape, and negative-result-authorises-deletion — **four** self-labelled
   instances of a law that had been promoted after the first, the last of them one
   command from deleting 118 MB of live index. (`codescout:R-87` is the same law's *hit*: the scout
   ran, and found the abstraction already there.)
   **A recurrence of an already-promoted law is a defect in the promoted text, not a new
   entry.** *Remedy:* re-promote the evolved form. Filing the fourth instance and moving
   on is how a guard stays narrow while the failure keeps happening. **Resolved
   2026-08-16** — the Phase 1 bullet now carries all four mechanisms; this row records
   the audit that produced it, per the closing paragraph.

3. **Unreachable** — general enough, and still not reached at the moment of need.
   *Remedy is placement, not rewording.* Precedent: the substrate law in Phase 1 already
   names *"a test suite importing an installed wheel instead of the working tree"*, which
   is the same class as `codescout:R-89`'s stale-build miss — and `codescout:R-89` recurred **×4**, naming a
   session-log entry as its parent, without anyone connecting it to the promoted law. The
   text was right and was never fetched. This is the routing question above: if a law
   keeps recurring in sessions that never invoke this skill, the fix is the
   session-opening surface, not a better sentence here.

4. **Obsolete** — the failure it guards can no longer happen, because a structural gate
   now prevents it. *Remedy:* cut it. A law guarding an impossible failure is decoration
   paying rent in every session that loads this file, and the bias on a promoted set
   should be subtraction.

**Record the audit, not just the promotion.** Note in the ledger entry which of the four
each existing law was checked against and the verdict, so the next promotion inherits the
check rather than repeating it. An audit nobody recorded is one that will be skipped next
time on the grounds that it was probably done.
