---
title: Session Log — portable-workflows
tags:
- session-log
- codex
- harness-compatibility
- buddy
topic: portable workflows and Codex integration
entry_prefix:
- F
- W
entry_high_water_F: 6
entry_high_water_W: 2
---
# Session Log — portable-workflows

> **Purpose:** Two-sided observation log for a multi-session work stream.
> Captures frictions (F-N) and wins (W-N) that the session producing it
> wants to preserve so future sessions inherit the lesson.
>
> **How to use:** Copy this file to `docs/trackers/<topic>-session-log.md`
> in the active project on first reconnaissance pass. Append F-N / W-N
> entries with:
>
> ```
> doc(action="append_entry", id="<artifact id>", id_prefix="F",
>          anchor_heading="## Template for new entries",
>          title="<one-line title>", body="**Observed:** ...",
>          index_row="| {id} | <date> | <sev> | <cat> | open | **<title>** — … |",
>          index_after_line="<the table line your row goes AFTER>")
> ```
>
> One call, one write — **and the index row belongs in that same call.**
> The server allocates the next id, formats the heading as `## F-N —
> <title>` (the only shape `link_scan` accepts as a definition), records
> the ledger's high-water mark, stamps `**Valid:** dated <today>` unless
> your body declares a class, and writes `index_row` with `{id}` replaced
> by the id it just allocated. The indexes are the eval surface, the
> sections are the evidence.
>
> **A row needs an anchor from SOMEWHERE, and there are two sources.**
> Best, once per ledger: declare `snapshot_anchor` in this file's own
> frontmatter, naming the index table's header line verbatim —
> `doc(action="update", id=…, patch={"extra": {"snapshot_anchor": "| ID |
> Date | … |"}})`. After that, `index_row` **alone** places every row at
> the block's **TAIL**, which is where a newest-last ledger wants it, and
> nobody chooses an anchor again. Otherwise pass `index_after_line` per
> call; it WINS when both are given. They are **not** symmetric —
> `index_after_line` with no `index_row` is refused, and passing neither
> anchor with a row is refused by name.
>
> **Choosing that per-call anchor fails silently in both directions, which
> is the reason to prefer the declaration above.** It inserts after the
> **first** line equal to what you pass: a non-unique line writes your row into the wrong
> table, and a line that does not exist writes nothing at all and
> allocates no id. Neither raises an error. **Prefer the target table's
> last existing row** — unique by construction, because ids are — over
> the `|---|---|` separator, which anchors to the table's **top** and is
> repeated 9 times in one live ledger. Top is right for a newest-first
> ledger like `bug-fix-session-log.md` and wrong for the oldest-first
> ones; the corpus does not agree, so your ledger decides. A declared
> `snapshot_anchor` sidesteps this whole paragraph.
>
> **Do not hand-allocate ids, and do not pre-write index rows.** A max-id
> is a fact about an instant, and a peer session in the same checkout can
> take the number between your scan and your write. Pre-written rows are
> worse: the allocator counts an id claimed by an index row, so rows
> written ahead of their sections consume the ids they name — which is why
> codescout's `statement-validity-session-log` starts at `statement-validity-session-log:F-2`/`statement-validity-session-log:W-3`
> rather than `statement-validity-session-log:F-1`/`statement-validity-session-log:W-1` (see `statement-validity-session-log:F-3` there).
>
> **`index_row` is not a pre-written row, and that warning does not reach
> it.** The server substitutes `{id}` after allocating, in the same write
> as the section, so no instant exists at which the row names an id the
> section does not. The warning is about a row you type yourself ahead of
> the append — that one still consumes the id it names.
>
> **A copy of this file is a ledger from its first moment.** The frontmatter
> above declares `entry_prefix: [F, W]`, which is why the recipe at the top
> is accepted on a fresh copy with nothing to declare first — and, because
> a declared file is a ledger, the librarian guard refuses direct edits to
> it from the start (`edit_file` says so by name). Retitle it and edit its
> prose and index tables with `doc(action="update", id=<the copy's artifact
> id>, patch={body_edits: [...]})` once the copy is catalogued; add entries
> only with `append_entry`, never by hand.
>
> **Lifecycle:**
> - Created at the start of a multi-session work stream.
> - Appended-to across every session that touches the work.
> - Entries with `Status: open` carry forward across sessions.
> - Promotion to permanent surfaces (`docs/conventions/`, ADRs, formal bug
>   trackers) happens when the entry's `Promote-when` / `Fix idea`
>   criteria fire.
> - File archived (moved to `docs/trackers/archive/`) when the work
>   stream wraps.

---

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|---------:|----------|--------|-------|
| F-1 | 2026-10-13 | high | architectural | open | **Workflow skills in `buddy/skills/` become summonable specialists** — both discovery paths scan every SKILL.md there |
| F-2 | 2026-10-13 | med | architectural | open | **No named Claude Code context source on the skill route** — design names none; `UserPromptExpansion` and PreToolUse:`Skill` carry native `session_id` but are unused |
| F-3 | 2026-10-13 | med | doc-vs-reality | open | **Baseline omits that Buddy hooks already run under Codex** — `.buddy/` already holds a Codex rollout's state and summon spill |
| F-4 | 2026-10-13 | high | doc-vs-reality | mitigated | **Buddy commands' `$1` is the second argument word (CC 2.1.296)** — `/buddy:remember a b c` delivers `b` |
| F-5 | 2026-10-13 | high | doc-vs-reality | open | **Codex already loads Buddy + Companion via the Claude-compatible path** — overlays/new marketplace file change trusted hooks and marketplace lookup |
| F-6 | 2026-10-13 | med | architectural | open | **`/buddy:focus` reads session id from "stdin JSON" a command never receives** — explicit-path focus cannot resolve its session |

## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-1 | 2026-10-13 | high | Trace every consumer of a repurposed dir/prompt/state store | Ten workflow dirs ship as summonable specialists; no listed acceptance test names the specialist index | validated |
| W-2 | 2026-10-13 | high | Probe each host claim once on the real host | Four settled-looking claims (command `$1`, Skill hooks, Codex `local` version, "Codex packaging is new") were wrong | validated |

---

## Promotion status

**Audited:** <YYYY-MM-DD>, against the target surface itself — opened and read,
not recalled.

One line per `W-N` (and any `F-N` with a `Fix idea` bound for a permanent
surface). Check the **target**, not the entry: a `Promote-when` that fired is
invisible from inside the tracker, because `Status: validated` reads as healthy
either way. Record one of:

- **already promoted, no action** — quote the promoted text verbatim and name
  where it landed, so the next reader verifies instead of re-deriving.
- **UNFIRED, carried forward** — restate the criterion and the current datapoint
  count.
- **FIRED but not yet applied** — the one that leaks. Name the exact target
  surface and the exact text to add. This is an action item, not a note; set the
  entry's `Status:` to `promotion-due` so a query can find it.

> ⚠️ **Name every instance of the target, not the target's type.** This machine
> runs three Claude Code profiles (`~/.claude`, `~/.claude-sdd`,
> `~/.claude-kat`), each with its own `CLAUDE.md`. An audit that concluded
> *"not found in the user's global CLAUDE.md"* — singular — led to a promotion
> that reached one file of three on 2026-08-18. The session that found the gap
> was running on a profile **without** the rule, and applied it only because
> another profile's copy happened to be injected as project instructions. Three
> files that should be byte-identical have an md5; compare them.

> ⚠️ **For an INSTALLED artifact the target is the SERVING copy — not the repo
> source, and not the other copies.** Measured 2026-08-20: three rules promoted
> into a plugin skill were byte-identical across all three profile caches *and*
> stale against source, because the commit never bumped the version the cache is
> keyed on. Comparing the copies to each other reads **green** there — only
> comparing each copy to the claim catches it. And the session that made the edit
> is the **least representative observer**: its own reload resolved the skill from
> the repo source, so the confirming evidence sitting in front of it was evidence
> about the wrong artifact.

> ⚠️ **Anchor on a back-citation, not a verbatim quote.** A quote goes red when the
> promoted rule is legitimately reworded — a false positive produced by the
> promotion working as intended, observed 2026-08-20 when `codescout:R-89`'s bullet was
> rewritten and the tracker's stored quote had to be edited to match. The durable
> form is the promoted text citing its own entry id —
> *"(codescout:R-1 + codescout:R-7 in codescout's `docs/trackers/reconnaissance-patterns.md`.)"* — so
> verification is a `grep` for the id and survives every rewording. Keep the quote
> as a reading aid; do not make it the predicate.

Run this when the work stream wraps, **and** whenever a criterion fires
mid-stream — an audit that only happens at archive time is one that happens
after the lesson was needed. Prior art:
`eduplanner-ui:docs/trackers/archive/calendar-insight-panel-session-log-2026-08-18.md`, whose
audit correctly caught its own `calendar-insight-panel-session-log-2026-08-18:W-4` as fired-and-unapplied and named the exact
text to promote.

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

Pass this block as `append_entry`'s `body` (without the `## F-N — <title>`
line — the server writes the heading from `title`). Put the matching Index
row in the same call, as `index_row` (see *How to use* above); writing it
afterwards is the second write that call exists to remove. Do not allocate the id
yourself.

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

**Valid:** invariant | dated YYYY-MM-DD | conditional — <the event that ends it>

**Rests on:** <one durable sentence — an ADR, a decision, or the principle this
instantiates>

**Fix idea / Pointer:** <issue # in formal tracker, plan task ID, or "TBD">

---
```

## W-N entry template

Pass this block as `append_entry`'s `body`, with `id_prefix="W"` — F-N and
W-N have separate counters. A win without a **Counterfactual** is marketing
— name what would have happened without the pattern, with at least one
piece of evidence.

```markdown
## W-N — <one-line title>

**Observed:** <date, session task>

**Pattern:** <the practice that worked>

**Counterfactual:** <what would have happened without the pattern, with evidence>

**Confirming data points:** <list of session moments validating the pattern; aim for ≥2>

**Impact:** low | med | high

**Promote-when:** <criterion for graduating into permanent docs (`docs/conventions/<topic>.md`, ADR, etc.)>

**Promoted-to:** <surface + section, one per line, line-start — omit until it lands>

**Status:** validated | promotion-due | promoted-to-permanent-docs | archived

**Valid:** invariant | dated YYYY-MM-DD | conditional — <the event that ends it>

**Rests on:** <one durable sentence — an ADR, a decision, or the principle this
instantiates>

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
| `promotion-due` | `Promote-when` has **fired** and the text is not yet on the target surface. An action item, not a resting state. Exists because `validated` cannot distinguish "criterion not yet met" from "criterion met, nobody harvested it" — and both read as healthy, which is how a lesson sits unpromoted while the failure it describes recurs. |
| `promoted-to-permanent-docs` | Moved into a `docs/conventions/` page, an ADR, a skill, or another permanent surface (a `CLAUDE.md` line only when it passes that file's residency test). Session log keeps the pointer — and, for a multi-instance target, names every instance it landed in. |
| `archived` | Pattern no longer load-bearing — either the underlying system changed or the discipline became automatic. |

---

## F-1 — Workflow skills in buddy/skills/ become summonable specialists

**Observed:** 2026-10-13, review of `docs/superpowers/specs/2026-10-13-portable-workflows-and-codex-design.md` (id f8cfc0601374b062) for Claude Code fitness.

**When:** Checking the design's placement "Canonical workflows | buddy/skills/" against every consumer of that directory.

**Expected:** Design: add ten workflow skills (buddy-summon … buddy-legend) and "Preserve all twelve existing specialist skill names and directories"; baseline notes "Specialist discovery is not command discovery".

**Got:** Two discovery implementations treat EVERY `buddy/skills/*/SKILL.md` as a builtin specialist, with no exclusion:
- `buddy/scripts/discover-specialists.sh` — `scan builtin "$PLUGIN_ROOT/skills"` emits each subdir containing SKILL.md.
- `buddy/scripts/summon_bootstrap.py::discover` — `("builtin", PLUGIN_ROOT / "skills")`.
`harnesses/pi/install.sh:62` registers the same dir with the comment "12 specialist skills". `buddy/commands/summon.md` states "The 12 entries in the table below are the only builtin specialists".

**Probable cause:** The design reasons about host skill discovery (Claude/Codex/Pi) but not about Buddy's own path-scan discovery of the same directory.

**Workaround:** None applied — review finding only. Consequence if built as written: `/buddy:summon` with an empty argument lists 22 "builtin" entries, and fuzzy matching ("status", "focus", "check") can resolve to a workflow skill and load it as a persona.

**Severity:** high

**Status:** open

**Valid:** conditional — the design changes the workflow-skill location or both discovery paths gain an exclusion

**Rests on:** A directory that one consumer reads as "specialists" cannot also hold non-specialists without a declared discriminator.

**Fix idea / Pointer:** Put workflow skills in their own root (e.g. `buddy/workflows/<name>/SKILL.md`) and register that root per host (Claude plugin.json skills path — verify support; Codex overlay skills path; Pi add_skill_dir), OR give both discovery paths one shared exclusion rule plus a test. Design § Architecture decision / § Workflow inventory.

## F-2 — No named Claude Code context source on the skill route

**Observed:** 2026-10-13, review of design f8cfc0601374b062 (§ Session-aware operations, § Workflow inventory).

**When:** Tracing how a Claude Code summon gets its session identity today, and what changes on the skill route.

**Expected:** Design: "A stateful operation requires authoritative invocation context or an explicit validated context file … Never use a PID, a sole .buddy directory, or .current_session_id as authority for the new portable entry point." It also says "Verify actual Claude argument delivery and summon hook behavior before replacing them" but names no Claude Code context source.

**Got:**
- The only authoritative identity on the Claude summon path is the UserPromptSubmit hook's native `session_id`. It runs only when `prompt.startswith("/buddy:summon")` (`buddy/scripts/hook_entry.py:173`, `summon_bootstrap.bootstrap`).
- A canonical skill reached any other way — `/buddy:buddy-summon`, model auto-invocation, or a Codex skill call — gets no fast path from the existing hook.
- CORRECTED same day: `skill_ledger.py`'s "Skill-tool loads fire no hooks (#43630)" is stale on CC 2.1.296. PostToolUse fired for a Claude-initiated Skill call with the right `session_id` (skill-loading-session-log F-7). Docs: PreToolUse matching `Skill` fires when Claude calls the tool; a typed `/plugin:skill` bypasses PreToolUse and fires `UserPromptExpansion` (input has `command_name`, `command_args`, `command_source`). So Claude Code DOES offer native-hook context on both skill routes; the design just does not name it.
- The model-driven fallback writes state through `track_specialist.py` → `_resolve_sid`, which reads `.buddy/.current_session_id` FIRST, before the by-ppid index (`buddy/scripts/track_specialist.py:38-50`).
- `CLAUDE_CODE_SESSION_ID` is present in the codescout `run_command` environment and matched this session (7d363749-…). That environment is inherited from the MCP server at launch. Docs (code.claude.com/docs/en/env-vars): the variable "is updated on `/clear`" for Bash, PowerShell and hook subprocesses, but "An MCP server subprocess retains the ID it was spawned with." This repo routes shell work through codescout `run_command` (an MCP subprocess), so after `/clear` that env names the PREVIOUS session.

**Probable cause:** The design states the rule (no last-writer identity) without naming, per host, which mechanism produces the authoritative context on each route (prompt hook vs skill vs shell).

**Workaround:** None — review finding.

**Severity:** med

**Status:** open

**Valid:** conditional — the design names a per-route Claude Code context source and the plan tests it

**Rests on:** A no-fallback identity rule is only safe once every supported route has a named authoritative source; otherwise it silently downgrades that route to persona-only.

**Fix idea / Pointer:** Name the Claude Code adapter as hook-produced context: `UserPromptExpansion` (typed `/buddy:*`, keyed on `command_name`, not a prompt prefix) and PreToolUse on `Skill` (model-invoked) write a per-invocation context file under `.buddy/<session_id>/` from the native `session_id`; the helper validates it. Do not treat shell `CLAUDE_CODE_SESSION_ID` as authoritative when the shell is an MCP subprocess. `${CLAUDE_SESSION_ID}` body substitution is documented for SKILL.md bodies only, not for files a skill reads, so it cannot live in the design's "short reference loaded once". Otherwise persona-only, as the design already allows.

## F-3 — Baseline omits that Buddy hooks already run under Codex

**Observed:** 2026-10-13, review of design f8cfc0601374b062 (§ Verified baseline, § Session-aware operations).

**When:** Listing `.buddy/` to see which harnesses already write Buddy session state.

**Expected:** The design's baseline describes Codex support as future work and requires "Cross-harness equal-ID fixtures … before claiming mixed-harness state isolation". It does not say Buddy hooks already run under Codex.

**Got:** `.buddy/01a0f95f-8425-7090-9498-d144a4928755/` holds `state.json`, `narrative.jsonl`, `loaded_skills.json` and `summon-payload-debugging-yeti.md` (2026-10-02). That id is a Codex rollout: `~/.codex/sessions/2026/10/02/rollout-2026-10-02T00-29-41-01a0f95f-8425-7090-9498-d144a4928755.jsonl`. So under Codex the summon prompt-prefix hook already fired and spilled a payload, and Claude and Codex session dirs already share one `.buddy/` namespace. 5 of 127 `.buddy/` entries start with `01a`; only this one was checked against a Codex rollout.

**Probable cause:** The baseline was taken from manifests and config, not from runtime state on disk.

**Workaround:** None — review finding.

**Severity:** med

**Status:** open

**Valid:** dated 2026-10-13

**Rests on:** A migration baseline must record live behavior it could break, not only the configuration that produced it.

**Fix idea / Pointer:** Add to § Verified baseline: Buddy's Claude-format hooks already execute under Codex and write `.buddy/<codex-thread-id>/`; the hook-inventory step must classify these as existing behavior to preserve or retire, and the equal-ID fixture is a regression guard for state that already exists.

## W-1 — Consumer trace of repurposed paths caught design gaps before dispatch

**Observed:** 2026-10-13, review of design f8cfc0601374b062 before any implementation or builder dispatch.

**Pattern:** When a design repurposes an existing directory, prompt prefix or state store, trace every current consumer of that thing in code and on disk before judging the design — not only the hosts the design names.

**Counterfactual:** The design's table places workflows in `buddy/skills/`, and its nine acceptance items count catalog entries (item 1) and payload behavior (item 4); none names the specialist index. A builder following it would add ten dirs that `discover-specialists.sh` and `summon_bootstrap.discover` list as builtin specialists (F-1), with every listed test still able to pass.

**Confirming data points:**
- F-1 lived in two consumers of `buddy/skills/` that the design never names.
- F-2 lived in the prompt-prefix check at `buddy/scripts/hook_entry.py:173`, which only a consumer trace reaches.
- F-3 lived in runtime state on disk (`.buddy/<codex-thread-id>/`), not in any manifest or config the baseline read.

**Impact:** high

**Promote-when:** The same consumer-trace catches a design gap in a second, unrelated design review.

**Status:** validated

**Valid:** invariant

**Rests on:** A design's dependency diagram is aspiration; the import graph and the files on disk are the architecture.

## F-4 — Buddy commands' $1 is the second argument word on Claude Code 2.1.296

**Observed:** 2026-10-13, Claude Code 2.1.296, session 7d363749-…, review of design f8cfc0601374b062.

**When:** Probing how today's Buddy commands receive their argument, before judging the design's "Claude aliases forward the complete user argument".

**Expected:** `tests/test-skill-positional-tokens.sh` header: "A slash command's `$1` is the documented argument placeholder … buddy/commands/summon.md and its siblings rely on it." Every Buddy command except install/legend/status/uninstall opens with "The argument passed by the user is `$1`".

**Got:** `Skill("buddy:remember", args="alpha beta gamma")` delivered "The argument passed by the user is `beta`" — the SECOND word. `alpha` and `gamma` were dropped and no `ARGUMENTS:` line was appended, because a placeholder received a value. Official docs (code.claude.com/docs/en/skills, substitution table): "`$N` | Shorthand for `$ARGUMENTS[N]`, such as `$0` for the first argument or `$1` for the second"; "An indexed placeholder with no corresponding argument … stays in the content unchanged"; plugins/components: "Command files take the same frontmatter as skills."
Consequences, by command: a one-word argument leaves a literal `$1` (plus an appended `ARGUMENTS:` line); a multi-word argument delivers word 2 only. `/buddy:remember <lesson>` instructs the model to save word 2 as the memory. `summon` is partly masked because `summon_bootstrap.parse_argument` reads the raw prompt; its fallback path is not.

**Probable cause:** Claude Code moved `$N` to 0-based `$ARGUMENTS[N]` semantics; the commands and the guard's comment predate that.

**Workaround:** None applied. The probe output was inspected only; its instructions were not followed.

**Severity:** high

**Status:** mitigated

Fix in the working tree, 2026-10-13, uncommitted: seven buddy commands (consolidate, create, dismiss, focus, introspect, remember, summon) now name the input once as `$ARGUMENTS` and later as "the argument". `focus.md` no longer substitutes into shell: `export BUDDY_FOCUS_RAW='<PATH>'` is filled by the model, single-quoted, with `'\''` for embedded quotes. `tests/test-skill-positional-tokens.sh` now scans all 25 `*/commands/*.md` (cases 5-6); RED observed with exactly the 18 lines, then GREEN 6/6. `./tests/run-all.sh` green on the fix (106 suites, exit 0, zero FAIL/not-ok lines; the extended guard ran as suite `test-skill-positional-tokens.sh`) and buddy pytest 528 passed. NOT runtime-verified: a re-probe in the same session was deduplicated by the harness ("already loaded above; instructions unchanged"), and skill/command text may be served from the cache until a release (skill-loading-session-log F-5, F-6).

**Valid:** conditional — Buddy commands stop using `$N` (e.g. `$ARGUMENTS`), or Claude Code changes `$N` semantics again

**Rests on:** A placeholder whose meaning the host defines must be pinned by a runtime probe per host version, not by a comment.

**Fix idea / Pointer:** Independent of the design: replace `$1` with `$ARGUMENTS` in buddy/commands/*.md now, extend the positional-token guard to scan commands/*.md, and correct its header comment. The design's alias step must forward `$ARGUMENTS`, never `$N`.

## F-5 — Codex already loads Buddy and Companion through the Claude-compatible path

**Observed:** 2026-10-13, review of design f8cfc0601374b062; live probes with codex-cli 0.160.0 (`/usr/bin/codex`, pacman `openai-codex 0.160.0-1`) in scratch dirs; `~/.codex/config.toml` sha256 unchanged before/after.

**When:** Checking § Codex runtime adapter and § Packaging against how Codex loads this repo today.

**Expected:** The design treats Codex discovery and hooks as new work delivered by per-plugin `.codex-plugin/` overlays and a new `.agents/plugins/marketplace.json`.

**Got (verified):**
- `buddy@sdd-misc-plugins` and `codescout-companion@sdd-misc-plugins` are installed and enabled in `~/.codex/config.toml` from `[marketplaces.sdd-misc-plugins] source_type="local"` = this repo. No `.codex-plugin/` exists anywhere; Codex loaded the Claude manifests through the legacy `.claude-plugin/marketplace.json`, found `hooks/hooks.json` by default lookup, and sets `CLAUDE_PLUGIN_ROOT` itself (trace: `plugin_root_env=Y plugin_root=~/.codex/plugins/cache/sdd-misc-plugins/buddy/0.11.9`).
- 24 hook trust records already exist, keyed `<plugin>@sdd-misc-plugins:hooks/hooks.json:<event>:<i>:0` (Buddy 5, Companion 19).
- Codex docs: an explicit manifest `hooks` value "replaces default-file discovery".
- The binary's marketplace lookup order lists `.agents/plugins/marketplace.json` before `.claude-plugin/marketplace.json`.
- Codex already auto-migrated `commands/dashboard.md` to `codescout-companion:source-command-dashboard`; it migrated none of Buddy's 12 commands (cause not found).
- Hooks and skills run from the Codex cache, so a repo edit reaches Codex only after `codex plugin add` reinstalls.

**Inferred, NOT tested:** (1) an overlay with an explicit hook selection changes the trust-record keys, so the selected hooks run untrusted/disabled until the user re-trusts them — and the design forbids editing trust records; (2) a repo-root `.agents/plugins/marketplace.json` shadows the legacy file for the configured marketplace, so `sdd`, `claude-statusline` and `session-bridge` availability would depend on the new file.

**Probable cause:** The design's baseline read manifests and config but did not run the host.

**Workaround:** None — review finding.

**Severity:** high

**Status:** open

**Valid:** dated 2026-10-13

**Rests on:** A migration onto a host that already runs the code must start from the host's current load path, or the migration itself is the regression.

**Fix idea / Pointer:** Re-baseline § Codex runtime adapter as "Codex loads both plugins today via the Claude-compatible path". Make each packaging change an explicit delta with a test: overlay vs no overlay, hook-trust key continuity, and marketplace-file precedence in an isolated `CODEX_HOME`.

## W-2 — Live host probes overturned four settled-looking claims

**Observed:** 2026-10-13, review of design f8cfc0601374b062, after the Claude Code docs pass and the live Codex probes.

**Pattern:** For every host claim a design rests on, run the real host once (or read its runtime state) instead of trusting docs, comments or a prior measurement.

**Counterfactual:** Four claims in hand were wrong and each read as settled: the guard comment said a command's `$1` is the argument (F-4: it is word 2); `skill_ledger.py` and skill-loading F-1 said Skill calls fire no hooks (skill-loading F-7: PostToolUse fired); Codex docs say a local plugin's cache version is `local` (observed `0.11.9`, `1.20.17`); the design assumed Codex packaging is new (F-5: both plugins already load and their hooks are trusted). A design built on any of them ships a regression with green tests.

**Confirming data points:**
- `Skill("buddy:remember", args="alpha beta gamma")` → "The argument passed by the user is `beta`" (CC 2.1.296).
- `.buddy/7d363749-…/narrative.jsonl` line 1 = "Claude Skill", written by `run_post_tool_use`.
- `codex exec "/buddy:summon debugging"` in a scratch dir wrote `.buddy/01a136e4-…/summon-payload-debugging-yeti.md` and `active_specialists: ["debugging-yeti"]`.

**Impact:** high

**Promote-when:** A design-review checklist or skill in this repo exists to hold it (one line: "probe each host claim once").

**Status:** validated

**Valid:** invariant

**Rests on:** Host behavior is versioned state, not documentation; only a probe dated to a host version is evidence.

## F-6 — buddy:focus reads its session id from stdin JSON that a command never receives

**Observed:** 2026-10-13, while fixing F-4 in `buddy/commands/focus.md`.

**When:** Reading focus.md's Step 1 before editing its argument line.

**Expected:** A command resolves its session from a channel the model can actually read.

**Got:** Step 1 says: "Read `session_id` and `cwd` from the stdin JSON Claude Code delivers to this command. If `session_id` is missing or the literal string \"unknown\", print \"Could not resolve session id — cannot scope focus\" and stop." A slash command is a prompt expansion: the model has no stdin, and no Claude Code doc consulted this session (skills, plugins/components, hooks) describes stdin JSON for commands. Hook processes receive stdin JSON; commands do not. So the explicit-path branch either stops with that message or the model guesses a session id.

**Probable cause:** Hook-input conventions were copied into a command body.

**Workaround:** None; out of F-4's scope, left unchanged.

**Severity:** med

**Status:** open

**Valid:** conditional — focus.md resolves its session through a real channel

**Rests on:** A command can only use what the host substitutes into its text or what a tool call returns; hook stdin is not either.

**Fix idea / Pointer:** This is the same seam as F-2: give the prompt hook (UserPromptSubmit/UserPromptExpansion on `/buddy:focus`) the job of writing `.buddy/<session_id>/invocation-context.json` and injecting its path, or use the `${CLAUDE_SESSION_ID}` substitution documented for skill/command bodies once it is probed for commands. Do not fall back to `.current_session_id`.

## Template for new entries

<!-- New F-N / W-N entries land above this line. This heading is the anchor:

     doc(action="append_entry", id="<artifact id>", id_prefix="F",
              anchor_heading="## Template for new entries",
              title="<one-line title>", body="**Observed:** ...",
              index_row="| {id} | <date> | <sev> | <cat> | open | **<t>** — … |",
              index_after_line="<the table line your row goes AFTER>")

     The server allocates the id, writes `## F-N — <title>` at the ledger's
     own level, records the high-water mark, stamps `**Valid:** dated
     <today>` AND writes the index row with `{id}` filled in — one write.
     A row needs an anchor from SOMEWHERE: `index_after_line` per call, or
     a `snapshot_anchor` declared once in this file's frontmatter, after
     which `index_row` alone lands the row at the block's TAIL. Passing
     `index_after_line` with no `index_row` is refused; they are not
     symmetric. A per-call anchor must be UNIQUE (first match wins,
     silently) and decides top vs bottom — prefer the last existing row.
     Do not hand-allocate ids; do not type the row yourself ahead of the
     call. -->
