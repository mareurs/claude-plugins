# Statusline Side-by-Side Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single overflowing label line under the buddy ASCII art with a side-by-side layout that pins segments to fixed slots in the column to the right of the art, with adaptive specialist display and width-aware truncation.

**Architecture:** Single-file rewrite of `buddy/scripts/statusline.py`. New helpers (`_terminal_width`, `_visible_width`, `_format_specialists`, `_compose_segments`, `_compose_rows`) are added. The `render()` function is rewritten to call them. `statusline-composed.sh`, `bodhisattvas.json`, and all hooks remain untouched. Spec: `docs/superpowers/specs/2026-05-22-statusline-side-by-side-design.md`.

**Tech Stack:** Python 3.13+, stdlib only (`os`, `re`, `shutil`). Tests: pytest.

---

## Files

- Modify: `buddy/scripts/statusline.py`
- Create: `buddy/tests/test_statusline_layout.py`
- Untouched but must still pass: `buddy/tests/test_statusline.py`

## Working directory

All paths in this plan are relative to the repo root: `/home/marius/work/claude/claude-plugins`.

Branch: `feat/statusline-side-by-side` (already checked out).

## Editing constraints

`buddy/scripts/statusline.py` is a Python source file — use **codescout MCP tools** (`edit_code` for symbol-level edits, `edit_file` only for non-structural top-of-file insertions like new constants/imports). Do NOT use the native Edit tool on source.

`buddy/tests/test_statusline_layout.py` is created with `create_file`.

Tests run from repo root: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`.

---

### Task 1: Add `_terminal_width` and `_visible_width` helpers + `SPECIALIST_ROLE` constant

**Files:**
- Modify: `buddy/scripts/statusline.py` (add three new top-level items)
- Create: `buddy/tests/test_statusline_layout.py`

- [ ] **Step 1: Write the failing tests**

Create `buddy/tests/test_statusline_layout.py` with this content:

```python
"""Tests for side-by-side statusline layout helpers."""
import os
from unittest import mock

import pytest

from scripts.statusline import (
    SPECIALIST_ROLE,
    _terminal_width,
    _visible_width,
)


def test_specialist_role_covers_all_known_specialists():
    expected = {
        "debugging-yeti",
        "refactoring-yak",
        "testing-snow-leopard",
        "performance-lammergeier",
        "security-ibex",
        "architecture-snow-lion",
        "planning-crane",
        "docs-lotus-frog",
        "data-leakage-snow-pheasant",
        "ml-training-takin",
    }
    assert set(SPECIALIST_ROLE.keys()) == expected


def test_specialist_role_values_are_lowercase_roles():
    assert SPECIALIST_ROLE["debugging-yeti"] == "debugger"
    assert SPECIALIST_ROLE["architecture-snow-lion"] == "architect"
    assert SPECIALIST_ROLE["security-ibex"] == "security"


def test_visible_width_strips_ansi_csi():
    assert _visible_width("\x1b[31mok\x1b[0m") == 2
    assert _visible_width("\x1b[38;5;172m[CAVEMAN]\x1b[0m") == 9
    assert _visible_width("plain") == 5
    assert _visible_width("") == 0


def test_terminal_width_reads_columns_env():
    with mock.patch.dict(os.environ, {"COLUMNS": "120"}, clear=False):
        assert _terminal_width() == 120


def test_terminal_width_falls_back_when_columns_unset(monkeypatch):
    monkeypatch.delenv("COLUMNS", raising=False)
    with mock.patch(
        "scripts.statusline.shutil.get_terminal_size",
        return_value=os.terminal_size((100, 24)),
    ):
        assert _terminal_width() == 100


def test_terminal_width_returns_80_when_shutil_raises(monkeypatch):
    monkeypatch.delenv("COLUMNS", raising=False)
    with mock.patch(
        "scripts.statusline.shutil.get_terminal_size",
        side_effect=OSError(),
    ):
        assert _terminal_width() == 80


def test_terminal_width_ignores_nonpositive_columns(monkeypatch):
    monkeypatch.setenv("COLUMNS", "0")
    with mock.patch(
        "scripts.statusline.shutil.get_terminal_size",
        return_value=os.terminal_size((100, 24)),
    ):
        assert _terminal_width() == 100
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: ImportError / AttributeError — `SPECIALIST_ROLE`, `_terminal_width`, `_visible_width` not defined.

- [ ] **Step 3: Add `shutil` and `re` imports, the `SPECIALIST_ROLE` constant, and the two helpers**

Use `edit_file` on `buddy/scripts/statusline.py`.

Edit 1 — add `import os`, `import re`, and `import shutil` after `import sys` (line 10):

```
old_string: "import json\nimport sys\nimport time"
new_string: "import json\nimport os\nimport re\nimport shutil\nimport sys\nimport time"
```

(`os` was previously imported lazily inside `main()`; promote it to module scope so `_terminal_width` can read `os.environ` without redundant local imports. The lazy `import os` inside `main()` can stay — Python deduplicates.)

Edit 2 — add the `SPECIALIST_ROLE` dict and helpers after the existing `SPECIALIST_INITIAL` dict. Find the closing `}` of `SPECIALIST_INITIAL` and insert after it:

```
old_string: """SPECIALIST_INITIAL = {
    "debugging-yeti": "D",
    "refactoring-yak": "R",
    "testing-snow-leopard": "T",
    "performance-lammergeier": "P",
    "security-ibex": "S",
    "architecture-snow-lion": "A",
    "planning-crane": "C",
    "docs-lotus-frog": "W",
    "data-leakage-snow-pheasant": "L",
    "ml-training-takin": "M",
}"""

new_string: """SPECIALIST_INITIAL = {
    "debugging-yeti": "D",
    "refactoring-yak": "R",
    "testing-snow-leopard": "T",
    "performance-lammergeier": "P",
    "security-ibex": "S",
    "architecture-snow-lion": "A",
    "planning-crane": "C",
    "docs-lotus-frog": "W",
    "data-leakage-snow-pheasant": "L",
    "ml-training-takin": "M",
}

SPECIALIST_ROLE = {
    "debugging-yeti": "debugger",
    "refactoring-yak": "refactorer",
    "testing-snow-leopard": "tester",
    "performance-lammergeier": "perf",
    "security-ibex": "security",
    "architecture-snow-lion": "architect",
    "planning-crane": "planner",
    "docs-lotus-frog": "docs",
    "data-leakage-snow-pheasant": "leakage",
    "ml-training-takin": "ml",
}

_CSI_RE = re.compile(r"\\x1b\\[[0-9;]*m")


def _visible_width(s: str) -> int:
    return len(_CSI_RE.sub("", s))


def _terminal_width() -> int:
    raw = os.environ.get("COLUMNS")
    if raw:
        try:
            n = int(raw)
            if n > 0:
                return n
        except ValueError:
            pass
    try:
        return shutil.get_terminal_size((80, 24)).columns
    except OSError:
        return 80
"""
```

Note: the `_CSI_RE` regex above uses Python escape sequences. The raw regex pattern is `\x1b\[[0-9;]*m`. When writing the file via `edit_file`, ensure backslashes are preserved literally as written in the source file (the Python source needs `r"\x1b\[[0-9;]*m"` — a raw string).

Final code as it must appear in the file:

```python
_CSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _visible_width(s: str) -> int:
    return len(_CSI_RE.sub("", s))


def _terminal_width() -> int:
    raw = os.environ.get("COLUMNS")
    if raw:
        try:
            n = int(raw)
            if n > 0:
                return n
        except ValueError:
            pass
    try:
        return shutil.get_terminal_size((80, 24)).columns
    except OSError:
        return 80
```

Also add `import os` near the top of the file if not already present (it was previously imported lazily inside `main()` — the module-level promotion is part of Edit 1 above; the lazy import inside `main()` is harmless and can remain).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: 7 pass.

- [ ] **Step 5: Run existing statusline tests to confirm no regression**

Run: `cd buddy && python -m pytest tests/test_statusline.py -v`
Expected: all pre-existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add buddy/scripts/statusline.py buddy/tests/test_statusline_layout.py
git commit -m "feat(buddy): add SPECIALIST_ROLE, _terminal_width, _visible_width helpers"
```

---

### Task 2: Add `_format_specialists` adaptive formatter

**Files:**
- Modify: `buddy/scripts/statusline.py` (new function)
- Modify: `buddy/tests/test_statusline_layout.py` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `buddy/tests/test_statusline_layout.py`:

```python
from scripts.statusline import _format_specialists


def test_format_specialists_empty_returns_empty_string():
    assert _format_specialists([], []) == ""


def test_format_specialists_one_uses_full_label():
    active = ["debugging-yeti"]
    pairs = [("debugging-yeti", "Yeti")]
    assert _format_specialists(active, pairs) == "Yeti"


def test_format_specialists_two_uses_full_labels_comma_joined():
    active = ["debugging-yeti", "testing-snow-leopard"]
    pairs = [("debugging-yeti", "Yeti"), ("testing-snow-leopard", "Snow Leopard")]
    assert _format_specialists(active, pairs) == "Yeti, Snow Leopard"


def test_format_specialists_three_uses_role_names():
    active = [
        "debugging-yeti",
        "testing-snow-leopard",
        "architecture-snow-lion",
    ]
    pairs = [
        ("debugging-yeti", "Yeti"),
        ("testing-snow-leopard", "Snow Leopard"),
        ("architecture-snow-lion", "Snow Lion"),
    ]
    assert _format_specialists(active, pairs) == "debugger, tester, architect"


def test_format_specialists_unknown_slug_falls_back_to_short():
    active = ["debugging-yeti", "testing-snow-leopard", "future-unknown-slug"]
    pairs = [
        ("debugging-yeti", "Yeti"),
        ("testing-snow-leopard", "Snow Leopard"),
        ("future-unknown-slug", "Future"),
    ]
    result = _format_specialists(active, pairs)
    assert result.startswith("debugger, tester, ")
    assert result.endswith("future-unknown-slug")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: ImportError on `_format_specialists`.

- [ ] **Step 3: Add `_format_specialists`**

Use `edit_file` to append the function after `_terminal_width()`:

```
old_string: """def _terminal_width() -> int:
    raw = os.environ.get("COLUMNS")
    if raw:
        try:
            n = int(raw)
            if n > 0:
                return n
        except ValueError:
            pass
    try:
        return shutil.get_terminal_size((80, 24)).columns
    except OSError:
        return 80"""

new_string: """def _terminal_width() -> int:
    raw = os.environ.get("COLUMNS")
    if raw:
        try:
            n = int(raw)
            if n > 0:
                return n
        except ValueError:
            pass
    try:
        return shutil.get_terminal_size((80, 24)).columns
    except OSError:
        return 80


def _format_specialists(active: list[str], pairs: list[tuple[str, str]]) -> str:
    if not active:
        return ""
    if len(active) <= 2:
        labels = [label for _slug, label in pairs] if pairs else list(active)
        return ", ".join(labels)
    return ", ".join(
        SPECIALIST_ROLE.get(slug, SPECIALIST_SHORT.get(slug, slug))
        for slug in active
    )"""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: 12 pass (7 from Task 1 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/statusline.py buddy/tests/test_statusline_layout.py
git commit -m "feat(buddy): add _format_specialists adaptive formatter"
```

---

### Task 3: Add `_compose_rows` layout primitive

**Files:**
- Modify: `buddy/scripts/statusline.py` (new function)
- Modify: `buddy/tests/test_statusline_layout.py` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `buddy/tests/test_statusline_layout.py`:

```python
from scripts.statusline import _compose_rows


def test_compose_rows_basic_side_by_side():
    base = "env\n   .~~.\n  (°‿°)\n   \\_/\n  ~~~~~"
    segments = ["", "Owl · flow", "tester", "", "[ok] plan"]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert lines[0].rstrip() == "env"
    assert "Owl · flow" in lines[1]
    assert "tester" in lines[2]
    # slot 3 empty but art row 3 present → art piece padded, empty right column
    assert lines[3].rstrip() == "   \\_/"
    assert "[ok] plan" in lines[4]


def test_compose_rows_trailing_empty_segments_dropped():
    base = "env\n   .~~.\n  (°‿°)\n   \\_/\n  ~~~~~"
    segments = ["", "Owl · flow", "", "", ""]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert len(lines) == 5
    assert lines[2].rstrip() == "  (°‿°)"
    assert lines[3].rstrip() == "   \\_/"
    assert lines[4].rstrip() == "  ~~~~~"


def test_compose_rows_short_art_more_segments():
    base = "env\nART"
    segments = ["", "slot1", "slot2", "slot3"]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert len(lines) == 4
    assert lines[0].rstrip() == "env"
    assert lines[1].endswith("slot1")
    assert lines[2].endswith("slot2")
    assert lines[3].endswith("slot3")
    assert "ART" in lines[1]


def test_compose_rows_tall_art_few_segments():
    base = "env\n.\n.\n.\n.\n."
    segments = ["", "slot1", "slot2"]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert len(lines) == 6


def test_compose_rows_truncates_specialists_first():
    base = "env\nA\nB\nC"
    long_specialists = "architect, tester, security, perf, debugger, refactorer"
    short_recon = "[recon]"
    short_verdict = "[ok] go"
    segments = ["", "form · mood", long_specialists, short_recon]
    output = _compose_rows(base, segments, term_w=30)
    lines = output.split("\n")
    spec_line = lines[2]
    assert "…" in spec_line
    assert "[recon]" in lines[3]


def test_compose_rows_truncated_visible_width_within_budget():
    base = "env\nABC"
    long = "x" * 200
    segments = ["", long]
    output = _compose_rows(base, segments, term_w=40)
    lines = output.split("\n")
    assert _visible_width(lines[1]) <= 40


def test_compose_rows_no_trailing_newline():
    base = "env\nA"
    segments = ["", "slot1"]
    output = _compose_rows(base, segments, term_w=200)
    assert not output.endswith("\n")


def test_compose_rows_empty_middle_slot_preserves_pinning():
    base = "env\nA\nB\nC\nD"
    segments = ["", "form", "", "[recon]", "[ok]"]
    output = _compose_rows(base, segments, term_w=200)
    lines = output.split("\n")
    assert lines[2].rstrip() == "A"
    assert "[recon]" in lines[3]
    assert "[ok]" in lines[4]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: ImportError on `_compose_rows`.

- [ ] **Step 3: Implement `_compose_rows`**

Use `edit_file` to append after `_format_specialists`:

```
old_string: """def _format_specialists(active: list[str], pairs: list[tuple[str, str]]) -> str:
    if not active:
        return ""
    if len(active) <= 2:
        labels = [label for _slug, label in pairs] if pairs else list(active)
        return ", ".join(labels)
    return ", ".join(
        SPECIALIST_ROLE.get(slug, SPECIALIST_SHORT.get(slug, slug))
        for slug in active
    )"""

new_string: """def _format_specialists(active: list[str], pairs: list[tuple[str, str]]) -> str:
    if not active:
        return ""
    if len(active) <= 2:
        labels = [label for _slug, label in pairs] if pairs else list(active)
        return ", ".join(labels)
    return ", ".join(
        SPECIALIST_ROLE.get(slug, SPECIALIST_SHORT.get(slug, slug))
        for slug in active
    )


def _truncate_visible(s: str, max_w: int) -> str:
    if max_w <= 0:
        return ""
    if _visible_width(s) <= max_w:
        return s
    # No ANSI inside specialists segment today; simple visible-prefix slice.
    # If the segment ends with RESET, re-append it after truncation.
    ends_reset = s.endswith("\\033[0m")
    plain = _CSI_RE.sub("", s)
    cut_w = max(max_w - 1, 0)  # reserve 1 col for ellipsis
    truncated = plain[:cut_w] + "…"
    if ends_reset:
        truncated += "\\033[0m"
    return truncated


def _compose_rows(base: str, segments: list[str], term_w: int) -> str:
    art_rows = base.split("\\n")
    n = max(len(art_rows), len(segments))

    # Drop trailing empty segments (scan from end, stop at first non-empty)
    trimmed = list(segments)
    while trimmed and trimmed[-1] == "":
        trimmed.pop()
    # If trimmed shorter than art_rows, art still drives row count
    n = max(len(art_rows), len(trimmed))

    art_visible_widths = [_visible_width(r) for r in art_rows]
    anchor = (max(art_visible_widths) if art_visible_widths else 0) + 2
    right_budget = max(term_w - anchor, 20)

    # Truncate specialists first. Specialists is whichever slot's content
    # was produced by _format_specialists — the caller signals this by
    # placing it at a known index. Here we apply the budget by truncating
    # the longest segment first iteratively until all fit.
    work = list(trimmed)
    # Priority order for truncation: specialists (slot 2), suggested/recon
    # (slot 3), bubbles (slots 4, 5), form/mood (slot 1) — never truncate
    # slot 0 (always empty). Priority encoded by index: 2, 3, 4, 5, 1.
    priority = [2, 3, 4, 5, 1]
    for idx in priority:
        if idx >= len(work):
            continue
        if _visible_width(work[idx]) > right_budget:
            work[idx] = _truncate_visible(work[idx], right_budget)

    out_lines = []
    for i in range(n):
        art_piece = art_rows[i] if i < len(art_rows) else ""
        seg = work[i] if i < len(work) else ""
        if art_piece == "" and seg == "":
            continue
        if seg:
            pad = anchor - _visible_width(art_piece)
            if pad < 0:
                pad = 0
            out_lines.append(art_piece + (" " * pad) + seg)
        else:
            out_lines.append(art_piece)

    return "\\n".join(out_lines)"""
```

Note: when transferring this to the file, the `\\033[0m` and `\\n` must become literal `\033[0m` and `\n` in the Python source (single backslash). The double-backslash here is escaping for the JSON tool-call payload only.

Final code as it must appear in the file (single backslashes):

```python
def _truncate_visible(s: str, max_w: int) -> str:
    if max_w <= 0:
        return ""
    if _visible_width(s) <= max_w:
        return s
    ends_reset = s.endswith("\033[0m")
    plain = _CSI_RE.sub("", s)
    cut_w = max(max_w - 1, 0)
    truncated = plain[:cut_w] + "…"
    if ends_reset:
        truncated += "\033[0m"
    return truncated


def _compose_rows(base: str, segments: list[str], term_w: int) -> str:
    art_rows = base.split("\n")

    trimmed = list(segments)
    while trimmed and trimmed[-1] == "":
        trimmed.pop()
    n = max(len(art_rows), len(trimmed))

    art_visible_widths = [_visible_width(r) for r in art_rows]
    anchor = (max(art_visible_widths) if art_visible_widths else 0) + 2
    right_budget = max(term_w - anchor, 20)

    work = list(trimmed)
    priority = [2, 3, 4, 5, 1]
    for idx in priority:
        if idx >= len(work):
            continue
        if _visible_width(work[idx]) > right_budget:
            work[idx] = _truncate_visible(work[idx], right_budget)

    out_lines = []
    for i in range(n):
        art_piece = art_rows[i] if i < len(art_rows) else ""
        seg = work[i] if i < len(work) else ""
        if art_piece == "" and seg == "":
            continue
        if seg:
            pad = anchor - _visible_width(art_piece)
            if pad < 0:
                pad = 0
            out_lines.append(art_piece + (" " * pad) + seg)
        else:
            out_lines.append(art_piece)

    return "\n".join(out_lines)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: 20 pass (12 prior + 8 new).

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/statusline.py buddy/tests/test_statusline_layout.py
git commit -m "feat(buddy): add _compose_rows side-by-side layout primitive"
```

---

### Task 4: Add `_compose_segments` orchestrator

**Files:**
- Modify: `buddy/scripts/statusline.py` (new function)
- Modify: `buddy/tests/test_statusline_layout.py` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `buddy/tests/test_statusline_layout.py`:

```python
from scripts.statusline import _compose_segments


def test_compose_segments_slot_0_always_empty():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[0] == ""


def test_compose_segments_slot_1_always_form_mood():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[1] == "Owl · flow"


def test_compose_segments_specialists_slot_2():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="architect, tester",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[2] == "architect, tester"


def test_compose_segments_suggested_and_recon_combined_slot_3():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested="yeti",
        specialists_line="",
        recon_badge="[recon]",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert "yeti nearby" in segs[3]
    assert "[recon]" in segs[3]


def test_compose_segments_suggested_only_slot_3():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested="yeti",
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[3] == "yeti nearby"


def test_compose_segments_recon_only_slot_3():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="[recon]",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert segs[3] == "[recon]"


def test_compose_segments_verdict_slot_4_cs_verdict_slot_5():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="[ok] plan",
        cs_verdict_bubble="[cs!] iron",
    )
    assert segs[4] == "[ok] plan"
    assert segs[5] == "[cs!] iron"


def test_compose_segments_returns_6_slots_always():
    segs = _compose_segments(
        form_label="Owl",
        mood="flow",
        suggested=None,
        specialists_line="",
        recon_badge="",
        verdict_bubble="",
        cs_verdict_bubble="",
    )
    assert len(segs) == 6
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: ImportError on `_compose_segments`.

- [ ] **Step 3: Implement `_compose_segments`**

Use `edit_file` to append after `_compose_rows`:

```
old_string: """    return "\\n".join(out_lines)"""

new_string: """    return "\\n".join(out_lines)


def _compose_segments(
    form_label: str,
    mood: str,
    suggested: str | None,
    specialists_line: str,
    recon_badge: str,
    verdict_bubble: str,
    cs_verdict_bubble: str,
) -> list[str]:
    slot1 = f"{form_label} · {mood}" if form_label else mood
    slot2 = specialists_line
    parts = []
    if suggested:
        short = SPECIALIST_SHORT.get(suggested, suggested)
        parts.append(f"{short} nearby")
    if recon_badge:
        parts.append(recon_badge)
    slot3 = " ".join(parts)
    slot4 = verdict_bubble
    slot5 = cs_verdict_bubble
    return ["", slot1, slot2, slot3, slot4, slot5]"""
```

Final code in file (single backslashes — the JSON-escaped form is shown above):

```python
def _compose_segments(
    form_label: str,
    mood: str,
    suggested: str | None,
    specialists_line: str,
    recon_badge: str,
    verdict_bubble: str,
    cs_verdict_bubble: str,
) -> list[str]:
    slot1 = f"{form_label} · {mood}" if form_label else mood
    slot2 = specialists_line
    parts = []
    if suggested:
        short = SPECIALIST_SHORT.get(suggested, suggested)
        parts.append(f"{short} nearby")
    if recon_badge:
        parts.append(recon_badge)
    slot3 = " ".join(parts)
    slot4 = verdict_bubble
    slot5 = cs_verdict_bubble
    return ["", slot1, slot2, slot3, slot4, slot5]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: 28 pass (20 prior + 8 new).

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/statusline.py buddy/tests/test_statusline_layout.py
git commit -m "feat(buddy): add _compose_segments slot orchestrator"
```

---

### Task 5: Rewrite `render()` to use the new layout

**Files:**
- Modify: `buddy/scripts/statusline.py` — replace `render()` body
- Modify: `buddy/tests/test_statusline_layout.py` — add integration test

- [ ] **Step 1: Write the failing integration tests**

Append to `buddy/tests/test_statusline_layout.py`:

```python
import json
from pathlib import Path

from scripts.statusline import render
from scripts.state import default_state

DATA_DIR = Path(__file__).parent.parent / "data"
BODHIS = json.loads((DATA_DIR / "bodhisattvas.json").read_text())
ENV = json.loads((DATA_DIR / "environment.json").read_text())


def _identity(form="owl-of-clear-seeing"):
    return {
        "version": 1,
        "form": form,
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }


def test_render_side_by_side_form_mood_on_row_1(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    lines = output.split("\n")
    # row 0 is env strip, row 1 is first art row + "Owl · flow"
    assert "Owl" in lines[1]
    assert "flow" in lines[1]


def test_render_no_specialists_keeps_slot_2_blank(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    lines = output.split("\n")
    # slot 2 corresponds to art row index 2; with no specialists and no
    # later segments, _compose_rows drops trailing empties — only slots
    # 0, 1 remain populated. Lines past slot 1 should be art-only.
    for line in lines[2:]:
        assert "," not in line  # no specialists list


def test_render_three_specialists_uses_role_names(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    state["active_specialists"] = [
        "debugging-yeti",
        "testing-snow-leopard",
        "architecture-snow-lion",
    ]
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    assert "debugger" in output
    assert "tester" in output
    assert "architect" in output
    # full label "Yeti" should NOT appear (role-name mode active)
    assert "Yeti" not in output


def test_render_one_specialist_uses_full_label(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    state["active_specialists"] = ["debugging-yeti"]
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    # full label from resolve_labels — exact label depends on resolver,
    # but role name "debugger" must NOT appear (full-label mode active)
    assert "debugger" not in output


def test_render_narrow_terminal_truncates_specialists(monkeypatch):
    monkeypatch.setenv("COLUMNS", "30")
    state = default_state()
    state["active_specialists"] = [
        "debugging-yeti",
        "testing-snow-leopard",
        "architecture-snow-lion",
        "security-ibex",
        "performance-lammergeier",
    ]
    output = render(
        identity=_identity(),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    assert "…" in output


def test_render_fallback_no_form_returns_single_line(monkeypatch):
    monkeypatch.setenv("COLUMNS", "200")
    state = default_state()
    output = render(
        identity=_identity(form="nonexistent-form"),
        state=state,
        bodhisattvas=BODHIS,
        env=ENV,
        now=1000000,
        local_hour=14,
    )
    assert "\n" not in output
    assert "Lin" in output
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: the 6 new tests fail (render still emits the old single-label-line layout — the assertions either fail or pass spuriously; specifically `test_render_three_specialists_uses_role_names` will fail because the old code emits `resolve_labels` output regardless of count).

- [ ] **Step 3: Rewrite `render()`**

Use `edit_code` (LSP-aware structural edit):

```
action: replace
symbol: render
path: buddy/scripts/statusline.py
body:
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

    form_label = form.get("label", form_name)

    active = state.get("active_specialists", [])
    specialists_line = ""
    if active:
        plugin_root = _PLUGIN_ROOT
        proj_root = project_root or Path.cwd()
        try:
            from scripts.specialist_labels import resolve_labels
            pairs = resolve_labels(
                active,
                plugin_root=plugin_root,
                project_root=proj_root,
            )
        except Exception:
            pairs = []
        specialists_line = _format_specialists(active, pairs)

    recon_badge = _render_recon_badge(project_root, now, session_id=session_id)
    verdict_bubble = _render_bubble(session_id, project_root, now)
    cs_verdict_bubble = _render_cs_bubble(session_id, project_root, now)

    segments = _compose_segments(
        form_label=form_label,
        mood=mood,
        suggested=suggested,
        specialists_line=specialists_line,
        recon_badge=recon_badge,
        verdict_bubble=verdict_bubble,
        cs_verdict_bubble=cs_verdict_bubble,
    )

    return _compose_rows(base, segments, _terminal_width())
```

- [ ] **Step 4: Run new tests to verify they pass**

Run: `cd buddy && python -m pytest tests/test_statusline_layout.py -v`
Expected: 34 pass.

- [ ] **Step 5: Run pre-existing statusline tests**

Run: `cd buddy && python -m pytest tests/test_statusline.py -v`
Expected: all pre-existing tests pass. (Assertions of the form `assert "Owl" in output` and `assert eyes in output` still hold because `form_label` and `eyes` still appear in the new output.)

- [ ] **Step 6: Run full test suite**

Run: `cd buddy && python -m pytest tests/ -v`
Expected: full green.

- [ ] **Step 7: Run plugin test runner**

Run: `./tests/run-all.sh`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add buddy/scripts/statusline.py buddy/tests/test_statusline_layout.py
git commit -m "feat(buddy): rewrite render() to use side-by-side layout"
```

---

### Task 6: Manual visual smoke check + bodhisattva sweep

This task is verification-only. No code changes unless a visual issue surfaces.

- [ ] **Step 1: Inspect rendering across all 10 bodhisattva forms**

Run this script from the repo root:

```bash
cd buddy && python3 -c '
import json, os
from pathlib import Path

os.environ["COLUMNS"] = "120"
DATA = Path("data")
BODHIS = json.loads((DATA / "bodhisattvas.json").read_text())
ENV = json.loads((DATA / "environment.json").read_text())

from scripts.statusline import render
from scripts.state import default_state

state = default_state()
state["active_specialists"] = [
    "debugging-yeti",
    "testing-snow-leopard",
    "architecture-snow-lion",
    "security-ibex",
]

for form in BODHIS:
    identity = {
        "version": 1, "form": form, "name": "Lin", "personality": "",
        "hatched_at": 0, "soul_model": "fallback", "hatched": False,
    }
    print(f"=== {form} ===")
    print(render(identity=identity, state=state, bodhisattvas=BODHIS,
                 env=ENV, now=1000000, local_hour=14))
    print()
'
```

Expected: each form shows ASCII art on the left, segments aligned in the right column. No segment runs off the right edge at width 120. No overlap with ASCII art glyphs. Trailing whitespace on art-only rows is acceptable.

- [ ] **Step 2: Inspect at narrow width (40 cols)**

Run the same script with `COLUMNS=40`:

```bash
cd buddy && COLUMNS=40 python3 -c '
import json, os
from pathlib import Path
DATA = Path("data")
BODHIS = json.loads((DATA / "bodhisattvas.json").read_text())
ENV = json.loads((DATA / "environment.json").read_text())
from scripts.statusline import render
from scripts.state import default_state
state = default_state()
state["active_specialists"] = [
    "debugging-yeti","testing-snow-leopard","architecture-snow-lion",
    "security-ibex","performance-lammergeier",
]
identity = {"version":1,"form":"owl-of-clear-seeing","name":"Lin","personality":"","hatched_at":0,"soul_model":"fallback","hatched":False}
print(render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14))
'
```

Expected: specialists line ends with `…`; recon/bubbles (if present) untouched.

- [ ] **Step 3: Inspect via `statusline-composed.sh` end-to-end**

Construct synthetic CC stdin and pipe through the composed script:

```bash
cd buddy && echo '{"session_id":"smoke","workspace":{"current_dir":"/tmp"},"context_window":{"used_percentage":42}}' \
  | BUDDY_SKIP_PRIMARY=1 COLUMNS=120 bash scripts/statusline-composed.sh
```

Expected: buddy block renders side-by-side. No traceback, no missing-import error.

- [ ] **Step 4: If any visual issue surfaces**

Document the form name, terminal width, and observed output. File a follow-up issue or add a fix sub-task. Do NOT silently patch — the spec is the contract.

- [ ] **Step 5: Commit verification log if any output captured**

If you captured visual output worth keeping for future regression reference, drop it in `buddy/tests/fixtures/statusline-visual.txt` and commit:

```bash
git add buddy/tests/fixtures/statusline-visual.txt
git commit -m "test(buddy): capture statusline visual snapshot for regression reference"
```

Otherwise skip the commit.

---

## Post-implementation

After all tasks pass:

1. `./tests/run-all.sh` exits 0.
2. `git log --oneline feat/statusline-side-by-side ^main` shows 5–6 commits.
3. The branch is ready for `/ultrareview` or PR.

No version bump required — `buddy` plugin version is independent of `codescout-companion` and this change is pre-release polish. If a buddy version bump is desired afterward, follow the version-bump procedure in `CLAUDE.md`.
