# Judge System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an async LLM judge that detects plan drifts, doc drifts, missed callers, and scope creep — blocking Claude via PreToolUse exit(2) when issues are serious.

**Architecture:** PostToolUse hook appends to a narrative JSONL file and periodically spawns a background judge worker. The judge calls an OpenAI-compatible LLM with narrative + codescout context, writes verdicts to a JSON file. A new PreToolUse hook reads cached verdicts and exits 2 on blocking findings. Two new moods (`drifting`, `broken`) feed into the existing render pipeline.

**Tech Stack:** Python 3, `requests` (HTTP), JSONL files, atomic JSON writes, subprocess for background worker.

**Spec:** `docs/superpowers/specs/2026-04-14-judge-system-design.md`

---

### Task 1: Narrative module — append and read

**Files:**
- Create: `scripts/narrative.py`
- Create: `tests/test_narrative.py`

- [ ] **Step 1: Write failing tests for narrative append and read**

```python
# tests/test_narrative.py
"""Tests for the narrative append-only log."""
import json
import time
from pathlib import Path
from scripts.narrative import append_entry, read_narrative


def test_append_entry_creates_file(tmp_path):
    path = tmp_path / "narrative.jsonl"
    append_entry(path, "action", "Claude Edit scripts/state.py — added judge signals")
    assert path.exists()
    lines = path.read_text().strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["type"] == "action"
    assert entry["text"] == "Claude Edit scripts/state.py — added judge signals"
    assert "ts" in entry


def test_append_entry_appends_multiple(tmp_path):
    path = tmp_path / "narrative.jsonl"
    append_entry(path, "goal", "User wants to add PreToolUse hook")
    append_entry(path, "action", "Claude read hook_helpers.py")
    append_entry(path, "decision", "Using JSON for verdict storage")
    lines = path.read_text().strip().splitlines()
    assert len(lines) == 3
    assert json.loads(lines[0])["type"] == "goal"
    assert json.loads(lines[2])["type"] == "decision"


def test_read_narrative_returns_entries(tmp_path):
    path = tmp_path / "narrative.jsonl"
    append_entry(path, "goal", "Fix login bug")
    append_entry(path, "action", "Claude read auth.py")
    entries = read_narrative(path)
    assert len(entries) == 2
    assert entries[0]["type"] == "goal"
    assert entries[1]["type"] == "action"


def test_read_narrative_empty_file(tmp_path):
    path = tmp_path / "narrative.jsonl"
    entries = read_narrative(path)
    assert entries == []


def test_read_narrative_missing_file(tmp_path):
    path = tmp_path / "does_not_exist.jsonl"
    entries = read_narrative(path)
    assert entries == []


def test_append_entry_creates_parent_dirs(tmp_path):
    path = tmp_path / "nested" / "deep" / "narrative.jsonl"
    append_entry(path, "action", "something")
    assert path.exists()


def test_append_entry_silent_on_failure():
    """Appending to an invalid path must not raise."""
    bad_path = Path("/proc/nonexistent/narrative.jsonl")
    append_entry(bad_path, "action", "should not crash")
    # No exception = pass
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_narrative.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.narrative'`

- [ ] **Step 3: Implement narrative module**

```python
# scripts/narrative.py
"""Append-only narrative log for the judge system.

Entries are JSONL lines with {ts, type, text}. The file grows until
compaction (handled by the judge worker, not here).
"""
import json
import time
from pathlib import Path


def append_entry(path: Path, entry_type: str, text: str) -> None:
    """Append a single narrative entry. Silent on failure."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        entry = {"ts": int(time.time()), "type": entry_type, "text": text}
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def read_narrative(path: Path) -> list[dict]:
    """Read all narrative entries. Returns [] on any failure."""
    try:
        if not path.exists():
            return []
        entries = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        return entries
    except Exception:
        return []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_narrative.py -v`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/narrative.py tests/test_narrative.py
git commit -m "feat(judge): add narrative append-only log module"
```

---

### Task 2: Narrative compaction

**Files:**
- Modify: `scripts/narrative.py`
- Modify: `tests/test_narrative.py`

- [ ] **Step 1: Write failing tests for compaction**

Append to `tests/test_narrative.py`:

```python
from scripts.narrative import compact_narrative, MAX_ENTRIES_BEFORE_COMPACT


def test_compact_replaces_old_entries_with_summary(tmp_path):
    path = tmp_path / "narrative.jsonl"
    for i in range(60):
        append_entry(path, "action", f"Action {i}")
    assert len(read_narrative(path)) == 60

    compact_narrative(path, summary="Did 60 things in the first phase.")
    entries = read_narrative(path)
    # Should have 1 compact + the 10 most recent
    assert entries[0]["type"] == "compact"
    assert "60 things" in entries[0]["text"]
    assert len(entries) == 11


def test_compact_preserves_recent_entries(tmp_path):
    path = tmp_path / "narrative.jsonl"
    for i in range(55):
        append_entry(path, "action", f"Action {i}")
    compact_narrative(path, summary="Summary of old stuff.")
    entries = read_narrative(path)
    # Last entry should be the most recent action
    assert entries[-1]["text"] == "Action 54"


def test_compact_noop_when_few_entries(tmp_path):
    path = tmp_path / "narrative.jsonl"
    for i in range(10):
        append_entry(path, "action", f"Action {i}")
    compact_narrative(path, summary="Should not be written.")
    entries = read_narrative(path)
    assert len(entries) == 10
    assert all(e["type"] == "action" for e in entries)


def test_max_entries_before_compact_is_50():
    assert MAX_ENTRIES_BEFORE_COMPACT == 50
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_narrative.py::test_compact_replaces_old_entries_with_summary -v`
Expected: FAIL — `ImportError: cannot import name 'compact_narrative'`

- [ ] **Step 3: Implement compaction**

Add to `scripts/narrative.py`:

```python
import tempfile
import os

MAX_ENTRIES_BEFORE_COMPACT = 50
KEEP_RECENT = 10


def compact_narrative(path: Path, summary: str) -> None:
    """Replace old entries with a single compact summary, keeping recent ones.

    Only compacts if entry count exceeds MAX_ENTRIES_BEFORE_COMPACT.
    Uses atomic write (mkstemp + os.replace) to avoid corruption.
    """
    try:
        entries = read_narrative(path)
        if len(entries) <= MAX_ENTRIES_BEFORE_COMPACT:
            return

        recent = entries[-KEEP_RECENT:]
        compact_entry = {"ts": int(time.time()), "type": "compact", "text": summary}

        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix=".narrative-", suffix=".jsonl.tmp", dir=path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(compact_entry, ensure_ascii=False) + "\n")
                for entry in recent:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception:
        pass
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_narrative.py -v`
Expected: all 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/narrative.py tests/test_narrative.py
git commit -m "feat(judge): add narrative compaction with atomic write"
```

---

### Task 3: Verdicts module — read, write, expire

**Files:**
- Create: `scripts/verdicts.py`
- Create: `tests/test_verdicts.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_verdicts.py
"""Tests for verdict I/O — atomic writes, expiry, acknowledgment."""
import json
import time
from pathlib import Path
from scripts.verdicts import (
    read_verdicts,
    write_verdict,
    mark_acknowledged,
    expire_stale,
    clear_verdicts,
    DEFAULT_VERDICT_TTL,
)


def _make_verdict(**overrides):
    base = {
        "ts": int(time.time()),
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Plan says step 3 but Claude is on step 5",
        "correction": "Go back to step 3.",
        "affected_files": ["scripts/buddha.py"],
        "acknowledged": False,
    }
    base.update(overrides)
    return base


def test_write_and_read_verdict(tmp_path):
    path = tmp_path / "verdicts.json"
    v = _make_verdict()
    write_verdict(path, v, session_id="sess-1")
    data = read_verdicts(path)
    assert data["session_id"] == "sess-1"
    assert len(data["active_verdicts"]) == 1
    assert data["active_verdicts"][0]["verdict"] == "plan-drift"


def test_write_verdict_appends(tmp_path):
    path = tmp_path / "verdicts.json"
    write_verdict(path, _make_verdict(verdict="plan-drift"), session_id="sess-1")
    write_verdict(path, _make_verdict(verdict="missed-callers"), session_id="sess-1")
    data = read_verdicts(path)
    assert len(data["active_verdicts"]) == 2


def test_read_verdicts_missing_file(tmp_path):
    path = tmp_path / "does_not_exist.json"
    data = read_verdicts(path)
    assert data["active_verdicts"] == []


def test_read_verdicts_corrupt_file(tmp_path):
    path = tmp_path / "verdicts.json"
    path.write_text("{not valid json")
    data = read_verdicts(path)
    assert data["active_verdicts"] == []


def test_mark_acknowledged(tmp_path):
    path = tmp_path / "verdicts.json"
    write_verdict(path, _make_verdict(ts=100), session_id="sess-1")
    write_verdict(path, _make_verdict(ts=200), session_id="sess-1")
    mark_acknowledged(path, ts=100)
    data = read_verdicts(path)
    assert data["active_verdicts"][0]["acknowledged"] is True
    assert data["active_verdicts"][1]["acknowledged"] is False


def test_expire_stale(tmp_path):
    path = tmp_path / "verdicts.json"
    old_ts = int(time.time()) - DEFAULT_VERDICT_TTL - 10
    write_verdict(path, _make_verdict(ts=old_ts), session_id="sess-1")
    write_verdict(path, _make_verdict(), session_id="sess-1")
    expire_stale(path)
    data = read_verdicts(path)
    assert len(data["active_verdicts"]) == 1


def test_clear_verdicts(tmp_path):
    path = tmp_path / "verdicts.json"
    write_verdict(path, _make_verdict(), session_id="sess-1")
    clear_verdicts(path)
    data = read_verdicts(path)
    assert data["active_verdicts"] == []


def test_write_verdict_creates_parent_dirs(tmp_path):
    path = tmp_path / "nested" / "verdicts.json"
    write_verdict(path, _make_verdict(), session_id="sess-1")
    assert path.exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_verdicts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.verdicts'`

- [ ] **Step 3: Implement verdicts module**

```python
# scripts/verdicts.py
"""Verdict I/O for the judge system.

Verdicts are stored in a single JSON file with atomic writes.
The PreToolUse hook reads this file; the judge worker writes to it.
"""
import json
import os
import tempfile
import time
from pathlib import Path

DEFAULT_VERDICT_TTL = 1800  # 30 minutes


def read_verdicts(path: Path) -> dict:
    """Read verdicts file. Returns empty structure on any failure."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "active_verdicts" in data:
            return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"session_id": "", "last_updated": 0, "active_verdicts": []}


def write_verdict(path: Path, verdict: dict, session_id: str) -> None:
    """Append a verdict to the verdicts file. Atomic write."""
    try:
        existing = read_verdicts(path)
        existing["session_id"] = session_id
        existing["last_updated"] = int(time.time())
        existing["active_verdicts"].append(verdict)
        _atomic_write(path, existing)
    except Exception:
        pass


def mark_acknowledged(path: Path, ts: int) -> None:
    """Mark a verdict as acknowledged by its timestamp."""
    try:
        data = read_verdicts(path)
        for v in data["active_verdicts"]:
            if v.get("ts") == ts:
                v["acknowledged"] = True
        _atomic_write(path, data)
    except Exception:
        pass


def expire_stale(path: Path, ttl: int = DEFAULT_VERDICT_TTL) -> None:
    """Remove verdicts older than ttl seconds."""
    try:
        data = read_verdicts(path)
        cutoff = int(time.time()) - ttl
        data["active_verdicts"] = [
            v for v in data["active_verdicts"] if v.get("ts", 0) > cutoff
        ]
        _atomic_write(path, data)
    except Exception:
        pass


def clear_verdicts(path: Path) -> None:
    """Remove all verdicts."""
    try:
        _atomic_write(path, {
            "session_id": "",
            "last_updated": int(time.time()),
            "active_verdicts": [],
        })
    except Exception:
        pass


def _atomic_write(path: Path, data: dict) -> None:
    """Write JSON atomically via mkstemp + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=".verdicts-", suffix=".json.tmp", dir=path.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_verdicts.py -v`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/verdicts.py tests/test_verdicts.py
git commit -m "feat(judge): add verdict I/O module with atomic writes"
```

---

### Task 4: Judge client — prompt building and response parsing

**Files:**
- Create: `scripts/judge.py`
- Create: `tests/test_judge.py`

- [ ] **Step 1: Write failing tests for prompt building and response parsing**

```python
# tests/test_judge.py
"""Tests for judge prompt building and response parsing."""
import json
from scripts.judge import build_judge_prompt, parse_judge_response, VALID_VERDICTS


def test_build_prompt_includes_narrative():
    narrative_entries = [
        {"ts": 1000, "type": "goal", "text": "User wants to fix login bug"},
        {"ts": 1001, "type": "action", "text": "Claude read auth.py"},
    ]
    prompt = build_judge_prompt(
        narrative_entries=narrative_entries,
        plan_content="Step 1: fix auth.py",
        project_constraints="Must use atomic writes",
        affected_symbols="auth.py: login(), validate_token()",
        test_state=None,
    )
    assert "fix login bug" in prompt
    assert "Claude read auth.py" in prompt
    assert "Step 1: fix auth.py" in prompt
    assert "atomic writes" in prompt
    assert "login(), validate_token()" in prompt


def test_build_prompt_handles_missing_plan():
    prompt = build_judge_prompt(
        narrative_entries=[{"ts": 1, "type": "action", "text": "did stuff"}],
        plan_content=None,
        project_constraints="",
        affected_symbols="",
        test_state=None,
    )
    assert "No active plan found" in prompt


def test_build_prompt_handles_compact_entry():
    entries = [
        {"ts": 1, "type": "compact", "text": "[SUMMARY] Did 50 things."},
        {"ts": 2, "type": "action", "text": "Claude edited state.py"},
    ]
    prompt = build_judge_prompt(
        narrative_entries=entries,
        plan_content=None,
        project_constraints="",
        affected_symbols="",
        test_state=None,
    )
    assert "[SUMMARY] Did 50 things." in prompt
    assert "Claude edited state.py" in prompt


def test_parse_response_valid_ok():
    raw = json.dumps({
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_files": [],
    })
    result = parse_judge_response(raw)
    assert result["verdict"] == "ok"
    assert result["severity"] == "info"


def test_parse_response_valid_blocking():
    raw = json.dumps({
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Plan says step 3 but working on step 5",
        "correction": "Go back to step 3",
        "affected_files": ["scripts/buddha.py"],
    })
    result = parse_judge_response(raw)
    assert result["verdict"] == "plan-drift"
    assert result["severity"] == "blocking"
    assert "step 3" in result["evidence"]


def test_parse_response_invalid_json():
    result = parse_judge_response("not json at all")
    assert result["verdict"] == "ok"
    assert result["severity"] == "info"


def test_parse_response_unknown_verdict_normalized():
    raw = json.dumps({
        "verdict": "something-weird",
        "severity": "blocking",
        "evidence": "x",
        "correction": "y",
        "affected_files": [],
    })
    result = parse_judge_response(raw)
    assert result["verdict"] == "ok"


def test_parse_response_unknown_severity_normalized():
    raw = json.dumps({
        "verdict": "plan-drift",
        "severity": "catastrophic",
        "evidence": "x",
        "correction": "y",
        "affected_files": [],
    })
    result = parse_judge_response(raw)
    assert result["severity"] == "info"


def test_valid_verdicts_set():
    assert "ok" in VALID_VERDICTS
    assert "plan-drift" in VALID_VERDICTS
    assert "doc-drift" in VALID_VERDICTS
    assert "missed-callers" in VALID_VERDICTS
    assert "missed-consideration" in VALID_VERDICTS
    assert "scope-creep" in VALID_VERDICTS
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_judge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.judge'`

- [ ] **Step 3: Implement judge module**

```python
# scripts/judge.py
"""LLM judge client — prompt building, API call, response parsing.

Calls any OpenAI-compatible chat completions endpoint. No SDK dependency.
"""
import json
import os

VALID_VERDICTS = {
    "ok", "plan-drift", "doc-drift", "missed-callers",
    "missed-consideration", "scope-creep",
}
VALID_SEVERITIES = {"info", "warning", "blocking"}

SYSTEM_PROMPT = "You are a code review judge for an active coding session. Respond with JSON only."

JUDGE_TEMPLATE = """Evaluate whether the most recent actions in this coding session have issues.

SESSION NARRATIVE:
{narrative}

ACTIVE PLAN:
{plan}

PROJECT CONSTRAINTS:
{constraints}

AFFECTED SYMBOLS:
{symbols}

RECENT TEST STATE:
{tests}

Check for:
1. Plan drift — working on wrong step, skipping steps, diverging from plan
2. Doc drift — contradicting project conventions, gotchas, architecture docs
3. Missed callers — editing a function/symbol without updating its call sites
4. Missed consideration — ignoring a relevant gotcha or constraint
5. Scope creep — doing work not in the plan or user request

Respond with JSON only:
{{
  "verdict": "ok|plan-drift|doc-drift|missed-callers|missed-consideration|scope-creep",
  "severity": "info|warning|blocking",
  "evidence": "what specifically is wrong — cite the constraint or plan step",
  "correction": "what should be done instead",
  "affected_files": ["file paths"]
}}

Rules:
- Multi-step workflows are normal. Reading before writing is not drift.
- Preparation steps (reading files, listing symbols) are not scope creep.
- Only flag REAL issues with specific evidence. When in doubt, verdict is "ok".
- "blocking" severity only for clear plan contradictions or missed callers that will cause bugs.
- "warning" for style/convention issues. "info" for minor observations.
"""


def build_judge_prompt(
    narrative_entries: list[dict],
    plan_content: str | None,
    project_constraints: str,
    affected_symbols: str,
    test_state: dict | None,
) -> str:
    """Build the judge prompt from narrative + context."""
    narrative_lines = []
    for entry in narrative_entries:
        prefix = f"[{entry.get('type', '?')}]"
        narrative_lines.append(f"{prefix} {entry.get('text', '')}")
    narrative_text = "\n".join(narrative_lines) if narrative_lines else "No narrative yet"

    plan_text = plan_content or "No active plan found"
    constraints_text = project_constraints or "No project constraints loaded"
    symbols_text = affected_symbols or "No affected symbols identified"

    if test_state and test_state.get("passed") is not None:
        test_text = (
            f"Passed: {test_state.get('passed', 0)}, "
            f"Failed: {test_state.get('failed', 0)}"
        )
    else:
        test_text = "No recent tests"

    return JUDGE_TEMPLATE.format(
        narrative=narrative_text,
        plan=plan_text,
        constraints=constraints_text,
        symbols=symbols_text,
        tests=test_text,
    )


def parse_judge_response(raw: str) -> dict:
    """Parse LLM response JSON. Returns safe defaults on any failure."""
    default = {
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_files": [],
    }
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default

    if not isinstance(parsed, dict):
        return default

    verdict = parsed.get("verdict", "ok")
    if verdict not in VALID_VERDICTS:
        verdict = "ok"

    severity = parsed.get("severity", "info")
    if severity not in VALID_SEVERITIES:
        severity = "info"

    return {
        "verdict": verdict,
        "severity": severity,
        "evidence": str(parsed.get("evidence", "")),
        "correction": str(parsed.get("correction", "")),
        "affected_files": list(parsed.get("affected_files", [])),
    }


def call_judge_llm(prompt: str) -> str:
    """Call the OpenAI-compatible LLM endpoint. Returns raw response text.

    Raises on failure — caller must handle exceptions.
    """
    import requests

    api_url = os.environ.get("BUDDY_JUDGE_API_URL", "")
    model = os.environ.get("BUDDY_JUDGE_MODEL", "")
    api_key = os.environ.get("BUDDY_JUDGE_API_KEY", "")

    if not api_url or not model:
        raise RuntimeError("BUDDY_JUDGE_API_URL and BUDDY_JUDGE_MODEL must be set")

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = api_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 1000,
    }

    resp = requests.post(url, json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_judge.py -v`
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/judge.py tests/test_judge.py
git commit -m "feat(judge): add LLM judge client with prompt builder and response parser"
```

---

### Task 5: Judge worker — background process entry point

**Files:**
- Create: `scripts/judge_worker.py`
- Create: `tests/test_judge_worker.py`

- [ ] **Step 1: Write failing tests for context assembly and worker logic**

```python
# tests/test_judge_worker.py
"""Tests for the judge worker — context assembly and end-to-end flow."""
import json
import time
from pathlib import Path
from unittest.mock import patch, MagicMock
from scripts.judge_worker import assemble_context, run_judge, format_action_entry
from scripts.narrative import append_entry


def test_format_action_entry_edit():
    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": "/home/user/project/scripts/buddha.py"},
    }
    result = format_action_entry(event)
    assert "Edit" in result
    assert "scripts/buddha.py" in result


def test_format_action_entry_bash():
    event = {
        "tool_name": "Bash",
        "tool_input": {"command": "pytest tests/ -v"},
    }
    result = format_action_entry(event)
    assert "Bash" in result
    assert "pytest" in result


def test_format_action_entry_unknown_tool():
    event = {"tool_name": "SomeTool"}
    result = format_action_entry(event)
    assert "SomeTool" in result


def test_assemble_context_reads_narrative(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "goal", "Fix the bug")
    append_entry(narrative_path, "action", "Read auth.py")

    ctx = assemble_context(
        narrative_path=narrative_path,
        project_root=tmp_path,
    )
    assert len(ctx["narrative_entries"]) == 2
    assert ctx["narrative_entries"][0]["text"] == "Fix the bug"


def test_assemble_context_loads_plan(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "something")

    plans_dir = tmp_path / "docs" / "superpowers" / "plans"
    plans_dir.mkdir(parents=True)
    (plans_dir / "2026-04-14-feature.md").write_text("# Plan\nStep 1: do thing")

    ctx = assemble_context(
        narrative_path=narrative_path,
        project_root=tmp_path,
    )
    assert "Step 1: do thing" in ctx["plan_content"]


def test_assemble_context_no_plan(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    append_entry(narrative_path, "action", "something")
    ctx = assemble_context(
        narrative_path=narrative_path,
        project_root=tmp_path,
    )
    assert ctx["plan_content"] is None


def test_run_judge_writes_verdict(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"
    append_entry(narrative_path, "action", "Claude edited buddha.py")

    mock_response = json.dumps({
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Wrong step",
        "correction": "Go back",
        "affected_files": ["buddha.py"],
    })

    with patch("scripts.judge.call_judge_llm", return_value=mock_response):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 1
    assert data["active_verdicts"][0]["verdict"] == "plan-drift"


def test_run_judge_skips_on_ok_verdict(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"
    append_entry(narrative_path, "action", "Claude read a file")

    mock_response = json.dumps({
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_files": [],
    })

    with patch("scripts.judge.call_judge_llm", return_value=mock_response):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 0


def test_run_judge_silent_on_llm_failure(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"
    append_entry(narrative_path, "action", "something")

    with patch("scripts.judge.call_judge_llm", side_effect=RuntimeError("API down")):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="test-sess",
        )

    from scripts.verdicts import read_verdicts
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_judge_worker.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.judge_worker'`

- [ ] **Step 3: Implement judge worker**

```python
# scripts/judge_worker.py
"""Background judge worker — assembles context, calls LLM, writes verdicts.

Intended to be spawned as a detached subprocess by the PostToolUse hook.
Usage: python3 -m scripts.judge_worker <narrative_path> <verdicts_path> <project_root> <session_id>
"""
import glob
import os
import sys
import time
from pathlib import Path

from scripts.narrative import read_narrative, compact_narrative, MAX_ENTRIES_BEFORE_COMPACT
from scripts.judge import build_judge_prompt, parse_judge_response, call_judge_llm
from scripts.verdicts import write_verdict


def format_action_entry(event: dict) -> str:
    """Format a PostToolUse event into a one-line narrative action."""
    tool = event.get("tool_name", "Unknown")
    tool_input = event.get("tool_input") or {}

    if tool in ("Edit", "Write", "NotebookEdit"):
        file_path = tool_input.get("file_path", "unknown file")
        # Shorten to last 3 path components
        parts = Path(file_path).parts
        short = "/".join(parts[-3:]) if len(parts) > 3 else file_path
        return f"Claude {tool} {short}"

    if tool == "Bash":
        command = tool_input.get("command", "")
        short_cmd = command[:80] + ("..." if len(command) > 80 else "")
        return f"Claude Bash: {short_cmd}"

    if tool == "Read":
        file_path = tool_input.get("file_path", "unknown file")
        parts = Path(file_path).parts
        short = "/".join(parts[-3:]) if len(parts) > 3 else file_path
        return f"Claude Read {short}"

    return f"Claude {tool}"


def assemble_context(
    narrative_path: Path,
    project_root: Path,
) -> dict:
    """Gather all context the judge needs."""
    narrative_entries = read_narrative(narrative_path)

    # Find most recent plan file
    plan_content = None
    plan_dirs = [
        project_root / "docs" / "superpowers" / "plans",
        project_root / "docs" / "superpowers" / "specs",
    ]
    plan_files = []
    for d in plan_dirs:
        if d.is_dir():
            plan_files.extend(sorted(d.glob("*.md"), reverse=True))
    if plan_files:
        try:
            plan_content = plan_files[0].read_text(encoding="utf-8")[:4000]
        except Exception:
            pass

    # Load project constraints from codescout memories
    constraints_parts = []
    memory_dir = project_root / ".codescout" / "memory"
    for name in ("conventions", "gotchas", "architecture"):
        mem_file = memory_dir / f"{name}.md"
        if mem_file.exists():
            try:
                constraints_parts.append(
                    f"### {name}\n{mem_file.read_text(encoding='utf-8')[:1500]}"
                )
            except Exception:
                pass
    project_constraints = "\n\n".join(constraints_parts)

    # Extract edited files from recent narrative to identify affected symbols
    affected_symbols = ""
    edited_files = []
    for entry in narrative_entries[-10:]:
        text = entry.get("text", "")
        if "Edit " in text or "Write " in text:
            # Extract file path (last token after Edit/Write)
            parts = text.split()
            for i, p in enumerate(parts):
                if p in ("Edit", "Write") and i + 1 < len(parts):
                    edited_files.append(parts[i + 1])
    if edited_files:
        affected_symbols = "Recently edited: " + ", ".join(set(edited_files))

    # Test state from buddy state
    test_state = None
    state_path = Path.home() / ".claude" / "buddy" / "state.json"
    try:
        import json
        with open(state_path) as f:
            state = json.load(f)
        test_state = state.get("signals", {}).get("last_test_result")
    except Exception:
        pass

    return {
        "narrative_entries": narrative_entries,
        "plan_content": plan_content,
        "project_constraints": project_constraints,
        "affected_symbols": affected_symbols,
        "test_state": test_state,
    }


def run_judge(
    narrative_path: Path,
    verdicts_path: Path,
    project_root: Path,
    session_id: str,
) -> None:
    """Run the full judge cycle: assemble, compact, call LLM, write verdict."""
    try:
        ctx = assemble_context(narrative_path, project_root)

        if not ctx["narrative_entries"]:
            return

        # Compact if needed — ask LLM to summarize old entries
        entries = ctx["narrative_entries"]
        if len(entries) > MAX_ENTRIES_BEFORE_COMPACT:
            old_text = "\n".join(
                e.get("text", "") for e in entries[:-10]
            )
            try:
                summary = call_judge_llm(
                    f"Summarize this coding session narrative in 2-3 sentences:\n{old_text}"
                )
                compact_narrative(narrative_path, summary=summary)
                # Re-read after compaction
                ctx["narrative_entries"] = read_narrative(narrative_path)
            except Exception:
                pass

        # Build prompt and call judge
        prompt = build_judge_prompt(
            narrative_entries=ctx["narrative_entries"],
            plan_content=ctx["plan_content"],
            project_constraints=ctx["project_constraints"],
            affected_symbols=ctx["affected_symbols"],
            test_state=ctx["test_state"],
        )

        raw_response = call_judge_llm(prompt)
        result = parse_judge_response(raw_response)

        # Only write non-ok verdicts
        if result["verdict"] != "ok":
            verdict = {
                "ts": int(time.time()),
                "verdict": result["verdict"],
                "severity": result["severity"],
                "evidence": result["evidence"],
                "correction": result["correction"],
                "affected_files": result["affected_files"],
                "acknowledged": False,
            }
            write_verdict(verdicts_path, verdict, session_id=session_id)

    except Exception:
        # Silent on failure — never break the user's flow
        pass


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(0)
    run_judge(
        narrative_path=Path(sys.argv[1]),
        verdicts_path=Path(sys.argv[2]),
        project_root=Path(sys.argv[3]),
        session_id=sys.argv[4],
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_judge_worker.py -v`
Expected: all 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/judge_worker.py tests/test_judge_worker.py
git commit -m "feat(judge): add background judge worker with context assembly"
```

---

### Task 6: State and mood integration — new signals and moods

**Files:**
- Modify: `scripts/state.py:14-32` — add judge signals to `default_state()`
- Modify: `scripts/buddha.py:26-86` — add `drifting` and `broken` moods
- Modify: `tests/test_buddha.py` — add tests for new moods
- Modify: `tests/test_state.py` — update test for new default fields

- [ ] **Step 1: Write failing tests for new moods**

Append to `tests/test_buddha.py`:

```python
def test_mood_drifting_on_plan_drift(base_signals):
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "plan-drift"
    sig["judge_severity"] = "blocking"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "drifting"
    assert specialist == "planning-crane"


def test_mood_drifting_on_scope_creep(base_signals):
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "scope-creep"
    sig["judge_severity"] = "warning"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "drifting"


def test_mood_broken_on_missed_callers(base_signals):
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "missed-callers"
    sig["judge_severity"] = "blocking"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "broken"
    assert specialist == "debugging-yeti"


def test_mood_broken_on_missed_consideration(base_signals):
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "missed-consideration"
    sig["judge_severity"] = "warning"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "broken"


def test_mood_full_context_beats_drifting(base_signals):
    """full-context is priority 1, drifting is priority 2."""
    now = 1_000_000
    sig = base_signals(now)
    sig["context_pct"] = 85
    sig["judge_verdict"] = "plan-drift"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "full-context"


def test_mood_drifting_beats_stuck(base_signals):
    """drifting is priority 2, stuck is priority 4."""
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "plan-drift"
    sig["last_test_result"] = {"ts": now - 60, "passed": 0, "failed": 5}
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "drifting"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_buddha.py::test_mood_drifting_on_plan_drift -v`
Expected: FAIL — `base_signals` fixture doesn't include `judge_verdict` key; `derive_mood` doesn't check it

- [ ] **Step 3: Update `default_state()` in `scripts/state.py`**

Add judge signals to the signals dict in `default_state()`:

```python
# In default_state(), add these to the "signals" dict after "idle_ts":
            "judge_verdict": None,
            "judge_severity": None,
            "judge_block_count": 0,
            "judge_last_ts": 0,
```

- [ ] **Step 4: Update `base_signals()` in `tests/test_buddha.py`**

Add the new signal fields to the test fixture:

```python
# In base_signals(), add after "idle_ts":
        "judge_verdict": None,
        "judge_severity": None,
        "judge_block_count": 0,
        "judge_last_ts": 0,
```

- [ ] **Step 5: Add `drifting` and `broken` moods to `derive_mood()` in `scripts/buddha.py`**

Insert after the `full-context` check (after line 31) and before the `stuck` check:

```python
    # Priority 2: drifting — judge detected plan/doc/scope issues
    judge_verdict = signals.get("judge_verdict")
    if judge_verdict in ("plan-drift", "doc-drift", "scope-creep"):
        return ("drifting", "planning-crane")

    # Priority 3: broken — judge detected structural issues
    if judge_verdict in ("missed-callers", "missed-consideration"):
        return ("broken", "debugging-yeti")
```

- [ ] **Step 6: Run all buddha tests**

Run: `pytest tests/test_buddha.py -v`
Expected: all tests PASS (existing + 6 new)

- [ ] **Step 7: Run state tests**

Run: `pytest tests/test_state.py -v`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add scripts/state.py scripts/buddha.py tests/test_buddha.py
git commit -m "feat(judge): add drifting and broken moods to derive_mood waterfall"
```

---

### Task 7: Data catalogs — eyes and environment for new moods

**Files:**
- Modify: `data/bodhisattvas.json` — add `drifting` and `broken` eyes per form
- Modify: `data/environment.json` — add `drifting` and `broken` strips
- Modify: `tests/test_data_catalogs.py:7-9` — add new moods to `REQUIRED_MOODS`

- [ ] **Step 1: Update `REQUIRED_MOODS` in `tests/test_data_catalogs.py`**

Change line 7-9 to:

```python
REQUIRED_MOODS = {
    "flow", "stuck", "test-streak", "late-night", "full-context",
    "long-session", "victorious", "exploratory", "idle", "racing",
    "drifting", "broken",
}
```

- [ ] **Step 2: Run catalog tests to see them fail**

Run: `pytest tests/test_data_catalogs.py -v`
Expected: FAIL — `drifting` and `broken` missing from data files

- [ ] **Step 3: Add environment strips to `data/environment.json`**

Add two entries:

```json
  "drifting":     "  ~?~?~",
  "broken":       "  ╳─╳─╳"
```

- [ ] **Step 4: Add eyes to `data/bodhisattvas.json`**

For every form, add two entries to the `"eyes"` object. Use these per-form patterns:

**3-char eye forms** (owl, doe, hare, cloud, bell-sprite — forms using `{eyes}` with punctuation like `°‿°`):
```json
"drifting": "?_?",
"broken":   "x_x"
```

**2-char eye forms** (turtle, lotus, flag-sprite, stone-cub, sky-fox — forms using `{eyes}` with 2 chars like `‿‿`):
```json
"drifting": "??",
"broken":   "xx"
```

- [ ] **Step 5: Run catalog tests**

Run: `pytest tests/test_data_catalogs.py -v`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add data/bodhisattvas.json data/environment.json tests/test_data_catalogs.py
git commit -m "feat(judge): add drifting and broken moods to data catalogs"
```

---

### Task 8: PreToolUse hook

**Files:**
- Create: `hooks/pre-tool-use.sh`
- Modify: `hooks/hooks.json`
- Create: `tests/test_pre_tool_use.py`

- [ ] **Step 1: Write failing tests for the gate logic**

```python
# tests/test_pre_tool_use.py
"""Tests for the PreToolUse gate — verdict reading and blocking decision."""
import json
import time
from pathlib import Path
from scripts.pre_tool_gate import should_block, build_correction_message


def _verdicts_file(tmp_path, verdicts):
    path = tmp_path / "verdicts.json"
    data = {
        "session_id": "test",
        "last_updated": int(time.time()),
        "active_verdicts": verdicts,
    }
    path.write_text(json.dumps(data))
    return path


def test_should_block_on_blocking_verdict(tmp_path):
    path = _verdicts_file(tmp_path, [{
        "ts": int(time.time()),
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Wrong step",
        "correction": "Fix it",
        "affected_files": ["a.py"],
        "acknowledged": False,
    }])
    blocked, verdicts = should_block(path)
    assert blocked is True
    assert len(verdicts) == 1


def test_should_not_block_on_warning(tmp_path):
    path = _verdicts_file(tmp_path, [{
        "ts": int(time.time()),
        "verdict": "doc-drift",
        "severity": "warning",
        "evidence": "Style issue",
        "correction": "Consider fixing",
        "affected_files": [],
        "acknowledged": False,
    }])
    blocked, verdicts = should_block(path)
    assert blocked is False


def test_should_not_block_on_acknowledged(tmp_path):
    path = _verdicts_file(tmp_path, [{
        "ts": int(time.time()),
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Wrong step",
        "correction": "Fix it",
        "affected_files": [],
        "acknowledged": True,
    }])
    blocked, verdicts = should_block(path)
    assert blocked is False


def test_should_not_block_on_stale(tmp_path):
    old_ts = int(time.time()) - 2000  # older than 30 min
    path = _verdicts_file(tmp_path, [{
        "ts": old_ts,
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "Old issue",
        "correction": "Was relevant",
        "affected_files": [],
        "acknowledged": False,
    }])
    blocked, verdicts = should_block(path)
    assert blocked is False


def test_should_not_block_missing_file(tmp_path):
    path = tmp_path / "nope.json"
    blocked, verdicts = should_block(path)
    assert blocked is False


def test_build_correction_message():
    verdicts = [{
        "verdict": "missed-callers",
        "severity": "blocking",
        "evidence": "derive_mood() changed but render() not updated",
        "correction": "Update render() in statusline.py",
        "affected_files": ["scripts/buddha.py", "scripts/statusline.py"],
    }]
    msg = build_correction_message(verdicts)
    assert "MISSED-CALLERS" in msg
    assert "derive_mood()" in msg
    assert "Update render()" in msg


def test_build_correction_message_multiple():
    verdicts = [
        {"verdict": "plan-drift", "severity": "blocking",
         "evidence": "Wrong step", "correction": "Go back",
         "affected_files": []},
        {"verdict": "missed-callers", "severity": "blocking",
         "evidence": "Callers broken", "correction": "Fix callers",
         "affected_files": ["a.py"]},
    ]
    msg = build_correction_message(verdicts)
    assert "PLAN-DRIFT" in msg
    assert "MISSED-CALLERS" in msg
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pre_tool_use.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.pre_tool_gate'`

- [ ] **Step 3: Implement pre-tool gate module**

```python
# scripts/pre_tool_gate.py
"""PreToolUse gate — reads cached verdicts and decides whether to block Claude.

Used by hooks/pre-tool-use.sh. Never calls an LLM. Must stay under 10ms.
"""
import json
import time
from pathlib import Path

from scripts.verdicts import read_verdicts, DEFAULT_VERDICT_TTL


def should_block(
    verdicts_path: Path,
    min_severity: str = "blocking",
    ttl: int = DEFAULT_VERDICT_TTL,
) -> tuple[bool, list[dict]]:
    """Check if any unacknowledged blocking verdicts exist.

    Returns (should_block, list_of_blocking_verdicts).
    """
    try:
        data = read_verdicts(verdicts_path)
        cutoff = int(time.time()) - ttl

        blocking = []
        for v in data.get("active_verdicts", []):
            if v.get("acknowledged"):
                continue
            if v.get("ts", 0) <= cutoff:
                continue
            if v.get("severity") == min_severity:
                blocking.append(v)

        return (len(blocking) > 0, blocking)
    except Exception:
        return (False, [])


def build_correction_message(verdicts: list[dict]) -> str:
    """Build the stderr message that Claude will see when blocked."""
    if len(verdicts) == 1:
        v = verdicts[0]
        header = f"BUDDY: {v['verdict'].upper()} DETECTED"
        return (
            f"{header}\n\n"
            f"{v.get('evidence', '')}\n\n"
            f"{v.get('correction', '')}\n\n"
            f"Fix this before continuing, then proceed with your task."
        )

    lines = [f"BUDDY: {len(verdicts)} ISSUES DETECTED\n"]
    for i, v in enumerate(verdicts, 1):
        lines.append(f"--- {i}. {v['verdict'].upper()} ---")
        lines.append(v.get("evidence", ""))
        lines.append(v.get("correction", ""))
        lines.append("")
    lines.append("Fix all issues before continuing, then proceed with your task.")
    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_pre_tool_use.py -v`
Expected: all 8 tests PASS

- [ ] **Step 5: Create the shell hook**

```bash
# hooks/pre-tool-use.sh
#!/usr/bin/env bash
# PreToolUse hook — reads cached verdicts, blocks Claude via exit(2) if needed.
# Must stay under 10ms. Never calls an LLM.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Only run if judge is enabled
if [ "${BUDDY_JUDGE_ENABLED}" != "true" ]; then
    exit 0
fi

python3 -c "
import sys, json
sys.path.insert(0, '$PLUGIN_ROOT')
from pathlib import Path
from scripts.pre_tool_gate import should_block, build_correction_message

verdicts_path = Path.home() / '.claude' / 'buddy' / 'verdicts.json'
blocked, verdicts = should_block(verdicts_path)
if blocked:
    msg = build_correction_message(verdicts)
    print(msg, file=sys.stderr)
    sys.exit(2)
" || true
```

- [ ] **Step 6: Update `hooks/hooks.json`**

Replace the full file content:

```json
{
  "hooks": {
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.sh" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.sh" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.sh" }] }]
  }
}
```

- [ ] **Step 7: Make hook executable and run tests**

```bash
chmod +x hooks/pre-tool-use.sh
pytest tests/test_pre_tool_use.py -v
```
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add scripts/pre_tool_gate.py hooks/pre-tool-use.sh hooks/hooks.json tests/test_pre_tool_use.py
git commit -m "feat(judge): add PreToolUse gate hook with exit(2) blocking"
```

---

### Task 9: PostToolUse hook integration — narrative accumulation + judge spawning

**Files:**
- Modify: `scripts/hook_helpers.py:44-76` — add `accumulate_narrative()`, call it from `handle_post_tool_use()`
- Modify: `hooks/post-tool-use.sh` — pass transcript_path and session_id
- Create: `tests/test_hook_accumulate.py`

- [ ] **Step 1: Write failing tests for narrative accumulation**

```python
# tests/test_hook_accumulate.py
"""Tests for narrative accumulation in PostToolUse hook."""
import json
import time
from pathlib import Path
from unittest.mock import patch, MagicMock
from scripts.hook_helpers import accumulate_narrative
from scripts.narrative import read_narrative


def test_accumulate_appends_action(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    event = {
        "tool_name": "Edit",
        "tool_input": {"file_path": "/home/user/project/scripts/buddha.py"},
        "timestamp": int(time.time()),
    }
    accumulate_narrative(event, narrative_path, project_root=tmp_path, session_id="s1")
    entries = read_narrative(narrative_path)
    assert len(entries) == 1
    assert "Edit" in entries[0]["text"]
    assert "buddha.py" in entries[0]["text"]


def test_accumulate_multiple_calls(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    for i in range(5):
        event = {"tool_name": "Read", "tool_input": {"file_path": f"/f{i}.py"}, "timestamp": int(time.time())}
        accumulate_narrative(event, narrative_path, project_root=tmp_path, session_id="s1")
    entries = read_narrative(narrative_path)
    assert len(entries) == 5


def test_accumulate_spawns_judge_at_interval(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    # Pre-fill with entries so interval triggers
    from scripts.narrative import append_entry
    for i in range(4):
        append_entry(narrative_path, "action", f"Action {i}")

    event = {"tool_name": "Edit", "tool_input": {"file_path": "/x.py"}, "timestamp": int(time.time())}

    with patch("scripts.hook_helpers.subprocess") as mock_sub:
        with patch.dict("os.environ", {"BUDDY_JUDGE_ENABLED": "true", "BUDDY_JUDGE_INTERVAL": "5"}):
            accumulate_narrative(event, narrative_path, project_root=tmp_path, session_id="s1")
        mock_sub.Popen.assert_called_once()


def test_accumulate_no_spawn_when_disabled(tmp_path):
    narrative_path = tmp_path / "narrative.jsonl"
    from scripts.narrative import append_entry
    for i in range(4):
        append_entry(narrative_path, "action", f"Action {i}")

    event = {"tool_name": "Edit", "tool_input": {"file_path": "/x.py"}, "timestamp": int(time.time())}

    with patch("scripts.hook_helpers.subprocess") as mock_sub:
        with patch.dict("os.environ", {"BUDDY_JUDGE_ENABLED": "false"}):
            accumulate_narrative(event, narrative_path, project_root=tmp_path, session_id="s1")
        mock_sub.Popen.assert_not_called()


def test_accumulate_silent_on_failure():
    """Must not raise even with bad inputs."""
    accumulate_narrative({}, Path("/dev/null/impossible"), project_root=Path("/tmp"), session_id="x")
    # No exception = pass
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_hook_accumulate.py -v`
Expected: FAIL — `ImportError: cannot import name 'accumulate_narrative'`

- [ ] **Step 3: Add `accumulate_narrative()` to `scripts/hook_helpers.py`**

Add at the end of the file (after `_parse_test_result`):

```python
import subprocess
from scripts.narrative import append_entry, read_narrative
from scripts.judge_worker import format_action_entry


def accumulate_narrative(
    event: dict,
    narrative_path: Path,
    project_root: Path,
    session_id: str,
) -> None:
    """Append a narrative entry and maybe spawn the judge worker."""
    try:
        action_text = format_action_entry(event)
        append_entry(narrative_path, "action", action_text)

        # Check if we should spawn the judge
        judge_enabled = os.environ.get("BUDDY_JUDGE_ENABLED", "false") == "true"
        if not judge_enabled:
            return

        interval = int(os.environ.get("BUDDY_JUDGE_INTERVAL", "5"))
        entry_count = len(read_narrative(narrative_path))
        if entry_count > 0 and entry_count % interval == 0:
            verdicts_path = narrative_path.parent / "verdicts.json"
            subprocess.Popen(
                [
                    "python3", "-m", "scripts.judge_worker",
                    str(narrative_path),
                    str(verdicts_path),
                    str(project_root),
                    session_id,
                ],
                cwd=str(project_root),
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except Exception:
        pass
```

Also add `import os` at the top of `scripts/hook_helpers.py` if not already present.

- [ ] **Step 4: Update `hooks/post-tool-use.sh`**

Replace the full file:

```bash
#!/usr/bin/env bash
# PostToolUse hook — updates signals + accumulates narrative for judge.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -c "
import sys, json, os
sys.path.insert(0, '$PLUGIN_ROOT')
from pathlib import Path
from scripts.hook_helpers import handle_post_tool_use, accumulate_narrative
event = {}
try:
    event = json.loads(sys.stdin.read() or '{}')
except Exception:
    pass
if 'timestamp' not in event:
    import time
    event['timestamp'] = int(time.time())
state_path = Path.home() / '.claude' / 'buddy' / 'state.json'
handle_post_tool_use(event, path=state_path)
narrative_path = Path.home() / '.claude' / 'buddy' / 'narrative.jsonl'
project_root = Path(event.get('cwd') or os.getcwd())
session_id = event.get('session_id', 'unknown')
accumulate_narrative(event, narrative_path, project_root=project_root, session_id=session_id)
" || true
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_hook_accumulate.py -v`
Expected: all 5 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `pytest -v`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/hook_helpers.py hooks/post-tool-use.sh tests/test_hook_accumulate.py
git commit -m "feat(judge): integrate narrative accumulation into PostToolUse hook"
```

---

### Task 10: SessionStart hook — clear narrative and verdicts

**Files:**
- Modify: `scripts/hook_helpers.py` — add clearing logic to `handle_session_start()`
- Modify: `hooks/session-start.sh` — call clearing
- Modify: `tests/test_hook_helpers.py` — add test for narrative/verdict clearing

- [ ] **Step 1: Write failing test**

Append to `tests/test_hook_helpers.py`:

```python
from scripts.narrative import append_entry, read_narrative
from scripts.verdicts import write_verdict, read_verdicts


def test_session_start_clears_narrative_and_verdicts(tmp_path):
    state_path = tmp_path / "state.json"
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"

    # Pre-fill narrative and verdicts
    append_entry(narrative_path, "action", "old stuff")
    write_verdict(verdicts_path, {
        "ts": 1, "verdict": "plan-drift", "severity": "blocking",
        "evidence": "x", "correction": "y", "affected_files": [],
        "acknowledged": False,
    }, session_id="old-sess")

    event = {"timestamp": 1_000_000}
    from scripts.hook_helpers import handle_session_start
    handle_session_start(event, path=state_path,
                         narrative_path=narrative_path,
                         verdicts_path=verdicts_path)

    assert read_narrative(narrative_path) == []
    assert read_verdicts(verdicts_path)["active_verdicts"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_hook_helpers.py::test_session_start_clears_narrative_and_verdicts -v`
Expected: FAIL — `handle_session_start() got unexpected keyword argument 'narrative_path'`

- [ ] **Step 3: Update `handle_session_start()` in `scripts/hook_helpers.py`**

Change the signature and add clearing:

```python
def handle_session_start(
    event: dict,
    path: Path,
    narrative_path: Path | None = None,
    verdicts_path: Path | None = None,
) -> None:
    try:
        state = load_state(path)
        ts = int(event.get("timestamp") or 0)
        for field in _SESSION_SCOPED_FIELDS:
            if field == "recent_errors":
                state["signals"][field] = []
            elif field == "last_test_result":
                state["signals"][field] = None
            elif field == "session_start_ts":
                state["signals"][field] = ts
            elif field == "idle_ts":
                state["signals"][field] = ts
            else:
                state["signals"][field] = 0

        # Clear judge signals
        state["signals"]["judge_verdict"] = None
        state["signals"]["judge_severity"] = None
        state["signals"]["judge_block_count"] = 0
        state["signals"]["judge_last_ts"] = 0

        save_state(path, state)

        # Clear narrative and verdicts for new session
        if narrative_path:
            try:
                narrative_path.unlink(missing_ok=True)
            except Exception:
                pass
        if verdicts_path:
            from scripts.verdicts import clear_verdicts
            clear_verdicts(verdicts_path)
    except Exception:
        pass
```

- [ ] **Step 4: Update `hooks/session-start.sh`**

Replace the full file:

```bash
#!/usr/bin/env bash
# SessionStart hook — resets session-scoped state fields + clears judge files.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -c "
import sys, json, os
sys.path.insert(0, '$PLUGIN_ROOT')
from pathlib import Path
from scripts.hook_helpers import handle_session_start
event = {}
try:
    event = json.loads(sys.stdin.read() or '{}')
except Exception:
    pass
if 'timestamp' not in event:
    import time
    event['timestamp'] = int(time.time())
buddy_dir = Path.home() / '.claude' / 'buddy'
handle_session_start(
    event,
    path=buddy_dir / 'state.json',
    narrative_path=buddy_dir / 'narrative.jsonl',
    verdicts_path=buddy_dir / 'verdicts.json',
)
" || true
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_hook_helpers.py -v`
Expected: all PASS

- [ ] **Step 6: Run full test suite**

Run: `pytest -v`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/hook_helpers.py hooks/session-start.sh tests/test_hook_helpers.py
git commit -m "feat(judge): clear narrative and verdicts on session start"
```

---

### Task 11: End-to-end integration test

**Files:**
- Create: `tests/test_judge_integration.py`

- [ ] **Step 1: Write integration test**

```python
# tests/test_judge_integration.py
"""End-to-end integration test for the judge pipeline."""
import json
import time
from pathlib import Path
from unittest.mock import patch
from scripts.narrative import append_entry, read_narrative
from scripts.judge_worker import run_judge
from scripts.verdicts import read_verdicts
from scripts.pre_tool_gate import should_block, build_correction_message


def test_full_pipeline_blocking_verdict(tmp_path):
    """Full flow: narrative → judge → verdict → gate blocks."""
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"

    # Simulate a session with drift
    append_entry(narrative_path, "goal", "User wants to fix login bug in auth.py")
    append_entry(narrative_path, "action", "Claude Edit scripts/buddha.py — changed mood waterfall")
    append_entry(narrative_path, "action", "Claude Edit scripts/statusline.py — refactored render")

    # Mock LLM returns a plan-drift verdict
    mock_response = json.dumps({
        "verdict": "plan-drift",
        "severity": "blocking",
        "evidence": "User asked to fix login bug in auth.py but Claude is editing buddha.py and statusline.py",
        "correction": "Stop editing mood/statusline code. Focus on auth.py as the user requested.",
        "affected_files": ["scripts/buddha.py", "scripts/statusline.py"],
    })

    with patch("scripts.judge.call_judge_llm", return_value=mock_response):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="integration-test",
        )

    # Verify verdict was written
    data = read_verdicts(verdicts_path)
    assert len(data["active_verdicts"]) == 1
    assert data["active_verdicts"][0]["verdict"] == "plan-drift"

    # Verify gate blocks
    blocked, verdicts = should_block(verdicts_path)
    assert blocked is True

    # Verify correction message is readable
    msg = build_correction_message(verdicts)
    assert "PLAN-DRIFT" in msg
    assert "auth.py" in msg


def test_full_pipeline_ok_verdict_no_block(tmp_path):
    """Full flow: narrative → judge → ok → gate allows."""
    narrative_path = tmp_path / "narrative.jsonl"
    verdicts_path = tmp_path / "verdicts.json"

    append_entry(narrative_path, "goal", "User wants to add tests")
    append_entry(narrative_path, "action", "Claude Edit tests/test_foo.py — added test")

    mock_response = json.dumps({
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_files": [],
    })

    with patch("scripts.judge.call_judge_llm", return_value=mock_response):
        run_judge(
            narrative_path=narrative_path,
            verdicts_path=verdicts_path,
            project_root=tmp_path,
            session_id="integration-test",
        )

    blocked, verdicts = should_block(verdicts_path)
    assert blocked is False
```

- [ ] **Step 2: Run integration tests**

Run: `pytest tests/test_judge_integration.py -v`
Expected: all 2 tests PASS

- [ ] **Step 3: Run full test suite one final time**

Run: `pytest -v`
Expected: ALL tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/test_judge_integration.py
git commit -m "test(judge): add end-to-end integration test for judge pipeline"
```
