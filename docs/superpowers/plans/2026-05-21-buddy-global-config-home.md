# Unify Global Buddy State Under `~/.buddy/` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all global buddy state (specialists, memories, `summons.log`, `identity.json`) out of per-profile `~/.claude*/buddy/` into a single profile-agnostic `${BUDDY_HOME:-$HOME/.buddy}/`, with a one-time merge migration and removal of the cross-instance mirroring machinery.

**Architecture:** A new `scripts/buddy_paths.py` is the single source of truth for global locations; Python callers import it, the bash discovery script reads `${BUDDY_HOME:-$HOME/.buddy}` directly. A standalone migration script merges the three profiles into `~/.buddy` (newest-mtime wins for config files, union for the log). The `memory.mirror_global_write` chain and its `instances.json` registry are deleted.

**Tech Stack:** Python 3.13+ (pytest, `./.venv/bin/python -m pytest tests/`), Bash, run from `buddy/` package root.

**Spec:** `docs/superpowers/specs/2026-05-21-buddy-global-config-home-design.md`. Note: spec §1 listed skills/memory/summons.log; this plan also relocates `identity.json` (same per-profile `buddy/` dir, clearly global) — a deliberate spec addendum.

**Working directory for all commands:** `/home/marius/work/claude/claude-plugins/buddy` unless stated otherwise. Tests run via `./.venv/bin/python -m pytest`.

---

### Task 1: `buddy_paths.py` — single source of truth for global locations

**Files:**
- Create: `buddy/scripts/buddy_paths.py`
- Test: `buddy/tests/test_buddy_paths.py`

- [ ] **Step 1: Write the failing test**

```python
# buddy/tests/test_buddy_paths.py
"""Tests for buddy_paths — resolved global-state locations."""
from pathlib import Path

from scripts import buddy_paths


def test_default_root_is_home_dot_buddy(monkeypatch, tmp_path):
    monkeypatch.delenv("BUDDY_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert buddy_paths.global_root() == tmp_path / ".buddy"


def test_buddy_home_env_overrides(monkeypatch, tmp_path):
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "custom"))
    assert buddy_paths.global_root() == tmp_path / "custom"


def test_buddy_home_expands_user(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("BUDDY_HOME", "~/elsewhere")
    assert buddy_paths.global_root() == tmp_path / "elsewhere"


def test_accessors_compose_on_root(monkeypatch, tmp_path):
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "b"))
    root = tmp_path / "b"
    assert buddy_paths.global_skills() == root / "skills"
    assert buddy_paths.global_memory() == root / "memory"
    assert buddy_paths.summons_log() == root / "summons.log"
    assert buddy_paths.identity_path() == root / "identity.json"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_buddy_paths.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.buddy_paths'`

- [ ] **Step 3: Write minimal implementation**

```python
# buddy/scripts/buddy_paths.py
"""Resolved filesystem locations for buddy's profile-agnostic global state.

All global buddy state (specialists, memories, summons log, identity) lives
under a single home shared by every CC instance — default ~/.buddy, overridable
via $BUDDY_HOME. This module is the single source of truth for those paths so
no caller hardcodes a per-profile `~/.claude*/buddy` location.
"""
from __future__ import annotations

import os
from pathlib import Path


def global_root() -> Path:
    env = os.environ.get("BUDDY_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".buddy"


def global_skills() -> Path:
    return global_root() / "skills"


def global_memory() -> Path:
    return global_root() / "memory"


def summons_log() -> Path:
    return global_root() / "summons.log"


def identity_path() -> Path:
    return global_root() / "identity.json"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_buddy_paths.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/buddy_paths.py buddy/tests/test_buddy_paths.py
git commit -m "feat(buddy): buddy_paths helper for profile-agnostic ~/.buddy"
```

---

### Task 2: Migration script `migrate-global-to-home.py`

Merges the three profiles' `buddy/` dirs into `~/.buddy`. Dry-run by default; `--apply` executes. Config files (skills/, memory/, identity.json): copy-if-absent, skip-if-identical, newest-mtime-wins-if-divergent (loser archived). `summons.log`: union + sort + dedupe.

**Files:**
- Create: `buddy/scripts/migrate-global-to-home.py`
- Test: `buddy/tests/test_migrate_global.py`

- [ ] **Step 1: Write the failing test**

```python
# buddy/tests/test_migrate_global.py
"""Tests for migrate-global-to-home.py — per-profile → ~/.buddy merge."""
import importlib.util
import time
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "migrate_global",
    Path(__file__).resolve().parent.parent / "scripts" / "migrate-global-to-home.py",
)
migrate = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(migrate)


def _profile(home: Path, name: str):
    d = home / name / "buddy"
    d.mkdir(parents=True)
    return d


def test_copies_absent_files(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    p = _profile(home, ".claude-sdd")
    (p / "skills" / "codescout-pika").mkdir(parents=True)
    (p / "skills" / "codescout-pika" / "SKILL.md").write_text("pika\n")
    migrate.run(home=home, dest=dest, apply=True)
    assert (dest / "skills" / "codescout-pika" / "SKILL.md").read_text() == "pika\n"


def test_identical_is_deduped_no_backup(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    for prof in (".claude-sdd", ".claude-kat"):
        p = _profile(home, prof)
        (p / "skills" / "x").mkdir(parents=True)
        (p / "skills" / "x" / "SKILL.md").write_text("same\n")
    migrate.run(home=home, dest=dest, apply=True)
    assert (dest / "skills" / "x" / "SKILL.md").read_text() == "same\n"
    assert not (dest / ".migration-backup").exists()


def test_divergent_newest_wins_loser_archived(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    older = _profile(home, ".claude-sdd")
    (older / "skills" / "x").mkdir(parents=True)
    f_old = older / "skills" / "x" / "SKILL.md"
    f_old.write_text("OLD\n")
    newer = _profile(home, ".claude-kat")
    (newer / "skills" / "x").mkdir(parents=True)
    f_new = newer / "skills" / "x" / "SKILL.md"
    f_new.write_text("NEW\n")
    # Force mtime ordering: sdd older, kat newer.
    import os
    os.utime(f_old, (1000, 1000))
    os.utime(f_new, (2000, 2000))
    migrate.run(home=home, dest=dest, apply=True)
    assert (dest / "skills" / "x" / "SKILL.md").read_text() == "NEW\n"
    backups = list((dest / ".migration-backup").rglob("SKILL.md"))
    assert any(b.read_text() == "OLD\n" for b in backups)


def test_summons_log_union_sorted_deduped(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    a = _profile(home, ".claude")
    (a / "summons.log").write_text("2026-01-02 yeti\n2026-01-01 crane\n")
    b = _profile(home, ".claude-sdd")
    (b / "summons.log").write_text("2026-01-02 yeti\n2026-01-03 ibex\n")
    migrate.run(home=home, dest=dest, apply=True)
    lines = (dest / "summons.log").read_text().splitlines()
    assert lines == ["2026-01-01 crane", "2026-01-02 yeti", "2026-01-03 ibex"]


def test_dry_run_writes_nothing(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    p = _profile(home, ".claude-sdd")
    (p / "skills" / "x").mkdir(parents=True)
    (p / "skills" / "x" / "SKILL.md").write_text("y\n")
    migrate.run(home=home, dest=dest, apply=False)
    assert not dest.exists()


def test_idempotent_rerun_is_noop(tmp_path):
    home = tmp_path
    dest = tmp_path / ".buddy"
    p = _profile(home, ".claude-sdd")
    (p / "skills" / "x").mkdir(parents=True)
    (p / "skills" / "x" / "SKILL.md").write_text("y\n")
    first = migrate.run(home=home, dest=dest, apply=True)
    second = migrate.run(home=home, dest=dest, apply=True)
    assert second["copied"] == 0
    assert second["conflicts"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/python -m pytest tests/test_migrate_global.py -q`
Expected: FAIL — `FileNotFoundError` / module load error (script does not exist)

- [ ] **Step 3: Write minimal implementation**

```python
# buddy/scripts/migrate-global-to-home.py
"""One-time, idempotent migration of per-profile global buddy state into a
single profile-agnostic home (default ~/.buddy).

Config trees (skills/, memory/, plus identity.json): copy-if-absent,
skip-if-identical, newest-mtime-wins-if-divergent (loser archived under
<dest>/.migration-backup/<profile>/<relpath>). summons.log: union of all
profiles, sorted, deduped.

Source profiles are left in place; delete them by hand once verified.
Dry-run by default; pass --apply to write.
"""
from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

PROFILES = (".claude", ".claude-sdd", ".claude-kat")
# Per-file config trees migrated with newest-wins semantics.
CONFIG_TREES = ("skills", "memory")
# Single config files at the buddy/ root migrated with newest-wins semantics.
CONFIG_FILES = ("identity.json",)


def _iter_files(root: Path):
    for p in sorted(root.rglob("*")):
        if p.is_file():
            yield p


def run(*, home: Path, dest: Path, apply: bool) -> dict:
    home = Path(home)
    dest = Path(dest)
    sources = [home / name / "buddy" for name in PROFILES if (home / name / "buddy").is_dir()]
    stats = {"copied": 0, "skipped": 0, "conflicts": 0, "backups": 0, "sources": [str(s) for s in sources]}
    summons_lines: set[str] = set()

    for src in sources:
        profile = src.parent.name  # e.g. ".claude-sdd"

        # 1. summons.log → collect for union.
        slog = src / "summons.log"
        if slog.is_file():
            summons_lines.update(
                ln for ln in slog.read_text().splitlines() if ln.strip()
            )

        # 2. config trees + single config files → newest-wins per relative path.
        members: list[Path] = []
        for tree in CONFIG_TREES:
            tdir = src / tree
            if tdir.is_dir():
                members.extend(_iter_files(tdir))
        for fname in CONFIG_FILES:
            f = src / fname
            if f.is_file():
                members.append(f)

        for srcf in members:
            rel = srcf.relative_to(src)
            destf = dest / rel
            if not destf.exists():
                _copy(srcf, destf, apply)
                stats["copied"] += 1
            elif filecmp.cmp(srcf, destf, shallow=False):
                stats["skipped"] += 1
            else:
                # Divergent: newest mtime wins; loser archived.
                if srcf.stat().st_mtime > destf.stat().st_mtime:
                    loser, winner = destf, srcf
                else:
                    loser, winner = srcf, destf
                backup = dest / ".migration-backup" / profile / rel
                _copy(loser, backup, apply)
                if winner is srcf:
                    _copy(srcf, destf, apply)
                stats["conflicts"] += 1
                stats["backups"] += 1

    # 3. write unioned summons.log.
    if summons_lines:
        out = "\n".join(sorted(summons_lines)) + "\n"
        if apply:
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "summons.log").write_text(out)

    return stats


def _copy(src: Path, dst: Path, apply: bool) -> None:
    if not apply:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Merge per-profile global buddy state into ~/.buddy")
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    ap.add_argument("--home", default=str(Path.home()), help="HOME containing the .claude* profiles")
    ap.add_argument("--dest", default=None, help="destination (default: $BUDDY_HOME or <home>/.buddy)")
    args = ap.parse_args(argv)

    home = Path(args.home)
    if args.dest:
        dest = Path(args.dest)
    else:
        import os
        dest = Path(os.environ["BUDDY_HOME"]).expanduser() if os.environ.get("BUDDY_HOME") else home / ".buddy"

    stats = run(home=home, dest=dest, apply=args.apply)
    mode = "APPLIED" if args.apply else "DRY-RUN (no changes written; pass --apply)"
    print(f"[{mode}] dest={dest}")
    print(f"  sources: {', '.join(stats['sources']) or '(none)'}")
    print(f"  copied={stats['copied']} skipped={stats['skipped']} "
          f"conflicts={stats['conflicts']} backups={stats['backups']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/python -m pytest tests/test_migrate_global.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/migrate-global-to-home.py buddy/tests/test_migrate_global.py
git commit -m "feat(buddy): one-time migration of global state into ~/.buddy"
```

---

### Task 3: Point `discover-specialists.sh` global scope at `~/.buddy/skills`

Drop the `CLAUDE_CONFIG_DIR`/ancestor-walk global resolution (interim from `d7b0982`); global scope is now unconditionally `${BUDDY_HOME:-$HOME/.buddy}/skills`. Keep self-location and project scope. `--claude-dir` mode is removed (create.md will use `buddy_paths`/the global skills path instead — handled in Task 8).

**Files:**
- Modify: `buddy/scripts/discover-specialists.sh`
- Test: `buddy/tests/test_discover_specialists.py` (rewrite global cases)

- [ ] **Step 1: Update the test to the new contract**

Replace the body of `buddy/tests/test_discover_specialists.py` global/`--claude-dir` cases with these (keep `_run`, `_make_specialist`, `_scopes`, `test_builtin_scope_discovered`, `test_project_scope_via_claude_project_dir` unchanged; the `_run` helper still pops `CLAUDE_CONFIG_DIR`/`CLAUDE_PLUGIN_ROOT`). Add a `BUDDY_HOME` knob:

```python
def test_global_scope_via_buddy_home(tmp_path):
    """Global specialists resolve from $BUDDY_HOME/skills, no profile logic."""
    bhome = tmp_path / "buddyhome"
    _make_specialist(bhome / "skills", "codescout-pika")
    r = _run(cwd=tmp_path, env={"BUDDY_HOME": str(bhome)})
    assert r.returncode == 0, r.stderr
    assert ("global", "codescout-pika") in _scopes(r.stdout)


def test_default_global_root_is_home_dot_buddy(tmp_path):
    """With no BUDDY_HOME, global scope is $HOME/.buddy/skills."""
    _make_specialist(tmp_path / ".buddy" / "skills", "home-spec")
    r = _run(cwd=tmp_path, env={"HOME": str(tmp_path)})
    assert r.returncode == 0, r.stderr
    assert ("global", "home-spec") in _scopes(r.stdout)


def test_no_buddy_home_dir_is_silent(tmp_path):
    r = _run(cwd=tmp_path, env={"HOME": str(tmp_path)})
    assert r.returncode == 0, r.stderr
    assert not any(scope == "global" for scope, _ in _scopes(r.stdout))
```

Delete the now-obsolete tests: `test_global_scope_via_claude_config_dir`, `test_config_dir_without_buddy_skills_is_silent`, `test_ancestor_walk_fallback_when_config_dir_unset`, `test_config_dir_takes_precedence_over_ancestor_walk`, `test_claude_dir_mode_prints_resolved_profile`, `test_claude_dir_mode_empty_when_unresolvable`. Also extend `_run` to NOT pop `BUDDY_HOME` (it does not pop it today — verify it only pops `CLAUDE_CONFIG_DIR`, `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`; add `e.pop("BUDDY_HOME", None)` so inherited env never leaks, then set it per-test via `env=`).

- [ ] **Step 2: Run to verify failure**

Run: `./.venv/bin/python -m pytest tests/test_discover_specialists.py -q`
Expected: FAIL — new tests fail (script still uses CLAUDE_CONFIG_DIR; `BUDDY_HOME` ignored).

- [ ] **Step 3: Rewrite the script's global resolution**

Replace the whole `CLAUDE_DIR` block and the `--claude-dir` block in `buddy/scripts/discover-specialists.sh` so the body becomes:

```bash
#!/usr/bin/env bash
# Discover buddy specialists across three scopes and print one
# "scope name abspath" line per specialist (a subdir containing SKILL.md).
# Precedence (project > global > builtin) is applied by the caller.
#
#   PLUGIN_ROOT (builtin): self-located from this script's path. Do NOT trust
#     CLAUDE_PLUGIN_ROOT — it can arrive unset or as a bare slug (commit 5a02546).
#   GLOBAL (global): ${BUDDY_HOME:-$HOME/.buddy}/skills — profile-agnostic,
#     shared by every CC instance (see buddy_paths.py).
#   PROJECT (project): ${CLAUDE_PROJECT_DIR:-$PWD}/.buddy/skills.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUDDY_HOME_DIR="${BUDDY_HOME:-$HOME/.buddy}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

scan() {
  local scope="$1" root="$2" dir
  [ -z "$root" ] && return 0
  [ -d "$root" ] || return 0
  for dir in "$root"/*/; do
    [ -f "${dir}SKILL.md" ] || continue
    echo "$scope $(basename "$dir") ${dir%/}"
  done
}

scan builtin "$PLUGIN_ROOT/skills"
scan global  "$BUDDY_HOME_DIR/skills"
scan project "$PROJECT_DIR/.buddy/skills"
```

- [ ] **Step 4: Run to verify pass**

Run: `./.venv/bin/python -m pytest tests/test_discover_specialists.py -q`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/discover-specialists.sh buddy/tests/test_discover_specialists.py
git commit -m "refactor(buddy): discover global specialists from ~/.buddy/skills"
```

---

### Task 4: Point `reload.py` global SKILL.md lookup at `~/.buddy/skills`

`find_skill_md` (around `buddy/scripts/reload.py:97-101`) lists global as `home / ".claude" / "buddy" / "skills"`. Switch it to `buddy_paths.global_skills()`. Leave project (line 99) and sister/builtin scopes unchanged — the project-scope `.claude/buddy/skills` vs discovery's `.buddy/skills` discrepancy is pre-existing and out of scope (noted in Risks).

**Files:**
- Modify: `buddy/scripts/reload.py` (import + global candidate line)
- Test: `buddy/tests/test_reload.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_reload.py`)

```python
def test_global_skill_resolved_from_buddy_home(tmp_path, monkeypatch):
    from scripts.reload import find_skill_md
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))
    skill = tmp_path / "bh" / "skills" / "codescout-pika" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("# pika\n")
    found = find_skill_md(
        "codescout-pika",
        plugin_root=tmp_path / "plugin",
        project_root=tmp_path / "proj",
        home=tmp_path / "unused-home",
    )
    assert found == skill
```

- [ ] **Step 2: Run to verify failure**

Run: `./.venv/bin/python -m pytest tests/test_reload.py::test_global_skill_resolved_from_buddy_home -q`
Expected: FAIL — resolves under `home/.claude/buddy/skills`, not `BUDDY_HOME`.

- [ ] **Step 3: Edit `reload.py`**

Add import near the top of the module (with the other imports):

```python
from scripts import buddy_paths
```

Replace the global candidate in the `candidates` list:

```python
    candidates = [
        project_root / ".claude" / "buddy" / "skills" / directory / "SKILL.md",
        buddy_paths.global_skills() / directory / "SKILL.md",
        plugin_root / "skills" / directory / "SKILL.md",
    ]
```

Update the docstring line 2 (`global: <home>/.claude/buddy/skills/...`) to `global: ${BUDDY_HOME:-~/.buddy}/skills/<directory>/SKILL.md`.

- [ ] **Step 4: Run to verify pass**

Run: `./.venv/bin/python -m pytest tests/test_reload.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/reload.py buddy/tests/test_reload.py
git commit -m "refactor(buddy): reload global SKILL.md from ~/.buddy/skills"
```

---

### Task 5: Point `statusline.py` `BUDDY_DIR`/`identity.json` at `~/.buddy`

**Files:**
- Modify: `buddy/scripts/statusline.py:24-25`
- Test: `buddy/tests/test_statusline.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_statusline.py`)

```python
def test_identity_path_under_buddy_home(monkeypatch, tmp_path):
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))
    import importlib
    from scripts import statusline
    importlib.reload(statusline)
    assert statusline.IDENTITY_PATH == tmp_path / "bh" / "identity.json"
```

- [ ] **Step 2: Run to verify failure**

Run: `./.venv/bin/python -m pytest tests/test_statusline.py::test_identity_path_under_buddy_home -q`
Expected: FAIL — `IDENTITY_PATH` is `~/.claude/buddy/identity.json`.

- [ ] **Step 3: Edit `statusline.py`**

Replace lines 24-25:

```python
from scripts import buddy_paths

BUDDY_DIR = buddy_paths.global_root()
IDENTITY_PATH = buddy_paths.identity_path()
```

(Place the `from scripts import buddy_paths` with the other imports at the top; keep only the two assignments where lines 24-25 were.)

- [ ] **Step 4: Run to verify pass**

Run: `./.venv/bin/python -m pytest tests/test_statusline.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/statusline.py buddy/tests/test_statusline.py
git commit -m "refactor(buddy): statusline identity/state under ~/.buddy"
```

---

### Task 6: Update `consolidate.py` — paths, scope inference, and remove mirror caller

Four edits: (a) `_default_summons_log` → `buddy_paths.summons_log()`; (b) `apply_plan_from_cache` global root → `buddy_paths.global_memory()` (drops `current_instance_dir` import); (c) `_infer_scope` path-anchored against `global_memory()`; (d) delete `_mirror_global_if_available` and its call site.

**Files:**
- Modify: `buddy/scripts/consolidate.py` (lines ~395-398, ~678-679, ~684-746)
- Test: `buddy/tests/test_consolidate_apply.py` (or `test_consolidate_validation.py` — pick the file that already imports `_infer_scope`; add there)

- [ ] **Step 1: Write the failing tests**

Add to the consolidate test module that already imports from `scripts.consolidate`:

```python
def test_infer_scope_buddy_home_memory_is_global(monkeypatch, tmp_path):
    from scripts import consolidate
    monkeypatch.setenv("BUDDY_HOME", str(tmp_path / "bh"))
    root = tmp_path / "bh" / "memory"
    assert consolidate._infer_scope(root) == "global"


def test_infer_scope_project_buddy_is_project(tmp_path):
    from scripts import consolidate
    root = tmp_path / "myproj" / ".buddy" / "memory"
    assert consolidate._infer_scope(root) == "project"


def test_no_mirror_helper_remains():
    from scripts import consolidate
    assert not hasattr(consolidate, "_mirror_global_if_available")
```

- [ ] **Step 2: Run to verify failure**

Run: `./.venv/bin/python -m pytest tests/test_consolidate_apply.py -q -k "infer_scope or mirror"`
Expected: FAIL — `_infer_scope` substring logic misclassifies `~/.buddy/memory` as project; `_mirror_global_if_available` still exists.

- [ ] **Step 3: Edit `consolidate.py`**

Add import at top: `from scripts import buddy_paths`.

Replace `_default_summons_log` (≈678-679):

```python
def _default_summons_log() -> Path:
    return buddy_paths.summons_log()
```

Replace `_infer_scope` (≈395-398):

```python
def _infer_scope(channel_root: Path) -> str:
    """Scope by location: at/under the global memory root → 'global', else 'project'.

    Path-anchored (not substring) because the global home (~/.buddy/memory) and
    project channels (<repo>/.buddy/memory) both contain the literal '.buddy'.
    """
    try:
        Path(channel_root).resolve().relative_to(buddy_paths.global_memory().resolve())
        return "global"
    except ValueError:
        return "project"
```

In `apply_plan_from_cache` (≈684-700), replace the `current_instance_dir`-based global root with:

```python
def apply_plan_from_cache() -> str:
    """Walk both channel roots, find cached plans, apply each."""
    summary: list[str] = []
    candidates: list[tuple[Path, str]] = []

    global_root = buddy_paths.global_memory()
    if (global_root / ".consolidation-plan.yaml").is_file():
        candidates.append((global_root, "global"))

    project_root = Path.cwd() / ".buddy" / "memory"
    if (project_root / ".consolidation-plan.yaml").is_file():
        candidates.append((project_root, "project"))
    ...
```

In the same function's loop, **delete** the global-mirror block:

```python
        # Mirror global writes to other CC instances.
        if scope == "global":
            _mirror_global_if_available(channel_root, plan)
```

Then **delete the entire `_mirror_global_if_available` function** (≈730-746).

- [ ] **Step 4: Run to verify pass**

Run: `./.venv/bin/python -m pytest tests/test_consolidate_apply.py tests/test_consolidate_validation.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/consolidate.py buddy/tests/test_consolidate_apply.py
git commit -m "refactor(buddy): consolidate uses ~/.buddy, drop mirror caller"
```

---

### Task 7: Delete the mirroring machinery from `memory.py`

Remove `mirror_global_write`, `other_instance_dirs`, `current_instance_dir`, `_load_registry`, `INSTANCES_REGISTRY`; delete `data/instances.json`. Confirmed (this session) those symbols are referenced only by the now-removed consolidate mirror caller and `test_memory.py`.

**Files:**
- Modify: `buddy/scripts/memory.py` (delete lines ~18-78 covering the registry + instance funcs; keep `_parse_entry`, `regen_index`, `read_index`, `read_channel_meta`, `write_channel_meta`, `update_last_consolidated`)
- Delete: `buddy/data/instances.json`
- Test: `buddy/tests/test_memory.py` (remove mirror tests)

- [ ] **Step 1: Update the test to assert removal** (edit `tests/test_memory.py`)

Delete every test that imports/calls `mirror_global_write`, `other_instance_dirs`, or `current_instance_dir`. Add one guard test:

```python
def test_mirror_machinery_removed():
    from scripts import memory
    for gone in ("mirror_global_write", "other_instance_dirs",
                 "current_instance_dir", "_load_registry"):
        assert not hasattr(memory, gone), f"{gone} should be deleted"
```

- [ ] **Step 2: Run to verify failure**

Run: `./.venv/bin/python -m pytest tests/test_memory.py -q`
Expected: FAIL — symbols still present (and any leftover mirror tests error on import).

- [ ] **Step 3: Edit `memory.py`**

Remove the module docstring's "and copying global memories between them" clause. Delete `import json`, `import os`, `import shutil` **only if** unused after removal (verify with the test run; `re` and `Path` stay). Delete `INSTANCES_REGISTRY`, `_load_registry`, `current_instance_dir`, `other_instance_dirs`, `mirror_global_write`. The module now starts (after imports) at `_FRONTMATTER_RE`.

Then:

```bash
git rm buddy/data/instances.json
```

- [ ] **Step 4: Run to verify pass**

Run: `./.venv/bin/python -m pytest tests/test_memory.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/memory.py buddy/tests/test_memory.py
git commit -m "refactor(buddy): delete cross-instance mirror machinery"
```

---

### Task 8: Update command + protocol prose to `~/.buddy`

Pure documentation: the slash-command markdown and `memory-protocol.md` still describe per-profile global paths and the (now-deleted) mirror step. No code tests; verified by grep.

**Files:**
- Modify: `buddy/commands/summon.md` (lines 18, 133, 192)
- Modify: `buddy/commands/create.md` (lines 41, 149)
- Modify: `buddy/commands/consolidate.md` (line 47)
- Modify: `buddy/commands/dismiss.md` (line 74)
- Modify: `buddy/commands/introspect.md` (line 55)
- Modify: `buddy/commands/status.md` (line 5)
- Modify: `buddy/commands/check.md` (line 5)
- Modify: `buddy/commands/remember.md` (line 41)
- Modify: `buddy/data/memory-protocol.md` (lines 19-20, 79, 95-107, 111)

- [ ] **Step 1: Apply the prose edits**

Use `edit_markdown` for each. The substitutions:

- **summon.md:18** global scope: `<claude-dir>/buddy/skills/` → `${BUDDY_HOME:-~/.buddy}/skills/` and drop the `<claude-dir>` derivation sentence (the script handles it).
- **summon.md:133** "Global root: pick the current CC instance dir … `<claude-dir>/buddy/memory/`." → "Global root: `${BUDDY_HOME:-~/.buddy}/memory/` (profile-agnostic; see `scripts/buddy_paths.py`)."
- **summon.md:192**, **dismiss.md:74**, **introspect.md:55**: `~/.claude/buddy/summons.log` → `${BUDDY_HOME:-~/.buddy}/summons.log`.
- **status.md:5**, **check.md:5**: `~/.claude/buddy/identity.json` → `${BUDDY_HOME:-~/.buddy}/identity.json`.
- **create.md:41**: replace the `${CLAUDE_DIR}`/`--claude-dir` resolution with: "`global` → `${BUDDY_HOME:-~/.buddy}/skills/<dir>/`".
- **create.md:149** write block: `DST="${CLAUDE_DIR}/buddy/skills/<dir>"` → `DST="${BUDDY_HOME:-$HOME/.buddy}/skills/<dir>"`; delete the preceding `CLAUDE_DIR="$(... --claude-dir)"` line.
- **consolidate.md:47**: `Global channel: <current-instance-dir>/buddy/memory/` → `Global channel: ${BUDDY_HOME:-~/.buddy}/memory/`.
- **remember.md:41**: "Stage (project) or mirror (global)." → "Stage (project) or write to `${BUDDY_HOME:-~/.buddy}/memory/` (global). No mirroring — one shared home."
- **memory-protocol.md:19-20**: Global row path → `${BUDDY_HOME:-~/.buddy}/memory/`.
- **memory-protocol.md:79**: "Global: `rm <path>` and re-mirror." → "Global: `rm <path>` (single home; no re-mirror)."
- **memory-protocol.md:95-107**: delete the entire "mirror it to other instances" subsection including the `mirror_global_write` code block.
- **memory-protocol.md:111**: leave the project-write fallback line; ensure it no longer says "global still works" via mirror — reword to "global write goes to the shared `~/.buddy/memory/`."

- [ ] **Step 2: Verify no stale global references remain**

Run (from repo root `/home/marius/work/claude/claude-plugins`):

```bash
grep -rn 'mirror_global_write\|/.claude/buddy\|current-instance-dir\|<claude-dir>/buddy' buddy/commands buddy/data
```

Expected: no matches (exit 1). If any line legitimately refers to project `.claude/buddy` (e.g. reload's project scope docs), confirm it is project-scoped, not global.

- [ ] **Step 3: Commit**

```bash
git add buddy/commands buddy/data/memory-protocol.md
git commit -m "docs(buddy): command + protocol prose target ~/.buddy"
```

---

### Task 9: Full-suite verification + migration dry-run

**Files:** none (verification only).

- [ ] **Step 1: Run the full buddy suite**

Run (from `buddy/`): `./.venv/bin/python -m pytest tests/ -q`
Expected: PASS — all green (baseline was 352 before this work; net count changes as mirror tests are removed and new tests added).

- [ ] **Step 2: Run the migration in dry-run against the real machine**

Run (from `buddy/`): `./.venv/bin/python scripts/migrate-global-to-home.py`
Expected: prints `[DRY-RUN …] dest=/home/marius/.buddy`, lists the three source profiles found, and a non-zero `copied=` reflecting `codescout-pika` + the `data-leakage-snow-pheasant` memory + `summons.log`. **Do not pass `--apply` automatically** — show the dry-run output to the user and let them approve the real migration.

- [ ] **Step 3: Commit (if any verification-driven fixups were needed)**

```bash
git add -A && git commit -m "chore(buddy): verify ~/.buddy unification"
```

- [ ] **Step 4: Hand back to the user**

Report: suite status, dry-run summary, and the two manual follow-ups — (1) run `--apply` once approved, then delete the per-profile `~/.claude*/buddy/` dirs after verifying; (2) decide whether this warrants a buddy version bump (it changes shipped commands + scripts) per the `CLAUDE.md` bump ritual.

---

## Notes & Risks

- **Project-scope discrepancy (pre-existing, out of scope):** `reload.py` lists project skills under `<project>/.claude/buddy/skills`, while `discover-specialists.sh` uses `<project>/.buddy/skills`. This plan does not reconcile them; flag for a follow-up.
- **Version bump:** changes shipped command files + scripts. Follow the `CLAUDE.md` bump ritual (cache seeding in all three profiles, install-record updates, cold restart) as a separate step if a release is cut.
- **`summons.log` writers during `--apply`:** migration is a one-shot manual op; run it when no buddy session is actively appending.
- **`identity.json` is a spec addendum:** not in spec §1's enumerated list but clearly global; migrated and relocated here.
