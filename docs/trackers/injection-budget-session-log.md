# Session Log — Template

> **Purpose:** Two-sided observation log for a multi-session work stream.
> Captures frictions (F-N) and wins (W-N) that the session producing it
> wants to preserve so future sessions inherit the lesson.
>
> **How to use:** Copy this file to `docs/trackers/<topic>-session-log.md`
> in the active project on first reconnaissance pass. Append F-N / W-N
> entries via `edit_markdown(action="insert_before", heading="## Template
> for new entries", content=...)`. Add a row to the Index / Wins Index
> table for each new entry — the indexes are the eval surface, the
> sections are the evidence.
>
> **Lifecycle:**
> - Created at the start of a multi-session work stream.
> - Appended-to across every session that touches the work.
> - Entries with `Status: open` carry forward across sessions.
> - Promotion to permanent surfaces (CLAUDE.md, ADRs, formal bug
>   trackers) happens when the entry's `Promote-when` / `Fix idea`
>   criteria fire.
> - File archived (moved to `docs/trackers/archive/`) when the work
>   stream wraps.

---

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|---------:|----------|--------|-------|
| F-1 | 2026-05-19 | low | self-friction | fixed-verified | Test file naming pattern wrong (`*.test.sh` vs `test-*.sh`) |
| F-2 | 2026-05-19 | med | architectural | fixed-verified | `hooks/lib/` subdir non-existent; convention is flat peers |
| F-3 | 2026-05-19 | med | codescout-tool | fixed-verified | `edit_code` matcher coverage stale in worktree-write-guard |
## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-1 | 2026-05-19 | med | Pre-spec recon on file paths / matchers / hook conventions | Spec would ship naming `*.test.sh`, `hooks/lib/`, `Edit/Write` matchers — three subagent retries during implementation | validated |
## Category conventions

Use a short kebab-case category to group similar frictions. Prior
sessions have used:

| Category | When to use |
|---|---|
| `codescout-tool` | Friction in a codescout MCP tool (`grep`, `read_file`, `edit_markdown`, etc.) |
| `subagent` | Subagent produced unexpected output or diverged from instructions |
| `plan-prose` | Plan document had drift vs reality (wrong file paths, fictional code, mismatched counts) |
| `architectural` | Discovered structural property of the system that the plan / docs didn't surface |
| `self-friction` | Predicted a friction that turned out to be a false alarm — recorded for transparency |
| `<language>-<library>` | Language- / library-specific footgun (`rust-serde`, `python-typing`) |
| `release-pipeline` | Deployment-time gap (release binary missing, MCP reload needed, etc.) |

Add a new category by writing it as a kebab-case string; no central registry needed.

---

## F-N entry template

Copy this block when appending a new friction. Allocate the next free
ID. Add a matching row to the Index table.

```markdown
## F-N — <one-line title>

**Observed:** <date, session task>

**When:** <what you were trying to do>

**Expected:** <what plan / docs / prior session said>

**Got:** <actual observed reality>

**Probable cause:** <one sentence>

**Workaround:** <what you did to proceed>

**Severity:** low | med | high

**Status:** open | wontfix-false-alarm | fixed-verified | mitigated | promoted-to-bug-tracker | pinned-as-eval-baseline

**Fix idea / Pointer:** <issue # in formal tracker, plan task ID, or "TBD">

---
```

## W-N entry template

Copy this block when appending a new win. A win without a
**Counterfactual** is marketing — name what would have happened
without the pattern, with at least one piece of evidence.

```markdown
## W-N — <one-line title>

**Observed:** <date, session task>

**Pattern:** <the practice that worked>

**Counterfactual:** <what would have happened without the pattern, with evidence>

**Confirming data points:** <list of session moments validating the pattern; aim for ≥2>

**Impact:** low | med | high

**Promote-when:** <criterion for graduating into permanent docs (CLAUDE.md, ADR, etc.)>

**Status:** validated | promoted-to-permanent-docs | archived

---
```

---

## Status vocabulary

Codified so the Index column means the same thing across sessions.

### Friction statuses

| Status | Meaning |
|---|---|
| `open` | Observed, not yet resolved. Default for new entries. |
| `wontfix-false-alarm` | Initial observation was wrong; documented for transparency rather than deleted. |
| `mitigated` | Workaround in place; root cause not fully resolved. |
| `fixed-verified` | Code / process fix landed AND empirically confirmed. (`fixed` alone is too weak — verification is part of the status.) |
| `promoted-to-bug-tracker` | Moved to a formal tracker (`docs/issues/*`, `docs/TODO-*`, GitHub issue). The session log keeps the pointer; the formal tracker owns the lifecycle. |
| `pinned-as-eval-baseline` | Kept verbatim as a reference point for measuring later improvements. Do NOT close — its job is to remain comparable. |

### Win statuses

| Status | Meaning |
|---|---|
| `validated` | Pattern confirmed by ≥1 counterfactual data point. Default for entries with evidence. |
| `promoted-to-permanent-docs` | Moved into CLAUDE.md, an ADR, a skill, or another permanent surface. Session log keeps the pointer. |
| `archived` | Pattern no longer load-bearing — either the underlying system changed or the discipline became automatic. |

---

## F-1 — Test file naming pattern wrong

**Observed:** 2026-05-19, designing the injection-budget hooks redesign. Pre-spec recon.

**When:** Specifying new test files under `tests/` for the new hooks.

**Expected:** Test files named `*.test.sh` (suffix pattern), e.g. `pre-task-hint.test.sh`.

**Got:** `tests/run-all.sh` globs `"$SCRIPT_DIR"/test-*.sh` (prefix pattern). All 20 existing tests use `test-*.sh`. Spec naming would silently skip new tests from `run-all.sh`.

**Probable cause:** Carried convention from prior projects without scouting actual harness.

**Workaround:** Spec uses `test-pre-task-hint.sh`, `test-pre-edit-hint.sh`, etc.

**Severity:** low — cosmetic; would surface immediately on first `run-all.sh` invocation showing zero new tests.

**Status:** fixed-verified — spec updated before commit.

**Fix idea / Pointer:** Implementation plan task list.

---

## F-2 — `hooks/lib/` subdir convention non-existent

**Observed:** 2026-05-19, designing the injection-budget hooks redesign. Pre-spec recon.

**When:** Specifying a shared bash library `skill-hints.sh` for new hint hooks.

**Expected:** Place under `codescout-companion/hooks/lib/skill-hints.sh` (lib subdir convention).

**Got:** Existing hook layout is **flat**: all hooks at `codescout-companion/hooks/*.sh`, peers sourced inline via `source "$(dirname "$0")/detect-tools.sh"`. No `lib/` precedent. Introducing one would establish a new convention for a single shared file.

**Probable cause:** Defaulted to common bash-project layout without checking the existing peer-source pattern.

**Workaround:** Spec places shared library at `codescout-companion/hooks/skill-hints.sh` (peer of `detect-tools.sh`).

**Severity:** med — would introduce architectural drift; future contributors would face an unjustified `lib/` vs peer split.

**Status:** fixed-verified — spec updated before commit.

**Fix idea / Pointer:** Implementation plan task list.

---

## F-3 — `edit_code` matcher coverage stale in worktree-write-guard

**Observed:** 2026-05-19, designing PreToolUse hook for shape-changing edits.

**When:** Choosing matcher for `pre-edit-hint.sh`.

**Expected:** Couple new hook to `mcp__codescout__edit_code` directly.

**Got:** Existing `worktree-write-guard.sh` matcher is `mcp__.*__(edit_lines|replace_symbol|insert_code|create_file|create_or_update_file)`. **`edit_code` is missing from that list.** Codescout's MCP exposes `edit_code`, `edit_file`, `edit_markdown` (all confirmed in use this session) — the existing guard is stale wrt the current API.

**Probable cause:** Codescout added `edit_code` after `worktree-write-guard.sh` was written. No automated check ties the guard regex to the active MCP tool inventory.

**Workaround:** New hook matcher narrows to **shape-changing** writes only: `mcp__codescout__(edit_code|replace_symbol)`. Excludes `edit_file` (line surgery, not shape change) and `edit_markdown` (docs).

**Severity:** med — for our design, would couple the new hook to one of several tools; separately, the existing `worktree-write-guard` regex needs updating in a follow-up bug.

**Status:** fixed-verified for the injection-budget design; **`worktree-write-guard.sh` staleness opens a side-bug** (see Fix idea below).

**Fix idea / Pointer:** Side-bug to extend `worktree-write-guard.sh` regex: add `edit_code|edit_file|edit_markdown`. Track as a separate `docs/issues/` entry; out of scope for injection-budget plan.

---

## W-1 — Pre-spec reconnaissance on hook conventions caught three drift sources

**Observed:** 2026-05-19, immediately after design Section 5 (Testing) but before writing the spec document.

**Pattern:** Before externalizing an implementation spec, scout the actual conventions for: (a) test discovery glob, (b) shared-library layout pattern, (c) PreToolUse matcher regex syntax used elsewhere in the repo.

**Counterfactual:** Without this scout, the spec would have shipped with `*.test.sh` test filenames (silently skipped by `run-all.sh`), a new `hooks/lib/` directory introducing unjustified architectural drift, and a single-tool matcher for an MCP API that is already richer than the existing guard accounts for. Implementation would have hit three separate F-N captures during execution — three subagent retries or controller-absorbed mid-task corrections.

**Confirming data points:**
1. F-1 (this session) — naming pattern drift caught by reading `tests/run-all.sh` glob line.
2. F-2 (this session) — `hooks/lib/` convention drift caught by listing existing `hooks/` directory.
3. F-3 (this session) — `edit_code` matcher coverage drift caught by reading existing `worktree-write-guard.sh` matcher.

**Impact:** med — three potential F-Ns prevented; spec ships internally consistent with repo conventions.

**Promote-when:** A second multi-file design where pre-spec recon on conventions catches ≥2 drift sources. At 2 datapoints, promote to a permanent rule in `superpowers/skills/writing-plans/SKILL.md` or `CLAUDE.md`: *"Before writing a spec that names hooks, test files, or matcher regexes, scout the existing repo conventions for each."*

**Status:** validated — single multi-finding datapoint. Awaiting promotion criterion.

---

## Template for new entries

<!-- Insert new F-N / W-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## F-N — title\n...")
     Also update the matching Index / Wins Index table row at the top. -->
