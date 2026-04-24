# Buddy Plugin — Session-Scoped Active Plan + Verdict Bubble Design Spec

## 1. Problem

Buddy's judge system loads the "active plan" by globbing
`docs/superpowers/plans/*.md` and `docs/superpowers/specs/*.md`, sorting the
filenames in reverse, and picking the first one:

```python
plan_files.extend(sorted(d.glob("*.md"), reverse=True))
...
plan_content = plan_files[0].read_text(...)
```

This produces two failure modes that are currently observable in this repo:

1. **False drift verdicts.** On any session touching this project, the judge
   loads `2026-04-14-judge-system.md` (the lex-newest plan file) and evaluates
   the session narrative against it. Every session gets flagged as "drifting
   from the TDD workflow for the narrative module" regardless of what the user
   is actually doing. Current session: 8 such false verdicts already written.
2. **No concept of multi-instance.** The picker is stateless and
   project-global. If a user runs 4-5 Claude Code instances on the same
   project — each working on different things — every instance gets the same
   stale plan, and there is no mechanism for per-session disambiguation.

A related narrative-layer limitation makes auto-detection harder: the judge's
`format_action_entry` only extracts file paths for the native `Edit`, `Write`,
`Read`, `NotebookEdit`, and `Bash` tools. MCP tool calls (e.g.
`mcp__codescout__read_file`, `mcp__codescout__read_markdown`,
`mcp__codescout__edit_file`) fall through to `return f"Claude {tool}"` with no
file path, so the narrative log cannot be post-hoc parsed to figure out what
the user actually touched.

## 2. Goals

1. Each Claude Code session independently tracks its own "active plan" — no
   global shared state, no cross-session leakage.
2. The active plan is auto-inferred from session activity (first plan file
   read/edited) without user ceremony.
3. An explicit `/buddy:focus <path>` command overrides auto-detection and
   locks the plan until cleared or the session ends.
4. Sessions with no plan activity run the judge in "narrative-only" mode (no
   plan drift checks) — the judge still catches spinning, scope creep, and
   test-failure neglect.
5. Verdicts surface visually as a transient bubble in the buddy statusline
   label row, auto-expiring after a short TTL (default 10 seconds), so the
   user sees corrections in real time without cluttering the display.
6. The MCP tool narrative gap is closed: `format_action_entry` records file
   paths for codescout tools too, so downstream features (not just this one)
   can reason about file activity.

## 3. Non-Goals

- Fuzzy plan matching ("which of these 3 plans does this session resemble?").
- LLM-driven plan selection.
- TTL/decay on the active plan itself (only the bubble decays).
- Cross-session coordination or locking.
- A global registry of plans.
- Changing the judge prompt structure or verdict schema.

## 4. Mechanism

### 4.1 Per-session plan file

Each session gets a new sidecar file next to its existing narrative + verdicts:

```
$PROJECT/.buddy/<session_id>/
├── narrative.jsonl       ← existing
├── verdicts.json         ← existing
└── active_plan.json      ← NEW
```

`active_plan.json` schema:

```json
{
  "path": "docs/superpowers/plans/2026-04-14-judge-system.md",
  "source": "auto",
  "set_at": 1776155000,
  "touched_ts": 1776155200
}
```

- `path` — project-relative or absolute path to the plan markdown file.
- `source` — `"auto"` (set by detection) or `"explicit"` (set by `/buddy:focus`).
- `set_at` — unix timestamp when this entry was first written.
- `touched_ts` — unix timestamp of the most recent plan touch (auto only).

Absence of `active_plan.json` is a valid state: it means the judge runs
narrative-only for this session.

### 4.2 Plan touch detection

A new helper `detect_plan_touch(event, project_root)` lives in
`scripts/hook_helpers.py`. It inspects the raw `PostToolUse` event — which is
available at hook time, before narrative serialization drops information —
and returns a project-relative path string or `None`. `project_root` is
passed explicitly by `accumulate_narrative` (which already receives it), so
the detector does not rely on `event["cwd"]` being present for MCP tools.

```python
PLAN_TOOL_PATH_KEYS = {
    # native tools
    "Edit": "file_path",
    "Write": "file_path",
    "Read": "file_path",
    "NotebookEdit": "file_path",
    # codescout tools — all use "path"
    "mcp__codescout__read_file": "path",
    "mcp__codescout__read_markdown": "path",
    "mcp__codescout__edit_file": "path",
    "mcp__codescout__create_file": "path",
    "mcp__codescout__insert_code": "path",
    # Symbol tools also accept a `path` parameter. They are not commonly used
    # on plan markdown (plans have no LSP symbols), but include them for
    # symmetry so structural edits to a plan file still register as a touch.
    "mcp__codescout__replace_symbol": "path",
    "mcp__codescout__remove_symbol": "path",
}

def detect_plan_touch(event: dict, project_root: Path) -> str | None:
    tool = event.get("tool_name", "")
    key = PLAN_TOOL_PATH_KEYS.get(tool)
    if not key:
        return None
    path_str = (event.get("tool_input") or {}).get(key)
    if not path_str:
        return None
    # Normalize to project-relative. Absolute paths from native tools
    # become relative so active_plan.json survives worktree moves, path
    # changes, and the dev-symlink setup described in CLAUDE.md.
    try:
        p = Path(path_str)
        if p.is_absolute():
            p = p.relative_to(project_root)
        rel = str(p)
    except Exception:
        return None
    if not _matches_plan_glob(rel):
        return None
    return rel
```

Glob matching uses `BUDDY_PLAN_GLOBS` (colon-separated, like `PATH`), with a
default of `docs/superpowers/plans/*.md:docs/superpowers/specs/*.md`. The
matcher operates on project-relative paths only, so a native Edit delivering
`/home/marius/agents/buddy-plugin/docs/superpowers/plans/foo.md` and an MCP
read delivering `docs/superpowers/plans/foo.md` both match the same glob.

**Known limitation.** The default globs match direct children only, not
nested subdirectories like `docs/superpowers/plans/2026-q2/foo.md`. This
suits the current project layout. Users with nested plans can override via
`BUDDY_PLAN_GLOBS="docs/superpowers/plans/**/*.md:docs/superpowers/specs/**/*.md"`
— `_matches_plan_glob` uses `fnmatch.fnmatchcase` on each glob, which does
honor `**`.
### 4.3 Set / read active plan

Two helpers added to `scripts/state.py` (alongside `load_state`/`save_state`):

```python
def load_active_plan(session_dir: Path) -> dict | None:
    """Return the active_plan.json dict, or None if missing/invalid.

    On parse failure, silently unlinks the corrupted file so a fresh
    detection can overwrite it. Never raises.
    """

def save_active_plan(
    session_dir: Path,
    path: str,                  # MUST be project-relative
    source: str,                # "auto" or "explicit"
    now: int,
) -> None:
    """Write active_plan.json atomically.

    Explicit-over-auto precedence: if an existing entry has
    source='explicit', auto writes are refused. Only another explicit
    call can overwrite an explicit entry. This check is read-then-write
    (not transactional) — under concurrent PostToolUse hooks in the same
    session, a rare auto write can race past an explicit one, but the
    blast radius is one session's own plan selection. Acceptable.

    Uses the project's standard mkstemp+os.replace pattern from save_state.
    Callers MUST pass a project-relative path; detect_plan_touch and the
    /buddy:focus command both normalize before calling.
    """
```

Both use the existing atomic mkstemp+os.replace pattern from `save_state`.
Callers are responsible for path normalization — the save helper does not
re-normalize, because `/buddy:focus` may legitimately pass
`--clear`-equivalent deletions or explicit paths already verified.
### 4.4 Auto-detect wiring

`accumulate_narrative` (in `hook_helpers.py`) already receives `project_root`
as a parameter. It passes through to the detector:

```python
touched = detect_plan_touch(event, project_root)
if touched:
    save_active_plan(
        session_dir=narrative_path.parent,
        path=touched,
        source="auto",
        now=int(time.time()),
    )
```

Silent on failure per the project-wide hook contract.
### 4.5 Judge integration

`assemble_context` in `scripts/judge_worker.py` changes from "glob the plans
directory" to "read the session-scoped active plan":

```python
# OLD
plan_files = []
for d in plan_dirs:
    if d.is_dir():
        plan_files.extend(sorted(d.glob("*.md"), reverse=True))
if plan_files:
    plan_content = plan_files[0].read_text(...)

# NEW
active = load_active_plan(session_dir)
if active:
    try:
        plan_path = Path(active["path"])
        if not plan_path.is_absolute():
            plan_path = project_root / plan_path
        plan_content = plan_path.read_text(encoding="utf-8")[:4000]
    except Exception:
        plan_content = None
```

`assemble_context` already receives `narrative_path` — `session_dir` is
`narrative_path.parent`, so no new parameters are needed. The caller flow
stays the same.

When `plan_content is None`, the existing `build_judge_prompt` already omits
the plan section gracefully (per `tests/test_judge_worker.py::test_assemble_context_no_plan`
which asserts the current None-handling), so narrative-only mode works
without prompt-template changes.

### 4.6 `/buddy:focus` command

The command must reliably resolve the **current** session's directory. The
spec's first-draft approach of "most recently modified subdir" is racy under
multi-instance usage (two sessions both just wrote their narrative), which
defeats the core goal of this change.

**Primary mechanism: slash-command stdin.** Claude Code delivers a JSON
context blob on stdin to slash commands, matching the shape delivered to
hooks. The command reads stdin, parses `session_id` and
`workspace.current_dir` (or `cwd`), and uses `.buddy/<session_id>/`
directly. No hook additions, no new files, no race.

**Hard precondition.** The stdin contract MUST be verified on a live
`/buddy:focus` invocation before implementation commits to this path. If
verification fails (stdin does not carry `session_id` for slash commands),
implementation STOPS and the spec is updated — do not ship a race-prone
fallback. The §4.6 design depends on session isolation being real, not
heuristic. See §11 for the verification task.

New file `commands/focus.md`:

```markdown
---
name: buddy:focus
description: Set, clear, or show the active plan for this session. Scoped to session_id — multiple concurrent sessions on the same project each have their own focus. Usage: /buddy:focus <path>, /buddy:focus --clear, /buddy:focus (no args shows current).
---

You are handling a /buddy:focus request. The argument is `$1`.

## Step 1 — Resolve the session

Read `session_id` and `cwd` from the stdin JSON Claude Code delivers to
this command. If `session_id` is missing or the literal string "unknown",
print an error ("Could not resolve session id — cannot scope focus") and
stop. Do not guess.

Compute:

```
PROJECT_DIR=<cwd from stdin, or $CLAUDE_PROJECT_DIR as fallback>
SESSION_DIR=$PROJECT_DIR/.buddy/$session_id
```

## Step 2 — Dispatch on argument

- **No argument** — Read `$SESSION_DIR/active_plan.json`. If present, print
  `Active plan: <path> (<source>, set <relative time ago>)`. If absent,
  print `No active plan. Judge running in narrative-only mode.`

- **`--clear`** — Delete `$SESSION_DIR/active_plan.json`. Print
  `Active plan cleared. Judge now narrative-only.`

- **Any other value (a path)** — Four sub-steps:
  1. **Resolve.** Let `raw = $1`. If `raw` is relative, resolve against
     `$PROJECT_DIR` to get an absolute path `abs_path`.
  2. **Verify existence.** If `abs_path` does not exist as a file, print
     error and stop.
  3. **Normalize to project-relative.** Compute
     `rel_path = abs_path.relative_to($PROJECT_DIR)`. If this raises
     because `abs_path` is outside the project tree, print error
     ("Plan path outside project — cannot set active plan") and stop.
  4. **Save.** Call `save_active_plan(SESSION_DIR, rel_path, "explicit", now)`
     via a short Python one-liner — same pattern as `/buddy:summon`. Print
     `Focused on: <rel_path>`.

The explicit-path branch MUST pass a project-relative path to
`save_active_plan`. Passing an absolute path violates the §4.3 contract
and breaks reproducibility across dev-symlink moves.

## Step 3 — Report state

Echo the final state of the active plan to the user in one short line.
```

Explicit source is sticky: `save_active_plan` refuses to overwrite
`source=explicit` with `source=auto`, so auto-detection cannot clobber a
deliberate user override. Only `/buddy:focus <another-path>` or
`/buddy:focus --clear` can unseat an explicit entry.

**Concurrency note on `--clear`.** The delete path bypasses
`save_active_plan`'s atomic write. A concurrent auto-detect in the same
session could race and recreate the file immediately after `--clear`
deletes it — blast radius is a single stale entry until the next
auto-detect. Acceptable. Cross-session concurrency is not affected (each
session has its own file).
### 4.7 Verdict bubble in statusline

New helper `fresh_verdict` in `scripts/verdicts.py`:

```python
BUBBLE_TTL_DEFAULT = 10
BUBBLE_TTL_MIN = 3
BUBBLE_TTL_MAX = 60

def _bubble_ttl() -> int:
    try:
        raw = int(os.environ.get("BUDDY_BUBBLE_TTL", BUBBLE_TTL_DEFAULT))
    except Exception:
        return BUBBLE_TTL_DEFAULT
    return max(BUBBLE_TTL_MIN, min(BUBBLE_TTL_MAX, raw))

def fresh_verdict(
    session_dir: Path,
    now: int,
    ttl: int | None = None,
) -> tuple[dict, int] | None:
    """Return (latest_fresh_verdict, total_fresh_count) or None.

    Single read of verdicts.json — the tuple gives the renderer both the
    display data and the (+N) suffix without a second file read.
    """
    if ttl is None:
        ttl = _bubble_ttl()
    verdicts_path = session_dir / "verdicts.json"
    if not verdicts_path.exists():
        return None
    try:
        data = json.loads(verdicts_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    active = data.get("active_verdicts", [])
    fresh = [v for v in active if now - v.get("ts", 0) <= ttl]
    if not fresh:
        return None
    return fresh[-1], len(fresh)
```

**`render()` signature change.** `scripts/statusline.py::render()` currently
takes `(identity, state, bodhisattvas, env, now, local_hour)`. Two new
keyword-only parameters are added with `None` defaults so the nine existing
test call sites in `tests/test_statusline.py` continue to work unmodified:

```python
def render(
    identity: dict,
    state: dict,
    bodhisattvas: dict,
    env: dict,
    now: int | None = None,
    local_hour: int | None = None,
    *,
    session_id: str | None = None,
    project_root: Path | None = None,
) -> str:
    ...
    # existing body unchanged through `label = " · ".join(label_parts)`
    bubble = _render_bubble(session_id, project_root, now)
    if bubble:
        label = f"{label} {bubble}"
    return f"{base}\n {label}"
```

`_render_bubble` returns `""` early on any of: `session_id is None`,
`session_id == "unknown"`, `project_root is None`, or `fresh_verdict`
returning `None`. Statusline never raises.

```python
SEVERITY_FORMAT = {
    "info": ("\033[32m", "[ok]"),      # green, ASCII glyph
    "warning": ("\033[33m", "[!]"),     # yellow, ASCII glyph
    "blocking": ("\033[31m", "[X]"),    # red, ASCII glyph
}
RESET = "\033[0m"

def _render_bubble(session_id, project_root, now):
    if not session_id or session_id == "unknown" or project_root is None:
        return ""
    session_dir = project_root / ".buddy" / session_id
    result = fresh_verdict(session_dir, now or int(time.time()))
    if result is None:
        return ""
    latest, count = result
    color, icon = SEVERITY_FORMAT.get(latest.get("severity", ""), ("", "[?]"))
    correction = (latest.get("correction") or "")[:60]
    verdict_name = latest.get("verdict", "")
    suffix = f" (+{count - 1})" if count > 1 else ""
    return f"{color}{icon} {verdict_name}: {correction}{RESET}{suffix}"
```

ASCII glyphs (`[ok]`, `[!]`, `[X]`) are used instead of Unicode icons (`✓`,
`⚠`, `🛑`) to avoid double-wide emoji alignment breakage in narrow
terminals, tmux, and ssh clients with incomplete font coverage.

**`main()` update.** `scripts/statusline.py::main()` currently parses only
`context_window.used_percentage` from the stdin JSON via
`parse_stdin_context_pct`. A new helper parses session context:

```python
def parse_stdin_session(raw: str) -> tuple[str | None, Path | None]:
    """Extract session_id and project root from Claude Code's stdin JSON.

    Returns (None, None) on any parse failure — statusline still renders.
    """
    try:
        data = json.loads(raw)
    except Exception:
        return None, None
    session_id = data.get("session_id")
    cwd = (data.get("workspace") or {}).get("current_dir") or data.get("cwd")
    project_root = Path(cwd) if cwd else None
    return session_id, project_root
```

`main()` reads stdin once (already does), calls both parsers, and forwards
both results to `render(..., session_id=..., project_root=...)`. If stdin
is empty or malformed, bubble rendering is skipped; statusline output is
unaffected.
### 4.8 Narrative MCP path extraction (bonus)

`format_action_entry` in `scripts/judge_worker.py` gains MCP dispatch:

```python
CS_TOOL_LABEL = {
    "mcp__codescout__read_file": "read_file",
    "mcp__codescout__read_markdown": "read_md",
    "mcp__codescout__edit_file": "edit_file",
    "mcp__codescout__create_file": "create_file",
    "mcp__codescout__insert_code": "insert_code",
    "mcp__codescout__replace_symbol": "replace_sym",
    "mcp__codescout__remove_symbol": "remove_sym",
    "mcp__codescout__find_symbol": "find_sym",
    "mcp__codescout__grep": "grep",
    "mcp__codescout__list_dir": "list_dir",
}

def format_action_entry(event: dict) -> str:
    tool = event.get("tool_name", "Unknown")
    tool_input = event.get("tool_input") or {}

    # ... existing native-tool branches ...

    if tool in CS_TOOL_LABEL:
        label = CS_TOOL_LABEL[tool]
        path = tool_input.get("path") or tool_input.get("file_path")
        if path:
            parts = Path(path).parts
            short = "/".join(parts[-3:]) if len(parts) > 3 else path
            return f"Claude cs.{label} {short}"
        return f"Claude cs.{label}"

    return f"Claude {tool}"
```

The judge prompt (which reads narrative entries) now sees `Claude cs.read_md
specs/judge-plan-bubble-design.md` instead of `Claude mcp__codescout__read_markdown`,
which means the judge can actually reason about file activity.

**`assemble_context` extractor update.** The existing `edited_files` loop in
`assemble_context` (currently at `scripts/judge_worker.py:89-93`) splits
narrative entries on `"Edit "` / `"Write "` to build the `affected_symbols`
string. With the new cs-prefixed entries, those two substrings no longer
match codescout edits. Extend the extractor to also recognize
`cs.edit_file`, `cs.create_file`, and `cs.insert_code` prefixes:

```python
EDIT_MARKERS = ("Edit ", "Write ", "cs.edit_file ", "cs.create_file ", "cs.insert_code ")
for entry in narrative_entries[-10:]:
    text = entry.get("text", "")
    for marker in EDIT_MARKERS:
        if marker in text:
            # extract path token that follows the marker
            after = text.split(marker, 1)[1].strip().split()[0]
            edited_files.append(after)
            break
```

Without this change, the bonus narrative fix silently degrades the judge's
view of "recently edited" files, which is worse than the status quo.
## 5. Multi-instance safety

Every mutation is scoped to `.buddy/<session_id>/`. Two concurrent sessions
on the same project write to separate directories, hold separate active
plans, and surface separate bubbles. There is no shared lock, no write
contention, no cross-talk. The global `~/.claude/buddy/state.json` is not
touched by any of these changes — it continues to hold coarse signals
(last_edit_ts, prompt_count, etc.) that are inherently cross-session.

## 6. Failure modes & silent-fail contract

All new code respects the project-wide rule: "hook code must be silent on
failure — wrap in `except Exception: pass`." Specific handling:

- `load_active_plan` — missing file → None. Invalid JSON → unlink the
  corrupted file silently, return None. The next successful
  `save_active_plan` recreates it. Prevents a corrupted file from
  sticking forever and producing stale plan context.
- `save_active_plan` — atomic write via mkstemp+os.replace; if tmpfile
  write or rename fails, swallow and move on.
- `detect_plan_touch` — any unexpected event shape, unresolvable path,
  or glob mismatch → None.
- `fresh_verdict` — missing file → None, parse failure → None, empty
  `active_verdicts` → None.
- `_render_bubble` — any exception → return empty string; statusline never
  crashes. Guards on `session_id is None`, `session_id == "unknown"`, and
  `project_root is None` at entry.
- `/buddy:focus` with invalid path — prints error, does not write the file.
  Missing or `"unknown"` session_id → prints error, does not attempt write.
## 7. Tests

New test files / additions:

- `tests/test_active_plan.py`
  - `load_active_plan` missing file → None
  - `load_active_plan` corrupted JSON → None + file unlinked
  - `save_active_plan` + `load_active_plan` roundtrip
  - Explicit-over-auto precedence: auto write after explicit is refused
  - Explicit can overwrite explicit
  - **Multi-instance safety**: two `save_active_plan` calls into two different
    `session_dir`s on the same project do not interfere; each file has its
    own contents.

- `tests/test_plan_detect.py`
  - `detect_plan_touch` for each supported tool (Edit, Write, Read,
    NotebookEdit, and each codescout key)
  - Glob match positive + negative cases
  - `BUDDY_PLAN_GLOBS` env override (single + multiple globs)
  - Absolute native-tool path → normalized to relative
  - Relative MCP path → returned as-is
  - Path outside the plan glob (e.g. `scripts/state.py`) → None
  - Unknown tool → None
  - Missing `tool_input` key → None (no raise)

- `tests/test_judge_worker.py` — extensions:
  - `assemble_context` reads `active_plan.json` when present
  - Falls back to `plan_content=None` when no `active_plan.json`
  - Falls back to None when `active_plan.json` path is invalid
  - Codescout narrative entries are parsed by the new `EDIT_MARKERS` loop
  - `format_action_entry` produces `Claude cs.<label> <short-path>` for
    each codescout tool

- `tests/test_verdict_bubble.py`
  - `fresh_verdict` TTL boundary (exactly at TTL, 1s past)
  - Multi-verdict: returns latest + correct count
  - Missing file → None
  - Corrupted file → None
  - Empty `active_verdicts` → None
  - `BUDDY_BUBBLE_TTL` env override
  - TTL clamping (0 → 3, 1000 → 60)

- `tests/test_statusline.py` — extensions:
  - `_render_bubble` with fresh verdict (golden output check)
  - `_render_bubble` with expired verdict → empty string
  - `_render_bubble` with `session_id=None` → empty string
  - `_render_bubble` with `session_id="unknown"` → empty string
  - `_render_bubble` with `project_root=None` → empty string
  - `render()` without new kwargs (all 9 existing call sites keep passing)
  - `render()` with new kwargs and a fresh verdict (end-to-end)
  - `parse_stdin_session` happy path + malformed JSON + missing keys

All tests run under `pytest` from project root. No new test deps.
## 8. File inventory

### New files

- `commands/focus.md` — slash command definition.
- `tests/test_active_plan.py`, `tests/test_plan_detect.py`,
  `tests/test_verdict_bubble.py` — new test modules.
- `docs/superpowers/specs/2026-04-14-judge-plan-bubble-design.md` — this spec.

### Modified files

- `scripts/state.py` — add `load_active_plan`, `save_active_plan`.
- `scripts/hook_helpers.py` — add `detect_plan_touch`, `PLAN_TOOL_PATH_KEYS`,
  wire into `accumulate_narrative`.
- `scripts/verdicts.py` — add `fresh_verdict`.
- `scripts/judge_worker.py` — update `assemble_context` to read session-
  scoped plan; extend `format_action_entry` with codescout dispatch.
- `scripts/statusline.py` — extend `render()` + `main()` to thread session_id
  through and render bubble.
- `hooks/judge.env` — document new env vars `BUDDY_PLAN_GLOBS` and
  `BUDDY_BUBBLE_TTL`.
- `tests/test_judge_worker.py`, `tests/test_statusline.py` — extended cases.

## 9. Environment variables

Added to `hooks/judge.env`:

```bash
# Colon-separated globs for files that count as "plans" for session focus.
# Default covers the superpowers spec+plan layout.
export BUDDY_PLAN_GLOBS="docs/superpowers/plans/*.md:docs/superpowers/specs/*.md"

# How many seconds a verdict stays visible in the statusline bubble.
# Clamped to [3, 60].
export BUDDY_BUBBLE_TTL=10
```

## 10. Rollout

No migrations, no schema changes to existing files. Deployment is a single
plugin reload:

1. Pull the changes into `/home/marius/agents/buddy-plugin`.
2. `pytest` to confirm green.
3. `/reload-plugins` in each Claude Code instance.
4. Hooks fire on next tool call — if any plan file is touched, auto-detect
   writes `active_plan.json`, and next judge cycle uses the new selection.

Existing sessions that have no `active_plan.json` immediately shift to
narrative-only mode (no plan drift verdicts) until they touch a plan file or
the user runs `/buddy:focus`. This eliminates the false-drift stream
immediately on reload.

## 11. Open questions

- **Bubble width on narrow terminals.** The buddy label row stacks: mood +
  specialist initials + caveman badge (if active) + bubble. On very narrow
  terminals (≤60 cols) the row may wrap. Follow-up: add
  `BUDDY_BUBBLE_MAX_WIDTH` env cap + trailing ellipsis if the test feedback
  confirms wrapping is painful. Not shipping in this change — wait for real
  usage data.

- **[HARD PREREQ] Slash command stdin contract.** Whether Claude Code
  passes `session_id` in the stdin JSON to slash commands (same as hooks)
  is not verified in any existing Buddy code. This is a **blocker** for
  §4.6, not a soft question. The implementation plan's first step MUST
  be: invoke a throwaway `/buddy:focus-probe` command that dumps stdin to
  a file and confirms `session_id` is present and non-"unknown". If
  present → proceed with §4.6 as specified. If absent → halt
  implementation and re-enter brainstorming to design a safe
  single-session resolution mechanism. Do NOT ship a file-based fallback
  that reintroduces the multi-instance race this spec exists to prevent.

- **Nested plan directories.** The default globs match direct children
  only. Users with nested plan layouts can override `BUDDY_PLAN_GLOBS` to
  use `**`. If nested layouts become common in the project itself, promote
  the `**` form to the default.
