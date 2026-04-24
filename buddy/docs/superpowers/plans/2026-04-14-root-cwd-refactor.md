# Root CWD / Active Project Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `root_cwd` (static, where Claude Code launched) and `cs_active_project` (dynamic, where codescout is currently pointed) explicit, named concepts — stored once, read everywhere — so path manipulation code can't confuse them.

**Architecture:** Store `root_cwd` in `state["signals"]` at session start. `cs_active_project` already exists but is under-used. All consumers switch from re-extracting `event["cwd"]` to reading these signals. `detect_plan_touch` uses the correct root depending on whether native tools (root_cwd) or codescout tools (active project root) are involved.

**Tech Stack:** Python 3.12, pytest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/state.py` | Modify | Add `root_cwd` to `default_state()` signals |
| `scripts/hook_helpers.py` | Modify | Store `root_cwd` at session start; read it in `handle_cs_tool_use` and `detect_plan_touch`; drop redundant `event["cwd"]` extractions |
| `scripts/cs_heuristics.py` | Modify | `_check_forgot_restore` and helpers: replace `event["cwd"]` with explicit `root_cwd` parameter; remove `_args_look_like_home` (dead after signal fix) |
| `hooks/post-tool-use.sh` | Modify | Pass `root_cwd` from state to `accumulate_narrative` instead of re-extracting |
| `tests/test_cs_heuristics.py` | Modify | Update buffer-ref tests for `outcome="buffered"`, add false-positive regression test, update `_make_event` to include `cwd` |
| `tests/test_hook_helpers.py` | Modify | Add tests for `root_cwd` signal storage and `cs_active_project` normpath fix |

---

### Task 1: Add `root_cwd` to state schema

**Files:**
- Modify: `scripts/state.py:14-41` (`default_state`)
- Test: `tests/test_state.py`

- [ ] **Step 1: Write the failing test**

In `tests/test_state.py`, add:

```python
def test_default_state_includes_root_cwd():
    from scripts.state import default_state
    state = default_state()
    assert "root_cwd" in state["signals"]
    assert state["signals"]["root_cwd"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_state.py::test_default_state_includes_root_cwd -v`
Expected: FAIL — `KeyError: 'root_cwd'`

- [ ] **Step 3: Add `root_cwd` to `default_state()`**

In `scripts/state.py`, inside `default_state()["signals"]`, add after `"cs_active_project": None`:

```python
            "root_cwd": None,  # set once at session start; static for session
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_state.py::test_default_state_includes_root_cwd -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/state.py tests/test_state.py
git commit -m "feat(state): add root_cwd signal to default_state schema"
```

---

### Task 2: Store `root_cwd` at session start

**Files:**
- Modify: `scripts/hook_helpers.py:88-143` (`handle_session_start`)
- Test: `tests/test_hook_helpers.py`

- [ ] **Step 1: Write the failing test**

In `tests/test_hook_helpers.py`, add:

```python
def test_session_start_stores_root_cwd(tmp_path):
    from scripts.hook_helpers import handle_session_start
    from scripts.state import load_state

    state_path = tmp_path / "state.json"
    event = {"timestamp": 100, "cwd": "/home/user/myproject"}
    handle_session_start(event, state_path)

    state = load_state(state_path)
    assert state["signals"]["root_cwd"] == "/home/user/myproject"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_hook_helpers.py::test_session_start_stores_root_cwd -v`
Expected: FAIL — `root_cwd` is `None` (never set)

- [ ] **Step 3: Store `root_cwd` in `handle_session_start`**

In `scripts/hook_helpers.py`, inside `handle_session_start`, after the cs judge signal clears (line ~120) and before `save_state`, add:

```python
        # Store root_cwd — the static directory where Claude Code launched.
        # All path comparisons for "is this the home project?" read this value.
        state["signals"]["root_cwd"] = event.get("cwd") or ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_hook_helpers.py::test_session_start_stores_root_cwd -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/hook_helpers.py tests/test_hook_helpers.py
git commit -m "feat(session): store root_cwd signal at session start"
```

---

### Task 3: Use `root_cwd` from state in `handle_cs_tool_use` for home detection

**Files:**
- Modify: `scripts/hook_helpers.py:188-277` (`handle_cs_tool_use`)
- Test: `tests/test_hook_helpers.py`

- [ ] **Step 1: Write the failing test**

In `tests/test_hook_helpers.py`, add:

```python
def test_cs_active_project_clears_on_absolute_home_path(tmp_path):
    """Restoring home via absolute path must clear cs_active_project."""
    from scripts.hook_helpers import handle_session_start, handle_cs_tool_use
    from scripts.state import load_state

    state_path = tmp_path / "state.json"
    session_dir = tmp_path / ".buddy" / "test-session"
    session_dir.mkdir(parents=True)

    # Simulate session start with root_cwd
    handle_session_start(
        {"timestamp": 100, "cwd": "/home/user/myproject"}, state_path,
    )

    # Activate a foreign project
    handle_cs_tool_use(
        event={
            "tool_name": "mcp__codescout__activate_project",
            "tool_input": {"path": "/tmp/foreign"},
            "cwd": "/home/user/myproject",
        },
        session_dir=session_dir,
        state_path=state_path,
        session_id="test-session",
    )
    state = load_state(state_path)
    assert state["signals"]["cs_active_project"] == "/tmp/foreign"

    # Restore home via absolute path (not ".")
    handle_cs_tool_use(
        event={
            "tool_name": "mcp__codescout__activate_project",
            "tool_input": {"path": "/home/user/myproject"},
            "cwd": "/home/user/myproject",
        },
        session_dir=session_dir,
        state_path=state_path,
        session_id="test-session",
    )
    state = load_state(state_path)
    assert state["signals"]["cs_active_project"] is None, \
        "absolute home path should clear cs_active_project"
```

- [ ] **Step 2: Run test to verify it passes (already fixed)**

Run: `pytest tests/test_hook_helpers.py::test_cs_active_project_clears_on_absolute_home_path -v`
Expected: PASS — the normpath fix was already applied earlier in this session. This test locks it in.

- [ ] **Step 3: Refactor `handle_cs_tool_use` to read `root_cwd` from state instead of `event["cwd"]`**

In `handle_cs_tool_use`, replace the `cs_active_project` tracking block (step 3) with:

```python
        # 3. Track cs_active_project.
        #    Use root_cwd from state (set at session start) — not event["cwd"]
        #    which is re-extracted per event and unnamed.
        state = load_state(state_path)
        sig = state["signals"]
        if tool_name == "mcp__codescout__activate_project":
            import os as _os
            path_arg = tool_input.get("path", "")
            root_cwd = sig.get("root_cwd", "")
            is_home = (
                path_arg == "."
                or bool(
                    root_cwd
                    and path_arg
                    and _os.path.normpath(path_arg) == _os.path.normpath(root_cwd)
                )
            )
            sig["cs_active_project"] = None if is_home else path_arg
```

- [ ] **Step 4: Run full test suite**

Run: `pytest tests/test_hook_helpers.py tests/test_cs_heuristics.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add scripts/hook_helpers.py tests/test_hook_helpers.py
git commit -m "refactor(cs): read root_cwd from state instead of event['cwd']"
```

---

### Task 4: Update `_check_forgot_restore` to use `root_cwd` from state

**Files:**
- Modify: `scripts/cs_heuristics.py:47-148`
- Modify: `scripts/hook_helpers.py:188-277` (pass `root_cwd` to `cs_check`)
- Test: `tests/test_cs_heuristics.py`

The `check()` function currently receives `(event, session_log)`. To use `root_cwd` from state, we thread it through.

- [ ] **Step 1: Update `_make_event` helper in tests to include `cwd`**

In `tests/test_cs_heuristics.py`, modify `_make_event`:

```python
def _make_event(tool_name="", tool_input=None, tool_error=None, cwd="/home/user/project"):
    return {
        "tool_name": tool_name,
        "tool_input": tool_input or {},
        "tool_error": tool_error,
        "timestamp": 1000,
        "cwd": cwd,
    }
```

- [ ] **Step 2: Add `root_cwd` parameter to `check()` signature**

In `scripts/cs_heuristics.py`, change:

```python
def check(event: dict, session_log: list[dict]) -> str | None:
```

to:

```python
def check(event: dict, session_log: list[dict], root_cwd: str = "") -> str | None:
```

Update the internal calls to pass `root_cwd` to `_check_forgot_restore`:

```python
        checks = [
            _check_structural_edit,
            lambda e, l: _check_forgot_restore(e, l, root_cwd),
            _check_ignored_buffer_ref,
            _check_native_bash_on_source,
            _check_parallel_write,
        ]
```

- [ ] **Step 3: Update `_check_forgot_restore` to accept `root_cwd` param**

Change `_check_forgot_restore` signature:

```python
def _check_forgot_restore(event: dict, session_log: list[dict], root_cwd: str = "") -> str | None:
```

Replace the `cwd = event.get("cwd", "")` line with:

```python
    cwd = root_cwd or event.get("cwd", "")
```

This falls back to `event["cwd"]` if `root_cwd` is empty (backwards compat).

- [ ] **Step 4: Update `handle_cs_tool_use` to pass `root_cwd` to `cs_check`**

In the heuristics call inside `handle_cs_tool_use`:

```python
        if heuristics_enabled:
            root_cwd = sig.get("root_cwd", "")
            correction = cs_check(event, session_log, root_cwd=root_cwd)
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_cs_heuristics.py tests/test_hook_helpers.py -v`
Expected: all pass (existing tests use default `root_cwd=""` → falls back to `event["cwd"]`)

- [ ] **Step 6: Commit**

```bash
git add scripts/cs_heuristics.py scripts/hook_helpers.py tests/test_cs_heuristics.py
git commit -m "refactor(cs): thread root_cwd through check() and _check_forgot_restore"
```

---

### Task 5: Fix `post-tool-use.sh` to use `root_cwd` from state for `.buddy/` path

**Files:**
- Modify: `hooks/post-tool-use.sh`
- Modify: `scripts/hook_helpers.py:146-185` (`handle_post_tool_use`)

Currently `.buddy/` path is computed from `event["cwd"]` in two places:
- `hooks/post-tool-use.sh:21` for `narrative_path`
- `handle_post_tool_use:181` for `session_dir`

Both should read `root_cwd` from state so all `.buddy/` paths are anchored consistently.

- [ ] **Step 1: Modify `handle_post_tool_use` to read `root_cwd` from state**

Replace lines 181-182:

```python
            cwd = event.get("cwd") or os.getcwd()
            session_dir = Path(cwd) / ".buddy" / session_id
```

with:

```python
            root_cwd = state["signals"].get("root_cwd") or event.get("cwd") or os.getcwd()
            session_dir = Path(root_cwd) / ".buddy" / session_id
```

Note: `state` is already loaded above at line 148. The fallback to `event["cwd"]` handles the edge case where the very first tool call happens before `handle_session_start` runs.

- [ ] **Step 2: Update `post-tool-use.sh` to use the same fallback**

Replace the inline Python:

```python
project_root = Path(event.get('cwd') or os.getcwd())
```

with:

```python
from scripts.state import load_state as _load
_state = _load(state_path)
project_root = Path(_state['signals'].get('root_cwd') or event.get('cwd') or os.getcwd())
```

- [ ] **Step 3: Run all tests**

Run: `pytest -v`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add hooks/post-tool-use.sh scripts/hook_helpers.py
git commit -m "refactor(hooks): anchor .buddy/ paths to root_cwd from state"
```

---

### Task 6: Update buffer-ref heuristic tests for `outcome="buffered"`

**Files:**
- Modify: `tests/test_cs_heuristics.py:149-173`

The `_check_ignored_buffer_ref` code was already fixed (earlier in this session) to check `prev.get("outcome") == "buffered"` instead of scanning args for `@cmd_`. The existing tests still pass the old `args` pattern. Update them to use `outcome="buffered"` and add a false-positive regression test.

- [ ] **Step 1: Update `test_ignored_buffer_ref_detected`**

```python
def test_ignored_buffer_ref_detected():
    log = [
        _make_log_entry(tool="mcp__codescout__run_command", args="cargo test", outcome="buffered"),
        _make_log_entry(tool="mcp__codescout__list_symbols", args="path=src/"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__list_symbols",
        tool_input={"path": "src/"},
    )
    result = check(event, log)
    assert result is not None
    assert "@cmd_" in result
```

- [ ] **Step 2: Update `test_buffer_ref_used_ok`**

```python
def test_buffer_ref_used_ok():
    log = [
        _make_log_entry(tool="mcp__codescout__run_command", args="cargo test", outcome="buffered"),
        _make_log_entry(tool="mcp__codescout__run_command", args="grep FAILED @cmd_abc"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__run_command",
        tool_input={"command": "grep FAILED @cmd_abc"},
    )
    result = check(event, log)
    assert result is None
```

- [ ] **Step 3: Add false-positive regression test**

```python
def test_buffer_ref_grep_pattern_not_false_positive():
    """Grep command with @cmd_ in the *pattern* (not outcome) must not trigger."""
    log = [
        _make_log_entry(
            tool="mcp__codescout__run_command",
            args='grep -n "output_id\\|@cmd_" scripts/foo.py',
            outcome="ok",  # NOT buffered — small inline output
        ),
        _make_log_entry(tool="mcp__codescout__run_command", args="ls scripts/"),
    ]
    event = _make_event(
        tool_name="mcp__codescout__run_command",
        tool_input={"command": "ls scripts/"},
    )
    result = check(event, log)
    assert result is None, "grep pattern containing @cmd_ must not trigger buffer-ref hint"
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_cs_heuristics.py -v`
Expected: all 20 tests pass

- [ ] **Step 5: Commit**

```bash
git add tests/test_cs_heuristics.py
git commit -m "test(cs): update buffer-ref tests for outcome='buffered', add false-positive regression"
```

---

### Task 7: Update design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-14-codescout-judge-design.md`

- [ ] **Step 1: Update "State & Signals" section**

Replace the signals block with:

```python
"cs_judge_verdict": None,      # "cs-misuse" | "cs-inefficient" | None
"cs_judge_severity": None,     # "blocking" | "warning" | "info"
"cs_tool_call_count": 0,       # counts codescout-namespaced calls only
"cs_active_project": None,     # current activate_project path; None = home
"root_cwd": None,              # set once at session start; static for session
```

Update the description paragraph:

```
`root_cwd` is set once during `handle_session_start` from `event["cwd"]`. It is the
directory where Claude Code was launched — static for the session lifetime. All "is this
the home project?" comparisons read this value.

`cs_active_project` is set when `activate_project` is called and cleared when the home
project is restored (detected via `"."` or normpath match against `root_cwd`).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-14-codescout-judge-design.md
git commit -m "docs(spec): document root_cwd signal and cs_active_project normpath fix"
```

---

### Task 8: Run full test suite and verify

- [ ] **Step 1: Run full suite**

Run: `pytest -v`
Expected: all tests pass

- [ ] **Step 2: Verify signals in live session**

```bash
python3 -c "
import json
d = json.load(open('/home/marius/.claude/buddy/state.json'))
sig = d['signals']
print('root_cwd:', repr(sig.get('root_cwd')))
print('cs_active_project:', repr(sig.get('cs_active_project')))
print('cs_tool_call_count:', sig.get('cs_tool_call_count'))
"
```

Expected: `root_cwd` is the codescout project path, `cs_active_project` is `None`.
