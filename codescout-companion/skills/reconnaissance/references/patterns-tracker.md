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
tracker artifact, separate from the recon box of
Phase 3 — its scope is the **skill itself**, not any one task. Entries
describe when recon helped (hit), when it missed (miss), and what
should change in `SKILL.md` next (proposal).

**Bootstrap (first use per project).** Search the catalog for an existing ledger
before creating one. Run the namespace preflight below first. Set `prefix` to the
unused prefix you selected (one to three uppercase letters, usually `R` or `RP`),
and `template_body` to the Markdown below the fenced YAML example in
`references/reconnaissance-patterns-template.md`. Then execute:

```python
created = doc(action="create", kind="tracker", status="active",
              title="Reconnaissance patterns",
              rel_path="docs/trackers/reconnaissance-patterns.md",
              topic="reconnaissance", tags=["reconnaissance", "skill-meta", "scout"],
              extra={"entry_prefix": prefix,
                     "snapshot_anchor": "| ID | Date | Verdict | Pattern | Evidence (recon entry) |"},
              body=template_body)
tracker_id = created.get("id") or created["key"]
```

This registers the ledger with explicit metadata and reserves its prefix in the
same call (on an opted-in checkout the checkout write lock serialises two such calls). A prefix already owned by another ledger is refused before the file is
created; select a free prefix and retry. Use that prefix consistently for entries,
append calls and the Index. The entries of the `recon` box are cited by key,
`[[<entry key>]]`, so they need no prefix.

A literal copy of the template has no leading YAML frontmatter, but current
codescout can still classify it as an active tracker after `reindex` through its
built-in `docs/trackers/**/*.md` rule. Explicit creation avoids waiting for reindex,
sets the intended title/tags/topic, and declares namespace ownership. Copying the
fenced YAML block does none of those explicitly.

### Bootstrap wakes a whole namespace — scout the prefix first

**Before reserving a prefix, inspect its existing uses across the project.** Set
`prefix` to a candidate, then search Markdown outside `docs/` as well as inside it,
including hidden memories:

```python
grep(pattern=rf"\b{prefix}-[0-9]+\b", path=".", glob="*.md", include_hidden=True)
```

Inspect the matches and any truncation or time-budget notice. Search roots or
ignored Markdown omitted by the walk separately if they belong to the catalog.
A zero from a filtered or incomplete search does not establish that a prefix is
free. Existing prose and table rows matter even when they define no citable entry.
Choose a different prefix when those uses describe a different namespace; record
the choice at the top of the new ledger. Prefer yielding to an incumbent over
renumbering a shipping document.

**Take a baseline before creating the ledger.** Ensure the relevant Markdown is
indexed (`librarian(action="reindex")` when needed; on a checkout whose rows are not kept
it makes none, and doctor's `summary.not_run` names the checks that did not run), then save a read-only
`librarian(action="link_scan", write=False)` result. Use the same scope and artifact
limit for the post-bootstrap scan; a nested workspace may require `scope="repo"` (a
derived-index checkout, whose root `.gitignore` commits `/.codescout/derived.db*`, takes
`scope="project"` only and has no artifact limit).
Check `counts.scan_truncated` (absent on a derived-index checkout), `counts.unreadable`
and `counts.truncated`, and page findings before treating a comparison as complete.

On a repository that has not opted in to a derived index, a prefix becomes known to
`link_scan` through a defining heading **or an `entry_prefix` declaration**, including an
empty ledger. Rows alone do not define entries. A wholly unknown prefix is suppressed as
prose noise; once known, its unresolved tokens become dangling, and matching tokens may
bind to a definer. On a derived-index checkout no prefix gate applies: a bare token cites
only an entry of its own document, so it never dangles and never binds to another
definer; `[[<key>:TOKEN]]` resolves to the one document that defines the token, `<key>`
itself or one `<key>` owns as a folder index, and is `undefined_token` (dangling) when none
does or `ambiguous_token` when several do.
Declaring ownership prevents a second declaration, but cannot establish that
existing prose belongs to that owner. Undeclared headings and row-only ledgers
still need inspection.

**After bootstrap, inspect changed bindings before writing edges.** Compare the
source/destination pairs in `edges_missing` and `edges_stale` with the baseline,
as well as ambiguous and dangling findings. A drop in dangling can be a legitimate
repair or a citation captured by an unrelated new definer; the count alone cannot
tell which. Read the citing text and intended destination. Only after confirming
those bindings, materialize/prune them with `librarian(action="link_scan", write=True)`.
On a derived-index checkout the report has no `edges_missing` or `edges_stale` and
`write=True` is refused: the index derives every edge from the files, so a capture is live
once the files say so. There a new ledger can change only a `[[<key>]]` or
`[[<key>:TOKEN]]` whose `<key>` is the ledger's own or that of a folder index owning it:
compare the `dangling` and `ambiguous` findings (each
names its citing document, line and citation) with the baseline, and correct a wrong
capture in the files.
If a conflict appears, correct the prefix and every related append call and rerun
the scans; the `doc` tool's `rekey_prefix` action supports a dry run for an existing ledger.

The isolated integration tests in `tests/recon_bootstrap_test.py` reproduce both
wrong-edge capture and legitimate repair, plus the ownership refusal. These are
separate outcomes, not interchangeable changes in a summary counter.

**When to append an R-N entry.** After a recon scout completes:

| Did recon catch the drift? | Action |
|---|---|
| Yes, and downstream gates (spec review, compiler) confirmed | Write a `hit` entry, cite the `win` entry of the recon box as `[[<entry key>]]` |
| No, but a downstream gate caught it instead | Write a `miss` entry, cite the `friction` entry as `[[<entry key>]]`. Optionally a `proposal` if the fix is obvious |
| Drift was a false alarm | No R-N entry (recon box only) |

Per-project R-N entries are short — one paragraph + evidence. The full
narrative lives in the recon-box entry; the R-N entry is the
cross-cutting lesson.

**Sync flow.** When an R-N proposal reaches promote-when threshold,
sync it back into the skill:

1. PR against `codescout-companion/skills/reconnaissance/SKILL.md`.
2. PR description cites the R-N IDs + their recon-box entries.
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
