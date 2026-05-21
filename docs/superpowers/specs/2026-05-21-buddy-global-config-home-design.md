# Unify global buddy state under a profile-agnostic `~/.buddy/`

**Date:** 2026-05-21
**Status:** approved (brainstorm) — pending implementation plan
**Supersedes (partial):** the `CLAUDE_CONFIG_DIR` global-scope resolution in
`buddy/scripts/discover-specialists.sh` (commit `e26fd6d`), kept as an interim.

## Problem

This machine runs three Claude Code instances with independent config dirs
(`~/.claude`, `~/.claude-sdd`, `~/.claude-kat`). buddy's *global* state —
specialists, memories, the summons log — currently lives **per profile** under
`<profile>/buddy/`. Consequences:

- **Duplication.** The same global specialist (`codescout-pika`) and global
  memories must exist in every profile. They are kept in sync by an explicit
  copy mechanism (`memory.mirror_global_write`).
- **Drift.** `codescout-pika` is present in `~/.claude-sdd` and `~/.claude-kat`
  but absent from `~/.claude`. Summoning it from the main profile fails.
- **Inconsistent resolution.** Some code hardcodes `~/.claude/buddy`
  (`statusline.py:24`, `consolidate.py:679`, `reload.py:100`); the mirror walks
  only `.claude`/`.claude-sdd` (`memory.py:35`) and silently omits
  `.claude-kat`.

The root pattern: global state is replicated N-ways and synced, instead of
being shared once.

## Goal

A single, profile-agnostic home for **all** global buddy state, shared by every
CC instance without duplication or mirroring.

## Decisions (from brainstorm)

| # | Decision |
|---|----------|
| Scope | **Everything global** moves: `skills/`, `memory/`, `summons.log`. |
| Migration | **One-time merge, then drop.** A script merges all profiles into `~/.buddy`; code then reads only `~/.buddy`. Source dirs left in place for the user to delete after verifying. |
| Merge conflicts (config files) | **Newest mtime wins**; losers archived to `~/.buddy/.migration-backup/<profile>/<path>`. |
| Merge (`summons.log`) | Log semantics — **union + sort by timestamp + dedupe**, not newest-wins. |
| Sequencing | The `CLAUDE_CONFIG_DIR` discovery fix (`e26fd6d`) ships as the interim; this design supersedes its global-resolution path. |

## §1 — Location & layout

```
${BUDDY_HOME:-$HOME/.buddy}/
  skills/                       # global specialists (was <profile>/buddy/skills/)
    <specialist>/SKILL.md
  memory/                       # global memories (was <profile>/buddy/memory/)
    INDEX.md
    <specialist>/<slug>.md
  summons.log                   # union of all profiles' logs
  .migration-backup/<profile>/  # losers from divergent-file resolution
```

- `BUDDY_HOME` env var overrides the location; default `~/.buddy`.
- No per-profile logic anywhere in the global path.

## §2 — Resolution & precedence

Scope precedence is unchanged: **project > global > builtin**. Only the
*global* root relocates. A new shared helper `buddy/scripts/buddy_paths.py` is
the single source of truth:

```python
def global_root() -> Path:      # ${BUDDY_HOME:-~/.buddy}
def global_skills() -> Path:    # global_root()/skills
def global_memory() -> Path:    # global_root()/memory
def summons_log() -> Path:      # global_root()/summons.log
```

Bash callers read `${BUDDY_HOME:-$HOME/.buddy}` directly.

### Call sites that change

| Consumer | Today | After |
|---|---|---|
| `discover-specialists.sh` global root | `$CLAUDE_DIR/buddy/skills` (interim, via `CLAUDE_CONFIG_DIR`) | `${BUDDY_HOME:-$HOME/.buddy}/skills` — **drops `CLAUDE_CONFIG_DIR` / ancestor walk for global** |
| `reload.py:99-100` global SKILL.md | `<home>/.claude/buddy/skills/` | `global_skills()` |
| `memory.py` global dir + mirror | `current_instance_dir()/buddy/memory` + copy to others | `global_memory()`; **mirror deleted** |
| `statusline.py:24` `BUDDY_DIR` | `~/.claude/buddy` | `global_root()` (verify nothing per-profile actually needs `~/.claude/buddy`) |
| `consolidate.py:679` summons.log | `~/.claude/buddy/summons.log` | `summons_log()` |
| `consolidate.py:398` `_infer_scope` | `"/.buddy/"` substring ⇒ project else global | **path-anchored** against `global_root()` (see collision below) |

### `.buddy` naming collision (must-fix)

Project scope is `<project>/.buddy/` and the new global home is `~/.buddy/`.
`consolidate._infer_scope` keys on the `/.buddy/` substring to decide
project-vs-global. A path under `~/.buddy/memory/` matches that substring and
would be **misclassified as project**. Fix: compare the channel root against
the resolved `global_root()` (a path at/under `global_root()` is global;
otherwise project), rather than substring-matching `.buddy`.

## §3 — Migration script (`buddy/scripts/migrate-global-to-home.py`)

Idempotent, re-runnable, **dry-run by default** (`--apply` to execute).

1. Source dirs: each of `~/.claude/buddy`, `~/.claude-sdd/buddy`,
   `~/.claude-kat/buddy` that exists. (`BUDDY_HOME` may override the
   destination; sources are the fixed three.)
2. **`skills/` and `memory/<specialist>/*.md`** (config files), per relative
   path:
   - not in `~/.buddy` → copy in.
   - present and byte-identical → skip.
   - present and divergent → **newest mtime wins**; loser copied to
     `~/.buddy/.migration-backup/<profile>/<relpath>`.
3. **`summons.log`** → concatenate all sources, sort by timestamp, dedupe →
   `~/.buddy/summons.log`.
4. **`memory/INDEX.md`** → do not newest-wins; rebuild/union after the
   per-specialist files land so the index reflects the merged set.
5. Print summary: copied / skipped / conflicts-resolved / backups.
6. Source dirs are **left in place**; the user deletes them after verifying.
   Re-running is safe (idempotent).

## §4 — Mirroring removal

Delete the replication machinery:
- `memory.py`: `mirror_global_write`, `other_instance_dirs`, and the
  `current_instance_dir`-based global-memory resolution.
- `consolidate.py`: the `_mirror_to_other_instances` caller (≈ lines 732-742)
  that invokes `mirror_global_write`.

Global memory reads/writes go to `global_memory()` unconditionally. The
`.claude-kat` omission bug disappears by deletion rather than being patched.

## §5 — Testing

- `buddy_paths.py` unit tests: `BUDDY_HOME` override, default, each accessor.
- `discover-specialists.sh`: rewrite global-scope tests to use
  `${BUDDY_HOME}/skills`; drop the `CLAUDE_CONFIG_DIR` cases added in the
  interim; keep self-location and project-scope cases.
- Migration tests: identical→dedupe; divergent→newest-wins + backup written;
  summons union/sort/dedupe; idempotent re-run is a no-op; dry-run writes
  nothing.
- `consolidate._infer_scope` regression: a `~/.buddy/memory` path classifies
  **global**, not project; a `<proj>/.buddy/memory` path still classifies
  project.
- Full suite green (baseline: 352 passed after the interim fix, incl. the 8 new discovery tests).

## Out of scope

- Project-scope `<project>/.buddy/` layout — unchanged.
- Builtin (plugin-shipped) specialists — unchanged.
- Cross-machine sync of `~/.buddy` (e.g. dotfiles) — user's concern, not buddy's.

## Risks

- **Statusline path move** (`~/.claude/buddy` → `~/.buddy`): confirm no
  per-session/per-profile state genuinely belongs under the profile before
  relocating; if any does, it stays per-profile and only the global subset moves.
- **In-flight summons.log writers** during migration: migration is a manual,
  one-shot operation; run it when no session is actively writing.
```
