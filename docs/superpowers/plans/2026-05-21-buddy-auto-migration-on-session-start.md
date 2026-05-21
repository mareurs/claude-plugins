# Auto-migrate Legacy Buddy State on SessionStart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a buddy SessionStart, silently merge any leftover per-profile `~/.claude*/buddy/` global state into `${BUDDY_HOME:-~/.buddy}/`, delete the migrated source artifacts, and print a one-line summary — safely, idempotently, lock-guarded, never breaking session start.

**Architecture:** Make the existing migration logic importable (`scripts/migrate_global.py`), add a tested `auto_migrate_if_needed()` orchestrator to `hook_helpers.py` (detect → flock → `migrate.run(apply=True)` → delete known artifacts), and call it from a new first inline-python block in `session-start.sh`, before the memory-nudge block.

**Tech Stack:** Python 3.13+ (pytest via `./.venv/bin/python -m pytest`), Bash, `fcntl.flock` (POSIX). Run from `buddy/`.

**Spec:** `docs/superpowers/specs/2026-05-21-buddy-auto-migration-on-session-start-design.md`.

**Working dir:** `/home/marius/work/claude/claude-plugins`; run tests from `buddy/` via `./.venv/bin/python -m pytest`. Branch: `buddy-global-home` (this extends it). Environment: codescout MCP blocks native Bash/Read/Edit on source — implementers use codescout `read_file`/`create_file`/`edit_code`/`run_command(acknowledge_risk=true)`.

---

### Task 1: Make the migration logic importable (`scripts/migrate_global.py`)

Pure refactor, no behavior change. Move the logic out of the hyphenated (non-importable) `migrate-global-to-home.py` into `scripts/migrate_global.py`; leave a thin CLI wrapper.

**Files:**
- Create: `buddy/scripts/migrate_global.py`
- Modify: `buddy/scripts/migrate-global-to-home.py` (becomes a thin wrapper)
- Modify: `buddy/tests/test_migrate_global.py` (drop the importlib shim)

- [ ] **Step 1: Update the test to import the new module**

In `buddy/tests/test_migrate_global.py`, replace the importlib shim header:

```python
import importlib.util
import time
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "migrate_global",
    Path(__file__).resolve().parent.parent / "scripts" / "migrate-global-to-home.py",
)
migrate = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(migrate)
```

with:

```python
from pathlib import Path

from scripts import migrate_global as migrate
```

Leave the rest of the file (every `migrate.run(...)` call) unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_migrate_global.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.migrate_global'`

- [ ] **Step 3: Create `scripts/migrate_global.py`**

Move the entire current contents of `migrate-global-to-home.py` (the module docstring, imports, `PROFILES`, `CONFIG_TREES`, `CONFIG_FILES`, `_iter_files`, `run`, `_copy`, `main`) into `buddy/scripts/migrate_global.py` verbatim — but DROP the `if __name__ == "__main__":` block (the wrapper keeps it). Read the current file first with `read_file("buddy/scripts/migrate-global-to-home.py")` and copy its body exactly.

- [ ] **Step 4: Replace `migrate-global-to-home.py` with a thin wrapper**

Overwrite `buddy/scripts/migrate-global-to-home.py` with:

```python
#!/usr/bin/env python3
"""CLI entrypoint for the one-time global-state migration.

Real logic lives in scripts/migrate_global.py (importable module name).
This wrapper just makes `python scripts/migrate-global-to-home.py [--apply]`
work by putting the plugin root on sys.path and delegating to main().
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.migrate_global import main

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run tests + the CLI to verify both paths work**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_migrate_global.py -q`
Expected: PASS (7 passed)

Run: `cd buddy && ./.venv/bin/python scripts/migrate-global-to-home.py`
Expected: prints `[DRY-RUN ...] dest=...` with a `sources:`/`copied=` summary, exit 0 (proves the wrapper's sys.path + delegation work).

- [ ] **Step 6: Commit**

```bash
git add buddy/scripts/migrate_global.py buddy/scripts/migrate-global-to-home.py buddy/tests/test_migrate_global.py
git commit -m "refactor(buddy): extract importable scripts/migrate_global.py"
```

---

### Task 2: `_pending_migration_sources()` detection in `hook_helpers.py`

**Files:**
- Modify: `buddy/scripts/hook_helpers.py` (add module constants + function near the other module-level helpers)
- Test: `buddy/tests/test_hook_helpers.py`

- [ ] **Step 1: Write the failing test** (append to `buddy/tests/test_hook_helpers.py`)

```python
def test_pending_migration_sources_detects_artifacts(tmp_path):
    from scripts.hook_helpers import _pending_migration_sources
    (tmp_path / ".claude-sdd" / "buddy" / "skills").mkdir(parents=True)
    (tmp_path / ".claude-kat" / "buddy").mkdir(parents=True)
    (tmp_path / ".claude-kat" / "buddy" / "summons.log").write_text("x\n")
    # .claude has a buddy dir but NO known artifact -> not pending.
    (tmp_path / ".claude" / "buddy").mkdir(parents=True)
    found = _pending_migration_sources(tmp_path)
    names = {p.parent.name for p in found}
    assert names == {".claude-sdd", ".claude-kat"}


def test_pending_migration_sources_empty_when_none(tmp_path):
    from scripts.hook_helpers import _pending_migration_sources
    assert _pending_migration_sources(tmp_path) == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_hook_helpers.py -q -k pending_migration`
Expected: FAIL — `ImportError: cannot import name '_pending_migration_sources'`

- [ ] **Step 3: Implement** (add to `buddy/scripts/hook_helpers.py`)

Add these imports at the top (with the existing `import os` etc.): `import fcntl`, `import shutil`. Also add `from scripts import buddy_paths` and `from scripts import migrate_global` with the other `from scripts import ...` lines.

Add near the top-level helpers (e.g. just below the existing imports / before `detect_plan_touch`):

```python
_LEGACY_PROFILES = (".claude", ".claude-sdd", ".claude-kat")
# Artifacts migrate_global knows how to merge; detection + deletion key on these.
_MIGRATE_ARTIFACTS = ("skills", "memory", "summons.log", "identity.json")


def _pending_migration_sources(home: Path) -> list[Path]:
    """Return each <home>/<profile>/buddy dir that still holds a migratable
    artifact (skills/, memory/, summons.log, identity.json). Keying on the
    artifacts — not merely the buddy dir's existence — means detection goes
    false once they are deleted, even if unrelated files linger."""
    out: list[Path] = []
    for name in _LEGACY_PROFILES:
        buddy = home / name / "buddy"
        if any((buddy / a).exists() for a in _MIGRATE_ARTIFACTS):
            out.append(buddy)
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_hook_helpers.py -q -k pending_migration`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/hook_helpers.py buddy/tests/test_hook_helpers.py
git commit -m "feat(buddy): _pending_migration_sources detection helper"
```

---

### Task 3: `auto_migrate_if_needed()` orchestrator

**Files:**
- Modify: `buddy/scripts/hook_helpers.py` (add the function)
- Test: `buddy/tests/test_hook_helpers.py`

- [ ] **Step 1: Write the failing tests** (append to `buddy/tests/test_hook_helpers.py`)

```python
def _legacy_profile(home, name):
    """Create <home>/<name>/buddy with one skill, one memory, a summons log."""
    b = home / name / "buddy"
    (b / "skills" / "codescout-pika").mkdir(parents=True)
    (b / "skills" / "codescout-pika" / "SKILL.md").write_text("pika\n")
    (b / "memory" / "debugging-yeti").mkdir(parents=True)
    (b / "memory" / "debugging-yeti" / "flaky.md").write_text("lesson\n")
    (b / "summons.log").write_text("2026-01-01 yeti\n")
    return b


def test_auto_migrate_happy_path(tmp_path, monkeypatch):
    from scripts.hook_helpers import auto_migrate_if_needed
    monkeypatch.delenv("BUDDY_NO_AUTO_MIGRATE", raising=False)
    src = _legacy_profile(tmp_path, ".claude-sdd")
    dest = tmp_path / ".buddy"
    line = auto_migrate_if_needed(home=tmp_path, dest=dest)
    # merged into dest
    assert (dest / "skills" / "codescout-pika" / "SKILL.md").read_text() == "pika\n"
    assert (dest / "memory" / "debugging-yeti" / "flaky.md").read_text() == "lesson\n"
    assert (dest / "summons.log").read_text() == "2026-01-01 yeti\n"
    # source artifacts deleted + empty buddy dir removed
    assert not src.exists()
    assert isinstance(line, str) and "migrated" in line
    # idempotent
    assert auto_migrate_if_needed(home=tmp_path, dest=dest) is None


def test_auto_migrate_respects_kill_switch(tmp_path, monkeypatch):
    from scripts.hook_helpers import auto_migrate_if_needed
    monkeypatch.setenv("BUDDY_NO_AUTO_MIGRATE", "1")
    src = _legacy_profile(tmp_path, ".claude-sdd")
    assert auto_migrate_if_needed(home=tmp_path, dest=tmp_path / ".buddy") is None
    assert src.exists()  # untouched


def test_auto_migrate_preserves_unknown_files(tmp_path, monkeypatch):
    from scripts.hook_helpers import auto_migrate_if_needed
    monkeypatch.delenv("BUDDY_NO_AUTO_MIGRATE", raising=False)
    src = _legacy_profile(tmp_path, ".claude-sdd")
    (src / "notes.txt").write_text("keep me\n")
    auto_migrate_if_needed(home=tmp_path, dest=tmp_path / ".buddy")
    assert (src / "notes.txt").read_text() == "keep me\n"  # survived
    assert not (src / "skills").exists()  # known artifact gone
    assert src.exists()  # buddy dir kept (not empty)


def test_auto_migrate_failure_leaves_sources(tmp_path, monkeypatch):
    from scripts import hook_helpers
    monkeypatch.delenv("BUDDY_NO_AUTO_MIGRATE", raising=False)
    src = _legacy_profile(tmp_path, ".claude-sdd")

    def boom(**kwargs):
        raise RuntimeError("disk full")
    monkeypatch.setattr(hook_helpers.migrate_global, "run", boom)
    line = hook_helpers.auto_migrate_if_needed(home=tmp_path, dest=tmp_path / ".buddy")
    assert (src / "skills").exists()  # nothing deleted
    assert isinstance(line, str) and "failed" in line


def test_auto_migrate_skips_when_locked(tmp_path, monkeypatch):
    import fcntl
    from scripts.hook_helpers import auto_migrate_if_needed
    monkeypatch.delenv("BUDDY_NO_AUTO_MIGRATE", raising=False)
    _legacy_profile(tmp_path, ".claude-sdd")
    dest = tmp_path / ".buddy"
    dest.mkdir(parents=True)
    # Hold the lock from this process via a separate fd.
    held = open(dest / ".migrate.lock", "w")
    fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        assert auto_migrate_if_needed(home=tmp_path, dest=dest) is None
    finally:
        fcntl.flock(held, fcntl.LOCK_UN)
        held.close()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_hook_helpers.py -q -k auto_migrate`
Expected: FAIL — `ImportError: cannot import name 'auto_migrate_if_needed'`

- [ ] **Step 3: Implement** (add to `buddy/scripts/hook_helpers.py`, after `_pending_migration_sources`)

```python
def auto_migrate_if_needed(home: Path | None = None, dest: Path | None = None) -> str | None:
    """Detect leftover per-profile global buddy state and migrate it into the
    unified home, then delete the migrated source artifacts. Returns a one-line
    summary (or warning) for the hook to print, or None when there's nothing to
    do / another instance is handling it / the kill-switch is set.

    Never raises — a SessionStart hook must not break on migration failure.
    """
    if os.environ.get("BUDDY_NO_AUTO_MIGRATE"):
        return None
    home = home or Path.home()
    dest = dest or buddy_paths.global_root()
    sources = _pending_migration_sources(home)
    if not sources:
        return None
    try:
        dest.mkdir(parents=True, exist_ok=True)
        with open(dest / ".migrate.lock", "w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return None  # another CC instance is migrating
            stats = migrate_global.run(home=home, dest=dest, apply=True)
            for src in sources:
                for tree in ("skills", "memory"):
                    p = src / tree
                    if p.is_dir():
                        shutil.rmtree(p)
                for fname in ("summons.log", "identity.json"):
                    p = src / fname
                    if p.is_file():
                        p.unlink()
                try:
                    src.rmdir()  # only succeeds if now empty
                except OSError:
                    pass
        return (f"→ buddy: migrated {stats['copied']} file(s) from "
                f"{len(sources)} profile(s) into {dest}; removed legacy dirs")
    except Exception as e:  # noqa: BLE001 - hook must never raise
        return (f"→ buddy: auto-migration failed ({e}); legacy dirs left "
                f"in place — run scripts/migrate-global-to-home.py --apply")
```

- [ ] **Step 4: Run to verify pass**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_hook_helpers.py -q -k auto_migrate`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/hook_helpers.py buddy/tests/test_hook_helpers.py
git commit -m "feat(buddy): auto_migrate_if_needed orchestrator (lock, apply, delete)"
```

---

### Task 4: Wire into `session-start.sh`

**Files:**
- Modify: `buddy/hooks/session-start.sh` (insert a new block after the `DEAD_GLOBAL` cleanup, before the memory-nudge block)

- [ ] **Step 1: Insert the auto-migration block**

In `buddy/hooks/session-start.sh`, find the lines:

```bash
# One-shot migration: remove dead global state.json
DEAD_GLOBAL="$HOME/.claude/buddy/state.json"
[ -f "$DEAD_GLOBAL" ] && rm -f "$DEAD_GLOBAL" 2>/dev/null || true

# Memory consolidation nudges (capacity + stale-since).
```

Insert BETWEEN the `DEAD_GLOBAL` line and the `# Memory consolidation nudges` comment:

```bash
# Auto-migrate legacy per-profile global state (~/.claude*/buddy) into ~/.buddy.
# Runs before nudges so the nudge block sees the merged memory on first session.
MIGRATE_LINE=$(python3 -c "
import sys
sys.path.insert(0, '$PLUGIN_ROOT')
from scripts.hook_helpers import auto_migrate_if_needed
line = auto_migrate_if_needed()
if line:
    print(line)
" 2>/dev/null)
[ -n "$MIGRATE_LINE" ] && echo "$MIGRATE_LINE"

```

- [ ] **Step 2: Smoke-test the block end-to-end**

Run (creates a temp HOME with a legacy profile, points BUDDY_HOME at a temp dest, runs the exact block body, asserts it migrates):

```bash
cd buddy && rm -rf /tmp/bms && mkdir -p /tmp/bms/home/.claude-sdd/buddy/skills/codescout-pika && \
echo "pika" > /tmp/bms/home/.claude-sdd/buddy/skills/codescout-pika/SKILL.md && \
HOME=/tmp/bms/home BUDDY_HOME=/tmp/bms/dest PLUGIN_ROOT=$(pwd) ./.venv/bin/python -c "
import sys; sys.path.insert(0, '$(pwd)')
from scripts.hook_helpers import auto_migrate_if_needed
line = auto_migrate_if_needed()
print(line)
import os
print('dest has pika:', os.path.exists('/tmp/bms/dest/skills/codescout-pika/SKILL.md'))
print('source gone:', not os.path.exists('/tmp/bms/home/.claude-sdd/buddy'))
"
```

Expected output: a `→ buddy: migrated 1 file(s) ...` line, then `dest has pika: True` and `source gone: True`.

Note: `auto_migrate_if_needed()` reads `BUDDY_HOME` via `buddy_paths.global_root()`, so the env-driven default resolves the temp dest. Clean up: `rm -rf /tmp/bms`.

- [ ] **Step 3: Confirm the hook still parses / runs**

Run: `cd buddy && echo '{"cwd":"/tmp","session_id":"smoke"}' | BUDDY_NO_AUTO_MIGRATE=1 bash hooks/session-start.sh >/dev/null 2>&1; echo "exit=$?"`
Expected: `exit=0` (hook runs cleanly; kill-switch avoids touching real `~/.claude*` during the smoke run).

- [ ] **Step 4: Commit**

```bash
git add buddy/hooks/session-start.sh
git commit -m "feat(buddy): session-start auto-migrates legacy global state"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full buddy suite**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/ -q`
Expected: PASS — all green (baseline 361 + the new detection/orchestrator tests).

- [ ] **Step 2: Confirm no stray references to the old script-import path**

Run (repo root): `grep -rn "spec_from_file_location" buddy/tests` — expect no match for the migration test (it now imports `scripts.migrate_global`).

- [ ] **Step 3: Report**

Report suite status and confirm: the wrapper CLI still works, auto-migration is gated by `BUDDY_NO_AUTO_MIGRATE`, and the manual `migrate-global-to-home.py --apply` path is unchanged.

---

## Notes & Risks

- **`fcntl` is POSIX-only.** Buddy is Linux-developed (this machine). If `import fcntl` ever needs to run on Windows, the `except Exception` in `auto_migrate_if_needed` would catch a failed lock acquisition path — but the `import fcntl` at module top would fail first. Acceptable per project platform assumptions; document only.
- **Silent deletion safety:** data is copied (and conflicts backed up to `<dest>/.migration-backup/`) by `migrate_global.run` before any source artifact is deleted; only the four known artifacts are removed; any failure aborts before deletion; `BUDDY_NO_AUTO_MIGRATE=1` disables the whole path.
- **Lock file residue:** `<dest>/.migrate.lock` remains as an empty file after migration — harmless and reused on any future run.
- **Ordering:** the block runs before nudges (spec choice b), so the first post-upgrade session already shows global nudges from the freshly-merged memory.
