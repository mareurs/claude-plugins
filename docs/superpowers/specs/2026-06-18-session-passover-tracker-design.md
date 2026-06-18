# Session-Passover Tracker + "Trackers Are Like Skills" Guide Surfacing

**Date:** 2026-06-18
**Status:** design — pending review
**Authors:** session b53ae7a6 (Architecture Snow Lion + Prompt Hamsa, summoned)

---

## 1. Problem

Work spans sessions. Compaction tears down a session's working context, and parallel
work on one repo produces 2–3 live threads at once. Today there is no first-class way to
hand a thread to a fresh session — only memory (wrong system) or ad-hoc notes.

The pattern already exists, manually, in `mirela/backend-kotlin`: dated "handoff" docs
(`docs/trackers/archive/routing-layer-refactor-2026-04-19.md`) whose payload is a numbered
*what-to-do-next* script, an *uncommitted-files* reconstruction, and an *anti-goals* list.
It works because it is **deliberately authored** and consumed via a literal `1. Read this doc`.

This design does two things:

- **(B) The passover tracker** — formalize that handoff as a codescout `kind=tracker`
  pattern: a pinned field contract, a template, and a discovery convention.
- **(A) Guide surfacing** — teach, in a codescout guide, that a tracker carries behavior
  across sessions the way a skill does. The passover tracker is the worked example.

(A) and (B) are related but separable; (B) is the strongest *evidence* for (A)'s claim.

## 2. Goals / Non-goals

**Goals**

- A reflective-archetype `kind=tracker, tag=passover` pattern with a pinned body contract.
- **Manual, selective** authoring — a passover exists iff a session chose to write one.
- Discovery by **convention + a CLAUDE.md instruction** (no new hook).
- **`topic`-primary** disambiguation across parallel threads; `origin_session_id` + `branch`
  as machine correlation / auto-match keys.
- A guide section surfacing "trackers carry cross-session behavior, like skills," with the
  passover as its worked example.

**Non-goals (and why)**

- **No SessionStart auto-surface hook.** Deferred. The only proven precedent (mirela) works
  via deliberate authorship + pull, not push. *Revisit-when:* ≥2 observed sessions where an
  incoming agent missed an active passover (captured as F-N/W-N).
- **No automatic write trigger (Stop hook).** Selective authorship is the explicit
  requirement — an auto-trigger would emit empty/noise handoffs on "nothing to do" sessions.
- **Not an augmented tracker.** No per-artifact standing `prompt`/`params`. The author/consume
  instructions live *once* (guide + template), not stamped on every disposable handoff.

## 3. The two boundaries

| Boundary | Decision | Rationale |
|---|---|---|
| **Write-time** (outgoing session produces the doc) | Manual / on-demand | Selective by requirement; matches the only working precedent |
| **Read-time** (incoming session finds the doc) | `artifact(find …)` + CLAUDE.md convention | True tracker, zero code; keeps idea A coherent (it *is* a tracker) |
| **Repo split** | Artifacts/template/convention → codescout-companion; guide content → codescout (external) | The `get_guide` surface is served by the codescout binary, not this repo |

## 4. Artifact design (codescout-companion side)

### 4.1 Frontmatter

```yaml
---
id: <hex>                       # librarian-assigned
kind: tracker
status: active                  # → archived on consume
tags: [passover]                # the discovery key (queried by the §5 find filter)
topic: auth-refactor            # PRIMARY human disambiguator across parallel threads
branch: feat/auth               # git branch — often the sharpest parallel disambiguator
origin_session_id: b53ae7a6     # CC session_id of the authoring session (may be absent)
time_scope: "dated:2026-06-18"
title: "Passover — auth refactor — 2026-06-18"
owners: []
---
```

`topic` is what a human picks from. `origin_session_id` is a machine correlation key, never
the thing you eyeball (see §6). `branch` is both a disambiguator and a working-state anchor.

### 4.2 Body contract (reflective archetype — the body *is* the tracker)

```markdown
## State
<one paragraph: where things stand + status, e.g. "Diagnosis done; fix proposed, NOT implemented.">

## Next actions          ← THE payload
1. Read this doc, then VERIFY the working state below still holds
   (git status, run the suite) BEFORE acting — the handoff may be stale.
2. <concrete next step>
...

## Working state         ← reconstruct the disk the author left behind
- Branch / commit / clean-or-dirty
- Files changed, uncommitted — each tagged KEEP / DELETE / WIP with intent
- Processes/servers that must be running

## Anti-goals            ← dead ends already walked; do NOT re-attempt

## Open threads          ← (optional) loose ends; carry-forward Status:open items

## Pointers              ← specs/plans/related trackers; back-link to
                           .buddy/<origin_session_id>/ and the session transcript
```

**Load-bearing (proven by the mirela handoff that worked):** `Next actions`,
`Working state (uncommitted)`, `Anti-goals`. **Escape hatch** (the W-3 lesson): the
verify-before-trust gate is baked into `Next actions` step 1. `State` + `Pointers` are
cheap orientation; `Open threads` is droppable when empty. The contract is deliberately at
the floor — irreducible and sufficient for a manual, selective handoff.

### 4.3 Path & lifecycle

- **Path:** `docs/trackers/passover-<topic>-YYYY-MM-DD.md`
- **Create:** on demand, `status: active`, via `artifact(action="create", kind="tracker", …)`.
- **Consume:** incoming session runs the discovery query (§5), reads, **verifies**, acts.
  On completion: flip `status: archived`, append a short `## Consumed — YYYY-MM-DD` note,
  `artifact(action="move", …)` into `docs/trackers/archive/` (never bare `git mv` — it
  orphans the catalog record).
- An active passover that is never consumed simply lingers as `status: active` — visible to
  the next discovery query, which is the desired behavior.

## 5. Discovery (read-time)

Canonical query (the convention, surfaced via CLAUDE.md):

```
artifact(action="find", kind="tracker",
         filter={"and":[{"tags":{"in":["passover"]}}, {"status":{"eq":"active"}}]})
```

Selection logic for the incoming session:

1. Zero results → no live handoff; proceed normally.
2. One result → that's it. If the session's own id (§6) equals `origin_session_id`,
   auto-confirm; otherwise present topic/branch and proceed.
3. Multiple results → **present by `topic` / `branch` for the human to pick.** If the
   session's own id matches one `origin_session_id`, surface that one as the likely match
   but still confirm.

A CLAUDE.md line (codescout-companion guidance, or project CLAUDE.md) instructs the agent to
run the discovery query early in a session. This is the weakest guarantee in the design and
the explicit candidate for promotion to a hook (§2 non-goals).

## 6. Session-id sourcing — facts and consequences

Established by reconnaissance this session (scouts: codescout/buddy source + CC docs):

- The CC `session_id` (snake_case) arrives **only on hook stdin**. There is **no
  `CLAUDE_SESSION_ID` env var**, no slash command, and **codescout exposes no agent-facing
  session id** (its internal MCP-session ledger is a different id with no read tool). Both CC
  feature requests for in-band access are closed *not-planned*.
- **Working source for an authoring agent:** a hook-written file —
  `.codescout/cc_session_id` (companion-written, **in-ecosystem — preferred**) or
  `.buddy/.current_session_id` (what the reconnaissance skill already reads). The agent
  `cat`s the file when authoring.
- **Stability:** `--resume <id>` **preserves** the id (→ auto-match works); `--fork-session`
  / `/branch` **mint a new id** (→ cannot match by construction); `/compact` is
  **undocumented** (⚠️ verify locally before relying on compaction auto-match).

**Consequence:** `origin_session_id` is a best-effort correlation key, not the selector.
It auto-confirms only on `--resume`; everywhere else the design degrades to `topic`/`branch`
pick. Because matching is best-effort + human-confirmed, the undocumented compaction behavior
does **not** block the design — worst case is a missed auto-match, identical to the fork path.

## 7. Guide surfacing (codescout side — external repo)

Add a section to the codescout **`librarian-runtime`** guide (primary home; cross-ref from
`tracker-conventions`):

- A tracker can carry a standing `prompt` + `params` that travel with the artifact — the
  *skill-like* face: a skill tells an agent how to *act*; an augmented tracker tells an agent
  how to *maintain durable state*.
- A **reflective** tracker (body-is-the-tracker) carries cross-session *behavior* — the
  passover tracker is the worked example: its body is a behavioral script the next session
  executes.
- Link to the passover pattern as the canonical example.

This is an **external (codescout repo) change**. The implementation plan must resolve the
codescout repo path (`claude mcp list`) and is gated on access to that repo. If unavailable,
(A) ships independently of (B).

## 8. Error handling / edge cases

| Case | Behavior |
|---|---|
| buddy/companion not active → sid file absent | Omit `origin_session_id`; fall back to `topic`+`branch`. Graceful. |
| Stale handoff (state moved since write) | `Next actions` step-1 verify gate catches it before any action. |
| Multiple active passovers | Present by `topic`/`branch`; auto-match hint if id coincides. |
| Author forgets to write one | No passover — acceptable, selective by design. |
| Consumed but not archived | Lingers `active`, clutters `find`; consumption checklist includes the archive flip. |
| Compaction mints new id (if it does) | Auto-match misses → topic-pick fallback. No correctness impact. |

## 9. Testing

- **Template presence + schema:** a test asserting the template file exists and its
  frontmatter carries the required keys (`kind`, `tags: [passover]`, `topic`, `time_scope`).
- **Convention lint:** assert the CLAUDE.md / guidance instruction names the exact discovery
  query (so it can't silently drift from §5).
- **Behavior is not unit-testable** (it's a cross-session human-in-the-loop pattern); the
  efficacy gate is the §2 promote-when metric (≥2 missed-passover observations), tracked in a
  session-log, not a green bar. State this explicitly rather than fake a test.

## 10. Components & landing repos

| Component | Repo | Type |
|---|---|---|
| Passover template file (`passover-template.md`) | codescout-companion | new file |
| Discovery convention line | codescout-companion CLAUDE.md / guidance | doc |
| Template/schema tests | codescout-companion `tests/` | test |
| `librarian-runtime` guide section + `tracker-conventions` cross-ref | **codescout (external)** | guide content |

## 11. Open recon note (to carry into implementation)

The "MCPs now support agent sessionId" assumption is a **gap** for codescout (§6) — capture
as an F-N entry in the work-stream session-log when implementation starts, so the lesson
(reason from the hook-written file, not an imagined MCP/env channel) compounds. Verify
`/compact` id-stability locally before any code relies on compaction auto-match.
