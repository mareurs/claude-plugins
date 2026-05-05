# Buddy Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give buddy specialists a POV-scoped, two-channel (global / project) memory system so lessons learned in one session inform future sessions across projects and CC instances.

**Architecture:** File-per-entry markdown memories with frontmatter, indexed via per-channel `INDEX.md`. Loading happens in `/buddy:summon` (model-driven Read of files). Writing happens via three triggers (explicit ask, autonomous mid-turn, `/buddy:dismiss` introspection) — model-driven, with a tiny Python helper (`scripts/memory.py`) for cross-instance mirroring of global memories. Project memories are staged with `git add`; user commits.

**Tech Stack:** Markdown + YAML frontmatter, Python 3.11+ stdlib (`pathlib`, `json`, `os`, `shutil`), Bash via Claude `Bash` tool, `git` CLI. No new dependencies.

**Spec:** `buddy/docs/superpowers/specs/2026-05-05-buddy-memory-design.md`

---

## File Structure

**New files:**
- `buddy/data/memory-protocol.md` — canonical write protocol injected after memories load.
- `buddy/data/instances.json` — known CC instance dirs (`~/.claude`, `~/.claude-sdd`) for mirror logic. Editable by user.
- `buddy/scripts/memory.py` — Python helper. Functions: `current_instance_dir()`, `other_instance_dirs()`, `mirror_global_write(rel_path)`, `regen_index(channel_root)`, `read_index(channel_root)`.
- `buddy/tests/test_memory.py` — unit tests for `memory.py`.
- `buddy/commands/remember.md` — explicit `/buddy:remember <free text>` command (Trigger 1 surface).

**Modified files:**
- `buddy/commands/summon.md` — add Step 4.5 "Load memories" between skill-load and voice-adopt.
- `buddy/commands/dismiss.md` — add Step 1.5 "Run introspection" before state update.
- `buddy/README.md` — document `.buddy/memory/` is committed; document instance mirror.
- `buddy/CLAUDE.md` — short note for buddy maintainers.

**Untouched** (intentionally):
- `buddy/hooks/session-end.sh` — see spec, SessionEnd cannot drive a model turn.
- All `buddy/skills/*/SKILL.md` — protocol lives in single file `data/memory-protocol.md`.

---

## Task 1: Add CC instance registry

**Files:**
- Create: `buddy/data/instances.json`

- [ ] **Step 1: Create the registry file**

```json
{
  "instances": [
    "~/.claude",
    "~/.claude-sdd"
  ]
}
```

Paths use `~` and are expanded at runtime. If a user has only one CC instance, they can shrink the list — mirror logic treats "no other instances" as a no-op, not an error.

- [ ] **Step 2: Commit**

```bash
git add buddy/data/instances.json
git commit -m "feat(buddy): add CC instance registry for memory mirror"
```

---

## Task 2: Implement `memory.py` helper — current/other instance discovery

**Files:**
- Create: `buddy/scripts/memory.py`
- Test: `buddy/tests/test_memory.py`

- [ ] **Step 1: Write the failing test**

```python
# buddy/tests/test_memory.py
import json
import os
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import memory  # noqa: E402


def write_instances(tmp_path: Path, paths: list[str]) -> Path:
    p = tmp_path / "instances.json"
    p.write_text(json.dumps({"instances": paths}))
    return p


def test_current_instance_dir_detects_from_plugin_root(tmp_path, monkeypatch):
    fake_claude = tmp_path / "claude"
    fake_plugin = fake_claude / "plugins" / "cache" / "x" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    assert memory.current_instance_dir() == fake_claude


def test_other_instance_dirs_excludes_current(tmp_path, monkeypatch):
    a = tmp_path / "claude"; a.mkdir()
    b = tmp_path / "claude-sdd"; b.mkdir()
    fake_plugin = a / "plugins" / "cache" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    reg = write_instances(tmp_path, [str(a), str(b)])
    monkeypatch.setattr(memory, "INSTANCES_REGISTRY", reg)
    assert memory.other_instance_dirs() == [b]


def test_other_instance_dirs_skips_missing(tmp_path, monkeypatch):
    a = tmp_path / "claude"; a.mkdir()
    fake_plugin = a / "plugins" / "cache" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    reg = write_instances(tmp_path, [str(a), str(tmp_path / "nope")])
    monkeypatch.setattr(memory, "INSTANCES_REGISTRY", reg)
    assert memory.other_instance_dirs() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd buddy && python -m pytest tests/test_memory.py -v`
Expected: FAIL with `ModuleNotFoundError` on `scripts.memory` or `AttributeError`.

- [ ] **Step 3: Write minimal implementation**

```python
# buddy/scripts/memory.py
"""Buddy memory helper: instance discovery, mirror writes, INDEX regen.

This module is intentionally small. The model drives memory routing,
slug choice, dedup, and write content via the prompts in
`commands/summon.md`, `commands/dismiss.md`, and `data/memory-protocol.md`.
This script only handles deterministic plumbing: locating CC instance
dirs and copying global memories between them.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
INSTANCES_REGISTRY = PLUGIN_ROOT / "data" / "instances.json"


def _load_registry() -> list[Path]:
    if not INSTANCES_REGISTRY.exists():
        return []
    raw = json.loads(INSTANCES_REGISTRY.read_text())
    return [Path(os.path.expanduser(p)) for p in raw.get("instances", [])]


def current_instance_dir() -> Path | None:
    """Return the CC instance dir that owns this plugin install."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not plugin_root:
        return None
    p = Path(plugin_root).resolve()
    for parent in [p, *p.parents]:
        if parent.name in {".claude", ".claude-sdd"} or (parent / "plugins").is_dir():
            if parent.name in {".claude", ".claude-sdd"}:
                return parent
    return None


def other_instance_dirs() -> list[Path]:
    """Registered instance dirs that are not the current one and exist on disk."""
    cur = current_instance_dir()
    out: list[Path] = []
    for inst in _load_registry():
        if cur and inst.resolve() == cur.resolve():
            continue
        if inst.is_dir():
            out.append(inst)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd buddy && python -m pytest tests/test_memory.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/memory.py buddy/tests/test_memory.py
git commit -m "feat(buddy): memory helper — instance discovery"
```

---

## Task 3: Implement `mirror_global_write`

**Files:**
- Modify: `buddy/scripts/memory.py`
- Modify: `buddy/tests/test_memory.py`

- [ ] **Step 1: Write the failing test**

Append to `buddy/tests/test_memory.py`:

```python
def test_mirror_global_write_copies_to_other_instances(tmp_path, monkeypatch):
    a = tmp_path / "claude"
    b = tmp_path / "claude-sdd"
    (a / "buddy" / "memory" / "debugging-yeti").mkdir(parents=True)
    b.mkdir()
    fake_plugin = a / "plugins" / "cache" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    reg = write_instances(tmp_path, [str(a), str(b)])
    monkeypatch.setattr(memory, "INSTANCES_REGISTRY", reg)

    src_rel = Path("debugging-yeti/flaky-tests.md")
    src_abs = a / "buddy" / "memory" / src_rel
    src_abs.write_text("---\nslug: flaky-tests\n---\nbody")

    written = memory.mirror_global_write(src_rel)

    assert b / "buddy" / "memory" / src_rel in written
    assert (b / "buddy" / "memory" / src_rel).read_text() == "---\nslug: flaky-tests\n---\nbody"


def test_mirror_global_write_noop_when_no_other_instances(tmp_path, monkeypatch):
    a = tmp_path / "claude"
    (a / "buddy" / "memory" / "common").mkdir(parents=True)
    fake_plugin = a / "plugins" / "cache" / "buddy" / "0.1.0"
    fake_plugin.mkdir(parents=True)
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(fake_plugin))
    reg = write_instances(tmp_path, [str(a)])
    monkeypatch.setattr(memory, "INSTANCES_REGISTRY", reg)

    src_rel = Path("common/no-mocks-in-it.md")
    (a / "buddy" / "memory" / src_rel).write_text("body")
    assert memory.mirror_global_write(src_rel) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd buddy && python -m pytest tests/test_memory.py -v`
Expected: 2 new tests FAIL with `AttributeError: module 'scripts.memory' has no attribute 'mirror_global_write'`.

- [ ] **Step 3: Add `mirror_global_write` to `memory.py`**

Append to `buddy/scripts/memory.py`:

```python
def mirror_global_write(rel_path: Path | str) -> list[Path]:
    """Copy a memory file from the current instance's global memory dir to
    every other registered instance. Returns list of paths written.

    `rel_path` is relative to `<instance>/buddy/memory/`, e.g.
    `Path("debugging-yeti/flaky-tests.md")`.
    """
    rel = Path(rel_path)
    cur = current_instance_dir()
    if cur is None:
        return []
    src = cur / "buddy" / "memory" / rel
    if not src.is_file():
        return []
    written: list[Path] = []
    for other in other_instance_dirs():
        dst = other / "buddy" / "memory" / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        written.append(dst)
    return written
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd buddy && python -m pytest tests/test_memory.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/memory.py buddy/tests/test_memory.py
git commit -m "feat(buddy): memory helper — global mirror"
```

---

## Task 4: Implement `read_index` and `regen_index`

**Files:**
- Modify: `buddy/scripts/memory.py`
- Modify: `buddy/tests/test_memory.py`

- [ ] **Step 1: Write the failing test**

Append to `buddy/tests/test_memory.py`:

```python
def test_regen_index_reads_frontmatter_and_writes_index(tmp_path):
    root = tmp_path / "memory"
    yeti_dir = root / "debugging-yeti"
    yeti_dir.mkdir(parents=True)
    (yeti_dir / "flaky-tests.md").write_text(
        "---\n"
        "specialist: debugging-yeti\n"
        "scope: project\n"
        "slug: flaky-tests\n"
        "created: 2026-05-05\n"
        "updated: 2026-05-05\n"
        "tags: [flaky-tests]\n"
        "---\n"
        "**Lesson:** Run flaky tests 50 times before declaring them fixed.\n"
        "**Why:** ...\n"
    )
    (root / "common").mkdir()
    (root / "common" / "no-mocks.md").write_text(
        "---\n"
        "specialist: common\n"
        "scope: project\n"
        "slug: no-mocks\n"
        "created: 2026-05-05\n"
        "updated: 2026-05-05\n"
        "tags: [testing]\n"
        "---\n"
        "**Lesson:** This repo bans mocks in integration tests.\n"
    )

    memory.regen_index(root)

    idx = (root / "INDEX.md").read_text()
    assert "[debugging-yeti/flaky-tests](debugging-yeti/flaky-tests.md)" in idx
    assert "Run flaky tests 50 times" in idx
    assert "[common/no-mocks](common/no-mocks.md)" in idx


def test_read_index_returns_entries(tmp_path):
    root = tmp_path / "memory"
    root.mkdir()
    (root / "INDEX.md").write_text(
        "- [debugging-yeti/flaky-tests](debugging-yeti/flaky-tests.md) — Run flaky tests 50 times\n"
        "- [common/no-mocks](common/no-mocks.md) — No mocks in integration tests\n"
    )
    entries = memory.read_index(root)
    assert entries == [
        ("debugging-yeti/flaky-tests", "debugging-yeti/flaky-tests.md", "Run flaky tests 50 times"),
        ("common/no-mocks", "common/no-mocks.md", "No mocks in integration tests"),
    ]


def test_read_index_missing_returns_empty(tmp_path):
    assert memory.read_index(tmp_path / "missing") == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd buddy && python -m pytest tests/test_memory.py -v`
Expected: 3 new tests FAIL with `AttributeError`.

- [ ] **Step 3: Add `read_index` and `regen_index` to `memory.py`**

Append to `buddy/scripts/memory.py`:

```python
import re

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)
_LESSON_RE = re.compile(r"^\*\*Lesson:\*\*\s*(.+?)$", re.MULTILINE)


def _parse_entry(path: Path) -> dict | None:
    text = path.read_text()
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return None
    fm_raw, body = m.group(1), m.group(2)
    fm: dict[str, str] = {}
    for line in fm_raw.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    slug = fm.get("slug") or path.stem
    specialist = fm.get("specialist") or path.parent.name
    lm = _LESSON_RE.search(body)
    hook = lm.group(1).strip() if lm else body.strip().splitlines()[0][:120]
    return {
        "specialist": specialist,
        "slug": slug,
        "rel_path": f"{specialist}/{slug}.md",
        "hook": hook,
    }


def regen_index(channel_root: Path) -> Path:
    """Walk `<channel_root>/<specialist>/*.md` and `<channel_root>/common/*.md`,
    write a fresh INDEX.md.
    """
    channel_root = Path(channel_root)
    entries: list[dict] = []
    if channel_root.is_dir():
        for spec_dir in sorted(channel_root.iterdir()):
            if not spec_dir.is_dir():
                continue
            for entry_file in sorted(spec_dir.glob("*.md")):
                parsed = _parse_entry(entry_file)
                if parsed:
                    entries.append(parsed)
    lines = [
        f"- [{e['specialist']}/{e['slug']}]({e['rel_path']}) — {e['hook']}"
        for e in entries
    ]
    idx_path = channel_root / "INDEX.md"
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    idx_path.write_text("\n".join(lines) + ("\n" if lines else ""))
    return idx_path


_INDEX_LINE_RE = re.compile(r"^- \[(?P<key>[^\]]+)\]\((?P<path>[^)]+)\) — (?P<hook>.+)$")


def read_index(channel_root: Path) -> list[tuple[str, str, str]]:
    """Return `[(key, rel_path, hook), ...]` for every line in INDEX.md.
    Returns `[]` if INDEX.md is missing.
    """
    idx = Path(channel_root) / "INDEX.md"
    if not idx.is_file():
        return []
    out: list[tuple[str, str, str]] = []
    for line in idx.read_text().splitlines():
        m = _INDEX_LINE_RE.match(line)
        if m:
            out.append((m.group("key"), m.group("path"), m.group("hook")))
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd buddy && python -m pytest tests/test_memory.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/memory.py buddy/tests/test_memory.py
git commit -m "feat(buddy): memory helper — INDEX read/regen"
```

---

## Task 5: Write `data/memory-protocol.md`

**Files:**
- Create: `buddy/data/memory-protocol.md`

- [ ] **Step 1: Write the protocol document**

Create `buddy/data/memory-protocol.md`:

```markdown
# Memory Protocol

You have a memory system. Use it to capture lessons that would change how you act next time. Three rules above all:

1. **Memory is for hard-won judgment, not transcripts.** If a lesson would not change a future decision, do not save it.
2. **POV is yours alone.** Save in your own voice. The user can read these later, but they are addressed to your future self.
3. **Empty is valid.** If nothing genuinely new came up, say so and move on. Do not invent lessons to fill space.

## When to save

- **Explicit user ask** — "remember that …", "save a memory about …".
- **Autonomous mid-turn** — you noticed a lesson worth keeping during work. Announce *before* writing so the user can object.
- **At dismissal** — when `/buddy:dismiss` triggers introspection, reflect across the turn(s) and save zero or more lessons.

## Routing — global vs project

| Channel | Path | Pick when |
| --- | --- | --- |
| **Project** | `<repo-root>/.buddy/memory/` | Lesson references this repo's files, conventions, infra, team decisions, tooling, or data. |
| **Global** | `<claude-dir>/buddy/memory/` | Lesson is about the craft itself — language/framework patterns, debugging instincts, generally-applicable heuristics. |

**Ambiguous → project.** Project memory only loads in this repo, so a wrong call there is contained. A wrong "global" call follows the user everywhere.

## File location

```
<channel>/<specialist>/<slug>.md     # POV-scoped: only loaded when that specialist is summoned
<channel>/common/<slug>.md           # Cross-buddy: loaded for every summoned specialist
```

`<specialist>` is your directory name under `buddy/skills/` (e.g. `debugging-yeti`).
Use `common` only when the lesson genuinely applies to every specialist (e.g. a project convention).

## Slug rules

- kebab-case, 3–6 words, derived from the lesson topic.
- Must be unique within `<channel>/<specialist>/`.
- A slug collision is treated as **update**, not new entry.

## Entry format

```markdown
---
specialist: <directory>           # or "common"
scope: global | project
slug: <kebab-slug>
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [tag1, tag2]
---

**Lesson:** <one-line claim, your POV first-person>

**Why:** <reason — incident, principle, or pattern observed>

**How to apply:** <when/where this kicks in for future work>
```

## Dedup — before writing

1. Read `<channel>/INDEX.md` for the target channel.
2. In your `<specialist>` (or `common`) section, look for either:
   - a **slug match** (exact or near-identical kebab tokens), or
   - **≥2 tag overlap** with an existing entry whose hook is topically similar.
3. If matched: load the existing file, merge the new info into the body, bump `updated:`. Do not create a new file.
4. If not matched: write a new file.
5. After every write or update, regenerate the INDEX line for the affected entry. (You may rewrite the whole INDEX.md from scratch if simpler — entries are sortable by `<specialist>/<slug>`.)

## Announce format

Always announce a save with one line *before* writing, so the user can object:

```
→ memory: <scope> / <specialist-or-common> / <slug> — <one-line hook>
```

If the user objects on the next turn, undo:
- Project: `git restore --staged <path> && rm <path>`
- Global: `rm <path>` and re-mirror.

## Staging — project only

After writing a project memory:

```bash
git add .buddy/memory/<rel-path>
```

**Do not commit.** Tell the user: `staged — commit when ready.`

If `git add` fails (not a repo, etc.), report `→ memory: skipped (project dir not writable)` and do not retry.

## Mirror — global only

After writing a global memory at `<current-claude-dir>/buddy/memory/<rel-path>`, mirror it to other instances:

```bash
python3 -c "
import sys; sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.memory import mirror_global_write
written = mirror_global_write(Path('<rel-path>'))
for p in written: print(f'mirrored: {p}')
" || true
```

If `<rel-path>` was an update (not new), the mirror copies the new content over. INDEX regeneration on the mirror is handled the next time that instance summons the specialist (lazy).

## Failure modes

- `.buddy/memory/` not writable → skip project write; announce skip; global still works.
- Mirror target dir missing → write current instance only; log one-line warning.
- Frontmatter parse error on load → skip that entry only; log warning; do not abort load.
```

- [ ] **Step 2: Commit**

```bash
git add buddy/data/memory-protocol.md
git commit -m "feat(buddy): memory write protocol document"
```

---

## Task 6: Modify `commands/summon.md` — load memories step

**Files:**
- Modify: `buddy/commands/summon.md`

- [ ] **Step 1: Insert new "Step 2.5" between Step 2 and Step 3**

Open `buddy/commands/summon.md`. After the existing "Step 2 — Load the specialist skill file" section and before "Step 3 — Announce the summon", insert:

```markdown
## Step 2.5 — Load memories and inject the memory protocol

Memories are POV-scoped — only the resolved `<directory>` (and the `common` bucket) are loaded.

**Resolve channels:**
- **Global root**: pick the current CC instance dir. Detect via `CLAUDE_PLUGIN_ROOT` — the parent matching `.claude` or `.claude-sdd`. The global memory root is `<claude-dir>/buddy/memory/`.
- **Project root**: `<cwd>/.buddy/memory/` if the directory exists. Skip if missing or if the user has the dir gitignored — in that case emit one warning line: `→ memory: project dir gitignored, skipping project channel`.

**For each existing channel root**, read in this order:
1. `<channel>/<directory>/*.md` (specialist POV)
2. `<channel>/common/*.md` (cross-buddy)

Use the `Read` tool for each file. If a file's frontmatter is malformed, skip it silently.

**Inject under a `## Memories` heading appended to the specialist's instructions:**

```
## Memories — <directory> POV

### Project (this repo)
<project specialist entries verbatim, blank line between, then project common entries>

### Global
<global specialist entries verbatim, blank line between, then global common entries>
```

If a sub-section is empty, omit its heading. If both are empty, omit the whole `## Memories` section.

**Soft cap:** if any one channel has more than 30 entries in `<directory>` + `common` combined, after loading print a one-line hint: `→ memory: <channel> has <N> entries — consider consolidating`. Still load all entries.

**After memories are injected, also inject the protocol:**

Use the `Read` tool on `${CLAUDE_PLUGIN_ROOT}/data/memory-protocol.md` and inject its contents verbatim under a `## Memory Protocol` heading right after `## Memories` (or right after the specialist instructions if `## Memories` was omitted).
```

Use the existing file's structure — match heading levels and tone of the surrounding steps.

- [ ] **Step 2: Verify the file still parses as a valid Claude command**

Run: `head -5 buddy/commands/summon.md`
Expected: frontmatter (`---`, `name:`, `description:`, `---`) intact at top.

Run: `grep -c "^## Step" buddy/commands/summon.md`
Expected: `7` (was 6, now adds Step 2.5).

- [ ] **Step 3: Commit**

```bash
git add buddy/commands/summon.md
git commit -m "feat(buddy): summon loads POV-scoped memories + protocol"
```

---

## Task 7: Modify `commands/dismiss.md` — introspection step

**Files:**
- Modify: `buddy/commands/dismiss.md`

- [ ] **Step 1: Insert new "Step 1.5" between Step 1 and Step 2**

Open `buddy/commands/dismiss.md`. After the existing "Step 1 — Resolve the target" section and before "Step 2 — Update active_specialists in state", insert:

```markdown
## Step 1.5 — Run introspection before dismissing

Before clearing the specialist(s) from state, give them a chance to capture lessons.

**If target is `"ALL"`:** for each entry in `active_specialists` (alphabetical order), run the introspection block below scoped to that specialist. Then proceed to Step 2.

**Otherwise:** run the introspection block for the resolved `<directory>` only.

**Introspection block** (emit verbatim as a system-style nudge to the buddy, then await its response):

> Before you depart, <directory>: reflect on this session from your POV. What did you learn that would change how you'd act next time? For each lesson:
> 1. Decide global vs project scope (see the Memory Protocol).
> 2. Propose a slug (3–6 kebab-case words).
> 3. Read the target channel's `INDEX.md` and check for slug match or ≥2-tag overlap with a topically similar hook. If matched, update the existing file; else create a new one.
> 4. Announce each save (`→ memory: <scope> / <specialist> / <slug> — <hook>`).
> 5. Stage project writes with `git add`. Mirror global writes via `scripts/memory.py`.
>
> If nothing genuinely new came up, say so explicitly and stop. Do not invent lessons.

Wait for the buddy to complete (zero or more saves). Then continue with Step 2.

If the project memory dir does not exist or the working tree is not a git repo, project writes during introspection are skipped silently — see the protocol's failure modes.
```

- [ ] **Step 2: Verify file still parses**

Run: `grep -c "^## Step" buddy/commands/dismiss.md`
Expected: `5` (was 4, now adds Step 1.5).

- [ ] **Step 3: Commit**

```bash
git add buddy/commands/dismiss.md
git commit -m "feat(buddy): dismiss runs introspection before clearing state"
```

---

## Task 8: Add `/buddy:remember` command

**Files:**
- Create: `buddy/commands/remember.md`

- [ ] **Step 1: Create the command**

Create `buddy/commands/remember.md`:

```markdown
---
name: buddy:remember
description: Ask the currently active specialist(s) to save a memory about the given lesson. Pass the lesson as the argument — e.g. `/buddy:remember in this repo, integration tests must hit a real database`. The specialist decides global vs project scope and the slug.
---

You are processing an explicit memory request. The argument passed by the user is `$1`.

## Step 1 — Resolve who saves it

Read `active_specialists` from session state.

```bash
python3 -c "
import sys, os
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, resolve_session_id_for_command, session_state_path
sid = resolve_session_id_for_command(Path.cwd(), os.getppid())
if not sid:
    print('NONE')
    raise SystemExit(0)
p = session_state_path(Path.cwd(), sid)
s = load_state(p)
print(','.join(s.get('active_specialists', [])) or 'NONE')
" || echo NONE
```

- If output is `NONE` or empty: tell the user `No specialist is summoned. Run /buddy:summon <name> first, or pick which POV should hold this memory.` and stop.
- If exactly one specialist: that one saves the memory.
- If multiple specialists: pick the most relevant based on `$1` and the specialist descriptions in `commands/summon.md`. If genuinely tied, ask the user which POV.

## Step 2 — Save the memory

The chosen specialist (you, in their voice) follows the Memory Protocol from `${CLAUDE_PLUGIN_ROOT}/data/memory-protocol.md` to write `$1` as a memory:

1. Decide scope (global vs project).
2. Propose a slug.
3. Dedup-scan the target channel's INDEX.md.
4. Update existing entry or create new file.
5. Announce save with `→ memory: <scope> / <specialist> / <slug> — <hook>`.
6. Stage (project) or mirror (global).
7. Regenerate INDEX line.

If the input is too vague to capture as a lesson, ask one clarifying question instead of writing.
```

- [ ] **Step 2: Commit**

```bash
git add buddy/commands/remember.md
git commit -m "feat(buddy): /buddy:remember command for explicit memory ask"
```

---

## Task 9: Update README

**Files:**
- Modify: `buddy/README.md`

- [ ] **Step 1: Find the right section**

Run: `grep -n "^## " buddy/README.md`
Note the section where commands or features are documented. If a "Memory" section does not exist, insert one before the "Development" or end-of-file section.

- [ ] **Step 2: Insert memory section**

Insert after the existing commands documentation:

```markdown
## Memory

Each summoned specialist has its own POV memory. Memories accumulate hard-won judgment across sessions — not transcripts.

**Channels:**
- **Global** — `~/.claude/buddy/memory/` (and `~/.claude-sdd/buddy/memory/` if you run both instances). Mirrored automatically. Craft-general lessons.
- **Project** — `<repo>/.buddy/memory/`. Committed to the repo. Codebase-specific lessons.

**Layout:**

```
.buddy/memory/
  INDEX.md
  debugging-yeti/<slug>.md   # only loaded when Yeti is summoned
  testing-snow-leopard/<slug>.md
  common/<slug>.md            # loaded for every summoned specialist
```

**Triggers for writes:**
- `/buddy:remember <lesson>` — explicit ask.
- Autonomous mid-turn (the buddy decides; it announces before writing so you can object).
- `/buddy:dismiss` introspection sweep.

**Project memories are committed.** Buddies stage with `git add`; you commit. If you have `.buddy/` in `.gitignore`, project memory is silently disabled (a warning is printed on summon).

**Two CC instances:** if you run both `~/.claude` and `~/.claude-sdd`, edit `buddy/data/instances.json` to list both paths. Global writes mirror across them.
```

- [ ] **Step 3: Commit**

```bash
git add buddy/README.md
git commit -m "docs(buddy): document memory system in README"
```

---

## Task 10: End-to-end smoke test

**Files:**
- (None — this is a manual verification task.)

- [ ] **Step 1: Set up a temp project**

```bash
TMP=$(mktemp -d)
cd "$TMP"
git init -q
echo "# smoke" > README.md
git add . && git commit -q -m "init"
```

- [ ] **Step 2: Summon a specialist**

In Claude Code (with buddy installed and `$TMP` as cwd):

```
/buddy:summon yeti
```

Expected output includes the Yeti's arrival announcement. No `## Memories` section (no memories yet). `## Memory Protocol` section IS present.

- [ ] **Step 3: Save a project memory**

```
/buddy:remember in this repo, all tests must use real fixtures, never mocks
```

Expected:
- One-line announce: `→ memory: project / debugging-yeti / <slug> — <hook>`.
- File created at `$TMP/.buddy/memory/debugging-yeti/<slug>.md` with valid frontmatter.
- INDEX.md updated.
- File staged: `git status` shows `A  .buddy/memory/...`.
- Yeti tells user "staged — commit when ready."

- [ ] **Step 4: Save a global memory**

```
/buddy:remember pytest fixtures with module scope leak state across tests
```

Expected:
- Announce: `→ memory: global / debugging-yeti / <slug> — <hook>`.
- File created at `~/.claude/buddy/memory/debugging-yeti/<slug>.md`.
- If `~/.claude-sdd/` exists in `instances.json`, file mirrored there too.
- No `git add` for global.

- [ ] **Step 5: Re-summon and verify load**

```
/buddy:dismiss
/buddy:summon yeti
```

Expected: `## Memories` section now contains both entries (project under "Project", global under "Global").

- [ ] **Step 6: Test dismiss introspection**

Have a brief debugging-flavored exchange with the Yeti, then:

```
/buddy:dismiss
```

Expected: Yeti reflects, either saves N memories with announces, or says "Nothing new to add" and exits.

- [ ] **Step 7: Cleanup**

```bash
cd /
rm -rf "$TMP"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Two channels (global, project) — Tasks 1, 5, 6
- ✅ POV scoping (`<specialist>/` + `common/`) — Task 5 (protocol), Task 6 (load)
- ✅ Three triggers — Task 8 (explicit), Task 5 (autonomous, in protocol), Task 7 (dismiss)
- ✅ Mirror across CC instances — Tasks 2, 3
- ✅ Dedup via INDEX scan + slug/tag rules — Task 4 (helper), Task 5 (protocol)
- ✅ Stage project, mirror global — Task 5 (protocol)
- ✅ Soft cap warning — Task 6
- ✅ Empty-result rule — Task 5, Task 7
- ✅ Failure modes (gitignored project dir, missing mirror target, parse errors) — Tasks 5, 6
- ✅ Acceptance criteria — covered by Task 10 smoke test

**Type/name consistency:** `memory.py` exposes `current_instance_dir`, `other_instance_dirs`, `mirror_global_write`, `read_index`, `regen_index` — referenced consistently across Tasks 2, 3, 4 and called by name in Task 5's protocol snippet.

**Placeholder check:** No `TBD` / `TODO` / vague "add error handling" lines. Every code step shows the actual code.
