---
status: draft
kind: design
opened: 2026-06-11
owner: marius
tags: [codescout-companion, reconnaissance, memory, promotion, injection-budget, recon]
related:
  - "[reconnaissance SKILL.md](../../../codescout-companion/skills/reconnaissance/SKILL.md) — the skill whose promote-when this changes"
  - "[injection-budget design](2026-05-19-injection-budget-design.md) — the channel decision this extends (pointers, not content)"
  - "(codescout repo) `docs/trackers/reconnaissance-patterns.md` — the per-project R-N ledger this promotes from"
  - "(codescout repo) `docs/evals/reconnaissance-output.md` — the behavioral eval that validates whether this changes behavior"
---

# Reconnaissance Findings as Project Memory — Promotion Routing + Advertise-Pull Channel

## Summary

Reconnaissance findings today live only in **pull-only trackers**: per-work-stream
session logs (`F-N`/`W-N`) and the per-project `reconnaissance-patterns.md` ledger
(`R-N`). Nothing forces them back into a later agent's context, so they do not
compound. `R-19` is the recorded proof: a lesson written to the tracker did **not**
prevent the same mistake recurring *in the same session* ("recurrence-after-
documentation"). The contrast, measured this session in the behavioral eval, is that
findings carried in an always-in-context surface (`SKILL.md`) *did* drive behavior —
4/4 agents scouted.

This design routes **promoted, project-shaped** reconnaissance lessons into a
dedicated codescout **memory topic** (`reconnaissance`). The companion's SessionStart
hook *already* advertises every memory topic by name (`CS_MEMORY_NAMES`) with a
read-nudge, so a new topic surfaces to every future agent **with zero new hook code**,
at the same reach as the project's own `system-prompt`. The full `F-N`/`W-N`/`R-N`
ledger stays in the trackers as the audit substrate. Craft-shaped (cross-project)
lessons keep promoting to `SKILL.md` unchanged.

The deciding insight is a boundary, not a feature: **the fault line is the push
trigger.** A lesson that must change the next decision has to sit on a surface the
agent sees without choosing to look. Post the injection-budget redesign there is no
verbatim-push channel left to claim — so the realistic ceiling is *advertise-by-name
+ read-nudge*, which a memory topic gets for free.

## Status

**Design phase.** Drafted in a brainstorming session: Prompt Hamsa established the
behavior-change constraint (only distilled, bounded rules earn the always-advertised
channel; the promotion bar protects it), then handed the substrate seam to the
Architecture Snow Lion. Implementation plan (`docs/superpowers/plans/`) to follow once
the user reviews this spec.

A reconnaissance pass against the live companion hook (`hooks/session-start.sh`) before
externalizing this spec overturned the brainstorm's working premise: the hook **no
longer injects content verbatim** — it injects *pointers* (the injection-budget
redesign, `2026-05-19`). Even `system-prompt` is now a `memory(read)` pointer, not
pushed text. That scout is what fixed the channel choice below (advertise-pull, not a
new push). It also surfaced a doc-drift side-finding — see Risks.

## Goals

1. **Project-shaped recon lessons reach every future agent in the project**, one
   advertised `memory(read)` away — not buried in a tracker no agent opens.
2. **Reuse the existing advertise channel.** No new SessionStart payload, no new hook:
   the memory-hint block already enumerates `CS_MEMORY_NAMES`; a new topic joins
   `architecture`/`gotchas`/`system-prompt` automatically.
3. **Stop project-shaped lessons polluting the global `SKILL.md`.** Split promotion
   routing: project-shaped → project memory; craft-shaped → `SKILL.md` (today every
   promotion goes global, which loads into *every* project).
4. **Keep the trackers as the source-of-record.** The memory is a *derived, distilled
   projection* of promoted ledger entries — never the primary store.
5. **Make the design falsifiable.** Add a behavioral-eval case that measures whether an
   advertised memory topic is actually read and applied (the open risk, below).

## Non-goals

- **A new push channel / verbatim injection.** The injection-budget redesign
  deliberately removed verbatim content injection under a ~2 KB cap. Re-introducing a
  push tier for recon would overturn a named decision; out of scope. Advertise-pull is
  the ceiling this design accepts.
- **A companion hook change.** The memory-name enumeration already does the
  advertising. This design ships *no* `hooks/*.sh` change (contingent on the
  enumeration globbing all topics — see Open questions).
- **Dumping the full ledger into memory.** Only promoted, distilled, bounded rules
  enter the topic. Token budget is the reason; the promotion bar is the protection.
- **A buddy specialist memory.** Buddy memory is push-*on-summon*, not every-session —
  the wrong trigger. Recon lessons must reach every agent, not only summoned
  specialists.
- **Condensing or restructuring the recon `SKILL.md` body.** Orthogonal.

## Constraints

1. **No verbatim-push channel exists.** `hooks/session-start.sh` emits pointers only
   (`# Skill pointers (replaces verbatim content injection)` — cites
   `2026-05-19-injection-budget-design.md`). The strongest reach available to recon is
   identical to `system-prompt`'s: topic name in `CS_MEMORY_NAMES` + the nudge
   *"Read relevant memories before exploring code."*
2. **codescout memory is per-project; git-versioning is a knob.** Topic memories are
   Markdown files at `.codescout/memories/<topic>.md` (`scripts/detect.py`; codescout
   `resolve_memory_dir` → `memory_dir_for_project`). `private=true` routes to a
   *gitignored* store; the default is an ordinary file the project may commit or ignore.
   So "versioned with the code" is a per-project decision, not a fixed limitation —
   consistent with *"durable facts → codescout memory or trackers, not CC memory."*
3. **codescout memory is advertise-pull, not auto-loaded.** SessionStart lists topic
   *names*; the agent must call `memory(action="read", topic=...)` for content. Stronger
   than a tracker (advertised + nudged), weaker than `SKILL.md` (in-context). Efficacy
   is therefore **unmeasured** — see Risks + Tests.
4. **The memory channel is scarce.** Every entry costs tokens in every session that
   reads it. The promotion bar must stay strict: a memory rule is concrete + bounded
   (*"before asserting a checkable fact about a symbol, read it this session"*), not
   prose. An unbounded memory bloats and gets ignored — the `R-19` failure mode.
5. **Memory write is a standard, always-available action** (confirmed). `memory(action="write", topic, content)` — `src/tools/memory/mod.rs`. `memory` is in codescout's
   always-available tool set; `is_write` only routes it through the write lock. No
   privileged role — any agent (main or subagent) can create a topic, which is what
   makes the promotion step a plain tool call.
## Architecture

Two tiers, split by the push trigger. The trackers are the unbounded pull substrate;
the memory topic is the bounded advertise-pull projection.

```
  observe drift / win
        │
        ▼
┌─────────────────────────────────────────────┐   PULL (audit, unbounded, in git*)
│ Tier 1 — Trackers  (source of record)        │   * session-logs are repo docs;
│   docs/trackers/<topic>-session-log.md  F/W  │     reconnaissance-patterns.md too
│   docs/trackers/reconnaissance-patterns.md R │
└─────────────────────────────────────────────┘
        │  promote-when fires (existing mechanism)
        │     ├─ craft-shaped  ───────────────►  SKILL.md   (global, every project)
        │     └─ project-shaped ──┐
        ▼                         ▼
                    ┌─────────────────────────────────────────────┐  ADVERTISE-PULL
                    │ Tier 2 — codescout memory topic              │  (bounded, .codescout/,
                    │   topic = "reconnaissance"                   │   cross-profile)
                    │   distilled rule: concrete + bounded         │
                    └─────────────────────────────────────────────┘
                                  │  next session
                                  ▼
        SessionStart hook: CS_MEMORY_NAMES already lists it
        "codescout MEMORIES: … reconnaissance … → Read relevant memories"
                                  │  agent pulls
                                  ▼
                    memory(action="read", topic="reconnaissance")
```

The dependency points inward: `reconnaissance` is just another memory topic; codescout
and the companion hook stay ignorant of recon specifically. Nothing new is coupled to
the tracker's markdown structure (the alternative, rejected below, would have).

## Components

### `reconnaissance` codescout memory topic (new convention)

A per-project memory topic holding only promoted project-shaped rules. Each entry:
one concrete, bounded behavioral rule + a one-line pointer to its `R-N`/`F-N` origin
in the ledger. Capped (target ≤ ~10 rules); when exceeded, consolidate (codescout
memory's own consolidation, or demote the weakest back to tracker-only). The cap is
the channel protection from Constraint 4.

### `reconnaissance/SKILL.md` — promote-when routing (the only skill change)

Today the `Promote-when` clauses target `SKILL.md` / `CLAUDE.md` (global). Add a
**routing decision** to Phase 3 / the recon-patterns tracker conventions:

- **Craft-shaped** (language/tool/protocol pattern true in any repo) → `SKILL.md`,
  as today.
- **Project-shaped** (this repo's dialect, build quirks, gotchas) → write a distilled
  rule to the project's `reconnaissance` memory topic via `memory()`. The
  recon-patterns "why per project, not global" section already argues this split; this
  makes it a concrete promotion *target*, not just a rationale.

The routing test mirrors the existing one: *"would this rule mislead a different
project?"* Yes → project memory. No → `SKILL.md`.

### No companion hook change (by design)

`hooks/session-start.sh` emits `CS_MEMORY_NAMES` + the read-nudge already. A new topic
appears automatically **iff** the enumeration (in `detect-tools.sh`) globs all memory
files rather than a fixed allowlist — see Open questions. If it is an allowlist, the
single change is adding `reconnaissance` to it (still no logic change).

### Tracker ↔ memory relationship

The tracker entry is the **source of record** (full narrative, severity, status,
counterfactual). The memory rule is a **lossy projection** (the distilled imperative).
Promotion is the (agent-driven) sync. Drift between them is acceptable because the
tracker always wins on dispute; the memory is regenerable from it.

## Data flow

1. Recon scout finds drift/win → externalizes `F-N`/`W-N` to the work-stream session
   log (unchanged).
2. A pattern reaches its `promote-when` threshold in `reconnaissance-patterns.md`
   (unchanged mechanism).
3. **New:** the routing test classifies it. Project-shaped → `memory(write,
   topic="reconnaissance", <distilled bounded rule + R-N pointer>)`. Craft-shaped →
   `SKILL.md` (as today).
4. Next session in that project: SessionStart lists `reconnaissance` among
   `CS_MEMORY_NAMES` with the read-nudge.
5. Agent calls `memory(read, topic="reconnaissance")`, gets the rules, acts with them
   in context — the compounding the trackers never delivered.

## Risks

1. **Advertise-pull may not be read (the load-bearing unknown).** `R-19` killed a
   *tracker*; a memory topic is advertised + nudged, which is stronger, but it is still
   pull. If agents skip the `memory(read)`, this buys little over a tracker.
   **Mitigation:** the behavioral eval measures it directly (Tests). If under-read,
   escalate to folding rules into the `system-prompt` memory (the one topic the hook
   *explicitly* nudges) — accepting the responsibility-merge cost — or reopen the
   injection-budget tradeoff for a tiny always-on recon slice. **Confidence: medium.**
2. **Memory bloat.** Without a strict cap + consolidation, the topic grows until it is
   nodded-at and discarded. Mitigation: the promotion bar (Constraint 4) + the cap.
3. **Tracker↔memory drift.** Mitigated by source-of-record discipline (tracker wins).
4. **Doc-drift side-finding.** `CLAUDE.md` states the companion "injects
   `.codescout/system-prompt.md` content verbatim" — stale; the hook injects a pointer
   (injection-budget redesign). Not caused by this design, but it nearly misled it;
   correct it when next touching `CLAUDE.md`.
5. **The channel is ungated — the promotion bar is a norm, not a gate.** `memory(write)`
   is unrestricted (any agent, including subagents — confirmed in the codescout scout),
   so the substrate enforces nothing: noise written to the advertised `reconnaissance`
   topic costs every future session. Constraint 4's bar is carried by the *writer* (the
   recon skill's promote-when), not checked by the system. Mitigation: keep promotion
   writes inside the recon skill's controlled path; do not let arbitrary agents write the
   topic; the cap + consolidation bound the blast radius.

## Open questions

**Closed by the codescout scout (2026-06-11), cited from source:**

1. ~~`CS_MEMORY_NAMES`: glob or allowlist?~~ **Glob.** `scripts/detect.py:175-179`
   (the shim behind `detect-tools.sh`) iterates `<project>/.codescout/memories/*.md`
   and advertises each file's stem. A new `reconnaissance.md` auto-appears — **zero
   companion change** confirmed.
2. ~~Exact `memory()` write action + signature.~~ **`memory(action="write",
   topic="reconnaissance", content=<markdown>)`** (`src/tools/memory/mod.rs`
   `input_schema` / `long_docs`). This is the *topic-based* system (on-disk Markdown,
   advertised) — distinct from the *semantic* `remember`/`recall` system (Qdrant,
   meaning-search, not advertised). Recon uses topic-based.
4. ~~Bootstrap.~~ **First `memory(write)` creates the file** under `.codescout/memories/`.
   No onboarding step — a project gets the topic on its first promotion.

**Still open:**

3. **Topic name** — `reconnaissance` (matches the skill, sorts beside the advertised
   list) vs `recon-lessons` (states the content). Leaning `reconnaissance`.
5. **Read-probability boost (optional).** The `SKILLS AVAILABLE` block already gives an
   explicit pointer to `memory(read, topic="system-prompt")`. Adding a one-line recon
   pointer there (a small companion change) would raise read-probability above the bare
   `CS_MEMORY_NAMES` listing — weigh against the zero-change baseline once the eval
   measures the gap.
## Tests / Validation

- **Behavioral eval case (codescout repo `docs/evals/reconnaissance-output.md`):** add
  a case — *"a `reconnaissance` memory topic is advertised at SessionStart with a
  recorded rule; does the agent `memory(read)` it and apply it before acting?"* This is
  the instrument for Risk 1; the design is unvalidated until it runs.
- **No new shell-hook tests** if the enumeration is a glob (no hook change). If an
  allowlist line is added, extend the existing SessionStart payload test to assert the
  topic name appears.

## References

- `hooks/session-start.sh` — memory-hint block (`CS_MEMORY_NAMES`) + skill-pointer
  block (the advertise-pull channel this rides).
- `docs/superpowers/specs/2026-05-19-injection-budget-design.md` — the decision that
  removed verbatim push; this design accepts its ceiling.
- (codescout repo) `docs/trackers/reconnaissance-patterns.md` — `R-19` (recurrence-
  after-documentation), the "why per project, not global" section, the `promote-when`
  mechanism.
- (codescout repo) `docs/evals/reconnaissance-output.md` — behavioral eval; gains the
  validation case above.
- `codescout-companion/skills/reconnaissance/SKILL.md` — Phase 3 + Skill-maintenance;
  the promote-when routing change lands here.
