# Recon Badge Counters + State Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append session-scoped friction/win (F/W) counters to the buddy reconnaissance statusline badge — e.g. `[recon• F3/W4]` — fed by a counter the recon skill bumps when it records an F-N/W-N entry.

**Architecture:** A small CLI helper (`recon_count.py`, living with the recon skill in `codescout-companion`) maintains a per-session JSON counts file under `.buddy/<sid>/recon-counts.json`. The buddy statusline reads that file and appends a count suffix to the existing two-state badge. The recon `SKILL.md` Phase 3 runs the helper after recording each entry. Writer (codescout-companion) and reader (buddy) communicate only through the `.buddy/<sid>/` marker-file contract that already carries `recon-active`/`recon-loaded` — no cross-plugin code dependency.

**Tech Stack:** Python 3 (stdlib only: `argparse`, `json`, `tempfile`, `os`, `pathlib`), Bash (codescout-companion test convention: `tests/test-*.sh` globbed by `tests/run-all.sh`), pytest (buddy: `buddy/tests/`, run via `./.venv/bin/python -m pytest` from `buddy/`).

**Spec:** `docs/superpowers/specs/2026-05-21-recon-badge-counters-design.md`.

**Working dir:** `/home/marius/work/claude/claude-plugins`. Environment: codescout MCP blocks native Bash/Read/Edit on source — implementers use codescout `read_file`/`create_file`/`edit_code`/`edit_file`/`edit_markdown`/`run_command` (add `acknowledge_risk=true` when a shell command is gated).

**Verified shapes (recon, 2026-05-21):**
- `buddy/scripts/statusline.py :: _render_recon_badge(project_root, now, session_id=None)` (lines 166-202) computes `session_dir = Path(project_root)/".buddy"/session_id`, reads `recon-loaded`/`recon-active`, returns `"\033[95m[recon•]\033[0m"` (active fresh, `RECON_FRESH_SECS = 30*60`), `"\033[35m[recon]\033[0m"` (loaded), or `""`. Whole body wrapped in `try/except Exception: return ""`.
- buddy statusline tests call the public `render(...)` end-to-end (not `_render_recon_badge` directly), passing `session_id=` + `project_root=tmp_path` and writing markers under `tmp_path/.buddy/<sid>/`. Mirror that.
- codescout-companion has **no** `tests/` dir and no pytest infra (only `scripts/detect.py`). Repo-root `tests/run-all.sh` globs `tests/test-*.sh` (bash). So the helper's test is a **bash CLI test** at `tests/test-recon-count.sh`, not a pytest.
- recon `SKILL.md` is `codescout-companion/skills/reconnaissance/SKILL.md`; its `### Phase 3 — Externalize` section is followed by the `#### Worked exemplars` heading (a stable `edit_markdown` anchor).

---

### Task 1: `recon_count.py` helper + bash CLI test

**Files:**
- Create: `codescout-companion/skills/reconnaissance/recon_count.py`
- Create: `tests/test-recon-count.sh`

The helper is a no-dependency CLI. Contract: `bump F` / `bump W` increment a per-session counts file; `read` prints current counts. Resolves the session id from `<root>/.buddy/.current_session_id` (same source as the Phase-1 `recon-active` touch). Counts file: `<root>/.buddy/<sid>/recon-counts.json`, shape `{"F": <int>, "W": <int>}`. Atomic writes. Never raises (exit 0 even on missing SID / corrupt file) — it runs inside an LLM turn and must not break it.

- [ ] **Step 1: Write the failing test**

Create `tests/test-recon-count.sh`:

```bash
#!/usr/bin/env bash
# tests/test-recon-count.sh — recon_count.py CLI behavior
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/codescout-companion/skills/reconnaissance/recon_count.py"
PASS=0; FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL: $1 — $2"; FAIL=$((FAIL+1)); }

echo "── recon-count ──"

# 1. bump F creates file with F=1 W=0
T="$(mktemp -d)"; mkdir -p "$T/.buddy"; echo "sid1" > "$T/.buddy/.current_session_id"
python3 "$SCRIPT" bump F --root "$T" 2>/dev/null
CF="$T/.buddy/sid1/recon-counts.json"
if [ -f "$CF" ] && [ "$(python3 -c "import json;d=json.load(open('$CF'));print(d['F'],d['W'])")" = "1 0" ]; then
  ok "bump F → F=1 W=0"; else bad "bump F" "got $(cat "$CF" 2>/dev/null)"; fi

# 2. second bump F → F=2
python3 "$SCRIPT" bump F --root "$T" 2>/dev/null
if [ "$(python3 -c "import json;print(json.load(open('$CF'))['F'])")" = "2" ]; then
  ok "bump F twice → F=2"; else bad "bump F twice" "got $(cat "$CF")"; fi

# 3. bump W → W=1, F preserved
python3 "$SCRIPT" bump W --root "$T" 2>/dev/null
if [ "$(python3 -c "import json;d=json.load(open('$CF'));print(d['F'],d['W'])")" = "2 1" ]; then
  ok "bump W → F=2 W=1"; else bad "bump W" "got $(cat "$CF")"; fi

# 4. read prints current counts as JSON
OUT="$(python3 "$SCRIPT" read --root "$T" 2>/dev/null)"
if [ "$(echo "$OUT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['F'],d['W'])")" = "2 1" ]; then
  ok "read → {F:2,W:1}"; else bad "read" "got $OUT"; fi

# 5. missing .current_session_id → no-op, exit 0, no file written
T2="$(mktemp -d)"; mkdir -p "$T2/.buddy"
python3 "$SCRIPT" bump F --root "$T2" 2>/dev/null; RC=$?
if [ "$RC" = "0" ] && [ -z "$(find "$T2/.buddy" -name recon-counts.json)" ]; then
  ok "missing SID → exit 0, no file"; else bad "missing SID" "rc=$RC files=$(find "$T2/.buddy")"; fi

# 6. corrupt counts JSON → treated as zero, bump still succeeds → F=1
T3="$(mktemp -d)"; mkdir -p "$T3/.buddy/sid3"; echo "sid3" > "$T3/.buddy/.current_session_id"
echo "{ not json" > "$T3/.buddy/sid3/recon-counts.json"
python3 "$SCRIPT" bump F --root "$T3" 2>/dev/null
if [ "$(python3 -c "import json;print(json.load(open('$T3/.buddy/sid3/recon-counts.json'))['F'])")" = "1" ]; then
  ok "corrupt JSON → reset, bump F=1"; else bad "corrupt JSON" "got $(cat "$T3/.buddy/sid3/recon-counts.json")"; fi

rm -rf "$T" "$T2" "$T3"
echo "── recon-count: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `run_command("bash tests/test-recon-count.sh", acknowledge_risk=true)`
Expected: FAIL — the script does not exist yet, so every `python3 "$SCRIPT" ...` errors and assertions report FAIL (non-zero exit).

- [ ] **Step 3: Write the helper**

Create `codescout-companion/skills/reconnaissance/recon_count.py`:

```python
#!/usr/bin/env python3
"""Session-scoped reconnaissance F/W counter.

Maintains <root>/.buddy/<sid>/recon-counts.json = {"F": int, "W": int}, where
<sid> comes from <root>/.buddy/.current_session_id (same source the recon
SKILL.md Phase-1 marker touch uses). The buddy statusline reads this file to
append an F<n>/W<n> suffix to the [recon] badge.

CLI:
  recon_count.py bump F [--root DIR]   # +1 friction
  recon_count.py bump W [--root DIR]   # +1 win
  recon_count.py read   [--root DIR]   # print {"F":n,"W":n} as JSON

Never raises: missing session id, missing/corrupt counts file, and write
errors all degrade to a silent exit 0 — this runs inside an LLM turn and must
not break it. Per-session by construction: a new CC session has a new <sid>
dir, so counts start at zero with no explicit reset.
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path


def _counts_path(root: Path) -> Path | None:
    sid_file = root / ".buddy" / ".current_session_id"
    try:
        sid = sid_file.read_text().strip()
    except OSError:
        return None
    if not sid:
        return None
    return root / ".buddy" / sid / "recon-counts.json"


def _load(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
        return {"F": int(data.get("F", 0)), "W": int(data.get("W", 0))}
    except (OSError, ValueError, TypeError):
        return {"F": 0, "W": 0}


def _write_atomic(path: Path, counts: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(counts, f)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Recon F/W session counter")
    ap.add_argument("action", choices=["bump", "read"])
    ap.add_argument("kind", nargs="?", choices=["F", "W"])
    ap.add_argument("--root", default=".")
    args = ap.parse_args(argv)

    try:
        root = Path(args.root)
        path = _counts_path(root)
        if path is None:
            if args.action == "read":
                print(json.dumps({"F": 0, "W": 0}))
            return 0  # no session id → silent no-op
        counts = _load(path)
        if args.action == "read":
            print(json.dumps(counts))
            return 0
        if args.kind:  # bump
            counts[args.kind] += 1
            _write_atomic(path, counts)
        return 0
    except Exception:  # noqa: BLE001 - must never break the caller
        return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `run_command("bash tests/test-recon-count.sh", acknowledge_risk=true)`
Expected: PASS — `── recon-count: 6 passed, 0 failed`, exit 0.

- [ ] **Step 5: Confirm the suite runner picks it up**

Run: `run_command("bash tests/run-all.sh 2>&1 | grep -A3 recon-count", acknowledge_risk=true)`
Expected: the `recon-count` suite appears in the aggregate run, 6 passed.

- [ ] **Step 6: Commit**

```bash
git add codescout-companion/skills/reconnaissance/recon_count.py tests/test-recon-count.sh
git commit -m "feat(recon): session F/W counter helper + CLI test"
```
(End the commit body with a blank line then: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`)

---

### Task 2: statusline renders the count suffix

**Files:**
- Modify: `buddy/scripts/statusline.py` (`_render_recon_badge`, lines 166-202)
- Test: `buddy/tests/test_statusline.py`

Append ` F<n>/W<n>` inside the badge brackets, omitting any zero side, in BOTH the dim (`[recon]`) and bright (`[recon•]`) states. Empty (idle) badge stays empty. Reads `<session_dir>/recon-counts.json`; any failure degrades to the base badge.

- [ ] **Step 1: Write the failing tests**

Append to `buddy/tests/test_statusline.py` (these mirror the existing recon-badge tests' use of `render(...)`):

```python
def test_render_recon_counts_on_loaded(tmp_path):
    """recon-loaded + counts → [recon F3/W4] (dim, counts shown)."""
    sid = "sid-test"
    sd = tmp_path / ".buddy" / sid
    sd.mkdir(parents=True)
    (sd / "recon-loaded").write_text("")
    (sd / "recon-counts.json").write_text('{"F": 3, "W": 4}')
    identity = {"version": 1, "form": "owl-of-clear-seeing", "name": "Lin",
                "personality": "", "hatched_at": 0, "soul_model": "fallback",
                "hatched": False}
    output = render(identity=identity, state=default_state(),
                    bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14,
                    session_id=sid, project_root=tmp_path)
    assert "[recon F3/W4]" in output


def test_render_recon_counts_on_active(tmp_path):
    """recon-active fresh + counts → [recon• F3/W4] (bright, counts shown)."""
    sid = "sid-test"
    sd = tmp_path / ".buddy" / sid
    sd.mkdir(parents=True)
    active = sd / "recon-active"
    active.write_text("")
    (sd / "recon-counts.json").write_text('{"F": 3, "W": 4}')
    identity = {"version": 1, "form": "owl-of-clear-seeing", "name": "Lin",
                "personality": "", "hatched_at": 0, "soul_model": "fallback",
                "hatched": False}
    output = render(identity=identity, state=default_state(),
                    bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14,
                    session_id=sid, project_root=tmp_path)
    assert "[recon• F3/W4]" in output


def test_render_recon_counts_omit_zero_friction(tmp_path):
    """F0/W2 → only W2 shown."""
    sid = "sid-test"
    sd = tmp_path / ".buddy" / sid
    sd.mkdir(parents=True)
    (sd / "recon-loaded").write_text("")
    (sd / "recon-counts.json").write_text('{"F": 0, "W": 2}')
    identity = {"version": 1, "form": "owl-of-clear-seeing", "name": "Lin",
                "personality": "", "hatched_at": 0, "soul_model": "fallback",
                "hatched": False}
    output = render(identity=identity, state=default_state(),
                    bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14,
                    session_id=sid, project_root=tmp_path)
    assert "[recon W2]" in output
    assert "F0" not in output


def test_render_recon_counts_omit_zero_win(tmp_path):
    """F1/W0 → only F1 shown."""
    sid = "sid-test"
    sd = tmp_path / ".buddy" / sid
    sd.mkdir(parents=True)
    (sd / "recon-loaded").write_text("")
    (sd / "recon-counts.json").write_text('{"F": 1, "W": 0}')
    identity = {"version": 1, "form": "owl-of-clear-seeing", "name": "Lin",
                "personality": "", "hatched_at": 0, "soul_model": "fallback",
                "hatched": False}
    output = render(identity=identity, state=default_state(),
                    bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14,
                    session_id=sid, project_root=tmp_path)
    assert "[recon F1]" in output
    assert "W0" not in output


def test_render_recon_counts_both_zero_no_suffix(tmp_path):
    """F0/W0 → bare [recon], no suffix, no trailing space."""
    sid = "sid-test"
    sd = tmp_path / ".buddy" / sid
    sd.mkdir(parents=True)
    (sd / "recon-loaded").write_text("")
    (sd / "recon-counts.json").write_text('{"F": 0, "W": 0}')
    identity = {"version": 1, "form": "owl-of-clear-seeing", "name": "Lin",
                "personality": "", "hatched_at": 0, "soul_model": "fallback",
                "hatched": False}
    output = render(identity=identity, state=default_state(),
                    bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14,
                    session_id=sid, project_root=tmp_path)
    assert "[recon]" in output
    assert "[recon ]" not in output


def test_render_recon_counts_corrupt_file_degrades(tmp_path):
    """Corrupt counts JSON → base [recon] badge, no crash, no suffix."""
    sid = "sid-test"
    sd = tmp_path / ".buddy" / sid
    sd.mkdir(parents=True)
    (sd / "recon-loaded").write_text("")
    (sd / "recon-counts.json").write_text("{ not json")
    identity = {"version": 1, "form": "owl-of-clear-seeing", "name": "Lin",
                "personality": "", "hatched_at": 0, "soul_model": "fallback",
                "hatched": False}
    output = render(identity=identity, state=default_state(),
                    bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14,
                    session_id=sid, project_root=tmp_path)
    assert "[recon]" in output
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_statusline.py -q -k recon_counts`
Expected: FAIL — current badge has no suffix, so `[recon F3/W4]` etc. are absent (the both-zero and corrupt cases may already pass since they assert the bare badge; the four count-suffix cases fail).

- [ ] **Step 3: Implement the count suffix**

Replace the body of `_render_recon_badge` in `buddy/scripts/statusline.py`. Update the docstring (no longer strictly "two-state") and fold the count suffix into a single formatted return. Use codescout `edit_code` to replace the function:

```python
def _render_recon_badge(project_root, now, session_id=None):
    """Reconnaissance badge with session F/W counters.

    Markers under <project_root>/.buddy/<session_id>/:
      - recon-loaded : SessionStart dropped it; recon SKILL.md in scope.
                       No freshness check — lives for the session.
      - recon-active : LLM touched during a scout. Fresh-mtime (<30 min)
                       indicates scout in progress.
      - recon-counts.json : {"F": n, "W": n} session-scoped entry counts,
                       bumped by recon_count.py at SKILL.md Phase 3.

    Display:
      - active fresh   → "[recon•]" (bright purple)
      - loaded only    → "[recon]" (dim purple)
      - neither        → empty
    A non-zero count suffix (" F<n>/W<n>", omitting a zero side) is appended
    inside the brackets in both the dim and bright states.
    """
    try:
        if not project_root or not session_id or session_id == "unknown":
            return ""
        session_dir = Path(project_root) / ".buddy" / session_id
        loaded = session_dir / "recon-loaded"
        active = session_dir / "recon-active"
        now_ts = now or int(time.time())

        active_fresh = False
        if active.is_file():
            try:
                if now_ts - int(active.stat().st_mtime) <= RECON_FRESH_SECS:
                    active_fresh = True
            except OSError:
                pass

        if active_fresh:
            color, glyph = "\033[95m", "recon•"  # bright purple, scout in progress
        elif loaded.is_file():
            color, glyph = "\033[35m", "recon"   # purple, in scope
        else:
            return ""

        suffix = ""
        try:
            data = json.loads((session_dir / "recon-counts.json").read_text())
            f, w = int(data.get("F", 0)), int(data.get("W", 0))
            parts = []
            if f > 0:
                parts.append(f"F{f}")
            if w > 0:
                parts.append(f"W{w}")
            if parts:
                suffix = " " + "/".join(parts)
        except (OSError, ValueError, TypeError):
            suffix = ""

        return f"{color}[{glyph}{suffix}]\033[0m"
    except Exception:
        return ""
```

Note: `json` and `time` are already imported in `statusline.py` (the file already uses `time` here and `json` elsewhere). If `import json` is somehow not present at module top, add it with the other stdlib imports. Verify with `grep("^import json", path="buddy/scripts/statusline.py")` before assuming.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_statusline.py -q -k recon_counts`
Expected: PASS (6 passed).

- [ ] **Step 5: Run the full statusline + buddy suite (no regressions)**

Run: `cd buddy && ./.venv/bin/python -m pytest tests/test_statusline.py -q && ./.venv/bin/python -m pytest tests/ -q`
Expected: all green (the pre-existing recon badge tests still pass — bare `[recon]`/`[recon•]` cases have no counts file, so suffix is empty).

- [ ] **Step 6: Commit**

```bash
git add buddy/scripts/statusline.py buddy/tests/test_statusline.py
git commit -m "feat(buddy): recon badge renders session F/W counters"
```
(End the commit body with a blank line then: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`)

---

### Task 3: wire the bump into recon `SKILL.md` Phase 3

**Files:**
- Modify: `codescout-companion/skills/reconnaissance/SKILL.md` (Phase 3 section)

Add an instruction so that, after recording an F-N or W-N entry via `edit_markdown`, the model runs `recon_count.py bump F|W` — the step that lights the `F<n>/W<n>` suffix. Mirror the existing Phase-1 `recon-active` touch convention (skill-relative path, best-effort).

- [ ] **Step 1: Insert the count-bump instruction**

Use `edit_markdown` to insert a new paragraph just before the `#### Worked exemplars` heading in `codescout-companion/skills/reconnaissance/SKILL.md`:

```python
edit_markdown(
    path="codescout-companion/skills/reconnaissance/SKILL.md",
    action="insert_before",
    heading="#### Worked exemplars",
    content="""**Count the entry.** Right after the `edit_markdown` append lands, bump the session counter so the statusline `[recon]` badge shows your scout output as an `F<n>/W<n>` suffix. Use the helper next to this skill (its directory is the "Base directory for this skill" path printed when the skill loaded):

```bash
python3 "<skill-dir>/recon_count.py" bump F 2>/dev/null || true   # friction
python3 "<skill-dir>/recon_count.py" bump W 2>/dev/null || true   # win
```

Best-effort — the `2>/dev/null || true` keeps a counter failure from ever breaking the turn. The counter is session-scoped (resets each CC session) and independent of the tracker's monotonic F-N/W-N IDs.

"""
)
```

- [ ] **Step 2: Verify the section renders correctly**

Run: `read_markdown("codescout-companion/skills/reconnaissance/SKILL.md", heading="### Phase 3 — Externalize")`
Expected: the `**Count the entry.**` paragraph with the two `bump` one-liners now appears within Phase 3, immediately before the `#### Worked exemplars` subsection. No other Phase 3 content disturbed.

- [ ] **Step 3: Commit**

```bash
git add codescout-companion/skills/reconnaissance/SKILL.md
git commit -m "docs(recon): SKILL.md Phase 3 bumps session F/W counter"
```
(End the commit body with a blank line then: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`)

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run both plugins' suites**

Run: `run_command("bash tests/run-all.sh", acknowledge_risk=true)` → expect all suites green, including `recon-count`.
Run: `cd buddy && ./.venv/bin/python -m pytest tests/ -q` → expect all green.

- [ ] **Step 2: End-to-end smoke (helper → statusline)**

Run (creates a temp project with a session id, bumps counts, asserts the rendered badge carries the suffix):

```bash
run_command(\"\"\"
set -e
T=$(mktemp -d); mkdir -p "$T/.buddy"; echo "smoke-sid" > "$T/.buddy/.current_session_id"
touch "$T/.buddy/smoke-sid/recon-loaded" 2>/dev/null || mkdir -p "$T/.buddy/smoke-sid" && touch "$T/.buddy/smoke-sid/recon-loaded"
python3 codescout-companion/skills/reconnaissance/recon_count.py bump F --root "$T"
python3 codescout-companion/skills/reconnaissance/recon_count.py bump W --root "$T"
python3 codescout-companion/skills/reconnaissance/recon_count.py bump W --root "$T"
cd buddy && ./.venv/bin/python -c "
import sys; sys.path.insert(0, '.')
from scripts.statusline import _render_recon_badge
out = _render_recon_badge('$T', 1, session_id='smoke-sid')
print(repr(out))
assert 'F1/W2' in out, out
print('OK: badge carries F1/W2')
"
rm -rf "$T"
\"\"\", acknowledge_risk=true)
```
Expected: prints the badge repr containing `[recon F1/W2]` and `OK: badge carries F1/W2`. (Note: `_render_recon_badge` takes `now` as a small int here; the `recon-loaded` marker has no freshness check, so the dim badge renders deterministically.)

- [ ] **Step 2b: Report**

Report suite status and confirm: the helper is silent-on-missing-SID, counts omit zero sides, and counts render in both badge states.

---

## Notes & Risks

- **Release (after verification passes).** Two plugins changed → two version bumps per the root `CLAUDE.md` procedure: **codescout-companion** (new `recon_count.py`, SKILL.md Phase 3) and **buddy** (statusline). For each: bump `.claude-plugin/plugin.json` + README table, `scripts/check-versions.sh`, `scripts/bump-cache.sh <plugin> <version>`, update install records in all three profiles, refresh the version-bump-checklist tracker, then **cold-restart all three CC instances** (resume reuses cached hooks/statusline). This is a release step, not a code task — do it after Task 4 is green.
- **Skill-dir path in the one-liner.** The SKILL.md uses the `<skill-dir>` placeholder (the model substitutes the "Base directory for this skill" path printed at load), matching the skill's existing `<codescout-repo>` placeholder convention. There is no hardcoded absolute path.
- **`json` import in statusline.** Confirmed used in the file already; the implementation reuses it. Verify before relying on it (Task 2 Step 3 note).
- **No reset task.** Counts are per-session by construction (keyed on `<sid>` dir); a new session starts at zero with no cleanup needed.
- **Cross-plugin contract.** buddy never imports codescout-companion code; the only coupling is the `.buddy/<sid>/recon-counts.json` file shape `{"F":int,"W":int}`, which both sides treat defensively (missing/corrupt → zero).
