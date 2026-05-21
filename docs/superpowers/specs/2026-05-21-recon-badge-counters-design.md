# Recon Badge Counters + State Redesign — Design

**Date:** 2026-05-21
**Status:** approved (brainstorming)

## Goal

Append session-scoped friction/win (F/W) counters to the buddy reconnaissance
statusline badge, and clarify its state machine. The counters answer "how much
did this scout session produce" at a glance — e.g. `[recon• F3/W4]`.

## Background — current state (verified 2026-05-21)

The recon badge already exists and is two-state, spanning two plugins via
`.buddy/<session_id>/` marker files (the established cross-plugin contract):

- `codescout-companion/hooks/session-start.sh` touches `recon-loaded` when the
  project is a codescout project (tested in `tests/test-session-start.sh` and
  `tests/test-session-start-payload.sh`).
- The reconnaissance `SKILL.md` Phase 1 touches `recon-active` at scout start
  (30-min freshness window).
- `buddy/scripts/statusline.py :: _render_recon_badge` reads both markers:
  - `recon-active` fresh (<30 min, `RECON_FRESH_SECS = 30*60`) → `[recon•]` bright purple
  - `recon-loaded` present → `[recon]` dim purple
  - neither → empty

`buddy/scripts/hook_helpers.py` deliberately does NOT write `recon-loaded`
(alphabetical hook ordering: buddy runs before codescout-companion, so the
marker would not yet exist); it instead auto-includes `reconnaissance` in
`carried_specialists` for codescout projects.

The counters are the genuinely new piece. Counting is **session-scoped**: it
counts F-N/W-N entries recorded during the current CC session, NOT the
project's all-time tracker IDs (those are global/monotonic and live in
`docs/trackers/<topic>-session-log.md`). A session count cannot be derived from
the tracker, so it needs a per-session store the skill bumps at Phase 3.

## State machine (statusline)

| State | Condition | Render |
|---|---|---|
| idle | no `recon-loaded` | *(empty)* |
| in-scope | `recon-loaded` present; `recon-active` stale/absent | `[recon]` dim purple |
| scouting | `recon-active` fresh (<30 min) | `[recon•]` bright purple |
| + counts | any F/W recorded this session | append ` F<n>/W<n>`, **omitting a zero side** |

Counter rules:
- Append counts in **both** the dim (`[recon]`) and bright (`[recon•]`) states.
- **Omit zero sides:** F3/W4 → ` F3/W4`; F0/W2 → ` W2`; F1/W0 → ` F1`; F0/W0 → no suffix.
- Counts persist for the whole session (the counts file lives under the
  session dir), even after the `recon-active` freshness window lapses. So
  `[recon F3/W4]` (dim) reads as "recon in scope, 3 frictions / 4 wins logged
  this session, not actively at a seam right now."

Render examples (matching the approved format):
```
idle:        (empty)
in-scope:    [recon]
scouting:    [recon•]
1 friction:  [recon• F1]
3F/4W:       [recon• F3/W4]
0F/2W:       [recon• W2]
```

## Components

Each unit has one responsibility, a defined interface, and is independently
testable.

### 1. `recon_count.py` helper (lives in codescout-companion, with the skill)

**Placement:** the reconnaissance skill is
`codescout-companion/skills/reconnaissance/`. The helper lives alongside it
(e.g. `codescout-companion/skills/reconnaissance/recon_count.py`), so the
SKILL.md one-liner can call it by a skill-relative path. The writer (recon
skill) and reader (buddy statusline) already communicate only through
`.buddy/<sid>/` marker files; the counts JSON is the same contract. Buddy
statusline only *reads* the file — there is no buddy→codescout-companion code
dependency.

**Interface (CLI):**
- `python3 recon_count.py bump F [--root <dir>]` — increment friction count by 1
- `python3 recon_count.py bump W [--root <dir>]` — increment win count by 1
- `python3 recon_count.py read [--root <dir>]` — print current counts (for debugging)

**Behavior:**
- `--root` defaults to the current working directory.
- Resolve the session id from `<root>/.buddy/.current_session_id` (same source
  as the Phase-1 `recon-active` touch one-liner). If absent, exit silently
  (no-op, exit 0) — never break the calling turn.
- Counts file: `<root>/.buddy/<sid>/recon-counts.json`, shape `{"F": <int>, "W": <int>}`.
- Missing file is treated as `{"F":0,"W":0}`.
- Writes are atomic: write to a temp file then `os.replace` (mirrors buddy's
  `save_state` convention; applied here regardless of plugin).
- Invalid/corrupt JSON in the counts file is treated as zero (silent recovery),
  so a malformed file never crashes the bump.
- Per-session by construction: a new CC session has a new session-id dir, so no
  counts file exists → counts start at zero. No explicit reset needed.

### 2. statusline render (`buddy/scripts/statusline.py`)

Extend `_render_recon_badge`:
- After determining the base badge string (`[recon]` / `[recon•]` / empty), if
  the base is non-empty, read `<session_dir>/recon-counts.json`.
- Parse `F`/`W` ints (missing/corrupt → 0).
- Build the count suffix omitting zero sides per the rules above; append it
  inside the badge brackets after the label (e.g. `[recon• F3/W4]`).
- Empty base (idle) → still empty (no counts shown when recon not in scope).
- All failures degrade to the base badge (wrapped in the existing
  `except Exception: return ""` / try-guard style).

`session_dir` is already computed as `Path(project_root)/".buddy"/session_id`.

### 3. recon `SKILL.md` Phase 3 (codescout-companion)

In the Phase 3 "Externalize" section, after the `edit_markdown` that appends an
F-N or W-N entry, add a one-liner step that bumps the counter — mirroring the
Phase-1 `recon-active` touch one-liner. For a friction:

```bash
python3 "<skill-dir>/recon_count.py" bump F 2>/dev/null || true
```

and `bump W` for a win. Document that the bump is best-effort (the `|| true`),
and that it is what lights the `F<n>/W<n>` suffix on the statusline badge.

### 4. Tests

- **`codescout-companion`**: a test for `recon_count.py` covering: bump F / bump
  W increments; read; missing counts file → zero; missing
  `.current_session_id` → silent no-op; corrupt JSON → treated as zero; atomic
  write (no partial file). Use the plugin's existing test harness/runner.
- **`buddy/tests/test_statusline.py`**: extend the recon-badge tests for the
  count suffix — F-only, W-only, both, zero-omit (F0/W0 → no suffix), and that
  counts render in both the dim and bright states. Reuse the existing
  `tmp_path` marker-writing pattern.

## Data flow

```
recon SKILL.md Phase 3 (records F-N/W-N via edit_markdown)
        │  also runs:
        ▼
recon_count.py bump F|W  ──writes──▶  .buddy/<sid>/recon-counts.json {"F":n,"W":n}
                                              │
                                              │ read
                                              ▼
buddy statusline _render_recon_badge  ──renders──▶  [recon• F3/W4]
```

## Error handling

- Helper: missing SID → silent no-op exit 0; corrupt counts JSON → zeroed;
  atomic write prevents partial files. Never raises to the caller.
- Statusline: any read/parse failure degrades to the base badge or empty
  string; never crashes the statusline.
- SKILL.md one-liner: `2>/dev/null || true` — best effort, never breaks the turn.

## Ripple / release

Two plugins change, so two version bumps + cache seeds per the root CLAUDE.md
procedure across all three profiles (`~/.claude`, `~/.claude-sdd`,
`~/.claude-kat`):

- **codescout-companion** — new `recon_count.py`, SKILL.md Phase 3 edit, helper test.
- **buddy** — statusline render change, statusline tests.

Cold-restart all three CC instances after the bump (resume reuses cached hooks).

## Out of scope (YAGNI)

- Colored F/W (red/green) — rejected in favor of plain text for render simplicity.
- All-time / cumulative tracker totals in the badge — session-only chosen.
- Changing what writes `recon-loaded` or the explicit-`Skill()`-load trigger —
  the existing SessionStart codescout-detection drop is sufficient; the badge is
  already in scope at session level.
- Per-topic breakdown of counts — single session-wide F/W pair only.
