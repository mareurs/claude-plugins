# Buddy Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four infrastructure gaps identified in the gap closure spec so the buddy plugin is fully functional and distributable.

**Architecture:** No architectural changes. All work fits inside the existing three-layer model (BONES/WITNESS/SOUL). Python changes in `scripts/`, markdown command changes in `commands/`, README polish.

**Tech Stack:** Python 3 stdlib, pytest, bash, Claude Code plugin system.

**Reference:** `docs/superpowers/specs/2026-04-13-buddy-gap-closure-design.md`

---

## File Inventory

**Create:**
- `commands/legend.md` — new `/buddy:legend` slash command
- `commands/install.md` — new `/buddy:install` slash command

**Modify:**
- `scripts/state.py` — add `active_specialists` to `default_state()`
- `scripts/statusline.py` — add `SPECIALIST_INITIAL` constant, extract `parse_stdin_context_pct()`, update `render()` and `main()`
- `commands/summon.md` — add Step 6 to update `active_specialists` in state
- `commands/dismiss.md` — rewrite to accept optional alias arg and clear/remove from state
- `README.md` — remove hardcoded marketplace path, point to `/buddy:install`

**Test:**
- `tests/test_state.py` — assert `active_specialists` in default state
- `tests/test_statusline.py` — assert initials in label, assert stdin context_pct parsing

---

## Testing Commands Reference

- Run full test suite: `pytest -v`
- Run single test: `pytest tests/test_state.py::test_name -v`

---

### Task 1: `active_specialists` field in state schema

**Files:**
- Modify: `scripts/state.py` — `default_state()` function
- Test: `tests/test_state.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_state.py`:

```python
def test_default_state_has_active_specialists_empty_list():
    s = default_state()
    assert s["active_specialists"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_state.py::test_default_state_has_active_specialists_empty_list -v`
Expected: FAIL with `KeyError: 'active_specialists'`

- [ ] **Step 3: Add the field to `default_state()`**

In `scripts/state.py`, modify the top-level dict returned by `default_state()`. After the `last_mood_transition_ts` line, add:

```python
        "active_specialists": [],
```

Final `default_state()` body:

```python
def default_state() -> dict:
    return {
        "version": STATE_VERSION,
        "signals": {
            "context_pct": 0,
            "last_edit_ts": 0,
            "last_commit_ts": 0,
            "session_start_ts": 0,
            "prompt_count": 0,
            "tool_call_count": 0,
            "last_test_result": None,
            "recent_errors": [],
            "idle_ts": 0,
        },
        "derived_mood": "flow",
        "suggested_specialist": None,
        "last_mood_transition_ts": 0,
        "active_specialists": [],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_state.py -v`
Expected: all tests PASS, including the new one.

- [ ] **Step 5: Commit**

```bash
git add scripts/state.py tests/test_state.py
git commit -m "feat(state): add active_specialists list to default state"
```

---

### Task 2: `SPECIALIST_INITIAL` map + initials in statusline label

**Files:**
- Modify: `scripts/statusline.py` — add constant, update `render()`
- Test: `tests/test_statusline.py`

- [ ] **Step 1: Write the failing test — single specialist initial**

Add to `tests/test_statusline.py`:

```python
def test_render_shows_active_specialist_initial():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    state["active_specialists"] = ["debugging-yeti"]
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)
    assert "[D]" in output


def test_render_shows_multiple_active_specialists_initials():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    state["active_specialists"] = ["debugging-yeti", "testing-snow-leopard"]
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)
    assert "[DT]" in output


def test_render_no_initials_when_no_active_specialists():
    identity = {
        "version": 1,
        "form": "owl-of-clear-seeing",
        "name": "Lin",
        "personality": "",
        "hatched_at": 0,
        "soul_model": "fallback",
        "hatched": False,
    }
    state = default_state()
    output = render(identity=identity, state=state, bodhisattvas=BODHIS, env=ENV, now=1000000, local_hour=14)
    assert "[" not in output.split("\n")[-1] or "[D" not in output
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_statusline.py -v -k "active_specialist"`
Expected: first two FAIL (no initial appears), third passes vacuously.

- [ ] **Step 3: Add `SPECIALIST_INITIAL` constant**

In `scripts/statusline.py`, after the existing `SPECIALIST_SHORT` dict, add:

```python
SPECIALIST_INITIAL = {
    "debugging-yeti": "D",
    "refactoring-yak": "R",
    "git-yak": "G",
    "testing-snow-leopard": "T",
    "performance-lammergeier": "P",
    "security-ibex": "S",
    "architecture-snow-lion": "A",
    "planning-crane": "C",
    "docs-lotus-frog": "W",
}
```

- [ ] **Step 4: Update `render()` to append initials**

In `scripts/statusline.py`, modify `render()`. After the existing block that appends the suggested specialist hint and before the final `label = " · ".join(label_parts)`:

```python
    active = state.get("active_specialists", [])
    if active:
        initials = "".join(SPECIALIST_INITIAL.get(s, "?") for s in active)
        label_parts.append(f"[{initials}]")
```

Full updated tail of `render()`:

```python
    label_parts = [form.get("label", form_name), mood]
    if suggested:
        short = SPECIALIST_SHORT.get(suggested, suggested)
        label_parts.append(f"{short} nearby")

    active = state.get("active_specialists", [])
    if active:
        initials = "".join(SPECIALIST_INITIAL.get(s, "?") for s in active)
        label_parts.append(f"[{initials}]")

    label = " · ".join(label_parts)
    return f"{base}\n {label}"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_statusline.py -v`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/statusline.py tests/test_statusline.py
git commit -m "feat(statusline): render active specialist initials in label"
```

---

### Task 3: Parse `context_pct` from statusline stdin

**Files:**
- Modify: `scripts/statusline.py` — add `parse_stdin_context_pct()`, update `main()`
- Test: `tests/test_statusline.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_statusline.py`:

```python
from scripts.statusline import parse_stdin_context_pct


def test_parse_stdin_context_pct_from_valid_session_json():
    raw = '{"context_window": {"used_percentage": 85}}'
    assert parse_stdin_context_pct(raw) == 85.0


def test_parse_stdin_context_pct_returns_zero_on_missing_field():
    raw = '{"model": {"display_name": "opus"}}'
    assert parse_stdin_context_pct(raw) == 0.0


def test_parse_stdin_context_pct_returns_zero_on_malformed_json():
    assert parse_stdin_context_pct("{not json") == 0.0
    assert parse_stdin_context_pct("") == 0.0


def test_parse_stdin_context_pct_handles_null():
    raw = '{"context_window": {"used_percentage": null}}'
    assert parse_stdin_context_pct(raw) == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_statusline.py -v -k "parse_stdin"`
Expected: FAIL with `ImportError: cannot import name 'parse_stdin_context_pct'`.

- [ ] **Step 3: Implement `parse_stdin_context_pct()`**

In `scripts/statusline.py`, add this function after `_load_json` and before `render`:

```python
def parse_stdin_context_pct(raw: str) -> float:
    """Extract context_window.used_percentage from Claude Code session JSON.

    Returns 0.0 on any parse failure, missing field, or null value. Never raises.
    """
    try:
        session = json.loads(raw)
        ctx = session.get("context_window", {}).get("used_percentage")
        if ctx is None:
            return 0.0
        return float(ctx)
    except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
        return 0.0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_statusline.py -v -k "parse_stdin"`
Expected: PASS.

- [ ] **Step 5: Wire it into `main()`**

In `scripts/statusline.py`, update `main()` to parse stdin and inject context_pct into the state signals dict:

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

        import os
        user_id = os.environ.get("CLAUDE_CODE_USER_ID") or os.environ.get("USER", "user")
        identity = load_identity(IDENTITY_PATH, user_id=user_id)

        bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
        env = _load_json(DATA_DIR / "environment.json")

        sys.stdout.write(render(identity, state, bodhis, env))
    except Exception:
        pass

    return 0
```

- [ ] **Step 6: Write integration test for main() via subprocess**

Add to `tests/test_statusline.py`:

```python
import subprocess
import sys as _sys


def test_main_parses_context_pct_from_stdin(tmp_path, monkeypatch):
    """Feeding session JSON with high context_pct on stdin should yield full-context mood."""
    raw = '{"context_window": {"used_percentage": 85}}'
    repo_root = Path(__file__).parent.parent
    result = subprocess.run(
        [_sys.executable, str(repo_root / "scripts" / "statusline.py")],
        input=raw,
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == 0
    assert "full-context" in result.stdout
```

- [ ] **Step 7: Run all tests to verify**

Run: `pytest tests/test_statusline.py -v`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/statusline.py tests/test_statusline.py
git commit -m "feat(statusline): parse context_pct from session stdin JSON"
```

---

### Task 4: Update `commands/summon.md` to track active_specialists

**Files:**
- Modify: `commands/summon.md`

- [ ] **Step 1: Add Step 6 to the summon command**

In `commands/summon.md`, after the existing `## Step 5 — Log the summon` section, append a new section:

```markdown
## Step 6 — Track the active specialist in state

Append the resolved `<directory>` to the `active_specialists` list in
`~/.claude/buddy/state.json`, so the statusline shows the specialist's initial.

Use the `Bash` tool to run this Python one-liner:

​```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, save_state
p = Path.home() / '.claude' / 'buddy' / 'state.json'
s = load_state(p)
active = s.setdefault('active_specialists', [])
if '<directory>' not in active:
    active.append('<directory>')
save_state(p, s)
" || true
​```

Substitute `<directory>` with the resolved specialist directory from Step 1.
Silent on failure — the statusline initial is advisory, not required.
```

(Note: replace the escaped backticks in the plan above with real triple-backticks in the file. The `​` zero-width space in `​```bash` is only to prevent nested fences in this plan doc.)

- [ ] **Step 2: Verify file contents**

Run: `cat commands/summon.md | tail -40`
Expected: shows the new Step 6 with correct bash block.

- [ ] **Step 3: Manual smoke test**

```bash
# Simulate what the slash command would do
CLAUDE_PLUGIN_ROOT="$(pwd)" python3 -c "
import sys
sys.path.insert(0, '$CLAUDE_PLUGIN_ROOT')
from pathlib import Path
from scripts.state import load_state, save_state
p = Path('/tmp/buddy-test-state.json')
s = load_state(p)
active = s.setdefault('active_specialists', [])
if 'debugging-yeti' not in active:
    active.append('debugging-yeti')
save_state(p, s)
print(load_state(p)['active_specialists'])
"
```

Expected: prints `['debugging-yeti']`.
Cleanup: `rm /tmp/buddy-test-state.json`

- [ ] **Step 4: Commit**

```bash
git add commands/summon.md
git commit -m "feat(summon): track active specialist in state.json"
```

---

### Task 5: Rewrite `commands/dismiss.md` with optional alias arg

**Files:**
- Modify: `commands/dismiss.md`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `commands/dismiss.md` with:

```markdown
---
name: buddy:dismiss
description: Release one or all currently summoned specialists. With no argument, dismisses every active specialist. With an alias argument (yeti, yak, leopard, lammergeier, ibex, lion, crane, git-yak, frog), dismisses only that one. The primary bodhisattva stays.
---

You are releasing one or all summoned specialists. The argument passed by the user is `$1`.

## Step 1 — Resolve the target

Map the argument to a specialist directory using this table. If `$1` is empty or absent, target is `"ALL"`.

| Alias | Directory |
|---|---|
| `yeti` | `debugging-yeti` |
| `yak` or `refactor-yak` | `refactoring-yak` |
| `git-yak` | `git-yak` |
| `leopard` | `testing-snow-leopard` |
| `lammergeier` | `performance-lammergeier` |
| `ibex` | `security-ibex` |
| `lion` | `architecture-snow-lion` |
| `crane` | `planning-crane` |
| `frog` | `docs-lotus-frog` |

If the alias is provided but unknown, print the table above and stop. Do not change state.

## Step 2 — Update active_specialists in state

Use the `Bash` tool to run the appropriate Python one-liner.

**If target is `"ALL"`:**

​```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, save_state
p = Path.home() / '.claude' / 'buddy' / 'state.json'
s = load_state(p)
s['active_specialists'] = []
save_state(p, s)
" || true
​```

**Otherwise (specific directory):**

​```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, save_state
p = Path.home() / '.claude' / 'buddy' / 'state.json'
s = load_state(p)
active = s.get('active_specialists', [])
if '<directory>' in active:
    active.remove('<directory>')
s['active_specialists'] = active
save_state(p, s)
" || true
​```

Substitute `<directory>` with the resolved directory from Step 1.

## Step 3 — Emit the farewell

- If target is `"ALL"`: emit a brief farewell addressing all specialists. Example: *"The specialists step back into the mountains. You carry what you learned."*
- If target is a specific specialist: emit a farewell in that specialist's voice. Example for yeti: *"The Yeti steps back into the mountains. Breathe. You carry what you learned."*

Return to normal Claude assistant mode for voice. Note: the platform keeps the specialist's loaded skill content in context for the rest of the session — this is a Claude Code limitation, not a buddy bug. The dismissal updates state (so the statusline drops the initial) and tells Claude to drop the voice.

## Step 4 — Log the dismissal

Append one line to `~/.claude/buddy/summons.log`:

- If target is `"ALL"`: `<unix timestamp>\tall\tdismissed`
- Otherwise: `<unix timestamp>\t<directory>\tdismissed`

Use bash via the `Bash` tool. Silent on failure — the log is advisory.
```

(Note: replace the `​` zero-width space prefix in `​```bash` with real triple-backticks.)

- [ ] **Step 2: Verify file contents**

Run: `wc -l commands/dismiss.md`
Expected: roughly 70-80 lines.

Run: `head -5 commands/dismiss.md`
Expected: frontmatter with updated description mentioning optional alias.

- [ ] **Step 3: Manual smoke test — dismiss one**

```bash
# Seed state with two specialists
CLAUDE_PLUGIN_ROOT="$(pwd)" python3 -c "
import sys
sys.path.insert(0, '$CLAUDE_PLUGIN_ROOT')
from pathlib import Path
from scripts.state import load_state, save_state, default_state
p = Path('/tmp/buddy-test-state.json')
s = default_state()
s['active_specialists'] = ['debugging-yeti', 'testing-snow-leopard']
save_state(p, s)
"

# Dismiss one
CLAUDE_PLUGIN_ROOT="$(pwd)" python3 -c "
import sys
sys.path.insert(0, '$CLAUDE_PLUGIN_ROOT')
from pathlib import Path
from scripts.state import load_state, save_state
p = Path('/tmp/buddy-test-state.json')
s = load_state(p)
active = s.get('active_specialists', [])
if 'debugging-yeti' in active:
    active.remove('debugging-yeti')
s['active_specialists'] = active
save_state(p, s)
print(load_state(p)['active_specialists'])
"
```

Expected: prints `['testing-snow-leopard']`.
Cleanup: `rm /tmp/buddy-test-state.json`

- [ ] **Step 4: Commit**

```bash
git add commands/dismiss.md
git commit -m "feat(dismiss): support optional alias arg, clear active_specialists in state"
```

---

### Task 6: Create `commands/legend.md`

**Files:**
- Create: `commands/legend.md`

- [ ] **Step 1: Create the file**

Write `commands/legend.md`:

```markdown
---
name: buddy:legend
description: Print a reference card showing specialist initials, aliases, and mood meanings. Useful when the statusline shows [DT] and you want to know what that means.
---

You are printing the buddy plugin reference card. Emit exactly the following markdown table in your response. No preamble, no commentary — just the table.

## Buddy Legend

### Specialist Initials

| Initial | Specialist | Summon With |
|---------|-----------|-------------|
| D | Debugging Yeti | `/buddy:summon yeti` |
| R | Refactoring Yak | `/buddy:summon yak` |
| G | Git Yak | `/buddy:summon git-yak` |
| T | Testing Snow Leopard | `/buddy:summon leopard` |
| P | Performance Lammergeier | `/buddy:summon lammergeier` |
| S | Security Ibex | `/buddy:summon ibex` |
| A | Architecture Snow Lion | `/buddy:summon lion` |
| C | Planning Crane | `/buddy:summon crane` |
| W | Docs Lotus Frog | `/buddy:summon frog` |

Dismiss one with `/buddy:dismiss <alias>` or all with `/buddy:dismiss`.

### Moods

| Mood | Triggers |
|------|----------|
| flow | Default — calm baseline |
| racing | High edit velocity in a young session |
| exploratory | Many tool calls, low context |
| full-context | Context ≥ 80% |
| stuck | 3+ test failures in last 15 min |
| victorious | Green tests after prior errors |
| test-streak | Recent green, no prior errors |
| long-session | Session > 2 hours |
| idle | No input for 5+ min |
| late-night | Hour ≥ 23 or ≤ 5 |
```

- [ ] **Step 2: Verify file was written**

Run: `wc -l commands/legend.md`
Expected: approximately 35 lines.

- [ ] **Step 3: Commit**

```bash
git add commands/legend.md
git commit -m "feat(commands): add /buddy:legend reference card"
```

---

### Task 7: Create `commands/install.md`

**Files:**
- Create: `commands/install.md`

- [ ] **Step 1: Create the file**

Write `commands/install.md`:

```markdown
---
name: buddy:install
description: Auto-wire the buddy statusline into ~/.claude/settings.json. Detects whether claude-statusline is also installed and picks composed vs standalone mode accordingly. Asks before overwriting an existing statusLine entry.
---

You are installing the buddy statusline into the user's Claude Code settings.

## Step 1 — Locate the plugin root and detect sibling plugins

Use the `Bash` tool. The plugin root is `${CLAUDE_PLUGIN_ROOT}` (set by Claude Code). Fall back to `~/.claude/plugins/buddy` if unset.

Check for a sibling `claude-statusline` plugin at `~/.claude/plugins/claude-statusline/`:

​```bash
if [ -d "$HOME/.claude/plugins/claude-statusline" ]; then
  echo "MODE=composed"
else
  echo "MODE=standalone"
fi
​```

## Step 2 — Choose the statusLine command

- **composed mode:** `bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-composed.sh`
- **standalone mode:** `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/statusline.py`

## Step 3 — Read the current settings.json

​```bash
SETTINGS="$HOME/.claude/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi
python3 -c "
import json, pathlib
p = pathlib.Path.home() / '.claude' / 'settings.json'
s = json.loads(p.read_text() or '{}')
print('EXISTING:', json.dumps(s.get('statusLine')) if 'statusLine' in s else 'NONE')
"
​```

## Step 4 — If a statusLine already exists, confirm before overwriting

If the output of Step 3 starts with `EXISTING: NONE`, proceed directly to Step 5.

If `EXISTING: <something>` is shown, print the current value to the user and ask:

> "You already have a `statusLine` entry configured: `<current>`. Overwrite it with the buddy statusline (`<new command>`)? Reply yes to overwrite, no to cancel."

If the user says no, stop. Do nothing. Report that install was cancelled.

## Step 5 — Write the new statusLine entry

​```bash
python3 -c "
import json, pathlib, os
p = pathlib.Path.home() / '.claude' / 'settings.json'
s = json.loads(p.read_text() or '{}')
s['statusLine'] = {
    'type': 'command',
    'command': '<CHOSEN_COMMAND>'
}
p.write_text(json.dumps(s, indent=2) + '\\n')
print('Wrote statusLine:', s['statusLine']['command'])
"
​```

Substitute `<CHOSEN_COMMAND>` with the command chosen in Step 2 (keep the literal `${CLAUDE_PLUGIN_ROOT}` — Claude Code expands it at statusline execution time).

## Step 6 — Report

Print a short summary:

- Which mode was chosen (composed or standalone) and why
- The exact command written to settings.json
- That the user must restart Claude Code (or reload) for the statusline to take effect
- Point them to `/buddy:legend` and `/buddy:status` as next steps

## Step 7 — Do not log

Install is not a summon event. Skip the summons.log append.
```

(Note: replace each `​```bash` with real triple-backticks when writing the file.)

- [ ] **Step 2: Verify file was written**

Run: `wc -l commands/install.md`
Expected: approximately 75-85 lines.

- [ ] **Step 3: Manual smoke test — detection logic**

```bash
# Without claude-statusline installed
[ -d "$HOME/.claude/plugins/claude-statusline" ] && echo MODE=composed || echo MODE=standalone
```

Expected: `MODE=standalone` (assuming claude-statusline is not in ~/.claude/plugins/; if it is, expect `MODE=composed`).

- [ ] **Step 4: Commit**

```bash
git add commands/install.md
git commit -m "feat(commands): add /buddy:install auto-wiring for statusline"
```

---

### Task 8: README cleanup

**Files:**
- Modify: `README.md` — `## Install` section and `### Statusline: three modes` section

- [ ] **Step 1: Replace hardcoded marketplace path**

In `README.md`, locate the `## Install` section. Replace:

```text
/plugin marketplace add /home/marius/work/claude/claude-plugins   # once per machine
/plugin install buddy@sdd-misc-plugins
```

With:

```text
/plugin marketplace add <path-to-marketplace>   # once per machine
/plugin install buddy@sdd-misc-plugins
```

- [ ] **Step 2: Add `/buddy:install` call-out after the install block**

Immediately after the `/buddy:status` verification block, add a new paragraph:

```markdown
After installing, run `/buddy:install` to auto-wire the statusline into
`~/.claude/settings.json`. It detects whether `claude-statusline` is also
installed and picks composed or standalone mode accordingly. If you prefer
to wire it manually, see the three modes below.
```

- [ ] **Step 3: Keep the "three modes" reference but add a lead-in note**

At the top of the `### Statusline: three modes` section, add:

```markdown
The `/buddy:install` command handles the common case automatically. The
sections below document each mode for users who want to wire it manually
or override the auto-detected default.
```

Leave the three mode blocks as they are.

- [ ] **Step 4: Verify rendered output**

Run: `head -80 README.md`
Expected: no `/home/marius/work/claude` hardcoded path; `/buddy:install` mentioned once in the Install section; lead-in note present above "Statusline: three modes".

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): remove hardcoded marketplace path, point to /buddy:install"
```

---

## Spec Coverage Check

| Spec requirement | Implementing task |
|---|---|
| Parse `context_pct` from stdin JSON | Task 3 |
| `state["signals"]["context_pct"]` populated from stdin | Task 3, Step 5 |
| `active_specialists: []` in `default_state()` | Task 1 |
| `SPECIALIST_INITIAL` map (D,R,G,T,P,S,A,C,W) | Task 2, Step 3 |
| Render `[initials]` in statusline label | Task 2, Step 4 |
| `summon.md` Step 6 updates state | Task 4 |
| `dismiss.md` supports `/buddy:dismiss` (all) and `/buddy:dismiss <alias>` (one) | Task 5 |
| Dismiss log format (`all\tdismissed` vs `<dir>\tdismissed`) | Task 5, Step 1 |
| `commands/legend.md` with both initials and moods tables | Task 6 |
| `commands/install.md` detects claude-statusline, writes settings.json | Task 7 |
| Install command confirms before overwriting existing statusLine | Task 7, Step 4 |
| README removes hardcoded marketplace path | Task 8, Step 1 |
| README points users to `/buddy:install` | Task 8, Step 2 |
| Platform constraint note (skills can't be removed from context) | Already baked into Task 5 Step 3 farewell instructions |

All spec requirements are covered. No placeholders, no forward references to undefined symbols.
