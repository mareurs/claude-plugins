# Buddy Plugin — Gap Closure Design

**Date:** 2026-04-13
**Status:** Approved

---

## Overview

Four targeted changes to make the buddy plugin fully functional and distributable.
No new architecture; all changes fit within the existing three-layer model (BONES / WITNESS / SOUL).

---

## Change 1 — `context_pct` from statusline stdin

### Problem

`statusline.py:main()` calls `sys.stdin.read()` and discards the result.
The session JSON Claude Code sends on stdin includes `.context_window.used_percentage`,
which is exactly the value `derive_mood()` needs for the `full-context` and `exploratory`
mood branches. The `context_pct` signal in `state.json` is therefore always 0,
and those moods never trigger.

### Fix

In `main()`, parse stdin as JSON instead of discarding it.
Extract `.context_window.used_percentage` (float, 0–100) and inject it into the
state's signals dict before calling `render()`:

```python
raw = sys.stdin.read()
try:
    session = json.loads(raw)
    ctx_pct = session.get("context_window", {}).get("used_percentage", 0) or 0
    state.setdefault("signals", {})["context_pct"] = float(ctx_pct)
except Exception:
    pass  # silent — state.json fallback value stays
```

`render()` signature is unchanged. The `context_pct` field in `state.json` is kept
as a fallback (hooks could populate it in future), but the live stdin value always wins.

### Tests

- `test_statusline.py`: pass a mock stdin JSON with `context_window.used_percentage = 85`,
  assert `derive_mood` receives `context_pct=85` and returns `"full-context"`.
- `test_statusline.py`: pass malformed stdin, assert graceful fallback to state value.

---

## Change 2 — Active specialists in state + initials in statusline + legend command

### 2a — State schema

Add one field to `default_state()` in `scripts/state.py`:

```python
"active_specialists": [],   # list of specialist directory names currently summoned
```

`STATE_VERSION` does **not** increment — `active_specialists` is absent in older
state files and `state.get("active_specialists", [])` is the safe read pattern.

### 2b — Initials map

Add `SPECIALIST_INITIAL` dict to `scripts/statusline.py` alongside `SPECIALIST_SHORT`:

| Directory | Initial | Domain |
|---|---|---|
| `debugging-yeti` | `D` | Debugging |
| `refactoring-yak` | `R` | Refactoring |
| `git-yak` | `G` | Git |
| `testing-snow-leopard` | `T` | Testing |
| `performance-lammergeier` | `P` | Performance |
| `security-ibex` | `S` | Security |
| `architecture-snow-lion` | `A` | Architecture |
| `planning-crane` | `C` | Planning |
| `docs-lotus-frog` | `W` | Writing |

All nine initials are unique. Unknown directory names fall back to `?`.

### 2c — Statusline label

In `render()`, after building `label_parts`, append active specialist initials
if any are present:

```python
active = state.get("active_specialists", [])
if active:
    initials = "".join(SPECIALIST_INITIAL.get(s, "?") for s in active)
    label_parts.append(f"[{initials}]")
```

Example output:
```
 Nyima · flow · [YT]
```

### 2d — summon.md update

After the existing Step 5 (log to summons.log), add **Step 6**:

> Load `~/.claude/buddy/state.json`, append `<directory>` to
> `state["active_specialists"]` if not already present, save atomically.
> Use `scripts/state.py` helpers. Silent on failure.

### 2e — dismiss.md update

The command gains an optional alias argument (same table as summon.md).

- **`/buddy:dismiss`** (no arg): clear `active_specialists` to `[]`, dismiss all.
- **`/buddy:dismiss <alias>`**: resolve alias → directory, remove only that entry
  from `active_specialists`. Farewell is specific to the dismissed specialist.

Update the log append:
- Single dismiss: `<ts>\t<directory>\tdismissed`
- Dismiss all: `<ts>\tall\tdismissed`

### 2f — legend.md (new command)

New file `commands/legend.md` — `/buddy:legend`.

Prints a static markdown table:

```
## Buddy Legend

### Specialist Initials
| Initial | Specialist | Alias |
|---------|-----------|-------|
| D | Debugging Yeti | /buddy:summon yeti |
| R | Refactoring Yak | /buddy:summon yak |
| G | Git Yak | /buddy:summon git-yak |
| T | Testing Snow Leopard | /buddy:summon leopard |
| P | Performance Lammergeier | /buddy:summon lammergeier |
| S | Security Ibex | /buddy:summon ibex |
| A | Architecture Snow Lion | /buddy:summon lion |
| C | Planning Crane | /buddy:summon crane |
| W | Docs Lotus Frog | /buddy:summon frog |

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

No LLM computation needed — the command body is a static markdown response.

### Tests

- `test_statusline.py`: state with `active_specialists=["debugging-yeti"]` → label contains `[D]`.
- `test_statusline.py`: state with multiple specialists → initials sorted by list order.
- `test_state.py`: `default_state()["active_specialists"]` == `[]`.

---

## Change 3 — `/buddy:install` command + README cleanup

### 3a — commands/install.md (new command)

New file `commands/install.md` — `/buddy:install`.

The command uses Claude Code's Bash tool to:

1. **Locate plugin root** — `$CLAUDE_PLUGIN_ROOT` (set by Claude Code when running inside a plugin context). If unset, fall back to `~/.claude/plugins/buddy`.

2. **Detect claude-statusline** — check if `~/.claude/plugins/claude-statusline/` exists.

3. **Choose mode:**
   - claude-statusline found → composed: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-composed.sh`
   - not found → standalone: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/statusline.py`

4. **Read `~/.claude/settings.json`** (create `{}` if absent).

5. **Check for existing `statusLine` entry.** If already set, report current value and ask the user whether to overwrite. Do not overwrite silently.

6. **Write the new entry:**
   ```json
   "statusLine": {
     "type": "command",
     "command": "<chosen command>"
   }
   ```

7. **Report** what was written and whether the user needs to restart Claude Code.

The command is idempotent — running it twice with the same result is safe.

### 3b — README cleanup

Remove the hardcoded marketplace path from `## Install`:

**Before:**
```
/plugin marketplace add /home/marius/work/claude/claude-plugins   # once per machine
/plugin install buddy@sdd-misc-plugins
```

**After:**
```
/plugin marketplace add <path-to-marketplace>   # once per machine
/plugin install buddy@sdd-misc-plugins
```

Add a note pointing to `/buddy:install` for statusline wiring:

> After installing, run `/buddy:install` to automatically wire the statusline.
> It will detect whether `claude-statusline` is also installed and configure
> the correct mode (composed or standalone).

Keep the three manual `settings.json` JSON blocks in `### Statusline: three modes`.
Add a lead-in note that `/buddy:install` handles the common case and the blocks are
for users who prefer manual wiring or want to see exactly what the install writes.
Rationale: install documentation benefits from a visible escape hatch (common doc
pattern — homebrew, nvm, etc.), and showing the exact JSON a user would write serves
as a transparency aid before running the auto-install.

---

## Implementation order

1. Change 1 — `context_pct` stdin (self-contained, no schema changes)
2. Change 2a+2b — state schema + initials map (pure additions)
3. Change 2c+2d+2e — render + summon + dismiss (depends on 2a+2b)
4. Change 2f — legend command (independent)
5. Change 3 — install command + README (independent of 1 and 2)

All five can be reviewed independently. No change requires another to land first.

---

## Platform constraint — skill content is one-way

Claude Code does not expose any mechanism to remove a skill's content from the
conversation context once it has been loaded. Per the official docs, a skill's
rendered `SKILL.md` enters the conversation as a single message and **stays
there for the rest of the session**. There is no tool, hook, or slash command
that can surgically remove it. Auto-compaction will even re-attach recent skills
within a 25k-token shared budget.

**Implication for `/buddy:dismiss`:** the command can update `active_specialists`
in state (so the statusline stops showing the initial) and tell Claude to drop
the voice, but the specialist's loaded instructions remain in context for the
rest of the session. This is a platform limitation, not a buddy bug.

**Rejected workaround — sub-agent isolation:** spawning a forked sub-agent for
each summon would isolate the skill content to the sub-agent's context. This was
considered and rejected because buddy specialists are meant to persist across
many turns of dialogue with the user in the main conversation — a one-shot
sub-agent task does not fit the interaction model.

---

## Out of scope

- New moods or new specialists (feature work, not gap closure)
- Hook-side `context_pct` population (waiting on Claude Code to expose it)
- Automated install via marketplace post-install hook (not supported by plugin system)
