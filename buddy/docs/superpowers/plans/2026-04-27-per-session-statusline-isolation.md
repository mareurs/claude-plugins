# Per-Session Statusline Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move buddy's `state.json` from a single global `~/.claude/buddy/state.json` to per-session `<project_root>/.buddy/<session_id>/state.json`, with PPID-indexed session resolution for slash commands and PID-reuse-safe cleanup.

**Architecture:** Add three helpers in `state.py` (`session_state_path`, `pid_started_at`, `resolve_session_id_for_command`). Update statusline + 3 hooks + 4 slash commands to use session-scoped paths. Add a SessionEnd hook for graceful PPID cleanup. Hook scripts write a `by-ppid/<PPID>/{session_id,started_at}` index plus a last-writer pointer; slash commands read the index, falling back through a chain that survives PID reuse.

**Tech Stack:** Python 3 (pytest), bash, jq

---

### Task 1: Add `session_state_path()` to state.py

**Files:**
- Modify: `buddy/scripts/state.py` (add helper at end of file)
- Modify: `buddy/tests/test_state.py` (add test)

- [ ] **Step 1: Write the failing test**

Append to `buddy/tests/test_state.py`:

```python
def test_session_state_path_composes_correctly(tmp_path):
    from scripts.state import session_state_path
    result = session_state_path(tmp_path, "abc-123")
    assert result == tmp_path / ".buddy" / "abc-123" / "state.json"
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd buddy && python3 -m pytest tests/test_state.py::test_session_state_path_composes_correctly -v
```
Expected: FAIL with `ImportError: cannot import name 'session_state_path'`

- [ ] **Step 3: Implement helper**

Append to `buddy/scripts/state.py`:

```python
def session_state_path(project_root: Path, session_id: str) -> Path:
    """Per-session state.json path. Hooks/statusline write here; slash commands
    look it up via resolve_session_id_for_command()."""
    return project_root / ".buddy" / session_id / "state.json"
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd buddy && python3 -m pytest tests/test_state.py::test_session_state_path_composes_correctly -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/state.py buddy/tests/test_state.py
git commit -m "feat(buddy): add session_state_path helper"
```

---

### Task 2: Add `pid_started_at()` helper

**Files:**
- Modify: `buddy/scripts/state.py`
- Modify: `buddy/tests/test_state.py`

- [ ] **Step 1: Write the failing tests**

Append to `buddy/tests/test_state.py`:

```python
def test_pid_started_at_returns_string_for_self():
    """The current process should be alive — ps must return a non-empty start time."""
    import os
    from scripts.state import pid_started_at
    result = pid_started_at(os.getpid())
    assert result is not None
    assert len(result) > 0


def test_pid_started_at_returns_none_for_nonexistent_pid():
    from scripts.state import pid_started_at
    # PID 0 is the kernel/scheduler placeholder — `ps -p 0` fails on Linux+macOS.
    result = pid_started_at(0)
    assert result is None


def test_pid_started_at_stable_across_calls():
    """Two consecutive calls for the same live pid must return the same value."""
    import os
    from scripts.state import pid_started_at
    a = pid_started_at(os.getpid())
    b = pid_started_at(os.getpid())
    assert a == b
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd buddy && python3 -m pytest tests/test_state.py -k pid_started_at -v
```
Expected: FAIL with `ImportError: cannot import name 'pid_started_at'`

- [ ] **Step 3: Implement**

Append to `buddy/scripts/state.py` (also add `import subprocess` near top if absent):

```python
def pid_started_at(pid: int) -> str | None:
    """Return parent process start time as an opaque string, or None if pid is gone.

    Uses `ps -o lstart= -p <pid>` — works on Linux and macOS. Empty/failed
    output → None. Used to detect PID reuse: if a stored start_time differs
    from the current value for the same pid, the entry is stale.
    """
    try:
        result = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode != 0:
            return None
        out = result.stdout.strip()
        return out or None
    except (subprocess.SubprocessError, OSError, ValueError):
        return None
```

If `import subprocess` isn't already at the top of the file, add it after the existing imports.

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd buddy && python3 -m pytest tests/test_state.py -k pid_started_at -v
```
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/state.py buddy/tests/test_state.py
git commit -m "feat(buddy): add pid_started_at helper"
```

---

### Task 3: Add `resolve_session_id_for_command()`

**Files:**
- Modify: `buddy/scripts/state.py`
- Modify: `buddy/tests/test_state.py`

- [ ] **Step 1: Write failing tests for the resolution chain**

Append to `buddy/tests/test_state.py`:

```python
def _setup_buddy_dir(tmp_path):
    d = tmp_path / ".buddy"
    d.mkdir()
    return d


def test_resolve_uses_by_ppid_when_started_at_matches(tmp_path, monkeypatch):
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    ppid_dir = bdir / "by-ppid" / "12345"
    ppid_dir.mkdir(parents=True)
    (ppid_dir / "session_id").write_text("sid-from-ppid")
    (ppid_dir / "started_at").write_text("Mon Jan 1 00:00:00 2026")
    monkeypatch.setattr(state_mod, "pid_started_at",
                        lambda pid: "Mon Jan 1 00:00:00 2026" if pid == 12345 else None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 12345)
    assert sid == "sid-from-ppid"


def test_resolve_falls_through_when_started_at_mismatches(tmp_path, monkeypatch):
    """PID reuse — stored start_time != current start_time. Reject the entry."""
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    ppid_dir = bdir / "by-ppid" / "12345"
    ppid_dir.mkdir(parents=True)
    (ppid_dir / "session_id").write_text("stale-sid")
    (ppid_dir / "started_at").write_text("OLD")
    (bdir / ".current_session_id").write_text("pointer-sid")
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: "NEW")

    sid = state_mod.resolve_session_id_for_command(tmp_path, 12345)
    assert sid == "pointer-sid"


def test_resolve_uses_pointer_when_no_by_ppid(tmp_path, monkeypatch):
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    (bdir / ".current_session_id").write_text("pointer-sid")
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid == "pointer-sid"


def test_resolve_uses_lone_session_dir_when_no_pointer(tmp_path, monkeypatch):
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    (bdir / "the-only-sid").mkdir()
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid == "the-only-sid"


def test_resolve_returns_none_when_multiple_dirs_no_pointer(tmp_path, monkeypatch):
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    (bdir / "sid-a").mkdir()
    (bdir / "sid-b").mkdir()
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid is None


def test_resolve_returns_none_when_buddy_dir_missing(tmp_path, monkeypatch):
    from scripts import state as state_mod
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)
    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid is None


def test_resolve_skips_by_ppid_dirs_in_lone_dir_check(tmp_path, monkeypatch):
    """`by-ppid/` is a system dir — must not be picked as a 'lone session dir'."""
    from scripts import state as state_mod
    bdir = _setup_buddy_dir(tmp_path)
    (bdir / "by-ppid").mkdir()
    (bdir / "real-sid").mkdir()
    monkeypatch.setattr(state_mod, "pid_started_at", lambda pid: None)

    sid = state_mod.resolve_session_id_for_command(tmp_path, 99999)
    assert sid == "real-sid"
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd buddy && python3 -m pytest tests/test_state.py -k resolve -v
```
Expected: FAIL with `ImportError: cannot import name 'resolve_session_id_for_command'`

- [ ] **Step 3: Implement**

Append to `buddy/scripts/state.py`:

```python
def resolve_session_id_for_command(project_root: Path, ppid: int) -> str | None:
    """Resolve the active session_id for a slash command running under PPID.

    Resolution chain:
      1. by-ppid/<ppid>/{session_id,started_at} — verify started_at matches current
      2. .current_session_id pointer (last-writer)
      3. Sole session dir under .buddy/ (excluding by-ppid)
      4. None
    """
    buddy_dir = project_root / ".buddy"
    if not buddy_dir.is_dir():
        return None

    # 1. by-ppid index with PID-reuse verification
    ppid_dir = buddy_dir / "by-ppid" / str(ppid)
    sid_file = ppid_dir / "session_id"
    started_file = ppid_dir / "started_at"
    if sid_file.is_file() and started_file.is_file():
        try:
            stored_started = started_file.read_text().strip()
            current_started = pid_started_at(ppid)
            if current_started and current_started == stored_started:
                sid = sid_file.read_text().strip()
                if sid:
                    return sid
        except OSError:
            pass

    # 2. Last-writer pointer
    pointer = buddy_dir / ".current_session_id"
    if pointer.is_file():
        try:
            sid = pointer.read_text().strip()
            if sid:
                return sid
        except OSError:
            pass

    # 3. Lone session dir (skip by-ppid and dotfiles)
    try:
        candidates = [
            p for p in buddy_dir.iterdir()
            if p.is_dir() and p.name != "by-ppid" and not p.name.startswith(".")
        ]
        if len(candidates) == 1:
            return candidates[0].name
    except OSError:
        pass

    return None
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd buddy && python3 -m pytest tests/test_state.py -k resolve -v
```
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/state.py buddy/tests/test_state.py
git commit -m "feat(buddy): add resolve_session_id_for_command with PID-reuse safety"
```

---

### Task 4: Update statusline.py to use session-scoped state

**Files:**
- Modify: `buddy/scripts/statusline.py:24-25, 220-223`
- Modify: `buddy/tests/test_statusline.py`

- [ ] **Step 1: Write failing test**

Append to `buddy/tests/test_statusline.py`:

```python
def test_statusline_reads_session_scoped_state(tmp_path, monkeypatch, capsys):
    """Statusline must derive state path from stdin session_id+cwd, not global."""
    import json
    from scripts.state import default_state, save_state, session_state_path

    # Seed session-scoped state with a distinctive value
    sid = "sid-test-xyz"
    state = default_state()
    state["derived_mood"] = "stuck"
    state["active_specialists"] = ["debugging-yeti"]
    save_state(session_state_path(tmp_path, sid), state)

    # Stdin event for the statusline
    stdin_event = json.dumps({
        "session_id": sid,
        "workspace": {"current_dir": str(tmp_path)},
    })
    monkeypatch.setattr("sys.stdin", __import__("io").StringIO(stdin_event))

    from scripts import statusline
    statusline.main()
    out = capsys.readouterr().out
    # The yeti specialist's initial 'D' (from SPECIALIST_INITIAL) must appear
    assert "D" in out


def test_statusline_renders_default_when_no_session_id(tmp_path, monkeypatch, capsys):
    """No session_id in stdin → fall back to default_state, statusline still renders."""
    import json
    monkeypatch.setattr("sys.stdin", __import__("io").StringIO("{}"))
    from scripts import statusline
    rc = statusline.main()
    assert rc == 0
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd buddy && python3 -m pytest tests/test_statusline.py::test_statusline_reads_session_scoped_state -v
```
Expected: FAIL — currently reads `STATE_PATH` (global)

- [ ] **Step 3: Refactor statusline.py**

In `buddy/scripts/statusline.py`, replace lines 23-26:

```python
BUDDY_DIR = Path.home() / ".claude" / "buddy"
STATE_PATH = BUDDY_DIR / "state.json"
IDENTITY_PATH = BUDDY_DIR / "identity.json"
```

with:

```python
BUDDY_DIR = Path.home() / ".claude" / "buddy"
IDENTITY_PATH = BUDDY_DIR / "identity.json"
```

Then replace the body inside `main()` from `state = load_state(STATE_PATH)` to use the session-scoped path. The current `main()` body (lines ~213-243) imports state and reads `STATE_PATH`. Update to:

```python
def main() -> int:
    try:
        raw_stdin = sys.stdin.read()
    except Exception:
        raw_stdin = ""

    try:
        from scripts.state import load_state, default_state, session_state_path
        from scripts.identity import load_identity

        session_id, project_root = parse_stdin_session(raw_stdin)
        if session_id and project_root:
            state = load_state(session_state_path(project_root, session_id))
        else:
            state = default_state()

        ctx_pct = parse_stdin_context_pct(raw_stdin)
        if ctx_pct > 0:
            state.setdefault("signals", {})["context_pct"] = ctx_pct

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

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd buddy && python3 -m pytest tests/test_statusline.py -v
```
Expected: PASS (all statusline tests; the new ones plus existing ones)

- [ ] **Step 5: Commit**

```bash
git add buddy/scripts/statusline.py buddy/tests/test_statusline.py
git commit -m "feat(buddy): statusline reads session-scoped state.json"
```

---

### Task 5: Update session-start.sh — write pointer + by-ppid + GC + dead file removal

**Files:**
- Modify: `buddy/hooks/session-start.sh`
- Create: `buddy/tests/test_hooks_session_start.sh`

- [ ] **Step 1: Write the failing shell test**

Create `buddy/tests/test_hooks_session_start.sh`:

```bash
#!/usr/bin/env bash
# Test session-start.sh: pointer + by-ppid + GC + dead file removal.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/session-start.sh"

PASS=0; FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
EVENT='{"session_id":"sid-aaa","cwd":"'"$WORK"'","source":"startup","timestamp":1700000000}'

echo "$EVENT" | bash "$HOOK" >/dev/null 2>&1 || true

[ -f "$WORK/.buddy/.current_session_id" ] && [ "$(cat "$WORK/.buddy/.current_session_id")" = "sid-aaa" ] \
  && pass "pointer file written" || fail "pointer file"

[ -f "$WORK/.buddy/by-ppid/$$/session_id" ] && [ "$(cat "$WORK/.buddy/by-ppid/$$/session_id")" = "sid-aaa" ] \
  && pass "by-ppid session_id written" || fail "by-ppid session_id"

[ -f "$WORK/.buddy/by-ppid/$$/started_at" ] && [ -s "$WORK/.buddy/by-ppid/$$/started_at" ] \
  && pass "by-ppid started_at written" || fail "by-ppid started_at"

# GC: seed a stale by-ppid entry with bogus pid + bogus started_at
mkdir -p "$WORK/.buddy/by-ppid/99999"
echo "stale-sid" > "$WORK/.buddy/by-ppid/99999/session_id"
echo "BOGUS_TIME" > "$WORK/.buddy/by-ppid/99999/started_at"

EVENT2='{"session_id":"sid-bbb","cwd":"'"$WORK"'","source":"resume","timestamp":1700001000}'
echo "$EVENT2" | bash "$HOOK" >/dev/null 2>&1 || true

[ ! -d "$WORK/.buddy/by-ppid/99999" ] \
  && pass "GC removed stale entry" || fail "GC stale entry — still exists"

# Dead file cleanup: seed and verify removal
mkdir -p "$HOME/.claude/buddy"
DEAD="$HOME/.claude/buddy/state.json"
DEAD_BACKUP=""
if [ -f "$DEAD" ]; then DEAD_BACKUP=$(mktemp); cp "$DEAD" "$DEAD_BACKUP"; fi
echo '{"version":1}' > "$DEAD"

EVENT3='{"session_id":"sid-ccc","cwd":"'"$WORK"'","source":"startup","timestamp":1700002000}'
echo "$EVENT3" | bash "$HOOK" >/dev/null 2>&1 || true

[ ! -f "$DEAD" ] && pass "dead global state.json removed" || fail "dead global state.json still exists"

# Restore if we backed up the user's real one
if [ -n "$DEAD_BACKUP" ]; then mv "$DEAD_BACKUP" "$DEAD"; fi

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
```

Make executable: `chmod +x buddy/tests/test_hooks_session_start.sh`

- [ ] **Step 2: Run test, verify it fails**

```bash
bash buddy/tests/test_hooks_session_start.sh
```
Expected: FAIL — pointer file not written, by-ppid not written, GC absent

- [ ] **Step 3: Rewrite `buddy/hooks/session-start.sh`**

Replace the entire contents with:

```bash
#!/usr/bin/env bash
# SessionStart hook — resets session-scoped state + manages PPID index.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$PLUGIN_ROOT/hooks/judge.env" ] && . "$PLUGIN_ROOT/hooks/judge.env"

# Dev-mode symlink health check
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -d "$CLAUDE_PLUGIN_ROOT" ] && [ ! -L "$CLAUDE_PLUGIN_ROOT" ]; then
    echo "⚠ buddy: dev symlink broken — run: bash $PLUGIN_ROOT/scripts/dev-install.sh" >&2
fi

# Read event from stdin
EVENT=$(cat)

# Extract cwd and session_id with jq (fall back to empty)
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null || true)
SID=$(echo "$EVENT" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$CWD" ] && CWD=$(pwd)
[ -z "$SID" ] && SID="unknown"

BUDDY_PROJECT_DIR="$CWD/.buddy"
BY_PPID_DIR="$BUDDY_PROJECT_DIR/by-ppid"

# Ensure dirs exist
mkdir -p "$BY_PPID_DIR/$PPID" 2>/dev/null || true

# Write pointer + by-ppid index
echo "$SID" > "$BUDDY_PROJECT_DIR/.current_session_id" 2>/dev/null || true
echo "$SID" > "$BY_PPID_DIR/$PPID/session_id" 2>/dev/null || true
ps -o lstart= -p "$PPID" 2>/dev/null | sed 's/^ *//' > "$BY_PPID_DIR/$PPID/started_at" 2>/dev/null || true

# GC: prune by-ppid entries whose started_at no longer matches
if [ -d "$BY_PPID_DIR" ]; then
  for entry in "$BY_PPID_DIR"/*; do
    [ -d "$entry" ] || continue
    pid=$(basename "$entry")
    [ "$pid" = "$PPID" ] && continue  # skip self (just-written)
    stored=""
    [ -f "$entry/started_at" ] && stored=$(cat "$entry/started_at" 2>/dev/null || echo "")
    current=$(ps -o lstart= -p "$pid" 2>/dev/null | sed 's/^ *//' || echo "")
    if [ -z "$current" ] || [ "$current" != "$stored" ]; then
      rm -rf "$entry" 2>/dev/null || true
    fi
  done
fi

# One-shot migration: remove dead global state.json
DEAD_GLOBAL="$HOME/.claude/buddy/state.json"
[ -f "$DEAD_GLOBAL" ] && rm -f "$DEAD_GLOBAL" 2>/dev/null || true

# Run state-handling Python with session-scoped path
echo "$EVENT" | python3 -c "
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
project_root = Path(event.get('cwd') or os.getcwd())
session_id = event.get('session_id', 'unknown')
session_dir = project_root / '.buddy' / session_id
handle_session_start(
    event,
    path=session_dir / 'state.json',
    narrative_path=session_dir / 'narrative.jsonl',
    verdicts_path=session_dir / 'verdicts.json',
)
" || true
```

- [ ] **Step 4: Run shell test, verify it passes**

```bash
bash buddy/tests/test_hooks_session_start.sh
```
Expected: PASS (4 pass, 0 fail)

- [ ] **Step 5: Run full pytest to ensure no regressions**

```bash
cd buddy && python3 -m pytest tests/ -v
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add buddy/hooks/session-start.sh buddy/tests/test_hooks_session_start.sh
git commit -m "feat(buddy): session-start writes PPID index + GC + dead file cleanup"
```

---

### Task 6: Update user-prompt-submit.sh — pointer + by-ppid + session-scoped state

**Files:**
- Modify: `buddy/hooks/user-prompt-submit.sh`
- Create: `buddy/tests/test_hooks_user_prompt.sh`

- [ ] **Step 1: Write failing shell test**

Create `buddy/tests/test_hooks_user_prompt.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/user-prompt-submit.sh"

PASS=0; FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
SID="sid-prompt-test"
EVENT='{"session_id":"'"$SID"'","cwd":"'"$WORK"'","timestamp":1700000000}'

echo "$EVENT" | bash "$HOOK" >/dev/null 2>&1 || true

[ -f "$WORK/.buddy/.current_session_id" ] && [ "$(cat "$WORK/.buddy/.current_session_id")" = "$SID" ] \
  && pass "pointer written" || fail "pointer"

[ -f "$WORK/.buddy/by-ppid/$$/session_id" ] && [ "$(cat "$WORK/.buddy/by-ppid/$$/session_id")" = "$SID" ] \
  && pass "by-ppid session_id" || fail "by-ppid session_id"

[ -f "$WORK/.buddy/by-ppid/$$/started_at" ] && [ -s "$WORK/.buddy/by-ppid/$$/started_at" ] \
  && pass "by-ppid started_at" || fail "by-ppid started_at"

[ -f "$WORK/.buddy/$SID/state.json" ] \
  && pass "session-scoped state.json written" || fail "state.json not at session path"

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
```

Make executable: `chmod +x buddy/tests/test_hooks_user_prompt.sh`

- [ ] **Step 2: Run test, verify failure**

```bash
bash buddy/tests/test_hooks_user_prompt.sh
```
Expected: FAIL

- [ ] **Step 3: Rewrite `buddy/hooks/user-prompt-submit.sh`**

```bash
#!/usr/bin/env bash
# UserPromptSubmit hook — increments prompt count + maintains PPID index.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

EVENT=$(cat)
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null || true)
SID=$(echo "$EVENT" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$CWD" ] && CWD=$(pwd)
[ -z "$SID" ] && SID="unknown"

BUDDY_PROJECT_DIR="$CWD/.buddy"
BY_PPID_DIR="$BUDDY_PROJECT_DIR/by-ppid"
mkdir -p "$BY_PPID_DIR/$PPID" 2>/dev/null || true

echo "$SID" > "$BUDDY_PROJECT_DIR/.current_session_id" 2>/dev/null || true
echo "$SID" > "$BY_PPID_DIR/$PPID/session_id" 2>/dev/null || true
ps -o lstart= -p "$PPID" 2>/dev/null | sed 's/^ *//' > "$BY_PPID_DIR/$PPID/started_at" 2>/dev/null || true

echo "$EVENT" | python3 -c "
import sys, json, os
sys.path.insert(0, '$PLUGIN_ROOT')
from pathlib import Path
from scripts.hook_helpers import handle_user_prompt_submit
event = {}
try:
    event = json.loads(sys.stdin.read() or '{}')
except Exception:
    pass
if 'timestamp' not in event:
    import time
    event['timestamp'] = int(time.time())
project_root = Path(event.get('cwd') or os.getcwd())
session_id = event.get('session_id', 'unknown')
state_path = project_root / '.buddy' / session_id / 'state.json'
handle_user_prompt_submit(event, path=state_path)
" || true
```

- [ ] **Step 4: Run shell test, verify it passes**

```bash
bash buddy/tests/test_hooks_user_prompt.sh
```
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add buddy/hooks/user-prompt-submit.sh buddy/tests/test_hooks_user_prompt.sh
git commit -m "feat(buddy): user-prompt-submit writes PPID index + session-scoped state"
```

---

### Task 7: Update post-tool-use.sh — session-scoped state path

**Files:**
- Modify: `buddy/hooks/post-tool-use.sh`

- [ ] **Step 1: Rewrite `buddy/hooks/post-tool-use.sh`**

```bash
#!/usr/bin/env bash
# PostToolUse hook — updates signals + accumulates narrative for judge.
set -e
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$PLUGIN_ROOT/hooks/judge.env" ] && . "$PLUGIN_ROOT/hooks/judge.env"
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
project_root = Path(event.get('cwd') or os.getcwd())
session_id = event.get('session_id', 'unknown')
session_dir = project_root / '.buddy' / session_id
state_path = session_dir / 'state.json'
handle_post_tool_use(event, path=state_path)
narrative_path = session_dir / 'narrative.jsonl'
accumulate_narrative(event, narrative_path, project_root=project_root, session_id=session_id)
" || true
```

- [ ] **Step 2: Run full test suite**

```bash
cd buddy && python3 -m pytest tests/ -v
bash buddy/tests/test_hooks_session_start.sh
bash buddy/tests/test_hooks_user_prompt.sh
```
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add buddy/hooks/post-tool-use.sh
git commit -m "feat(buddy): post-tool-use uses session-scoped state path"
```

---

### Task 8: Update judge_worker.py — receive state_path from spawn args

**Files:**
- Modify: `buddy/scripts/judge_worker.py:124`
- Modify: `buddy/scripts/hook_helpers.py` (subprocess.Popen call site that spawns judge_worker)
- Modify: `buddy/tests/test_judge_worker.py`

- [ ] **Step 1: Find the current spawn call site**

```bash
cd buddy && grep -n "judge_worker" scripts/hook_helpers.py
```

The call uses `subprocess.Popen(["python3", "-m", "scripts.judge_worker", str(narrative_path), str(verdicts_path), str(project_root), session_id], ...)`. We must add `state_path` as a new positional arg AFTER `session_id`.

- [ ] **Step 2: Find current usage in judge_worker.py**

`buddy/scripts/judge_worker.py:124` reads:
```python
state_path = Path.home() / ".claude" / "buddy" / "state.json"
```

This is inside `assemble_context()`. The function takes `narrative_path, project_root` — it computes `state_path` from a hardcoded global. We'll add `state_path: Path` as a parameter.

- [ ] **Step 3: Write failing test**

Append to `buddy/tests/test_judge_worker.py`:

```python
def test_assemble_context_uses_provided_state_path(tmp_path):
    """assemble_context must read test_state from the supplied state_path,
    not from a hardcoded global path."""
    import json
    from scripts.judge_worker import assemble_context
    from scripts.state import default_state

    narrative = tmp_path / "narrative.jsonl"
    narrative.write_text('{"text":"x","ts":1}\n')
    state_path = tmp_path / "state.json"
    s = default_state()
    s["signals"]["last_test_result"] = {"ts": 100, "passed": 5, "failed": 2}
    state_path.write_text(json.dumps(s))

    ctx = assemble_context(narrative, tmp_path, state_path=state_path)
    assert ctx["test_state"] == {"ts": 100, "passed": 5, "failed": 2}
```

- [ ] **Step 4: Run test, verify failure**

```bash
cd buddy && python3 -m pytest tests/test_judge_worker.py::test_assemble_context_uses_provided_state_path -v
```
Expected: FAIL — `assemble_context()` doesn't accept `state_path`

- [ ] **Step 5: Modify `assemble_context()` signature in `judge_worker.py`**

Change the function signature in `buddy/scripts/judge_worker.py` to accept `state_path: Path` after the existing params. Replace the hardcoded line:

```python
state_path = Path.home() / ".claude" / "buddy" / "state.json"
```

with: (just remove the line — `state_path` comes from the parameter now). Also update `run_judge()` to accept and forward `state_path`.

Locate the function definitions (use `list_symbols` if needed):

```python
def assemble_context(
    narrative_path: Path,
    project_root: Path,
    state_path: Path,
) -> dict:
    # ... existing body ...
    # The line `state_path = Path.home() / ".claude" / "buddy" / "state.json"`
    # MUST be removed.
```

```python
def run_judge(
    narrative_path: Path,
    verdicts_path: Path,
    project_root: Path,
    session_id: str,
    state_path: Path,
) -> None:
    try:
        ctx = assemble_context(narrative_path, project_root, state_path=state_path)
        # ... rest unchanged ...
```

If there's a `__main__` block in `judge_worker.py` that parses sys.argv and calls `run_judge`, add a 5th positional arg:

```python
if __name__ == "__main__":
    import sys
    narrative_path = Path(sys.argv[1])
    verdicts_path = Path(sys.argv[2])
    project_root = Path(sys.argv[3])
    session_id = sys.argv[4]
    state_path = Path(sys.argv[5])
    run_judge(narrative_path, verdicts_path, project_root, session_id, state_path)
```

(If the existing `__main__` differs, preserve its structure but add `state_path = Path(sys.argv[5])` as the last positional arg.)

- [ ] **Step 6: Update spawn call in `hook_helpers.py`**

Locate the `subprocess.Popen(["python3", "-m", "scripts.judge_worker", ...]` call (around line 419 — inside `accumulate_narrative`). Add `str(state_path)` as a 5th positional arg in the args list. Since `accumulate_narrative` has access to `project_root` and `session_id`, compute:

```python
state_path = project_root / ".buddy" / session_id / "state.json"
```

just before the Popen call, then pass `str(state_path)` as the 5th element.

If there are TWO Popen sites (one for `cs_judge_worker`, one for `judge_worker`), update only the `judge_worker` one. Look for `"-m", "scripts.judge_worker"` (singular). Leave `scripts.cs_judge_worker` alone for now.

- [ ] **Step 7: Run tests, verify pass**

```bash
cd buddy && python3 -m pytest tests/test_judge_worker.py -v
```
Expected: PASS

- [ ] **Step 8: Run full test suite**

```bash
cd buddy && python3 -m pytest tests/ -v
```
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add buddy/scripts/judge_worker.py buddy/scripts/hook_helpers.py buddy/tests/test_judge_worker.py
git commit -m "feat(buddy): judge_worker takes state_path from spawn args"
```

---

### Task 9: Add session-end.sh hook + register in hooks.json

**Files:**
- Create: `buddy/hooks/session-end.sh`
- Modify: `buddy/hooks/hooks.json`
- Create: `buddy/tests/test_hooks_session_end.sh`

- [ ] **Step 1: Write failing shell test**

Create `buddy/tests/test_hooks_session_end.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/session-end.sh"

PASS=0; FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# Seed a by-ppid entry for our own PPID
mkdir -p "$WORK/.buddy/by-ppid/$$"
echo "sid-end-test" > "$WORK/.buddy/by-ppid/$$/session_id"
echo "TIME" > "$WORK/.buddy/by-ppid/$$/started_at"

EVENT='{"cwd":"'"$WORK"'","session_id":"sid-end-test"}'
echo "$EVENT" | bash "$HOOK" >/dev/null 2>&1 || true

[ ! -d "$WORK/.buddy/by-ppid/$$" ] \
  && pass "by-ppid entry for own PPID removed" || fail "by-ppid entry not removed"

# Seed an entry for a different PPID — must NOT be touched
mkdir -p "$WORK/.buddy/by-ppid/77777"
echo "other" > "$WORK/.buddy/by-ppid/77777/session_id"
echo "$EVENT" | bash "$HOOK" >/dev/null 2>&1 || true
[ -d "$WORK/.buddy/by-ppid/77777" ] \
  && pass "other PPID entries untouched" || fail "other PPID was wrongly removed"

echo
echo "Total: $((PASS+FAIL))  Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
```

Make executable: `chmod +x buddy/tests/test_hooks_session_end.sh`

- [ ] **Step 2: Run test, verify failure**

```bash
bash buddy/tests/test_hooks_session_end.sh
```
Expected: FAIL — hook doesn't exist

- [ ] **Step 3: Create `buddy/hooks/session-end.sh`**

```bash
#!/usr/bin/env bash
# SessionEnd hook — graceful cleanup of own by-ppid entry.
set -e

EVENT=$(cat)
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -z "$CWD" ] && CWD=$(pwd)

# Remove only our own PPID entry — leave others alone (SessionStart GC handles those)
ENTRY="$CWD/.buddy/by-ppid/$PPID"
[ -d "$ENTRY" ] && rm -rf "$ENTRY" 2>/dev/null || true

exit 0
```

Make executable: `chmod +x buddy/hooks/session-end.sh`

- [ ] **Step 4: Register in `buddy/hooks/hooks.json`**

Replace contents of `buddy/hooks/hooks.json` with:

```json
{
  "hooks": {
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.sh" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-end.sh" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.sh" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.sh" }] }]
  }
}
```

- [ ] **Step 5: Run shell test, verify it passes**

```bash
bash buddy/tests/test_hooks_session_end.sh
```
Expected: PASS (2/2)

- [ ] **Step 6: Commit**

```bash
git add buddy/hooks/session-end.sh buddy/hooks/hooks.json buddy/tests/test_hooks_session_end.sh
git commit -m "feat(buddy): SessionEnd hook for graceful PPID cleanup"
```

---

### Task 10: Update slash commands (summon, dismiss, status, check)

**Files:**
- Modify: `buddy/commands/summon.md`
- Modify: `buddy/commands/dismiss.md`
- Modify: `buddy/commands/status.md`
- Modify: `buddy/commands/check.md`

The pattern is the same in all four: replace `p = Path.home() / '.claude' / 'buddy' / 'state.json'` with the resolution chain.

- [ ] **Step 1: Update `buddy/commands/summon.md` Step 6 Python block**

Find the Python heredoc in Step 6 ("Track the active specialist in state"). Replace its body with:

```python
import sys, os
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, save_state, resolve_session_id_for_command, session_state_path
sid = resolve_session_id_for_command(Path.cwd(), os.getppid())
if not sid:
    print("buddy: no active session — send any prompt first", file=sys.stderr)
    raise SystemExit(0)
p = session_state_path(Path.cwd(), sid)
s = load_state(p)
active = s.setdefault('active_specialists', [])
if '<directory>' not in active:
    active.append('<directory>')
save_state(p, s)
```

(Keep `<directory>` placeholder — Claude substitutes at runtime.)

- [ ] **Step 2: Update `buddy/commands/dismiss.md` — both Python blocks**

There are TWO Python blocks (around lines 37 and 52). Replace each `p = Path.home() / '.claude' / 'buddy' / 'state.json'` with:

```python
sid = resolve_session_id_for_command(Path.cwd(), os.getppid())
if not sid:
    print("buddy: no active session — send any prompt first", file=sys.stderr)
    raise SystemExit(0)
p = session_state_path(Path.cwd(), sid)
```

And update the `from scripts.state import ...` line in each block to:

```python
from scripts.state import load_state, save_state, resolve_session_id_for_command, session_state_path
```

Also ensure each block starts with `import sys, os` (add `os` if missing).

- [ ] **Step 3: Update `buddy/commands/status.md`**

The status command's Step 1 instruction reads `~/.claude/buddy/state.json` (text instruction, not Python). Replace with:

```
1. Resolve current session: import resolve_session_id_for_command from scripts.state, call with Path.cwd() and os.getppid(). If None, report "no active buddy session in this project root" and stop.
2. Read `<project_root>/.buddy/<sid>/state.json` (may not exist on a fresh session — report that and move on).
```

Update the "Hook health" check (Step ~3) to look at `<project_root>/.buddy/<sid>/state.json` mtime instead of `~/.claude/buddy/state.json`.

- [ ] **Step 4: Update `buddy/commands/check.md`**

Step 1 (around line 10) reads `~/.claude/buddy/state.json` and `~/.claude/buddy/identity.json`. Replace with:

```
Resolve current session via scripts.state.resolve_session_id_for_command(Path.cwd(), os.getppid()). Read state from <project_root>/.buddy/<sid>/state.json (or `default_state()` if missing). Identity stays at `~/.claude/buddy/identity.json` — read as before.
```

- [ ] **Step 5: Manually verify no remaining hardcoded global paths**

```bash
grep -rn "Path.home() / '.claude' / 'buddy' / 'state.json'" buddy/commands/
grep -rn "~/.claude/buddy/state.json" buddy/commands/
```
Expected: zero matches in both (or only in comments/explanatory prose, not in code).

- [ ] **Step 6: Commit**

```bash
git add buddy/commands/
git commit -m "feat(buddy): slash commands resolve session via PPID chain"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full pytest suite**

```bash
cd buddy && python3 -m pytest tests/ -v
```
Expected: all PASS

- [ ] **Step 2: Run all shell tests**

```bash
bash buddy/tests/test_hooks_session_start.sh
bash buddy/tests/test_hooks_user_prompt.sh
bash buddy/tests/test_hooks_session_end.sh
```
Expected: all PASS

- [ ] **Step 3: Run repo-level test suite**

```bash
./tests/run-all.sh
```
Expected: all PASS (codescout-companion tests unaffected)

- [ ] **Step 4: Verify no remaining hardcoded global state.json reads**

```bash
grep -rn "claude/buddy/state.json" buddy/scripts/ buddy/hooks/ buddy/commands/
```
Expected: zero matches (or only in commit messages / dead code comments — none in actual code paths)

- [ ] **Step 5: Bump buddy version + update README**

In `buddy/.claude-plugin/plugin.json`, change `"version": "0.1.2"` → `"version": "0.2.0"` (minor bump for behavior change).

In `README.md`, update buddy row in the version table from `0.1.2` to `0.2.0`.

Run: `./scripts/check-versions.sh` — expected `OK: buddy 0.2.0`.

- [ ] **Step 6: Final commit + push**

```bash
git add buddy/.claude-plugin/plugin.json README.md
git commit -m "chore(buddy): bump to 0.2.0 — per-session statusline isolation"
git push
```

- [ ] **Step 7: Reseed both caches and update installed_plugins.json**

```bash
cp -r buddy /home/marius/.claude/plugins/cache/sdd-misc-plugins/buddy/0.2.0
cp -r buddy /home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.2.0

python3 -c "import json; path='/home/marius/.claude/plugins/installed_plugins.json'; d=json.load(open(path)); e=d['plugins']['buddy@sdd-misc-plugins'][0]; e['version']='0.2.0'; e['installPath']='/home/marius/.claude/plugins/cache/sdd-misc-plugins/buddy/0.2.0'; f=open(path,'w'); json.dump(d,f,indent=2); f.close(); print('done')"

python3 -c "import json; path='/home/marius/.claude-sdd/plugins/installed_plugins.json'; d=json.load(open(path)); e=d['plugins']['buddy@sdd-misc-plugins'][0]; e['version']='0.2.0'; e['installPath']='/home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.2.0'; f=open(path,'w'); json.dump(d,f,indent=2); f.close(); print('done')"

python3 -c "import json; path='/home/marius/.claude-sdd/settings.json'; d=json.load(open(path)); d['statusLine']['command']='bash /home/marius/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.2.0/scripts/statusline-composed.sh'; f=open(path,'w'); json.dump(d,f,indent=2); f.close(); print('done')"
```

- [ ] **Step 8: User restarts both Claude Code instances**

Restart `~/.claude` and `~/.claude-sdd` Claude Code instances. After restart, verify in each:
- `<project_root>/.buddy/<session_id>/state.json` exists after first prompt
- `<project_root>/.buddy/by-ppid/<ppid>/{session_id,started_at}` exist
- Statusline shows summoned specialists from THIS session only (no cross-session bleed)
