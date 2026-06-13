# Session Log — Guard Hardening (pre-tool-guard cross-repo escapes)

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
| F-1 | 2026-05-21 | med | architectural | fixed-verified | Cross-repo escape lives in md/Bash branches, not is_in_workspace |

## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| _none yet_ | | | | | |

---

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

## F-1 — Cross-repo guard escape lives in md/Bash branches, not is_in_workspace

**Observed:** 2026-05-21, designing the "forbid native Read/Edit cross-repo" change to `codescout-companion/hooks/pre-tool-guard.sh`.

**When:** About to redesign the branch logic to remove out-of-project escape hatches.

**Expected:** Each tool branch (Read/Edit/Grep/Glob/Write/Bash) allows out-of-project files via `is_in_workspace || exit 0`; removing that call closes the escape.

**Got:** `is_in_workspace()` (pre-tool-guard.sh:15) fails *closed* on empty `WORKSPACE_ROOT` — returns 0 (treated in-workspace) whenever no `.claude/codescout-companion.json` sets `workspace_root` (the default). So cross-repo *source* Read/Edit/Grep/Glob/Write is already blocked by default. The real cross-repo escapes are two narrow, separate paths: (a) the Read **markdown** branch's `[[ "$FILE_PATH" != "${CWD}"* ]] && exit 0`, and (b) the Bash branch's EFFECTIVE_CWD `cd`-escape `[[ "$EFFECTIVE_CWD" != "${CWD}"* ]] && exit 0`. There are 6 branches, not 5 — `Write` mirrors `Edit`. `is_in_workspace` only opens an escape when a project explicitly sets `workspace_root` to a sub-tree.

**Probable cause:** Mental model conflated "is_in_workspace gates everything" with the actual layered logic; the md/Bash CWD-prefix exits are independent of `workspace_root`.

**Workaround:** Target the two real escapes (md `!=CWD*` exit; Bash cd-escape) and decide `workspace_root` semantics explicitly, rather than ripping out `is_in_workspace`.

**Severity:** med — implementing from the wrong model would have left the markdown + Bash cross-repo holes open while over-blocking `workspace_root`-configured projects.

**Status:** fixed-verified

**Fix idea / Pointer:** Implemented by `ad9073d` (hook hardening) + `e70d783` (legacy test migration). Verified 2026-05-21: `tests/run-all.sh` green (pre-tool-guard.test.sh 25/25); manual cross-repo Read of `/home/marius/work/claude/codescout/README.md` from this repo's CWD returns `permissionDecision: deny` with `read_markdown` guidance, where pre-`ad9073d` the same call exited silent-allow. Design doc: `docs/superpowers/specs/2026-05-21-guard-cross-repo-hardening-design.md`.

---
## Template for new entries

<!-- Insert new F-N / W-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## F-N — title\n...")
     Also update the matching Index / Wins Index table row at the top. -->
