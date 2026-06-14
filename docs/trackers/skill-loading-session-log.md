# Session Log — skill-loading

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
| F-1 | 2026-06-12 | med | cc-hooks | fixed-verified | Brainstorm cited PostToolUse:Skill as binder channel; Skill bypasses the tool-hook pipeline |
| F-2 | 2026-06-12 | med | architectural | fixed-verified | Live ledger probe: compact replay inflates counts (false-advisory risk) + tool_use path missed buddy:* exclusion |
| F-3 | 2026-06-14 | med | cc-hooks | fixed-verified | codescout-companion read-guard blocks reading back the persisted summon payload |
| F-4 | 2026-06-14 | high | architectural | fixed-verified | Summon payload overflows the CC hook-output cap; the "fully-loaded" marker is false for all 14 personas |

## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-1 | 2026-06-12 | high | pre-spec mechanism verification | spec built on a hook that never fires | validated |
| W-2 | 2026-06-14 | high | measure population before per-instance fix | "trim hamsa" fix would have left 13 personas silently truncated | validated |

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

## F-1 — Brainstorm cited PostToolUse:Skill as binder channel; Skill bypasses the tool-hook pipeline

**Observed:** 2026-06-12, pre-spec reconnaissance for the skill-loading bootstrap brainstorm (buddy summon / codescout-skill loading vs `pre-tool-guard.sh`; tracker-bound "dynamic skills").

**When:** Verifying the brainstorm's load-bearing mechanisms before writing the spec (claude-code-guide doc check, 4 pinned questions).

**Expected (brainstorm):** Options C/D proposed "a PostToolUse hook on `tool_name == Skill`" to inject memories, gates, and live tracker state after a Skill invocation.

**Got (scouted reality):** PreToolUse/PostToolUse do **not** fire for Skill invocations — the Skill tool is handled as prompt expansion and bypasses the tool-hook pipeline entirely. Open feature request anthropics/claude-code#43630; related #22655 (skill_name in hook payloads). A secondary brainstorm claim also degraded under scout: "no frontmatter → skill not registered" is docs-silent (#25834 documents silent failure in agent contexts only) — the prescription (add `name`+`description` frontmatter) stands, but the claim was inference presented as fact.

**Probable cause:** Hook-channel assumption pattern-matched from PreToolUse firing for ordinary tools; never verified against docs before being named in a recommendation (R-19 class: checkable fact asserted unread).

**Workaround:** Rebase the binder design on **UserPromptSubmit** (verified: fires on slash-command submissions with the raw text in `prompt`; plain stdout on exit 0 injects context) and/or SessionStart. Also surfaced: a `UserPromptExpansion` hook event exists for command expansion — evaluate as a candidate channel in the spec.

**Severity:** med — the spec would have shipped a non-existent mechanism; the dead-end surfaces only at implementation (the hook silently never fires), costing a design-rework cycle plus a debugging session on a no-op hook.

**Status:** fixed-verified — design redirected to UserPromptSubmit before any spec was written.

**Fix idea / Pointer:** Skill-loading bootstrap spec (this work stream); watch anthropics/claude-code#43630 for native PostToolUse:Skill support.

---

## W-1 — Pre-spec recon validated or refuted all five load-bearing mechanisms before the spec existed

**Observed:** 2026-06-12, same session, immediately after the skill-loading brainstorm.

**Pattern:** Before spec'ing a design that names runtime mechanisms (hook events, registration rules, adaptive thresholds), verify each named mechanism — one in-vivo probe per local claim plus one claude-code-guide pass for the CC-behavior facts. Probes this session: `read_markdown` bare on a 123-line SKILL.md → heading map only (fragmentation confirmed at the *smallest* persona size; all 12 personas span 113–260 lines); `sqlite3` precedent for hook-side artifact resolution already exists at `codescout-companion/hooks/session-start.sh:130`.

**Counterfactual:** Without the scout, the spec would have been written on PostToolUse:Skill (F-1) — a hook that never fires. Cost: full spec rework plus an implementation session debugging a silent no-op. The scout also *strengthened* two claims (read_markdown fragments every persona; UserPromptSubmit + stdout injection confirmed viable for hook-delivered summons), so the spec starts from verified mechanisms in both directions.

**Confirming data points:**
1. F-1 (this session) — non-existent hook channel caught pre-spec.
2. Prior stream, same week — the system-prompt-source spec (2026-06-12) had to be fully rewritten because a `server_instructions` claim went unverified before drafting. Same failure class, different seam.

**Impact:** high — prevented spec'ing on a non-existent mechanism; second occurrence of the class this week.

**Promote-when:** A third pre-spec doc-check catches a non-existent or changed CC mechanism → promote to CLAUDE.md as "Before spec'ing against CC runtime behavior (hooks, skill registration, tool pipeline), verify each named mechanism against docs or a live probe; CC hook coverage is uneven (Skill bypasses tool hooks)."

**Status:** validated

---
## F-2 — Live ledger probe: compact replay inflates counts; tool_use path missed buddy:* exclusion

**Observed:** 2026-06-12, first live run of buddy 0.7.18's `skill_ledger.py` after `/reload-plugins` (user: "reloaded skills. check").

**When:** Verifying the freshly shipped layer E against the real session transcript.

**Expected:** Ledger records one entry per genuine skill load; `buddy:*` excluded; advisory only on true re-invocation.

**Got:** (1) `codescout-companion:reconnaissance` at count=2 from ONE invocation — transcript lines 1362 + 3798; the second is a compact-replay echo quoting the original `<command-name>` tag. Consequence: after any compact, a single past load could trip a false "already loaded" advisory. (2) `buddy:summon` recorded — the `buddy:*` exclusion lived only in `_command_skills` (command-name path); the `tool_use name==Skill` path had none, and the prior segment had invoked `Skill(buddy:summon)`.

**Probable cause:** Scanner treated every transcript line as ground truth; compact summaries replay content verbatim. Exclusion was written once at the path where the design discussion happened, not as a shared invariant.

**Workaround (fix, shipped in 0.7.19):** (a) advisory fires only for skills already in the ledger BEFORE the current scan chunk — a from-zero scan can never advise, so replays are structurally silent; (b) lines must be `type ∈ {user, assistant}` and not `isCompactSummary`/`isMeta`; (c) `buddy:*` excluded on both paths; (d) advisories deduped per chunk. 4 new tests pin all four behaviors.

**Severity:** med — false advisories after every compact would have trained the model to distrust the channel; silent until a compact occurred, i.e. exactly the kind of bug manual pre-ship testing misses.

**Status:** fixed-verified — 12/12 ledger tests, 451/451 buddy suite; live session ledger scrubbed.

**Fix idea / Pointer:** buddy 0.7.19. Bonus empirical finding from the same probe: `/reload-skills` reported "+12" — persona frontmatter DOES register buddy skills with the Skill tool, settling the Q4 docs-silent gap from F-1 (W-1's verification ledger updated by reality).

---
## F-3 — codescout-companion read-guard blocks reading back the persisted summon payload

**Observed:** 2026-06-14, `/buddy:summon hamsa`. The summon hook's payload (26.1 KB) exceeded the CC UserPromptSubmit hook-output cap, so the harness persisted it to `…/<uuid>/tool-results/hook-…-stdout.txt` and injected only a ~2 KB preview + the marker. Recovering the full body via native `Read` of the persisted file was hard-denied.

**When:** Adopting the Hamsa persona — the marker said "fully loaded, skip the load steps," but only the 2 KB head was in context, so the body had to be re-fetched.

**Expected:** Native `Read` of a persisted *skill payload* passes the guard — the guard's own block message advertises "skill payloads exempt (verbatim fidelity required)."

**Got:** `is_skill_payload` (`codescout-companion/hooks/pre-tool-guard.sh:26-35`) exempts only `*/plugins/cache/*`, `*/.buddy/*`, and `skills/.../SKILL.md|_lens.md|references/`. The harness `tool-results/` persisted-output dir matches none, so the read was denied. Recovery required a codescout `read_file` detour.

**Probable cause:** The exemption list was written for *source-tree* skill payloads; it never anticipated the harness persisting an over-cap hook payload to its own scratch dir and the model needing to read it back. The block message promises an exemption the glob list doesn't deliver for this path.

**Workaround:** Used codescout `read_file` (exempt) instead of native `Read`. Fix: add the harness persisted-output path (`*/tool-results/*`) to `is_skill_payload` + a guard test.

**Severity:** med — would have blocked the recovery read entirely; controller absorbed it via the read_file detour. Compounds with F-4 (which creates the need to read the persisted file in the first place).

**Status:** fixed-verified — added `is_harness_output` (`*/tool-results/*`) to the Read branch of `pre-tool-guard.sh`; 36/36 guard tests pass incl. 4 new tool-results cases (read allows, Edit/Write still deny). buddy/codescout-companion not yet version-bumped/restarted, so not live in this session.

**Fix idea / Pointer:** `codescout-companion/hooks/pre-tool-guard.sh:26-35` + case in `pre-tool-guard.test.sh`. Cross-ref `guard-hardening-session-log.md`.

---

## F-4 — Summon payload overflows the CC hook-output cap; the "fully-loaded" marker is false for all 14 personas

**Observed:** 2026-06-14, measured every persona's assembled `build_payload` output. All 14 exceed 10 KB (debugging-yeti 18.9 KB → planning-crane 48.7 KB); hamsa 26.3 KB matches the harness-reported 26.1 KB that triggered persist-and-truncate.

**When:** `/buddy:summon <any>` — the `UserPromptSubmit` hook (`summon_bootstrap.py`) `print()`s the payload; the harness caps hook stdout, persists the overflow, and injects only a ~2 KB preview + the marker.

**Expected:** The marker `<!-- buddy:summon-payload … -->` is a contract: present ⇒ "everything is loaded, skip Steps 1-2.6, do not re-read" (`/buddy:summon` Step 0).

**Got:** For every persona the contract is false — only the ~2 KB head reaches context. The model is told to adopt the persona AND to skip the load steps that would recover the missing ~90 %. No escape hatch exists: an over-cap payload cannot signal "I am incomplete." `build_payload` (`buddy/scripts/summon_bootstrap.py:190-232`) has no total-size budget — only `MEMORY_SOFT_CAP` (warn, :148) and `BINDING_LINE_CAP` (per-binding, :174).

**Probable cause:** The fast-path design assumed the assembled payload fits in injected context. Personas (150-300 lines) + memories + protocol + gates + bindings never do. The marker promises completeness the producer cannot deliver under the harness cap.

**Workaround:** None at runtime — the model must notice the truncation and re-run the fallback load steps (which F-3 then blocks). Fix options: (A1) honest degraded marker that routes to the fallback load steps when over budget; (A2) write the assembled payload to a guard-exempt `.buddy/<sid>/` file and point the marker at it (one exempt read, fast-path preserved).

**Severity:** high — silent across every summon; a less careful model adopts a persona from ~8 % of its definition (missing Method, Heuristics, Self-Traps, **Gates**) while believing it complete. Masked by a "complete" marker, so manual testing of a single summon would not catch it.

**Status:** fixed-verified — fork resolved by reading codescout's own fix to the *identical* CC wall (`2026-03-29-onboarding-buffered-output-design.md`: "always buffer, return a compact pointer"). Chose **A2**: `spill_payload()` writes the full payload to the guard-exempt `.buddy/<sid>/summon-payload-<dir>.md` and the hook emits a `payload-file=` pointer; summon.md Step 0 reads that one file with native `Read`. Inline kept as the no-sid/spill-failed fallback. Verified: buddy pytest 455 pass, summon suite 15 pass (incl. new `test_large_payload_spilled_not_inlined`), hook shell test 10 pass, `run-all.sh` all suites pass. Not yet version-bumped/restarted — not live in-session.

**Fix idea / Pointer:** `buddy/scripts/summon_bootstrap.py:190-232` (build_payload) + Step 0 of `buddy/commands/summon.md`. Design spec: `docs/superpowers/specs/2026-06-12-skill-loading-bootstrap-design.md`.

---

## W-2 — Measuring all personas turned a one-off "hamsa quirk" into a systemic contract bug

**Observed:** 2026-06-14, scout of the `/buddy:summon` loading seam (recon + codescout-pika + prompt-hamsa — three lenses on one seam).

**Pattern:** Before fixing a friction observed on ONE instance, measure the same property across the whole population. Here: byte-size `build_payload` for all 14 personas instead of fixing only the hamsa summon that surfaced it.

**Counterfactual:** Treated as N=1, the fix would have been "trim hamsa" — leaving the other 13 silently truncated behind the same false "fully-loaded" marker. Measurement showed the smallest payload (18.9 KB) is already ~9× the ~2 KB preview, so the fix must change the marker *contract*, not shrink one persona.

**Confirming data points:** (1) hamsa 26.3 KB measured ≈ 26.1 KB harness-reported truncation — measurement matches observed reality; (2) all 14 personas >10 KB, range 18.9-48.7 KB.

**Impact:** high — redirected the fix from a cosmetic trim to a contract redesign.

**Promote-when:** A second "fixed N=1, missed N=many" near-miss. At 2 data points, promote to CLAUDE.md as "measure the population before fixing a per-instance friction."

**Status:** validated — single datapoint, drift caught before any one-off fix shipped.

---
## Template for new entries

<!-- Insert new F-N / W-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## F-N — title\n...")
     Also update the matching Index / Wins Index table row at the top. -->
