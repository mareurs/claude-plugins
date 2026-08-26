---
name: reconnaissance
description: Use before subagent dispatch, before editing code that changes a struct, function signature, or API contract, or after a tool response contradicts the plan. Appends friction (F-N) and wins (W-N) to the project's session-log tracker.
---

# /codescout-companion:reconnaissance

A **seam** is a place where your next action depends on the current shape of code you have not read this session: a struct's fields, a function's signature, an API's response, a tool's actual output. Scout the seam before you act. When plan and reality disagree, externalize the gap as a session-log entry with a monotonic ID — IDs make lessons portable across sessions; entries without IDs don't compound.

**REQUIRED SUB-SKILL:** None. Composes with `subagent-driven-development`, `writing-plans`, and `verification-before-completion`.

## When to Use

- **Before delegating to a subagent.** Scout the seam yourself first — read the affected symbols, confirm the plan's code matches reality. Subagents inherit drift; the controller absorbs it.
- **Before editing code whose shape you have not verified.** If the change names a struct, function, type method, or API you haven't read this session, read it before editing.
- **After a tool response disagrees with the plan.** Empty results where N were predicted, compile errors on plan code, a wrong field name, an unexpected status — signals that plan is stale or substrate moved.

## When NOT to Use

- **Read-only Q&A that *describes behavior*.** "What does X do?" — answer via `symbols(name=..., include_body=true)`. No scout, no entry. **But asserting a specific, checkable fact is not Q&A** — "it IS BLAKE3", "the field IS named Y", "it's at line N" — especially when the assertion will be presented as a recommendation or written into a doc. Read the symbol this session before you commit the fact. (R-19)
- **Genuinely no-decision edits.** Whitespace, comment typos, version-string bumps that no test asserts on. When in doubt whether an edit is "mechanical," scout — one extra `grep` costs less than one missed invariant. Editing a markdown file that backs an `include_str!`'d constant is NOT mechanical: see Phase 1's `include_str!`'d-constant bullet below.
- **Already in verification phase.** Use `verification-before-completion` for commit gating.
- **Already scouted this seam in the current session.** One pass per seam — re-scouting the same struct/function is noise unless the source has changed since.
- **Underspecified refactor prompts** (`"refactor X for readability"` with no shape contact named). Ask the user whether shape changes; do not scout speculatively.

## Method — Four Phases

```
1. Scout (read actual shape)
   ↓
2. Compare (plan vs reality)
   ↓
3. If gap     → F-N entry  (friction: drift, surprise, cost)
   If win     → W-N entry  (pattern that prevented worse)
   If match   → silent resume (no entry needed)
   ↓
4. Resume task + announce one-line outcome to user
```

### Phase 1 — Scout

For each symbol, type, or contract about to be touched:

- Read the symbol body: `symbols(name=..., include_body=true)`
- Read callers if shape changes: `references(symbol, ...)` or `call_graph(symbol, direction="callers")`
- For tools / external APIs: read the actual response shape, not docs. Run the call once, inspect output.
- **A tool that resolves its target from the environment has a SUBSTRATE as well as a verdict.** Before believing *or acting on* a diagnostic, read its `loaded N from X` preamble and reconcile N against a count you took yourself. A retired-but-still-present datastore keeps answering, so the failure is a confident wrong number, never an exception. When two tools disagree, the question is not whose logic is wrong but **which world each one read**. Same class: an ORM pointed at a stale replica, a linter reading a cached AST, a test suite importing an installed wheel instead of the working tree. A *repair* tool that reads the wrong substrate will write that world back. (Promoted 2026-08-08 from a downstream project's R-N ledger.)
- **A rendered read is evidence about content, not about bytes.** Before an exact-match edit whose anchor holds a path, a long literal, or anything a viewer might shorten, verify at the bytes (`cat -A`, a checksum, a byte count). Display layers abbreviate paths, normalise whitespace, truncate with ellipses and fold unicode — and exact-match editing is the one operation where that gap is fatal. It fails as *old_string not found*, which reads like a stale file rather than a lossy view. **The tell: when a search pattern matches text that its own rendered result does not contain, the renderer is lossy — stop and check.** (Promoted 2026-08-08 from a downstream project's R-N ledger.)
- **Scope an infra render to the object under test — rendering the whole directory prints the Secrets too.** Confirming a template still compiles is the right instinct, but `ytt -f <dir>`, `helm template`, `kustomize build`, `terraform plan`, `docker compose config` and `kubectl get -o yaml` render *everything* in scope — including `Secret` objects carrying live credentials — straight into the transcript, where they persist long after the check. Render the single file you changed, or filter `kind: Secret` / `stringData` / `data` before displaying. This is the one scout step with a disclosure side effect: read-only against the cluster is not read-only against your transcript. (Promoted 2026-08-08 from a downstream project's R-N ledger.)
- **A proposed fix — and equally a prohibition — is a claim about CURRENT STATE. Verify it before designing around it.** *"Just pin X"*, *"enable X"*, *"add a cache for X"* each assert that X is not already done. *"Never do X"*, *"that would be unsafe"* assert that X is not already done **and** would not be safe. Read the call site before building on either. Being right in general is what stops you checking whether it is true *here*, and a claim about configuration reads as a fact rather than an assertion, so it slips past the reflex that would question a causal claim. Treat *"X is already set"* as a **finding, not a dead end** — it is evidence the cause lies elsewhere. The prohibition form is the costliest and the easiest to miss, because it reads as judgement rather than as something anyone could look up: stated as a principle, it can travel into a filed defect entry and into a question put to a human, and rule out the exact one-line repair already shipping in the codebase. (Promoted 2026-08-08 from a downstream project's R-N ledger; threshold met at 3 datapoints, the third being the prohibition form.)
- **A green result certifies the path that actually EXECUTED — check both what was configured out of the run and what could never have been reached.** Two ways a pass means nothing, and neither raises. Something was **configured out**: a whitelist, a skip, an opt-in check left off — a checker's own config is part of its result, so `[OK]` can report on a check that was excluded from every case it ran against. Or the fixture **could never reach the gate**: values that cannot match the regex, enum, or format validator the behaviour passes through, so the assertion never ran at all. The second hides inside inherited test-data conventions — a placeholder chosen for a *different* assertion is often unreachable-by-construction for this one, and it looks idiomatic right up to the point where it silently disables the check. The tell in both cases is a result that is green *and* uninformative. Before trusting a green, name the path it proves; if it would read the same in a broken world, it proves nothing. (Promoted 2026-08-08 from a downstream project's R-N ledger; threshold met at 2 datapoints, one per mechanism.)
- **A search that finds nothing is evidence about the search, not about the world — and an instrument that returns a full answer is evidence about the predicate you supplied.** A path, a pattern, a sort key, a field name: whichever piece you wrote from memory rather than verified against the data is the one that fails silently, because the instrument still answers in its own terms without complaint — an absence at least prompts the question, a wrong-but-complete answer does not. **Run a positive control before trusting any of them — one per state you believe the instrument can report.** Make it find, rank, or classify a case whose answer you already know, for *each* outcome you expect to exist. A single confirmatory probe cannot reveal a **missing** state, and a case matching none of your expectations is the discovery. Re-reading the same instrument with the same belief does not substitute for this, and does not catch what it misses. **This fires on anything you are about to generalise from — a report, a scan, a linter, a diagnostic — not only on a query that came back empty:** the trigger is *"I am about to say all X are Y"*, not *"my grep returned zero"*. Three ways a zero lies, none of which raise. **Scope** — the assertions, token substitutions, and constructor sites you are hunting routinely cross crate and module boundaries, so search the tree, not the file you are editing. **Shape** — a repo usually holds more than one convention, and a query that answers *"what is in this directory?"* never answers *"does this thing have a test?"*; phrase the query as the question you actually have, and search for the *class* across the tree rather than the filename you expect to find. **Encoding** — a literal can be defeated by the artifact's own markup, whitespace, or line wrapping, so when the question is *"did this change land?"*, compare the artifact (`diff`, checksum) instead of searching it; a grep is evidence about the pattern, and pattern shape is exactly what a deployment check must not depend on. Then the hard rule, because this failure is the irreversible one: **a negative search result must never authorise a deletion.** Removal is authorised by a *positive* finding — this path is gone, measured — and preferably by two independent signals, one of them established for a different reason. (R-3 → R-113 → R-77 → R-79 → R-104 in codescout's `docs/trackers/reconnaissance-patterns.md`: the ledger's most-repeated law at 16% of all entries and five self-labelled recurrences, which is why this bullet is longer than its neighbours. A sixth, `claude-plugins:R-4`, is why the positive-control sentence now covers reports and not only searches — it was loaded in the session that missed it.)
- **A check that reads where the writer wrote, or is computed from the thing it judges, cannot fail — treat its green as unmeasured.** The bullet above disciplines the *reader*; this one disciplines what you accept *as* a check. Before trusting any gate, ask what it reads and whether that is the same place the change landed. Three tells: it validates the field it just set; it iterates a collection the defect removes from; it is a ratio whose numerator and denominator both contain the quantity being moved. Such a gate reports healthy in the broken world **by construction**, so its green carries no information — and the worst of them do not merely fail to fire, they *actively reassure*, hardest exactly when someone is deciding whether to look closer. The remedy is a second, independently-sourced signal: read the **consumer's** copy, enumerate the **whole** namespace, measure the absolute quantity rather than its share. (`claude-plugins:R-5` — four instruments in one session, in four different systems, none of which raised anything; two produced findings filed *wrong* before being caught. Promoted 2026-08-26 on a measured screen rather than on argument: control 0/3 **and** this skill 0/3 on `reconnaissance-eval/scenarios/instrument/self-validating-gate` — the behaviour was absent by default *and* absent from this skill.)
- **For files backing `include_str!`'d constants** (`source.md`, embedded templates, prompt surface files): grep `*_invariants` modules and `<CONST>.contains` / `<CONST>.find` / snapshot calls naming the surface. Enumerate every test that asserts on the rendered output before editing. "It's just a doc change" is the loophole that lets size-cap, byte-budget, and required-mention invariants fire downstream. (R-1 + R-7 in codescout's `docs/trackers/reconnaissance-patterns.md`.)
- **Seam class: schema-migration ordering.** Adding a column/field is a seam whose far side is every later migration that rebuilds the same table; the rebuild's `INSERT … SELECT` column list is a silent allow-list — an unnamed column is dropped on swap, no error. Grep the migrations dir for the table name and check every later rebuild's SELECT carries it. (R-41 in codescout's `docs/trackers/reconnaissance-patterns.md`.)
- **Seam class: writer-shape ↔ reader-surfacing.** When a diff's writer produces a new value shape (id-keyed reference, optional field), read every reader and confirm each absent-key / None branch RESOLVES the other shape rather than dead-ends — a dead-end silently drops every value stored in that variant. Shared incidental test preconditions ("target always has a slug") mask it. (R-42 in codescout's `docs/trackers/reconnaissance-patterns.md`.)
- **For subagent dispatch:** also scout session-level state — what `get_guide` topics has the parent triggered, what workspace is active, what's already in the `@ref` buffer. The `guide_hints_emitted` ledger (per-MCP-session, shared across parent and subagents) has no read-only query tool; the parent must remember what it triggered. Brief the subagent explicitly: *"I've triggered: [librarian, progressive-disclosure]"* lets the subagent predict its own V2 auto-inject behavior accurately. (R-9 in codescout's `docs/trackers/reconnaissance-patterns.md`.)
- **When a scout finds a defect *class*, not an instance, enumerate the class across the whole corpus before writing any fix.** The triggering instance is rarely the only one, and fixing only it leaves nothing to prompt anyone to re-check the rest. One project's scout found a workbook sheet failing a three-attribute shape check; sweeping the same check across all sibling files in the corpus (one scripted pass, ~30s) surfaced two more defects the triggering sheet gave no hint of — one of them a stakeholder's already-delivered answer that had sat mis-recorded as "empty" for three weeks because nothing prompted a re-open.

- **Freshness is a property of the copy that SERVES you, and it breaks on three independent axes — build, process, and distribution. `mtime` answers none of them.** Anything `include_str!`'d — every guide, prompt surface, embedded template — is fixed at *build* time, frozen again at *process start*, and, when installed rather than run from source, frozen a third time by whatever key the **cache** is addressed on. A long-lived MCP or language-server session outlives any number of rebuilds; a version-keyed plugin cache outlives any number of commits. Two measurements, one law. 2026-08-16: a binary whose mtime was *newer* than the commit had genuinely built the change (`grep -c "<new string>" target/release/<bin>` → 1), yet the serving process had started 88 minutes earlier — so the shipped guidance reached nobody and was reported to a user as delivered. 2026-08-20: a skill edit was committed and reviewed, but its commit did not bump the version the plugin cache is keyed on, so all three installed profiles kept serving the pre-edit copy — and the session that made the edit was the *least* representative observer of whether it shipped, being the only one reading the repo-source copy its own reload had handed it. **Probe the copy the consumer actually loads; every upstream proxy for it reads green in the broken world** — commit, install record and directory listing all said yes, and only the served file's own bytes said no. The honest claim for an unprobed edit is "committed"; **live** needs a fresh process, a fresh cache, and one probe. (R-89 in codescout's `docs/trackers/reconnaissance-patterns.md`; the distribution axis was measured as `prompt-surface-compaction-session-log:F-9`.)
- **Re-entering your OWN bug file or plan to implement it counts as a seam — authorship is no exemption.** Scout the root cause again, and when it cites two functions, read the layer between them. Session-authored artifacts fail under later scrutiny at a rate worth planning for: three in one sitting in one project — a bug file whose cheapest fix option was exactly *inverted*, two doc comments overstating guarantees the code did not give, and a root cause blaming LSP staleness for what was a plain property of the code. The common factor is not carelessness in any one of them; all three were written *while doing the work they describe*, when the writer's model is most confident and least tested. The countermeasure is temporal, not attentional — re-read on re-entry, not harder on write. (R-49 in codescout's `docs/trackers/reconnaissance-patterns.md`.)
- **A trait or interface method added to CORRECT a behaviour gets no default implementation — then the compiler enumerates the implementors.** A default that delegates to the old path compiles clean and leaves every implementor free to keep the defect, now behind a method that *looks* like it fixed it — and no test fails, because no test exists for a method nobody calls yet. Refusing the default turned an invisible five-site bug into five compile errors naming their exact locations. Applies in any language with default trait/interface methods. (W-36 in codescout's `docs/trackers/bug-fix-session-log.md`.)
- **A deferral rationale is a claim, and the least-audited kind — re-cost it before you accept it.** A `## Fix` section that records *why the work was not done* — a site count, a binary "option A or B, both bad", a premise about existing machinery, a "cannot reproduce" — is a hypothesis about the substrate exactly as a root cause is, but it reads as a settled decision. A wrong root cause is corrected the moment you fix the bug; a wrong deferral is never revisited, because its whole function is to stop anyone looking. **The bias has a direction**: a rationale is written at the moment someone decides to stop, so nobody drafts an estimate that makes the work sound easier — that estimate would not justify stopping. Measured across two clusters, nine rationales, every one inflated. *"A 38-site mechanical change"* was 133 sites. *"Pick one of two, both bad"* had a third option inside a type one of them already touched. *"The guard proves the condition is detectable"* — the guard returns `Ok` on line 1 in every real session. *"Not yet reproduced"* was true only of the recipe the file had written for itself. *"Needs a schema change plus a retroactive back-fill"* was one markdown field and thirteen entries, and the back-fill **found** three defects rather than costing anything. *"The generalisation was the agent's, not a response to repeated cost"* was refuted by a user-raised proposal filed two days earlier, under a name the closure never checked. **So: re-run any number, read the consumer behind any binary, probe any premise once, and ask whether a "cannot reproduce" describes the bug or only the recipe.** (R-95 + R-92 in codescout's `docs/trackers/reconnaissance-patterns.md`.)
- **Seam class: an instrument that writes into the corpus it measures.** When an analysis writes its artifacts *inside* the tree it reads, it becomes part of its own subject — nothing errors, the numbers simply start describing the measurement. A probe writing its `sessions.json` and `vocab/*.json` into `scratch/` inside the repo it was profiling inflated that repo's identifier vocabulary 35,496 → 221,214 (**6.2×**) while the file count moved 1374 → 1383, and every downstream metric was computed against it. **A read-the-code scout cannot find this** — the overlap is created by *running* the pipeline, not by its static shape — so check the output path against the measured root before the first run, and again after. Two forms, and the second is invisible to a directory exclusion: where output *happens* to land, and whether the system's own emissions **re-enter its input**. A provenance sidecar whose records and `Derived-From:` trailers feed later sessions sits inside its own corpus permanently and by design; a staleness check that reads its own trailers as evidence is self-confirming. Applies to vocabulary builders, corpus statistics, embedding jobs, and any `docs/`-writing analysis whose corpus includes `docs/`. (R-51, the complement of R-50, in codescout's `docs/trackers/reconnaissance-patterns.md`.)

**Statusline marker (recommended).** Touch `.buddy/$SID/recon-active` once at scout start so the user's statusline shows `[recon]` for 30 minutes. The badge signals scout-in-progress; the user knows not to redirect mid-scout, which prevents abort-and-restart cost:

```bash
SID=$(cat .buddy/.current_session_id 2>/dev/null) && \
  [ -n "$SID" ] && mkdir -p ".buddy/$SID" && touch ".buddy/$SID/recon-active"
```

Skip silently if the marker dir is unavailable. The skill works without the badge; the badge does not work without the skill.

### Phase 2 — Compare

State what the plan / docs said vs. what reality holds. Three outcomes:

- **Match** → scout passed; resume task. No entry.
- **Gap** → continue to Phase 3 (F-N).
- **Match, and the scout was non-trivial** (multiple files read, hidden contract surfaced, non-obvious shape) → Phase 3 (W-N). A pre-dispatch scout that prevented a subagent slip is a W-N event even though nothing broke.

### Phase 3 — Externalize

Findings go into `docs/trackers/<topic>-session-log.md` in the active project.

**Topic naming.** Pick a topic from the work stream, not the seam: `bug-fix`, `auth-refactor`, `jsonpath-impl`, `migration-2026-q2`. One topic = one work stream across sessions. If the right topic file already exists, append; if not, copy the template:

```bash
cp <codescout-repo>/docs/templates/session-log.md \
   docs/trackers/<topic>-session-log.md
```

Resolve `<codescout-repo>` from `claude mcp list` (the codescout server's source path) or ask the user. Do not hardcode a path — installations differ.

**ID + append — one call.** Do not hand-allocate the ID by grepping the tracker, and do not pre-write the Index row before the section exists — both race a peer session, and a pre-written row consumes the id it names (this is why codescout's own `statement-validity-session-log` starts at `F-2`/`W-3`). Let the server allocate and write the section in the same call:

```python
artifact(action="append_entry", id="<tracker artifact id>", id_prefix="F",
         anchor_heading="## Template for new entries",
         title="<one-line title>", body="**Observed:** ...")
```

One write: the server allocates the next `F-N` / `W-N` id (separate counters), writes `## F-N — <title>` at the ledger's own level — the only heading shape `link_scan` accepts as a definition — records the high-water mark, and stamps `**Valid:** dated <today>` unless the body declares a class. **`dated` takes no trailing text.** Put any qualifier on a following line — `**Valid:** dated 2026-05-18` then a blank line then the prose. An em-dash tail after `dated` is rejected outright (`is not an ISO date`), and the two branches of the grammar differ here: only `conditional — <event>` carries one. **Then** add the Index / Wins Index row using the id the call returned.

`edit_markdown` is not the append path, though it works at first: a fresh copy of the template ships without `entry_prefix`, so it's directly editable — but once `entry_prefix` is declared to guard the ledger (which `get_guide("tracker-conventions")` instructs), the librarian guard refuses direct edits and only `append_entry` writes. Reach for `edit_markdown` for prose sections and index-table touch-ups, never for allocating an entry.

Never reuse an ID. Never skip an ID. Entries without IDs cannot be cited in commits and do not compound.

**Severity rubric (F-N).**

| Severity | When |
|---|---|
| `low` | Cosmetic, surfaced-but-not-blocking, future-proofing |
| `med` | Would have caused ≥1 failed tool call, compile error, or 1 subagent retry; controller could absorb |
| `high` | Would have cascaded — multiple subagent retries, wrong code merged, data loss risk, or hidden state change |

If unsure, write `med` and explain the cost in one line. Anchored severity beats free-form severity.

**Status vocabulary.** See the template's `## Status vocabulary` section — `open | mitigated | fixed-verified | wontfix-false-alarm | promoted-to-bug-tracker | pinned-as-eval-baseline` for frictions; `validated | promoted-to-permanent-docs | archived` for wins. Pick the one that matches; the template defines each.

**Count the entry.** Right after the `append_entry` call lands, bump the session counter so the statusline `[recon]` badge shows your scout output as an `F<n>/W<n>` suffix. Use the helper next to this skill (its directory is the "Base directory for this skill" path printed when the skill loaded):

```bash
python3 "<skill-dir>/recon_count.py" bump F 2>/dev/null || true   # friction
python3 "<skill-dir>/recon_count.py" bump W 2>/dev/null || true   # win
```

Best-effort — the `2>/dev/null || true` keeps a counter failure from ever breaking the turn. The counter is session-scoped (resets each CC session) and independent of the tracker's monotonic F-N/W-N IDs.

#### Worked exemplars

These are real entries from `codescout/docs/trackers/bug-fix-session-log.md`. Pattern your new entries on these, not the bare template.

**F-N exemplar — a pre-dispatch scout that caught test-shape drift:**

```markdown
## F-3 — Plan test assertions cited non-existent `RecoverableError.hint` field

**Observed:** 2026-05-18, pre-dispatch reconnaissance for the jsonpath
negative-slice implementation plan. About to dispatch Task 1.

**When:** Reading the plan's Task 2 test code, about to dispatch the
subagent for Task 1.

**Expected (plan):** `RecoverableError` has accessible `.hint: Option<String>`
field; plan tests used `err.hint.as_deref().unwrap_or("")`.

**Got (scouted reality):** `RecoverableError` at `src/tools/core/types.rs:169`
exposes `pub message: String` and `pub guidance: Option<Guidance>` — there is
NO `.hint` field. There IS a method `.hint() -> Option<&str>` that returns the
text only for the `Guidance::Hint` variant. Display impl renders
`"{message} — Hint: {text}"` and is the documented stable test contract:
`to_string().contains(...)` is the supported assertion shape.

**Probable cause:** Plan was written from the design spec; spec didn't pin the
assertion-side accessor shape; writing-plans phase didn't scout
`RecoverableError`. The scout-helper-fn-bodies rule (W-1, same session log)
applies to type shapes too.

**Workaround:** Edit Task 2 + Task 3 test code to use
`err.to_string().contains(...)` everywhere. Drops the `.hint` field reference.

**Severity:** med — would have caused first subagent's tests to fail
`cargo check`; controller would absorb the failed-task drift mid-dispatch.

**Status:** fixed-verified — plan edit landed before any subagent ran.

**Valid:** dated 2026-05-18

True of `RecoverableError`'s field/method shape at that commit; re-verify if `src/tools/core/types.rs` changes.

**Rests on:** the Display impl being the documented stable test contract (`to_string().contains(...)`), not a `.hint` field.

**Fix idea / Pointer:** Plan task 2 + 3, this session.
```

**W-N exemplar — the win that the F-3 scout produced:**

```markdown
## W-2 — Pre-dispatch recon caught test-shape error before any subagent ran

**Observed:** 2026-05-18, about to dispatch Task 1 of the jsonpath
negative-slice plan (subagent-driven-development mode).

**Pattern:** Before the first subagent dispatch on a plan that names *types*
in test assertions (not just *fns*), scout each referenced type's actual
field/method shape: `symbols(name=<TypeName>, include_body=true)` for any
type whose accessors the plan tests mention.

**Counterfactual:** Without this scout, Task 2's first subagent would have
written `err.hint.as_deref().unwrap_or("")` and failed `cargo check` on
the first parse test. The subagent would have flailed (probable retries
with `.guidance`, `.hint()`, `.to_string()`) without the Display-impl
contract context. Best case: 1 extra round-trip per failing test
(~11 for the 11 parser tests in Task 2). Worst case: subagent gives up,
controller re-scopes plan mid-dispatch.

**Confirming data points:**
1. F-3 (this session) — `RecoverableError.hint` field cited by plan did
   not exist; scout caught it pre-dispatch.
2. Pending: any future plan that names types in assertions.

**Impact:** med — saves ≥1 failed subagent task and prevents controller
context absorption.

**Promote-when:** A second pre-dispatch recon catches a similarly hidden
type-shape mismatch. At 2 datapoints, promote to CLAUDE.md as
"Before dispatching the first subagent of an implementation plan, scout
every type whose accessors the plan asserts on."

**Status:** validated — single datapoint, drift caught + fixed before
any subagent dispatch. Awaiting promotion criterion.

**Valid:** dated 2026-05-18

One confirmed datapoint; promote-when threshold (2 datapoints) not yet reached.

**Rests on:** the F-3 finding, same session — this win is F-3's counterfactual, not independent evidence.
```

Two things to copy from the exemplars: **specificity** (file paths, line numbers, actual identifier names) and **counterfactual evidence** (what the cost of not-scouting would have been, in concrete units like "11 round-trips"). Vague entries do not compound; specific entries do.

### Phase 4 — Resume + Announce

With verified context, return to the original task. Announce the scout outcome to the user in **one line**, citing the F-N / W-N ID if one was written:

- Match, no entry: `Recon: matched plan, proceeding.`
- F-N written: `Recon: gap captured as F-7 (plan cited .hint field; type has no such field). Proceeding with workaround.`
- W-N written: `Recon: scout prevented Task 2 test-shape slip; captured as W-2.`

Cite the ID in the next subagent dispatch prompt and in the commit message of any change that closes the gap. IDs persist; the lesson compounds.

## Stop Conditions

Reconnaissance is done when **any one** of:

- The shape question has a one-line answer cited from the code.
- The gap is captured as an F-N entry with an ID.
- The decision is made to revise the plan rather than the code (the plan owns the drift, not the substrate).

Do NOT loop reconnaissance. One pass per seam per session. If the same seam needs scouting again later in the session, the substrate has moved — capture that as a separate F-N entry (`category: architectural` or similar) rather than re-running this flow.

## Common Mistakes

- **Scouting after dispatching.** The subagent has already started; drift now lives in two contexts. Scout BEFORE dispatch.
- **Externalizing without an ID.** Entries without F-N / W-N IDs can't be cited and don't compound. Always allocate the next ID.
- **Skipping the counterfactual on W-N.** A win without a counterfactual reads as marketing. Name what would have happened without the pattern, with concrete evidence (round-trips saved, tests that would have failed, files that would have been wrongly edited).
- **Treating reconnaissance as verification.** Verification gates completion claims; reconnaissance gates seam contact. Different skills, different timing.
- **Re-scouting the same seam twice.** If the shape didn't change, re-reading is noise. If it did change, that's a new F-N entry.
- **Pad-filling severity / status.** `med` / `open` as defaults are fine; `med` / `open` with no concrete cost statement is slop. The status enum is in the template — use the specific value that matches.

## Composition with other skills

| Trigger | Skill | Reconnaissance role |
|---|---|---|
| Plan dispatched to subagent | `subagent-driven-development` | Scout the seam BEFORE dispatch |
| Plan code looks fictional | `writing-plans` | Externalize as F-N, revise plan inline before any subagent |
| Tool returned unexpected output | `systematic-debugging` | Capture as F-N, then debug from the captured baseline |
| About to claim work complete | `verification-before-completion` | Different timing — reconnaissance is at the seam, verification is at completion |

## The recon-patterns tracker (per project)

Each project that uses this skill keeps its own R-N ledger at
`docs/trackers/reconnaissance-patterns.md`. This is a librarian
tracker artifact, separate from the per-work-stream session logs in
Phase 3 — its scope is the **skill itself**, not any one task. Entries
describe when recon helped (hit), when it missed (miss), and what
should change in `SKILL.md` next (proposal).

**Bootstrap (first use per project):**

```bash
cp <skill-dir>/references/reconnaissance-patterns-template.md \
   docs/trackers/reconnaissance-patterns.md
```

Where `<skill-dir>` resolves to the cached skill location — typically
`~/.claude/plugins/cache/.../codescout-companion/skills/reconnaissance/`.
Verify the path with `claude plugin list` or read the skill's own
`base directory` line.

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
   being modified"* (promoted 2026-05-23 from R-3) against a chain that then ran
   R-113 → R-77 → R-79, adding architectural-inference-instead-of-grepping,
   wrong-query-shape, and negative-result-authorises-deletion — **four** self-labelled
   instances of a law that had been promoted after the first, the last of them one
   command from deleting 118 MB of live index. (R-87 is the same law's *hit*: the scout
   ran, and found the abstraction already there.)
   **A recurrence of an already-promoted law is a defect in the promoted text, not a new
   entry.** *Remedy:* re-promote the evolved form. Filing the fourth instance and moving
   on is how a guard stays narrow while the failure keeps happening. **Resolved
   2026-08-16** — the Phase 1 bullet now carries all four mechanisms; this row records
   the audit that produced it, per the closing paragraph.

3. **Unreachable** — general enough, and still not reached at the moment of need.
   *Remedy is placement, not rewording.* Precedent: the substrate law in Phase 1 already
   names *"a test suite importing an installed wheel instead of the working tree"*, which
   is the same class as R-89's stale-build miss — and R-89 recurred **×4**, naming a
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
## Skill maintenance

Trigger-string scoring lives in `<codescout-repo>/docs/evals/reconnaissance-trigger.md`. Re-score before any future description change. **Behavioral eval** (do triggered scouts produce useful F-N entries?) lives at `<codescout-repo>/docs/evals/reconnaissance-output.md` — 14 cases drawn from the R-N ledger's hits and misses, with the six MISS cases (R-2, R-4, R-8, R-10, R-19, R-23) as a hard regression gate. **Bootstrap: cases pinned, baseline not yet run (n=0).** Re-score before any change that targets scout *behavior* (not just the trigger string); until the first empirical row lands in that eval's Iteration log, every claim about behavioral efficacy remains unverified.

Version history is tracked via git on this file; see `git log -- codescout-companion/skills/reconnaissance/SKILL.md`.
