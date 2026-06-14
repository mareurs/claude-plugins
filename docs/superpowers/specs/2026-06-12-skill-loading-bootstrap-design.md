# Skill-Loading Bootstrap — Design

**Date:** 2026-06-12
**Status:** approved (user: "this is beautiful what you found lets implement it")
**Evidence base:** `docs/trackers/skill-loading-session-log.md` F-1 / W-1 — every
mechanism named below was verified against docs or a live probe before this spec
was written.

## Problem

Skill loading in CC is model-driven native tooling, and the codescout-companion
guard denies every step of it:

1. `buddy/commands/summon.md` instructs native `Read` (SKILL.md, lens addenda,
   memory files, protocol, gates) and `Bash` (`track_specialist.py`, summons
   log). `pre-tool-guard.sh` has zero skill/plugin awareness — a cold summon is
   ~6–10 deny→retry round-trips.
2. Worse than friction: **fidelity loss.** The deny redirects `.md` to
   `read_markdown`, which is size-adaptive — verified live: even the *smallest*
   buddy persona (123 lines; full range 113–260) returns a heading map, not the
   body. Persona loading requires whole-body verbatim injection; the model gets
   fragments. `read_file` on `.md` is hard-rejected server-side (IL4) — no
   verbatim escape hatch exists.
3. Skills want to compose with **live state**: codescout trackers are "dynamic
   skills" (regenerated bodies, e.g. `docs/trackers/active-plan.md`,
   `version-bump-checklist.md`) and codescout memory topics carry distilled
   project rules. Today nothing binds a skill to the state it operates on.

## Verified mechanism facts (F-1 / W-1)

| Fact | Verdict | Source |
|---|---|---|
| UserPromptSubmit fires on `/buddy:summon hamsa` with raw text in `prompt` | YES | code.claude.com/docs/en/hooks |
| UserPromptSubmit plain stdout (exit 0) injects context the model sees | YES | same |
| PreToolUse/PostToolUse fire for Skill invocations | **NO** — Skill is prompt expansion, bypasses the tool-hook pipeline | anthropics/claude-code#43630, #22655 |
| Zero-frontmatter SKILL.md registration behavior | docs-silent; frontmatter recommended (#25834: silent failure in agent contexts) | docs + issues |
| `read_markdown` fragments persona-sized files | YES — 123-line file → heading map (live probe) | this session |
| Hook-side sqlite precedent for codescout state | exists | `codescout-companion/hooks/session-start.sh:130` |

Consequence: the binder cannot be a PostToolUse:Skill hook. **UserPromptSubmit
is the single verified bootstrap channel** for both delivery and binding.
(`UserPromptExpansion` exists per docs as a possible future channel — unprobed,
not load-bearing here.)

## Design

Three layers, independent failure domains, one degradation ladder.

### A. Guard exemption — `is_skill_payload()` (codescout-companion)

Skill payloads join binary images as a principled exemption class: *codescout
adds no value (no index over plugin payloads) and full verbatim fidelity is
required*. In `pre-tool-guard.sh`, exempt **Read only** (not Edit/Write/Bash —
skill payloads are read at load time, never edited by the flow) when the path
matches any of:

- `/plugins/cache/` — installed plugin payloads, any profile
- `/.buddy/` — buddy global (`~/.buddy/`) and project (`<cwd>/.buddy/`) trees:
  skills, memory, data
- `skills/<name>/SKILL.md`, `skills/<name>/_<lens>.md`,
  `skills/<name>/references/<file>` — skill-payload shapes anywhere (covers
  dev-mode symlinked plugin roots and source repos)

Explicit non-exemptions (stay denied): `skills/<name>/<other>.md` (e.g.
`notes.md` — not a payload shape), plugin source-repo data files
(`buddy/data/gates.md` via sibling-repo path — layer B injects those), and all
other markdown.

Bash stays denied: `run_command` is genuinely equivalent for the helper
scripts, and the fallback path tolerates one redirect round-trip.

### B. Hook-delivered summon (buddy) — the backbone

`user-prompt-submit.sh` detects `^/buddy:summon\b` in the event's `prompt` and
delegates to a new `scripts/summon_bootstrap.py`, whose stdout (the payload) is
emitted by the hook → injected as context. The payload is everything
`summon.md` Steps 2–2.6 currently make the model fetch:

1. **Resolve** `<specialist>[:<lens>]` against `discover-specialists.sh`
   output (3 scopes, project > global > builtin). Matching is **conservative**:
   exact directory name, else unique substring match over index keys. Ambiguous
   or unresolvable → emit nothing (model fallback handles fuzzy intent).
2. **Dedup** via `track_specialist.py status` logic (direct import): already
   active → emit a one-line `already-active` marker only.
3. **Assemble** (frontmatter-stripped) `SKILL.md` + lens addendum + `## Memories`
   (global + project channels, POV dir + `common`, per summon.md Step 2.5
   ordering and >30-entry hint) + `## Memory Protocol` + `## Gates`.
4. **Bind** (layer D): parse the SKILL.md frontmatter `inject:` block; append
   each existing `trackers:` path (project-relative read) and each existing
   `memory_topics:` topic (`.codescout/memories/<topic>.md`) under
   `## Live State`. Soft-skip anything missing — bindings cost zero when absent.
5. **Track** the summon (state mutation) hook-side; emit a payload marker
   `<!-- buddy:summon-payload specialist=<dir> [lens=<lens>] -->` as the first
   line.

Required-lens-missing emits nothing — the interactive lens prompt stays a
model/summon.md concern. All failures are silent (exit 0, empty stdout): the
hook must never break an unrelated prompt.

`summon.md` is rewritten around the marker: payload present → skip straight to
announce/adopt (Steps 3–4); payload absent → legacy load path (now tolerable
because layer A exempted the reads). `reload.py` strips frontmatter when
rendering reload blocks (same payload hygiene as the bootstrap).

**Addendum (2026-06-14, F-4).** The "stdout → injected as context" assumption
above is false for real personas. A full payload is 18-48KB; CC's
persisted-output mechanism truncates any hook stdout over its inline cap to a
~2KB preview with **no `@ref` handle** — the same wall codescout hit (see its
`2026-03-29-onboarding-buffered-output-design.md`). So `summon_bootstrap.py`
now mirrors codescout's core principle — *always buffer, return a compact
pointer*: `spill_payload()` writes the assembled payload to
`.buddy/<sid>/summon-payload-<dir>.md` (a path layer A already exempts), and
the hook emits a pointer marker carrying `payload-file=<path>`. summon.md
Step 0 reads that one file with **native `Read`** (not `read_markdown`, which
would fragment a persona-sized file). Inline emission survives only as the
no-session-id / spill-failed fallback. Evidence + measurements:
`docs/trackers/skill-loading-session-log.md` F-4.
### C. Frontmatter hygiene (buddy personas)

All 12 builtin `SKILL.md` files gain YAML frontmatter: `name` (directory name),
`description` (from the builtin table in summon.md). Motivation: CC-skill
forward-compatibility and the D binding carrier. Registration behavior is
docs-silent — nothing in this design *depends* on registration.

### D. Tracker/memory bindings — "dynamic skills"

Frontmatter binding keys from layer B, shipped with two demo bindings:

- `planning-crane` → `inject_trackers: [docs/trackers/active-plan.md]` — the
  Crane arrives holding the live plan (buddy already has active-plan tooling).
- `codescout-pika` → `inject_memory_topics: [gotchas, conventions]` — the Pika
  arrives knowing the project's distilled codescout rules.

Keys are **flat inline-array form** (`inject_trackers: [a, b]`), not a nested
`inject:` block — chosen during implementation so bindings stay writable via
`edit_markdown`'s frontmatter tooling (flat keys + inline arrays only) and the
hand parser stays trivial (PyYAML is not a buddy dependency).

v1 bindings are **path/topic-based, not artifact-id-based**: a tracker's
rendered body IS its on-disk file, so binding needs no sqlite/CLI dependency
and works in projects without codescout. Id-based resolution (stable across
`artifact(move)`) is a documented future step using the session-start.sh:130
sqlite precedent. Bound files are capped at 500 lines with a truncation note
pointing at `read_markdown` for the remainder.
### E. Loaded-skill certainty — ledger + transcript scanner (buddy)

User requirement (mid-implementation): *"a very certain way of knowing when a
buddy/skill is loaded so we can show it in statusline and not load it 2 times."*

Two load classes, two certain sources of truth:

1. **Buddy summons** — certainty falls out of layer B: the bootstrap hook
   mutates `state.json:active_specialists` at injection time (deterministic),
   instead of summon.md Step 6's model-discretion `Bash` call. The statusline
   already renders `active_specialists` (`statusline.py:380`) and
   `specialist_labels.py` already prefers frontmatter `name:` — layer C feeds
   it. Dedup = the bootstrap's hook-side status check.
2. **Skill-tool loads** (`Skill('codescout-companion:reconnaissance')`) — no
   hook fires (F-1), so the only ground truth is the **transcript JSONL**,
   which the harness writes. A scanner in the UserPromptSubmit helper
   tail-reads the transcript from a saved byte offset on each prompt and
   records `tool_use name=="Skill"` entries (plus `<command-name>` skill-shaped
   invocations, `plugin:skill` form, excluding `buddy:*` commands) into a
   session-scoped ledger: `.buddy/<sid>/loaded_skills.json`
   (`{version, transcript_offset, skills: {<id>: {first_ts, count}}}`).

Consumers:
- **Statusline**: new segment rendering ledger entries (short names) alongside
  the specialists line.
- **Dedup advisory**: when the scanner sees a skill's count go ≥2, the hook
  emits one context line ("skill X already loaded this session — do not
  re-invoke"). New first loads stay silent (no per-prompt noise).

Lag note: Skill-tool loads become visible at the next prompt submit —
acceptable for statusline + advisory purposes; buddy summons have zero lag.
### Degradation ladder

| Condition | Behavior | Cost |
|---|---|---|
| Hook resolves, payload fits inline (small persona) | summon.md skips to announce | 0 model tool calls |
| Hook resolves, payload over CC inline cap (all real personas, 18-48KB) | hook spills to `.buddy/<sid>/` (guard-exempt) + injects a `payload-file=` pointer; summon.md reads the one file | 1 native read |
| Hook can't resolve (fuzzy arg, lens ask, hook failure) | legacy load path with A's exemptions | few native reads, no denials |
| Companion not installed (no guard) | legacy path, native tools | unchanged from today |
| Buddy not installed | `/buddy:summon` doesn't exist | n/a |

## Alternatives rejected

- **PostToolUse:Skill binder** — the hook never fires (#43630). See F-1.
- **read_markdown(verbatim=true) server param** — codescout change, out of
  scope for this repo; A removes the need for the summon path. May still be
  filed independently.
- **Python port of discovery** — `discover-specialists.sh` is tested
  (`test_discover_specialists.py`); the bootstrap shells out to it rather than
  forking the logic.
- **Fuzzy matching in the hook** — intent-matching is a model strength and a
  shell weakness; conservative matching + model fallback keeps both.

## Test plan

- Companion: flip `read-skill-md` → allow; add allow cases for lens, references,
  `/plugins/cache/`, `/.buddy/`; keep deny cases for `skills/foo/notes.md`,
  sibling-repo `buddy/data/gates.md`, ordinary `.md`/source. Both
  `codescout-companion/hooks/pre-tool-guard.test.sh` and
  `tests/test-pre-tool-guard.sh` surfaces.
- Buddy: new `test_summon_bootstrap.py` (resolution, dedup marker, payload
  assembly order, frontmatter strip, binding soft-skip, ambiguous→empty);
  new `test_skill_ledger.py` (offset persistence, Skill tool_use detection,
  command-name detection, buddy:* exclusion, repeat→advisory, rotation reset);
  extend `test_hooks_user_prompt.sh` (summon prompt → payload on stdout,
  non-summon prompt → no payload); extend `test_reload.py` (frontmatter strip);
  `test_data_catalogs.py` unaffected (verified: asserts routing mentions only).

## Versions

- codescout-companion 1.11.11 → **1.11.12** (layer A)
- buddy 0.7.17 → **0.7.18** (layers B, C, D)

Full bump checklist per CLAUDE.md for each, including cold-restart caveat.
