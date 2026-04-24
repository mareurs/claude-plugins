# Judge Plan + Verdict Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the buddy judge's broken global plan picker with session-scoped active plan tracking, surface fresh verdicts as a transient ASCII bubble in the buddy statusline, and fix the MCP-tool narrative blindness that prevents the judge from reasoning about file activity.

**Architecture:** Per-session sidecar files under `.buddy/<session_id>/active_plan.json` carry plan focus (auto-detected on plan-file touches, overrideable via `/buddy:focus`). The judge reads its session's plan instead of glob-and-pick. The statusline reads its session's `verdicts.json` and renders an inline ASCII bubble for verdicts younger than `BUDDY_BUBBLE_TTL` seconds. All new code follows the project's silent-on-failure + atomic-write contracts.

**Tech Stack:** Python 3 (3.10+), pytest, no new third-party deps. Existing patterns reused: `mkstemp + os.replace` atomic writes (`scripts/state.py::save_state`), JSON catalogs, `format_action_entry` narrative formatting, `assemble_context` judge prep.

**Spec:** `docs/superpowers/specs/2026-04-14-judge-plan-bubble-design.md`

---

## Pre-flight: Hard Prerequisite

The spec's §11 mandates verifying that Claude Code passes `session_id` in the JSON delivered on stdin to slash commands. If it does not, this entire plan must halt and the spec re-enters brainstorming for a different `/buddy:focus` resolution mechanism. Do NOT ship a file-based fallback.

### Task 0: Slash command stdin probe

**Files:**
- Create: `commands/focus-probe.md` (temporary — deleted at the end of this plan)

- [ ] **Step 0.1: Create the probe slash command**

```markdown
---
name: buddy:focus-probe
description: ONE-OFF — dump the stdin JSON Claude Code passes to slash commands. Used to verify session_id is present. Delete after verification.
---

You are a probe. Read all of stdin. Write its raw contents to
`/tmp/buddy-focus-probe.json`. Print `Wrote /tmp/buddy-focus-probe.json` and stop.

Use the Bash tool:

```bash
cat > /tmp/buddy-focus-probe.json
```

Then read the file back with the Read tool and print it inline so the user sees it without leaving Claude Code.
```

- [ ] **Step 0.2: Reload plugins so the new command is registered**

Run: `/reload-plugins`

- [ ] **Step 0.3: Invoke the probe**

Run: `/buddy:focus-probe`

- [ ] **Step 0.4: Inspect the captured JSON**

Read `/tmp/buddy-focus-probe.json`. Verify:
- A top-level `session_id` field exists
- It is a non-empty string and not the literal `"unknown"`
- Either `cwd` or `workspace.current_dir` exists for project root resolution

Expected: all three checks pass.

- [ ] **Step 0.5: Decision gate**

If all checks pass → proceed to Task 1.

If `session_id` is missing or `"unknown"` → **HALT**. Do not delete the probe. Print:

```
HALT: slash command stdin does not carry session_id.
This blocks /buddy:focus and the multi-instance safety guarantee.
Spec must re-enter brainstorming. See spec §11 [HARD PREREQ].
```

Stop work and surface to the user.

- [ ] **Step 0.6: Commit the probe (only on pass path)**

```bash
git add commands/focus-probe.md
git commit -m "chore(buddy): add temporary focus-probe command for stdin verification"
```

---

## File Structure Decisions

This plan touches existing files where the responsibility already lives:
- **State persistence** stays in `scripts/state.py` — `load_active_plan` / `save_active_plan` join `load_state` / `save_state`.
- **Hook signal accumulation** stays in `scripts/hook_helpers.py` — `detect_plan_touch` joins the existing `accumulate_narrative` flow.
- **Judge prep** stays in `scripts/judge_worker.py` — `assemble_context` and `format_action_entry` are extended in-place.
- **Verdict reading** stays in `scripts/verdicts.py` — `fresh_verdict` joins the existing `read_verdicts` / `_atomic_write` neighbors.
- **Statusline rendering** stays in `scripts/statusline.py` — `_render_bubble` and `parse_stdin_session` are added near the existing `parse_stdin_context_pct`.

No new modules. No restructuring. Each test file mirrors its source (`test_active_plan.py`, `test_plan_detect.py`, `test_verdict_bubble.py`).

**Lazy-import convention.** Several tasks below use `from scripts.X import Y` *inside* function bodies (e.g. `_render_bubble` imports `fresh_verdict`, `accumulate_narrative` imports `save_active_plan`, `assemble_context` imports `load_active_plan`). This is **intentional**, matching the pattern already in `scripts/statusline.py::main()` (which imports `load_state`, `load_identity` lazily inside main). The reason: every imported helper is wrapped in a try/except in the caller, and a lazy import means that an ImportError on the helper *also* gets swallowed silently, preserving the project's "hooks must never break user flow" contract. Eager top-level imports would propagate ImportError at module-load time, which is harder to silence cleanly.
## Task 1: `load_active_plan` and `save_active_plan` helpers

**Files:**
- Modify: `scripts/state.py` (add two helpers after `save_state`)
- Test: `tests/test_active_plan.py` (new)

- [ ] **Step 1.1: Write the failing tests**

Create `tests/test_active_plan.py`:

```python
import json
from pathlib import Path

from scripts.state import load_active_plan, save_active_plan


def test_load_missing_returns_none(tmp_path):
    assert load_active_plan(tmp_path) is None


def test_save_then_load_roundtrip(tmp_path):
    save_active_plan(tmp_path, "docs/plans/foo.md", "auto", now=1000)
    result = load_active_plan(tmp_path)
    assert result is not None
    assert result["path"] == "docs/plans/foo.md"
    assert result["source"] == "auto"
    assert result["set_at"] == 1000
    assert result["touched_ts"] == 1000


def test_save_updates_touched_ts_on_re_save(tmp_path):
    save_active_plan(tmp_path, "docs/plans/foo.md", "auto", now=1000)
    save_active_plan(tmp_path, "docs/plans/foo.md", "auto", now=2000)
    result = load_active_plan(tmp_path)
    assert result["set_at"] == 1000  # preserved
    assert result["touched_ts"] == 2000  # updated


def test_explicit_blocks_auto_overwrite(tmp_path):
    save_active_plan(tmp_path, "docs/plans/foo.md", "explicit", now=1000)
    save_active_plan(tmp_path, "docs/plans/bar.md", "auto", now=2000)
    result = load_active_plan(tmp_path)
    assert result["path"] == "docs/plans/foo.md"
    assert result["source"] == "explicit"


def test_explicit_can_overwrite_explicit(tmp_path):
    save_active_plan(tmp_path, "docs/plans/foo.md", "explicit", now=1000)
    save_active_plan(tmp_path, "docs/plans/bar.md", "explicit", now=2000)
    result = load_active_plan(tmp_path)
    assert result["path"] == "docs/plans/bar.md"
    assert result["set_at"] == 2000


def test_corrupted_file_unlinks_and_returns_none(tmp_path):
    plan_path = tmp_path / "active_plan.json"
    plan_path.write_text("{not valid json")
    assert load_active_plan(tmp_path) is None
    assert not plan_path.exists()  # unlinked


def test_multi_instance_isolation(tmp_path):
    """Two sessions in the same project don't interfere."""
    session_a = tmp_path / "session-a"
    session_b = tmp_path / "session-b"
    session_a.mkdir()
    session_b.mkdir()

    save_active_plan(session_a, "docs/plans/foo.md", "auto", now=1000)
    save_active_plan(session_b, "docs/plans/bar.md", "auto", now=1000)

    assert load_active_plan(session_a)["path"] == "docs/plans/foo.md"
    assert load_active_plan(session_b)["path"] == "docs/plans/bar.md"
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `pytest tests/test_active_plan.py -v`

Expected: ImportError or `AttributeError: module 'scripts.state' has no attribute 'load_active_plan'`. All 7 tests fail.

- [ ] **Step 1.3: Implement the helpers**

Append to `scripts/state.py`:

```python
ACTIVE_PLAN_FILENAME = "active_plan.json"


def load_active_plan(session_dir: Path) -> dict | None:
    """Return the active_plan.json dict, or None if missing/invalid.

    On parse failure, silently unlinks the corrupted file so a fresh
    detection can overwrite it. Never raises.
    """
    plan_path = session_dir / ACTIVE_PLAN_FILENAME
    if not plan_path.exists():
        return None
    try:
        with open(plan_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        try:
            plan_path.unlink()
        except OSError:
            pass
        return None


def save_active_plan(
    session_dir: Path,
    path: str,
    source: str,
    now: int,
) -> None:
    """Write active_plan.json atomically.

    Explicit-over-auto precedence: if an existing entry has source='explicit',
    auto writes are refused. Caller MUST pass a project-relative path.
    """
    if source not in ("auto", "explicit"):
        return

    existing = load_active_plan(session_dir)
    set_at = now
    if existing:
        if existing.get("source") == "explicit" and source == "auto":
            return  # explicit sticks
        # Preserve original set_at when re-saving the same logical entry
        if existing.get("path") == path:
            set_at = existing.get("set_at", now)

    data = {
        "path": path,
        "source": source,
        "set_at": set_at,
        "touched_ts": now,
    }

    plan_path = session_dir / ACTIVE_PLAN_FILENAME
    try:
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix=".active-plan-", suffix=".json.tmp", dir=plan_path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, plan_path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception:
        pass
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `pytest tests/test_active_plan.py -v`

Expected: 7 passed.

- [ ] **Step 1.5: Run the full suite to catch regressions**

Run: `pytest -x -q`

Expected: all green.

- [ ] **Step 1.6: Commit**

```bash
git add scripts/state.py tests/test_active_plan.py
git commit -m "feat(state): add load/save_active_plan with explicit-over-auto precedence"
```

---

## Task 2: `detect_plan_touch` and glob matcher

**Files:**
- Modify: `scripts/hook_helpers.py` (add helpers, do NOT wire into accumulate_narrative yet)
- Test: `tests/test_plan_detect.py` (new)

- [ ] **Step 2.1: Write the failing tests**

Create `tests/test_plan_detect.py`:

```python
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.hook_helpers import detect_plan_touch, _matches_plan_glob


PROJECT_ROOT = Path("/home/user/myproject")


def make_event(tool_name, **tool_input):
    return {"tool_name": tool_name, "tool_input": tool_input}


def test_native_edit_plan_path(tmp_path):
    event = make_event(
        "Edit",
        file_path="/home/user/myproject/docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_native_write_plan_path():
    event = make_event(
        "Write",
        file_path="/home/user/myproject/docs/superpowers/specs/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/specs/foo.md"


def test_native_read_plan_path():
    event = make_event(
        "Read",
        file_path="/home/user/myproject/docs/superpowers/plans/x.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/x.md"


def test_codescout_read_file_plan():
    event = make_event(
        "mcp__codescout__read_file",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_codescout_read_markdown_plan():
    event = make_event(
        "mcp__codescout__read_markdown",
        path="docs/superpowers/specs/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/specs/foo.md"


def test_codescout_edit_file_plan():
    event = make_event(
        "mcp__codescout__edit_file",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_codescout_create_file_plan():
    event = make_event(
        "mcp__codescout__create_file",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_codescout_insert_code_plan():
    event = make_event(
        "mcp__codescout__insert_code",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_codescout_replace_symbol_plan():
    event = make_event(
        "mcp__codescout__replace_symbol",
        path="docs/superpowers/plans/foo.md",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_path_outside_glob_returns_none():
    event = make_event(
        "Edit",
        file_path="/home/user/myproject/scripts/state.py",
    )
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_path_outside_project_returns_none():
    event = make_event("Edit", file_path="/etc/hosts")
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_unknown_tool_returns_none():
    event = make_event("SomeUnknownTool", file_path="docs/superpowers/plans/foo.md")
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_missing_tool_input_returns_none():
    event = {"tool_name": "Edit"}
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_empty_path_returns_none():
    event = make_event("Edit", file_path="")
    assert detect_plan_touch(event, PROJECT_ROOT) is None


def test_env_override_single_glob():
    with patch.dict(os.environ, {"BUDDY_PLAN_GLOBS": "custom/*.md"}):
        event = make_event("Edit", file_path="/home/user/myproject/custom/foo.md")
        assert detect_plan_touch(event, PROJECT_ROOT) == "custom/foo.md"


def test_env_override_multi_glob():
    with patch.dict(os.environ, {"BUDDY_PLAN_GLOBS": "a/*.md:b/*.md"}):
        event = make_event("Edit", file_path="/home/user/myproject/b/foo.md")
        assert detect_plan_touch(event, PROJECT_ROOT) == "b/foo.md"


def test_relative_native_path_passes_through():
    event = make_event("Edit", file_path="docs/superpowers/plans/foo.md")
    assert detect_plan_touch(event, PROJECT_ROOT) == "docs/superpowers/plans/foo.md"


def test_matches_plan_glob_default():
    assert _matches_plan_glob("docs/superpowers/plans/foo.md")
    assert _matches_plan_glob("docs/superpowers/specs/foo.md")
    assert not _matches_plan_glob("scripts/state.py")
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `pytest tests/test_plan_detect.py -v`

Expected: all 18 tests fail with ImportError on `detect_plan_touch` or `_matches_plan_glob`.

- [ ] **Step 2.3: Implement the helpers**

Add to `scripts/hook_helpers.py` (top of file, after existing imports — add `import fnmatch` and `import os` if not already there):

```python
PLAN_TOOL_PATH_KEYS = {
    "Edit": "file_path",
    "Write": "file_path",
    "Read": "file_path",
    "NotebookEdit": "file_path",
    "mcp__codescout__read_file": "path",
    "mcp__codescout__read_markdown": "path",
    "mcp__codescout__edit_file": "path",
    "mcp__codescout__create_file": "path",
    "mcp__codescout__insert_code": "path",
    "mcp__codescout__replace_symbol": "path",
    "mcp__codescout__remove_symbol": "path",
}

DEFAULT_PLAN_GLOBS = "docs/superpowers/plans/*.md:docs/superpowers/specs/*.md"


def _matches_plan_glob(rel_path: str) -> bool:
    """Match `rel_path` against BUDDY_PLAN_GLOBS (colon-separated)."""
    raw = os.environ.get("BUDDY_PLAN_GLOBS", DEFAULT_PLAN_GLOBS)
    for glob in raw.split(":"):
        glob = glob.strip()
        if not glob:
            continue
        if fnmatch.fnmatchcase(rel_path, glob):
            return True
    return False


def detect_plan_touch(event: dict, project_root: Path) -> str | None:
    """Return a project-relative plan path if this tool event touched one.

    Returns None for any unknown tool, missing path, path outside project,
    or path that does not match BUDDY_PLAN_GLOBS.
    """
    try:
        tool = event.get("tool_name", "")
        key = PLAN_TOOL_PATH_KEYS.get(tool)
        if not key:
            return None
        path_str = (event.get("tool_input") or {}).get(key)
        if not path_str:
            return None
        p = Path(path_str)
        if p.is_absolute():
            try:
                p = p.relative_to(project_root)
            except ValueError:
                return None  # path outside project
        rel = str(p)
        if not _matches_plan_glob(rel):
            return None
        return rel
    except Exception:
        return None
```

If `import fnmatch` is missing at the top of `hook_helpers.py`, add it. Same for `Path`.

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `pytest tests/test_plan_detect.py -v`

Expected: 18 passed.

- [ ] **Step 2.5: Run the full suite**

Run: `pytest -x -q`

Expected: all green.

- [ ] **Step 2.6: Commit**

```bash
git add scripts/hook_helpers.py tests/test_plan_detect.py
git commit -m "feat(hooks): add detect_plan_touch + glob matcher for plan files"
```

---

## Task 3: Wire `detect_plan_touch` into `accumulate_narrative`

**Files:**
- Modify: `scripts/hook_helpers.py` (extend `accumulate_narrative`)
- Test: `tests/test_hook_accumulate.py` (extend)

- [ ] **Step 3.1: Write the failing test**

Add to `tests/test_hook_accumulate.py`:

```python
def test_accumulate_writes_active_plan_on_plan_touch(tmp_path):
    """When a plan file is touched, accumulate_narrative writes active_plan.json."""
    from scripts.hook_helpers import accumulate_narrative
    from scripts.state import load_active_plan

    narrative_path = tmp_path / "narrative.jsonl"
    project_root = tmp_path
    (project_root / "docs" / "superpowers" / "plans").mkdir(parents=True)

    event = {
        "tool_name": "Edit",
        "tool_input": {
            "file_path": str(project_root / "docs" / "superpowers" / "plans" / "foo.md"),
        },
        "session_id": "sess-123",
    }

    accumulate_narrative(
        event=event,
        narrative_path=narrative_path,
        project_root=project_root,
        session_id="sess-123",
    )

    plan = load_active_plan(narrative_path.parent)
    assert plan is not None
    assert plan["path"] == "docs/superpowers/plans/foo.md"
    assert plan["source"] == "auto"


def test_accumulate_no_active_plan_for_non_plan_files(tmp_path):
    from scripts.hook_helpers import accumulate_narrative
    from scripts.state import load_active_plan

    narrative_path = tmp_path / "narrative.jsonl"
    project_root = tmp_path

    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": str(project_root / "scripts" / "state.py")},
        "session_id": "sess-123",
    }

    accumulate_narrative(
        event=event,
        narrative_path=narrative_path,
        project_root=project_root,
        session_id="sess-123",
    )

    assert load_active_plan(narrative_path.parent) is None
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `pytest tests/test_hook_accumulate.py::test_accumulate_writes_active_plan_on_plan_touch tests/test_hook_accumulate.py::test_accumulate_no_active_plan_for_non_plan_files -v`

Expected: both fail (active_plan.json never written because no integration yet).

- [ ] **Step 3.3: Wire into `accumulate_narrative`**

In `scripts/hook_helpers.py::accumulate_narrative`, immediately after `append_entry(narrative_path, "action", action_text)`, add:

```python
        # Plan-focus auto-detection (silent on failure)
        try:
            from scripts.state import save_active_plan
            import time as _time
            touched = detect_plan_touch(event, project_root)
            if touched:
                save_active_plan(
                    session_dir=narrative_path.parent,
                    path=touched,
                    source="auto",
                    now=int(_time.time()),
                )
        except Exception:
            pass
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `pytest tests/test_hook_accumulate.py -v`

Expected: all (existing + 2 new) pass.

- [ ] **Step 3.5: Run the full suite**

Run: `pytest -x -q`

Expected: all green.

- [ ] **Step 3.6: Commit**

```bash
git add scripts/hook_helpers.py tests/test_hook_accumulate.py
git commit -m "feat(hooks): auto-detect plan focus on plan-file touches"
```

---

## Task 4: `assemble_context` reads session-scoped plan

**Files:**
- Modify: `scripts/judge_worker.py` (rewrite plan-loading branch in `assemble_context`)
- Test: `tests/test_judge_worker.py` (extend)

- [ ] **Step 4.1: Write the failing tests**

Add to `tests/test_judge_worker.py`:

```python
def test_assemble_context_reads_session_active_plan(tmp_path):
    from scripts.judge_worker import assemble_context
    from scripts.state import save_active_plan
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "Claude Edit foo.py")

    plans_dir = tmp_path / "docs" / "superpowers" / "plans"
    plans_dir.mkdir(parents=True)
    (plans_dir / "the-active-plan.md").write_text("# Active\nStep A: do A")
    (plans_dir / "z-newer-by-name.md").write_text("# Other\nStep Z: do Z")

    save_active_plan(
        narrative_path.parent,
        "docs/superpowers/plans/the-active-plan.md",
        "explicit",
        now=1000,
    )

    ctx = assemble_context(narrative_path=narrative_path, project_root=tmp_path)
    assert "Step A: do A" in ctx["plan_content"]
    assert "Step Z" not in ctx["plan_content"]


def test_assemble_context_no_active_plan_returns_none(tmp_path):
    from scripts.judge_worker import assemble_context
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "Claude Edit foo.py")

    plans_dir = tmp_path / "docs" / "superpowers" / "plans"
    plans_dir.mkdir(parents=True)
    (plans_dir / "stale-plan.md").write_text("# Stale\nDo not pick me")

    ctx = assemble_context(narrative_path=narrative_path, project_root=tmp_path)
    assert ctx["plan_content"] is None


def test_assemble_context_invalid_active_plan_path(tmp_path):
    from scripts.judge_worker import assemble_context
    from scripts.state import save_active_plan
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "Claude Edit foo.py")

    save_active_plan(
        narrative_path.parent,
        "docs/superpowers/plans/does-not-exist.md",
        "auto",
        now=1000,
    )

    ctx = assemble_context(narrative_path=narrative_path, project_root=tmp_path)
    assert ctx["plan_content"] is None
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `pytest tests/test_judge_worker.py -k "assemble_context" -v`

Expected: the three new tests fail (current `assemble_context` still globs for the newest plan file). The existing `test_assemble_context_loads_plan` and `test_assemble_context_no_plan` also need updating in step 4.4 — they test the OLD glob behavior.

- [ ] **Step 4.3: Replace the plan-loading branch**

In `scripts/judge_worker.py::assemble_context`, replace the existing block that does `plan_dirs = [...]; plan_files = []; for d in plan_dirs: ...; if plan_files: plan_content = plan_files[0].read_text(...)` with:

```python
    # Read session-scoped active plan, not a global glob.
    plan_content = None
    try:
        from scripts.state import load_active_plan
        active = load_active_plan(narrative_path.parent)
        if active:
            plan_path = Path(active["path"])
            if not plan_path.is_absolute():
                plan_path = project_root / plan_path
            try:
                plan_content = plan_path.read_text(encoding="utf-8")[:4000]
            except Exception:
                plan_content = None
    except Exception:
        plan_content = None
```

- [ ] **Step 4.4: Update the existing assemble_context tests**

In `tests/test_judge_worker.py`, the OLD `test_assemble_context_loads_plan` glob-based test no longer reflects behavior. Update or remove it:

```python
def test_assemble_context_loads_plan(tmp_path):
    """Updated: plan now loads via session-scoped active_plan, not glob."""
    from scripts.judge_worker import assemble_context
    from scripts.state import save_active_plan
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "something")

    plans_dir = tmp_path / "docs" / "superpowers" / "plans"
    plans_dir.mkdir(parents=True)
    (plans_dir / "2026-04-14-feature.md").write_text("# Plan\nStep 1: do thing")

    save_active_plan(
        narrative_path.parent,
        "docs/superpowers/plans/2026-04-14-feature.md",
        "auto",
        now=1000,
    )

    ctx = assemble_context(
        narrative_path=narrative_path,
        project_root=tmp_path,
    )
    assert "Step 1: do thing" in ctx["plan_content"]
```

The existing `test_assemble_context_no_plan` already asserts `plan_content is None` when no plan is set — it still passes (no `active_plan.json` in `tmp_path`), so leave it.

- [ ] **Step 4.5: Run tests to verify they pass**

Run: `pytest tests/test_judge_worker.py -k "assemble_context" -v`

Expected: all 5 (2 existing updated + 3 new) pass.

- [ ] **Step 4.6: Run the full suite**

Run: `pytest -x -q`

Expected: all green.

- [ ] **Step 4.7: Commit**

```bash
git add scripts/judge_worker.py tests/test_judge_worker.py
git commit -m "fix(judge): read session-scoped active plan, not glob-and-pick"
```

---

## Task 5: `fresh_verdict` helper

**Files:**
- Modify: `scripts/verdicts.py` (add `fresh_verdict`, `_bubble_ttl`, constants)
- Test: `tests/test_verdict_bubble.py` (new)

- [ ] **Step 5.1: Write the failing tests**

Create `tests/test_verdict_bubble.py`:

```python
import json
import os
from pathlib import Path
from unittest.mock import patch

from scripts.verdicts import fresh_verdict, _bubble_ttl, write_verdict


def make_verdict(ts, severity="warning", verdict="plan-drift",
                 correction="do this thing", evidence="ev"):
    return {
        "ts": ts,
        "verdict": verdict,
        "severity": severity,
        "evidence": evidence,
        "correction": correction,
        "affected_files": [],
        "acknowledged": False,
    }


def test_fresh_verdict_missing_file(tmp_path):
    assert fresh_verdict(tmp_path, now=100) is None


def test_fresh_verdict_corrupted_file(tmp_path):
    (tmp_path / "verdicts.json").write_text("{not json")
    assert fresh_verdict(tmp_path, now=100) is None


def test_fresh_verdict_empty_active(tmp_path):
    (tmp_path / "verdicts.json").write_text(
        json.dumps({"session_id": "x", "active_verdicts": []})
    )
    assert fresh_verdict(tmp_path, now=100) is None


def test_fresh_verdict_returns_latest_within_ttl(tmp_path):
    write_verdict(tmp_path / "verdicts.json", make_verdict(ts=95), session_id="x")
    result = fresh_verdict(tmp_path, now=100, ttl=10)
    assert result is not None
    latest, count = result
    assert latest["ts"] == 95
    assert count == 1


def test_fresh_verdict_expired_outside_ttl(tmp_path):
    write_verdict(tmp_path / "verdicts.json", make_verdict(ts=80), session_id="x")
    assert fresh_verdict(tmp_path, now=100, ttl=10) is None


def test_fresh_verdict_ttl_boundary_exact(tmp_path):
    """ts exactly at the TTL edge is still fresh (now - ts == ttl)."""
    write_verdict(tmp_path / "verdicts.json", make_verdict(ts=90), session_id="x")
    assert fresh_verdict(tmp_path, now=100, ttl=10) is not None


def test_fresh_verdict_ttl_boundary_just_past(tmp_path):
    """One second past TTL is stale (now - ts == ttl + 1)."""
    write_verdict(tmp_path / "verdicts.json", make_verdict(ts=89), session_id="x")
    assert fresh_verdict(tmp_path, now=100, ttl=10) is None


def test_fresh_verdict_multi_verdict_count(tmp_path):
    p = tmp_path / "verdicts.json"
    write_verdict(p, make_verdict(ts=95, correction="first"), session_id="x")
    write_verdict(p, make_verdict(ts=96, correction="second"), session_id="x")
    write_verdict(p, make_verdict(ts=97, correction="third"), session_id="x")
    result = fresh_verdict(tmp_path, now=100, ttl=10)
    latest, count = result
    assert latest["correction"] == "third"
    assert count == 3


def test_fresh_verdict_mixed_fresh_and_stale(tmp_path):
    p = tmp_path / "verdicts.json"
    write_verdict(p, make_verdict(ts=80, correction="stale"), session_id="x")
    write_verdict(p, make_verdict(ts=95, correction="fresh"), session_id="x")
    result = fresh_verdict(tmp_path, now=100, ttl=10)
    latest, count = result
    assert latest["correction"] == "fresh"
    assert count == 1


def test_bubble_ttl_default():
    with patch.dict(os.environ, {}, clear=True):
        assert _bubble_ttl() == 10


def test_bubble_ttl_env_override():
    with patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "20"}):
        assert _bubble_ttl() == 20


def test_bubble_ttl_clamped_low():
    with patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "0"}):
        assert _bubble_ttl() == 3


def test_bubble_ttl_clamped_high():
    with patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "1000"}):
        assert _bubble_ttl() == 60


def test_bubble_ttl_invalid_falls_back():
    with patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "not-a-number"}):
        assert _bubble_ttl() == 10
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `pytest tests/test_verdict_bubble.py -v`

Expected: ImportError on `fresh_verdict`/`_bubble_ttl`, all tests fail.

- [ ] **Step 5.3: Implement the helpers**

Add to `scripts/verdicts.py` (top of file imports already have `json`, `os`):

```python
BUBBLE_TTL_DEFAULT = 10
BUBBLE_TTL_MIN = 3
BUBBLE_TTL_MAX = 60


def _bubble_ttl() -> int:
    try:
        raw = int(os.environ.get("BUDDY_BUBBLE_TTL", BUBBLE_TTL_DEFAULT))
    except (ValueError, TypeError):
        return BUBBLE_TTL_DEFAULT
    return max(BUBBLE_TTL_MIN, min(BUBBLE_TTL_MAX, raw))


def fresh_verdict(
    session_dir: Path,
    now: int,
    ttl: int | None = None,
) -> tuple[dict, int] | None:
    """Return (latest_fresh_verdict, total_fresh_count) or None.

    Single read of verdicts.json. Returns None on missing file, parse failure,
    empty active_verdicts, or no verdicts within the TTL window.
    """
    if ttl is None:
        ttl = _bubble_ttl()
    verdicts_path = session_dir / "verdicts.json"
    if not verdicts_path.exists():
        return None
    try:
        with open(verdicts_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    active = data.get("active_verdicts", [])
    fresh = [v for v in active if (now - v.get("ts", 0)) <= ttl]
    if not fresh:
        return None
    return fresh[-1], len(fresh)
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `pytest tests/test_verdict_bubble.py -v`

Expected: 12 passed.

- [ ] **Step 5.5: Run the full suite**

Run: `pytest -x -q`

Expected: all green.

- [ ] **Step 5.6: Commit**

```bash
git add scripts/verdicts.py tests/test_verdict_bubble.py
git commit -m "feat(verdicts): add fresh_verdict + bubble_ttl helpers"
```

---

## Task 6: `parse_stdin_session` + `_render_bubble` + `render()` extension

**Files:**
- Modify: `scripts/statusline.py` (add `parse_stdin_session`, `_render_bubble`, extend `render()` and `main()`)
- Test: `tests/test_statusline.py` (extend)

- [ ] **Step 6.1: Write the failing tests**

Add to `tests/test_statusline.py`:

```python
import os
import json as _json
from pathlib import Path
from unittest.mock import patch

from scripts.statusline import (
    render, parse_stdin_session, _render_bubble,
)
from scripts.state import default_state
from scripts.verdicts import write_verdict


def _identity():
    return {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }


def test_parse_stdin_session_happy_path():
    raw = _json.dumps({
        "session_id": "abc-123",
        "workspace": {"current_dir": "/home/user/proj"},
    })
    sid, root = parse_stdin_session(raw)
    assert sid == "abc-123"
    assert root == Path("/home/user/proj")


def test_parse_stdin_session_cwd_fallback():
    raw = _json.dumps({"session_id": "abc", "cwd": "/tmp/x"})
    sid, root = parse_stdin_session(raw)
    assert root == Path("/tmp/x")


def test_parse_stdin_session_malformed():
    sid, root = parse_stdin_session("not json")
    assert sid is None
    assert root is None


def test_parse_stdin_session_missing_keys():
    sid, root = parse_stdin_session("{}")
    assert sid is None
    assert root is None


def test_render_bubble_no_session():
    assert _render_bubble(None, Path("/x"), 100) == ""


def test_render_bubble_unknown_session():
    assert _render_bubble("unknown", Path("/x"), 100) == ""


def test_render_bubble_no_project_root():
    assert _render_bubble("sess", None, 100) == ""


def test_render_bubble_no_verdicts(tmp_path):
    (tmp_path / ".buddy" / "sess-1").mkdir(parents=True)
    assert _render_bubble("sess-1", tmp_path, 100) == ""


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_bubble_fresh_verdict(tmp_path):
    session_dir = tmp_path / ".buddy" / "sess-1"
    session_dir.mkdir(parents=True)
    write_verdict(
        session_dir / "verdicts.json",
        {
            "ts": 95,
            "verdict": "plan-drift",
            "severity": "warning",
            "evidence": "ev",
            "correction": "go back to step 2",
            "affected_files": [],
            "acknowledged": False,
        },
        session_id="sess-1",
    )
    out = _render_bubble("sess-1", tmp_path, 100)
    assert "[!]" in out
    assert "plan-drift" in out
    assert "go back to step 2" in out
    assert "\033[33m" in out  # warning color
    assert "\033[0m" in out   # RESET preserved


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_bubble_expired(tmp_path):
    session_dir = tmp_path / ".buddy" / "sess-1"
    session_dir.mkdir(parents=True)
    write_verdict(
        session_dir / "verdicts.json",
        {
            "ts": 50,
            "verdict": "plan-drift",
            "severity": "warning",
            "evidence": "ev",
            "correction": "stale advice",
            "affected_files": [],
            "acknowledged": False,
        },
        session_id="sess-1",
    )
    assert _render_bubble("sess-1", tmp_path, 100) == ""


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_bubble_multi_count(tmp_path):
    session_dir = tmp_path / ".buddy" / "sess-1"
    session_dir.mkdir(parents=True)
    p = session_dir / "verdicts.json"
    for ts in (95, 96, 97):
        write_verdict(p, {
            "ts": ts, "verdict": "plan-drift", "severity": "warning",
            "evidence": "", "correction": "fix", "affected_files": [],
            "acknowledged": False,
        }, session_id="sess-1")
    out = _render_bubble("sess-1", tmp_path, 100)
    assert "(+2)" in out


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_with_session_kwargs_no_bubble_when_no_verdict(tmp_path):
    """End-to-end: session kwargs supplied but no verdicts → no bubble."""
    from scripts.statusline import _load_json, DATA_DIR
    bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
    env = _load_json(DATA_DIR / "environment.json")
    state = default_state()
    out = render(
        identity=_identity(), state=state, bodhisattvas=bodhis, env=env,
        now=1000000, local_hour=14,
        session_id="sess-empty", project_root=tmp_path,
    )
    assert "[!]" not in out
    assert "[ok]" not in out


@patch.dict(os.environ, {"BUDDY_BUBBLE_TTL": "10"})
def test_render_with_session_kwargs_appends_bubble(tmp_path):
    """End-to-end: render() with session kwargs picks up a fresh verdict."""
    session_dir = tmp_path / ".buddy" / "sess-1"
    session_dir.mkdir(parents=True)
    write_verdict(
        session_dir / "verdicts.json",
        {
            "ts": 999995, "verdict": "plan-drift", "severity": "warning",
            "evidence": "", "correction": "fix this",
            "affected_files": [], "acknowledged": False,
        },
        session_id="sess-1",
    )

    from scripts.statusline import _load_json, DATA_DIR
    bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
    env = _load_json(DATA_DIR / "environment.json")
    state = default_state()

    out = render(
        identity=_identity(), state=state, bodhisattvas=bodhis, env=env,
        now=1000000, local_hour=14,
        session_id="sess-1", project_root=tmp_path,
    )
    assert "fix this" in out
    assert "[!]" in out


def test_render_existing_signature_unchanged(tmp_path):
    """All 9 existing test sites use kwargs only — adding kwarg-only params
    must not break them."""
    from scripts.statusline import _load_json, DATA_DIR
    bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
    env = _load_json(DATA_DIR / "environment.json")
    state = default_state()

    out = render(
        identity=_identity(), state=state, bodhisattvas=bodhis, env=env,
        now=1000000, local_hour=14,
    )
    assert "Owl" in out  # bubble absent — no session kwargs passed
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `pytest tests/test_statusline.py -v`

Expected: ImportError on `parse_stdin_session`/`_render_bubble`, all new tests fail. Existing 9 tests still pass (they don't touch the new symbols).

- [ ] **Step 6.3: Implement the helpers + extend `render()`**

Add to `scripts/statusline.py` near `parse_stdin_context_pct`:

```python
def parse_stdin_session(raw: str):
    """Extract session_id and project root from Claude Code's stdin JSON.

    Returns (None, None) on any parse failure — statusline still renders.
    Schema drift is tolerated by silent fallback.
    """
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError, TypeError):
        return None, None
    session_id = data.get("session_id")
    cwd = (data.get("workspace") or {}).get("current_dir") or data.get("cwd")
    project_root = Path(cwd) if cwd else None
    return session_id, project_root


SEVERITY_FORMAT = {
    "info": ("\033[32m", "[ok]"),
    "warning": ("\033[33m", "[!]"),
    "blocking": ("\033[31m", "[X]"),
}
RESET = "\033[0m"


def _render_bubble(session_id, project_root, now):
    if not session_id or session_id == "unknown" or project_root is None:
        return ""
    try:
        from scripts.verdicts import fresh_verdict
        session_dir = project_root / ".buddy" / session_id
        result = fresh_verdict(session_dir, now or int(time.time()))
        if result is None:
            return ""
        latest, count = result
        color, icon = SEVERITY_FORMAT.get(
            latest.get("severity", ""), ("", "[?]")
        )
        correction = (latest.get("correction") or "")[:60]
        verdict_name = latest.get("verdict", "")
        suffix = f" (+{count - 1})" if count > 1 else ""
        return f"{color}{icon} {verdict_name}: {correction}{RESET}{suffix}"
    except Exception:
        return ""
```

Replace the existing `render(...)` signature with the keyword-only extension. Keep the body identical until just before `return f"{base}\n {label}"`:

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
    """Compose the statusline output."""
    import time as _t
    if now is None:
        now = int(_t.time())
    if local_hour is None:
        local_hour = datetime.now().hour

    mood, suggested = derive_mood(state.get("signals", {}), now, local_hour)

    form_name = identity.get("form", "")
    form = bodhisattvas.get(form_name)
    if not form:
        return f"· {identity.get('name', '?')} · {mood}"

    env_strip = env.get(mood, env.get("flow", ""))
    eyes = form["eyes"].get(mood) or form["eyes"].get("flow", "·_·")
    base = form["base"].replace("{env}", env_strip).replace("{eyes}", eyes)

    label_parts = [form.get("label", form_name), mood]
    if suggested:
        short = SPECIALIST_SHORT.get(suggested, suggested)
        label_parts.append(f"{short} nearby")

    active = state.get("active_specialists", [])
    if active:
        initials = "".join(SPECIALIST_INITIAL.get(s, "?") for s in active)
        label_parts.append(f"[{initials}]")

    label = " · ".join(label_parts)

    bubble = _render_bubble(session_id, project_root, now)
    if bubble:
        label = f"{label} {bubble}"

    return f"{base}\n {label}"
```

Update `main()` to wire the new kwargs:

```python
def main() -> int:
    try:
        raw_stdin = sys.stdin.read()
    except Exception:
        raw_stdin = ""

    try:
        from scripts.state import load_state
        from scripts.identity import load_identity

        state = load_state(STATE_PATH)

        ctx_pct = parse_stdin_context_pct(raw_stdin)
        if ctx_pct > 0:
            state.setdefault("signals", {})["context_pct"] = ctx_pct

        session_id, project_root = parse_stdin_session(raw_stdin)

        import os
        user_id = os.environ.get("CLAUDE_CODE_USER_ID") or os.environ.get("USER", "user")
        identity = load_identity(IDENTITY_PATH, user_id=user_id)

        bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
        env = _load_json(DATA_DIR / "environment.json")

        sys.stdout.write(render(
            identity, state, bodhis, env,
            session_id=session_id, project_root=project_root,
        ))
    except Exception:
        pass

    return 0
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `pytest tests/test_statusline.py -v`

Expected: all (9 existing + 13 new) pass.

- [ ] **Step 6.5: Run the full suite**

Run: `pytest -x -q`

Expected: all green.

- [ ] **Step 6.6: Commit**

```bash
git add scripts/statusline.py tests/test_statusline.py
git commit -m "feat(statusline): render verdict bubble inline on label row"
```

---

## Task 7: Codescout MCP path extraction in narrative

**Files:**
- Modify: `scripts/judge_worker.py` (extend `format_action_entry` + `assemble_context` `edited_files` extractor)
- Test: `tests/test_judge_worker.py` (extend)

- [ ] **Step 7.1: Write the failing tests**

Add to `tests/test_judge_worker.py`:

```python
def test_format_action_entry_codescout_read_file():
    from scripts.judge_worker import format_action_entry
    event = {
        "tool_name": "mcp__codescout__read_file",
        "tool_input": {"path": "scripts/state.py"},
    }
    result = format_action_entry(event)
    assert "cs.read_file" in result
    assert "state.py" in result


def test_format_action_entry_codescout_edit_file():
    from scripts.judge_worker import format_action_entry
    event = {
        "tool_name": "mcp__codescout__edit_file",
        "tool_input": {"path": "scripts/state.py"},
    }
    result = format_action_entry(event)
    assert "cs.edit_file" in result


def test_format_action_entry_codescout_no_path():
    from scripts.judge_worker import format_action_entry
    event = {"tool_name": "mcp__codescout__find_symbol", "tool_input": {"query": "x"}}
    result = format_action_entry(event)
    assert result == "Claude cs.find_sym"


def test_assemble_context_extracts_cs_edit_files(tmp_path):
    from scripts.judge_worker import assemble_context
    from scripts.narrative import append_entry

    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "Claude cs.edit_file scripts/state.py")
    append_entry(narrative_path, "action", "Claude cs.create_file tests/new.py")

    ctx = assemble_context(narrative_path=narrative_path, project_root=tmp_path)
    assert "scripts/state.py" in ctx["affected_symbols"]
    assert "tests/new.py" in ctx["affected_symbols"]
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `pytest tests/test_judge_worker.py -k "codescout or cs_edit_files" -v`

Expected: 4 tests fail. Current `format_action_entry` returns bare `"Claude mcp__codescout__..."`; current `edited_files` extractor doesn't recognize `cs.*` prefixes.

- [ ] **Step 7.3: Extend `format_action_entry`**

In `scripts/judge_worker.py`, add the constant near the top of the file:

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
```

In `format_action_entry`, before the final `return f"Claude {tool}"`, add:

```python
    if tool in CS_TOOL_LABEL:
        label = CS_TOOL_LABEL[tool]
        path = tool_input.get("path") or tool_input.get("file_path")
        if path:
            parts = Path(path).parts
            short = "/".join(parts[-3:]) if len(parts) > 3 else path
            return f"Claude cs.{label} {short}"
        return f"Claude cs.{label}"
```

- [ ] **Step 7.4: Extend the `edited_files` extractor**

In `scripts/judge_worker.py::assemble_context`, find the existing `edited_files` loop (the one that splits on `"Edit "` / `"Write "`) and replace it with:

```python
    affected_symbols = ""
    edited_files = []
    EDIT_MARKERS = (
        "Edit ", "Write ",
        "cs.edit_file ", "cs.create_file ", "cs.insert_code ",
    )
    for entry in narrative_entries[-10:]:
        text = entry.get("text", "")
        for marker in EDIT_MARKERS:
            idx = text.find(marker)
            if idx >= 0:
                after = text[idx + len(marker):].strip().split()
                if after:
                    edited_files.append(after[0])
                break
    if edited_files:
        affected_symbols = "Recently edited: " + ", ".join(set(edited_files))
```

- [ ] **Step 7.5: Run tests to verify they pass**

Run: `pytest tests/test_judge_worker.py -v`

Expected: all judge_worker tests pass (existing + new).

- [ ] **Step 7.6: Run the full suite**

Run: `pytest -x -q`

Expected: all green.

- [ ] **Step 7.7: Commit**

```bash
git add scripts/judge_worker.py tests/test_judge_worker.py
git commit -m "feat(judge): extract paths from codescout MCP tools in narrative"
```

---

## Task 8: `/buddy:focus` slash command

**Files:**
- Create: `commands/focus.md`
- (No new tests — slash commands are LLM-driven prompts; behavior is verified manually in Task 10)

- [ ] **Step 8.1: Create the focus command**

Create `commands/focus.md`:

```markdown
---
name: buddy:focus
description: Set, clear, or show the active plan for this session. Scoped to session_id — multiple concurrent sessions on the same project each have their own focus. Usage: /buddy:focus <path>, /buddy:focus --clear, /buddy:focus (no args shows current).
---

You are handling a /buddy:focus request. The argument is `$1`.

## Step 1 — Resolve the session

Read `session_id` and `cwd` from the stdin JSON Claude Code delivers to this
command. If `session_id` is missing or the literal string "unknown", print
"Could not resolve session id — cannot scope focus" and stop. Do not guess.

Compute:

- `PROJECT_DIR = <cwd from stdin, or $CLAUDE_PROJECT_DIR fallback>`
- `SESSION_DIR = $PROJECT_DIR/.buddy/$session_id`

## Step 2 — Dispatch on argument

### No argument

Read `$SESSION_DIR/active_plan.json` via the Read tool. If present, print:

```
Active plan: <path> (<source>, set <relative time> ago)
```

If absent, print:

```
No active plan. Judge running in narrative-only mode.
```

### `--clear`

Use the Bash tool to delete `$SESSION_DIR/active_plan.json`:

```bash
rm -f "$SESSION_DIR/active_plan.json"
```

Print: `Active plan cleared. Judge now narrative-only.`

### Any other value (a path)

**Setup.** Before the sub-steps, export the inputs as env vars so all
Python one-liners can read them via `os.environ` — this eliminates shell
quoting/injection bugs from paths that may contain single quotes, spaces,
or `$`:

```bash
export BUDDY_FOCUS_RAW="$1"
export BUDDY_FOCUS_PROJECT_DIR="$PROJECT_DIR"
export BUDDY_FOCUS_SESSION_DIR="$SESSION_DIR"
```

Four sub-steps:

1. **Resolve.** If `BUDDY_FOCUS_RAW` is relative, resolve **against
   `BUDDY_FOCUS_PROJECT_DIR` (not the process cwd)**:

   ```bash
   export BUDDY_FOCUS_ABS=$(python3 -c '
   import os
   from pathlib import Path
   raw = os.environ["BUDDY_FOCUS_RAW"]
   base = Path(os.environ["BUDDY_FOCUS_PROJECT_DIR"])
   p = Path(raw)
   print(str(p.resolve()) if p.is_absolute() else str((base / raw).resolve()))
   ')
   ```

2. **Verify existence.** If `BUDDY_FOCUS_ABS` does not exist as a file,
   print "Plan file not found: $BUDDY_FOCUS_RAW" and stop:

   ```bash
   [ -f "$BUDDY_FOCUS_ABS" ] || { echo "Plan file not found: $BUDDY_FOCUS_RAW"; exit 0; }
   ```

3. **Normalize to project-relative.**

   ```bash
   export BUDDY_FOCUS_REL=$(python3 -c '
   import os
   from pathlib import Path
   try:
       print(Path(os.environ["BUDDY_FOCUS_ABS"]).relative_to(os.environ["BUDDY_FOCUS_PROJECT_DIR"]))
   except ValueError:
       print("OUTSIDE")
   ')
   ```

   If `BUDDY_FOCUS_REL == OUTSIDE`, print "Plan path outside project —
   cannot set active plan" and stop.

4. **Save.** Call `save_active_plan`:

   ```bash
   python3 -c '
   import os, sys, time
   sys.path.insert(0, os.environ["CLAUDE_PLUGIN_ROOT"])
   from pathlib import Path
   from scripts.state import save_active_plan
   save_active_plan(
       session_dir=Path(os.environ["BUDDY_FOCUS_SESSION_DIR"]),
       path=os.environ["BUDDY_FOCUS_REL"],
       source="explicit",
       now=int(time.time()),
   )
   ' || true
   ```

   Print: `Focused on: $BUDDY_FOCUS_REL`.

## Step 3 — Report state

Echo the final state of the active plan in one short line. Done.
```

- [ ] **Step 8.2: Reload plugins and smoke test**

Run: `/reload-plugins`

Then in the same Claude Code session:

- `/buddy:focus` → expect "No active plan. Judge running in narrative-only mode." (or current plan if Task 3 already auto-set one)
- `/buddy:focus docs/superpowers/plans/2026-04-14-judge-plan-bubble.md` → expect "Focused on: docs/superpowers/plans/2026-04-14-judge-plan-bubble.md"
- `/buddy:focus` → expect "Active plan: docs/superpowers/plans/2026-04-14-judge-plan-bubble.md (explicit, set 0s ago)"
- `/buddy:focus --clear` → expect "Active plan cleared..."

If any step fails, debug the slash command before continuing.

- [ ] **Step 8.3: Commit**

```bash
git add commands/focus.md
git commit -m "feat(commands): add /buddy:focus for session-scoped plan selection"
```

---

## Task 9: Document env vars in `hooks/judge.env`

**Files:**
- Modify: `hooks/judge.env`

- [ ] **Step 9.1: Add the new env vars**

Append to `hooks/judge.env`:

```bash

# Colon-separated globs for files that count as "plans" for /buddy:focus
# auto-detection. Default covers the superpowers spec+plan layout.
export BUDDY_PLAN_GLOBS="docs/superpowers/plans/*.md:docs/superpowers/specs/*.md"

# How many seconds a verdict stays visible in the statusline bubble.
# Clamped to [3, 60].
export BUDDY_BUBBLE_TTL=10
```

- [ ] **Step 9.2: Commit**

```bash
git add hooks/judge.env
git commit -m "docs(judge): document BUDDY_PLAN_GLOBS and BUDDY_BUBBLE_TTL"
```

---

## Task 10: Manual end-to-end verification

**Files:** none (in-session verification)

- [ ] **Step 10.1: Reload plugins**

Run: `/reload-plugins`

- [ ] **Step 10.2: Edit a non-plan file to confirm no auto-focus on irrelevant files**

Use the codescout `edit_file` or native Edit tool to make a no-op edit to
`scripts/state.py` (e.g. add and remove a blank line). Then:

```bash
ls /home/marius/agents/buddy-plugin/.buddy/$(ls -t /home/marius/agents/buddy-plugin/.buddy | head -1)/
```

Expected: `narrative.jsonl` and `verdicts.json` exist; `active_plan.json`
does NOT yet exist (no plan touched).

- [ ] **Step 10.3: Read a plan file to trigger auto-focus**

Use codescout `read_markdown` on `docs/superpowers/plans/2026-04-14-judge-plan-bubble.md`. Then:

```bash
cat /home/marius/agents/buddy-plugin/.buddy/$(ls -t /home/marius/agents/buddy-plugin/.buddy | head -1)/active_plan.json
```

Expected:

```json
{
  "path": "docs/superpowers/plans/2026-04-14-judge-plan-bubble.md",
  "source": "auto",
  "set_at": <unix ts>,
  "touched_ts": <unix ts>
}
```

- [ ] **Step 10.4: Wait for next judge cycle and inspect verdicts**

After 5 more tool calls (the `BUDDY_JUDGE_INTERVAL` default), the judge
fires. Read the session's `verdicts.json` and confirm any new verdicts
reference the correct active plan (no longer hallucinating about TDD for
the narrative module).

- [ ] **Step 10.5: Confirm the bubble appears in statusline**

Within 10 seconds of a new verdict being written, the buddy statusline
label row should show an inline bubble like:

```
Owl · flow · [A] [CAVEMAN] [!] plan-drift: <correction text>
```

- [ ] **Step 10.6: Confirm the bubble decays**

Wait 15 seconds without new judge activity. The bubble should disappear
on the next statusline render.

- [ ] **Step 10.7: Test explicit override**

Run `/buddy:focus docs/superpowers/specs/2026-04-14-judge-plan-bubble-design.md`

Then trigger another tool call. Verify `active_plan.json` shows
`"source": "explicit"` and the path you set. Touch a plan file via Read —
confirm the auto write does NOT overwrite the explicit entry.

- [ ] **Step 10.8: Test --clear**

Run `/buddy:focus --clear`. Confirm `active_plan.json` is gone. Confirm
the next judge cycle runs narrative-only (no plan section in the
verdict's evidence).

- [ ] **Step 10.9: Cleanup probe**

Delete the temporary probe command from Task 0:

```bash
rm /home/marius/agents/buddy-plugin/commands/focus-probe.md
git add commands/focus-probe.md
git commit -m "chore(buddy): remove focus-probe after verification"
```

(Note: `git add` of a deleted file stages the deletion.)

---

## Task 11: Final pytest sweep

- [ ] **Step 11.1: Run the full suite once more**

Run: `pytest -x -q`

Expected: every test green. No skips beyond pre-existing ones.

- [ ] **Step 11.2: Confirm no leftover state from manual testing**

Inspect for stray files in any session dir from Task 10:

```bash
find /home/marius/agents/buddy-plugin/.buddy -name "active_plan.json"
```

This is fine — they're per-session and harmless. They serve as live
acceptance evidence.

- [ ] **Step 11.3: Final summary commit (only if any cleanup needed)**

If there are any uncommitted spec/doc tweaks discovered during manual
testing, commit them with a "chore: post-impl cleanup" message. Otherwise
this step is a no-op.

---

## Definition of Done

- All 11 tasks have every checkbox checked.
- `pytest -x -q` is green.
- The buddy statusline shows a transient `[!]`/`[ok]`/`[X]` bubble next to
  the label row when a fresh verdict exists.
- `/buddy:focus`, `/buddy:focus --clear`, and `/buddy:focus <path>` all
  work as documented.
- A new session that touches no plan files runs the judge in narrative-only
  mode (no false plan-drift verdicts).
- A new session that touches a plan file under `docs/superpowers/plans/` or
  `docs/superpowers/specs/` auto-binds and judges against that plan.
- The temporary `commands/focus-probe.md` is deleted.
- Spec is committed alongside the implementation (or in a separate
  pre-impl commit per the user's preference).
