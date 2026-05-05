# Buddy Memory — Design Spec

**Date:** 2026-05-05
**Status:** Approved (brainstorm phase)
**Plugin:** `buddy`

## Purpose

Give summoned specialists ("bodhisattvas") a way to **save and recall lessons learned during a session**, so that the same mistakes are not repeated across sessions or across projects. Memory is **POV-scoped** — each specialist remembers from its own craft perspective. A small `common` bucket carries cross-buddy lessons.

Active learning, not log keeping. Memory should accumulate hard-won judgment, not session transcripts.

## Goals

- Each specialist accumulates its own field notes over time.
- Project-specific lessons stay with the project (committed to repo).
- Craft-general lessons travel with the user across machines (global, mirrored across the user's two Claude Code instances).
- Idle context cost is zero — memories load only when the relevant specialist is summoned.
- Writes are autonomous but visible — user sees every save and can object.

## Non-goals

- Not a transcript or session log.
- Not a project knowledge base — that lives in `CLAUDE.md`, codescout memories, repo docs.
- No automatic memory consolidation, summarization, or compaction in v1.
- No semantic search in v1 — slug + tag match is enough.

## Channels

| Channel  | Location                              | Lifecycle                          | Reach                       |
| -------- | ------------------------------------- | ---------------------------------- | --------------------------- |
| Global   | `<claude-dir>/buddy/memory/`          | Per CC instance, mirrored on write | Travels across all projects |
| Project  | `<repo-root>/.buddy/memory/`          | Committed to repo                  | Loaded only in this repo    |

`<claude-dir>` is one of `~/.claude` or `~/.claude-sdd`. Both instances exist on this user's machine; global writes are mirrored to the other instance so the user's lessons stay in sync regardless of which CC profile they are running.

The mirror target path is read from `buddy/data/environment.json` (already tracks both instance dirs).

## POV scoping

```
<channel>/
  INDEX.md
  <specialist>/<slug>.md       # only loaded when that specialist is summoned
  common/<slug>.md              # loaded for every summoned specialist
```

`<specialist>` is the directory name under `buddy/skills/` (e.g. `debugging-yeti`, `testing-snow-leopard`).

`common` carries lessons that are not specific to a single craft — typically project conventions any buddy should respect (e.g. "this repo bans mocks in integration tests").

## Entry format

One file per memory entry. Frontmatter + structured body.

```markdown
---
specialist: debugging-yeti      # or "common"
scope: global | project
slug: flaky-tests-jest-fakers
created: 2026-05-05
updated: 2026-05-05
tags: [flaky-tests, jest]
---

**Lesson:** <one-line claim, POV first-person from the buddy>

**Why:** <reason — incident, principle, or pattern observed>

**How to apply:** <when/where this kicks in for future work>
```

**Slug rules:**
- kebab-case, 3–6 words, derived from lesson topic
- Must be unique within `<channel>/<specialist>/`
- Slug collision is treated as **update**, not new entry (see Dedup)

## INDEX.md

One per channel root (`<channel>/INDEX.md`). Append-only pointer file, regenerable from entries. One line per entry:

```
- [<specialist>/<slug>](<specialist>/<slug>.md) — <one-line lesson hook>
```

Used during write-time dedup scan. Not loaded into context.

## Triggers

Memories are written from three triggers. All three use the same write pipeline.

### Trigger 1 — Explicit user ask

User says "remember that…" or similar. Buddy parses, drafts entry, runs the write pipeline.

### Trigger 2 — Autonomous mid-turn

Buddy decides during work that something is worth remembering. Buddy emits a one-line announce **before writing**:

```
→ memory: project / debugging-yeti / mock-db-bites — <one-line hook>
```

User can object in the next prompt; buddy then `git restore --staged` (project) or deletes (global) the file.

### Trigger 3 — Introspection sweep

Fired by:
- `/buddy:dismiss` — runs introspection on the dismissed specialist before clearing it from `active_specialists`. **This is the only automatic introspection trigger.**

> **Why not `SessionEnd`?** SessionEnd hooks run shell after the session has terminated; the model is already gone, so they cannot drive an introspection turn. A user who wants end-of-session sweep should `/buddy:dismiss` (or `/buddy:dismiss --all`) before exiting. If the session ends without dismiss, the only memories captured are those from triggers 1 and 2 during the session.

The injected prompt:

> Before you depart: reflect on this session from your POV. What did you learn that would change how you'd act next time? For each lesson: decide global vs project scope, propose a slug, scan INDEX for similar entries, then save (update if dup, else create). Announce each save. If nothing genuinely new, say so and stop — do not invent lessons.

**Empty result is valid.** Guards against memory inflation.
## Write pipeline

For every trigger:

1. **Draft** lesson in the entry-format body.
2. **Route** scope:
   - **Project** if: references repo-specific files, conventions, infra, team decisions, tooling configured in this repo.
   - **Global** if: about the craft itself, language/framework patterns, debugging instincts, generally-applicable heuristics.
   - **Ambiguous → project** (safer; project memory only loads in this repo, won't pollute other work).
3. **Slug** — propose kebab-case 3–6 words.
4. **Dedup scan**: read `<channel>/INDEX.md`, look in same `<specialist>` dir for either:
   - **slug match** (exact or near-identical kebab tokens), or
   - **tag overlap ≥2 tags** with an existing entry whose lesson hook is topically similar (judged by the buddy from the INDEX one-liner).

   If either holds:
   - **Match found** → load existing file, merge new info into body, bump `updated:`. Re-export INDEX line.

   Else:
   - **No match** → write new file, append INDEX line.
5. **Announce** save with one line: `→ memory: <scope> / <specialist> / <slug> — <hook>`.
6. **Stage (project only)**: `git add .buddy/memory/<path>`. No commit. Buddy reports: "staged — commit when ready."
7. **Mirror (global only)**: copy file to the other CC instance's `<claude-dir>/buddy/memory/...` per `environment.json`. Same INDEX.md update on the mirror.

## Load pipeline

In `/buddy:summon`, after `SKILL.md` and any lens addendum are loaded:

1. Resolve channels:
   - **Global** = current CC instance's `<claude-dir>/buddy/memory/`. (Mirror target is **not** loaded — current dir is the source of truth at read time.)
   - **Project** = `<cwd>/.buddy/memory/` if directory exists.
2. For each channel, read:
   - `<channel>/<specialist>/*.md`
   - `<channel>/common/*.md`
3. Inject into the turn under a `## Memories` section appended to the specialist's instructions, grouped:

   ```
   ## Memories — <specialist> POV

   ### Project (this repo)
   <project specialist entries, then project common entries>

   ### Global
   <global specialist entries, then global common entries>
   ```

4. After memories, inject `data/memory-protocol.md` — the canonical write rules (see Components).

**Empty channels:** silently skipped. No empty headers emitted.

**Soft cap:** ~30 entries per `<specialist>+<channel>`. If exceeded, log a one-line hint suggesting future consolidation. Still load all entries. Consolidation tooling is out of scope for v1.

## Components

### New: `buddy/data/memory-protocol.md`

Single source of truth for the write protocol. Contains:
- Entry format spec
- Routing rules (global vs project)
- Slug rules
- Dedup rules
- Announce format
- Staging / mirror rules
- Empty-result rule

Injected verbatim by `/buddy:summon` after memories load. This way the protocol updates uniformly across all 10 specialists by editing one file.

### Modified: `buddy/commands/summon.md`

Add a new step between "Load specialist skill" and "Adopt voice":

> **Load memories.** Read `<global>/{<specialist>,common}/*.md` and `<project>/{<specialist>,common}/*.md` (project skipped if `.buddy/memory/` does not exist in cwd). Inject under `## Memories`. Then inject `data/memory-protocol.md`.

### Modified: `buddy/commands/dismiss.md`

Before clearing the specialist from `active_specialists`, inject the introspection prompt scoped to that specialist. Wait for buddy to complete (zero or more saves). Then proceed with normal dismissal.

### Removed from scope: `SessionEnd` introspection

Originally drafted, then dropped — see Trigger 3. SessionEnd hooks cannot drive a model turn, so any sweep at session-exit is impossible without a different mechanism (e.g. a SessionStart-side replay of "your prior self had unsaved lessons"), which is YAGNI for v1. `/buddy:dismiss` is the only automatic introspection trigger.

### Reused: `buddy/data/environment.json`

Already tracks both CC instance directories. Mirror logic reads these.

## Repo hygiene

`.buddy/memory/` is **expected to be committed**. Buddies stage but do not commit. The README will document this.

If a user has `.buddy/` in `.gitignore`, project memory is silently disabled (load + write both no-op for project channel; global still works). Buddy emits a single warning line on summon when this is detected.

## Failure modes

| Failure | Behavior |
| --- | --- |
| `.buddy/memory/` not writable | Skip project write. Announce: `→ memory: skipped (project dir not writable)`. Global still works. |
| Mirror target dir missing | Write current instance only. Log one-line warning. |
| INDEX.md corrupted/missing | Regenerate from entries on next write. |
| Frontmatter parse error on load | Skip that entry. Log one-line warning. Do not abort load. |
| `git add` fails (e.g. not a repo) | Treat as project-skipped. Global still works. |

## Out of scope (deferred)

- Memory consolidation / summarization passes
- Semantic search across memories
- Memory expiry or aging
- Memory diff / review UI
- Cross-specialist memory promotion (e.g. Yeti → common)
- Importing existing notes from elsewhere

## Acceptance criteria

1. Summoning a specialist in a project with no `.buddy/memory/` works unchanged from today, except `## Memories` section appears empty (or absent) and `memory-protocol.md` is injected.
2. After explicit "remember that …", buddy writes one entry to the correct channel, announces it, and (project) stages it.
3. After `/buddy:dismiss`, buddy runs introspection; if it produces no entries, it says so and dismissal proceeds.
4. Two consecutive sessions: a memory written in session 1 is loaded into the same specialist's context in session 2.
5. A project memory written in repo A does **not** appear when summoning the same specialist in repo B.
6. A global memory written under `~/.claude/buddy/memory/` is mirrored to `~/.claude-sdd/buddy/memory/` (and vice versa).
7. Slug collision in the same specialist+channel updates the existing file (`updated:` bumped, INDEX line refreshed) — does not create a duplicate.
