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
- **Grep scope: workspace root, not the file being modified.** Assertions on the symbol, runtime token substitutions, and constructor sites routinely cross crate/module boundaries; a scope narrowed to the changing file's directory will miss them. (R-3 in `docs/trackers/reconnaissance-patterns.md` of codescout.)
- **For files backing `include_str!`'d constants** (`source.md`, embedded templates, prompt surface files): grep `*_invariants` modules and `<CONST>.contains` / `<CONST>.find` / snapshot calls naming the surface. Enumerate every test that asserts on the rendered output before editing. "It's just a doc change" is the loophole that lets size-cap, byte-budget, and required-mention invariants fire downstream. (R-1 + R-7 in codescout's `docs/trackers/reconnaissance-patterns.md`.)
- **For subagent dispatch:** also scout session-level state — what `get_guide` topics has the parent triggered, what workspace is active, what's already in the `@ref` buffer. The `guide_hints_emitted` ledger (per-MCP-session, shared across parent and subagents) has no read-only query tool; the parent must remember what it triggered. Brief the subagent explicitly: *"I've triggered: [librarian, progressive-disclosure]"* lets the subagent predict its own V2 auto-inject behavior accurately. (R-9 in codescout's `docs/trackers/reconnaissance-patterns.md`.)

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

**ID allocation.** Read the tracker's existing IDs and use the next monotonic integer:

```python
# Pseudocode: grep -oE 'F-[0-9]+' tracker.md | sort -V | tail -1, then +1
# F-N and W-N have separate counters.
```

Never reuse an ID. Never skip an ID. Entries without IDs cannot be cited in commits and do not compound.

**Append mechanism.** Use `edit_markdown` to insert the new entry above the `## Template for new entries` marker, then update the Index / Wins Index table at the top:

```python
edit_markdown(
    path="docs/trackers/<topic>-session-log.md",
    action="insert_before",
    heading="## Template for new entries",
    content="## F-7 — <title>\n\n**Observed:** ...\n...",
)
```

**Severity rubric (F-N).**

| Severity | When |
|---|---|
| `low` | Cosmetic, surfaced-but-not-blocking, future-proofing |
| `med` | Would have caused ≥1 failed tool call, compile error, or 1 subagent retry; controller could absorb |
| `high` | Would have cascaded — multiple subagent retries, wrong code merged, data loss risk, or hidden state change |

If unsure, write `med` and explain the cost in one line. Anchored severity beats free-form severity.

**Status vocabulary.** See the template's `## Status vocabulary` section — `open | mitigated | fixed-verified | wontfix-false-alarm | promoted-to-bug-tracker | pinned-as-eval-baseline` for frictions; `validated | promoted-to-permanent-docs | archived` for wins. Pick the one that matches; the template defines each.

**Count the entry.** Right after the `edit_markdown` append lands, bump the session counter so the statusline `[recon]` badge shows your scout output as an `F<n>/W<n>` suffix. Use the helper next to this skill (its directory is the "Base directory for this skill" path printed when the skill loaded):

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

## Skill maintenance

Trigger-string scoring lives in `<codescout-repo>/docs/evals/reconnaissance-trigger.md`. Re-score before any future description change. **Behavioral eval** (do triggered scouts produce useful F-N entries?) — to be authored at `<codescout-repo>/docs/evals/reconnaissance-output.md`. Until that exists, every claim about ledger quality is unverified.

Version history is tracked via git on this file; see `git log -- codescout-companion/skills/reconnaissance/SKILL.md`.
