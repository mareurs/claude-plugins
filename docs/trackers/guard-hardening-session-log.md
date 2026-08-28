---
entry_prefix:
- F
- W
entry_high_water_F: 3
---
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
| F-2 | 2026-08-27 | med | stale-memory | fixed-verified | 3 advertised memory surfaces say boolean `block_reads: false` is ignored — both forms work |
| F-3 | 2026-08-28 | med | release-pipeline | open | The `block_reads` opt-out turns the guard suite red (21/55) — suite hardcodes both live repos as dispatch CWDs; blocks `release.sh` pre-flight on this machine only |

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
## F-2 — Three advertised memory surfaces say boolean `block_reads: false` is silently ignored — both forms work, and the jq code they describe was never shipped

**Observed:** 2026-08-27, reconnaissance scout during codescout issue triage,
after five commits landed in the sibling codescout repo correcting *its* own
shell-gating docs.

**When:** About to re-surface "the stale `block_reads` gotcha" as a pending item,
having written `{"block_reads": false}` — the **boolean** form — into
`.claude/codescout-companion.json` in both this repo and codescout earlier the
same session.

**Expected (memory + system-prompt):** three surfaces in this repo assert the
boolean form does not work and prescribe the quoted string:

- `.codescout/memories/gotchas.md:23` — "jq `// empty` treats boolean `false` as
  absent, so the boolean form is silently ignored and reads stay blocked. Set
  `"block_reads": "false"` (quoted string)"
- `.codescout/system-prompt.md:64` — same claim, one line
- `.codescout/memories/domain-glossary.md:20` — "string `"false"` to disable
  Read/Grep/Glob blocking (boolean false silently ignored)"

**Got (scouted reality):** both forms work, and the jq code described does not
exist anywhere in the shipped hooks.

- `codescout-companion/hooks/detect.mjs:157` —
  `if (blockVal === false || blockVal === 'false') blockReads = 'false';`
- `codescout-companion/scripts/detect.py:204` —
  `if block_val is False or (isinstance(block_val, str) and block_val == "false"):`
- `codescout-companion/hooks/detect-tools.sh:3` — "Thin shim around
  `scripts/detect.py`". It contains no `jq` and no `block_reads` parsing at all.
- Every wired hook in `hooks.json` runs on `node`, i.e. `detect.mjs`.

Live probe through `detectFor()` — the exact entry point `pre-tool-guard.mjs:30`
calls — with a positive control for **each** state the detector can report:

| cwd | `BLOCK_READS` |
|---|---|
| `{"block_reads": false}` (boolean) | `false` |
| `{"block_reads": "false"}` (string) | `false` |
| `{}` (key absent) | `true` |
| claude-plugins (live, boolean config) | `false` |
| codescout (live, boolean config) | `false` |
| mirela (no config) | `true` |

The absent-key and `mirela` rows are the control: the detector *does* still
report `true`, so the `false` rows are a real reading rather than a stuck
instrument. Corroborated end-to-end — every native `Bash` call in this session
ran under the boolean config the gotcha calls inert.

**Probable cause:** the jq `// empty` snippet is real, but it lives in
`codescout-companion/docs/plans/2026-02-26-plugin-refactor-plan.md:78` — a design
plan, not shipped code. Detection later moved to `scripts/detect.py` +
`hooks/detect.mjs`, both of which accept the boolean. The memory was written
against the plan and never re-probed after the port. Nothing re-reads a memory to
check that it still holds, so a claim promoted into the advertised channel decays
in place, silently and indefinitely.

**Workaround:** none needed for the config — the boolean form already live in both
repos is correct. The three doc surfaces are what need correcting.

**Severity:** med — the false rule is served through the *advertised* SessionStart
memory channel (`CS_MEMORY_NAMES`), so every session in this repo is offered it.
Acting on it means a no-op edit converting a working boolean to a string over a
population of **zero**, and it invites the worse reading: that a `block_reads`
opt-out which is in fact live had been "silently ignored" all along. This session
was one unprobed step from carrying the false mechanism into a fourth surface.

**Status:** fixed-verified — all three surfaces corrected 2026-08-28. Repo swept
afterwards: no other instance of the claim survives outside the trackers (which
record it) and `docs/plans/2026-02-26-plugin-refactor-plan.md` (history, left
alone). Sibling repo checked too — codescout's own memories never carried it.

**Valid:** dated 2026-08-27

True of `detect.mjs` / `detect.py` at `995cb90`; re-probe if detection is ever
re-ported to a shell/jq path.

**Rests on:** `detect.mjs:157` and `detect.py:204` accepting both forms, and
`detect-tools.sh` remaining a thin shim over `detect.py` rather than parsing
config itself.

**Fix idea / Pointer:** rewrite all three surfaces to "either boolean `false` or
string `"false"` works". Note the general shape for the recon ledger: this is the
skill's own *"a proposed fix asserts a non-empty population"* law firing on a
**memory** rather than on a plan — and memories are the harder case, because a
plan is read once at implementation time while an advertised memory is re-served
every session with nothing that ever re-checks it.

## F-3 — The documented `block_reads` opt-out turns the guard's own test suite red — the suite hardcodes both live repos as its dispatch CWDs

**Observed:** 2026-08-28, running `./tests/run-all.sh` before committing the F-2
doc fixes.

**When:** Pre-commit gate. The suite reported `✗ Failed suites:
pre-tool-guard.test.sh` — 34 failures, every one `expected=deny got=allow`.

**Expected:** 55/55, as the suite has always run.

**Got (measured):** 21/55. Cause proven by removing the two opt-out configs and
re-running — **55/55 green, then 21/55 again on restore.** Not inferred: the
suite hardcodes its two dispatch CWDs at
`codescout-companion/hooks/pre-tool-guard.test.sh:19-20` —

```
ACTIVE_CWD="/home/marius/work/claude/codescout"
SIBLING_CWD="/home/marius/work/claude/claude-plugins"
```

— and **both** of those repos received `{"block_reads": false}` earlier in the
same session, as the deliberate guard opt-out. `pre-tool-guard.mjs:32`
(`if (d.BLOCK_READS === 'false') process.exit(0);`) is the second line of the
hook, so it exits before any tool dispatch and every deny-expecting case allows.

**Probable cause:** the suite reads the developer's **live ambient config**. It is
not hermetic. `detect.mjs findRoutingConfig(cwd)` resolves purely from `cwd`
(`join(cwd, '.claude', 'codescout-companion.json')`) with no env seam, so any
developer who exercises the documented opt-out in either repo turns their own
guard suite red. The opt-out and the suite were each correct in isolation; nothing
connected them.

**Blast radius — local only, and that is measured, not assumed.**
`.claude/codescout-companion.json` is gitignored (`.gitignore:26`) and untracked
(`git ls-files` does not know it), so CI and every other clone stay green. What it
*does* block is this machine's `./scripts/release.sh`, whose pre-flight runs
`run-all.sh` and aborts on first failure — **no release can be cut here while the
opt-out exists.**

**Workaround:** move both configs aside for the duration of a suite run or a
release, then restore. Ugly and forgettable, which is why it is a workaround and
not the fix.

**Severity:** med — it fails loudly rather than green, so it cannot pass a broken
guard off as working, and nothing downstream of the repo is affected. Rated no
higher for that reason. But it silently converts the project's mandated pre-release
gate into a permanent red on any machine using the documented opt-out, and the
failure text (`expected=deny got=allow`, 34×) points at the guard rather than at
the config, so the next person to hit it will debug the wrong file.

**Fix idea / Pointer:** make the suite hermetic rather than deleting the opt-out.
Cheapest seam is an escape hatch in `findRoutingConfig` —
`if (process.env.CS_COMPANION_IGNORE_PROJECT_CONFIG) return null;` — mirrored in
`scripts/detect.py` for parity, with the test exporting it once at the top. Two
lines of hook code and one of test code, and it fixes the class rather than this
instance: a guard suite should never depend on the config of the machine running
it. **Not implemented — this is a change to shipped hook code and wants a
decision, not a drive-by.**

**Valid:** dated 2026-08-28

True of the suite and both repo configs at `80ed23f`; re-measure if the harness
stops hardcoding real repo paths.

**Rests on:** `pre-tool-guard.test.sh:19-20` naming the two live repos, and
`pre-tool-guard.mjs:32` gating before dispatch. Either change alone dissolves it.

## Template for new entries

<!-- Insert new F-N / W-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## F-N — title\n...")
     Also update the matching Index / Wins Index table row at the top. -->
